'use strict';
/**
 * Wave 0B — Transit Refresh 原生 async 化 + Replenishment GET 纯读化 回归测试
 * =================================================================================================================
 * 覆盖（对应 Phase 1A 指令 §九/§十/§十一）：
 *   T1  §十一 mutation → refresh → expected transit values fixture（§一 全量依赖矩阵）：
 *        A  CI shipped_qty → in_transit_qty（无 arrived 时全额在途）
 *        B  logistics batch completed + PL items → arrived 抵减 in_transit_qty
 *        C  batch 回退非 completed → in_transit_qty 回升（幂等全量重算语义）
 *        D  CI void(cancelled) → in_transit_qty 回落 0
 *        E  PI pi_confirmed_qty → pi_confirmed_unshipped_qty
 *        F  PI void(cancelled) → pi_confirmed_unshipped_qty 回落 0
 *        G  PO po_qty/transferred_pi_qty → po_unconfirmed_pi_qty
 *        H  PO void(cancelled) → po_unconfirmed_pi_qty 回落 0
 *        I  PI completed → pi_confirmed_unshipped_qty 回落 0
 *   T2  GET /api/replenishment-suggestions 纯读化：0 条 UPDATE inventory、0 事务
 *   T3  静态结构断言：TRANSIT_PG_REFRESH_SQLS 共 6 条（3 清零 + 3 UPDATE...FROM）；
 *        sync PG 分支与 async 版共享同一常量；async 版走 withGenerateClient；
 *        11 个 mutation 调用点已接 updateInventoryTransitDataAsync；GET replenishment 无刷新调用
 *   T4  HTTP 级 hook 验证：POST /api/purchase-orders/:id/void → 200 → 后台 async 刷新
 *        使 po_unconfirmed_pi_qty 最终回落（§十 source mutation → after-commit async transit refresh）
 *   T5  管理员兜底端点：POST /api/admin/refresh-transit（user_manage 权限）→ 200；
 *        无会话 → 401
 *
 * 驱动方式：:memory: SQLite + require('../server')（模块方式）→ app.listen(0) 临时端口 +
 * Node 22 全局 fetch 走真实 HTTP。SQLite 下 updateInventoryTransitDataAsync 转调既有
 * sync 实现（语义恒等）；PG 路径的口径一致性由 T3 共享常量断言保证（同一组 SQL 字节）。
 */

process.env.DB_DRIVER = 'sqlite';
process.env.DB_PATH = ':memory:';
process.env.NODE_ENV = 'test'; // CSRF guard 在 test 环境自动关闭

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const db = require('../db');
db.initDatabase();

// ---------------------------------------------------------------------------
// DB call / transaction 计数器（必须在 require('../server') 之前替换 db 导出）
// ---------------------------------------------------------------------------
const counters = { query: 0, queryOne: 0, run: 0, txBegin: 0, txCommit: 0, txRollback: 0, inventoryUpdateRuns: 0 };
const orig = { query: db.query, queryOne: db.queryOne, run: db.run, transaction: db.transaction };
function resetCounters() {
  counters.query = 0; counters.queryOne = 0; counters.run = 0;
  counters.txBegin = 0; counters.txCommit = 0; counters.txRollback = 0;
  counters.inventoryUpdateRuns = 0;
}

db.query = function (sql, params) { counters.query++; return orig.query(sql, params); };
db.queryOne = function (sql, params) { counters.queryOne++; return orig.queryOne(sql, params); };
db.run = function (sql, params) {
  counters.run++;
  if (/UPDATE\s+inventory/i.test(String(sql))) counters.inventoryUpdateRuns++;
  return orig.run(sql, params);
};
db.transaction = function (fn) {
  counters.txBegin++;
  try { const r = orig.transaction(fn); counters.txCommit++; return r; }
  catch (e) { counters.txRollback++; throw e; }
};

// consignment 两表仅在 require.main === module 时由 server.js 建表（appendConsignmentExclusion
// 依赖 consignment_inventory_lots），测试内复刻同一 DDL（沿用 wave0a 模式）
const G = () => db.getDB();
G().exec(`
  CREATE TABLE IF NOT EXISTS consignment_inventory_lots (
    id TEXT PRIMARY KEY,
    country_name TEXT,
    warehouse_name TEXT NOT NULL,
    customer_name TEXT,
    outbound_no TEXT,
    outbound_date TEXT,
    sku_code TEXT NOT NULL,
    outbound_qty INTEGER,
    sold_qty INTEGER,
    returned_qty INTEGER,
    remaining_qty INTEGER,
    unit_cost NUMERIC(18,4),
    remaining_inventory_value NUMERIC(18,4),
    import_batch_id TEXT NOT NULL,
    source_line_no INTEGER,
    source_type TEXT DEFAULT 'excel',
    status TEXT DEFAULT 'active',
    created_by TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS consignment_inventory_import_batches (
    id TEXT PRIMARY KEY,
    warehouse_name TEXT NOT NULL,
    country_name TEXT,
    original_filename TEXT,
    total_rows INTEGER,
    valid_rows INTEGER,
    error_rows INTEGER,
    customer_count INTEGER,
    sku_count INTEGER,
    total_remaining_qty INTEGER,
    total_remaining_value NUMERIC(18,4),
    status TEXT DEFAULT 'pending',
    created_by TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    activated_at TEXT
  );
`);

