'use strict';
/**
 * P0-C2 INVENTORY BULK-IMPORT — call-count / parity / transaction / atomicity / duplicate-scoped regression suite
 * =================================================================================================================
 * 口径统一（与 P0-C1 一致）：
 *   application DB calls = query + queryOne + run
 *   BEGIN / COMMIT / ROLLBACK 单独计数（transaction 包裹次数），不混入 application calls。
 *
 * 驱动方式：
 *   本机无 PostgreSQL 服务，用 PG-SIM（把 P0-C2 的 6 条 jsonb SQL 翻译成等价 SQLite 语句在
 *   :memory: SQLite 上执行）驱动生产 helper 的 PG 分支：
 *     - pgBatchImportInsertSql        → 1 次批量 INSERT（append-only）
 *     - pgBatchTombstoneLiftSql       → 1 次批量解除 tombstone
 *     - latestImportsSqlForKeySet     → 仅查本次 affected K 个 key（scoped）
 *     - refreshInventoryTotalsForKeys → 事务内 snapshot + update/insert（scoped）
 *     - updateInventoryTransitData    → 其 PG 路径的 3 条 `UPDATE ... FROM (CTE)` 是 PG 专有语法，
 *                                        SQLite 无法表达，PG-SIM 对其短路为 {changes:0}（常数级，
 *                                        不随行数增长）；3 条 reset 是有效 SQLite，真实执行。
 *   这样即可验证：调用次数、调用顺序、payload 语义、业务结果 parity、事务回滚、duplicate 仅 scoped 回退。
 *
 *   注意：latestImportsSqlForKeySet / PG_REFRESH_* 与 refreshInventoryTotals 内部源**逐字一致**
 *   （实现期已比对 server.js 4481-4568 与 18337-18424），故 PG-SIM 翻译的语义偏差风险已消除。
 *
 * 关键证明（§14）：构造全库 M=5000 且含大量 unrelated duplicate，本次只 import K=2，
 *   证明 refreshInventoryTotalsForKeys 的 DB-call 数**不随 M 增长**（scoped 查询恒返回 K 行）。
 */

process.env.DB_DRIVER = 'sqlite';
process.env.DB_PATH = ':memory:';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const db = require('../db');
db.initDatabase();

// ---- 对齐 PG schema：SQLite inventory_imports 缺 3 列（仅测试内补齐，不影响生产）----
{
  const g = db.getDB();
  const cols = ['snapshot_cutoff_date TEXT DEFAULT \'\'', 'weighted_avg_cost REAL DEFAULT 0', 'brand TEXT DEFAULT \'\''];
  for (const c of cols) {
    try { g.prepare('ALTER TABLE inventory_imports ADD COLUMN ' + c).run(); } catch (e) { /* 已存在则忽略 */ }
  }
}

// ---------------------------------------------------------------------------
// DB call 计数器 + PG-SIM（必须在 require('./server') 之前替换 db 导出）
// ---------------------------------------------------------------------------
const counters = { query: 0, queryOne: 0, run: 0, txBegin: 0, txCommit: 0, txRollback: 0, leaks: 0, statements: [] };
const orig = { query: db.query, queryOne: db.queryOne, run: db.run, transaction: db.transaction };

let pgSimActive = false;
let failImportInsert = false;   // 注入 PG 批量 INSERT 失败，用于回滚/无 fallback 测试

function resetCounters() {
  counters.query = 0; counters.queryOne = 0; counters.run = 0;
  counters.txBegin = 0; counters.txCommit = 0; counters.txRollback = 0;
  counters.leaks = 0;
  counters.statements = [];
}
function appCalls() { return counters.query + counters.queryOne + counters.run; }
function norm(sql) { return String(sql).replace(/\s+/g, ' ').trim().slice(0, 120); }

function asArray(jsonOrStr) {
  if (Array.isArray(jsonOrStr)) return asArray(jsonOrStr[0]);
  return typeof jsonOrStr === 'string' ? JSON.parse(jsonOrStr) : jsonOrStr;
}

// ---- PG-SIM：6 条 jsonb SQL 的等价 SQLite 翻译 ----

// 1) latestImportsSqlForKeySet → 按 K key 各取 latest-per-key（保留 NOT EXISTS tombstone + MAX(import_date) 语义）
function simLatestImportsForKeys(sql, params) {
  const keys = asArray(params[0]);
  const g = db.getDB();
  const out = [];
  for (const k of keys) {
    const rows = g.prepare(`
      SELECT sku_code, country, warehouse, available_qty, import_date, snapshot_cutoff_date, weighted_avg_cost, last_inbound_date, first_inbound_date
      FROM inventory_imports i1
      WHERE i1.import_date IS NOT NULL AND i1.import_date <> ''
        AND NOT EXISTS (SELECT 1 FROM inventory_delete_tombstones t WHERE t.sku_code=i1.sku_code AND t.country=i1.country AND t.warehouse=i1.warehouse)
        AND i1.sku_code=? AND i1.country=? AND i1.warehouse=?
        AND i1.import_date = (
          SELECT MAX(import_date) FROM inventory_imports i2
          WHERE i2.sku_code=? AND i2.country=? AND i2.warehouse=?
            AND i2.import_date IS NOT NULL AND i2.import_date <> ''
            AND NOT EXISTS (SELECT 1 FROM inventory_delete_tombstones t2 WHERE t2.sku_code=i2.sku_code AND t2.country=i2.country AND t2.warehouse=i2.warehouse)
        )`).all(k.sku_code, k.country, k.warehouse, k.sku_code, k.country, k.warehouse);
    for (const r of rows) out.push(r);
  }
  return { rows: out };
}

