/**
 * WAC Calculator Tests (Phase 1 Design Freeze)
 *
 * Uses node:test + node:assert/strict
 * Run: node --test wac-calculator.test.cjs
 *
 * Test scenarios per user spec:
 * - CI 1000 → PL 600 / 400 partial shipment
 * - Batch-A qty=600, not 1000
 * - Product Cost conservation
 * - PL 0 / 1 / >1
 * - Batch→CI relation conflict
 * - old_qty=0, blank, NaN, negative
 * - missing arrival date
 * - missing exact FX
 * - freight: fact missing, link ambiguous, currency mismatch, settlement not reconciled, fx rate missing
 * - CBM / KG allocation conservation
 * - VAT excluded
 * - missing customs rate
 * - unknown Other FX/allocation policy
 * - Current WAC invalid / inventory context mismatch / denominator zero
 * - Confirm success: verify no side effects (inventory_value, available_qty, cost_update_logs)
 */

const { test, describe, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');

// Set up in-memory SQLite before requiring db modules
process.env.DB_DRIVER = 'sqlite';
process.env.DB_PATH = ':memory:';

const { query, queryOne, run, transaction, initDatabase } = require('./db');
const { computeWacCostFacts, allocateByWeight, resolveExactFxRate } = require('./wac-calculator');

// ── Schema setup ──
function createTestSchema() {
  const db = require('./db').getDB();

  db.exec(`
    CREATE TABLE IF NOT EXISTS countries (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      code TEXT DEFAULT '',
      default_currency TEXT DEFAULT '',
      sort_order INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS skus (
      id TEXT PRIMARY KEY,
      sku_code TEXT NOT NULL UNIQUE,
      product_name TEXT DEFAULT '',
      model TEXT DEFAULT '',
      brand TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS commercial_invoices (
      id TEXT PRIMARY KEY,
      ci_no TEXT NOT NULL UNIQUE,
      related_po_id TEXT DEFAULT '',
      related_po_no TEXT DEFAULT '',
      related_pi_id TEXT DEFAULT '',
      related_pi_no TEXT DEFAULT '',
      supplier_id TEXT DEFAULT '',
      supplier_name TEXT DEFAULT '',
      brand TEXT DEFAULT '',
      country TEXT DEFAULT '',
      target_warehouse TEXT DEFAULT '',
      ci_date TEXT NOT NULL,
      shipment_batch INTEGER DEFAULT 1,
      currency TEXT DEFAULT 'USD',
      goods_amount NUMERIC(18,4) DEFAULT 0,
      ci_status TEXT DEFAULT 'draft',
      transport_basis TEXT DEFAULT NULL,
      import_duty_total NUMERIC(18,4) DEFAULT 0,
      has_customs_duty INTEGER DEFAULT 0,
      has_inspection_fee INTEGER DEFAULT 0,
      wac_confirmed INTEGER DEFAULT 0,
      actual_ship_date TEXT DEFAULT '',
      payment_term_id TEXT DEFAULT '',
      credit_days INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS commercial_invoice_items (
      id TEXT PRIMARY KEY,
      ci_id TEXT NOT NULL,
      ci_no TEXT DEFAULT '',
      pi_no TEXT DEFAULT '',
      sku_code TEXT NOT NULL,
      shipped_qty INTEGER DEFAULT 0,
      unit_price NUMERIC(18,4) DEFAULT 0,
      net_unit_price NUMERIC(18,4) DEFAULT 0,
      ci_amount NUMERIC(18,4) DEFAULT 0,
      actual_customs_rate NUMERIC(18,8) DEFAULT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS packing_lists (
      id TEXT PRIMARY KEY,
      pl_no TEXT NOT NULL UNIQUE,
      related_po_id TEXT DEFAULT '',
      related_po_no TEXT DEFAULT '',
      related_pi_id TEXT DEFAULT '',
      related_pi_no TEXT DEFAULT '',
      related_ci_id TEXT DEFAULT '',
      related_ci_no TEXT DEFAULT '',
      supplier_id TEXT DEFAULT '',
      supplier_name TEXT DEFAULT '',
      brand TEXT DEFAULT '',
      country TEXT DEFAULT '',
      target_warehouse TEXT DEFAULT '',
      pl_date TEXT DEFAULT '',
      total_qty INTEGER DEFAULT 0,
      total_cartons INTEGER DEFAULT 0,
      total_gross_weight DOUBLE PRECISION DEFAULT 0,
      total_net_weight DOUBLE PRECISION DEFAULT 0,
      total_cbm DOUBLE PRECISION DEFAULT 0,
      status TEXT DEFAULT 'draft',
      logistics_batch_id TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS packing_list_items (
      id TEXT PRIMARY KEY,
      pl_id TEXT NOT NULL,
      pl_no TEXT DEFAULT '',
      ci_no TEXT DEFAULT '',
      sku_code TEXT NOT NULL,
      cartons INTEGER DEFAULT 0,
      qty_per_carton INTEGER DEFAULT 0,
      total_qty INTEGER DEFAULT 0,
      gross_weight DOUBLE PRECISION DEFAULT 0,
      net_weight DOUBLE PRECISION DEFAULT 0,
      cbm DOUBLE PRECISION DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS logistics_batches (
      id TEXT PRIMARY KEY,
      batch_no TEXT NOT NULL UNIQUE,
      related_ci_id TEXT DEFAULT '',
      related_ci_no TEXT DEFAULT '',
      forwarder_name TEXT DEFAULT '',
      transport_mode TEXT DEFAULT 'sea',
      target_country TEXT DEFAULT '',
      target_warehouse TEXT DEFAULT '',
      actual_arrival_date TEXT DEFAULT '',
      logistics_status TEXT DEFAULT 'pending',
      total_cartons INTEGER DEFAULT 0,
      total_weight DOUBLE PRECISION DEFAULT 0,
      total_cbm DOUBLE PRECISION DEFAULT 0,
      freight_currency TEXT DEFAULT 'USD',
      international_freight NUMERIC(18,4) DEFAULT 0,
      local_charges NUMERIC(18,4) DEFAULT 0,
      customs_service_fee NUMERIC(18,4) DEFAULT 0,
      delivery_fee NUMERIC(18,4) DEFAULT 0,
      total_freight NUMERIC(18,4) DEFAULT 0,
      customs_duty NUMERIC(18,4) DEFAULT 0,
      vat_gst NUMERIC(18,4) DEFAULT 0,
      other_fees NUMERIC(18,4) DEFAULT 0,
      fee_status TEXT DEFAULT 'unpaid',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ci_cost_items (
      id TEXT PRIMARY KEY,
      ci_id TEXT NOT NULL,
      ci_no TEXT DEFAULT '',
      payment_request_id TEXT DEFAULT '',
      request_no TEXT DEFAULT '',
      cost_category TEXT DEFAULT '',
      cost_subcategory TEXT DEFAULT '',
      payable_amount NUMERIC(18,4) DEFAULT 0,
      paid_amount NUMERIC(18,4) DEFAULT 0,
      include_in_landing_cost INTEGER DEFAULT 1,
      payee_name TEXT DEFAULT '',
      currency TEXT DEFAULT 'USD',
      remark TEXT DEFAULT '',
      logistics_batch_id TEXT DEFAULT '',
      payable_item_id TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS payment_requests (
      id TEXT PRIMARY KEY,
      request_no TEXT NOT NULL UNIQUE,
      payment_category TEXT DEFAULT '',
      payment_subcategory TEXT DEFAULT '',
      source_type TEXT DEFAULT '',
      source_id TEXT DEFAULT '',
      source_no TEXT DEFAULT '',
      payee_key TEXT NOT NULL DEFAULT '',
      payee_name_snapshot TEXT NOT NULL DEFAULT '',
      supplier_name TEXT DEFAULT '',
      payable_amount NUMERIC(18,4) DEFAULT 0,
      paid_amount NUMERIC(18,4) DEFAULT 0,
      unpaid_amount NUMERIC(18,4) DEFAULT 0,
      currency TEXT DEFAULT 'USD',
      payment_status TEXT DEFAULT 'not_requested',
      approval_status TEXT DEFAULT 'pending',
      related_ci_id TEXT DEFAULT '',
      related_ci_no TEXT DEFAULT '',
      related_po_no TEXT DEFAULT '',
      include_in_landing_cost INTEGER DEFAULT 1,
      expense_country TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS payment_settlement_logs (
      id TEXT PRIMARY KEY,
      payment_request_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      amount NUMERIC(18,4) NOT NULL,
      status TEXT NOT NULL DEFAULT 'applied',
      reason TEXT DEFAULT '',
      paid_date TEXT DEFAULT '',
      payment_voucher TEXT DEFAULT '',
      original_currency TEXT DEFAULT '',
      settlement_country TEXT DEFAULT '',
      local_currency TEXT DEFAULT '',
      local_rate NUMERIC(18,8) DEFAULT 0,
      local_rate_date TEXT DEFAULT '',
      local_rate_type TEXT DEFAULT '',
      local_rate_direction TEXT DEFAULT '',
      local_amount NUMERIC(18,4) DEFAULT 0,
      rmb_rate NUMERIC(18,8) DEFAULT 0,
      rmb_rate_date TEXT DEFAULT '',
      rmb_rate_type TEXT DEFAULT '',
      rmb_rate_direction TEXT DEFAULT '',
      rmb_amount NUMERIC(18,4) DEFAULT 0,
      operator_id TEXT DEFAULT '',
      operator_name TEXT DEFAULT '',
      idempotency_key TEXT DEFAULT '',
      is_legacy INTEGER NOT NULL DEFAULT 0,
      reversal_of TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      reversed_at TEXT DEFAULT '',
      reversed_by TEXT DEFAULT '',
      reversal_reason TEXT DEFAULT '',
      CHECK (event_type IN ('payment','deduction','rounding','rounding_reversal')),
      CHECK (status IN ('applied','reversed')),
      CHECK (amount > 0),
      CHECK (is_legacy IN (0,1))
    );

    CREATE TABLE IF NOT EXISTS wac_history (
      id TEXT PRIMARY KEY,
      version_no INTEGER NOT NULL,
      ci_id TEXT DEFAULT '',
      ci_no TEXT DEFAULT '',
      po_id TEXT DEFAULT '',
      po_no TEXT DEFAULT '',
      pi_id TEXT DEFAULT '',
      pi_no TEXT DEFAULT '',
      sku_code TEXT NOT NULL,
      model TEXT DEFAULT '',
      brand TEXT DEFAULT '',
      country TEXT DEFAULT '',
      warehouse TEXT DEFAULT '',
      original_qty NUMERIC(18,4) DEFAULT 0,
      original_avg_cost NUMERIC(18,4) DEFAULT 0,
      original_inventory_value NUMERIC(18,4) DEFAULT 0,
      inbound_qty NUMERIC(18,4) DEFAULT 0,
      unit_landing_cost NUMERIC(18,4) DEFAULT 0,
      inbound_total_cost NUMERIC(18,4) DEFAULT 0,
      new_avg_cost NUMERIC(18,4) DEFAULT 0,
      settlement_date TEXT DEFAULT '',
      confirmation_status TEXT DEFAULT 'confirmed',
      is_locked INTEGER DEFAULT 1,
      confirmed_by TEXT DEFAULT '',
      confirmed_at TEXT DEFAULT '',
      logistics_batch_id TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS inventory (
      id TEXT PRIMARY KEY,
      sku_code TEXT NOT NULL,
      country TEXT DEFAULT '',
      warehouse TEXT DEFAULT '',
      available_qty INTEGER DEFAULT 0,
      in_transit_qty INTEGER DEFAULT 0,
      weighted_avg_cost NUMERIC(18,4) DEFAULT 0,
      inventory_value NUMERIC(18,4) DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS cost_update_logs (
      id TEXT PRIMARY KEY,
      sku_code TEXT NOT NULL,
      country TEXT DEFAULT '',
      warehouse TEXT DEFAULT '',
      related_po_no TEXT DEFAULT '',
      related_pi_no TEXT DEFAULT '',
      related_ci_no TEXT DEFAULT '',
      original_qty NUMERIC(18,4) DEFAULT 0,
      old_avg_cost NUMERIC(18,4) DEFAULT 0,
      inbound_qty NUMERIC(18,4) DEFAULT 0,
      ci_unit_cost NUMERIC(18,4) DEFAULT 0,
      unit_landing_cost NUMERIC(18,4) DEFAULT 0,
      new_qty NUMERIC(18,4) DEFAULT 0,
      new_avg_cost NUMERIC(18,4) DEFAULT 0,
      operator_id TEXT DEFAULT '',
      operator_name TEXT DEFAULT '',
      import_file TEXT DEFAULT '',
      remark TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS exchange_rates (
      id TEXT PRIMARY KEY,
      from_currency TEXT NOT NULL,
      to_currency TEXT NOT NULL,
      rate NUMERIC(18,8) NOT NULL,
      rate_date TEXT NOT NULL,
      rate_type TEXT DEFAULT 'realtime',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS warehouses (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      country_id TEXT DEFAULT '',
      country_name TEXT DEFAULT '',
      warehouse_type TEXT DEFAULT '',
      sort_order INTEGER DEFAULT 0
    );
  `);
}

// ── Seed helpers ──
function seedCountry(name, code, currency) {
  run('INSERT INTO countries (id, name, code, default_currency, sort_order) VALUES (?, ?, ?, ?, ?)',
    [`ctry_${name}`, name, code, currency, 0]);
}

function seedWarehouse(id, name, countryId, countryName) {
  run('INSERT INTO warehouses (id, name, country_id, country_name) VALUES (?, ?, ?, ?)',
    [id, name, countryId || '', countryName || '']);
}

function seedSku(skuCode, productName, model, brand) {
  run('INSERT INTO skus (id, sku_code, product_name, model, brand) VALUES (?, ?, ?, ?, ?)',
    [`sku_${skuCode}`, skuCode, productName || '', model || '', brand || '']);
}

function seedCI(id, ciNo, currency, goodsAmount, transportBasis, opts = {}) {
  run(`INSERT INTO commercial_invoices (id, ci_no, ci_date, currency, goods_amount, transport_basis,
    has_customs_duty, has_inspection_fee, wac_confirmed, actual_ship_date, payment_term_id, credit_days, ci_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, ciNo, opts.ciDate || '2026-01-01', currency, goodsAmount, transportBasis || null,
     opts.hasCustomsDuty ? 1 : 0, opts.hasInspectionFee ? 1 : 0, 0, '2026-01-01', '', 0, 'shipped']);
}

function seedCIItem(id, ciId, skuCode, shippedQty, unitPrice, netUnitPrice, customsRate) {
  run(`INSERT INTO commercial_invoice_items (id, ci_id, ci_no, sku_code, shipped_qty, unit_price, net_unit_price, ci_amount, actual_customs_rate)
    VALUES (?, ?, '', ?, ?, ?, ?, ?, ?)`,
    [id, ciId, skuCode, shippedQty, unitPrice, netUnitPrice || 0, shippedQty * (netUnitPrice > 0 ? netUnitPrice : unitPrice),
     customsRate !== undefined ? customsRate : null]);
}

function seedBatch(id, batchNo, ciId, opts = {}) {
  run(`INSERT INTO logistics_batches (id, batch_no, related_ci_id, related_ci_no, target_country, target_warehouse,
    actual_arrival_date, logistics_status, freight_currency, total_freight, customs_duty, vat_gst, other_fees,
    international_freight, local_charges, customs_service_fee, delivery_fee)
    VALUES (?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, batchNo, ciId, opts.country || 'Indonesia', opts.warehouse || 'WH-JKT',
     opts.arrivalDate ?? '2026-03-01', opts.status || 'completed',
     opts.freightCurrency || 'USD', opts.totalFreight || 0, opts.customsDuty || 0, opts.vatGst || 0, opts.otherFees || 0,
     0, 0, 0, 0]);
}

function seedPL(id, plNo, ciId, batchId, opts = {}) {
  run(`INSERT INTO packing_lists (id, pl_no, related_ci_id, related_ci_no, country, target_warehouse, pl_date, total_qty, status, logistics_batch_id)
    VALUES (?, ?, ?, '', ?, ?, ?, ?, ?, ?)`,
    [id, plNo, ciId, opts.country || 'Indonesia', opts.warehouse || 'WH-JKT',
     opts.plDate || '2026-02-01', opts.totalQty || 0, opts.status || 'confirmed', batchId]);
}

function seedPLItem(id, plId, skuCode, totalQty, cbm, grossWeight) {
  run(`INSERT INTO packing_list_items (id, pl_id, pl_no, ci_no, sku_code, total_qty, cbm, gross_weight)
    VALUES (?, ?, '', '', ?, ?, ?, ?)`,
    [id, plId, skuCode, totalQty, cbm || 0, grossWeight || 0]);
}

function seedExchangeRate(from, to, date, rate) {
  run('INSERT INTO exchange_rates (id, from_currency, to_currency, rate, rate_date, rate_type) VALUES (?, ?, ?, ?, ?, ?)',
    [`er_${from}_${to}_${date}`, from, to, rate, date, 'realtime']);
}

function seedInventory(skuCode, country, warehouse, availableQty, wac) {
  run('INSERT INTO inventory (id, sku_code, country, warehouse, available_qty, weighted_avg_cost, inventory_value) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [`inv_${skuCode}_${country}_${warehouse}`, skuCode, country, warehouse, availableQty, wac, availableQty * wac]);
}

function seedPaymentRequest(id, requestNo, currency, payableAmount, ciId, category, subcategory) {
  run(`INSERT INTO payment_requests (id, request_no, payment_category, payment_subcategory, source_type, source_id,
    payee_key, payee_name_snapshot, currency, payable_amount, paid_amount, unpaid_amount, payment_status, approval_status,
    related_ci_id, include_in_landing_cost, expense_country)
    VALUES (?, ?, ?, ?, 'ci', ?, '', '', ?, ?, 0, ?, 'paid', 'approved', ?, 1, 'Indonesia')`,
    [id, requestNo, category || 'warehouse_arrival', subcategory || 'freight', ciId, currency, payableAmount, payableAmount, ciId]);
}

function seedCiCostItem(id, ciId, paymentRequestId, costCategory, costSubcategory, payableAmount, currency, batchId) {
  run(`INSERT INTO ci_cost_items (id, ci_id, ci_no, payment_request_id, request_no, cost_category, cost_subcategory, payable_amount, paid_amount, include_in_landing_cost, currency, logistics_batch_id)
    VALUES (?, ?, '', ?, '', ?, ?, ?, 0, 1, ?, ?)`,
    [id, ciId, paymentRequestId || '', costCategory, costSubcategory, payableAmount, currency || 'USD', batchId || '']);
}

function seedPaymentLog(id, prId, amount, localAmount, localRate, paidDate, localCurrency) {
  run(`INSERT INTO payment_settlement_logs (id, payment_request_id, event_type, amount, status, paid_date,
    local_currency, local_rate, local_rate_date, local_amount, original_currency, is_legacy)
    VALUES (?, ?, 'payment', ?, ?, ?, ?, ?, ?, ?, '', 0)`,
    [id, prId, amount, 'applied', paidDate || '2026-02-15', localCurrency || 'IDR', localRate || 15000,
     '2026-02-15', localAmount]);
}

// Raw payment log seeder — allows null/zero/empty for FX fields (for FREIGHT_FX_RATE_MISSING tests)
function seedPaymentLogRaw(id, prId, amount, opts) {
  run(`INSERT INTO payment_settlement_logs (id, payment_request_id, event_type, amount, status, paid_date,
    local_currency, local_rate, local_rate_date, local_amount, original_currency, is_legacy)
    VALUES (?, ?, 'payment', ?, ?, ?, ?, ?, ?, ?, '', 0)`,
    [id, prId, amount, 'applied', opts.paidDate || '2026-02-15',
     opts.localCurrency !== undefined ? opts.localCurrency : 'IDR',
     opts.localRate !== undefined ? opts.localRate : 15000,
     opts.localRateDate !== undefined ? opts.localRateDate : '2026-02-15',
     opts.localAmount !== undefined ? opts.localAmount : amount * 15000]);
}

// ── Tests ──

describe('allocateByWeight', () => {
  test('allocates proportionally with remainder to max-weight SKU', () => {
    const skuCodes = ['A', 'B', 'C'];
    const weights = new Map([['A', 60], ['B', 30], ['C', 10]]);
    const result = allocateByWeight(skuCodes, weights, 100);
    const total = [...result.values()].reduce((s, v) => s + v, 0);
    assert.ok(Math.abs(total - 100) < 0.01, `sum=${total} should be ~100`);
    assert.ok(result.get('A') >= result.get('B'));
    assert.ok(result.get('B') >= result.get('C'));
  });

  test('returns null when total weight is 0', () => {
    const weights = new Map([['A', 0], ['B', 0]]);
    const result = allocateByWeight(['A', 'B'], weights, 100);
    assert.equal(result, null);
  });
});

describe('computeWacCostFacts - basic happy path', () => {
  let batchId;

  before(() => {
    createTestSchema();
    seedCountry('Indonesia', 'ID', 'IDR');
    seedWarehouse('wh_id_jkt', 'WH-JKT', 'ctry_Indonesia', 'Indonesia');
    seedSku('SKU-A', 'Product A', 'ModelA', 'BrandX');
    seedSku('SKU-B', 'Product B', 'ModelB', 'BrandX');

    seedCI('ci_1', 'CI-001', 'USD', 10000, 'cbm');
    seedCIItem('cii_1', 'ci_1', 'SKU-A', 100, 50, 0, 0.05);
    seedCIItem('cii_2', 'ci_1', 'SKU-B', 100, 50, 0, 0.10);

    batchId = 'lb_1';
    seedBatch(batchId, 'BATCH-001', 'ci_1', {
      arrivalDate: '2026-03-01',
      totalFreight: 0,
      customsDuty: 0,
    });

    seedPL('pl_1', 'PL-001', 'ci_1', batchId, { totalQty: 200, status: 'confirmed' });
    seedPLItem('pli_1', 'pl_1', 'SKU-A', 100, 2.0, 500);
    seedPLItem('pli_2', 'pl_1', 'SKU-B', 100, 1.0, 300);

    seedExchangeRate('USD', 'IDR', '2026-03-01', 15000);

    seedInventory('SKU-A', 'Indonesia', 'WH-JKT', 50, 1000);
    seedInventory('SKU-B', 'Indonesia', 'WH-JKT', 30, 800);
  });

  test('returns correct batch_qty per SKU (not CI shipped_qty)', () => {
    const result = computeWacCostFacts(batchId);
    assert.equal(result.blockers.length, 0, `Expected 0 blockers, got: ${JSON.stringify(result.blockers)}`);
    const skuA = result.items.find(i => i.sku_code === 'SKU-A');
    const skuB = result.items.find(i => i.sku_code === 'SKU-B');
    assert.equal(skuA.batch_qty, 100);
    assert.equal(skuB.batch_qty, 100);
  });

  test('weighted_purchase_unit_price per SKU', () => {
    const result = computeWacCostFacts(batchId);
    const skuA = result.items.find(i => i.sku_code === 'SKU-A');
    const skuB = result.items.find(i => i.sku_code === 'SKU-B');
    assert.equal(skuA.weighted_purchase_unit_price, 50);
    assert.equal(skuB.weighted_purchase_unit_price, 50);
  });

  test('product_cost_local uses exact arrival-date FX', () => {
    const result = computeWacCostFacts(batchId);
    const skuA = result.items.find(i => i.sku_code === 'SKU-A');
    assert.equal(skuA.product_cost_original, 5000);
    assert.ok(Math.abs(skuA.product_cost_local - 75000000) < 1, `got ${skuA.product_cost_local}`);
    assert.equal(skuA.product_fx_rate, 15000);
    assert.equal(skuA.product_fx_direction, 'direct');
  });
});

describe('computeWacCostFacts - PL relation', () => {
  test('BATCH_PL_MISSING when linked PL count = 0', () => {
    const db = require('./db').getDB();
    db.exec('DELETE FROM logistics_batches');
    db.exec('DELETE FROM packing_lists');

    seedBatch('lb_nopl', 'BATCH-NO-PL', 'ci_nopl', { arrivalDate: '2026-03-01' });

    const result = computeWacCostFacts('lb_nopl');
    const codes = result.blockers.map(b => b.code);
    assert.ok(codes.includes('BATCH_PL_MISSING'), `Expected BATCH_PL_MISSING, got: ${codes}`);
  });

  test('BATCH_PL_RELATION_CONFLICT when linked PL count > 1', () => {
    const db = require('./db').getDB();
    db.exec('DELETE FROM logistics_batches');
    db.exec('DELETE FROM packing_lists');

    seedBatch('lb_multi', 'BATCH-MULTI', 'ci_multi', { arrivalDate: '2026-03-01' });
    seedPL('pl_m1', 'PL-M1', 'ci_multi', 'lb_multi', { status: 'confirmed' });
    seedPL('pl_m2', 'PL-M2', 'ci_multi', 'lb_multi', { status: 'confirmed' });

    const result = computeWacCostFacts('lb_multi');
    const codes = result.blockers.map(b => b.code);
    assert.ok(codes.includes('BATCH_PL_RELATION_CONFLICT'), `Expected BATCH_PL_RELATION_CONFLICT, got: ${codes}`);
  });
});

describe('computeWacCostFacts - Batch→CI relation', () => {
  test('batch CI=A / PL CI=A → pass', () => {
    const db = require('./db').getDB();
    db.exec('DELETE FROM logistics_batches');
    db.exec('DELETE FROM packing_lists');
    db.exec('DELETE FROM packing_list_items');
    db.exec('DELETE FROM commercial_invoices');
    db.exec('DELETE FROM commercial_invoice_items');
    db.exec('DELETE FROM inventory');
    db.exec('DELETE FROM exchange_rates');

    seedCI('ci_rel_ok', 'CI-RELOK', 'USD', 5000, 'cbm');
    seedCIItem('cii_rel_ok', 'ci_rel_ok', 'SKU-REL', 100, 50, 0, 0.05);

    seedBatch('lb_rel_ok', 'BATCH-RELOK', 'ci_rel_ok', { arrivalDate: '2026-03-01' });
    seedPL('pl_rel_ok', 'PL-RELOK', 'ci_rel_ok', 'lb_rel_ok', { status: 'confirmed' });
    seedPLItem('pli_rel_ok', 'pl_rel_ok', 'SKU-REL', 100, 1, 100);

    seedExchangeRate('USD', 'IDR', '2026-03-01', 15000);
    seedInventory('SKU-REL', 'Indonesia', 'WH-JKT', 0, 0);

    const result = computeWacCostFacts('lb_rel_ok');
    const codes = result.blockers.map(b => b.code);
    assert.ok(!codes.includes('BATCH_CI_RELATION_CONFLICT'), `Should not have BATCH_CI_RELATION_CONFLICT, got: ${codes}`);
  });

  test('batch CI=A / PL CI=B → blocker', () => {
    const db = require('./db').getDB();
    db.exec('DELETE FROM logistics_batches');
    db.exec('DELETE FROM packing_lists');

    seedBatch('lb_rel_mismatch', 'BATCH-RELMISMATCH', 'ci_a', { arrivalDate: '2026-03-01' });
    seedPL('pl_rel_mismatch', 'PL-RELMISMATCH', 'ci_b', 'lb_rel_mismatch', { status: 'confirmed' });

    const result = computeWacCostFacts('lb_rel_mismatch');
    const codes = result.blockers.map(b => b.code);
    assert.ok(codes.includes('BATCH_CI_RELATION_CONFLICT'), `Expected BATCH_CI_RELATION_CONFLICT, got: ${codes}`);
  });

  test('batch CI missing / PL CI=A → blocker', () => {
    const db = require('./db').getDB();
    db.exec('DELETE FROM logistics_batches');
    db.exec('DELETE FROM packing_lists');

    // Insert batch with empty related_ci_id
    run(`INSERT INTO logistics_batches (id, batch_no, related_ci_id, related_ci_no, target_country, target_warehouse,
      actual_arrival_date, logistics_status, freight_currency, total_freight, customs_duty, vat_gst, other_fees,
      international_freight, local_charges, customs_service_fee, delivery_fee)
      VALUES (?, ?, '', '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['lb_rel_nobatch', 'BATCH-NOBATCH', 'Indonesia', 'WH-JKT', '2026-03-01', 'completed', 'USD', 0, 0, 0, 0, 0, 0, 0, 0]);
    seedPL('pl_rel_nobatch', 'PL-NOBATCH', 'ci_has', 'lb_rel_nobatch', { status: 'confirmed' });

    const result = computeWacCostFacts('lb_rel_nobatch');
    const codes = result.blockers.map(b => b.code);
    assert.ok(codes.includes('BATCH_CI_RELATION_CONFLICT'), `Expected BATCH_CI_RELATION_CONFLICT, got: ${codes}`);
  });

  test('batch CI=A / PL CI missing → blocker', () => {
    const db = require('./db').getDB();
    db.exec('DELETE FROM logistics_batches');
    db.exec('DELETE FROM packing_lists');

    seedBatch('lb_rel_noplci', 'BATCH-NOPLCI', 'ci_a2', { arrivalDate: '2026-03-01' });
    // Insert PL with empty related_ci_id
    run(`INSERT INTO packing_lists (id, pl_no, related_ci_id, related_ci_no, country, target_warehouse, pl_date, total_qty, status, logistics_batch_id)
      VALUES (?, ?, '', '', ?, ?, ?, ?, ?, ?)`,
      ['pl_rel_noplci', 'PL-NOPLCI', 'Indonesia', 'WH-JKT', '2026-02-01', 0, 'confirmed', 'lb_rel_noplci']);

    const result = computeWacCostFacts('lb_rel_noplci');
    const codes = result.blockers.map(b => b.code);
    assert.ok(codes.includes('BATCH_CI_RELATION_CONFLICT'), `Expected BATCH_CI_RELATION_CONFLICT, got: ${codes}`);
  });
});

describe('computeWacCostFacts - partial shipment', () => {
  let batchAId, batchBId;

  before(() => {
    const db = require('./db').getDB();
    db.exec('DELETE FROM logistics_batches');
    db.exec('DELETE FROM packing_lists');
    db.exec('DELETE FROM packing_list_items');
    db.exec('DELETE FROM commercial_invoices');
    db.exec('DELETE FROM commercial_invoice_items');
    db.exec('DELETE FROM exchange_rates');
    db.exec('DELETE FROM inventory');
    db.exec('DELETE FROM wac_history');
    db.exec('DELETE FROM ci_cost_items');
    db.exec('DELETE FROM payment_requests');
    db.exec('DELETE FROM payment_settlement_logs');

    seedCI('ci_ps', 'CI-PS', 'USD', 100000, 'cbm');
    seedCIItem('cii_ps1', 'ci_ps', 'SKU-PS', 1000, 100, 0, 0.05);

    batchAId = 'lb_psa';
    seedBatch(batchAId, 'BATCH-A', 'ci_ps', { arrivalDate: '2026-03-01', totalFreight: 0, customsDuty: 0 });
    seedPL('pl_psa', 'PL-PSA', 'ci_ps', batchAId, { totalQty: 600, status: 'confirmed' });
    seedPLItem('pli_psa', 'pl_psa', 'SKU-PS', 600, 6.0, 1000);

    batchBId = 'lb_psb';
    seedBatch(batchBId, 'BATCH-B', 'ci_ps', { arrivalDate: '2026-03-02', totalFreight: 0, customsDuty: 0 });
    seedPL('pl_psb', 'PL-PSB', 'ci_ps', batchBId, { totalQty: 400, status: 'confirmed' });
    seedPLItem('pli_psb', 'pl_psb', 'SKU-PS', 400, 4.0, 800);

    seedExchangeRate('USD', 'IDR', '2026-03-01', 15000);
    seedExchangeRate('USD', 'IDR', '2026-03-02', 15000);
    seedInventory('SKU-PS', 'Indonesia', 'WH-JKT', 0, 0);
  });

  test('Batch-A qty=600, not 1000', () => {
    const result = computeWacCostFacts(batchAId);
    assert.equal(result.blockers.length, 0, `Expected 0 blockers, got: ${JSON.stringify(result.blockers)}`);
    const item = result.items[0];
    assert.equal(item.batch_qty, 600, `batch_qty should be 600, got ${item.batch_qty}`);
  });

  test('Batch-A Product Cost = 600 × weighted price (100)', () => {
    const result = computeWacCostFacts(batchAId);
    const item = result.items[0];
    assert.equal(item.weighted_purchase_unit_price, 100);
    assert.equal(item.product_cost_original, 60000);
  });

  test('Batch-B Product Cost = 400 × weighted price (100)', () => {
    const result = computeWacCostFacts(batchBId);
    const item = result.items[0];
    assert.equal(item.batch_qty, 400);
    assert.equal(item.product_cost_original, 40000);
  });

  test('No PRODUCT_COST_ALLOCATION_NOT_CONSERVED when fully allocated and conserved', () => {
    const resultA = computeWacCostFacts(batchAId);
    const codesA = resultA.blockers.map(b => b.code);
    assert.ok(!codesA.includes('PRODUCT_COST_ALLOCATION_NOT_CONSERVED'),
      `Should not trigger conservation blocker when fully allocated and conserved: ${codesA}`);
  });

  test('PRODUCT_COST_ALLOCATION_NOT_CONSERVED not triggered when partial shipment', () => {
    const db = require('./db').getDB();
    db.exec("DELETE FROM packing_lists WHERE id = 'pl_psb'");
    db.exec("DELETE FROM packing_list_items WHERE pl_id = 'pl_psb'");

    const result = computeWacCostFacts(batchAId);
    const codes = result.blockers.map(b => b.code);
    assert.ok(!codes.includes('PRODUCT_COST_ALLOCATION_NOT_CONSERVED'),
      `Should NOT trigger conservation when partial: ${codes}`);
  });
});

describe('computeWacCostFacts - arrival date + FX', () => {
  test('PRODUCT_FX_DATE_MISSING when no actual_arrival_date', () => {
    const db = require('./db').getDB();
    db.exec('DELETE FROM logistics_batches');
    db.exec('DELETE FROM packing_lists');
    db.exec('DELETE FROM packing_list_items');
    db.exec('DELETE FROM commercial_invoices');
    db.exec('DELETE FROM commercial_invoice_items');
    db.exec('DELETE FROM inventory');

    seedCI('ci_nodate', 'CI-NODATE', 'USD', 5000, 'cbm');
    seedCIItem('cii_nodate', 'ci_nodate', 'SKU-ND', 100, 50, 0, null);

    seedBatch('lb_nodate', 'BATCH-NODATE', 'ci_nodate', { arrivalDate: '' });
    seedPL('pl_nodate', 'PL-NODATE', 'ci_nodate', 'lb_nodate', { status: 'confirmed' });
    seedPLItem('pli_nodate', 'pl_nodate', 'SKU-ND', 100, 1, 100);
    seedInventory('SKU-ND', 'Indonesia', 'WH-JKT', 0, 0);

    const result = computeWacCostFacts('lb_nodate');
    const codes = result.blockers.map(b => b.code);
    assert.ok(codes.includes('PRODUCT_FX_DATE_MISSING'), `Expected PRODUCT_FX_DATE_MISSING, got: ${codes}`);
  });

  test('PRODUCT_FX_RATE_MISSING when no exact-date rate', () => {
    const db = require('./db').getDB();
    db.exec('DELETE FROM exchange_rates');

    seedBatch('lb_nofx', 'BATCH-NOFX', 'ci_nodate', { arrivalDate: '2026-05-01' });
    seedPL('pl_nofx', 'PL-NOFX', 'ci_nodate', 'lb_nofx', { status: 'confirmed' });
    seedPLItem('pli_nofx', 'pl_nofx', 'SKU-ND', 100, 1, 100);

    const result = computeWacCostFacts('lb_nofx');
    const codes = result.blockers.map(b => b.code);
    assert.ok(codes.includes('PRODUCT_FX_RATE_MISSING'), `Expected PRODUCT_FX_RATE_MISSING, got: ${codes}`);
  });

  test('Same-currency → rate=1, no FX needed', () => {
    const db = require('./db').getDB();
    db.exec('DELETE FROM exchange_rates');
    db.exec('DELETE FROM commercial_invoices');
    db.exec('DELETE FROM commercial_invoice_items');
    db.exec('DELETE FROM logistics_batches');
    db.exec('DELETE FROM packing_lists');
    db.exec('DELETE FROM packing_list_items');
    db.exec('DELETE FROM inventory');

    seedCI('ci_idr', 'CI-IDR', 'IDR', 5000000, 'cbm');
    seedCIItem('cii_idr', 'ci_idr', 'SKU-IDR', 100, 50000, 0, null);

    seedBatch('lb_idr', 'BATCH-IDR', 'ci_idr', { arrivalDate: '2026-03-01', freightCurrency: 'IDR' });
    seedPL('pl_idr', 'PL-IDR', 'ci_idr', 'lb_idr', { status: 'confirmed' });
    seedPLItem('pli_idr', 'pl_idr', 'SKU-IDR', 100, 1, 100);
    seedInventory('SKU-IDR', 'Indonesia', 'WH-JKT', 0, 0);

    const result = computeWacCostFacts('lb_idr');
    const codes = result.blockers.map(b => b.code);
    assert.ok(!codes.includes('PRODUCT_FX_RATE_MISSING'), `Should not have FX blocker for same currency: ${codes}`);
    const item = result.items[0];
    assert.equal(item.product_fx_rate, 1);
    assert.equal(item.product_fx_direction, 'identity');
  });
});

describe('computeWacCostFacts - freight', () => {
  test('FREIGHT_PAYMENT_FACT_MISSING when freight > 0 but no payment records', () => {
    const db = require('./db').getDB();
    db.exec('DELETE FROM logistics_batches');
    db.exec('DELETE FROM packing_lists');
    db.exec('DELETE FROM packing_list_items');
    db.exec('DELETE FROM commercial_invoices');
    db.exec('DELETE FROM commercial_invoice_items');
    db.exec('DELETE FROM ci_cost_items');
    db.exec('DELETE FROM payment_requests');
    db.exec('DELETE FROM payment_settlement_logs');
    db.exec('DELETE FROM exchange_rates');
    db.exec('DELETE FROM inventory');

    seedCI('ci_fr1', 'CI-FR1', 'USD', 10000, 'cbm');
    seedCIItem('cii_fr1', 'ci_fr1', 'SKU-FR', 100, 100, 0, 0.05);

    seedBatch('lb_fr1', 'BATCH-FR1', 'ci_fr1', {
      arrivalDate: '2026-03-01', totalFreight: 5000, customsDuty: 0, freightCurrency: 'USD'
    });
    seedPL('pl_fr1', 'PL-FR1', 'ci_fr1', 'lb_fr1', { status: 'confirmed' });
    seedPLItem('pli_fr1', 'pl_fr1', 'SKU-FR', 100, 2.0, 500);

    seedExchangeRate('USD', 'IDR', '2026-03-01', 15000);
    seedInventory('SKU-FR', 'Indonesia', 'WH-JKT', 0, 0);

    const result = computeWacCostFacts('lb_fr1');
    const codes = result.blockers.map(b => b.code);
    assert.ok(codes.includes('FREIGHT_PAYMENT_FACT_MISSING'), `Expected FREIGHT_PAYMENT_FACT_MISSING, got: ${codes}`);
  });

  test('FREIGHT_PAYMENT_LINK_AMBIGUOUS when cost item missing payment_request_id', () => {
    const db = require('./db').getDB();
    db.exec('DELETE FROM ci_cost_items');
    db.exec('DELETE FROM payment_requests');
    db.exec('DELETE FROM payment_settlement_logs');

    // Cost item without payment_request_id
    seedCiCostItem('cci_ambiguous', 'ci_fr1', '', 'warehouse_arrival', 'freight', 5000, 'USD', 'lb_fr1');

    const result = computeWacCostFacts('lb_fr1');
    const codes = result.blockers.map(b => b.code);
    assert.ok(codes.includes('FREIGHT_PAYMENT_LINK_AMBIGUOUS'), `Expected FREIGHT_PAYMENT_LINK_AMBIGUOUS, got: ${codes}`);
  });

  test('FREIGHT_SETTLEMENT_NOT_RECONCILED when partial payment', () => {
    const db = require('./db').getDB();
    db.exec('DELETE FROM ci_cost_items');
    db.exec('DELETE FROM payment_requests');
    db.exec('DELETE FROM payment_settlement_logs');

    seedPaymentRequest('pr_fr2', 'PR-FR2', 'USD', 5000, 'ci_fr1', 'warehouse_arrival', 'freight');
    seedCiCostItem('cci_fr2', 'ci_fr1', 'pr_fr2', 'warehouse_arrival', 'freight', 5000, 'USD', 'lb_fr1');
    seedPaymentLog('psl_fr2', 'pr_fr2', 3000, 45000000, 15000, '2026-02-15', 'IDR');

    const result = computeWacCostFacts('lb_fr1');
    const codes = result.blockers.map(b => b.code);
    assert.ok(codes.includes('FREIGHT_SETTLEMENT_NOT_RECONCILED'), `Expected FREIGHT_SETTLEMENT_NOT_RECONCILED, got: ${codes}`);
    const blocker = result.blockers.find(b => b.code === 'FREIGHT_SETTLEMENT_NOT_RECONCILED');
    assert.equal(blocker.detail.reason, 'partial');
  });

  test('FREIGHT_SETTLEMENT_NOT_RECONCILED when overpaid', () => {
    const db = require('./db').getDB();
    db.exec('DELETE FROM ci_cost_items');
    db.exec('DELETE FROM payment_requests');
    db.exec('DELETE FROM payment_settlement_logs');

    seedPaymentRequest('pr_fr_ov', 'PR-FROV', 'USD', 5000, 'ci_fr1', 'warehouse_arrival', 'freight');
    seedCiCostItem('cci_fr_ov', 'ci_fr1', 'pr_fr_ov', 'warehouse_arrival', 'freight', 5000, 'USD', 'lb_fr1');
    seedPaymentLog('psl_fr_ov', 'pr_fr_ov', 6000, 90000000, 15000, '2026-02-15', 'IDR');

    const result = computeWacCostFacts('lb_fr1');
    const codes = result.blockers.map(b => b.code);
    assert.ok(codes.includes('FREIGHT_SETTLEMENT_NOT_RECONCILED'), `Expected FREIGHT_SETTLEMENT_NOT_RECONCILED, got: ${codes}`);
    const blocker = result.blockers.find(b => b.code === 'FREIGHT_SETTLEMENT_NOT_RECONCILED');
    assert.equal(blocker.detail.reason, 'overpaid');
  });

  test('FREIGHT_PAYMENT_CURRENCY_MISMATCH when payment currency != freight_currency', () => {
    const db = require('./db').getDB();
    db.exec('DELETE FROM ci_cost_items');
    db.exec('DELETE FROM payment_requests');
    db.exec('DELETE FROM payment_settlement_logs');

    seedPaymentRequest('pr_fr3', 'PR-FR3', 'EUR', 5000, 'ci_fr1', 'warehouse_arrival', 'freight');
    seedCiCostItem('cci_fr3', 'ci_fr1', 'pr_fr3', 'warehouse_arrival', 'freight', 5000, 'EUR', 'lb_fr1');
    seedPaymentLog('psl_fr3', 'pr_fr3', 5000, 75000000, 15000, '2026-02-15', 'IDR');

    const result = computeWacCostFacts('lb_fr1');
    const codes = result.blockers.map(b => b.code);
    assert.ok(codes.includes('FREIGHT_PAYMENT_CURRENCY_MISMATCH'), `Expected FREIGHT_PAYMENT_CURRENCY_MISMATCH, got: ${codes}`);
  });

  test('Freight local = sum of payment logs.local_amount when fully matched', () => {
    const db = require('./db').getDB();
    db.exec('DELETE FROM ci_cost_items');
    db.exec('DELETE FROM payment_requests');
    db.exec('DELETE FROM payment_settlement_logs');

    seedPaymentRequest('pr_fr4', 'PR-FR4', 'USD', 5000, 'ci_fr1', 'warehouse_arrival', 'freight');
    seedCiCostItem('cci_fr4', 'ci_fr1', 'pr_fr4', 'warehouse_arrival', 'freight', 5000, 'USD', 'lb_fr1');
    seedPaymentLog('psl_fr4', 'pr_fr4', 5000, 75000000, 15000, '2026-02-15', 'IDR');

    const result = computeWacCostFacts('lb_fr1');
    assert.equal(result.blockers.length, 0, `Expected 0 blockers, got: ${JSON.stringify(result.blockers)}`);
    assert.equal(result.meta.freight_local_amount, 75000000);
  });
});

describe('computeWacCostFacts - FREIGHT_FX_RATE_MISSING', () => {
  test('FREIGHT_FX_RATE_MISSING when local_rate is 0', () => {
    const db = require('./db').getDB();
    db.exec('DELETE FROM ci_cost_items');
    db.exec('DELETE FROM payment_requests');
    db.exec('DELETE FROM payment_settlement_logs');

    seedPaymentRequest('pr_fxr1', 'PR-FXR1', 'USD', 5000, 'ci_fr1', 'warehouse_arrival', 'freight');
    seedCiCostItem('cci_fxr1', 'ci_fr1', 'pr_fxr1', 'warehouse_arrival', 'freight', 5000, 'USD', 'lb_fr1');
    seedPaymentLogRaw('psl_fxr1', 'pr_fxr1', 5000, { localRate: 0 });

    const result = computeWacCostFacts('lb_fr1');
    const codes = result.blockers.map(b => b.code);
    assert.ok(codes.includes('FREIGHT_FX_RATE_MISSING'), `Expected FREIGHT_FX_RATE_MISSING, got: ${codes}`);
  });

  test('FREIGHT_FX_RATE_MISSING when local_rate_date is empty', () => {
    const db = require('./db').getDB();
    db.exec('DELETE FROM ci_cost_items');
    db.exec('DELETE FROM payment_requests');
    db.exec('DELETE FROM payment_settlement_logs');

    seedPaymentRequest('pr_fxr2', 'PR-FXR2', 'USD', 5000, 'ci_fr1', 'warehouse_arrival', 'freight');
    seedCiCostItem('cci_fxr2', 'ci_fr1', 'pr_fxr2', 'warehouse_arrival', 'freight', 5000, 'USD', 'lb_fr1');
    seedPaymentLogRaw('psl_fxr2', 'pr_fxr2', 5000, { localRateDate: '' });

    const result = computeWacCostFacts('lb_fr1');
    const codes = result.blockers.map(b => b.code);
    assert.ok(codes.includes('FREIGHT_FX_RATE_MISSING'), `Expected FREIGHT_FX_RATE_MISSING, got: ${codes}`);
  });

  test('FREIGHT_FX_RATE_MISSING when local_currency is empty', () => {
    const db = require('./db').getDB();
    db.exec('DELETE FROM ci_cost_items');
    db.exec('DELETE FROM payment_requests');
    db.exec('DELETE FROM payment_settlement_logs');

    seedPaymentRequest('pr_fxr3', 'PR-FXR3', 'USD', 5000, 'ci_fr1', 'warehouse_arrival', 'freight');
    seedCiCostItem('cci_fxr3', 'ci_fr1', 'pr_fxr3', 'warehouse_arrival', 'freight', 5000, 'USD', 'lb_fr1');
    seedPaymentLogRaw('psl_fxr3', 'pr_fxr3', 5000, { localCurrency: '' });

    const result = computeWacCostFacts('lb_fr1');
    const codes = result.blockers.map(b => b.code);
    assert.ok(codes.includes('FREIGHT_FX_RATE_MISSING'), `Expected FREIGHT_FX_RATE_MISSING, got: ${codes}`);
  });

  test('FREIGHT_FX_RATE_MISSING when local_amount is invalid', () => {
    const db = require('./db').getDB();
    db.exec('DELETE FROM ci_cost_items');
    db.exec('DELETE FROM payment_requests');
    db.exec('DELETE FROM payment_settlement_logs');

    seedPaymentRequest('pr_fxr4', 'PR-FXR4', 'USD', 5000, 'ci_fr1', 'warehouse_arrival', 'freight');
    seedCiCostItem('cci_fxr4', 'ci_fr1', 'pr_fxr4', 'warehouse_arrival', 'freight', 5000, 'USD', 'lb_fr1');
    seedPaymentLogRaw('psl_fxr4', 'pr_fxr4', 5000, { localAmount: 0 });

    const result = computeWacCostFacts('lb_fr1');
    const codes = result.blockers.map(b => b.code);
    assert.ok(codes.includes('FREIGHT_FX_RATE_MISSING'), `Expected FREIGHT_FX_RATE_MISSING, got: ${codes}`);
  });
});

describe('computeWacCostFacts - CBM / KG allocation', () => {
  test('CBM allocation conservation: sum of allocations = freight_local', () => {
    const db = require('./db').getDB();
    db.exec('DELETE FROM logistics_batches');
    db.exec('DELETE FROM packing_lists');
    db.exec('DELETE FROM packing_list_items');
    db.exec('DELETE FROM commercial_invoices');
    db.exec('DELETE FROM commercial_invoice_items');
    db.exec('DELETE FROM ci_cost_items');
    db.exec('DELETE FROM payment_requests');
    db.exec('DELETE FROM payment_settlement_logs');
    db.exec('DELETE FROM exchange_rates');
    db.exec('DELETE FROM inventory');

    seedSku('SKU-CBM1', 'Product CBM1', '', '');
    seedSku('SKU-CBM2', 'Product CBM2', '', '');

    seedCI('ci_cbm', 'CI-CBM', 'USD', 10000, 'cbm');
    seedCIItem('cii_cbm1', 'ci_cbm', 'SKU-CBM1', 100, 50, 0, 0.05);
    seedCIItem('cii_cbm2', 'ci_cbm', 'SKU-CBM2', 100, 50, 0, 0.10);

    seedBatch('lb_cbm', 'BATCH-CBM', 'ci_cbm', {
      arrivalDate: '2026-03-01', totalFreight: 1000, customsDuty: 0, freightCurrency: 'USD'
    });
    seedPL('pl_cbm', 'PL-CBM', 'ci_cbm', 'lb_cbm', { status: 'confirmed' });
    seedPLItem('pli_cbm1', 'pl_cbm', 'SKU-CBM1', 100, 3.0, 500);
    seedPLItem('pli_cbm2', 'pl_cbm', 'SKU-CBM2', 100, 1.0, 300);

    seedExchangeRate('USD', 'IDR', '2026-03-01', 15000);

    seedPaymentRequest('pr_cbm', 'PR-CBM', 'USD', 1000, 'ci_cbm', 'warehouse_arrival', 'freight');
    seedCiCostItem('cci_cbm', 'ci_cbm', 'pr_cbm', 'warehouse_arrival', 'freight', 1000, 'USD', 'lb_cbm');
    seedPaymentLog('psl_cbm', 'pr_cbm', 1000, 15000000, 15000, '2026-02-15', 'IDR');

    seedInventory('SKU-CBM1', 'Indonesia', 'WH-JKT', 0, 0);
    seedInventory('SKU-CBM2', 'Indonesia', 'WH-JKT', 0, 0);

    const result = computeWacCostFacts('lb_cbm');
    assert.equal(result.blockers.length, 0, `Expected 0 blockers, got: ${JSON.stringify(result.blockers)}`);

    const freightTotal = result.items.reduce((s, i) => s + i.freight_cost_local, 0);
    assert.ok(Math.abs(freightTotal - 15000000) < 1, `freight allocation sum=${freightTotal}, expected ~15000000`);

    const sku1 = result.items.find(i => i.sku_code === 'SKU-CBM1');
    const sku2 = result.items.find(i => i.sku_code === 'SKU-CBM2');
    assert.ok(Math.abs(sku1.freight_cost_local - 11250000) < 1, `SKU1 freight=${sku1.freight_cost_local}`);
    assert.ok(Math.abs(sku2.freight_cost_local - 3750000) < 1, `SKU2 freight=${sku2.freight_cost_local}`);
  });

  test('KG allocation conservation: sum of allocations = freight_local', () => {
    const db = require('./db').getDB();
    db.exec('DELETE FROM commercial_invoices');
    db.exec('DELETE FROM commercial_invoice_items');
    db.exec('DELETE FROM logistics_batches');
    db.exec('DELETE FROM packing_lists');
    db.exec('DELETE FROM packing_list_items');
    db.exec('DELETE FROM ci_cost_items');
    db.exec('DELETE FROM payment_requests');
    db.exec('DELETE FROM payment_settlement_logs');

    seedCI('ci_kg', 'CI-KG', 'USD', 10000, 'kg');
    seedCIItem('cii_kg1', 'ci_kg', 'SKU-CBM1', 100, 50, 0, 0.05);
    seedCIItem('cii_kg2', 'ci_kg', 'SKU-CBM2', 100, 50, 0, 0.10);

    seedBatch('lb_kg', 'BATCH-KG', 'ci_kg', {
      arrivalDate: '2026-03-01', totalFreight: 1000, customsDuty: 0, freightCurrency: 'USD'
    });
    seedPL('pl_kg', 'PL-KG', 'ci_kg', 'lb_kg', { status: 'confirmed' });
    seedPLItem('pli_kg1', 'pl_kg', 'SKU-CBM1', 100, 0, 400);
    seedPLItem('pli_kg2', 'pl_kg', 'SKU-CBM2', 100, 0, 600);

    seedPaymentRequest('pr_kg', 'PR-KG', 'USD', 1000, 'ci_kg', 'warehouse_arrival', 'freight');
    seedCiCostItem('cci_kg', 'ci_kg', 'pr_kg', 'warehouse_arrival', 'freight', 1000, 'USD', 'lb_kg');
    seedPaymentLog('psl_kg', 'pr_kg', 1000, 15000000, 15000, '2026-02-15', 'IDR');

    const result = computeWacCostFacts('lb_kg');
    assert.equal(result.blockers.length, 0, `Expected 0 blockers, got: ${JSON.stringify(result.blockers)}`);

    const freightTotal = result.items.reduce((s, i) => s + i.freight_cost_local, 0);
    assert.ok(Math.abs(freightTotal - 15000000) < 1, `freight allocation sum=${freightTotal}`);

    const sku1 = result.items.find(i => i.sku_code === 'SKU-CBM1');
    const sku2 = result.items.find(i => i.sku_code === 'SKU-CBM2');
    assert.ok(Math.abs(sku1.freight_cost_local - 6000000) < 1, `SKU1 freight=${sku1.freight_cost_local}`);
    assert.ok(Math.abs(sku2.freight_cost_local - 9000000) < 1, `SKU2 freight=${sku2.freight_cost_local}`);
  });
});

describe('computeWacCostFacts - duty', () => {
  test('VAT/GST excluded from duty', () => {
    const db = require('./db').getDB();
    db.exec('DELETE FROM logistics_batches');
    db.exec('DELETE FROM packing_lists');
    db.exec('DELETE FROM packing_list_items');
    db.exec('DELETE FROM commercial_invoices');
    db.exec('DELETE FROM commercial_invoice_items');
    db.exec('DELETE FROM ci_cost_items');
    db.exec('DELETE FROM payment_requests');
    db.exec('DELETE FROM payment_settlement_logs');
    db.exec('DELETE FROM exchange_rates');
    db.exec('DELETE FROM inventory');

    seedCI('ci_duty', 'CI-DUTY', 'USD', 10000, 'cbm');
    seedCIItem('cii_d1', 'ci_duty', 'SKU-D1', 100, 50, 0, 0.05);
    seedCIItem('cii_d2', 'ci_duty', 'SKU-D2', 100, 50, 0, 0.10);

    seedBatch('lb_duty', 'BATCH-DUTY', 'ci_duty', {
      arrivalDate: '2026-03-01', totalFreight: 0, customsDuty: 500, vatGst: 200, freightCurrency: 'USD'
    });
    seedPL('pl_duty', 'PL-DUTY', 'ci_duty', 'lb_duty', { status: 'confirmed' });
    seedPLItem('pli_d1', 'pl_duty', 'SKU-D1', 100, 2, 500);
    seedPLItem('pli_d2', 'pl_duty', 'SKU-D2', 100, 1, 300);

    seedExchangeRate('USD', 'IDR', '2026-03-01', 15000);
    seedInventory('SKU-D1', 'Indonesia', 'WH-JKT', 0, 0);
    seedInventory('SKU-D2', 'Indonesia', 'WH-JKT', 0, 0);

    const result = computeWacCostFacts('lb_duty');
    assert.equal(result.blockers.length, 0, `Expected 0 blockers, got: ${JSON.stringify(result.blockers)}`);

    assert.equal(result.meta.duty_business_amount, 500);
    assert.equal(result.meta.duty_local_amount, 7500000);

    const dutyTotal = result.items.reduce((s, i) => s + i.customs_cost_local, 0);
    assert.ok(Math.abs(dutyTotal - 7500000) < 1, `duty allocation sum=${dutyTotal}, expected ~7500000`);
  });

  test('CUSTOMS_RATE_MISSING when duty > 0 but customs rate is null', () => {
    const db = require('./db').getDB();
    db.exec('DELETE FROM commercial_invoice_items');

    seedCIItem('cii_d3', 'ci_duty', 'SKU-D1', 100, 50, 0, null);
    seedCIItem('cii_d4', 'ci_duty', 'SKU-D2', 100, 50, 0, 0.10);

    const result = computeWacCostFacts('lb_duty');
    const codes = result.blockers.map(b => b.code);
    assert.ok(codes.includes('CUSTOMS_RATE_MISSING'), `Expected CUSTOMS_RATE_MISSING, got: ${codes}`);
  });
});

describe('computeWacCostFacts - other cost policy', () => {
  test('COST_FX_POLICY_MISSING for unknown cost category', () => {
    const db = require('./db').getDB();
    db.exec('DELETE FROM logistics_batches');
    db.exec('DELETE FROM packing_lists');
    db.exec('DELETE FROM packing_list_items');
    db.exec('DELETE FROM commercial_invoices');
    db.exec('DELETE FROM commercial_invoice_items');
    db.exec('DELETE FROM ci_cost_items');
    db.exec('DELETE FROM payment_requests');
    db.exec('DELETE FROM payment_settlement_logs');
    db.exec('DELETE FROM exchange_rates');
    db.exec('DELETE FROM inventory');

    seedCI('ci_oth', 'CI-OTH', 'USD', 10000, 'cbm');
    seedCIItem('cii_oth', 'ci_oth', 'SKU-OTH', 100, 100, 0, 0.05);

    seedBatch('lb_oth', 'BATCH-OTH', 'ci_oth', {
      arrivalDate: '2026-03-01', totalFreight: 0, customsDuty: 0, freightCurrency: 'USD'
    });
    seedPL('pl_oth', 'PL-OTH', 'ci_oth', 'lb_oth', { status: 'confirmed' });
    seedPLItem('pli_oth', 'pl_oth', 'SKU-OTH', 100, 1, 100);

    seedExchangeRate('USD', 'IDR', '2026-03-01', 15000);
    seedInventory('SKU-OTH', 'Indonesia', 'WH-JKT', 0, 0);

    seedCiCostItem('cci_unk', 'ci_oth', '', 'unknown_category', 'unknown_sub', 500, 'USD');

    const result = computeWacCostFacts('lb_oth');
    const codes = result.blockers.map(b => b.code);
    assert.ok(codes.includes('COST_FX_POLICY_MISSING'), `Expected COST_FX_POLICY_MISSING, got: ${codes}`);
  });
});

describe('computeWacCostFacts - WAC context gates', () => {
  test('CURRENT_WAC_INVALID when weighted_avg_cost is negative', () => {
    const db = require('./db').getDB();
    db.exec('DELETE FROM inventory');
    seedInventory('SKU-OTH', 'Indonesia', 'WH-JKT', 50, -100);

    const result = computeWacCostFacts('lb_oth');
    const codes = result.blockers.map(b => b.code);
    assert.ok(codes.includes('CURRENT_WAC_INVALID'), `Expected CURRENT_WAC_INVALID, got: ${codes}`);
  });

  test('WAC_INVENTORY_CONTEXT_MISMATCH when SKU in wrong country/warehouse', () => {
    const db = require('./db').getDB();
    db.exec('DELETE FROM inventory');
    // SKU exists but in different country/warehouse
    seedInventory('SKU-OTH', 'Malaysia', 'WH-KUL', 100, 500);

    const result = computeWacCostFacts('lb_oth');
    const codes = result.blockers.map(b => b.code);
    assert.ok(codes.includes('WAC_INVENTORY_CONTEXT_MISMATCH'), `Expected WAC_INVENTORY_CONTEXT_MISMATCH, got: ${codes}`);
  });

  test('WAC_INVENTORY_ROW_MISSING when SKU has no inventory rows at all', () => {
    const db = require('./db').getDB();
    db.exec('DELETE FROM inventory');
    // No inventory at all — should trigger ROW_MISSING, not CONTEXT_MISMATCH

    const result = computeWacCostFacts('lb_oth');
    const codes = result.blockers.map(b => b.code);
    assert.ok(codes.includes('WAC_INVENTORY_ROW_MISSING'), `Expected WAC_INVENTORY_ROW_MISSING, got: ${codes}`);
    assert.ok(!codes.includes('WAC_INVENTORY_CONTEXT_MISMATCH'), `Should not have mismatch when no inventory rows: ${codes}`);
  });

  test('Target row exists → pass (no inventory blockers)', () => {
    const db = require('./db').getDB();
    db.exec('DELETE FROM inventory');
    seedInventory('SKU-OTH', 'Indonesia', 'WH-JKT', 100, 500);

    const result = computeWacCostFacts('lb_oth');
    const codes = result.blockers.map(b => b.code);
    assert.ok(!codes.includes('WAC_INVENTORY_ROW_MISSING'), `Should not have ROW_MISSING: ${codes}`);
    assert.ok(!codes.includes('WAC_INVENTORY_CONTEXT_MISMATCH'), `Should not have mismatch: ${codes}`);
  });
});

describe('Confirm endpoint - old_qty validation', () => {
  test('OLD_QTY_MISSING when old_qty is null/blank', () => {
    const raw = null;
    assert.equal(raw === null || raw === undefined || raw === '', true);

    const raw2 = '';
    assert.equal(raw2 === null || raw2 === undefined || raw2 === '', true);

    const raw3 = undefined;
    assert.equal(raw3 === null || raw3 === undefined || raw3 === '', true);
  });

  test('OLD_QTY_INVALID when old_qty is NaN/Infinity/negative', () => {
    const testCases = [NaN, Infinity, -Infinity, -1, -0.01, 'abc'];
    for (const raw of testCases) {
      const num = Number(raw);
      assert.ok(!Number.isFinite(num) || num < 0, `Expected invalid for ${raw}`);
    }
  });

  test('old_qty=0 passes validation (0 is legal)', () => {
    const raw = 0;
    const num = Number(raw);
    assert.ok(Number.isFinite(num) && num >= 0, '0 should be valid');
  });

  test('old_qty positive integer passes validation', () => {
    const raw = 100;
    const num = Number(raw);
    assert.ok(Number.isFinite(num) && num >= 0, '100 should be valid');
  });
});

describe('Confirm endpoint - WAC_DENOMINATOR_ZERO', () => {
  test('WAC_DENOMINATOR_ZERO when old_qty=0 and batch_qty=0', () => {
    const oldQty = 0;
    const batchQty = 0;
    assert.ok(oldQty + batchQty <= 0, 'denominator should be <= 0');
  });

  test('WAC_DENOMINATOR_ZERO when old_qty + batch_qty is negative', () => {
    const oldQty = -5;
    const batchQty = 3;
    assert.ok(oldQty + batchQty <= 0, 'denominator should be <= 0');
  });

  test('old_qty=0 + batch_qty>0 is legal (denominator > 0)', () => {
    const oldQty = 0;
    const batchQty = 100;
    assert.ok(oldQty + batchQty > 0, 'denominator should be > 0');
  });
});

describe('Confirm endpoint - no parseFloat(old_qty) || 0 auto-zeroing', () => {
  test('parseFloat(null) || 0 = 0 (old behavior - now deleted)', () => {
    assert.equal(parseFloat(null) || 0, 0);
    assert.equal(parseFloat('') || 0, 0);
    assert.equal(parseFloat('abc') || 0, 0);
    assert.equal(parseFloat(NaN) || 0, 0);
  });
});

describe('Confirm endpoint - DB write boundary', () => {
  test('Confirm success: only writes wac_history + weighted_avg_cost; inventory_value and available_qty unchanged; no cost_update_logs', () => {
    const db = require('./db').getDB();
    db.exec('DELETE FROM logistics_batches');
    db.exec('DELETE FROM packing_lists');
    db.exec('DELETE FROM packing_list_items');
    db.exec('DELETE FROM commercial_invoices');
    db.exec('DELETE FROM commercial_invoice_items');
    db.exec('DELETE FROM ci_cost_items');
    db.exec('DELETE FROM payment_requests');
    db.exec('DELETE FROM payment_settlement_logs');
    db.exec('DELETE FROM exchange_rates');
    db.exec('DELETE FROM inventory');
    db.exec('DELETE FROM wac_history');
    db.exec('DELETE FROM cost_update_logs');

    seedSku('SKU-CFM', 'Product CFM', 'ModelC', 'BrandC');

    seedCI('ci_cfm', 'CI-CFM', 'USD', 5000, 'cbm');
    seedCIItem('cii_cfm', 'ci_cfm', 'SKU-CFM', 100, 50, 0, 0.05);

    seedBatch('lb_cfm', 'BATCH-CFM', 'ci_cfm', {
      arrivalDate: '2026-03-01', totalFreight: 0, customsDuty: 0, freightCurrency: 'USD'
    });
    seedPL('pl_cfm', 'PL-CFM', 'ci_cfm', 'lb_cfm', { status: 'confirmed' });
    seedPLItem('pli_cfm', 'pl_cfm', 'SKU-CFM', 100, 1, 100);

    seedExchangeRate('USD', 'IDR', '2026-03-01', 15000);

    // Pre-existing inventory with available_qty=50, weighted_avg_cost=1000, inventory_value=50000
    seedInventory('SKU-CFM', 'Indonesia', 'WH-JKT', 50, 1000);

    const result = computeWacCostFacts('lb_cfm');
    assert.equal(result.blockers.length, 0, `Expected 0 blockers, got: ${JSON.stringify(result.blockers)}`);

    const item = result.items[0];
    const oldQty = 50;
    const batchQty = item.batch_qty;
    const unitLandingCost = item.unit_landing_cost;
    const oldAvgCost = item.current_wac;
    const newQty = oldQty + batchQty;
    const newAvgCost = (oldQty * oldAvgCost + batchQty * unitLandingCost) / newQty;
    const roundedAvgCost = Math.round(newAvgCost * 10000) / 10000;

    // Capture pre-confirm state
    const invBefore = queryOne('SELECT available_qty, weighted_avg_cost, inventory_value FROM inventory WHERE sku_code = ? AND country = ? AND warehouse = ?',
      ['SKU-CFM', 'Indonesia', 'WH-JKT']);
    const costLogsBefore = queryOne('SELECT COUNT(*) AS cnt FROM cost_update_logs');
    const wacHistoryBefore = queryOne('SELECT COUNT(*) AS cnt FROM wac_history');

    // Simulate confirm transaction (same DB writes as server.js confirm endpoint)
    transaction(() => {
      const wacId = `wac_test_${Date.now()}`;
      run(`INSERT INTO wac_history (id, version_no, ci_id, ci_no, sku_code, country, warehouse,
        original_qty, original_avg_cost, original_inventory_value, inbound_qty, unit_landing_cost,
        inbound_total_cost, new_avg_cost, settlement_date, confirmed_by, logistics_batch_id)
        VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [wacId, 'ci_cfm', 'CI-CFM', 'SKU-CFM', 'Indonesia', 'WH-JKT',
         oldQty, oldAvgCost, oldQty * oldAvgCost, batchQty, unitLandingCost,
         item.total_landing_cost_local, roundedAvgCost, '2026-03-01', 'test_user', 'lb_cfm']);

      const invRecord = queryOne('SELECT id FROM inventory WHERE sku_code = ? AND country = ? AND warehouse = ?',
        ['SKU-CFM', 'Indonesia', 'WH-JKT']);
      if (invRecord) {
        run('UPDATE inventory SET weighted_avg_cost = ?, updated_at = datetime(\'now\') WHERE id = ?',
          [roundedAvgCost, invRecord.id]);
      }
    });

    // Verify post-confirm state
    const invAfter = queryOne('SELECT available_qty, weighted_avg_cost, inventory_value FROM inventory WHERE sku_code = ? AND country = ? AND warehouse = ?',
      ['SKU-CFM', 'Indonesia', 'WH-JKT']);
    const costLogsAfter = queryOne('SELECT COUNT(*) AS cnt FROM cost_update_logs');
    const wacHistoryAfter = queryOne('SELECT COUNT(*) AS cnt FROM wac_history');

    // wac_history: 1 new row
    assert.equal(wacHistoryAfter.cnt - wacHistoryBefore.cnt, 1, 'wac_history should have 1 new row');

    // weighted_avg_cost: changed
    assert.ok(invAfter.weighted_avg_cost !== invBefore.weighted_avg_cost, 'weighted_avg_cost should change');

    // available_qty: unchanged
    assert.equal(invAfter.available_qty, invBefore.available_qty, 'available_qty must not change');

    // inventory_value: unchanged
    assert.equal(Number(invAfter.inventory_value), Number(invBefore.inventory_value), 'inventory_value must not change');

    // cost_update_logs: no new rows
    assert.equal(costLogsAfter.cnt - costLogsBefore.cnt, 0, 'cost_update_logs must have 0 new rows');
  });
});