const server = require('../server');
const { app, updateInventoryTransitDataAsync, updateInventoryTransitData, TRANSIT_PG_REFRESH_SQLS } = server;

// 对齐生产 schema：SQLite initDatabase 缺列（仅测试内补齐，不影响生产 PG schema；沿用既有测试模式）
for (const stmt of [
  'ALTER TABLE proforma_invoice_items ADD COLUMN discount NUMERIC(18,6) DEFAULT 0',
  'ALTER TABLE commercial_invoices ADD COLUMN original_inventory_imported INTEGER DEFAULT 0'
]) { try { G().prepare(stmt).run(); } catch (e) { /* 已存在则忽略 */ } }

// ---------------------------------------------------------------------------
// 鉴权种子：role + user + session（含 replenishment_view / po_create / user_manage）
// ---------------------------------------------------------------------------
const TOKEN = 'wave0b-test-token';
const TOKEN_HASH = crypto.createHash('sha256').update(TOKEN).digest('hex');
G().prepare(`INSERT OR REPLACE INTO roles (id, name, description, permissions, is_system) VALUES ('role_wave0b', 'Wave0B Test Role', '', ?, 0)`)
  .run(JSON.stringify(['replenishment_view', 'po_create', 'user_manage']));
G().prepare(`INSERT OR REPLACE INTO users (id, username, name, password, role_id, status) VALUES ('user_wave0b', 'wave0b', 'Wave0B Tester', '', 'role_wave0b', 'active')`).run();
G().prepare(`INSERT OR REPLACE INTO sessions (id, token_hash, user_id, created_at, expires_at) VALUES ('sess_wave0b', ?, 'user_wave0b', datetime('now'), datetime('now', '+1 day'))`).run(TOKEN_HASH);

const COOKIE = `session_token=${TOKEN}`;