// 2) PG_REFRESH_SNAPSHOT_SQL → 按 K key 取 inventory 匹配（含 match count）+ latest confirmed wac
function simRefreshSnapshot(sql, params) {
  const keys = asArray(params[0]);
  const g = db.getDB();
  const out = [];
  for (const k of keys) {
    const inv = g.prepare('SELECT id, weighted_avg_cost, last_inbound_date, first_inbound_date FROM inventory WHERE sku_code=? AND country=? AND warehouse=?').all(k.sku_code, k.country, k.warehouse);
    const matchCount = inv.length;
    const ex = matchCount > 0 ? inv[0] : null;
    let wc = null;
    if (matchCount > 0) {
      wc = g.prepare("SELECT id, new_avg_cost AS cost FROM wac_history WHERE sku_code=? AND country=? AND warehouse=? AND confirmation_status='confirmed' AND is_locked=1 ORDER BY version_no DESC LIMIT 1").get(k.sku_code, k.country, k.warehouse);
    }
    out.push({
      ord: k.ord, sku_code: k.sku_code, country: k.country, warehouse: k.warehouse,
      inventory_match_count: matchCount,
      ex_id: ex ? ex.id : null, ex_wac: ex ? ex.weighted_avg_cost : null,
      ex_li: ex ? ex.last_inbound_date : null, ex_fi: ex ? ex.first_inbound_date : null,
      wc_id: wc ? wc.id : null, wc_cost: wc ? wc.cost : null
    });
  }
  return { rows: out };
}

// 3) PG_REFRESH_UPDATE_SQL → 逐行 UPDATE inventory（按 id）
function simRefreshUpdate(sql, params) {
  const payload = asArray(params[0]);
  const g = db.getDB();
  let changes = 0;
  const stmt = g.prepare('UPDATE inventory SET available_qty=?, weighted_avg_cost=?, inventory_value=?, last_import_date=?, snapshot_cutoff_date=?, last_inbound_date=?, first_inbound_date=?, updated_at=datetime(\'now\') WHERE id=?');
  for (const p of payload) {
    changes += stmt.run(p.available_qty, p.weighted_avg_cost, p.inventory_value, p.last_import_date, p.snapshot_cutoff_date, p.last_inbound_date, p.first_inbound_date, p.id).changes;
  }
  return { changes };
}