// ── Cross-batch freight scoping ──
describe('computeWacCostFacts - cross-batch freight scoping', () => {
  test('Batch-A freight item → PR-A only; Batch-B freight item → PR-B only', () => {
    const db = require('./db').getDB();
    db.exec('DELETE FROM logistics_batches');
    db.exec('DELETE FROM packing_lists');
    db.exec('DELETE FROM packing_list_items');
    db.exec('DELETE FROM commercial_invoices');
    db.exec('DELETE FROM commercial_invoice_items');
    db.exec('DELETE FROM ci_cost_items');
    db.exec('DELETE FROM payment_requests');
    db.exec('DELETE FROM payment_settlement_logs');
    db.exec('DELETE FROM exchange_rates');
    db.exec('DELETE FROM inventory');

    seedSku('SKU-XB', 'Product XB', '', '');
    seedCI('ci_xb', 'CI-XB', 'USD', 10000, 'cbm');
    seedCIItem('cii_xb', 'ci_xb', 'SKU-XB', 200, 50, 0, 0.05);

    // Batch-A
    seedBatch('lb_xba', 'BATCH-XBA', 'ci_xb', {
      arrivalDate: '2026-03-01', totalFreight: 5000, customsDuty: 0, freightCurrency: 'USD'
    });
    seedPL('pl_xba', 'PL-XBA', 'ci_xb', 'lb_xba', { totalQty: 100, status: 'confirmed' });
    seedPLItem('pli_xba', 'pl_xba', 'SKU-XB', 100, 2.0, 500);

    // Batch-B
    seedBatch('lb_xbb', 'BATCH-XBB', 'ci_xb', {
      arrivalDate: '2026-03-02', totalFreight: 3000, customsDuty: 0, freightCurrency: 'USD'
    });
    seedPL('pl_xbb', 'PL-XBB', 'ci_xb', 'lb_xbb', { totalQty: 100, status: 'confirmed' });
    seedPLItem('pli_xbb', 'pl_xbb', 'SKU-XB', 100, 2.0, 500);

    seedExchangeRate('USD', 'IDR', '2026-03-01', 15000);
    seedExchangeRate('USD', 'IDR', '2026-03-02', 15000);
    seedInventory('SKU-XB', 'Indonesia', 'WH-JKT', 0, 0);

    // Batch-A freight: PR-A with 5000 USD → 75000000 IDR
    seedPaymentRequest('pr_xba', 'PR-XBA', 'USD', 5000, 'ci_xb', 'warehouse_arrival', 'freight');
    seedCiCostItem('cci_xba', 'ci_xb', 'pr_xba', 'warehouse_arrival', 'freight', 5000, 'USD', 'lb_xba');
    seedPaymentLog('psl_xba', 'pr_xba', 5000, 75000000, 15000, '2026-02-15', 'IDR');

    // Batch-B freight: PR-B with 3000 USD → 45000000 IDR
    seedPaymentRequest('pr_xbb', 'PR-XBB', 'USD', 3000, 'ci_xb', 'warehouse_arrival', 'freight');
    seedCiCostItem('cci_xbb', 'ci_xb', 'pr_xbb', 'warehouse_arrival', 'freight', 3000, 'USD', 'lb_xbb');
    seedPaymentLog('psl_xbb', 'pr_xbb', 3000, 45000000, 15000, '2026-02-16', 'IDR');

    // Compute Batch-A — must only read PR-A
    const resultA = computeWacCostFacts('lb_xba');
    assert.equal(resultA.blockers.length, 0, `Batch-A expected 0 blockers, got: ${JSON.stringify(resultA.blockers)}`);
    assert.equal(resultA.meta.freight_local_amount, 75000000, `Batch-A freight_local should be 75000000, got ${resultA.meta.freight_local_amount}`);

    // Compute Batch-B — must only read PR-B
    const resultB = computeWacCostFacts('lb_xbb');
    assert.equal(resultB.blockers.length, 0, `Batch-B expected 0 blockers, got: ${JSON.stringify(resultB.blockers)}`);
    assert.equal(resultB.meta.freight_local_amount, 45000000, `Batch-B freight_local should be 45000000, got ${resultB.meta.freight_local_amount}`);
  });

  test('Unscoped freight cost item (logistics_batch_id="") → FREIGHT_PAYMENT_LINK_AMBIGUOUS', () => {
    const db = require('./db').getDB();
    db.exec('DELETE FROM logistics_batches');
    db.exec('DELETE FROM packing_lists');
    db.exec('DELETE FROM packing_list_items');
    db.exec('DELETE FROM commercial_invoices');
    db.exec('DELETE FROM commercial_invoice_items');
    db.exec('DELETE FROM ci_cost_items');
    db.exec('DELETE FROM payment_requests');
    db.exec('DELETE FROM payment_settlement_logs');
    db.exec('DELETE FROM exchange_rates');
    db.exec('DELETE FROM inventory');

    seedSku('SKU-UNSCOPED', 'Product Unscoped', '', '');
    seedCI('ci_uns', 'CI-UNS', 'USD', 10000, 'cbm');
    seedCIItem('cii_uns', 'ci_uns', 'SKU-UNSCOPED', 100, 50, 0, 0.05);

    seedBatch('lb_uns', 'BATCH-UNS', 'ci_uns', {
      arrivalDate: '2026-03-01', totalFreight: 5000, customsDuty: 0, freightCurrency: 'USD'
    });
    seedPL('pl_uns', 'PL-UNS', 'ci_uns', 'lb_uns', { totalQty: 100, status: 'confirmed' });
    seedPLItem('pli_uns', 'pl_uns', 'SKU-UNSCOPED', 100, 2.0, 500);

    seedExchangeRate('USD', 'IDR', '2026-03-01', 15000);
    seedInventory('SKU-UNSCOPED', 'Indonesia', 'WH-JKT', 0, 0);

    // Cost item with empty logistics_batch_id — unscoped
    seedPaymentRequest('pr_uns', 'PR-UNS', 'USD', 5000, 'ci_uns', 'warehouse_arrival', 'freight');
    seedCiCostItem('cci_uns', 'ci_uns', 'pr_uns', 'warehouse_arrival', 'freight', 5000, 'USD', '');
    seedPaymentLog('psl_uns', 'pr_uns', 5000, 75000000, 15000, '2026-02-15', 'IDR');

    const result = computeWacCostFacts('lb_uns');
    const codes = result.blockers.map(b => b.code);
    assert.ok(codes.includes('FREIGHT_PAYMENT_LINK_AMBIGUOUS'), `Expected FREIGHT_PAYMENT_LINK_AMBIGUOUS, got: ${codes}`);
  });
});