// ---------------------------------------------------------------------------
// 业务 fixture：inventory 行 + 采购链事实表（每个场景独立 SKU/键，互不干扰）
// ---------------------------------------------------------------------------
const SK = 'ID'; const WH = 'WH-W0B';
function seedInventoryRow(sku) {
  G().prepare(`INSERT OR REPLACE INTO inventory (id, sku_code, country, warehouse, available_qty, in_transit_qty, pi_confirmed_unshipped_qty, po_unconfirmed_pi_qty)
            VALUES (?, ?, ?, ?, 0, 0, 0, 0)`).run([`inv_${sku}`, sku, SK, WH]);
}
function seedSku(sku) {
  G().prepare(`INSERT OR REPLACE INTO skus (id, sku_code, product_name, brand, status) VALUES (?, ?, 'Wave0B Product', 'WaveBrand', 'normal')`).run([`sku_${sku}`, sku]);
}
function seedCI(id, ciNo, sku, shipped, status) {
  G().prepare(`INSERT OR REPLACE INTO commercial_invoices (id, ci_no, ci_date, related_po_id, related_po_no, related_pi_id, related_pi_no, currency, ci_status, country, target_warehouse)
            VALUES (?, ?, '2026-08-01', '', '', '', '', 'USD', ?, ?, ?)`).run([id, ciNo, status || 'uploaded', SK, WH]);
  G().prepare(`INSERT INTO commercial_invoice_items (id, ci_id, ci_no, sku_code, shipped_qty, inbound_qty, ci_amount, unit_price)
            VALUES (?, ?, ?, ?, ?, 0, 0, 0)`).run([`cii_${id}`, id, ciNo, sku, shipped]);
}
function seedBatchWithPL(id, ciId, sku, arrivedQty, lbStatus) {
  G().prepare(`INSERT OR REPLACE INTO logistics_batches (id, batch_no, related_ci_id, related_ci_no, logistics_status, target_country, target_warehouse)
            VALUES (?, ?, ?, ?, ?, ?, ?)`).run([id, 'LOG-' + id, ciId, 'CI-' + ciId, lbStatus, SK, WH]);
  G().prepare(`INSERT OR REPLACE INTO packing_lists (id, pl_no, related_ci_id, related_ci_no, logistics_batch_id, total_qty, status)
            VALUES (?, ?, ?, ?, ?, ?, 'confirmed')`).run(['pl_' + id, 'PL-' + id, ciId, 'CI-' + ciId, id, arrivedQty]);
  G().prepare(`INSERT INTO packing_list_items (id, pl_id, pl_no, ci_no, sku_code, total_qty)
            VALUES (?, ?, ?, ?, ?, ?)`).run(['pli_' + id, 'pl_' + id, 'PL-' + id, 'CI-' + ciId, sku, arrivedQty]);
}
function seedPI(id, piNo, sku, confirmed, shipped, status) {
  G().prepare(`INSERT OR REPLACE INTO proforma_invoices (id, pi_no, pi_date, related_po_id, related_po_no, need_deposit, deposit_ratio, balance_ratio, total_amount, currency, pi_status, deposit_payment_status, country, target_warehouse)
            VALUES (?, ?, '2026-08-01', '', '', 0, 0, 100, 0, 'USD', ?, 'unpaid', ?, ?)`).run([id, piNo, status || 'uploaded', SK, WH]);
  G().prepare(`INSERT INTO proforma_invoice_items (id, pi_id, pi_no, po_no, sku_code, po_qty, pi_confirmed_qty, unit_price, pi_amount, shipped_qty, unshipped_qty)
            VALUES (?, ?, ?, '', ?, 0, ?, 0, 0, ?, ?)`).run([`pii_${id}`, id, piNo, sku, confirmed, shipped, Math.max(0, confirmed - shipped)]);
}
function seedPO(id, poNo, sku, poQty, transferred, status) {
  G().prepare(`INSERT OR REPLACE INTO purchase_orders (id, po_no, po_date, approval_status, po_status, currency, country, target_warehouse)
            VALUES (?, ?, '2026-08-01', 'approved', ?, 'USD', ?, ?)`).run([id, poNo, status || 'draft', SK, WH]);
  G().prepare(`INSERT INTO purchase_order_items (id, po_id, po_no, sku_code, po_qty, unit_price, po_amount, transferred_pi_qty, untransferred_pi_qty)
            VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?)`).run([`poi_${id}`, id, poNo, sku, poQty, transferred, Math.max(0, poQty - transferred)]);
}
function invRow(sku) {
  return db.queryOne('SELECT in_transit_qty, pi_confirmed_unshipped_qty, po_unconfirmed_pi_qty FROM inventory WHERE sku_code = ? AND country = ? AND warehouse = ?', [sku, SK, WH]) || {};
}

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------
async function fetchJSON(method, pathStr, body, extraHeaders) {
  const port = global.__w0bPort;
  const res = await fetch(`http://127.0.0.1:${port}${pathStr}`, {
    method,
    headers: Object.assign({ 'content-type': 'application/json', cookie: COOKIE }, extraHeaders || {}),
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let json = null;
  try { json = await res.json(); } catch (e) { /* HTML 错误页等 */ }
  return { status: res.status, json };
}

// 等待 fire-and-forget 后台刷新完成（SQLite 同步实现：microtask + setImmediate 内完成）
async function waitFor(predicate, label) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return true;
    await new Promise(r => setImmediate(r));
  }
  assert.fail('timeout waiting for: ' + (label || 'condition'));
}

let srv;

before(async () => {
  await new Promise(resolve => {
    srv = app.listen(0, () => { global.__w0bPort = srv.address().port; resolve(); });
  });
});
after(() => { try { srv.close(); } catch (e) {} });

