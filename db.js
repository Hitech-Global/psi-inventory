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
  // 方案：worker_threads + Atomics.wait 实现同步包装。
  // deasync.loopWhile 在 Render Linux 上无法正确处理 PG SSL I/O（导致
  // "Connection terminated unexpectedly"）。worker 线程有独立事件循环，
  // 不受主线程 Atomics.wait 阻塞影响，能正确处理 PG 查询。
  const { Worker, MessageChannel, receiveMessageOnPort } = require('worker_threads');
  console.log('[DB] 驱动 = PostgreSQL (DB_DRIVER=pg, worker_threads sync)');

  // SharedArrayBuffer 用于主线程同步等待 worker 完成
  const sab = new SharedArrayBuffer(4);
  const int32 = new Int32Array(sab);
  const worker = new Worker(__dirname + '/db-sync-worker.js', { workerData: { sab } });
  const channel = new MessageChannel();
  let initialized = false;
  let msgId = 0;

  function ensureInit() {
    if (initialized) return;
    initialized = true;
    // 把 port2 传给 worker，worker 用它发送结果
    worker.postMessage({ type: 'init', port: channel.port2 }, [channel.port2]);
  }

  function syncRequest(type, sql, params) {
    ensureInit();
    var maxAttempts = 3;
    for (var attempt = 1; attempt <= maxAttempts; attempt++) {
      var id = ++msgId;
      Atomics.store(int32, 0, 0);
      worker.postMessage({ id: id, type: type, sql: sql, params: params });

      // 同步等待 worker 完成（30 秒超时）
      var status = Atomics.wait(int32, 0, 0, 30000);
      if (status !== 'ok') {
        var timeoutErr = new Error('DB query timeout (' + status + ') after 30s, type=' + type);
        if (attempt < maxAttempts) {
          console.warn('[DB-SYNC] 查询超时，第 ' + attempt + ' 次重试');
          continue;
        }
        throw timeoutErr;
      }

      var msg = receiveMessageOnPort(channel.port1);
      if (!msg || !msg.message) {
        var noRespErr = new Error('No response from worker (type=' + type + ')');
        if (attempt < maxAttempts) {
          console.warn('[DB-SYNC] 无响应，第 ' + attempt + ' 次重试');
          continue;
        }
        throw noRespErr;
      }

      var data = msg.message;
      if (!data.ok) {
        var err = new Error(data.error);
        if (data.stack) err.stack = data.stack;
        // 连接错误时重试
        if (attempt < maxAttempts && isRetryable(data.error)) {
          console.warn('[DB-SYNC] 查询失败（连接错误），第 ' + attempt + ' 次重试:', data.error);
          // 同步等待 200ms（用 Atomics.wait 计时）
          Atomics.wait(int32, 0, 1, 200);
          Atomics.store(int32, 0, 0);
          continue;
        }
        throw err;
      }
      return data;
    }
    throw new Error('DB query failed after ' + maxAttempts + ' attempts (type=' + type + ')');
  }

  // 连接错误重试白名单
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

  impl = {
    query: function (sql, params) {
      var data = syncRequest('query', sql, params);
      return { rows: data.rows || [] };
    },
    queryOne: function (sql, params) {
      var data = syncRequest('query', sql, params);
      return (data.rows && data.rows[0]) || null;
    },
    run: function (sql, params) {
      var data = syncRequest('query', sql, params);
      return { changes: data.rowCount == null ? 0 : data.rowCount };
    },
    transaction: function (fn) {
      syncRequest('begin');
      try {
        var result = fn();
        syncRequest('commit');
        return result;
      } catch (e) {
        try { syncRequest('rollback'); } catch (re) {}
        throw e;
      }
    },
    initDatabase: function () {
      console.log('[DB] initDatabase in PG mode — executing idempotent migrations...');
      // CHANNEL-ALLOCATION: 幂等 DDL，确保新增列/表存在
      // db-pg.js 的 async initDatabase 在 worker_threads 模式下不会被调用，
      // 因此在此处通过 syncRequest 同步执行迁移。
      var migrations = [
        "CREATE TABLE IF NOT EXISTS sku_channel_configs (id TEXT PRIMARY KEY, sku_code TEXT NOT NULL, country_id TEXT NOT NULL, online_pct DOUBLE PRECISION NOT NULL, offline_pct DOUBLE PRECISION NOT NULL, status TEXT DEFAULT 'active', remark TEXT DEFAULT '', created_at TEXT DEFAULT NOW(), updated_at TEXT DEFAULT NOW(), UNIQUE (sku_code, country_id))",
        "ALTER TABLE replenishment_suggestions ADD COLUMN IF NOT EXISTS channel_ratio_source TEXT DEFAULT ''",
        "ALTER TABLE replenishment_suggestions ADD COLUMN IF NOT EXISTS channel_allocation_status TEXT DEFAULT ''",
        "ALTER TABLE replenishment_suggestions ADD COLUMN IF NOT EXISTS resolved_online_pct DOUBLE PRECISION",
        "ALTER TABLE replenishment_suggestions ADD COLUMN IF NOT EXISTS resolved_at TEXT DEFAULT ''",
        "ALTER TABLE replenishment_suggestions ADD COLUMN IF NOT EXISTS manual_online_transit_qty INTEGER DEFAULT 0",
        "ALTER TABLE replenishment_suggestions ADD COLUMN IF NOT EXISTS manual_offline_transit_qty INTEGER DEFAULT 0",
        // AUTH: persistent_logins 表（remember-me 30天免登录）；db-pg.js async initDatabase 在 worker_threads 模式下不执行，须在此补建
        "CREATE TABLE IF NOT EXISTS persistent_logins (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, user_id TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, last_used_at TEXT DEFAULT '', user_agent TEXT DEFAULT '', ip_address TEXT DEFAULT '', revoked INTEGER NOT NULL DEFAULT 0)",
        "CREATE INDEX IF NOT EXISTS idx_persistent_user ON persistent_logins(user_id)",
        "CREATE INDEX IF NOT EXISTS idx_persistent_expires ON persistent_logins(expires_at)",
        "CREATE INDEX IF NOT EXISTS idx_persistent_token ON persistent_logins(token_hash)"
      ];
      for (var i = 0; i < migrations.length; i++) {
        try {
          syncRequest('query', migrations[i]);
          console.log('[DB] migration OK: ' + migrations[i].substring(0, 60) + '...');
        } catch (e) {
          console.error('[DB] migration FAILED: ' + e.message);
        }
      }
      console.log('[DB] PG migrations completed.');
    },
    getDB: function () { throw new Error('getDB() not available in worker_threads mode'); }
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
