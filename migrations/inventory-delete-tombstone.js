// 库存安全删除 tombstone — PostgreSQL 建表迁移（隔离、幂等、fail-fast）
//
// 业务语义：
//   * inventory_imports 是历史导入审计记录，永远保留，不因库存删除而删除。
//   * 用户主动删除某个 (sku_code, country, warehouse) 的库存后，写入一行 tombstone。
//   * refreshInventoryTotals() 重建库存时排除该 tuple，使旧 inventory_imports
//     不再把已删除的库存"复活"。
//   * 后续真正发生新的库存导入时，由导入事务在同一 transaction 内 DELETE 该 tombstone（lift），
//     从而允许重新建立库存。tombstone 不是永久 SKU 禁用。
//
// 设计约束（沿用 migrations/replenishment-revision.js 既定约定）：
//   * 不触碰 db.js / db-pg.js / db-sync-worker.js / pg-async.js（属既有 transaction-stability WIP）。
//   * SQLite 建表由 db-sqlite.js 的 schema 初始化处理，本文件只处理 PG。
//   * 本文件为独立入口，由 server.js 启动序列在 refreshInventoryTotals() 之前同步调用；
//     任一 SQL 失败必须抛错，由调用方 fail-fast（process.exit），绝不可 catch 后继续启动
//     —— 否则 latestImportsSql() 会引用不存在的表导致启动异常。
//
// 幂等保证：CREATE TABLE IF NOT EXISTS —— 重复执行为 no-op，不报错、无副作用。

// 与 db-sqlite.js 中的同名建表语句逐字段对齐（SQLite 用 (datetime('now'))，PG 用 NOW()）。
// 注意：id 显式声明 NOT NULL。SQLite 的 `TEXT PRIMARY KEY` 与 PG 不同，它 **不隐式** NOT NULL
// （只有 INTEGER PRIMARY KEY 才隐式），未显式声明会导致双端 NULL 语义不一致。
const CREATE_TABLE_SQL = `CREATE TABLE IF NOT EXISTS inventory_delete_tombstones (
    id TEXT PRIMARY KEY NOT NULL,
    sku_code TEXT NOT NULL DEFAULT '',
    country TEXT NOT NULL DEFAULT '',
    warehouse TEXT NOT NULL DEFAULT '',
    deleted_at TEXT DEFAULT NOW(),
    deleted_by TEXT DEFAULT '',
    reason TEXT DEFAULT '',
    created_at TEXT DEFAULT NOW(),
    UNIQUE (sku_code, country, warehouse)
  )`;

/**
 * 确保 inventory_delete_tombstones 表存在。
 * @param {function} run 统一 DB 执行接口（server.js 的 run，同步返回 {changes}）。
 * @param {boolean} isPg 是否为 PostgreSQL 驱动。SQLite 由 db-sqlite.js 处理，本函数直接返回。
 */
function ensureInventoryDeleteTombstoneTable(run, isPg) {
  if (!isPg) return; // SQLite 建表在 db-sqlite.js 内完成，避免重复
  // 失败直接抛出（不吞异常），交由 server.js 启动序列 fail-fast。
  run(CREATE_TABLE_SQL);
}

module.exports = { ensureInventoryDeleteTombstoneTable, CREATE_TABLE_SQL };