// ---------------------------------------------------------------------------
// T1 §十一 mutation → refresh → expected transit values（全量依赖矩阵）
// ---------------------------------------------------------------------------
describe('T1 §十一 mutation → refresh → expected fixture', () => {
  test('A. CI shipped_qty → in_transit_qty = 100（无 arrived 全额在途）', async () => {
    seedSku('SKU-W0B-A'); seedInventoryRow('SKU-W0B-A');
    seedCI('ci_w0b_a', 'CI-W0B-A', 'SKU-W0B-A', 100);
    await updateInventoryTransitDataAsync();
    assert.equal(invRow('SKU-W0B-A').in_transit_qty, 100);
  });

  test('B. completed batch + PL arrived 40 → in_transit_qty = 60', async () => {
    seedBatchWithPL('lb_w0b_b', 'ci_w0b_a', 'SKU-W0B-A', 40, 'completed');
    await updateInventoryTransitDataAsync();
    assert.equal(invRow('SKU-W0B-A').in_transit_qty, 60);
  });

  test('C. batch 回退 pending → in_transit_qty 回升 100（幂等全量重算）', async () => {
    G().prepare(`UPDATE logistics_batches SET logistics_status = 'pending' WHERE id = 'lb_w0b_b'`).run();
    await updateInventoryTransitDataAsync();
    assert.equal(invRow('SKU-W0B-A').in_transit_qty, 100);
  });

  test('D. CI void(cancelled) → in_transit_qty 回落 0', async () => {
    G().prepare(`UPDATE commercial_invoices SET ci_status = 'cancelled' WHERE id = 'ci_w0b_a'`).run();
    await updateInventoryTransitDataAsync();
    assert.equal(invRow('SKU-W0B-A').in_transit_qty, 0);
  });

  test('E. PI pi_confirmed 50 / shipped 10 → pi_confirmed_unshipped_qty = 40', async () => {
    seedSku('SKU-W0B-E'); seedInventoryRow('SKU-W0B-E');
    seedPI('pi_w0b_e', 'PI-W0B-E', 'SKU-W0B-E', 50, 10);
    await updateInventoryTransitDataAsync();
    assert.equal(invRow('SKU-W0B-E').pi_confirmed_unshipped_qty, 40);
  });

  test('F. PI void(cancelled) → pi_confirmed_unshipped_qty 回落 0', async () => {
    G().prepare(`UPDATE proforma_invoices SET pi_status = 'cancelled' WHERE id = 'pi_w0b_e'`).run();
    await updateInventoryTransitDataAsync();
    assert.equal(invRow('SKU-W0B-E').pi_confirmed_unshipped_qty, 0);
  });

  test('I. PI completed → pi_confirmed_unshipped_qty 回落 0（NOT IN cancelled/completed）', async () => {
    seedSku('SKU-W0B-I'); seedInventoryRow('SKU-W0B-I');
    seedPI('pi_w0b_i', 'PI-W0B-I', 'SKU-W0B-I', 70, 0, 'uploaded');
    await updateInventoryTransitDataAsync();
    assert.equal(invRow('SKU-W0B-I').pi_confirmed_unshipped_qty, 70);
    G().prepare(`UPDATE proforma_invoices SET pi_status = 'completed' WHERE id = 'pi_w0b_i'`).run();
    await updateInventoryTransitDataAsync();
    assert.equal(invRow('SKU-W0B-I').pi_confirmed_unshipped_qty, 0);
  });

  test('G. PO po_qty 80 / transferred 30 → po_unconfirmed_pi_qty = 50', async () => {
    seedSku('SKU-W0B-G'); seedInventoryRow('SKU-W0B-G');
    seedPO('po_w0b_g', 'PO-W0B-G', 'SKU-W0B-G', 80, 30);
    await updateInventoryTransitDataAsync();
    assert.equal(invRow('SKU-W0B-G').po_unconfirmed_pi_qty, 50);
  });

  test('H. PO void(cancelled) → po_unconfirmed_pi_qty 回落 0', async () => {
    G().prepare(`UPDATE purchase_orders SET po_status = 'cancelled' WHERE id = 'po_w0b_g'`).run();
    await updateInventoryTransitDataAsync();
    assert.equal(invRow('SKU-W0B-G').po_unconfirmed_pi_qty, 0);
  });

  test('同键聚合：in_transit 与 po_unconfirmed 并存于同一 inventory 行（三列互不覆盖）', async () => {
    seedSku('SKU-W0B-J'); seedInventoryRow('SKU-W0B-J');
    seedCI('ci_w0b_j', 'CI-W0B-J', 'SKU-W0B-J', 30);
    seedPO('po_w0b_j', 'PO-W0B-J', 'SKU-W0B-J', 40, 0);
    seedPI('pi_w0b_j', 'PI-W0B-J', 'SKU-W0B-J', 20, 0);
    await updateInventoryTransitDataAsync();
    const row = invRow('SKU-W0B-J');
    assert.equal(row.in_transit_qty, 30);
    assert.equal(row.po_unconfirmed_pi_qty, 40);
    assert.equal(row.pi_confirmed_unshipped_qty, 20);
  });
});

// ---------------------------------------------------------------------------
// T2 GET /api/replenishment-suggestions 纯读化：0 UPDATE inventory、0 事务
// ---------------------------------------------------------------------------
describe('T2 GET replenishment 纯读化', () => {
  test('GET → 200 且 0 条 UPDATE inventory、0 事务（自愈调用已移除）', async () => {
    resetCounters();
    const res = await fetchJSON('GET', '/api/replenishment-suggestions');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.json));
    assert.equal(counters.inventoryUpdateRuns, 0, 'GET 期间不得执行任何 UPDATE inventory（6 条 transit 刷新必须全部移除）');
    assert.equal(counters.txBegin, 0, 'GET 期间不得打开事务');
  });
});

