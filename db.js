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
  impl = require('./db-pg');
  console.log('[DB] 驱动 = PostgreSQL (DB_DRIVER=pg)');
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
