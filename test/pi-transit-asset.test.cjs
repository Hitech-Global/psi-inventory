'use strict';

/**
 * PI 采购在途资产 (pi_transit_asset) regression test
 *
 * 口径（用户冻结 2026-08-23，方案 B）：
 *   采购在途 PI = 已付款 + 未发货的采购承诺。
 *   PI 在途贡献 = MAX(0, total_amount − shipped_amount) × FX
 *   进入条件：paid_deposit > 0 AND pi_status NOT IN ('cancelled')
 *             AND COALESCE(shipped_amount, 0) < total_amount
 *   shipped_amount（供应商已发货货值）= 事实源 main，由 CI 创建(+)/reverse(-)/void(-)/batch-import(+) 全程维护。
 *   active_ci_value = 保留的 AUDIT/校验字段（实时 UNION 聚合已转 CI 货值，排除 cancelled/reversed），
 *                    仅用于校验，不参与在途金额计算；若 active_ci_value > shipped_amount + 容差 → console.warn（不改结果/不阻断）。
 *
 * 覆盖（A–F 为用户强制要求场景 + 回归）：
 *   A  已全发货无 CI（total=shipped, active_ci_value=0）→ transit=0
 *   B  未发货（shipped_amount=0）→ transit=total
 *   C  部分发货 → transit=total−shipped
 *   D  CI void 回滚：void 前 shipped 增加，void 后恢复，transit 随之恢复
 *   E  batch-import：第一次累加，第二次同 CI 不重复累加（幂等）
 *   F  多 CI（CI1+CI2）：创建/void/reverse 后 shipped 计算正确
 *   回归：historical CI 参与扣减、cancelled/reversed CI 不影响、未付款/cancelled PI 不进入、
 *        USD 多币种 FX、已全部发货 PI 不在途、active_ci_value 仅作审计字段（shipped 驱动金额）
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_DRIVER = 'sqlite';
process.env.DB_PATH = ':memory:';

const dbMod = require('../db');
const { query, run, queryOne, getDB } = dbMod;
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
      shipped_amount NUMERIC DEFAULT 0, unshipped_amount NUMERIC DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS proforma_invoice_items (
      id TEXT PRIMARY KEY, pi_id TEXT DEFAULT '', sku_code TEXT DEFAULT '',
      pi_confirmed_qty NUMERIC DEFAULT 0, shipped_qty NUMERIC DEFAULT 0, unshipped_qty NUMERIC DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS commercial_invoices (
      id TEXT PRIMARY KEY, ci_no TEXT NOT NULL, ci_status TEXT DEFAULT 'draft', remark TEXT DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS commercial_invoice_items (
      id TEXT PRIMARY KEY, ci_id TEXT NOT NULL, pi_id TEXT DEFAULT '',
      sku_code TEXT DEFAULT '', shipped_qty NUMERIC DEFAULT 0, ci_amount NUMERIC DEFAULT 0
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
    DELETE FROM proforma_invoice_items;
    DELETE FROM proforma_invoices;
  `);
}

let seq = 0;
function uniq(prefix) { seq += 1; return `${prefix}_${seq}`; }

function seedPI(id, opts) {
  opts = opts || {};
  const total = opts.total || 0;
  const shipped = opts.shippedAmount || 0;
  run(
    `INSERT INTO proforma_invoices (id, pi_no, pi_status, country, brand, target_warehouse, currency, total_amount, paid_deposit, shipped_amount, unshipped_amount)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, opts.piNo || uniq('PIN'), opts.status || 'pending', opts.country || '印度尼西亚',
     opts.brand || 'Netac', opts.warehouse || 'Bekasi',
     opts.currency || 'RMB', total, opts.paid || 0, shipped, opts.unshippedAmount != null ? opts.unshippedAmount : (total - shipped)]
  );
}

function seedPIItem(id, piId, sku, confirmed, shipped) {
  run(
    `INSERT INTO proforma_invoice_items (id, pi_id, sku_code, pi_confirmed_qty, shipped_qty, unshipped_qty)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, piId, sku, confirmed, shipped || 0, (confirmed || 0) - (shipped || 0)]
  );
}

function seedCI(id, ciNo, status) {
  run(`INSERT INTO commercial_invoices (id, ci_no, ci_status) VALUES (?, ?, ?)`, [id, ciNo || uniq('CIN'), status]);
}

function seedCIIItem(ciId, piId, sku, shippedQty, amount) {
  run(
    `INSERT INTO commercial_invoice_items (id, ci_id, pi_id, sku_code, shipped_qty, ci_amount) VALUES (?, ?, ?, ?, ?, ?)`,
    [uniq('cii'), ciId, piId, sku || 'SKU-X', shippedQty || 0, amount]
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

// ───────────────────────────────────────────────
// 契约还原：与 server.js Phase1 写入的 void/batch-import 逻辑完全一致
// （轻量单测不直连真实 handler，避免引入全量 schema 与鉴权依赖；
//  真实 handler 的 SQL 已在 Phase1 人工审查，此处还原以校验 shipped_amount 契约）
// ───────────────────────────────────────────────

// 还原 server.js CI void 回滚（仅 shipped_qty / shipped_amount / pi_status；不含 deposit/付款/WAC/库存）
function contractVoidRollback(ciId) {
  const items = query('SELECT * FROM commercial_invoice_items WHERE ci_id = ?', [ciId]).rows;
  const piIds = [...new Set(items.map(i => i.pi_id).filter(Boolean))];
  for (const citem of items) {
    const piItem = queryOne('SELECT id, pi_confirmed_qty, shipped_qty FROM proforma_invoice_items WHERE pi_id = ? AND sku_code = ?', [citem.pi_id, citem.sku_code]);
    if (piItem) {
      const newShipped = Math.max(0, (piItem.shipped_qty || 0) - (citem.shipped_qty || 0));
      run('UPDATE proforma_invoice_items SET shipped_qty = ?, unshipped_qty = ? WHERE id = ?',
        [newShipped, Math.max(0, (piItem.pi_confirmed_qty || 0) - newShipped), piItem.id]);
    }
  }
  for (const piId of piIds) {
    const pi = queryOne('SELECT * FROM proforma_invoices WHERE id = ?', [piId]);
    if (!pi) continue;
    const piCiAmount = items.filter(i => i.pi_id === piId).reduce((s, i) => s + (i.ci_amount || 0), 0);
    const newShippedAmount = Math.max(0, (pi.shipped_amount || 0) - piCiAmount);
    const newUnshippedAmount = Math.max(0, (pi.total_amount || 0) - newShippedAmount);
    run('UPDATE proforma_invoices SET shipped_amount = ?, unshipped_amount = ? WHERE id = ?', [newShippedAmount, newUnshippedAmount, piId]);
    if (pi.pi_status === 'cancelled') continue;
    const piItems2 = query('SELECT pi_confirmed_qty, shipped_qty FROM proforma_invoice_items WHERE pi_id = ?', [piId]).rows;
    const allShipped = piItems2.length > 0 && piItems2.every(i => i.shipped_qty >= i.pi_confirmed_qty);
    const anyShipped = piItems2.some(i => i.shipped_qty > 0);
    if (allShipped) run('UPDATE proforma_invoices SET pi_status = ? WHERE id = ?', ['shipped_complete', piId]);
    else if (anyShipped) run('UPDATE proforma_invoices SET pi_status = ? WHERE id = ?', ['partial_shipped', piId]);
    else run('UPDATE proforma_invoices SET pi_status = ? WHERE id = ?', ['pending', piId]);
  }
}

// 还原 server.js CI reverse 回滚（契约级：仅 shipped 部分；真实 handler 还回滚库存/WAC/成本，本测试不涉及）
function contractReverseRollback(ciId) {
  const items = query('SELECT * FROM commercial_invoice_items WHERE ci_id = ?', [ciId]).rows;
  const piIds = [...new Set(items.map(i => i.pi_id).filter(Boolean))];
  for (const citem of items) {
    const piItem = queryOne('SELECT id, pi_confirmed_qty, shipped_qty FROM proforma_invoice_items WHERE pi_id = ? AND sku_code = ?', [citem.pi_id, citem.sku_code]);
    if (piItem) {
      const newShipped = Math.max(0, (piItem.shipped_qty || 0) - (citem.shipped_qty || 0));
      run('UPDATE proforma_invoice_items SET shipped_qty = ?, unshipped_qty = ? WHERE id = ?',
        [newShipped, Math.max(0, (piItem.pi_confirmed_qty || 0) - newShipped), piItem.id]);
    }
  }
  for (const piId of piIds) {
    const pi = queryOne('SELECT * FROM proforma_invoices WHERE id = ?', [piId]);
    if (!pi) continue;
    const piCiAmount = items.filter(i => i.pi_id === piId).reduce((s, i) => s + (i.ci_amount || 0), 0);
    const newShippedAmount = Math.max(0, (pi.shipped_amount || 0) - piCiAmount);
    const newUnshippedAmount = Math.max(0, (pi.total_amount || 0) - newShippedAmount);
    run('UPDATE proforma_invoices SET shipped_amount = ?, unshipped_amount = ? WHERE id = ?', [newShippedAmount, newUnshippedAmount, piId]);
    const piItems2 = query('SELECT pi_confirmed_qty, shipped_qty FROM proforma_invoice_items WHERE pi_id = ?', [piId]).rows;
    const allShipped = piItems2.length > 0 && piItems2.every(i => i.shipped_qty >= i.pi_confirmed_qty);
    const anyShipped = piItems2.some(i => i.shipped_qty > 0);
    if (allShipped) run('UPDATE proforma_invoices SET pi_status = ? WHERE id = ?', ['shipped_complete', piId]);
    else if (anyShipped) run('UPDATE proforma_invoices SET pi_status = ? WHERE id = ?', ['partial_shipped', piId]);
    else run('UPDATE proforma_invoices SET pi_status = ? WHERE id = ?', ['pending', piId]);
  }
}

// 还原 server.js CI batch-import shipped 同步（幂等：已存在 ci_no 则跳过累加）
function contractBatchImportOnce(ciNo, ciId, piId, sku, qty, amount, confirmedQty) {
  const exist = queryOne('SELECT * FROM commercial_invoices WHERE ci_no = ?', [ciNo]);
  const createdCiIds = new Set();
  let effectiveCiId = ciId;
  if (!exist) {
    run(`INSERT INTO commercial_invoices (id, ci_no, ci_status) VALUES (?, ?, ?)`, [ciId, ciNo, 'uploaded']);
    createdCiIds.add(ciId);
  } else {
    effectiveCiId = exist.id;
  }
  run(`INSERT INTO commercial_invoice_items (id, ci_id, pi_id, sku_code, shipped_qty, ci_amount) VALUES (?, ?, ?, ?, ?, ?)`,
    [uniq('cii'), effectiveCiId, piId, sku, qty, amount]);
  if (createdCiIds.has(effectiveCiId)) {
    const piItem = queryOne('SELECT id, pi_confirmed_qty, shipped_qty FROM proforma_invoice_items WHERE pi_id = ? AND sku_code = ?', [piId, sku]);
    if (piItem) {
      const newShipped = (piItem.shipped_qty || 0) + qty;
      run('UPDATE proforma_invoice_items SET shipped_qty = ?, unshipped_qty = ? WHERE id = ?',
        [newShipped, (piItem.pi_confirmed_qty || 0) - newShipped, piItem.id]);
    }
    const piFresh = queryOne('SELECT * FROM proforma_invoices WHERE id = ?', [piId]);
    const newShippedAmount = (piFresh.shipped_amount || 0) + amount;
    run('UPDATE proforma_invoices SET shipped_amount = ?, unshipped_amount = ? WHERE id = ?',
      [newShippedAmount, (piFresh.total_amount || 0) - newShippedAmount, piId]);
    const piItems2 = query('SELECT pi_confirmed_qty, shipped_qty FROM proforma_invoice_items WHERE pi_id = ?', [piId]).rows;
    const allShipped = piItems2.length > 0 && piItems2.every(i => i.shipped_qty >= i.pi_confirmed_qty);
    const anyShipped = piItems2.some(i => i.shipped_qty > 0);
    if (allShipped) run('UPDATE proforma_invoices SET pi_status = ? WHERE id = ?', ['shipped_complete', piId]);
    else if (anyShipped) run('UPDATE proforma_invoices SET pi_status = ? WHERE id = ?', ['partial_shipped', piId]);
  }
  return effectiveCiId;
}

// ───────────────────────────────────────────────
// A. 已全发货无 CI：total=shipped，active_ci_value=0 → transit=0
// ───────────────────────────────────────────────
test('A: 已全发货(无CI) → PI transit=0', () => {
  clearAll();
  const pi = uniq('PI');
  // 已全发货：shipped_amount = total；active_ci_value 仍为 0（无 CI 记录）
  seedPI(pi, { total: 200000, paid: 60000, shippedAmount: 200000, status: 'shipped_complete' });

  const r = call();
  assert.ok(approx(r.totalCny, 0), '已全发货 → 不在途');
  assert.equal(r.details.length, 0, '不在 details 中');
});

// ───────────────────────────────────────────────
// B. 未发货：shipped_amount=0 → transit=total
// ───────────────────────────────────────────────
test('B: 未发货(shipped_amount=0) → PI transit=total', () => {
  clearAll();
  const pi = uniq('PI');
  seedPI(pi, { total: 200000, paid: 60000, shippedAmount: 0 });

  const r = call();
  assert.ok(approx(r.totalCny, 200000), '未发货全额在途');
  assert.equal(r.details.length, 1);
  assert.ok(approx(r.details[0].shipped_amount, 0));
  assert.ok(approx(r.details[0].amount_cny, 200000));
});

// ───────────────────────────────────────────────
// C. 部分发货：transit = total − shipped
// ───────────────────────────────────────────────
test('C: 部分发货 → PI transit = total − shipped', () => {
  clearAll();
  const pi = uniq('PI');
  seedPI(pi, { total: 200000, paid: 60000, shippedAmount: 80000 });

  const r = call();
  assert.ok(approx(r.totalCny, 120000), 'transit = 200000 − 80000 = 120000');
  assert.ok(approx(r.details[0].shipped_amount, 80000));
  assert.ok(approx(r.details[0].amount_cny, 120000));
});

// ───────────────────────────────────────────────
// D. CI void 回滚：void 前 shipped 增加，void 后恢复，transit 恢复
// ───────────────────────────────────────────────
test('D: CI void 回滚 → shipped_amount 恢复且 transit 正确', () => {
  clearAll();
  const pi = uniq('PI');
  const ci = uniq('CI');
  seedPI(pi, { total: 200000, paid: 60000, shippedAmount: 120000, status: 'partial_shipped' });
  seedPIItem(uniq('pii'), pi, 'SKU-X', 100, 60);
  seedCI(ci, 'CI-D', 'shipped');
  seedCIIItem(ci, pi, 'SKU-X', 60, 120000);

  // void 前：shipped=120000 → transit=80000
  let r = call();
  assert.ok(approx(r.totalCny, 80000), 'void 前 transit = 200000 − 120000 = 80000');

  // 还原 void 回滚
  contractVoidRollback(ci);

  // void 后：shipped 恢复为 0 → transit=200000
  const piRow = queryOne('SELECT shipped_amount, pi_status FROM proforma_invoices WHERE id = ?', [pi]);
  assert.ok(approx(piRow.shipped_amount, 0), 'void 后 shipped_amount 恢复为 0');
  assert.equal(piRow.pi_status, 'pending', 'void 后 PI 状态回到 pending');
  r = call();
  assert.ok(approx(r.totalCny, 200000), 'void 后 transit 恢复为全额 200000');
});

// ───────────────────────────────────────────────
// E. batch-import 幂等：第一次累加，第二次同 CI 不重复累加
// ───────────────────────────────────────────────
test('E: batch-import 幂等 → 同 CI 二次导入不重复累加 shipped_amount', () => {
  clearAll();
  const pi = uniq('PI');
  seedPI(pi, { total: 200000, paid: 60000, shippedAmount: 0, status: 'pending' });
  seedPIItem(uniq('pii'), pi, 'SKU-X', 100, 0);

  // 第一次导入（新建 CI）
  contractBatchImportOnce('CI-E', uniq('CI'), pi, 'SKU-X', 40, 80000, 100);
  let r = call();
  assert.ok(approx(r.totalCny, 120000), '第一次导入后 transit = 200000 − 80000 = 120000');
  let piRow = queryOne('SELECT shipped_amount FROM proforma_invoices WHERE id = ?', [pi]);
  assert.ok(approx(piRow.shipped_amount, 80000), '第一次导入后 shipped_amount = 80000');

  // 第二次导入同一 CI（ci_no 命中 exist → 跳过累加）
  contractBatchImportOnce('CI-E', uniq('CI'), pi, 'SKU-X', 40, 80000, 100);
  piRow = queryOne('SELECT shipped_amount FROM proforma_invoices WHERE id = ?', [pi]);
  assert.ok(approx(piRow.shipped_amount, 80000), '第二次导入后 shipped_amount 仍为 80000（无 double count）');
  r = call();
  assert.ok(approx(r.totalCny, 120000), '无 double count → transit 仍 120000');
});

// ───────────────────────────────────────────────
// F. 多 CI：CI1+CI2 → 创建/void/reverse 后 shipped 计算正确
// ───────────────────────────────────────────────
test('F: 多 CI（CI1+CI2）创建/void/reverse → shipped_amount 计算正确', () => {
  clearAll();
  const pi = uniq('PI');
  seedPI(pi, { total: 300000, paid: 90000, shippedAmount: 0, status: 'pending' });
  seedPIItem(uniq('pii'), pi, 'SKU-X', 100, 0);

  const ci1 = uniq('CI');
  const ci2 = uniq('CI');
  // 创建 CI1（发货 30 / 90000）与 CI2（发货 50 / 150000）
  contractBatchImportOnce('CI1', ci1, pi, 'SKU-X', 30, 90000, 100);
  contractBatchImportOnce('CI2', ci2, pi, 'SKU-X', 50, 150000, 100);
  let piRow = queryOne('SELECT shipped_amount FROM proforma_invoices WHERE id = ?', [pi]);
  assert.ok(approx(piRow.shipped_amount, 240000), 'CI1+CI2 → shipped = 90000 + 150000 = 240000');
  let r = call();
  assert.ok(approx(r.totalCny, 60000), 'transit = 300000 − 240000 = 60000');

  // void CI1 → shipped 回退 90000
  contractVoidRollback(ci1);
  piRow = queryOne('SELECT shipped_amount FROM proforma_invoices WHERE id = ?', [pi]);
  assert.ok(approx(piRow.shipped_amount, 150000), 'void CI1 后 shipped = 150000');
  r = call();
  assert.ok(approx(r.totalCny, 150000), 'transit = 300000 − 150000 = 150000');

  // reverse CI2 → shipped 回退 150000
  contractReverseRollback(ci2);
  piRow = queryOne('SELECT shipped_amount FROM proforma_invoices WHERE id = ?', [pi]);
  assert.ok(approx(piRow.shipped_amount, 0), 'reverse CI2 后 shipped = 0');
  r = call();
  assert.ok(approx(r.totalCny, 300000), 'transit 恢复全额 300000');
});

// ───────────────────────────────────────────────
// 回归：历史 CI 参与扣减（通过 shipped_amount 反映）
// ───────────────────────────────────────────────
test('Regression: 历史 CI 已发货 → 通过 shipped_amount 扣减', () => {
  clearAll();
  const pi = uniq('PI');
  // 历史 CI 已发 60% → 体现为 shipped_amount=60000
  seedPI(pi, { total: 100000, paid: 30000, shippedAmount: 60000 });
  const hci = uniq('HCI');
  seedHCI(hci);
  // 历史 CI item 仅作 AUDIT（active_ci_value），不影响金额
  seedHCIIItem(hci, pi, 60000);

  const r = call();
  assert.ok(approx(r.totalCny, 40000), 'shipped=60000 → transit = 100000 − 60000 = 40000');
  assert.ok(approx(r.details[0].active_ci_value, 60000), 'active_ci_value 仍反映历史 CI 聚合（审计字段）');
});

// ───────────────────────────────────────────────
// 回归：cancelled / reversed CI 不影响（shipped 已回滚 → 全额在途）
// ───────────────────────────────────────────────
test('Regression: cancelled/reversed CI 不影响 → 全额在途', () => {
  clearAll();
  const pi = uniq('PI');
  // shipped_amount=0（作废/冲销后已回滚）→ 全额在途
  seedPI(pi, { total: 100000, paid: 30000, shippedAmount: 0 });
  const ci = uniq('CI');
  seedCI(ci, 'CANCELLED', 'cancelled');
  seedCIIItem(ci, pi, 'SKU-X', 100, 100000);

  const r = call();
  assert.ok(approx(r.totalCny, 100000), 'shipped=0 → 全额在途，CI 状态不影响金额');
});

// ───────────────────────────────────────────────
// 回归：未付款 / cancelled PI 不进入在途
// ───────────────────────────────────────────────
test('Regression: 未付款 / cancelled PI 不进入在途', () => {
  clearAll();
  const piPaid0 = uniq('PI');
  seedPI(piPaid0, { total: 100000, paid: 0, shippedAmount: 0 });
  const piCancelled = uniq('PI');
  seedPI(piCancelled, { total: 100000, paid: 30000, shippedAmount: 0, status: 'cancelled' });

  const r = call();
  assert.ok(approx(r.totalCny, 0), '未付款与已取消 PI 均不进入在途');
  assert.equal(r.details.length, 0);
});

// ───────────────────────────────────────────────
// 回归：USD 多币种 FX
// ───────────────────────────────────────────────
test('Regression: USD PI with FX=7 → CNY 折算正确', () => {
  clearAll();
  const pi = uniq('PI');
  seedPI(pi, { total: 10000, paid: 5000, shippedAmount: 0, currency: 'USD' });

  const r = call();
  assert.ok(approx(r.totalOrig, 10000), '原币 10000 USD');
  assert.ok(approx(r.totalCny, 70000), 'CNY = 10000 × 7 = 70000');
});

// ───────────────────────────────────────────────
// 回归：active_ci_value 仅作审计字段（shipped 驱动金额）
// ───────────────────────────────────────────────
test('Regression: active_ci_value 仅审计，金额由 shipped_amount 驱动', () => {
  clearAll();
  const pi = uniq('PI');
  // shipped_amount=80000（如已作废/回退修正后），而实时 CI 聚合 active_ci_value=40000（残留）
  seedPI(pi, { total: 100000, paid: 30000, shippedAmount: 80000 });
  const ci = uniq('CI');
  seedCI(ci, 'shipped', 'shipped');
  seedCIIItem(ci, pi, 'SKU-X', 40, 40000);

  const r = call();
  // 金额由 shipped 驱动：100000 − 80000 = 20000
  assert.ok(approx(r.totalCny, 20000), '金额由 shipped_amount 驱动（20000），而非 active_ci_value');
  assert.ok(approx(r.details[0].active_ci_value, 40000), 'active_ci_value 仍为 40000（仅审计展示）');
  assert.ok(approx(r.details[0].shipped_amount, 80000));
});
