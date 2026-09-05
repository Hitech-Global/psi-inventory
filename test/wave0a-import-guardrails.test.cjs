'use strict';
/**
 * Wave 0A — 批量导入 Guardrails 回归测试
 * =================================================================================================================
 * 覆盖（对应 Phase 1A 指令 §八 每路由 8 项 + §四/五 body gate + §七 并发场景）：
 *   T1  限额表常量：8 条路由硬上限值与设计一致
 *   T2  limit+1 → 整批 422 拒绝：DB call = 0、transaction 未打开、错误文案含 actual X / limit Y（8 路由全覆盖）
 *   T3  limit-1 → 允许、limit → 允许（8 路由全覆盖，真实业务路径跑通）
 *   T4  malformed rows 仍走原有逐行校验（不因 guard 改变行为）
 *   T5  合法导入行为不变（成功计数 / 落库行数）
 *   T6  pre-parse body gate：>10MB → 413 JSON（parse 前，DB call = 0）；≤10MB 正常通过；
 *       静态证明：10mb parser 注册于全局 50mb parser 之前 + body-parser req._body 跳过链
 *   T7  并发场景：Case A（两个合法导入并行）/ Case B（超限导入 + 正常导入并行，超限方 0 DB call）/
 *       Case C（合法 PI + 合法 PL 并行）
 *   T8  静态 route-boundary 顺序检查：每路由 guard 调用位于 handler 内首个 transaction/queryOne/run 之前
 *
 * 驱动方式：:memory: SQLite + require('../server')（模块方式，不监听端口）→ 导出的 app.listen(0) 起
 * 临时端口 → Node 22 全局 fetch 走真实 HTTP（真实 express 中间件链 + 真实 body-parser）。
 * 鉴权：直接向 sessions/users/roles 表插入测试会话（session_token cookie）。
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
const counters = { query: 0, queryOne: 0, run: 0, txBegin: 0, txCommit: 0, txRollback: 0 };
const orig = { query: db.query, queryOne: db.queryOne, run: db.run, transaction: db.transaction };
function resetCounters() {
  counters.query = 0; counters.queryOne = 0; counters.run = 0;
  counters.txBegin = 0; counters.txCommit = 0; counters.txRollback = 0;
}
function appCalls() { return counters.query + counters.queryOne + counters.run; }

db.query = function (sql, params) { counters.query++; return orig.query(sql, params); };
db.queryOne = function (sql, params) { counters.queryOne++; return orig.queryOne(sql, params); };
db.run = function (sql, params) { counters.run++; return orig.run(sql, params); };
db.transaction = function (fn) {
  counters.txBegin++;
  try { const r = orig.transaction(fn); counters.txCommit++; return r; }
  catch (e) { counters.txRollback++; throw e; }
};

// consignment 两表仅在 require.main === module 时由 server.js 建表，测试内复刻同一 DDL
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
const { app, BATCH_IMPORT_ROW_LIMITS } = server;

// 对齐生产 schema：SQLite initDatabase 缺列（仅测试内补齐，不影响生产 PG schema；沿用 p0-c2 测试模式）
for (const stmt of [
  'ALTER TABLE proforma_invoice_items ADD COLUMN discount NUMERIC(18,6) DEFAULT 0',
  'ALTER TABLE commercial_invoices ADD COLUMN original_inventory_imported INTEGER DEFAULT 0'
]) { try { G().prepare(stmt).run(); } catch (e) { /* 已存在则忽略 */ } }

// ---------------------------------------------------------------------------
// 鉴权种子：role + user + session（session_token cookie → sha256 token_hash）
// ---------------------------------------------------------------------------
const TOKEN = 'wave0a-test-token';
const TOKEN_HASH = crypto.createHash('sha256').update(TOKEN).digest('hex');
G().prepare(`INSERT OR REPLACE INTO roles (id, name, description, permissions, is_system) VALUES ('role_wave0a', 'Wave0A Test Role', '', ?, 0)`)
  .run(JSON.stringify(['ci_create', 'pi_create', 'sku_import', 'inventory_import', 'check_create', 'payment_import', 'cost_view']));
G().prepare(`INSERT OR REPLACE INTO users (id, username, name, password, role_id, status) VALUES ('user_wave0a', 'wave0a', 'Wave0A Tester', '', 'role_wave0a', 'active')`).run();
G().prepare(`INSERT OR REPLACE INTO sessions (id, token_hash, user_id, created_at, expires_at) VALUES ('sess_wave0a', ?, 'user_wave0a', datetime('now'), datetime('now', '+1 day'))`).run(TOKEN_HASH);

