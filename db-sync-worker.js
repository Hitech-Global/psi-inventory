/**
 * DB 同步 Worker（worker_threads 方案）
 *
 * 代替 deasync.loopWhile 的同步包装器。主线程用 Atomics.wait 同步阻塞，
 * worker 线程有独立的事件循环，能正确处理 PG SSL I/O。
 *
 * 通信协议：
 *  - 主线程 → worker：{ id, type, sql, params }  (type: query/begin/commit/rollback)
 *  - worker → 主线程：{ id, ok, rows, rowCount, error, stack }
 *  - 同步信号：SharedArrayBuffer + Atomics.store/notify
 *
 * 事务处理：
 *  - begin: worker 创建专用 Client，执行 BEGIN
 *  - query（事务内）: 在专用 Client 上执行
 *  - commit/rollback: 执行 COMMIT/ROLLBACK，关闭专用 Client
 *  - 回调函数在主线程执行，查询通过 syncRequest 发送到 worker
 */

const { parentPort, workerData } = require('worker_threads');
const { Client } = require('pg');
const pgImpl = require('./db-pg');

const int32 = new Int32Array(workerData.sab);
let mainPort = null;
let txClient = null; // 事务模式下的专用连接

parentPort.on('message', async (msg) => {
  // init 消息：接收主线程的 MessagePort
  if (msg.type === 'init') {
    mainPort = msg.port;
    console.log('[DB-WORKER] 初始化完成，等待查询...');
    return;
  }

  try {
    let result = {};

    if (msg.type === 'query') {
      const pgSql = pgImpl._normalizeSql(msg.sql);
      const params = msg.params || [];

      if (txClient) {
        // 事务内：复用专用连接
        const res = await txClient.query(pgSql, params);
        result = { rows: res.rows, rowCount: res.rowCount };
      } else {
        // 非事务：创建新连接
        const client = new Client(pgImpl._getClientConfig());
        await client.connect();
        try {
          const res = await client.query(pgSql, params);
          result = { rows: res.rows, rowCount: res.rowCount };
        } finally {
          await client.end();
        }
      }
    } else if (msg.type === 'begin') {
      // 开始事务：创建专用连接
      txClient = new Client(pgImpl._getClientConfig());
      await txClient.connect();
      await txClient.query('BEGIN');
    } else if (msg.type === 'commit') {
      if (txClient) {
        await txClient.query('COMMIT');
        await txClient.end();
        txClient = null;
      }
    } else if (msg.type === 'rollback') {
      if (txClient) {
        try { await txClient.query('ROLLBACK'); } catch (e) {}
        try { await txClient.end(); } catch (e) {}
        txClient = null;
      }
    } else {
      throw new Error('Unknown message type: ' + msg.type);
    }

    // 先发送结果到 MessagePort，再用 Atomics 唤醒主线程
    mainPort.postMessage({ id: msg.id, ok: true, ...result });
  } catch (e) {
    mainPort.postMessage({
      id: msg.id,
      ok: false,
      error: e.message,
      stack: e.stack
    });
  }

  // 唤醒主线程
  Atomics.store(int32, 0, 1);
  Atomics.notify(int32, 0);
});

// worker 错误处理
process.on('uncaughtException', (err) => {
  console.error('[DB-WORKER] 未捕获异常:', err.message);
  if (mainPort) {
    mainPort.postMessage({
      id: -1,
      ok: false,
      error: 'Worker uncaughtException: ' + err.message,
      stack: err.stack
    });
    Atomics.store(int32, 0, 1);
    Atomics.notify(int32, 0);
  }
});
