/**
 * 数据库适配层（INVENTORY-PG-REBUILD-01 · R1）
 *
 * 职责：根据环境变量 DB_DRIVER 把 6 个核心 DAL 函数分发到具体驱动实现。
 *   - DB_DRIVER=sqlite（默认）：加载 db-sqlite.js（原 db.js 整体搬迁，逻辑零改）
 *   - DB_DRIVER=pg：加载 db-pg.js（PostgreSQL 实现，含 SQL 归一化层）
 *
 * 业务代码（server.js / app.js）只 require('./db')，不感知底层驱动。
 * 任何驱动都必须实现并导出：query / queryOne / run / transaction / initDatabase / getDB。
 *
 * 并发安全：db-pg.js 内部使用 AsyncLocalStorage 路由事务连接，绝不依赖模块级全局 txClient。
 */

const driver = (process.env.DB_DRIVER || 'sqlite').toLowerCase();

// genId 与驱动无关，统一在此定义（驱动实现不得覆盖）。
function genId(prefix = 'id') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

let impl;
if (driver === 'pg') {
  // PG 驱动是 async，但 server.js 全部用同步调用（为 SQLite 设计）。
  // 用 deasync.loopWhile 把 async 函数包装成同步，让 server.js 无需修改即可在 PG 模式下工作。
  const deasync = require('deasync');
  const pgImpl = require('./db-pg');
  console.log('[DB] 驱动 = PostgreSQL (DB_DRIVER=pg, sync-wrapper)');

  // 连接错误重试白名单（与 db-pg.js 保持一致）
  var RETRYABLE = [
    'Connection terminated',
    'terminating connection due to',
    'connection reset',
    'ECONNRESET',
    'EPIPE',
    'ETIMEDOUT',
    'write ECONNRESET'
  ];
  function isRetryable(msg) {
    if (!msg) return false;
    for (var i = 0; i < RETRYABLE.length; i++) {
      if (msg.indexOf(RETRYABLE[i]) !== -1) return true;
    }
    return false;
  }

  function makeSync(asyncFn) {
    return function () {
      var maxAttempts = 3; // 首次 + 2 次重试
      for (var attempt = 1; attempt <= maxAttempts; attempt++) {
        var done = false;
        var result, error;
        var promise = asyncFn.apply(null, arguments);
        promise.then(function (r) { result = r; done = true; })
               .catch(function (e) { error = e; done = true; });
        deasync.loopWhile(function () { return !done; });
        if (!error) return result;
        // 连接错误时重试（用 deasync.sleep 等待，不依赖 setTimeout）
        if (attempt < maxAttempts && isRetryable(error.message)) {
          console.warn('[DB-SYNC] 查询失败（连接错误），第 ' + attempt + ' 次重试:', error.message);
          deasync.sleep(200); // 同步等待 200ms
          continue;
        }
        throw error;
      }
    };
  }

  impl = {
    query: makeSync(pgImpl.query),
    queryOne: makeSync(pgImpl.queryOne),
    run: makeSync(pgImpl.run),
    transaction: makeSync(pgImpl.transaction),
    // initDatabase 包含 50+ 建表语句，同步包装会死锁。
    // PG 模式下表已由迁移脚本创建，跳过 initDatabase（幂等 DDL 已执行过）。
    initDatabase: function () { console.log('[DB] initDatabase skipped in PG mode (tables already migrated)'); },
    getDB: pgImpl.getDB || (function () { throw new Error('getDB() 未由 pg 驱动提供'); })
  };
} else {
  impl = require('./db-sqlite');
  console.log('[DB] 驱动 = SQLite (DB_DRIVER=sqlite)');
}

// 重导出统一接口；genId 用适配层定义，确保两驱动生成策略一致。
module.exports = {
  genId,
  query: impl.query,
  queryOne: impl.queryOne,
  run: impl.run,
  transaction: impl.transaction,
  initDatabase: impl.initDatabase,
  getDB: impl.getDB || (() => { throw new Error('getDB() 未由驱动 ' + driver + ' 提供'); })
};
