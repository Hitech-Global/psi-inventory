'use strict';

/**
 * PAY-MUTABILITY shared-helper 债务收口测试（S1/S2/S3）
 * ============================================================================
 * 锁定 server.js 三处「终态静默 no-op」修复后的行为：
 *
 *   S1  PUT /api/proforma-invoices/:id
 *       deposit 应付已进入付款流程（reserved/partially_paid/paid）且本次编辑会改变
 *       定金金额 → 409 拒绝整次编辑，零 mutation。
 *
 *   S2  POST /api/proforma-invoices/batch-import
 *       deposit 应付终态 + 本行导入会改变定金金额 → 该行 failed，零 mutation
 *       （预检早于本行任何 mutation，与 Wave 2A partial-success / C4 零 mutation 标准一致）；
 *       金额完全一致 → 放行直通（NO_CHANGE 语义）。
 *
 *   S3  POST /api/commercial-invoices/batch-import（SQLite legacy 分支）
 *       balance payable（identity=pi_id+ci_id）非 active → 该行 failed，零 mutation，
 *       与 PG 侧 wave2a 模块 2b-2 阶段同一语义同一文案（双架构 parity）。
 *
 * 数据库：:memory: SQLite（db.initDatabase() 建全量真实 schema），不触碰任何生产/本地 data/*.db。
 * 红线：仅新增本测试文件；不改 db*.js / app.js / wave2a 模块；不 commit / 不 push / 不 deploy。
 */

process.env.DB_DRIVER = 'sqlite';
process.env.DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { query, queryOne, run } = require('../db');

// 必须在 require('./server') 之前初始化全量真实 schema。
// 注意：本套件刻意不做任何 schema 补丁 —— S3 用例与 seedPi 直接使用
// proforma_invoice_items.discount，全新 :memory: 库若缺该列（db-sqlite.js
// 初始化顺序回归）将在此处立即失败，作为该修复的常驻回归守卫。
require('../db').initDatabase();

// 真实 express app（require 不会起服务：app.listen 在 require.main 守卫内）
const { app } = require('../server');

// ---------------------------------------------------------------------------
// 鉴权种子（复制 pay-multi.test.cjs 模式）
// ---------------------------------------------------------------------------
let AUTH_TOKEN = null;
function seedAuth() {
  run("INSERT OR REPLACE INTO roles (id, name, permissions) VALUES ('role_mut','Ops','[\"pi_create\",\"pi_edit\",\"ci_create\",\"ci_view\",\"pi_view\"]')");
  run("INSERT OR REPLACE INTO users (id, username, name, role_id, status) VALUES ('u_mut','mutops','MutOps','role_mut','active')");
  AUTH_TOKEN = 'test-session-token-' + crypto.randomBytes(8).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(AUTH_TOKEN).digest('hex');
  run("INSERT OR REPLACE INTO sessions (id, token_hash, user_id, created_at, expires_at) VALUES ('s_mut', ?, 'u_mut', datetime('now'), '2099-12-31 23:59:59')", [tokenHash]);
}
seedAuth();