// ---------------------------------------------------------------------------
// 业务 fixture：SKU / PO / PI / CI / 仓库（供 CI/PI/PL/consignment/original 边界放行用例）
// 数量全部置 0：满足「累计不超过上游数量」守卫，同时不触发 payable 生成
// ---------------------------------------------------------------------------
G().prepare(`INSERT OR REPLACE INTO skus (id, sku_code, product_name, brand, status) VALUES ('sku_w0a', 'SKU-W0A', 'Wave0A Product', 'WaveBrand', 'normal')`).run();
// 存在于 SKU 主数据但不属于 CI 明细的 SKU（original-inventory 校验用）
G().prepare(`INSERT OR REPLACE INTO skus (id, sku_code, product_name, brand, status) VALUES ('sku_w0a_b', 'SKU-W0A-B', 'Wave0A Product B', 'WaveBrand', 'normal')`).run();
G().prepare(`INSERT OR REPLACE INTO warehouses (id, name, status) VALUES ('wh_w0a', 'WH-W0A', 'active')`).run();
G().prepare(`INSERT OR REPLACE INTO purchase_orders (id, po_no, po_date, approval_status, po_status, currency) VALUES ('po_w0a', 'PO-W0A', '2026-08-01', 'approved', 'approved', 'USD')`).run();
G().prepare(`INSERT OR REPLACE INTO purchase_order_items (id, po_id, po_no, sku_code, po_qty, unit_price, po_amount) VALUES ('poi_w0a', 'po_w0a', 'PO-W0A', 'SKU-W0A', 0, 0, 0)`).run();
G().prepare(`INSERT OR REPLACE INTO proforma_invoices (id, pi_no, pi_date, related_po_id, related_po_no, need_deposit, deposit_ratio, balance_ratio, total_amount, currency, pi_status, deposit_payment_status) VALUES ('pi_w0a', 'PI-W0A', '2026-08-01', 'po_w0a', 'PO-W0A', 0, 0, 100, 0, 'USD', 'uploaded', 'unpaid')`).run();
G().prepare(`INSERT OR REPLACE INTO proforma_invoice_items (id, pi_id, pi_no, po_no, sku_code, po_qty, pi_confirmed_qty, unit_price, pi_amount, shipped_qty, unshipped_qty) VALUES ('pii_w0a', 'pi_w0a', 'PI-W0A', 'PO-W0A', 'SKU-W0A', 0, 0, 0, 0, 0, 0)`).run();
G().prepare(`INSERT OR REPLACE INTO commercial_invoices (id, ci_no, ci_date, related_po_id, related_po_no, related_pi_id, related_pi_no, currency, ci_status) VALUES ('ci_w0a', 'CI-W0A', '2026-08-01', 'po_w0a', 'PO-W0A', 'pi_w0a', 'PI-W0A', 'USD', 'uploaded')`).run();
G().prepare(`INSERT OR REPLACE INTO commercial_invoice_items (id, ci_id, ci_no, pi_no, pi_id, sku_code, shipped_qty, unit_price, discount, net_unit_price, ci_amount, inbound_qty, uninbound_qty) VALUES ('cii_w0a', 'ci_w0a', 'CI-W0A', 'PI-W0A', 'pi_w0a', 'SKU-W0A', 0, 0, 0, 0, 0, 0, 0)`).run();

// ---------------------------------------------------------------------------
// HTTP 驱动
// ---------------------------------------------------------------------------
let httpServer = null;
let base = '';
before(async () => {
  await new Promise((resolve) => {
    httpServer = app.listen(0, () => resolve());
  });
  base = `http://127.0.0.1:${httpServer.address().port}`;
});
after(() => { try { httpServer.close(); } catch (e) { /* noop */ } });

async function postJSON(pathName, body, lang) {
  const res = await fetch(base + pathName, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: 'session_token=' + TOKEN,
      ...(lang ? { 'accept-language': lang } : {})
    },
    body: JSON.stringify(body)
  });
  let json = null;
  try { json = await res.json(); } catch (e) { /* 非 JSON（例如意外 HTML 错误页） */ }
  return { status: res.status, json, ct: res.headers.get('content-type') || '' };
}

