// 专用异步 PostgreSQL 连接池（仅用于 /api/replenishment-suggestions/generate 路径）。
//
// 目标：让 generate 在等待 PG 时释放 Node 主线程（同步桥 db.js/db-sync-worker.js 用
// Atomics.wait 会整段阻塞主线程，导致 daily-sales/Inventory/PI/CI/Payment 等并发请求
// 在 generate 期间被重置或长时间等待）。generate 改为通过本模块的 async pg Pool 执行，
// 等待 PG 的 await 期间事件循环自由，其他页面可正常响应。
//
// 边界（严格遵守）：
//  - 不修改 db.js / db-sync-worker.js；SQL 经 db-pg.js 的 _normalizeSql 复用既有
//    SQLite->PG 翻译层（不引入新的 normalize 逻辑），最终通过 await client.query 真正异步执行。
//  - 全局唯一 Pool（max=2），不得每次请求新建；不得在每次 generate 后 pool.end()。
//  - DATABASE_URL 缺失/连接失败 -> 抛可识别错误，由 handler 返回 JSON，不得崩溃。
const { Pool } = require('pg');
const { _normalizeSql, _getClientConfig } = require('./db-pg');

let pool = null;

function getGeneratePool() {
  if (pool) return pool;
  if (!process.env.DATABASE_URL) return null; // 调用方必须返回 JSON 错误，不得崩溃
  const cfg = _getClientConfig(); // 复用 db-pg 的连接配置（Supabase 直连/Pooler 切换、SSL 等）
  pool = new Pool({
    connectionString: cfg.connectionString,
    ssl: cfg.ssl,
    connectionTimeoutMillis: cfg.connectionTimeoutMillis || 15000,
    max: 2,
    idleTimeoutMillis: 30000,
    statement_timeout: 60000
  });
  // 监听 pool 级错误，避免未处理异常导致进程退出
  pool.on('error', (err) => {
    console.error('[GEN-POOL] unexpected pool error:', err && err.message ? err.message : err);
  });
  return pool;
}

// 在单一 client 上执行整段 generate 事务：
//   BEGIN -> 批量读取 -> 内存计算 -> 单条批量 UPDATE -> 必要时单条批量 INSERT -> COMMIT
// aq/aqOne/run 均经 _normalizeSql 翻译后 await client.query 执行（真正异步）。
// 任一环节失败：ROLLBACK；finally：client.release()。
async function withGenerateClient(fn) {
  const p = getGeneratePool();
  if (!p) {
    const e = new Error('DATABASE_URL 未配置，无法连接数据库');
    e.code = 'NO_DATABASE_URL';
    throw e;
  }
  let client;
  try {
    client = await p.connect();
  } catch (e) {
    const err = new Error('数据库连接失败：' + (e && e.message ? e.message : e));
    err.code = 'DB_CONNECT_FAILED';
    throw err;
  }
  try {
    await client.query('BEGIN');
    const aq = async (sql, params) => {
      const r = await client.query(_normalizeSql(sql), params || []);
      return r.rows;
    };
    const aqOne = async (sql, params) => {
      const rows = await aq(sql, params);
      return rows[0] || null;
    };
    const run = async (sql, params) => {
      await client.query(_normalizeSql(sql), params || []);
    };
    const result = await fn(aq, aqOne, run);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (e2) { /* 回滚失败不掩盖原错误 */ }
    throw e;
  } finally {
    client.release();
  }
}

// 非事务异步客户端：用于销售导入后的库存重算等不需要事务包裹的场景。
// 提供 aq/aqOne/arun 异步接口，SQL 经 _normalizeSql 翻译，不阻塞事件循环。
async function withAsyncPoolClient(fn) {
  const p = getGeneratePool();
  if (!p) {
    const e = new Error('DATABASE_URL 未配置，无法连接数据库');
    e.code = 'NO_DATABASE_URL';
    throw e;
  }
  let client;
  try {
    client = await p.connect();
  } catch (e) {
    const err = new Error('数据库连接失败：' + (e && e.message ? e.message : e));
    err.code = 'DB_CONNECT_FAILED';
    throw err;
  }
  try {
    const aq = async (sql, params) => {
      const r = await client.query(_normalizeSql(sql), params || []);
      return r.rows;
    };
    const aqOne = async (sql, params) => {
      const rows = await aq(sql, params);
      return rows[0] || null;
    };
    const arun = async (sql, params) => {
      await client.query(_normalizeSql(sql), params || []);
    };
    return await fn(aq, aqOne, arun);
  } finally {
    client.release();
  }
}

// 进程退出时有序关闭（不影响正常请求；仅释放空闲连接）
let shutdownHooked = false;
function hookShutdown() {
  if (shutdownHooked) return;
  shutdownHooked = true;
  const close = () => { if (pool) { try { pool.end().catch(() => {}); } catch (e) {} } };
  process.once('SIGTERM', close);
  process.once('SIGINT', close);
}
hookShutdown();

module.exports = { getGeneratePool, withGenerateClient, withAsyncPoolClient, hookShutdown };