// ---------------------------------------------------------------------------
// HTTP 驱动（单例 server）
// ---------------------------------------------------------------------------
let SRV = null;
function getBase() {
  if (!SRV) SRV = app.listen(0);
  return 'http://127.0.0.1:' + SRV.address().port;
}
async function api(method, pathname, payload) {
  const res = await fetch(getBase() + pathname, {
    method,
    headers: { 'Content-Type': 'application/json', 'Cookie': `session_token=${AUTH_TOKEN}` },
    body: payload ? JSON.stringify(payload) : undefined
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

// ---------------------------------------------------------------------------
// 数据工具
// ---------------------------------------------------------------------------
function uid(p) { return p + '_' + Math.random().toString(36).slice(2, 9); }

const MUT_TABLES = [
  'payable_items', 'proforma_invoice_items', 'proforma_invoices',
  'commercial_invoice_items', 'commercial_invoices',
  'purchase_order_items', 'purchase_orders', 'skus'
];
function resetData() {
  for (const t of MUT_TABLES) run(`DELETE FROM ${t}`);
}
function countRows(t, where, params) { return query(`SELECT COUNT(*) AS n FROM ${t} ${where || ''}`, params || []).rows[0].n; }

function seedSku(code) {
  run('INSERT INTO skus (id, sku_code, product_name, status) VALUES (?, ?, ?, ?)', [uid('sku'), code, '测试SKU', 'normal']);
}

function seedPo(sku, poNo, opts = {}) {
  const poId = uid('po');
  run(`INSERT INTO purchase_orders (id, po_no, supplier_id, supplier_name, po_date, currency, total_amount, po_status, approval_status)
       VALUES (?, ?, 'sup1', '供应商A', '2026-08-01', 'USD', ?, 'transferred_pi', 'approved')`,
    [poId, poNo, (opts.poQty || 500) * (opts.price || 1)]);
  run(`INSERT INTO purchase_order_items (id, po_id, po_no, sku_code, po_qty, unit_price, po_amount, transferred_pi_qty, untransferred_pi_qty)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    [uid('poi'), poId, poNo, sku, opts.poQty || 500, opts.price || 1, (opts.poQty || 500) * (opts.price || 1), opts.poQty || 500]);
  return poId;
}

function seedPi(poId, poNo, sku, piNo, opts = {}) {
  const piId = uid('pi');
  const qty = opts.qty !== undefined ? opts.qty : 100;
  const price = opts.price !== undefined ? opts.price : 1;
  const total = opts.total !== undefined ? opts.total : qty * price;
  const ratio = opts.ratio || 0;
  const deposit = opts.needDeposit ? total * ratio / 100 : 0;
  run(`INSERT INTO proforma_invoices (id, pi_no, related_po_id, related_po_no, supplier_id, supplier_name, pi_date, currency, total_amount, need_deposit, deposit_ratio, balance_ratio, payable_deposit, available_deduct_deposit, pi_status)
       VALUES (?, ?, ?, ?, 'sup1', '供应商A', '2026-08-01', 'USD', ?, ?, ?, ?, ?, ?, 'uploaded')`,
    [piId, piNo, poId, poNo, total, opts.needDeposit ? 1 : 0, ratio, 100 - ratio, deposit, deposit]);
  run(`INSERT INTO proforma_invoice_items (id, pi_id, pi_no, po_no, sku_code, po_qty, pi_confirmed_qty, unit_price, discount, pi_amount, shipped_qty, unshipped_qty)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0, ?)`,
    [uid('piitem'), piId, piNo, poNo, sku, opts.poQty || 500, qty, price, qty * price, qty]);
  return piId;
}

function seedCi(piId, piNo, poId, poNo, ciNo, sku, opts = {}) {
  const ciId = uid('ci');
  const qty = opts.qty !== undefined ? opts.qty : 10;
  const price = opts.price !== undefined ? opts.price : 10;
  run(`INSERT INTO commercial_invoices (id, ci_no, related_po_id, related_po_no, related_pi_id, related_pi_no, ci_date, currency, goods_amount, ci_status)
       VALUES (?, ?, ?, ?, ?, ?, '2026-08-10', 'USD', ?, 'uploaded')`,
    [ciId, ciNo, poId, poNo, piId, piNo, qty * price]);
  run(`INSERT INTO commercial_invoice_items (id, ci_id, ci_no, pi_no, pi_id, sku_code, shipped_qty, unit_price, discount, net_unit_price, ci_amount, actual_customs_rate, inbound_qty, uninbound_qty)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, NULL, 0, ?)`,
    [uid('cii'), ciId, ciNo, piNo, piId, sku, qty, price, price, qty * price, qty]);
  return ciId;
}

function seedPayable(opts) {
  const id = opts.id || uid('pay');
  run(`INSERT INTO payable_items
        (id, fee_no, source_type, source_id, source_no, source_ci_id, fee_type, category_code,
         subcategory_code, payee_type, payee_key, payee_name_snapshot, payer_entity_key,
         payer_name_snapshot, currency, payable_amount_minor, is_active, lifecycle_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'self', '', ?, ?, ?, ?)`,
    [id, 'PAY-' + id, opts.sourceType, opts.sourceId, opts.sourceNo || '', opts.sourceCiId || '', opts.feeType,
      opts.categoryCode !== undefined ? opts.categoryCode : 'goods',
      opts.subcategoryCode !== undefined ? opts.subcategoryCode : '',
      'factory', opts.payeeKey || 'supplier:sup1', '供应商A',
      opts.currency || 'USD', opts.amountMinor,
      opts.isActive !== undefined ? opts.isActive : 1, opts.lifecycle]);
  return id;
}

function readPayable(id) { return queryOne('SELECT * FROM payable_items WHERE id = ?', [id]); }

// 进程确定性退出：关闭单例 server（否则事件循环被 listen 句柄占住）
after(() => {
  try { if (SRV) SRV.close(() => {}); } catch (e) { /* ignore */ }
});

// ===========================================================================
// S2：POST /api/proforma-invoices/batch-import（deposit 终态行级拒绝 / NO_CHANGE 直通）
// ===========================================================================

test('S2-A: deposit payable partially_paid + 金额变化 → 行级拒绝，零 mutation', async () => {
  resetData();
  const sku = 'SKU-MUT2A';
  seedSku(sku);
  const poNo = 'PO-M2A', piNo = 'PI-M2A';
  const poId = seedPo(sku, poNo);
  const piId = seedPi(poId, poNo, sku, piNo, { needDeposit: true, ratio: 30, qty: 100, price: 1 });
  const payId = seedPayable({ sourceType: 'pi', sourceId: piId, sourceNo: piNo, feeType: 'deposit', amountMinor: 3000, lifecycle: 'partially_paid' });

  // 本行新增 item 100 → 新总额 200 → 新定金 60 ≠ 30 → 拒绝
  const r = await api('POST', '/api/proforma-invoices/batch-import', {
    items: [{ '关联PO编号': poNo, 'PI编号': piNo, 'SKU': sku, '数量': 100, '单价': 1, '定金比例': 30 }]
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.success, 0, '该行必须 failed');
  assert.equal(r.body.failed, 1);
  assert.match(String(r.body.errors[0].reason), /partially_paid/);
  assert.match(String(r.body.errors[0].reason), /定金应付已进入付款流程/);

  // 零 mutation 断言
  assert.equal(countRows('proforma_invoice_items', 'WHERE pi_id = ?', [piId]), 1, 'PI 明细数不变');
  const pi = queryOne('SELECT * FROM proforma_invoices WHERE id = ?', [piId]);
  assert.equal(Number(pi.total_amount), 100, 'PI 总额不变');
  assert.equal(Number(pi.payable_deposit), 30, 'PI 定金字段不变');
  const poItem = queryOne('SELECT * FROM purchase_order_items WHERE po_id = ?', [poId]);
  assert.equal(poItem.transferred_pi_qty, 0, 'PO transferred_pi_qty 不变');
  const po = queryOne('SELECT * FROM purchase_orders WHERE id = ?', [poId]);
  assert.equal(po.po_status, 'transferred_pi', 'PO 状态不变');
  const pay = readPayable(payId);
  assert.equal(pay.lifecycle_status, 'partially_paid', 'payable 状态不变');
  assert.equal(Number(pay.payable_amount_minor), 3000, 'payable 金额不变');
});

test('S2-B: deposit payable partially_paid + 金额完全一致 → 放行直通（NO_CHANGE）', async () => {
  resetData();
  const sku = 'SKU-MUT2B';
  seedSku(sku);
  const poNo = 'PO-M2B', piNo = 'PI-M2B';
  const poId = seedPo(sku, poNo);
  const piId = seedPi(poId, poNo, sku, piNo, { needDeposit: true, ratio: 30, qty: 100, price: 1 });
  const payId = seedPayable({ sourceType: 'pi', sourceId: piId, sourceNo: piNo, feeType: 'deposit', amountMinor: 3000, lifecycle: 'partially_paid' });

  // 行内带定金比例 15：新总额 200 × 15% = 30 = 现有 payable 金额 → 放行
  const r = await api('POST', '/api/proforma-invoices/batch-import', {
    items: [{ '关联PO编号': poNo, 'PI编号': piNo, 'SKU': sku, '数量': 100, '单价': 1, '定金比例': 15 }]
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.success, 1, '金额一致放行');
  assert.equal(r.body.failed, 0);

  // 明细照常导入，payable 不被触碰
  assert.equal(countRows('proforma_invoice_items', 'WHERE pi_id = ?', [piId]), 2, '新明细已导入');
  const pay = readPayable(payId);
  assert.equal(pay.lifecycle_status, 'partially_paid', 'payable 状态不变');
  assert.equal(Number(pay.payable_amount_minor), 3000, 'payable 金额不变');
  assert.equal(countRows('payable_items', 'WHERE source_id = ? AND fee_type = ?', [piId, 'deposit']), 1, '无第二条 deposit payable');
});

test('S2-C: deposit payable active + 金额变化 → 照常同步（authoritative control）', async () => {
  resetData();
  const sku = 'SKU-MUT2C';
  seedSku(sku);
  const poNo = 'PO-M2C', piNo = 'PI-M2C';
  const poId = seedPo(sku, poNo);
  const piId = seedPi(poId, poNo, sku, piNo, { needDeposit: true, ratio: 30, qty: 100, price: 1 });
  const payId = seedPayable({ sourceType: 'pi', sourceId: piId, sourceNo: piNo, feeType: 'deposit', amountMinor: 3000, lifecycle: 'active' });

  const r = await api('POST', '/api/proforma-invoices/batch-import', {
    items: [{ '关联PO编号': poNo, 'PI编号': piNo, 'SKU': sku, '数量': 100, '单价': 1, '定金比例': 30 }]
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.success, 1, 'active 仍放行');
  const pay = readPayable(payId);
  assert.equal(pay.lifecycle_status, 'active');
  assert.equal(Number(pay.payable_amount_minor), 6000, 'active 金额同步到 60.00');
});

// ===========================================================================
// S1：PUT /api/proforma-invoices/:id（deposit 终态 + 金额变化 → 409 整次拒绝）
// ===========================================================================

test('S1-A: deposit payable partially_paid + 编辑改变定金 → 409，零 mutation', async () => {
  resetData();
  const sku = 'SKU-MUT1A';
  seedSku(sku);
  const poNo = 'PO-M1A', piNo = 'PI-M1A';
  const poId = seedPo(sku, poNo);
  const piId = seedPi(poId, poNo, sku, piNo, { needDeposit: true, ratio: 30, qty: 100, price: 1 });
  const payId = seedPayable({ sourceType: 'pi', sourceId: piId, sourceNo: piNo, feeType: 'deposit', amountMinor: 3000, lifecycle: 'partially_paid' });

  // 编辑明细：100×1 → 200×1 → 新定金 60 ≠ 30 → 409
  const r = await api('PUT', '/api/proforma-invoices/' + piId, {
    items: [{ sku_code: sku, pi_confirmed_qty: 200, unit_price: 1, discount: 0 }]
  });
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(r.body.locked, true);
  assert.equal(r.body.field, 'deposit');
  assert.equal(r.body.lifecycle_status, 'partially_paid');
  assert.match(String(r.body.error), /定金应付已进入付款流程/);

  // 零 mutation 断言
  assert.equal(countRows('proforma_invoice_items', 'WHERE pi_id = ?', [piId]), 1, '明细未被替换');
  const item = queryOne('SELECT * FROM proforma_invoice_items WHERE pi_id = ?', [piId]);
  assert.equal(Number(item.pi_amount), 100, '明细金额不变');
  const pi = queryOne('SELECT * FROM proforma_invoices WHERE id = ?', [piId]);
  assert.equal(Number(pi.total_amount), 100, 'PI 总额不变');
  const pay = readPayable(payId);
  assert.equal(pay.lifecycle_status, 'partially_paid');
  assert.equal(Number(pay.payable_amount_minor), 3000, 'payable 金额不变');
});

test('S1-B: deposit payable active + 编辑改变定金 → 200 照常同步（authoritative control）', async () => {
  resetData();
  const sku = 'SKU-MUT1B';
  seedSku(sku);
  const poNo = 'PO-M1B', piNo = 'PI-M1B';
  const poId = seedPo(sku, poNo);
  const piId = seedPi(poId, poNo, sku, piNo, { needDeposit: true, ratio: 30, qty: 100, price: 1 });
  const payId = seedPayable({ sourceType: 'pi', sourceId: piId, sourceNo: piNo, feeType: 'deposit', amountMinor: 3000, lifecycle: 'active' });

  const r = await api('PUT', '/api/proforma-invoices/' + piId, {
    items: [{ sku_code: sku, pi_confirmed_qty: 200, unit_price: 1, discount: 0 }]
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const pay = readPayable(payId);
  assert.equal(pay.lifecycle_status, 'active');
  assert.equal(Number(pay.payable_amount_minor), 6000, 'active 金额同步到 60.00');
  const pi = queryOne('SELECT * FROM proforma_invoices WHERE id = ?', [piId]);
  assert.equal(Number(pi.total_amount), 200);
  assert.equal(Number(pi.payable_deposit), 60);
});

// ===========================================================================
// S3：POST /api/commercial-invoices/batch-import（SQLite 分支与 Wave 2A PG 分支 parity）
// ===========================================================================

test('S3-A: balance payable partially_paid + 重导同 CI → 行级拒绝，零 mutation', async () => {
  resetData();
  const sku = 'SKU-MUT3A';
  seedSku(sku);
  const poNo = 'PO-M3A', piNo = 'PI-M3A', ciNo = 'CI-M3A';
  const poId = seedPo(sku, poNo);
  const piId = seedPi(poId, poNo, sku, piNo, { needDeposit: false, qty: 100, price: 10 });
  const ciId = seedCi(piId, piNo, poId, poNo, ciNo, sku, { qty: 10, price: 10 });
  const payId = seedPayable({ sourceType: 'pi', sourceId: piId, sourceNo: piNo, sourceCiId: ciId, feeType: 'balance', amountMinor: 10000, lifecycle: 'partially_paid' });

  const r = await api('POST', '/api/commercial-invoices/batch-import', {
    items: [{ 'CI编号': ciNo, '关联PI编号': piNo, '关联PO编号': poNo, 'SKU': sku, '数量': 10, '单价': 10, '实际出货日期': '2026-08-15' }]
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.success, 0, '该行必须 failed');
  assert.equal(r.body.failed, 1);
  assert.match(String(r.body.errors[0].reason), /该CI的尾款应付已处于partially_paid状态/);

  // 零 mutation 断言
  assert.equal(countRows('commercial_invoice_items', 'WHERE ci_id = ?', [ciId]), 1, 'CI 明细数不变');
  const ci = queryOne('SELECT * FROM commercial_invoices WHERE id = ?', [ciId]);
  assert.equal(Number(ci.goods_amount), 100, 'CI 总额不变');
  const piItem = queryOne('SELECT * FROM proforma_invoice_items WHERE pi_id = ?', [piId]);
  assert.equal(piItem.shipped_qty, 0, 'PI 明细 shipped_qty 不变');
  const pi = queryOne('SELECT * FROM proforma_invoices WHERE id = ?', [piId]);
  assert.equal(Number(pi.shipped_amount || 0), 0, 'PI shipped_amount 不变');
  const pay = readPayable(payId);
  assert.equal(pay.lifecycle_status, 'partially_paid');
  assert.equal(Number(pay.payable_amount_minor), 10000, 'payable 金额不变');
});

test('S3-B: balance payable active + 重导同 CI → 照常同步（authoritative control）', async () => {
  resetData();
  const sku = 'SKU-MUT3B';
  seedSku(sku);
  const poNo = 'PO-M3B', piNo = 'PI-M3B', ciNo = 'CI-M3B';
  const poId = seedPo(sku, poNo);
  const piId = seedPi(poId, poNo, sku, piNo, { needDeposit: false, qty: 100, price: 10 });
  const ciId = seedCi(piId, piNo, poId, poNo, ciNo, sku, { qty: 10, price: 10 });
  const payId = seedPayable({ sourceType: 'pi', sourceId: piId, sourceNo: piNo, sourceCiId: ciId, feeType: 'balance', amountMinor: 10000, lifecycle: 'active' });

  const r = await api('POST', '/api/commercial-invoices/batch-import', {
    items: [{ 'CI编号': ciNo, '关联PI编号': piNo, '关联PO编号': poNo, 'SKU': sku, '数量': 10, '单价': 10, '实际出货日期': '2026-08-15' }]
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.success, 1, 'active 重导放行');

  // 既有行为：重导追加 CI 明细，CI 总额重算，active balance payable 同步
  assert.equal(countRows('commercial_invoice_items', 'WHERE ci_id = ?', [ciId]), 2);
  const ci = queryOne('SELECT * FROM commercial_invoices WHERE id = ?', [ciId]);
  assert.equal(Number(ci.goods_amount), 200, 'CI 总额重算为 200');
  const pay = readPayable(payId);
  assert.equal(pay.lifecycle_status, 'active');
  assert.equal(Number(pay.payable_amount_minor), 20000, 'active balance 同步到 200.00');
});
