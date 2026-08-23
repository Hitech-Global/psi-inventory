'use strict';

/**
 * 采购预付款占用（paid_unshipped_asset / prepaid_purchase_asset）regression test
 *
 * 口径（用户冻结 2026-08-23）：
 *   active_shipped_value = 实时 UNION 聚合，按 pi_id 归集：
 *     - 正常 CI：commercial_invoice_items JOIN commercial_invoices
 *         WHERE ci_status NOT IN ('cancelled','reversed') AND cii.pi_id 非空
 *     - 历史 CI：historical_commercial_invoice_items JOIN historical_commercial_invoices
 *         WHERE hcii.pi_id 非空
 *   prepaid = paid_deposit × MAX(0, (total_amount − active_shipped_value) / total_amount)
 *   不使用 proforma_invoices.shipped_amount 缓存（void 不回滚 → 残留；CI item 修改 → 漂移）。
 *
 * 覆盖 6 个场景：
 *   Case 1 已付定金、无 CI → 全额计入
 *   Case 2 正常 CI 部分发货 → 按未发比例折算
 *   Case 3 CI cancelled → 不减少 prepaid asset
 *   Case 4 CI reversed → 不减少 prepaid asset
 *   Case 5 历史 CI 存在 → historical_commercial_invoice_items 参与扣减
 *   Case 6 PI.shipped_amount 缓存故意错误 → 结果按实时 CI 聚合，不使用缓存
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_DRIVER = 'sqlite';
process.env.DB_PATH = ':memory:';

const dbMod = require('../db');
const { query, run, getDB } = dbMod;
const { getPrepaidPurchaseAssets } = require('../server');

createSchema();

function createSchema() {
  const d = getDB();
  d.exec(`
    CREATE TABLE IF NOT EXISTS proforma_invoices (
      id TEXT PRIMARY KEY, pi_no TEXT NOT NULL, pi_status TEXT DEFAULT 'pending',
      country TEXT DEFAULT '', currency TEXT DEFAULT 'RMB',
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
    `INSERT INTO proforma_invoices (id, pi_no, pi_status, country, currency, total_amount, paid_deposit, shipped_amount)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, opts.piNo || uniq('PIN'), opts.status || 'pending', opts.country || '印度尼西亚',
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
function call() { return getPrepaidPurchaseAssets(FX, '', []); }
function approx(a, b) { return Math.abs(a - b) < 1e-6; }

// ── Case 1 ──
test('Case 1: paid_deposit>0 且无 CI → 全额计入', () => {
  clearAll();
  const pi = uniq('PI');
  seedPI(pi, { total: 1000, paid: 1000 });

  const r = call();
  assert.ok(approx(r.totalOrig, 1000), '原币全额占用');
  assert.ok(approx(r.totalCny, 1000), 'CNY 全额占用（RMB rate=1）');
  // 国家聚合：单一国家
  const codes = Object.keys(r.byCountryCny);
  assert.equal(codes.length, 1, '应聚合成一个国家');
  assert.ok(approx(r.byCountryCny[codes[0]], 1000));
});

// ── Case 2 ──
test('Case 2: 正常 CI 部分发货 → 按未发比例折算', () => {
  clearAll();
  const pi = uniq('PI');
  const ci = uniq('CI');
  seedPI(pi, { total: 1000, paid: 1000 });
  seedCI(ci, 'shipped');
  seedCIIItem(ci, pi, 600); // 已转化 60%

  const r = call();
  // 未发比例 = (1000-600)/1000 = 0.4 → prepaid = 1000 × 0.4 = 400
  assert.ok(approx(r.totalCny, 400), '部分发货按未发比例折算');
});

// ── Case 3 ──
test('Case 3: CI cancelled → 不减少 prepaid asset', () => {
  clearAll();
  const pi = uniq('PI');
  const ci = uniq('CI');
  seedPI(pi, { total: 1000, paid: 1000 });
  seedCI(ci, 'cancelled');
  seedCIIItem(ci, pi, 1000); // 整票作废，不应参与扣减

  const r = call();
  assert.ok(approx(r.totalCny, 1000), 'cancelled CI 不参与 shipped 扣减 → 全额占用');
});

// ── Case 4 ──
test('Case 4: CI reversed → 不减少 prepaid asset', () => {
  clearAll();
  const pi = uniq('PI');
  const ci = uniq('CI');
  seedPI(pi, { total: 1000, paid: 1000 });
  seedCI(ci, 'reversed');
  seedCIIItem(ci, pi, 1000); // 已冲销，不应参与扣减

  const r = call();
  assert.ok(approx(r.totalCny, 1000), 'reversed CI 不参与 shipped 扣减 → 全额占用');
});

// ── Case 5 ──
test('Case 5: 历史 CI 存在 → historical_commercial_invoice_items 参与扣减', () => {
  clearAll();
  const pi = uniq('PI');
  const hci = uniq('HCI');
  seedPI(pi, { total: 1000, paid: 1000 });
  seedHCI(hci);
  seedHCIIItem(hci, pi, 600); // 历史 CI 已转化 60%

  const r = call();
  assert.ok(approx(r.totalCny, 400), '历史 CI 参与 active_shipped_value 扣减');
});

// ── Case 6 ──
test('Case 6: PI.shipped_amount 缓存故意错误 → 按实时 CI 聚合，不使用缓存', () => {
  clearAll();
  const pi = uniq('PI');
  const ci = uniq('CI');
  // 缓存错误：shipped_amount 声称已发 80%（若用缓存 → prepaid=200）
  seedPI(pi, { total: 1000, paid: 1000, shippedAmount: 800 });
  seedCI(ci, 'shipped');
  seedCIIItem(ci, pi, 400); // 实际 CI 聚合 = 40%

  const r = call();
  // 实时口径：未发比例 = (1000-400)/1000 = 0.6 → prepaid = 600
  assert.ok(approx(r.totalCny, 600), '按实时 CI 聚合（600），而非缓存口径');
  assert.ok(!approx(r.totalCny, 200), '不得回退到 PI.shipped_amount 缓存（200）');
});