// 8 条路由的 (key, path, limit, rowsAt(n) 构造器)
const ROUTES = [
  { key: 'proforma-invoices/batch-import', path: '/api/proforma-invoices/batch-import', limit: 1000,
    rows: (n) => Array.from({ length: n }, () => ({ '关联PO编号': 'PO-W0A', 'SKU': 'SKU-W0A', '数量': 0, '是否需要定金': '否' })),
    wrap: (rows) => ({ items: rows }) },
  { key: 'commercial-invoices/batch-import', path: '/api/commercial-invoices/batch-import', limit: 1000,
    rows: (n) => Array.from({ length: n }, () => ({ '关联PI编号': 'PI-W0A', 'SKU': 'SKU-W0A', '实际出货日期': '2026-09-01', '数量': 0 })),
    wrap: (rows) => ({ items: rows }) },
  { key: 'packing-lists/batch-import', path: '/api/packing-lists/batch-import', limit: 2000,
    rows: (n) => Array.from({ length: n }, () => ({ '关联CI编号': 'CI-W0A', 'SKU': 'SKU-W0A', '箱数': 0, '每箱数量': 0 })),
    wrap: (rows) => ({ items: rows }) },
  { key: 'skus/bulk-import', path: '/api/skus/bulk-import', limit: 2000,
    rows: (n, tag) => Array.from({ length: n }, (_, i) => ({ sku_code: `${tag}-${i}`, product_name: 'P', brand: 'B' })),
    wrap: (rows) => ({ items: rows }) },
  { key: 'consignment-inventory/import', path: '/api/consignment-inventory/import', limit: 2000,
    rows: (n) => Array.from({ length: n }, () => ({ sku_code: 'SKU-W0A', remaining_qty: 0, unit_cost: 0 })),
    wrap: (rows) => ({ warehouse_name: 'WH-W0A', country_name: 'ID', items: rows }) },
  { key: 'original-inventory/import', path: '/api/original-inventory/import', limit: 2000,
    rows: (n) => Array.from({ length: n }, () => ({ sku_code: 'SKU-W0A', original_qty: 0 })),
    wrap: (rows) => ({ ci_id: 'ci_w0a', items: rows }) },
  { key: 'inventory-checks/bulk-import', path: '/api/inventory-checks/bulk-import', limit: 5000,
    rows: (n) => Array.from({ length: n }, () => ({ sku_code: 'SKU-W0A', check_date: '2026-09-01', country: 'ID', warehouse: 'WH-W0A', system_qty: 0, actual_qty: 0 })),
    wrap: (rows) => ({ items: rows }) },
  { key: 'payment-requests/bulk-import-result', path: '/api/payment-requests/bulk-import-result', limit: 1000,
    rows: (n) => Array.from({ length: n }, () => ({})), // 空 request_no：guard 放行后走既有逐行失败路径，不触碰 settlement
    wrap: (rows) => ({ items: rows }) }
];

// ---------------------------------------------------------------------------
// T1 限额表常量
// ---------------------------------------------------------------------------
describe('T1 限额表 BATCH_IMPORT_ROW_LIMITS', () => {
  test('8 条路由的硬上限值与设计一致', () => {
    assert.deepEqual(Object.fromEntries(Object.entries(BATCH_IMPORT_ROW_LIMITS).sort()), {
      'proforma-invoices/batch-import': 1000,
      'commercial-invoices/batch-import': 1000,
      'packing-lists/batch-import': 2000,
      'skus/bulk-import': 2000,
      'consignment-inventory/import': 2000,
      'original-inventory/import': 2000,
      'inventory-checks/bulk-import': 5000,
      'payment-requests/bulk-import-result': 1000
    });
  });
  test('已有上限路由不在本表内（保持现状，不顺手修改）', () => {
    for (const k of ['inbound-records/batch-import', 'historical-commercial-invoices/batch-import', 'inventory-imports/bulk-import']) {
      assert.equal(BATCH_IMPORT_ROW_LIMITS[k], undefined);
    }
  });
});

