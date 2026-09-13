// BULK-1 — inventory_imports latest-per-key 复合索引迁移（PG 优先，SQLite 同构，隔离、幂等、fail-fast）
//
// 背景（2026-09-13 实测，见 audit-artifacts/BULK-IMPORT-STABILITY-GRADED-2026-09-13.md）：
//   inventory_imports 在 PG 上【只有 PK，无任何二级索引】。
//   latestImportsSqlForKeySet() 的 latest-per-key 解析因此退化为
//   M(历史总行数) × K(affected keys) 量级嵌套循环：
//     M=10k 无索引 ≈ 7.5s；M=500k 有索引仍 ≈ 20s；M=50k 无索引 > 90s 超时。
//   本索引让"按 key 收敛候选行"变成索引扫描，是 BULK-1 性能修复的必要组成。
//
// 语义安全：本文件只加索引，不改任何查询语义、不读写业务数据。
//   latest-per-key 的 tie 语义（最大 import_date 下多行全部返回）由
//   server.js 的 latestImportsSqlForKeySet() 重写单独保证，与本索引无关。
//
// ============================ 上线风险与对策 ============================
// 普通 CREATE INDEX 会持有 SHARE 锁，阻塞该表上的所有 INSERT/UPDATE/DELETE。
// 对一张已经很大的 inventory_imports，这等于"导入功能停摆数秒~数十秒"。
// 因此：
//   1) 生产大表：**先手工**用 CREATE INDEX CONCURRENTLY 建索引，再部署本代码。
//      独立脚本：scripts/create-inventory-imports-index-concurrently.cjs
//      （CONCURRENTLY 不能在 transaction block 内执行，故无法放进任何自动包事务的 runner）
//   2) 启动期自动补建（本文件）：仅在【索引不存在】且【表行数 <= 阈值】时执行普通
//      CREATE INDEX。新库/小库瞬时完成；大库只打 WARNING 并跳过，绝不长时间锁表。
//   3) 幂等：索引已存在 → 直接 RETURN，no-op。
//
// 设计约束（沿用 migrations/inventory-delete-tombstone.js 既定约定）：
//   * 不触碰 db.js / db-pg.js / db-sync-worker.js / pg-async.js。
//   * 本文件为独立入口，由 server.js 启动序列调用；索引建失败必须抛错 fail-fast。
//     （唯一例外是"表过大主动跳过"，那是有意的降级而非失败。）

// 阈值：超过该行数则不在启动期自动建索引（改由运维用 CONCURRENTLY 手工建）
const AUTO_CREATE_MAX_ROWS = 250000;

const INDEX_NAME = 'idx_inventory_imports_latest';
const INDEX_COLS = '(sku_code, country, warehouse, import_date)';

// PG：DO 块内含守卫的幂等建索引。
// 说明：DO 块自身在一个隐式事务里，不能放 CREATE INDEX CONCURRENTLY，故这里用普通
// CREATE INDEX，但用"索引不存在 + 表不大"双重条件把锁表时间压到毫秒级。
const PG_ENSURE_SQL = `DO $bulk1$
DECLARE
  v_reltuples bigint;
  v_rows bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = '${INDEX_NAME}') THEN
    RETURN; -- 已存在（很可能是 CONCURRENTLY 建的）→ no-op
  END IF;

  IF to_regclass('public.inventory_imports') IS NULL THEN
    RAISE WARNING '[BULK-1] inventory_imports 表尚不存在，跳过建索引（本次启动由 schema 初始化负责）';
    RETURN;
  END IF;

  -- reltuples = -1 表示从未 ANALYZE，行数未知 → 退回精确 count(*)
  SELECT c.reltuples INTO v_reltuples FROM pg_class c WHERE c.oid = 'public.inventory_imports'::regclass;
  IF v_reltuples IS NULL THEN
    RETURN; -- 极端情况：拿不到统计信息，保守跳过
  ELSIF v_reltuples >= 0 THEN
    v_rows := v_reltuples;
  ELSE
    EXECUTE 'SELECT count(*) FROM public.inventory_imports' INTO v_rows;
  END IF;

  IF v_rows > ${AUTO_CREATE_MAX_ROWS} THEN
    RAISE WARNING '[BULK-1] inventory_imports 约 % 行 > %，启动期跳过自动建索引（避免长时间锁表）。请先用 CONCURRENTLY 手工创建：CREATE INDEX CONCURRENTLY ${INDEX_NAME} ON inventory_imports ${INDEX_COLS};', v_rows, ${AUTO_CREATE_MAX_ROWS};
    RETURN;
  END IF;

  EXECUTE 'CREATE INDEX ${INDEX_NAME} ON public.inventory_imports ${INDEX_COLS}';
  RAISE NOTICE '[BULK-1] 已创建索引 ${INDEX_NAME}（inventory_imports 约 % 行）', v_rows;
END
$bulk1$`;

// 生产/运维用：手工执行的 CONCURRENTLY 语句（不锁写，可在线执行；失败会留下 INVALID 索引，需 DROP 后重试）
const PG_CONCURRENTLY_SQL = `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${INDEX_NAME} ON inventory_imports ${INDEX_COLS}`;

// SQLite 同构索引（SQLite 端 latestImportsSqlForKeySet 走 WHERE 1=0 分支，
// 但全量 latestImportsSql() 同样受益；且保持双端 schema 对齐）
const SQLITE_ENSURE_SQL = `CREATE INDEX IF NOT EXISTS ${INDEX_NAME} ON inventory_imports ${INDEX_COLS}`;

/**
 * 确保 inventory_imports 的 latest-per-key 复合索引存在。
 * @param {function} run 统一 DB 执行接口。
 * @param {boolean} isPg 是否为 PostgreSQL 驱动。
 */
function ensureInventoryImportsLatestIndex(run, isPg) {
  run(isPg === true ? PG_ENSURE_SQL : SQLITE_ENSURE_SQL);
}

module.exports = {
  ensureInventoryImportsLatestIndex,
  INDEX_NAME,
  INDEX_COLS,
  AUTO_CREATE_MAX_ROWS,
  PG_ENSURE_SQL,
  PG_CONCURRENTLY_SQL,
  SQLITE_ENSURE_SQL
};