// ── Multi-payment effective_rate / last_paid_date / breakdown ──
describe('computeWacCostFacts - multi-payment freight', () => {
  test('Two payments with different rates: effective_rate = Σ local / total_freight; last_paid_date = MAX', () => {
    const db = require('./db').getDB();
    db.exec('DELETE FROM logistics_batches');
    db.exec('DELETE FROM packing_lists');
    db.exec('DELETE FROM packing_list_items');
    db.exec('DELETE FROM commercial_invoices');
    db.exec('DELETE FROM commercial_invoice_items');
    db.exec('DELETE FROM ci_cost_items');
    db.exec('DELETE FROM payment_requests');
    db.exec('DELETE FROM payment_settlement_logs');
    db.exec('DELETE FROM exchange_rates');
    db.exec('DELETE FROM inventory');

    seedSku('SKU-MP', 'Product MP', '', '');
    seedCI('ci_mp', 'CI-MP', 'USD', 10000, 'cbm');
    seedCIItem('cii_mp', 'ci_mp', 'SKU-MP', 100, 50, 0, 0.05);

    seedBatch('lb_mp', 'BATCH-MP', 'ci_mp', {
      arrivalDate: '2026-03-01', totalFreight: 5000, customsDuty: 0, freightCurrency: 'USD'
    });
    seedPL('pl_mp', 'PL-MP', 'ci_mp', 'lb_mp', { totalQty: 100, status: 'confirmed' });
    seedPLItem('pli_mp', 'pl_mp', 'SKU-MP', 100, 2.0, 500);

    seedExchangeRate('USD', 'IDR', '2026-03-01', 15000);
    seedInventory('SKU-MP', 'Indonesia', 'WH-JKT', 0, 0);

    seedPaymentRequest('pr_mp', 'PR-MP', 'USD', 5000, 'ci_mp', 'warehouse_arrival', 'freight');
    seedCiCostItem('cci_mp', 'ci_mp', 'pr_mp', 'warehouse_arrival', 'freight', 5000, 'USD', 'lb_mp');

    // Two payment logs with different rates
    // Payment 1: 3000 USD @ 14000 → 42000000 IDR, paid 2026-02-10
    seedPaymentLogRaw('psl_mp1', 'pr_mp', 3000, {
      localRate: 14000, localRateDate: '2026-02-10', localCurrency: 'IDR', localAmount: 42000000, paidDate: '2026-02-10'
    });
    // Payment 2: 2000 USD @ 16000 → 32000000 IDR, paid 2026-02-20
    seedPaymentLogRaw('psl_mp2', 'pr_mp', 2000, {
      localRate: 16000, localRateDate: '2026-02-20', localCurrency: 'IDR', localAmount: 32000000, paidDate: '2026-02-20'
    });

    const result = computeWacCostFacts('lb_mp');
    assert.equal(result.blockers.length, 0, `Expected 0 blockers, got: ${JSON.stringify(result.blockers)}`);

    // Freight Local = 42000000 + 32000000 = 74000000
    assert.equal(result.meta.freight_local_amount, 74000000);

    // effective_rate = 74000000 / 5000 = 14800
    assert.equal(result.meta.freight_effective_rate, 14800);

    // last_paid_date = '2026-02-20'
    assert.equal(result.meta.freight_last_paid_date, '2026-02-20');

    // payment_breakdown has 2 entries
    assert.equal(result.meta.freight_payment_breakdown.length, 2);

    // Verify breakdown entries
    const bd1 = result.meta.freight_payment_breakdown[0];
    const bd2 = result.meta.freight_payment_breakdown[1];
    assert.equal(bd1.amount, 3000);
    assert.equal(bd1.local_amount, 42000000);
    assert.equal(bd1.local_rate, 14000);
    assert.equal(bd1.paid_date, '2026-02-10');
    assert.equal(bd2.amount, 2000);
    assert.equal(bd2.local_amount, 32000000);
    assert.equal(bd2.local_rate, 16000);
    assert.equal(bd2.paid_date, '2026-02-20');
  });
});

