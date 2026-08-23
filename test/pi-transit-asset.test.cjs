'use strict';

/**
 * PI 采购在途资产 (pi_transit_asset) regression test
 *
 * 口径（用户冻结 2026-08-23）：
 *   active_ci_value = 实时 UNION 聚合，按 pi_id 归集：
 *     - 正常 CI：commercial_invoice_items JOIN commercial_invoices
 *         WHERE ci_status NOT IN ('cancelled','reversed') AND cii.pi_id 非空
 *     - 历史 CI：historical_commercial_invoice_items JOIN historical_commercial_invoices
 *         WHERE hcii.pi_id 非空
 *   PI 在途贡献 = MAX(0, total_amount − active_ci_value) × FX
 *   不使用 proforma_invoices.shipped_amount 缓存（void 不回滚 → 残留；CI item 修改 → 漂移）。
 *   PI 进入条件：paid_deposit > 0 AND pi_status NOT IN ('cancelled')
 *
 * 覆盖 8 个场景：
 *   Case 1 已付定金、无 CI → 全额计入
 *   Case 2 正常 CI 部分转化 → 扣减已转 CI 部分
 *   Case 3 CI cancelled → 不减少 active_ci_value
 *   Case 4 CI reversed → 不减少 active_ci_value
 *   Case 5 历史 CI 存在 → historical_commercial_invoice_items 参与扣减
 *   Case 6 PI.shipped_amount 缓存故意错误 → 按实时 CI 聚合，不使用缓存
 *   Case 7 PI 未付款 (paid_deposit=0) → 不进入 transit
 *   Case 8 PI cancelled → 不进入 transit
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_DRIVER = 'sqlite';
process.env.DB_PATH = ':memory:';

const dbMod = require('../db');
const { query, run, getDB } = dbMod;
const { getPiTransitAssets } = require('../server');

createSchema();

function createSchema() {
  const d = getDB();
  d.exec(`
    CREATE TABLE IF NOT EXISTS proforma_invoices (
      id TEXT PRIMARY KEY, pi_no TEXT NOT NULL, pi_status TEXT DEFAULT 'pending',
      country TEXT DEFAULT '', brand TEXT DEFAULT '', target_warehouse TEXT DEFAULT '',
      currency TEXT DEFAULT 'RMB',
      total_amount NUMERIC DEFAULT 0, paid_deposit NUMERIC DEFAULT 0,
      shipped_amount NUMERIC DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS commercial_invoices (
      id TEXT PRIMARY KEY, ci_no TEXT NOT NULL, ci_status TEXT DEFAULT 'draft'
    );
    CREATE TABLE IF NOT EXISTS commercial_invoice_items (
      id TEXT PRIMARY KEY, ci_id TEXT NOT NULL, pi_id TEXT DEFAULT '',
      ci_amount NUMERIC DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS historical_commercial_invoices (
      id TEXT PRIMARY KEY, historical_ci_no TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS historical_commercial_invoice_items (
      id TEXT PRIMARY KEY, hci_id TEXT NOT NULL, pi_id TEXT DEFAULT '',
      ci_amount NUMERIC DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS countries (
      name TEXT PRIMARY KEY, default_currency TEXT DEFAULT ''
    );
  `);
}

function clearAll() {
  const d = getDB();
  d.exec(`
    DELETE FROM historical_commercial_invoice_items;
    DELETE FROM historical_commercial_invoices;
    DELETE FROM commercial_invoice_items;
    DELETE FROM commercial_invoices;
    DELETE FROM proforma_invoices;
  `);
}

let seq = 0;
function uniq(prefix) { seq += 1; return `${prefix}_${seq}`; }

function seedPI(id, opts) {
  opts = opts || {};
  run(
    `INSERT INTO proforma_invoices (id, pi_no, pi_status, country, brand, target_warehouse, currency, total_amount, paid_deposit, shipped_amount)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, opts.piNo || uniq('PIN'), opts.status || 'pending', opts.country || '印度尼西亚',
     opts.brand || 'Netac', opts.warehouse || 'Bekasi',
     opts.currency || 'RMB', opts.total || 0, opts.paid || 0, opts.shippedAmount || 0]
  );
}

function seedCI(id, status) {
  run(`INSERT INTO commercial_invoices (id, ci_no, ci_status) VALUES (?, ?, ?)`, [id, uniq('CIN'), status]);
}

function seedCIIItem(ciId, piId, amount) {
  run(
    `INSERT INTO commercial_invoice_items (id, ci_id, pi_id, ci_amount) VALUES (?, ?, ?, ?)`,
    [uniq('cii'), ciId, piId, amount]
  );
}

function seedHCI(id) {
  run(`INSERT INTO historical_commercial_invoices (id, historical_ci_no) VALUES (?, ?)`, [id, uniq('HCIN')]);
}

function seedHCIIItem(hciId, piId, amount) {
  run(
    `INSERT INTO historical_commercial_invoice_items (id, hci_id, pi_id, ci_amount) VALUES (?, ?, ?, ?)`,
    [uniq('hcii'), hciId, piId, amount]
  );
}

// 测试用汇率映射（与 overview 的 foreignToRmbMap 同构）
const FX = { RMB: 1, CNY: 1, USD: 7 };
function call() { return getPiTransitAssets(FX, '', []); }
function approx(a, b) { return Math.abs(a - b) < 1e-6; }

// ── Case 1 ──
test('Case 1: paid_deposit>0 且无 CI → 全额计入', () => {
  clearAll();
  const pi = uniq('PI');
  seedPI(pi, { total: 100000, paid: 30000 });

  const r = call();
  // PI 在途贡献 = MAX(0, 100000 - 0) = 100000
  assert.ok(approx(r.totalOrig, 100000), '原币全额在途');
  assert.ok(approx(r.totalCny, 100000), 'CNY 全额在途（RMB rate=1）');
  // 国家聚合
  const codes = Object.keys(r.byCountryCny);
  assert.equal(codes.length, 1, '应聚合成一个国家');
  assert.ok(approx(r.byCountryCny[codes[0]], 100000));
  // details
  assert.equal(r.details.length, 1);
  assert.ok(approx(r.details[0].pi_total_amount, 100000));
  assert.ok(approx(r.details[0].active_ci_value, 0));
  assert.ok(approx(r.details[0].amount_cny, 100000));
});

// ── Case 2 ──
test('Case 2: 正常 CI 部分转化 → 扣减已转 CI 部分', () => {
  clearAll();
  const pi = uniq('PI');
  const ci = uniq('CI');
  seedPI(pi, { total: 100000, paid: 30000 });
  seedCI(ci, 'shipped');
  seedCIIItem(ci, pi, 40000); // 已转 CI 40%

  const r = call();
  // PI 在途贡献 = MAX(0, 100000 - 40000) = 60000
  assert.ok(approx(r.totalCny, 60000), '扣减已转 CI 后剩余部分');
  assert.ok(approx(r.details[0].active_ci_value, 40000));
});

// ── Case 3 ──
test('Case 3: CI cancelled → 不减少 active_ci_value', () => {
  clearAll();
  const pi = uniq('PI');
  const ci = uniq('CI');
  seedPI(pi, { total: 100000, paid: 30000 });
  seedCI(ci, 'cancelled');
  seedCIIItem(ci, pi, 100000); // 整票作废，不应参与扣减

  const r = call();
  assert.ok(approx(r.totalCny, 100000), 'cancelled CI 不参与扣减 → 全额在途');
});

// ── Case 4 ──
test('Case 4: CI reversed → 不减少 active_ci_value', () => {
  clearAll();
  const pi = uniq('PI');
  const ci = uniq('CI');
  seedPI(pi, { total: 100000, paid: 30000 });
  seedCI(ci, 'reversed');
  seedCIIItem(ci, pi, 100000); // 已冲销，不应参与扣减

  const r = call();
  assert.ok(approx(r.totalCny, 100000), 'reversed CI 不参与扣减 → 全额在途');
});

// ── Case 5 ──
test('Case 5: 历史 CI 存在 → historical_commercial_invoice_items 参与扣减', () => {
  clearAll();
  const pi = uniq('PI');
  const hci = uniq('HCI');
  seedPI(pi, { total: 100000, paid: 30000 });
  seedHCI(hci);
  seedHCIIItem(hci, pi, 60000); // 历史 CI 已转化 60%

  const r = call();
  // MAX(0, 100000 - 60000) = 40000
  assert.ok(approx(r.totalCny, 40000), '历史 CI 参与 active_ci_value 扣减');
});

// ── Case 6 ──
test('Case 6: PI.shipped_amount 缓存故意错误 → 按实时 CI 聚合，不使用缓存', () => {
  clearAll();
  const pi = uniq('PI');
  const ci = uniq('CI');
  // 缓存错误：shipped_amount 声称已发 80%
  seedPI(pi, { total: 100000, paid: 30000, shippedAmount: 80000 });
  seedCI(ci, 'shipped');
  seedCIIItem(ci, pi, 40000); // 实际 CI 聚合 = 40%

  const r = call();
  // 实时口径：MAX(0, 100000 - 40000) = 60000
  assert.ok(approx(r.totalCny, 60000), '按实时 CI 聚合（60000），而非缓存口径');
  assert.ok(!approx(r.totalCny, 20000), '不得回退到 PI.shipped_amount 缓存推断（20000）');
});

// ── Case 7 ──
test('Case 7: PI 未付款 (paid_deposit=0) → 不进入 transit', () => {
  clearAll();
  const pi = uniq('PI');
  seedPI(pi, { total: 100000, paid: 0 });

  const r = call();
  assert.ok(approx(r.totalCny, 0), '未付款 PI 不进入在途');
  assert.equal(r.details.length, 0, '无明细');
});

// ── Case 8 ──
test('Case 8: PI cancelled → 不进入 transit', () => {
  clearAll();
  const pi = uniq('PI');
  seedPI(pi, { total: 100000, paid: 30000, status: 'cancelled' });

  const r = call();
  assert.ok(approx(r.totalCny, 0), 'cancelled PI 不进入在途');
  assert.equal(r.details.length, 0, '无明细');
});

// ── Case 9: 多币种 FX ──
test('Case 9: USD PI with FX=7 → CNY 折算正确', () => {
  clearAll();
  const pi = uniq('PI');
  seedPI(pi, { total: 10000, paid: 5000, currency: 'USD' });
  // 无 CI → 全额 10000 USD × 7 = 70000 CNY
  const r = call();
  assert.ok(approx(r.totalOrig, 10000), '原币 10000 USD');
  assert.ok(approx(r.totalCny, 70000), 'CNY = 10000 × 7 = 70000');
});

// ── Case 10: 已全部转 CI → 不在途 ──
test('Case 10: PI 全部转 CI → transit=0，不出现在 details', () => {
  clearAll();
  const pi = uniq('PI');
  const ci = uniq('CI');
  seedPI(pi, { total: 100000, paid: 30000 });
  seedCI(ci, 'shipped');
  seedCIIItem(ci, pi, 100000); // 全部转 CI

  const r = call();
  assert.ok(approx(r.totalCny, 0), '全部转 CI → 不在途');
  assert.equal(r.details.length, 0, '无明细');
});