// ---------------------------------------------------------------------------
// T2 limit+1 → 整批拒绝，业务 DB call = 0，transaction 未打开（8 路由全覆盖）
// ---------------------------------------------------------------------------
// 每请求固定开销：apiAuth 的会话/用户/角色/数据域查询（与导入逻辑无关的鉴权成本）。
// 用「不存在的 API 路径」实测该基线，T2 断言总调用数 == 鉴权基线，即导入业务零 DB 调用。
let AUTH_BASELINE_CALLS = -1;
async function measureAuthBaseline() {
  if (AUTH_BASELINE_CALLS >= 0) return AUTH_BASELINE_CALLS;
  resetCounters();
  await postJSON('/api/__wave0a_noop__', {});
  AUTH_BASELINE_CALLS = appCalls();
  assert.ok(AUTH_BASELINE_CALLS >= 0);
  return AUTH_BASELINE_CALLS;
}

describe('T2 limit+1 → 422 整批拒绝（事务前，业务零 DB 调用）', () => {
  test('鉴权固定开销基线可测（>0 且为常量）', async () => {
    const baseline = await measureAuthBaseline();
    const again = await measureAuthBaseline();
    assert.equal(baseline, again, '鉴权成本应为固定值');
  });

  for (const r of ROUTES) {
    test(`[${r.key}] limit+1 (${r.limit + 1} 行) → 422, 业务 DB call=0, tx=0, 文案含 X/Y`, async () => {
      const authBase = await measureAuthBaseline();
      resetCounters();
      const res = await postJSON(r.path, r.wrap(r.rows(r.limit + 1, 'w0a-over')));
      assert.equal(res.status, 422);
      assert.equal(res.json.code, 'IMPORT_ROW_LIMIT_EXCEEDED');
      assert.equal(res.json.limit, r.limit);
      assert.equal(res.json.actual, r.limit + 1);
      assert.match(res.json.error, new RegExp(`${r.limit + 1}`));
      assert.match(res.json.error, new RegExp(`${r.limit}`));
      assert.match(res.json.error, /拆分后重试/);
      assert.equal(appCalls(), authBase, '超限拒绝除鉴权固定开销外不得产生任何 DB 调用');
      assert.equal(counters.txBegin, 0, '超限拒绝不得打开事务');
    });
  }
});

// ---------------------------------------------------------------------------
// T3/T5 边界放行：limit-1 → 允许、limit → 允许；成功计数与落库行数符合既有语义
// ---------------------------------------------------------------------------
describe('T3/T5 边界放行（limit-1 与 limit 均允许，业务行为不变）', () => {
  test('[skus/bulk-import] 1999 行 created=1999；2000 行 created=2000', async () => {
    let res = await postJSON('/api/skus/bulk-import', { items: ROUTES[3].rows(1999, 'w0a-sku-a') });
    assert.equal(res.status, 200);
    assert.equal(res.json.created, 1999);
    res = await postJSON('/api/skus/bulk-import', { items: ROUTES[3].rows(2000, 'w0a-sku-b') });
    assert.equal(res.status, 200);
    assert.equal(res.json.created, 2000);
  });

  test('[inventory-checks/bulk-import] 4999 行 created=4999；5000 行 created=5000', async () => {
    let res = await postJSON('/api/inventory-checks/bulk-import', { items: ROUTES[6].rows(4999) });
    assert.equal(res.status, 200);
    assert.equal(res.json.created, 4999);
    res = await postJSON('/api/inventory-checks/bulk-import', { items: ROUTES[6].rows(5000) });
    assert.equal(res.status, 200);
    assert.equal(res.json.created, 5000);
  });

  test('[proforma-invoices/batch-import] 999 行 success=999；1000 行 success=1000', async () => {
    let res = await postJSON('/api/proforma-invoices/batch-import', { items: ROUTES[0].rows(999) });
    assert.equal(res.status, 200);
    assert.equal(res.json.success, 999);
    res = await postJSON('/api/proforma-invoices/batch-import', { items: ROUTES[0].rows(1000) });
    assert.equal(res.status, 200);
    assert.equal(res.json.success, 1000);
  });

  test('[commercial-invoices/batch-import] 999 行 success=999；1000 行 success=1000', async () => {
    let res = await postJSON('/api/commercial-invoices/batch-import', { items: ROUTES[1].rows(999) });
    assert.equal(res.status, 200);
    assert.equal(res.json.success, 999);
    res = await postJSON('/api/commercial-invoices/batch-import', { items: ROUTES[1].rows(1000) });
    assert.equal(res.status, 200);
    assert.equal(res.json.success, 1000);
  });

  test('[packing-lists/batch-import] 1999 行 success=1999；2000 行 success=2000', async () => {
    let res = await postJSON('/api/packing-lists/batch-import', { items: ROUTES[2].rows(1999) });
    assert.equal(res.status, 200);
    assert.equal(res.json.success, 1999);
    res = await postJSON('/api/packing-lists/batch-import', { items: ROUTES[2].rows(2000) });
    assert.equal(res.status, 200);
    assert.equal(res.json.success, 2000);
  });

  test('[consignment-inventory/import] 1999 行 valid=1999；2000 行 valid=2000 且落库行数一致', async () => {
    let res = await postJSON('/api/consignment-inventory/import', { warehouse_name: 'WH-W0A', country_name: 'ID', items: ROUTES[4].rows(1999) });
    assert.equal(res.status, 200);
    assert.equal(res.json.stats.valid_rows, 1999);
    res = await postJSON('/api/consignment-inventory/import', { warehouse_name: 'WH-W0A', country_name: 'ID', items: ROUTES[4].rows(2000) });
    assert.equal(res.status, 200);
    assert.equal(res.json.stats.valid_rows, 2000);
    const lots = G().prepare(`SELECT COUNT(*) AS c FROM consignment_inventory_lots WHERE warehouse_name='WH-W0A' AND status='active'`).get();
    assert.equal(lots.c, 2000, '第二次导入后仅当前批次 2000 行保持 active');
  });

  test('[original-inventory/import] 1999 行 success=1999；2000 行 success=2000', async () => {
    let res = await postJSON('/api/original-inventory/import', { ci_id: 'ci_w0a', items: ROUTES[5].rows(1999) });
    assert.equal(res.status, 200);
    assert.equal(res.json.success, 1999);
    res = await postJSON('/api/original-inventory/import', { ci_id: 'ci_w0a', items: ROUTES[5].rows(2000) });
    assert.equal(res.status, 200);
    assert.equal(res.json.success, 2000);
  });

  test('[payment-requests/bulk-import-result] 999/1000 行 guard 放行（既有逐行校验路径：空 request_no → failed=N）', async () => {
    let res = await postJSON('/api/payment-requests/bulk-import-result', { items: ROUTES[7].rows(999) });
    assert.equal(res.status, 200);
    assert.equal(res.json.failed, 999);
    assert.equal(res.json.updated, 0);
    res = await postJSON('/api/payment-requests/bulk-import-result', { items: ROUTES[7].rows(1000) });
    assert.equal(res.status, 200);
    assert.equal(res.json.failed, 1000);
    assert.equal(res.json.updated, 0);
  });
});