// ---------------------------------------------------------------------------
// T3 静态结构断言（PG 口径一致性证明）
// ---------------------------------------------------------------------------
describe('T3 静态结构：共享 SQL 常量 + 调用点接线', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

  test('TRANSIT_PG_REFRESH_SQLS = 6 条：3 清零 + 3 UPDATE...FROM，含 arrived 物理事实口径', () => {
    assert.ok(Array.isArray(TRANSIT_PG_REFRESH_SQLS));
    assert.equal(TRANSIT_PG_REFRESH_SQLS.length, 6);
    assert.equal(TRANSIT_PG_REFRESH_SQLS.filter(s => /^UPDATE inventory SET \w+ = 0\s*$/.test(s.trim())).length, 3, '3 条清零语句');
    assert.equal(TRANSIT_PG_REFRESH_SQLS.filter(s => /UPDATE inventory i\s+SET [\s\S]* FROM \(/.test(s)).length, 3, '3 条 set-based UPDATE...FROM');
    const joined = TRANSIT_PG_REFRESH_SQLS.join('\n');
    assert.match(joined, /logistics_status = 'completed'/, 'arrived 只认 completed 物理事实');
    assert.match(joined, /ci_status NOT IN \('cancelled'\)/, 'shipped 口径排除 cancelled CI');
    assert.match(joined, /pi_status NOT IN \('cancelled', 'completed'\)/, 'PI 口径排除 cancelled/completed');
    assert.match(joined, /po_status NOT IN \('cancelled', 'transferred_pi'\)/, 'PO 口径排除 cancelled/transferred_pi');
  });

  test('sync 版 PG 分支与 async 版共享同一常量（防口径漂移）', () => {
    // sync 函数体内 for...of TRANSIT_PG_REFRESH_SQLS（PG 分支）
    assert.match(src, /for \(const sql of TRANSIT_PG_REFRESH_SQLS\) \{\s*\n\s*run\(sql\);/, 'sync PG 分支循环执行共享常量');
    // async 函数体内 withGenerateClient + for...of 同一常量
    assert.match(src, /async function updateInventoryTransitDataAsync\(\)[\s\S]{0,800}withGenerateClient\(async \(aq, aqOne, arun\) => \{\s*\n\s*for \(const sql of TRANSIT_PG_REFRESH_SQLS\)/, 'async 版走 withGenerateClient 单事务执行共享常量');
    // in_transit 清零 SQL 字面量仅 2 处：常量数组内（PG 双路径共用）+ SQLite 路径（dev 专属）
    const literalCount = (src.match(/UPDATE inventory SET in_transit_qty = 0/g) || []).length;
    assert.equal(literalCount, 2, '清零 SQL 字面量 = 常量数组 1 + SQLite 路径 1');
  });

  test('25 个 mutation/后台调用点已接 updateInventoryTransitDataAsync（生产路径零 sync 桥刷新）', () => {
    const callSites = (src.match(/updateInventoryTransitDataAsync\(\)\.catch/g) || []).length;
    // Wave 1: CI reverse PG 原生分支新增 1 个 after-COMMIT hook（SQLite legacy 分支 hook 不变）
    assert.equal(callSites, 25, 'PO create/put/delete/void, PI create/put/void/batch, CI create/void/batch/reverse(PG 分支+1), CI batch-import(PG 分支+1: Wave 2A), inbound create/batch, logistics put/create/create-with-pl, PL put, historical-CI, refreshInventoryTotals×3');
    // sync 版仅剩：定义本身 + async 版 SQLite 转调 + 注释；任何路由不得直接调用 sync 版
    assert.doesNotMatch(src, /await updateInventoryTransitData\(\)/, '不得有 await sync 版（事件循环冻结）');
  });

  test('GET replenishment-suggestions 路由体内无 transit 刷新调用', () => {
    const m = src.match(/app\.get\('\/api\/replenishment-suggestions'[\s\S]*?\n\}\)\);/);
    assert.ok(m, '路由定义存在');
    assert.doesNotMatch(m[0], /updateInventoryTransitData/, 'GET 体内不得调用任何版本的 transit 刷新');
  });

  test('admin 兜底端点存在且走 async 实现（非 sync bridge）', () => {
    const m = src.match(/app\.post\('\/api\/admin\/refresh-transit'[\s\S]*?\n\}\)\);/);
    assert.ok(m, '端点存在');
    assert.match(m[0], /requireApiPermission\('user_manage'\)/, 'user_manage 权限');
    assert.match(m[0], /await updateInventoryTransitDataAsync\(\)/, 'await async 实现（事件循环不冻结）');
  });
});

// ---------------------------------------------------------------------------
// T4 HTTP 级 hook 验证：PO void → 200 → 后台 async 刷新 → po_unconfirmed_pi_qty 回落
// ---------------------------------------------------------------------------
describe('T4 mutation route → after-commit async refresh（HTTP 级）', () => {
  test('POST /api/purchase-orders/:id/void → 200；后台刷新使 po_unconfirmed_pi_qty 回落 0', async () => {
    seedSku('SKU-W0B-K'); seedInventoryRow('SKU-W0B-K');
    seedPO('po_w0b_k', 'PO-W0B-K', 'SKU-W0B-K', 66, 0);
    await updateInventoryTransitDataAsync();
    assert.equal(invRow('SKU-W0B-K').po_unconfirmed_pi_qty, 66);

    resetCounters();
    const res = await fetchJSON('POST', '/api/purchase-orders/po_w0b_k/void', { void_reason: 'wave0b hook test' });
    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
    // fire-and-forget：响应内不含刷新耗时；轮询等待后台刷新完成
    await waitFor(() => invRow('SKU-W0B-K').po_unconfirmed_pi_qty === 0, 'po_unconfirmed_pi_qty 回落 0');
    assert.equal(invRow('SKU-W0B-K').po_unconfirmed_pi_qty, 0);
  });

  test('GET replenishment 不再触发刷新：PO void 后台刷新仅由 mutation hook 驱动', async () => {
    // 同一 fixture：再次 GET 页面，确认纯读（无 UPDATE inventory）
    resetCounters();
    const res = await fetchJSON('GET', '/api/replenishment-suggestions');
    assert.equal(res.status, 200);
    assert.equal(counters.inventoryUpdateRuns, 0);
  });
});

