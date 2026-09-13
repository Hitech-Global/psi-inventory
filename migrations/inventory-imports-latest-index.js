// BULK-1 — inventory_imports latest-per-key 复合索引迁移（PG 优先，SQLite 同构，隔离、幂等）
//
// 生产大表必须使用 scripts/create-inventory-imports-index-concurrently.cjs 在线建索引。
// 启动期只允许在“索引缺失 + 表规模确认不大”时用普通 CREATE INDEX；
// 同名索引若 INVALID / NOT READY，必须抛错给调用方，绝不能把它当成“索引已就绪”。

const AUTO_CREATE_MAX_ROWS = 250000;
const INDEX_NAME = 'idx_inventory_imports_latest';
const INDEX_COLS = '(sku_code, country, warehouse, import_date)';

// 给运维脚本和测试共用：PostgreSQL 同名目标索引的状态分类。
function classifyPgIndexRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return 'missing';
  const r = rows[0] || {};
  return r.indisvalid === true && r.indisready === true ? 'ready' : 'unhealthy';
}

// PG：幂等启动期守卫。
// 1) ready 索引直接返回；
// 2) INVALID / NOT READY 同名索引直接抛错，避免 IF NOT EXISTS 静默 no-op；
// 3) planner 估计已超阈值时快速抛错，交给 CONCURRENTLY 运维脚本；
// 4) planner 估计未超阈值时再做一次精确 count(*)，防止 stale reltuples 低估大表后误走普通 CREATE INDEX；
// 5) 创建后再次验证 indisvalid + indisready。
const PG_ENSURE_SQL = `DO $bulk1$
DECLARE
  v_reltuples real;
  v_rows bigint;
  v_index_valid boolean;
  v_index_ready boolean;
BEGIN
  SELECT i.indisvalid, i.indisready
    INTO v_index_valid, v_index_ready
  FROM pg_class idx
  JOIN pg_namespace ns ON ns.oid = idx.relnamespace
  JOIN pg_index i ON i.indexrelid = idx.oid
  JOIN pg_class tbl ON tbl.oid = i.indrelid
  WHERE ns.nspname = 'public'
    AND tbl.relname = 'inventory_imports'
    AND idx.relname = '${INDEX_NAME}'
    AND idx.relkind = 'i';

  IF FOUND THEN
    IF COALESCE(v_index_valid, false) AND COALESCE(v_index_ready, false) THEN
      RETURN;
    END IF;
    RAISE EXCEPTION '[BULK-1] 索引 ${INDEX_NAME} 已存在但不可用 (indisvalid=%, indisready=%)。请先用运维脚本/SQL处理 INVALID 索引后重试。',
      v_index_valid, v_index_ready;
  END IF;

  IF to_regclass('public.inventory_imports') IS NULL THEN
    RAISE EXCEPTION '[BULK-1] public.inventory_imports 不存在，无法创建 ${INDEX_NAME}';
  END IF;

  SELECT c.reltuples INTO v_reltuples
  FROM pg_class c
  WHERE c.oid = 'public.inventory_imports'::regclass;

  IF v_reltuples IS NULL THEN
    RAISE EXCEPTION '[BULK-1] 无法读取 inventory_imports 规模，保守拒绝启动期普通 CREATE INDEX';
  END IF;

  IF v_reltuples > ${AUTO_CREATE_MAX_ROWS} THEN
    RAISE EXCEPTION '[BULK-1] inventory_imports planner 估计约 % 行 > %，启动期拒绝普通 CREATE INDEX。请先执行 CREATE INDEX CONCURRENTLY ${INDEX_NAME} ON public.inventory_imports ${INDEX_COLS};',
      v_reltuples, ${AUTO_CREATE_MAX_ROWS};
  END IF;

  -- reltuples 可能陈旧且偏低：在真正拿写锁建索引前做精确复核。
  EXECUTE 'SELECT count(*)::bigint FROM public.inventory_imports' INTO v_rows;
  IF v_rows > ${AUTO_CREATE_MAX_ROWS} THEN
    RAISE EXCEPTION '[BULK-1] inventory_imports 实际 % 行 > %，启动期拒绝普通 CREATE INDEX。请先执行 CREATE INDEX CONCURRENTLY ${INDEX_NAME} ON public.inventory_imports ${INDEX_COLS};',
      v_rows, ${AUTO_CREATE_MAX_ROWS};
  END IF;

  EXECUTE 'CREATE INDEX ${INDEX_NAME} ON public.inventory_imports ${INDEX_COLS}';

  SELECT i.indisvalid, i.indisready
    INTO v_index_valid, v_index_ready
  FROM pg_class idx
  JOIN pg_namespace ns ON ns.oid = idx.relnamespace
  JOIN pg_index i ON i.indexrelid = idx.oid
  JOIN pg_class tbl ON tbl.oid = i.indrelid
  WHERE ns.nspname = 'public'
    AND tbl.relname = 'inventory_imports'
    AND idx.relname = '${INDEX_NAME}'
    AND idx.relkind = 'i';

  IF NOT FOUND OR NOT COALESCE(v_index_valid, false) OR NOT COALESCE(v_index_ready, false) THEN
    RAISE EXCEPTION '[BULK-1] ${INDEX_NAME} 创建后校验失败 (indisvalid=%, indisready=%)',
      v_index_valid, v_index_ready;
  END IF;
END
$bulk1$`;

// 生产/运维用：必须在事务外执行。脚本会在执行前后验证 indisvalid + indisready。
const PG_CONCURRENTLY_SQL = `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${INDEX_NAME} ON public.inventory_imports ${INDEX_COLS}`;

// SQLite 同构索引。
const SQLITE_ENSURE_SQL = `CREATE INDEX IF NOT EXISTS ${INDEX_NAME} ON inventory_imports ${INDEX_COLS}`;

function ensureInventoryImportsLatestIndex(run, isPg) {
  run(isPg === true ? PG_ENSURE_SQL : SQLITE_ENSURE_SQL);
}

module.exports = {
  ensureInventoryImportsLatestIndex,
  classifyPgIndexRows,
  INDEX_NAME,
  INDEX_COLS,
  AUTO_CREATE_MAX_ROWS,
  PG_ENSURE_SQL,
  PG_CONCURRENTLY_SQL,
  SQLITE_ENSURE_SQL
};