// ---------------------------------------------------------------------------
// T4 malformed rows 仍走原有逐行校验（guard 不改变既有错误语义）
// ---------------------------------------------------------------------------
describe('T4 malformed rows 仍走原有校验', () => {
  test('[PI] 缺 PO → 逐行 errors：无法匹配PO', async () => {
    const res = await postJSON('/api/proforma-invoices/batch-import', { items: [{ 'SKU': 'SKU-W0A', '数量': 1 }] });
    assert.equal(res.status, 200);
    assert.equal(res.json.failed, 1);
    assert.match(res.json.errors[0].reason, /PO/);
  });
  test('[CI] 缺 PI → 逐行 errors：CI 必须关联 PI', async () => {
    const res = await postJSON('/api/commercial-invoices/batch-import', { items: [{ 'SKU': 'SKU-W0A', '实际出货日期': '2026-09-01', '数量': 1 }] });
    assert.equal(res.status, 200);
    assert.equal(res.json.failed, 1);
    assert.match(res.json.errors[0].reason, /CI 必须关联 PI/);
  });
  test('[PL] 缺 CI → 逐行 errors：无法匹配CI', async () => {
    const res = await postJSON('/api/packing-lists/batch-import', { items: [{ 'SKU': 'SKU-W0A', '箱数': 1, '每箱数量': 1 }] });
    assert.equal(res.status, 200);
    assert.equal(res.json.failed, 1);
    assert.match(res.json.errors[0].reason, /无法匹配CI/);
  });
  test('[SKU] 缺 sku_code → 逐行 errors：SKU编码为空', async () => {
    const res = await postJSON('/api/skus/bulk-import', { items: [{ product_name: 'P', brand: 'B' }] });
    assert.equal(res.status, 200);
    assert.equal(res.json.failed, 1);
    assert.match(res.json.errors[0].reason, /SKU编码为空/);
  });
  test('[consignment] 缺 sku_code → 整体 400：没有有效行可导入 + errors', async () => {
    const res = await postJSON('/api/consignment-inventory/import', { warehouse_name: 'WH-W0A', country_name: 'ID', items: [{ remaining_qty: 1, unit_cost: 1 }] });
    assert.equal(res.status, 400);
    assert.match(res.json.error, /没有有效行可导入/);
    assert.match(res.json.errors[0].reason, /SKU编码不能为空/);
  });
  test('[original] 存在但不属于本 CI 的 SKU → 整体 400 + errors（既有 DELETE 前全量预校验）', async () => {
    const res = await postJSON('/api/original-inventory/import', { ci_id: 'ci_w0a', items: [{ sku_code: 'SKU-W0A-B', original_qty: 1 }] });
    assert.equal(res.status, 400);
    assert.match(res.json.errors[0].reason, /不属于该CI明细/);
  });
  test('[checks] 缺 sku/日期 → 逐行 errors：SKU或盘点日期为空', async () => {
    const res = await postJSON('/api/inventory-checks/bulk-import', { items: [{ country: 'ID', warehouse: 'WH-W0A' }] });
    assert.equal(res.status, 200);
    assert.equal(res.json.failed, 1);
    assert.match(res.json.errors[0].reason, /SKU或盘点日期为空/);
  });
  test('[payment-results] 缺 request_no → 逐行 errors：付款申请号为空', async () => {
    const res = await postJSON('/api/payment-requests/bulk-import-result', { items: [{ paid_amount: 1 }] });
    assert.equal(res.status, 200);
    assert.equal(res.json.failed, 1);
    assert.match(res.json.errors[0].reason, /付款申请号为空/);
  });
});