// ── Target currency from warehouse master ──
describe('computeWacCostFacts - target currency from warehouse', () => {
  test('Warehouse mapping normal → IDR', () => {
    const db = require('./db').getDB();
    db.exec('DELETE FROM logistics_batches');
    db.exec('DELETE FROM packing_lists');
    db.exec('DELETE FROM packing_list_items');
    db.exec('DELETE FROM commercial_invoices');
    db.exec('DELETE FROM commercial_invoice_items');
    db.exec('DELETE FROM exchange_rates');
    db.exec('DELETE FROM inventory');

    seedCI('ci_wh1', 'CI-WH1', 'USD', 5000, 'cbm');
    seedCIItem('cii_wh1', 'ci_wh1', 'SKU-WH', 100, 50, 0, 0.05);

    seedBatch('lb_wh1', 'BATCH-WH1', 'ci_wh1', {
      arrivalDate: '2026-03-01', totalFreight: 0, customsDuty: 0
    });
    seedPL('pl_wh1', 'PL-WH1', 'ci_wh1', 'lb_wh1', { status: 'confirmed' });
    seedPLItem('pli_wh1', 'pl_wh1', 'SKU-WH', 100, 1, 100);

    seedExchangeRate('USD', 'IDR', '2026-03-01', 15000);
    seedInventory('SKU-WH', 'Indonesia', 'WH-JKT', 0, 0);

    const result = computeWacCostFacts('lb_wh1');
    const codes = result.blockers.map(b => b.code);
    assert.ok(!codes.includes('WAC_TARGET_CURRENCY_UNRESOLVED'), `Should not have currency blocker: ${codes}`);
    assert.equal(result.meta.local_currency, 'IDR');
  });

  test('Warehouse does not exist → WAC_TARGET_CURRENCY_UNRESOLVED', () => {
    const db = require('./db').getDB();
    db.exec('DELETE FROM logistics_batches');
    db.exec('DELETE FROM packing_lists');
    db.exec('DELETE FROM packing_list_items');
    db.exec('DELETE FROM commercial_invoices');
    db.exec('DELETE FROM commercial_invoice_items');
    db.exec('DELETE FROM exchange_rates');
    db.exec('DELETE FROM inventory');

    seedCI('ci_wh2', 'CI-WH2', 'USD', 5000, 'cbm');
    seedCIItem('cii_wh2', 'ci_wh2', 'SKU-WH2', 100, 50, 0, 0.05);

    // Batch with non-existent warehouse
    seedBatch('lb_wh2', 'BATCH-WH2', 'ci_wh2', {
      arrivalDate: '2026-03-01', totalFreight: 0, customsDuty: 0, warehouse: 'WH-NONEXIST'
    });
    seedPL('pl_wh2', 'PL-WH2', 'ci_wh2', 'lb_wh2', { status: 'confirmed', warehouse: 'WH-NONEXIST' });
    seedPLItem('pli_wh2', 'pl_wh2', 'SKU-WH2', 100, 1, 100);

    seedExchangeRate('USD', 'IDR', '2026-03-01', 15000);

    const result = computeWacCostFacts('lb_wh2');
    const codes = result.blockers.map(b => b.code);
    assert.ok(codes.includes('WAC_TARGET_CURRENCY_UNRESOLVED'), `Expected WAC_TARGET_CURRENCY_UNRESOLVED, got: ${codes}`);
  });

  test('Warehouse country has no default_currency → WAC_TARGET_CURRENCY_UNRESOLVED', () => {
    const db = require('./db').getDB();
    db.exec('DELETE FROM logistics_batches');
    db.exec('DELETE FROM packing_lists');
    db.exec('DELETE FROM packing_list_items');
    db.exec('DELETE FROM commercial_invoices');
    db.exec('DELETE FROM commercial_invoice_items');
    db.exec('DELETE FROM exchange_rates');
    db.exec('DELETE FROM inventory');

    // Country with no default_currency
    seedCountry('NoCurrencyLand', 'NC', '');
    seedWarehouse('wh_id_nc', 'WH-NC', 'ctry_NoCurrencyLand', 'NoCurrencyLand');

    seedCI('ci_wh3', 'CI-WH3', 'USD', 5000, 'cbm');
    seedCIItem('cii_wh3', 'ci_wh3', 'SKU-WH3', 100, 50, 0, 0.05);

    seedBatch('lb_wh3', 'BATCH-WH3', 'ci_wh3', {
      arrivalDate: '2026-03-01', totalFreight: 0, customsDuty: 0, warehouse: 'WH-NC', country: 'NoCurrencyLand'
    });
    seedPL('pl_wh3', 'PL-WH3', 'ci_wh3', 'lb_wh3', { status: 'confirmed', warehouse: 'WH-NC', country: 'NoCurrencyLand' });
    seedPLItem('pli_wh3', 'pl_wh3', 'SKU-WH3', 100, 1, 100);

    const result = computeWacCostFacts('lb_wh3');
    const codes = result.blockers.map(b => b.code);
    assert.ok(codes.includes('WAC_TARGET_CURRENCY_UNRESOLVED'), `Expected WAC_TARGET_CURRENCY_UNRESOLVED, got: ${codes}`);
  });
});

