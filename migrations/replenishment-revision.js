// 订单预测「建议采购数量」持久化 — PostgreSQL 列迁移（隔离、幂等、fail-fast）
//
// 仅新增 3 个 revision 列，供 server-managed revision + expected revision CAS 使用：
//   online_write_seq  — online suggested 的 server revision
//   offline_write_seq — offline suggested 的 server revision
//   recalc_revision   — 系统主动重新计算（generate/refresh/双 target_turnover/双 target_stock）的 generation revision
//
// 设计约束（来自既定方案）：
//   * 不触碰 db.js / db-pg.js / db-sync-worker.js / pg-async.js（属既有 transaction-stability WIP）。
//   * SQLite 迁移由 db-sqlite.js 自行处理（PRAGMA-free 的 try/catch ADD COLUMN 幂等模式），本文件只处理 PG。
//   * 本文件为独立入口，由 server.js 启动序列在 app.listen() 之前同步调用；任一 SQL 失败必须抛错，
//     由调用方 fail-fast（process.exit），绝不可 catch 后继续启动。
//
// 幂等保证：使用 `ADD COLUMN IF NOT EXISTS`（PG 9.6+），列已存在时为 no-op、不报错、无副作用。

const COLUMNS = [
  { name: 'online_write_seq', sql: 'BIGINT NOT NULL DEFAULT 0' },
  { name: 'offline_write_seq', sql: 'BIGINT NOT NULL DEFAULT 0' },
  { name: 'recalc_revision', sql: 'BIGINT NOT NULL DEFAULT 0' }
];

/**
 * 确保 replenishment_suggestions 的 3 个 revision 列存在。
 * @param {function} run 统一 DB 执行接口（server.js 的 run，同步返回 {changes} 或 info）。
 * @param {boolean} isPg 是否为 PostgreSQL 驱动。SQLite 由 db-sqlite.js 处理，本函数直接返回。
 */
function ensureReplenishmentRevisionColumns(run, isPg) {
  if (!isPg) return; // SQLite 迁移在 db-sqlite.js 内完成，避免重复
  for (const col of COLUMNS) {
    // 失败直接抛出（不吞异常），交由 server.js 启动序列 fail-fast。
    run(`ALTER TABLE replenishment_suggestions ADD COLUMN IF NOT EXISTS ${col.name} ${col.sql}`);
  }
}

module.exports = { ensureReplenishmentRevisionColumns };