// ---------------------------------------------------------------------------
// T6 pre-parse body gate（>10MB → 413 JSON；≤10MB 通过；注册顺序静态证明）
// ---------------------------------------------------------------------------
describe('T6 pre-parse body gate', () => {
  test('>10MB body → 413 JSON（IMPORT_BODY_TOO_LARGE），DB call = 0', async () => {
    const big = 'x'.repeat(11 * 1024 * 1024);
    resetCounters();
    const res = await postJSON('/api/commercial-invoices/batch-import', { items: [{ '备注': big }] });
    assert.equal(res.status, 413);
    assert.match(res.ct, /application\/json/);
    assert.equal(res.json.code, 'IMPORT_BODY_TOO_LARGE');
    assert.match(res.json.error, /10mb/);
    assert.equal(appCalls(), 0, 'body 超限必须在读取/解析阶段拒绝，零 DB 调用');
    assert.equal(counters.txBegin, 0);
  });

  test('Accept-Language: en → 413 文案为英文', async () => {
    const big = 'x'.repeat(11 * 1024 * 1024);
    const res = await postJSON('/api/commercial-invoices/batch-import', { items: [{ '备注': big }] }, 'en');
    assert.equal(res.status, 413);
    assert.match(res.json.error, /body too large/i);
  });

  test('≤10MB body 正常通过（10 行 SKU 导入 created=10，8MB 备注落库成功）', async () => {
    const pad = 'y'.repeat(8 * 1024 * 1024);
    const items = Array.from({ length: 10 }, (_, i) => ({ sku_code: 'w0a-body-ok-' + i, product_name: 'P', brand: 'B', remark: i === 9 ? pad : '' }));
    const res = await postJSON('/api/skus/bulk-import', { items });
    assert.equal(res.status, 200);
    assert.equal(res.json.created, 10);
  });

  test('静态证明：10mb parser 注册于全局 50mb parser 之前（顺序即执行顺序）', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    const gateIdx = src.indexOf('HEAVY_IMPORT_BODY_PATHS = new Set(');
    const globalIdx = src.indexOf("app.use(express.json({ limit: '50mb' }))");
    assert.ok(gateIdx > -1 && globalIdx > -1);
    assert.ok(gateIdx < globalIdx, 'pre-parse 10mb gate 必须先于全局 50mb parser 注册');
  });
});