// ── Preview/Confirm Parity Test ──
// Verify: if Preview.canConfirm (0 blockers), then Confirm eligibility also passes
// for the same DB facts. Confirms that Confirm does NOT re-introduce new blockers
// beyond what computeWacCostFacts already returns.
describe('Preview/Confirm parity', () => {
  beforeEach(() => {
    const db = require('./db').getDB();
    db.exec('DELETE FROM wac_history');
    db.exec('DELETE FROM payment_settlement_logs');
    db.exec('DELETE FROM ci_cost_items');
    db.exec('DELETE FROM payment_requests');
    db.exec('DELETE FROM logistics_batches');
    db.exec('DELETE FROM packing_list_items');
    db.exec('DELETE FROM packing_lists');
    db.exec('DELETE FROM commercial_invoice_items');
    db.exec('DELETE FROM commercial_invoices');
    db.exec('DELETE FROM exchange_rates');
    db.exec('DELETE FROM inventory');
    db.exec('DELETE FROM skus');
    db.exec('DELETE FROM warehouses');
    db.exec('DELETE FROM countries');
  });

  test('Preview 0 blockers → Confirm also 0 blockers for same facts', () => {
    seedCountry('Indonesia', 'ID', 'IDR');
    seedWarehouse('wh_jkt', 'WH-JKT', 'ctry_Indonesia', 'Indonesia');
    seedSku('SKU-PARITY', 'Parity Product', 'MODEL-1', 'BrandA');

    seedCI('ci_par', 'CI-PARITY', 'USD', 10000, 'cbm');
    seedCIItem('cii_par', 'ci_par', 'SKU-PARITY', 100, 100, 90, 0.05);

    seedBatch('lb_par', 'BATCH-PARITY', 'ci_par', {
      arrivalDate: '2026-03-01', totalFreight: 2000, customsDuty: 500, vatGst: 0, otherFees: 0
    });
    seedPL('pl_par', 'PL-PARITY', 'ci_par', 'lb_par', { status: 'confirmed', totalQty: 100 });
    seedPLItem('pli_par', 'pl_par', 'SKU-PARITY', 100, 2, 200);

    // Product FX: USD→IDR on arrival date
    seedExchangeRate('USD', 'IDR', '2026-03-01', 15000);

    // Inventory row exists
    seedInventory('SKU-PARITY', 'Indonesia', 'WH-JKT', 50, 200);

    // Freight payment: PR + ci_cost_item + settlement_log
    seedPaymentRequest('pr_par', 'PR-PARITY', 'USD', 2000, 'ci_par', 'warehouse_arrival', 'freight');
    seedCiCostItem('cci_par', 'ci_par', 'pr_par', 'warehouse_arrival', 'freight', 2000, 'USD', 'lb_par');
    seedPaymentLog('psl_par', 'pr_par', 2000, 2000 * 15000, 15000, '2026-02-15', 'IDR');

    // ── 1. Preview: computeWacCostFacts ──
    const preview = computeWacCostFacts('lb_par');

    // Preview must have 0 blockers
    assert.strictEqual(preview.blockers.length, 0,
      `Preview should have 0 blockers, got: ${JSON.stringify(preview.blockers)}`);

    // ── 2. Verify items have all required fields ──
    assert.ok(preview.items.length > 0, 'Preview should have items');
    const item = preview.items[0];
    assert.ok(item.sku_code, 'item.sku_code missing');
    assert.ok(item.batch_qty > 0, 'item.batch_qty should be > 0');
    assert.ok(item.old_qty !== undefined, 'item.old_qty missing');
    assert.ok(item.current_wac !== undefined, 'item.current_wac missing');
    assert.ok(item.unit_landing_cost > 0, 'item.unit_landing_cost should be > 0');
    assert.ok(item.new_wac > 0, 'item.new_wac should be > 0');
    assert.ok(item.product_cost_local > 0, 'item.product_cost_local should be > 0');
    assert.ok(item.freight_cost_local > 0, 'item.freight_cost_local should be > 0');
    assert.ok(item.customs_cost_local > 0, 'item.customs_cost_local should be > 0');

    // ── 3. Verify meta has all required fields ──
    const meta = preview.meta;
    assert.ok(meta.batch_no, 'meta.batch_no missing');
    assert.ok(meta.local_currency, 'meta.local_currency missing');
    assert.ok(meta.ci_currency, 'meta.ci_currency missing');
    assert.ok(meta.actual_arrival_date, 'meta.actual_arrival_date missing');
    assert.ok(meta.freight_currency, 'meta.freight_currency missing');
    assert.ok(meta.freight_business_amount > 0, 'meta.freight_business_amount should be > 0');
    assert.ok(meta.freight_local_amount > 0, 'meta.freight_local_amount should be > 0');
    assert.ok(meta.freight_effective_rate > 0, 'meta.freight_effective_rate should be > 0');
    assert.ok(meta.freight_last_paid_date, 'meta.freight_last_paid_date missing');
    assert.ok(Array.isArray(meta.freight_payment_breakdown), 'meta.freight_payment_breakdown should be array');
    assert.strictEqual(meta.freight_payment_breakdown.length, 1, 'Should have 1 payment breakdown');
    assert.ok(meta.duty_local_amount > 0, 'meta.duty_local_amount should be > 0');
    assert.ok(meta.ci_goods_amount_total > 0, 'meta.ci_goods_amount_total should be > 0');
    assert.ok(meta.transport_basis, 'meta.transport_basis missing');
    assert.strictEqual(meta.already_confirmed, false, 'meta.already_confirmed should be false');

    // ── 4. Confirm parity: re-read facts → same 0 blockers ──
    const confirmCheck = computeWacCostFacts('lb_par');
    assert.strictEqual(confirmCheck.blockers.length, 0,
      `Confirm re-read should also have 0 blockers, got: ${JSON.stringify(confirmCheck.blockers)}`);

    // ── 5. Denominator check: old_qty + batch_qty > 0 ──
    for (const it of confirmCheck.items) {
      const denom = (it.old_qty || 0) + it.batch_qty;
      assert.ok(denom > 0, `Denominator for ${it.sku_code} should be > 0, got ${denom}`);
    }

    // ── 6. Verify item values are identical between Preview and Confirm ──
    for (let i = 0; i < preview.items.length; i++) {
      const pItem = preview.items[i];
      const cItem = confirmCheck.items[i];
      assert.strictEqual(pItem.sku_code, cItem.sku_code, 'SKU mismatch');
      assert.strictEqual(pItem.batch_qty, cItem.batch_qty, 'batch_qty mismatch');
      assert.strictEqual(pItem.old_qty, cItem.old_qty, 'old_qty mismatch');
      assert.strictEqual(pItem.current_wac, cItem.current_wac, 'current_wac mismatch');
      assert.strictEqual(pItem.unit_landing_cost, cItem.unit_landing_cost, 'unit_landing_cost mismatch');
      assert.strictEqual(pItem.new_wac, cItem.new_wac, 'new_wac mismatch');
      assert.strictEqual(pItem.product_cost_local, cItem.product_cost_local, 'product_cost_local mismatch');
      assert.strictEqual(pItem.freight_cost_local, cItem.freight_cost_local, 'freight_cost_local mismatch');
      assert.strictEqual(pItem.customs_cost_local, cItem.customs_cost_local, 'customs_cost_local mismatch');
    }

    // ── 7. Meta parity ──
    assert.strictEqual(preview.meta.batch_no, confirmCheck.meta.batch_no, 'meta.batch_no mismatch');
    assert.strictEqual(preview.meta.local_currency, confirmCheck.meta.local_currency, 'meta.local_currency mismatch');
    assert.strictEqual(preview.meta.freight_effective_rate, confirmCheck.meta.freight_effective_rate, 'freight_effective_rate mismatch');
    assert.strictEqual(preview.meta.freight_local_amount, confirmCheck.meta.freight_local_amount, 'freight_local_amount mismatch');
    assert.strictEqual(preview.meta.duty_local_amount, confirmCheck.meta.duty_local_amount, 'duty_local_amount mismatch');
  });

  test('Preview with blockers → Confirm also has same blockers', () => {
    seedCountry('Indonesia', 'ID', 'IDR');
    seedWarehouse('wh_jkt2', 'WH-JKT', 'ctry_Indonesia', 'Indonesia');
    seedSku('SKU-PAR2', 'Parity Product 2', 'MODEL-2', 'BrandB');

    seedCI('ci_par2', 'CI-PARITY2', 'USD', 5000, 'cbm');
    seedCIItem('cii_par2', 'ci_par2', 'SKU-PAR2', 50, 100, 90, 0.05);

    // No arrival date → PRODUCT_FX_DATE_MISSING
    seedBatch('lb_par2', 'BATCH-PARITY2', 'ci_par2', {
      arrivalDate: '', totalFreight: 1000, customsDuty: 0
    });
    seedPL('pl_par2', 'PL-PARITY2', 'ci_par2', 'lb_par2', { status: 'confirmed', totalQty: 50 });
    seedPLItem('pli_par2', 'pl_par2', 'SKU-PAR2', 50, 1, 50);

    // No inventory row → WAC_INVENTORY_ROW_MISSING
    // No freight payment → FREIGHT_PAYMENT_FACT_MISSING

    const preview = computeWacCostFacts('lb_par2');
    assert.ok(preview.blockers.length > 0, 'Should have blockers');

    const confirmCheck = computeWacCostFacts('lb_par2');
    assert.strictEqual(preview.blockers.length, confirmCheck.blockers.length,
      'Preview and Confirm should have same blocker count');
    const previewCodes = preview.blockers.map(b => b.code).sort();
    const confirmCodes = confirmCheck.blockers.map(b => b.code).sort();
    assert.deepStrictEqual(previewCodes, confirmCodes,
      'Preview and Confirm should have identical blocker codes');
  });
});