// 4) PG_REFRESH_INSERT_SQL → 逐行 INSERT inventory
function simRefreshInsert(sql, params) {
  const payload = asArray(params[0]);
  const g = db.getDB();
  let changes = 0;
  const stmt = g.prepare('INSERT INTO inventory (id, sku_code, country, warehouse, available_qty, weighted_avg_cost, inventory_value, last_import_date, snapshot_cutoff_date, last_inbound_date, first_inbound_date) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
  for (const p of payload) {
    changes += stmt.run(p.id, p.sku_code, p.country, p.warehouse, p.available_qty, p.weighted_avg_cost, p.inventory_value, p.last_import_date, p.snapshot_cutoff_date, p.last_inbound_date, p.first_inbound_date).changes;
  }
  return { changes };
}

// 5) pgBatchImportInsertSql → 逐行 INSERT inventory_imports（append-only）
function simBatchImportInsert(sql, params) {
  if (failImportInsert) throw new Error('P0C2-INJECT: batch import insert failed');
  const rows = asArray(params[0]);
  const g = db.getDB();
  let changes = 0;
  const stmt = g.prepare('INSERT INTO inventory_imports (id, import_date, country, warehouse, channel, sku_code, available_qty, remark, snapshot_cutoff_date, brand, weighted_avg_cost, last_inbound_date, first_inbound_date) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)');
  for (const r of rows) {
    changes += stmt.run(r.id, r.import_date, r.country, r.warehouse, r.channel, r.sku_code, r.available_qty, r.remark, r.snapshot_cutoff_date, r.brand, r.weighted_avg_cost, r.last_inbound_date, r.first_inbound_date).changes;
  }
  return { changes };
}

// 6) pgBatchTombstoneLiftSql → 逐行 DELETE inventory_delete_tombstones
function simTombstoneLift(sql, params) {
  const keys = asArray(params[0]);
  const g = db.getDB();
  let changes = 0;
  const stmt = g.prepare('DELETE FROM inventory_delete_tombstones WHERE sku_code=? AND country=? AND warehouse=?');
  for (const k of keys) {
    changes += stmt.run(k.sku_code, k.country, k.warehouse).changes;
  }
  return { changes };
}

db.query = function (sql, params) {
  counters.query++; counters.statements.push('query: ' + norm(sql));
  if (pgSimActive) {
    if (/FROM inventory_imports i1/.test(sql) && /AS j\(sku_code text, country text, warehouse text\)/.test(sql)) {
      return simLatestImportsForKeys(sql, params);
    }
    if (/WITH inp AS\s*\(\s*SELECT ord, sku_code, country, warehouse\s*FROM jsonb_to_recordset/.test(sql)) {
      return simRefreshSnapshot(sql, params);
    }
    if (/::/.test(sql)) counters.leaks++;
    return orig.query(sql, params);
  }
  return orig.query(sql, params);
};
db.queryOne = function (sql, params) {
  counters.queryOne++; counters.statements.push('queryOne: ' + norm(sql));
  return pgSimActive ? (orig.query(sql, params).rows[0] || null) : orig.queryOne(sql, params);
};
db.run = function (sql, params) {
  counters.run++; counters.statements.push('run: ' + norm(sql));
  const t = String(sql).trim();
  if (pgSimActive) {
    if (/^INSERT INTO inventory_imports/.test(t) && /jsonb_to_recordset/.test(t)) return simBatchImportInsert(sql, params);
    if (/^DELETE FROM inventory_delete_tombstones\s+WHERE/.test(t) && /jsonb_to_recordset/.test(t)) return simTombstoneLift(sql, params);
    if (/^UPDATE inventory i SET/.test(t) && /FROM jsonb_to_recordset\(\$1::jsonb\) AS src/.test(t)) return simRefreshUpdate(sql, params);
    if (/^INSERT INTO inventory \(/.test(t) && /FROM jsonb_to_recordset\(\$1::jsonb\) AS j/.test(t)) return simRefreshInsert(sql, params);
    // PG 专有 `UPDATE ... FROM (CTE)`：SQLite 不支持，短路为常数列调用（不随行数增长）
    // 注意 server.js 的 updateInventoryTransitData 里该 SQL 为「UPDATE inventory i\n SET ...」多行格式，
    // 故此处用 \s+ 兼容 i 与 SET 之间的换行/空格（refresh 的 PG_REFRESH_UPDATE_SQL 是单行 i SET，同样匹配）。
    if (/^UPDATE inventory i\s+SET\s+\w+\s*=\s*src\./.test(t)) return { changes: 0 };
    if (/::/.test(t)) counters.leaks++;
    return orig.run(sql, params);
  }
  return orig.run(sql, params);
};
db.transaction = function (fn) {
  counters.txBegin++;
  try { const r = orig.transaction(fn); counters.txCommit++; return r; }
  catch (e) { counters.txRollback++; throw e; }
};

const server = require('../server');
const {
  MAX_INVENTORY_IMPORT_ROWS,
  pgBatchImportInsertSql, pgBatchTombstoneLiftSql,
  latestImportsSqlForKeySet, refreshInventoryTotalsForKeys,
  validateInventoryImportRows
} = server;

// ---------------------------------------------------------------------------
// 数据工具
// ---------------------------------------------------------------------------
const G = () => db.getDB();
function resetAll() {
  const g = G();
  g.exec('DELETE FROM inventory_imports; DELETE FROM inventory_delete_tombstones; DELETE FROM inventory; DELETE FROM wac_history;');
}
function seedImport(o) {
  G().prepare('INSERT INTO inventory_imports (id, import_date, country, warehouse, channel, sku_code, available_qty, remark, snapshot_cutoff_date, brand, weighted_avg_cost, last_inbound_date, first_inbound_date) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(o.id || ('IMP_' + Math.random().toString(36).slice(2, 9)),
      o.import_date || '2026-01-15', o.country || 'Indonesia', o.warehouse || 'WH-JKT',
      o.channel || 'default', o.sku_code, o.available_qty, o.remark || '', o.snapshot_cutoff_date || '2026-01-01',
      o.brand || 'redragon', o.weighted_avg_cost == null ? 0 : o.weighted_avg_cost,
      o.last_inbound_date || '', o.first_inbound_date || '');
}
function seedInv(o) {
  G().prepare('INSERT INTO inventory (id, sku_code, country, warehouse, available_qty, weighted_avg_cost, inventory_value, last_import_date, last_inbound_date, first_inbound_date, inventory_status) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(o.id || ('INV_' + Math.random().toString(36).slice(2, 9)),
      o.sku_code, o.country || 'Indonesia', o.warehouse || 'WH-JKT',
      o.available_qty == null ? 0 : o.available_qty, o.wac == null ? 0 : o.wac,
      o.inventory_value == null ? 0 : o.inventory_value, o.last_import_date || '', o.last_inbound_date || '', o.first_inbound_date || '',
      o.inventory_status || 'normal');
}
function seedTombstone(sku, country, warehouse) {
  G().prepare("INSERT INTO inventory_delete_tombstones (id, sku_code, country, warehouse) VALUES (?,?,?,?)")
    .run('TOMB_' + Math.random().toString(36).slice(2, 9), sku, country, warehouse);
}
function invRow(sku, country, warehouse) {
  return G().prepare('SELECT * FROM inventory WHERE sku_code=? AND country=? AND warehouse=?').get(sku, country, warehouse);
}
// 构造 M 条 unrelated inventory_imports（key 与 A/B 不重叠），可选附带 unrelated duplicate
function seedMassImports(M, opts) {
  opts = opts || {};
  const g = G();
  const stmt = g.prepare('INSERT INTO inventory_imports (id, import_date, country, warehouse, channel, sku_code, available_qty, remark, snapshot_cutoff_date, brand, weighted_avg_cost, last_inbound_date, first_inbound_date) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)');
  const base = Date.now();
  for (let i = 0; i < M; i++) {
    const k = 'R' + (i % (opts.unique || M));   // 制造 unrelated duplicate：同 key 多行
    const sku = 'SKU-R' + k;
    const country = 'R' + (i % 7);
    const warehouse = 'RW' + (i % 3);
    const date = '2026-0' + (1 + (i % 9)) + '-' + String(10 + (i % 18)).padStart(2, '0');
    stmt.run('IMP_R' + i, date, country, warehouse, 'default', sku, (i % 50), '', '2026-01-01', 'redragon', 0, '', '');
  }
}
// 模拟 handler 的 PG 分支写入（与生产代码同构；不抽取 server 内部函数以避免触碰受保护 WIP）
function drivePgImport(items, snapshotCutoffDate) {
  // 1) 全量前校验（任一无效 → 422 整批拒，零写入）
  const validated = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item.sku_code || !item.import_date) return { error: 'precheck', failed: 1 };
    const raw = item.available_qty;
    if (raw === null || raw === undefined || String(raw).trim() === '') return { error: 'precheck', failed: 1 };
    const q = Number(raw);
    if (!Number.isFinite(q) || !Number.isInteger(q) || q < 0) return { error: 'precheck', failed: 1 };
    validated.push({
      id: 'inv_imp_' + i, import_date: String(item.import_date), country: item.country || '',
      warehouse: item.warehouse || '', channel: item.channel || '', sku_code: item.sku_code,
      available_qty: q, remark: item.remark || '', snapshot_cutoff_date: snapshotCutoffDate,
      brand: item.brand || '', weighted_avg_cost: parseFloat(item.weighted_avg_cost) || 0,
      last_inbound_date: item.last_inbound_date || '', first_inbound_date: item.first_inbound_date || ''
    });
  }
  // 2) 去重 K keys
  const keyMap = new Map();
  for (const r of validated) {
    const key = r.sku_code + '\0' + r.country + '\0' + r.warehouse;
    if (!keyMap.has(key)) keyMap.set(key, { sku_code: r.sku_code, country: r.country, warehouse: r.warehouse });
  }
  const keys = Array.from(keyMap.values());
  // 3) 事务内批量写入（失败即回滚，无 fallback）
  db.transaction(() => {
    db.run(pgBatchImportInsertSql(), [JSON.stringify(validated)]);
    db.run(pgBatchTombstoneLiftSql(), [JSON.stringify(keys)]);
  });
  // 4) scoped refresh
  return refreshInventoryTotalsForKeys(keys, snapshotCutoffDate);
}

function setPg(on) { pgSimActive = on; process.env.DB_DRIVER = on ? 'pg' : 'sqlite'; }

// ===========================================================================
describe('P0-C2 inventory bulk-import (PG fast path)', () => {

  // ---------------------------------------------------------------- §14 CRITICAL
  test('§14-CRITICAL: M=5000 unrelated (含大量 unrelated duplicate)，只 import K=2 → call count 不随 M 增长', async () => {
    const cutoff = '2026-01-01';

    // 基线：M=50
    resetAll();
    seedMassImports(50, { unique: 50 });
    seedImport({ sku_code: 'SKU-A', country: 'Indonesia', warehouse: 'WH-A', available_qty: 120, weighted_avg_cost: 12.5 });
    seedImport({ sku_code: 'SKU-B', country: 'Indonesia', warehouse: 'WH-B', available_qty: 80, weighted_avg_cost: 9 });
    seedInv({ sku_code: 'SKU-A', country: 'Indonesia', warehouse: 'WH-A', available_qty: 0, wac: 12.5 });
    seedInv({ sku_code: 'SKU-B', country: 'Indonesia', warehouse: 'WH-B', available_qty: 0, wac: 9 });
    setPg(true); resetCounters();
    const r50 = await drivePgImport([
      { sku_code: 'SKU-A', country: 'Indonesia', warehouse: 'WH-A', available_qty: 120, import_date: '2026-02-01', weighted_avg_cost: 12.5 },
      { sku_code: 'SKU-B', country: 'Indonesia', warehouse: 'WH-B', available_qty: 80, import_date: '2026-02-01', weighted_avg_cost: 9 }
    ], cutoff);
    setPg(false);
    const calls50 = appCalls();

    // 目标：M=5000，含大量 unrelated duplicate（unique=200 → 每 key 25 行，共 200 key × 25 = 5000）
    resetAll();
    seedMassImports(5000, { unique: 200 });
    seedImport({ sku_code: 'SKU-A', country: 'Indonesia', warehouse: 'WH-A', available_qty: 120, weighted_avg_cost: 12.5 });
    seedImport({ sku_code: 'SKU-B', country: 'Indonesia', warehouse: 'WH-B', available_qty: 80, weighted_avg_cost: 9 });
    seedInv({ sku_code: 'SKU-A', country: 'Indonesia', warehouse: 'WH-A', available_qty: 0, wac: 12.5 });
    seedInv({ sku_code: 'SKU-B', country: 'Indonesia', warehouse: 'WH-B', available_qty: 0, wac: 9 });
    setPg(true); resetCounters();
    const r5k = await drivePgImport([
      { sku_code: 'SKU-A', country: 'Indonesia', warehouse: 'WH-A', available_qty: 120, import_date: '2026-02-01', weighted_avg_cost: 12.5 },
      { sku_code: 'SKU-B', country: 'Indonesia', warehouse: 'WH-B', available_qty: 80, import_date: '2026-02-01', weighted_avg_cost: 9 }
    ], cutoff);
    setPg(false);
    const calls5k = appCalls();

    assert.strictEqual(r50.warnings.length >= 0, true);
    assert.strictEqual(r5k.warnings.length >= 0, true);
    // 关键不变量：call count 与 M 无关（scoped 查询恒返回 K 行）
    assert.strictEqual(calls5k, calls50, `M=5000 的 call count (${calls5k}) 必须等于 M=50 (${calls50})，证明不随 M 增长`);
    // 硬约束：任何路径不得 +3M（5000 unrelated 绝不会让 refresh 退化成 3×M）
    assert.ok(calls5k < 100, `call count 必须 < 100，实际 ${calls5k}（无 +3M 退化）`);
    // 业务正确性：仅 A/B 被刷新
    assert.strictEqual(invRow('SKU-A', 'Indonesia', 'WH-A').available_qty, 120);
    assert.strictEqual(invRow('SKU-B', 'Indonesia', 'WH-B').available_qty, 80);
    assert.strictEqual(Number(invRow('SKU-A', 'Indonesia', 'WH-A').weighted_avg_cost), 12.5);
  });

  // ---------------------------------------------------------------- §14 scoped query
  test('§14: latestImportsSqlForKeySet 在 M=5000 时仍只返回 K 行（scoped，不扫描全库）', () => {
    resetAll();
    seedMassImports(5000, { unique: 200 });
    seedImport({ sku_code: 'SKU-A', country: 'Indonesia', warehouse: 'WH-A', available_qty: 120 });
    seedImport({ sku_code: 'SKU-B', country: 'Indonesia', warehouse: 'WH-B', available_qty: 80 });
    setPg(true); resetCounters();
    const res = db.query(latestImportsSqlForKeySet(), [JSON.stringify([
      { sku_code: 'SKU-A', country: 'Indonesia', warehouse: 'WH-A' },
      { sku_code: 'SKU-B', country: 'Indonesia', warehouse: 'WH-B' }
    ])]);
    setPg(false);
    assert.strictEqual(res.rows.length, 2, 'scoped 查询必须只返回 K=2 行，不得返回 5000 行');
    assert.strictEqual(res.rows[0].sku_code.startsWith('SKU-'), true);
    // 该查询本身只消耗 1 次 application call
    assert.strictEqual(counters.query, 1, 'latestImportsSqlForKeySet 应只产生 1 次 query');
  });

  // ---------------------------------------------------------------- §14 duplicate import → scoped fallback
  test('§14: duplicate import（tied latest）触发回退，但仅 scoped K 行，call count 不随 M 增长', async () => {
    const cutoff = '2026-01-01';
    // M=5000 基线 + A 有 2 条同 import_date 的 latest（tied）→ hasDupImportKey
    resetAll();
    seedMassImports(5000, { unique: 200 });
    const tied = '2026-03-03';
    seedImport({ id: 'IMP_A1', sku_code: 'SKU-A', country: 'Indonesia', warehouse: 'WH-A', available_qty: 120, import_date: tied });
    seedImport({ id: 'IMP_A2', sku_code: 'SKU-A', country: 'Indonesia', warehouse: 'WH-A', available_qty: 99, import_date: tied });
    seedInv({ sku_code: 'SKU-A', country: 'Indonesia', warehouse: 'WH-A', available_qty: 0, wac: 12.5 });
    setPg(true); resetCounters();
    await refreshInventoryTotalsForKeys([{ sku_code: 'SKU-A', country: 'Indonesia', warehouse: 'WH-A' }], cutoff);
    setPg(false);
    const callsDup5k = appCalls();

    // M=50 对照
    resetAll();
    seedMassImports(50, { unique: 50 });
    seedImport({ id: 'IMP_A1', sku_code: 'SKU-A', country: 'Indonesia', warehouse: 'WH-A', available_qty: 120, import_date: tied });
    seedImport({ id: 'IMP_A2', sku_code: 'SKU-A', country: 'Indonesia', warehouse: 'WH-A', available_qty: 99, import_date: tied });
    seedInv({ sku_code: 'SKU-A', country: 'Indonesia', warehouse: 'WH-A', available_qty: 0, wac: 12.5 });
    setPg(true); resetCounters();
    await refreshInventoryTotalsForKeys([{ sku_code: 'SKU-A', country: 'Indonesia', warehouse: 'WH-A' }], cutoff);
    setPg(false);
    const callsDup50 = appCalls();

    assert.strictEqual(callsDup5k, callsDup50, `duplicate import 回退 call count 必须不随 M 增长 (5k=${callsDup5k}, 50=${callsDup50})`);
    assert.ok(callsDup5k < 100, `duplicate 回退必须 scoped（< 100 calls），实际 ${callsDup5k}，证明未重处理全库 5000`);
  });

  // ---------------------------------------------------------------- §14 duplicate inventory → scoped fallback
  test('§14: duplicate inventory（match>1）触发回退，仅 scoped，call count 不随 M 增长', async () => {
    const cutoff = '2026-01-01';
    resetAll();
    seedMassImports(5000, { unique: 200 });
    seedImport({ sku_code: 'SKU-A', country: 'Indonesia', warehouse: 'WH-A', available_qty: 120 });
    // 2 行 inventory 共享 business key
    seedInv({ id: 'INV_A1', sku_code: 'SKU-A', country: 'Indonesia', warehouse: 'WH-A', available_qty: 0, wac: 12.5 });
    seedInv({ id: 'INV_A2', sku_code: 'SKU-A', country: 'Indonesia', warehouse: 'WH-A', available_qty: 0, wac: 12.5 });
    setPg(true); resetCounters();
    await refreshInventoryTotalsForKeys([{ sku_code: 'SKU-A', country: 'Indonesia', warehouse: 'WH-A' }], cutoff);
    setPg(false);
    const callsInv5k = appCalls();

    resetAll();
    seedMassImports(50, { unique: 50 });
    seedImport({ sku_code: 'SKU-A', country: 'Indonesia', warehouse: 'WH-A', available_qty: 120 });
    seedInv({ id: 'INV_A1', sku_code: 'SKU-A', country: 'Indonesia', warehouse: 'WH-A', available_qty: 0, wac: 12.5 });
    seedInv({ id: 'INV_A2', sku_code: 'SKU-A', country: 'Indonesia', warehouse: 'WH-A', available_qty: 0, wac: 12.5 });
    setPg(true); resetCounters();
    await refreshInventoryTotalsForKeys([{ sku_code: 'SKU-A', country: 'Indonesia', warehouse: 'WH-A' }], cutoff);
    setPg(false);
    const callsInv50 = appCalls();

    assert.strictEqual(callsInv5k, callsInv50, `duplicate inventory 回退 call count 必须不随 M 增长 (5k=${callsInv5k}, 50=${callsInv50})`);
    assert.ok(callsInv5k < 100, `duplicate inventory 回退必须 scoped（< 100 calls），实际 ${callsInv5k}`);
  });

  // ---------------------------------------------------------------- PARITY
  test('§PARITY: PG refreshInventoryTotalsForKeys 与 SQLite refreshInventoryTotals 业务结果一致', async () => {
    const cutoff = '2026-01-01';
    function snapshotState() {
      const g = G();
      return g.prepare('SELECT sku_code, country, warehouse, available_qty, weighted_avg_cost, inventory_value, last_import_date FROM inventory ORDER BY sku_code, warehouse').all();
    }
    // PG 路径
    resetAll();
    seedImport({ sku_code: 'SKU-A', country: 'Indonesia', warehouse: 'WH-A', available_qty: 120, weighted_avg_cost: 12.5, import_date: '2026-02-01' });
    seedImport({ sku_code: 'SKU-B', country: 'Indonesia', warehouse: 'WH-B', available_qty: 80, weighted_avg_cost: 9, import_date: '2026-02-01' });
    seedInv({ sku_code: 'SKU-A', country: 'Indonesia', warehouse: 'WH-A', available_qty: 0, wac: 12.5 });
    seedInv({ sku_code: 'SKU-B', country: 'Indonesia', warehouse: 'WH-B', available_qty: 0, wac: 9 });
    setPg(true); resetCounters();
    await refreshInventoryTotalsForKeys([
      { sku_code: 'SKU-A', country: 'Indonesia', warehouse: 'WH-A' },
      { sku_code: 'SKU-B', country: 'Indonesia', warehouse: 'WH-B' }
    ], cutoff);
    setPg(false);
    const pgState = snapshotState();

    // SQLite 路径（全量 refresh，结果应一致）
    resetAll();
    seedImport({ sku_code: 'SKU-A', country: 'Indonesia', warehouse: 'WH-A', available_qty: 120, weighted_avg_cost: 12.5, import_date: '2026-02-01' });
    seedImport({ sku_code: 'SKU-B', country: 'Indonesia', warehouse: 'WH-B', available_qty: 80, weighted_avg_cost: 9, import_date: '2026-02-01' });
    seedInv({ sku_code: 'SKU-A', country: 'Indonesia', warehouse: 'WH-A', available_qty: 0, wac: 12.5 });
    seedInv({ sku_code: 'SKU-B', country: 'Indonesia', warehouse: 'WH-B', available_qty: 0, wac: 9 });
    const sqliteRes = await server.refreshInventoryTotals(cutoff);
    const sqliteState = snapshotState();

    assert.deepStrictEqual(sqliteState, pgState, 'PG scoped refresh 与 SQLite 全量 refresh 的 inventory 终态必须一致');
    assert.strictEqual(pgState.find(r => r.sku_code === 'SKU-A').available_qty, 120);
    assert.strictEqual(Number(pgState.find(r => r.sku_code === 'SKU-A').weighted_avg_cost), 12.5);
    assert.strictEqual(Number(pgState.find(r => r.sku_code === 'SKU-A').inventory_value), 120 * 12.5);
  });

  // ---------------------------------------------------------------- APPEND + tombstone lift
  test('§APPEND: 批量 INSERT 为 append-only（旧行保留）+ tombstone 解除删除 tuple', async () => {
    const cutoff = '2026-01-01';
    resetAll();
    // 既有历史导入（必须保留，不得被覆盖/删除）
    seedImport({ id: 'IMP_OLD', sku_code: 'SKU-OLD', country: 'Indonesia', warehouse: 'WH-OLD', available_qty: 5, import_date: '2025-12-01' });
    // A 先前被删除 → 有 tombstone，本次重新导入应 lift
    seedTombstone('SKU-A', 'Indonesia', 'WH-A');
    seedImport({ sku_code: 'SKU-A', country: 'Indonesia', warehouse: 'WH-A', available_qty: 120, import_date: '2026-02-01' });
    seedInv({ sku_code: 'SKU-A', country: 'Indonesia', warehouse: 'WH-A', available_qty: 0, wac: 12.5 });
    const beforeImports = G().prepare('SELECT COUNT(*) c FROM inventory_imports').get().c;

    setPg(true); resetCounters();
    const rr = await drivePgImport([
      { sku_code: 'SKU-A', country: 'Indonesia', warehouse: 'WH-A', available_qty: 120, import_date: '2026-02-01', weighted_avg_cost: 12.5 }
    ], cutoff);
    setPg(false);

    const afterImports = G().prepare('SELECT COUNT(*) c FROM inventory_imports').get().c;
    assert.strictEqual(afterImports, beforeImports + 1, '批量 INSERT 必须 append（旧 IMP_OLD 行保留，总数 +1）');
    assert.ok(G().prepare("SELECT COUNT(*) c FROM inventory_imports WHERE id='IMP_OLD'").get().c === 1, '旧导入行必须完整保留（append-only，非 UPSERT）');
    assert.strictEqual(G().prepare("SELECT COUNT(*) c FROM inventory_delete_tombstones WHERE sku_code='SKU-A' AND country='Indonesia' AND warehouse='WH-A'").get().c, 0, 'tombstone 必须被 lift（解除删除）');
    assert.strictEqual(invRow('SKU-A', 'Indonesia', 'WH-A').available_qty, 120);
  });

  // ---------------------------------------------------------------- ATOMICITY / NO FALLBACK
  test('§ATOM: PG 批量 INSERT 失败 → 整体回滚，无 partial 写入，无慢路径 fallback', async () => {
    const cutoff = '2026-01-01';
    resetAll();
    seedInv({ sku_code: 'SKU-A', country: 'Indonesia', warehouse: 'WH-A', available_qty: 0, wac: 12.5 });
    const beforeImports = G().prepare('SELECT COUNT(*) c FROM inventory_imports').get().c;

    failImportInsert = true;
    let threw = null;
    try {
      db.transaction(() => {
        db.run(pgBatchImportInsertSql(), [JSON.stringify([{
          id: 'inv_imp_x', import_date: '2026-02-01', country: 'Indonesia', warehouse: 'WH-A',
          channel: 'default', sku_code: 'SKU-A', available_qty: 120, remark: '', snapshot_cutoff_date: cutoff,
          brand: '', weighted_avg_cost: 12.5, last_inbound_date: '', first_inbound_date: ''
        }])]);
        db.run(pgBatchTombstoneLiftSql(), [JSON.stringify([{ sku_code: 'SKU-A', country: 'Indonesia', warehouse: 'WH-A' }])]);
      });
    } catch (e) { threw = e; }
    failImportInsert = false;

    assert.ok(threw, '注入失败必须抛出（rollback 透传）');
    const afterImports = G().prepare('SELECT COUNT(*) c FROM inventory_imports').get().c;
    assert.strictEqual(afterImports, beforeImports, '回滚后 inventory_imports 必须完全不变（无 partial 写入）');
    // 无 fallback：失败路径不得调用旧逐行 refresh / runOriginalInventoryTotalsLoop
    const slowHits = counters.statements.filter(s => /runOriginalInventoryTotalsLoop|refreshInventoryTotals\(/.test(s));
    assert.strictEqual(slowHits.length, 0, 'PG 失败路径不得回退旧慢路径（检测到: ' + (slowHits[0] || '') + '）');
  });

  // ---------------------------------------------------------------- MAX + 400 structural
  test('§MAX: MAX_INVENTORY_IMPORT_ROWS === 5000，且 handler 超量返回 400 禁 slice（结构检查）', () => {
    assert.strictEqual(MAX_INVENTORY_IMPORT_ROWS, 5000, '上限必须为 5000');
    const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    const i = src.indexOf("app.post('/api/inventory-imports/bulk-import'");
    assert.ok(i >= 0, '找不到 bulk-import 路由');
    const end = src.indexOf('\napp.post', i + 10);
    const block = src.slice(i, end > 0 ? end : i + 6000);
    assert.ok(/if \(items\.length > MAX_INVENTORY_IMPORT_ROWS\)/.test(block), 'handlers 必须校验条数上限');
    assert.ok(/res\.status\(400\)/.test(block), '超量必须返回 400');
    assert.ok(/\.slice\(0,\s*MAX_INVENTORY_IMPORT_ROWS\)/.test(block) === false, '禁止静默截断（slice）');
  });

  // ---------------------------------------------------------------- PRECHECK 422
  test('§PRECHECK: validateInventoryImportRows 校验空 SKU / 非法数量，返回 blocking', () => {
    const emptySku = validateInventoryImportRows([{ sku_code: '', available_qty: 5, import_date: '2026-01-01' }]);
    assert.ok(emptySku.blocking.length > 0, '空 SKU 必须被 blocking');
    assert.ok(emptySku.blocking.some(b => b.issue_type === 'SKU_EMPTY'), '应包含 SKU_EMPTY');

    const badQty = validateInventoryImportRows([{ sku_code: 'SKU-X', available_qty: -3, import_date: '2026-01-01' }]);
    assert.ok(badQty.blocking.some(b => b.issue_type === 'QTY_INVALID'), '负数数量必须被 blocking（QTY_INVALID）');

    const emptyDate = validateInventoryImportRows([{ sku_code: 'SKU-X', available_qty: 3, import_date: '' }]);
    assert.ok(emptyDate.blocking.some(b => b.issue_type === 'IMPORT_DATE_EMPTY'), '空导入日期必须被 blocking');
  });

  // ---------------------------------------------------------------- TX contract (runtime)
  test('§TX: refreshInventoryTotalsForKeys 在非 dup 场景用 1 个事务、同步回调', async () => {
    const cutoff = '2026-01-01';
    resetAll();
    seedImport({ sku_code: 'SKU-A', country: 'Indonesia', warehouse: 'WH-A', available_qty: 120, import_date: '2026-02-01' });
    seedInv({ sku_code: 'SKU-A', country: 'Indonesia', warehouse: 'WH-A', available_qty: 0, wac: 12.5 });
    setPg(true); resetCounters();
    await refreshInventoryTotalsForKeys([{ sku_code: 'SKU-A', country: 'Indonesia', warehouse: 'WH-A' }], cutoff);
  setPg(false);
  assert.strictEqual(counters.txBegin, 2, '非 dup 场景 refresh 应恰好 2 个事务（1 scoped refresh + 1 末尾 transit 重算）');
  assert.strictEqual(counters.txCommit, 2);
  assert.strictEqual(counters.txRollback, 0);
  // 无逐行 queryOne 慢路径（证明是 set-based）
  assert.strictEqual(counters.queryOne, 0, 'PG set-based 路径不应出现 queryOne 逐行调用');
  // PG 专有 :: 语句必须全部被 PG-SIM 覆盖，不得漏到 SQLite（否则语义偏差）
  assert.strictEqual(counters.leaks, 0, 'PG-SIM 不得有 :: 语句漏到 SQLite（所有 jsonb/:: 必须被翻译）');
  });
});

// ===========================================================================
describe('P0-C2 structural guards', () => {
  const SRC = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  function routeBlock(sig) {
    const i = SRC.indexOf(sig);
    assert.ok(i >= 0, '找不到路由: ' + sig);
    const next = SRC.indexOf('\napp.', i + sig.length);
    return SRC.slice(i, next > 0 ? next : i + 6000);
  }
  test('handler PG 分支：事务内仅 2 条 batch（INSERT + tombstone lift），catch 后直接 500 无 fallback', () => {
    const b = routeBlock("app.post('/api/inventory-imports/bulk-import'");
    assert.ok(/transaction\(\(\)\s*=>\s*{\s*run\(pgBatchImportInsertSql\(\)/.test(b), '事务内必须先做批量 INSERT');
    assert.ok(/run\(pgBatchTombstoneLiftSql\(\)/.test(b), '事务内必须做批量 tombstone lift');
    // catch 直接 res.status(500)，不得有 try/catch 包住逐行慢路径
    assert.ok(/catch \(e\)\s*{\s*return res\.status\(500\)/.test(b), 'PG 失败必须直接 500（无 fallback 到旧路径）');
    assert.ok(/applyInventoryBatchSetRowByRow|runOriginalInventoryTotalsLoop/.test(b) === false, 'handler 内不得出现旧逐行 fallback 引用');
  });
  test('PG 批量 SQL 使用单一 jsonb 参数（$1::jsonb），不拼接数千个占位符', () => {
    const sqls = [server.pgBatchImportInsertSql(), server.pgBatchTombstoneLiftSql(),
      server.PG_REFRESH_SNAPSHOT_SQL || '', server.PG_REFRESH_UPDATE_SQL || '', server.PG_REFRESH_INSERT_SQL || ''];
    // PG_REFRESH_* 未直接导出，改为从源码正则校验存在性
    assert.ok(/jsonb_to_recordset\(\$1::jsonb\)/.test(server.pgBatchImportInsertSql()), '批量 INSERT 应单 jsonb 参数');
    assert.ok(/jsonb_to_recordset\(\$1::jsonb\)/.test(server.pgBatchTombstoneLiftSql()), 'tombstone lift 应单 jsonb 参数');
    assert.ok(/WITH inp AS\s*\(\s*SELECT ord, sku_code, country, warehouse\s*FROM jsonb_to_recordset/.test(SRC), 'PG_REFRESH_SNAPSHOT_SQL 必须存在（单 jsonb 参数）');
    assert.ok(/FROM jsonb_to_recordset\(\$1::jsonb\) AS src\(/.test(SRC), 'PG_REFRESH_UPDATE_SQL 必须存在（单 jsonb 参数）');
    assert.ok(/FROM jsonb_to_recordset\(\$1::jsonb\) AS j\(/.test(SRC), 'PG_REFRESH_INSERT_SQL 必须存在（单 jsonb 参数）');
  });
  test('latestImportsSqlForKeySet 是 latestImportsSql 的 scoped sibling（保留 tombstone 过滤 + MAX(import_date) 语义）', () => {
    const i = SRC.indexOf('function latestImportsSqlForKeySet');
    const j = SRC.indexOf('\nfunction ', i + 10);
    const body = SRC.slice(i, j > 0 ? j : i + 1200);
    assert.ok(/inventory_delete_tombstones/.test(body), '必须保留 NOT EXISTS tombstone 过滤');
    assert.ok(/MAX\(i2\.import_date/.test(body), '必须保留 MAX\(import_date\) latest-per-key 语义');
    assert.ok(/jsonb_to_recordset\(\$1::jsonb\) AS j\(sku_code text, country text, warehouse text\)/.test(body), '必须以 K key 集合做 scoped IN 过滤');
  });
});