// ---------------------------------------------------------------------------
// T5 管理员兜底端点
// ---------------------------------------------------------------------------
describe('T5 admin refresh-transit 兜底', () => {
  test('有权限（user_manage）→ 200 success', async () => {
    const res = await fetchJSON('POST', '/api/admin/refresh-transit');
    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
  });

  test('无会话 → 401（不得匿名触发全表重算）', async () => {
    const port = global.__w0bPort;
    const res = await fetch(`http://127.0.0.1:${port}/api/admin/refresh-transit`, { method: 'POST' });
    assert.equal(res.status, 401);
  });
});

// ---------------------------------------------------------------------------
// T6 并发 refresh 最终值收敛（§二 Case C1/C2/C3）
//
// 【诚实标注】本节跑在 SQLite 上。SQLite 的写事务是库级串行（BEGIN IMMEDIATE 之外的
// 情形也由 better-sqlite3 同步执行），因此本节【不能】证明 PostgreSQL 的 row-lock
// 等待行为。本节证明的是较弱但仍有意义的性质：
//   (a) 多个 refresh 并发调用时，最终值收敛到「最新 source facts」；
//   (b) 三列互不覆盖（clear-then-set 全量重算，非增量叠加）；
//   (c) 无异常抛出、无 partial state。
// PostgreSQL 真实 row-lock / READ COMMITTED 新鲜读 / 无死锁的决定性证明在：
//   scripts/wave0b-pg-concurrency.js（真实 PG 16 实例，14/14 PASS）
// ---------------------------------------------------------------------------
describe('T6 并发 refresh 最终值收敛（SQLite；非 PG row-lock 证明，见 scripts/wave0b-pg-concurrency.js）', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

  test('C1 CI shipped 增加 + logistics completed 抵减 → 两个 refresh 并发，最终 = 最新 source facts', async () => {
    const sku = 'SKU-W0B-C1';
    seedSku(sku); seedInventoryRow(sku);
    seedCI('ci_w0b_c1', 'CI-W0B-C1', sku, 100);
    seedBatchWithPL('lb_w0b_c1', 'ci_w0b_c1', sku, 40, 'pending');
    await updateInventoryTransitDataAsync();
    assert.equal(invRow(sku).in_transit_qty, 100, 'baseline: pending 未抵减');

    // mutation A：新增一批 CI 出货 50
    seedCI('ci_w0b_c1b', 'CI-W0B-C1B', sku, 50);
    // mutation B：原 batch completed，抵减 arrived 40  → 期望 100 + 50 - 40 = 110
    G().prepare(`UPDATE logistics_batches SET logistics_status = 'completed' WHERE id = ?`).run(['lb_w0b_c1']);

    const errs = [];
    await Promise.all([
      updateInventoryTransitDataAsync().catch(e => errs.push(e)),
      updateInventoryTransitDataAsync().catch(e => errs.push(e))
    ]);
    assert.deepEqual(errs, [], '并发 refresh 不得抛错');
    assert.equal(invRow(sku).in_transit_qty, 110, '最终 in_transit_qty = 100 + 50 - 40');
  });

  test('C2 PI unshipped + PO unconfirmed 两类来源并发 → 三列全部正确（不只验一列）', async () => {
    const sku = 'SKU-W0B-C2';
    seedSku(sku); seedInventoryRow(sku);
    seedCI('ci_w0b_c2', 'CI-W0B-C2', sku, 70);
    seedBatchWithPL('lb_w0b_c2', 'ci_w0b_c2', sku, 20, 'completed');
    seedPI('pi_w0b_c2', 'PI-W0B-C2', sku, 60, 10);
    seedPO('po_w0b_c2', 'PO-W0B-C2', sku, 90, 30);
    await updateInventoryTransitDataAsync();

    // mutation A：新增 PI 未出货 25 → 50 + 25 = 75
    seedPI('pi_w0b_c2b', 'PI-W0B-C2B', sku, 25, 0);
    // mutation B：新增 PO 未转 PI 15 → 60 + 15 = 75
    seedPO('po_w0b_c2b', 'PO-W0B-C2B', sku, 15, 0);

    const errs = [];
    await Promise.all([
      updateInventoryTransitDataAsync().catch(e => errs.push(e)),
      updateInventoryTransitDataAsync().catch(e => errs.push(e))
    ]);
    assert.deepEqual(errs, [], '并发 refresh 不得抛错');
    const r = invRow(sku);
    assert.equal(r.in_transit_qty, 50, 'in_transit_qty = 70 - 20');
    assert.equal(r.pi_confirmed_unshipped_qty, 75, 'pi_confirmed_unshipped_qty = (60-10) + 25');
    assert.equal(r.po_unconfirmed_pi_qty, 75, 'po_unconfirmed_pi_qty = (90-30) + 15');
  });

  test('C3 Promise.all x3 连续并发 refresh → 无异常、结果一致、与串行重算逐列相同', async () => {
    const sku = 'SKU-W0B-C3';
    seedSku(sku); seedInventoryRow(sku);
    seedCI('ci_w0b_c3', 'CI-W0B-C3', sku, 30);
    seedPI('pi_w0b_c3', 'PI-W0B-C3', sku, 40, 5);
    seedPO('po_w0b_c3', 'PO-W0B-C3', sku, 50, 10);

    const errs = [];
    await Promise.all([
      updateInventoryTransitDataAsync().catch(e => errs.push(e)),
      updateInventoryTransitDataAsync().catch(e => errs.push(e)),
      updateInventoryTransitDataAsync().catch(e => errs.push(e))
    ]);
    assert.deepEqual(errs, [], '3 个并发 refresh 不得抛错');
    const r = invRow(sku);
    assert.equal(r.in_transit_qty, 30);
    assert.equal(r.pi_confirmed_unshipped_qty, 35);
    assert.equal(r.po_unconfirmed_pi_qty, 40);

    await updateInventoryTransitDataAsync();
    const r2 = invRow(sku);
    assert.equal(r2.in_transit_qty, r.in_transit_qty, '幂等：串行重算与并发结果一致');
    assert.equal(r2.pi_confirmed_unshipped_qty, r.pi_confirmed_unshipped_qty, '幂等');
    assert.equal(r2.po_unconfirmed_pi_qty, r.po_unconfirmed_pi_qty, '幂等');
  });

  test('SQL 级性质证明：第 1 条为无 WHERE 全表 UPDATE（PG 下必然获取全表行锁 → 并发 refresh 串行化）', () => {
    const first = TRANSIT_PG_REFRESH_SQLS[0].trim();
    assert.match(first, /^UPDATE inventory SET \w+ = 0$/i, '第 1 条必须是无 WHERE 的全表清零 UPDATE，实际: ' + first);
    assert.doesNotMatch(first, /WHERE/i, '不得带 WHERE，否则无法保证锁住全部 inventory 行');
  });

  test('SQL 级性质证明：6 条中同一列的清零与重算成对出现（clear-then-set，不存在增量叠加）', () => {
    const cols = ['in_transit_qty', 'pi_confirmed_unshipped_qty', 'po_unconfirmed_pi_qty'];
    for (const col of cols) {
      const zeroIdx = TRANSIT_PG_REFRESH_SQLS.findIndex(s => new RegExp('^UPDATE inventory SET ' + col + ' = 0\\s*$', 'i').test(s.trim()));
      const setIdx = TRANSIT_PG_REFRESH_SQLS.findIndex(s => new RegExp('UPDATE inventory i\\s+SET ' + col + ' =', 'i').test(s));
      assert.ok(zeroIdx >= 0, col + ' 缺清零语句');
      assert.ok(setIdx >= 0, col + ' 缺 set-based 重算语句');
      assert.ok(zeroIdx < setIdx, col + ' 清零必须先于重算');
    }
    // 不存在任何 += / = col + 形式的增量叠加
    assert.doesNotMatch(TRANSIT_PG_REFRESH_SQLS.join('\n'), /SET\s+\w+\s*=\s*\w+\s*\+/i, '不得出现增量叠加写法');
  });

  test('fire-and-forget 可观测性：全部 25 个调用点均带 .catch 且非 silent（§三）', () => {
    const fireAndForget = (src.match(/updateInventoryTransitDataAsync\(\)\.catch/g) || []).length;
    assert.equal(fireAndForget, 25, 'fire-and-forget 调用点数量（Wave 1 +1: CI reverse PG 分支; Wave 2A +1: CI batch-import PG 分支）');
    // 不得出现静默吞错的 catch 体：.catch(() => {}) / .catch((e) => { /* ignore */ })
    const silentPatterns = [
      /updateInventoryTransitDataAsync\(\)\.catch\(\(\)\s*=>\s*\{\s*\}\s*\)/,
      /updateInventoryTransitDataAsync\(\)\.catch\(\(e\)\s*=>\s*\{\s*\/\*\s*ignore\s*\*\/\s*\}\s*\)/,
      /updateInventoryTransitDataAsync\(\)\.catch\(\(\)\s*=>\s*\{\s*\/\*[^*]*\*\/\s*\}\s*\)/
    ];
    for (const p of silentPatterns) {
      assert.doesNotMatch(src, p, '存在静默吞错的 fire-and-forget catch：' + p);
    }
    // 每个 catch 分支必须落 console.warn/console.error
    const consoleLogs = (src.match(/updateInventoryTransitDataAsync\(\)\.catch[\s\S]{0,220}?console\.(warn|error)/g) || []).length;
    assert.equal(consoleLogs, 25, '每个 .catch 分支都必须有 console.warn/error（可观测；Wave 1 +1; Wave 2A +1）');
  });

  // 用真实 AST 判定（正则无法做括号匹配，会把「事务已闭合之后再刷新」误判为违规）
  test('after-COMMIT 静态证明（AST）：25 个调用点无一位于 transaction() 回调内（§五）', () => {
    const acorn = require('acorn');
    const ast = acorn.parse(src, { ecmaVersion: 2022, sourceType: 'script', locations: true });
    const HTTP = new Set(['get', 'post', 'put', 'delete', 'patch']);
    const routeOf = (n) => {
      if (n.type !== 'CallExpression') return null;
      const c = n.callee;
      if (c.type !== 'MemberExpression' || c.property.type !== 'Identifier') return null;
      if (!HTTP.has(c.property.name) || c.object.type !== 'Identifier') return null;
      const a = n.arguments[0];
      if (!a || a.type !== 'Literal' || typeof a.value !== 'string') return null;
      return c.property.name.toUpperCase() + ' ' + a.value;
    };
    const isTx = (n) => n.type === 'CallExpression' && n.callee.type === 'Identifier' && n.callee.name === 'transaction';

    const sites = [];
    (function walk(n, stack) {
      if (!n || typeof n.type !== 'string') return;
      const next = (isTx(n) || routeOf(n)) ? stack.concat([n]) : stack;
      if (n.type === 'CallExpression' && n.callee.type === 'Identifier' && n.callee.name === 'updateInventoryTransitDataAsync') {
        const route = [...next].reverse().find(routeOf);
        const tx = [...next].reverse().find(isTx);
        sites.push({ line: n.loc.start.line, route: route ? routeOf(route) : '(module-level helper)', insideTx: !!tx, txLine: tx ? tx.loc.start.line : null });
      }
      for (const k of Object.keys(n)) {
        if (k === 'parent' || k === 'loc') continue;
        const v = n[k];
        if (Array.isArray(v)) v.forEach((ch) => { if (ch && typeof ch.type === 'string') { ch.parent = n; walk(ch, next); } });
        else if (v && typeof v.type === 'string') { v.parent = n; walk(v, next); }
      }
    })(ast, []);

    assert.equal(sites.length, 26, '调用点总数 = 25 fire-and-forget（Wave 1 +1: CI reverse PG; Wave 2A +1: CI batch-import PG）+ 1 admin await');
    const inside = sites.filter((s) => s.insideTx);
    assert.deepEqual(inside, [], '不得存在「事务仍打开 → 触发 refresh」的调用点：' + JSON.stringify(inside));

    // 事务型 mutation 的分类输出：route → COMMIT → refresh（每个事务型 route 的 refresh 必须在事务外）
    const txRoutes = sites.filter((s) => s.route !== '(module-level helper)');
    assert.ok(txRoutes.length >= 19, '路由级调用点数量应 >= 19，实际 ' + txRoutes.length);
    // 每个路由内：refresh 调用行号必须 > 该路由内最后一个 transaction 的起始行
    for (const s of sites) {
      assert.equal(s.insideTx, false, 'L' + s.line + ' (' + s.route + ') 位于事务内');
    }
  });

  test('admin 兜底端点：user_manage 权限 + await async 实现 + 不经过 sync bridge（§六）', () => {
    const m = src.match(/app\.post\('\/api\/admin\/refresh-transit'[\s\S]{0,400}/);
    assert.ok(m, 'admin 端点存在');
    assert.match(m[0], /requireApiPermission\('user_manage'\)/, '权限必须为 user_manage');
    assert.match(m[0], /await updateInventoryTransitDataAsync\(\)/, '必须 await async 实现（非 sync bridge）');
    assert.doesNotMatch(m[0], /updateInventoryTransitData\(\)/, '不得调用 sync 版');
  });

  test('§四：不得重新引入 transit_refresh_warning 响应字段', () => {
    // 仅禁止「代码里真的出现」，注释中的历史说明不算
    assert.doesNotMatch(src, /transit_refresh_warning\s*:/, 'response 不得再携带 transit_refresh_warning 字段');
    assert.doesNotMatch(src, /transitRefreshWarning/, '不得再声明/赋值 transitRefreshWarning 变量');
    const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
    assert.doesNotMatch(appSrc, /transit_refresh_warning/, 'app.js 不得消费 transit_refresh_warning（确认零消费）');
  });
});