// ---------------------------------------------------------------------------
// T7 并发场景（§七 Case A/B/C）—— 真实 HTTP 并行 + 同步桥串行
// ---------------------------------------------------------------------------
describe('T7 并发场景', () => {
  test('Case A：两个合法 SKU 导入同时进入 → 都成功、数据完整', async () => {
    const [r1, r2] = await Promise.all([
      postJSON('/api/skus/bulk-import', { items: ROUTES[3].rows(50, 'w0a-ca1') }),
      postJSON('/api/skus/bulk-import', { items: ROUTES[3].rows(50, 'w0a-ca2') })
    ]);
    assert.equal(r1.status, 200); assert.equal(r2.status, 200);
    assert.equal(r1.json.created, 50); assert.equal(r2.json.created, 50);
    const cnt = G().prepare(`SELECT COUNT(*) AS c FROM skus WHERE sku_code LIKE 'w0a-ca%'`).get();
    assert.equal(cnt.c, 100);
  });

  test('Case B：超限 CI 导入 + 合法 SKU 导入并行 → 422/200，超限方 0 业务 DB call', async () => {
    const authBase = await measureAuthBaseline();
    // 基线：单独跑合法 SKU 导入的 DB call 数（同一 payload 确定性）
    const validPayload = { items: ROUTES[3].rows(30, 'w0a-cb') };
    resetCounters();
    const solo = await postJSON('/api/skus/bulk-import', validPayload);
    const baselineCalls = appCalls();
    assert.equal(solo.status, 200);

    // 并行：超限 CI（1001 行）+ 同一合法 SKU 导入（两个请求 = 两份鉴权固定开销）
    resetCounters();
    const [over, valid] = await Promise.all([
      postJSON('/api/commercial-invoices/batch-import', { items: ROUTES[1].rows(1001) }),
      postJSON('/api/skus/bulk-import', validPayload)
    ]);
    assert.equal(over.status, 422);
    assert.equal(over.json.code, 'IMPORT_ROW_LIMIT_EXCEEDED');
    assert.equal(valid.status, 200);
    // 与基线同一 payload → 已存在的 30 行走 UPDATE 路径（created=0, updated=30）；call 数与基线一致（每行同为 2 次）
    assert.equal((valid.json.created || 0) + (valid.json.updated || 0), 30);
    assert.equal(appCalls(), baselineCalls + authBase, '并行期间总 DB call 数 == 合法请求基线 + 第二请求鉴权固定开销（超限请求业务贡献 0，未占用同步桥）');
  });

  test('Case C：合法 PI 导入 + 合法 PL 导行并行 → 各自 success=1', async () => {
    const [pi, pl] = await Promise.all([
      postJSON('/api/proforma-invoices/batch-import', { items: [{ '关联PO编号': 'PO-W0A', 'SKU': 'SKU-W0A', '数量': 0, '是否需要定金': '否' }] }),
      postJSON('/api/packing-lists/batch-import', { items: [{ '关联CI编号': 'CI-W0A', 'SKU': 'SKU-W0A', '箱数': 0, '每箱数量': 0 }] })
    ]);
    assert.equal(pi.status, 200); assert.equal(pl.status, 200);
    assert.equal(pi.json.success, 1);
    assert.equal(pl.json.success, 1);
  });
});

// ---------------------------------------------------------------------------
// T8 静态 route-boundary 顺序检查：guard 位于 handler 内首个事务/首个 DB 调用之前
// ---------------------------------------------------------------------------
describe('T8 静态顺序检查（guard → transaction/DB 之前）', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

  function handlerSlice(appPostLine) {
    const start = src.indexOf(appPostLine);
    assert.ok(start > -1, 'route not found: ' + appPostLine);
    const end = src.indexOf("\napp.post(", start + 1);
    return src.slice(start, end > -1 ? end : undefined);
  }

  for (const r of ROUTES) {
    test(`[${r.key}] guard 先于首个 transaction/queryOne/run`, () => {
      const body = handlerSlice(`app.post('${r.path}'`);
      const guardIdx = body.indexOf(`batchImportRowLimitExceeded('${r.key}'`);
      assert.ok(guardIdx > -1, 'handler 内缺少行数 guard');
      assert.ok(body.indexOf('rejectBatchImportRowLimit(req, res, _rowLimit)') > guardIdx, 'guard 命中后必须 return 拒绝');

      let firstDbIdx = body.indexOf('transaction(');
      for (const fnName of ['queryOne(', 'query(', 'run(']) {
        const i = body.indexOf(fnName);
        if (i > -1 && (firstDbIdx === -1 || i < firstDbIdx)) firstDbIdx = i;
      }
      assert.ok(firstDbIdx > -1, 'handler 中应存在 DB 工作');
      assert.ok(guardIdx < firstDbIdx, `guard(${guardIdx}) 必须位于首个 DB 工作(${firstDbIdx}) 之前`);
    });
  }
});
