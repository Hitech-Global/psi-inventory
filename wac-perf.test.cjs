'use strict';

const { test, describe, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_DRIVER = 'sqlite';
process.env.DB_PATH = ':memory:';

const { query, queryOne, run, transaction, initDatabase } = require('./db');
const { computeWacCostFacts, _getQueryCount, _resetQueryCount } = require('./wac-calculator');

function createTestSchema() {
  const db = require('./db').getDB();
  db.exec(`
    CREATE TABLE IF NOT EXISTS countries (id TEXT PRIMARY KEY, name TEXT NOT NULL, code TEXT DEFAULT '', default_currency TEXT DEFAULT '', sort_order INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS skus (id TEXT PRIMARY KEY, sku_code TEXT NOT NULL UNIQUE, product_name TEXT DEFAULT '', model TEXT DEFAULT '', brand TEXT DEFAULT '');
    CREATE TABLE IF NOT EXISTS commercial_invoices (id TEXT PRIMARY KEY, ci_no TEXT NOT NULL UNIQUE, related_po_id TEXT DEFAULT '', related_po_no TEXT DEFAULT '', related_pi_id TEXT DEFAULT '', related_pi_no TEXT DEFAULT '', supplier_id TEXT DEFAULT '', supplier_name TEXT DEFAULT '', brand TEXT DEFAULT '', country TEXT DEFAULT '', target_warehouse TEXT DEFAULT '', ci_date TEXT NOT NULL, shipment_batch INTEGER DEFAULT 1, currency TEXT DEFAULT 'USD', goods_amount NUMERIC(18,4) DEFAULT 0, ci_status TEXT DEFAULT 'draft', transport_basis TEXT DEFAULT NULL, import_duty_total NUMERIC(18,4) DEFAULT 0, has_customs_duty INTEGER DEFAULT 0, has_inspection_fee INTEGER DEFAULT 0, wac_confirmed INTEGER DEFAULT 0, actual_ship_date TEXT DEFAULT '', payment_term_id TEXT DEFAULT '', credit_days INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS commercial_invoice_items (id TEXT PRIMARY KEY, ci_id TEXT NOT NULL, ci_no TEXT DEFAULT '', pi_no TEXT DEFAULT '', sku_code TEXT NOT NULL, shipped_qty INTEGER DEFAULT 0, unit_price NUMERIC(18,4) DEFAULT 0, net_unit_price NUMERIC(18,4) DEFAULT 0, ci_amount NUMERIC(18,4) DEFAULT 0, actual_customs_rate NUMERIC(18,8) DEFAULT NULL, created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS packing_lists (id TEXT PRIMARY KEY, pl_no TEXT NOT NULL UNIQUE, related_po_id TEXT DEFAULT '', related_po_no TEXT DEFAULT '', related_pi_id TEXT DEFAULT '', related_pi_no TEXT DEFAULT '', related_ci_id TEXT DEFAULT '', related_ci_no TEXT DEFAULT '', supplier_id TEXT DEFAULT '', supplier_name TEXT DEFAULT '', brand TEXT DEFAULT '', country TEXT DEFAULT '', target_warehouse TEXT DEFAULT '', pl_date TEXT DEFAULT '', total_qty INTEGER DEFAULT 0, total_cartons INTEGER DEFAULT 0, total_gross_weight DOUBLE PRECISION DEFAULT 0, total_net_weight DOUBLE PRECISION DEFAULT 0, total_cbm DOUBLE PRECISION DEFAULT 0, status TEXT DEFAULT 'draft', logistics_batch_id TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS packing_list_items (id TEXT PRIMARY KEY, pl_id TEXT NOT NULL, pl_no TEXT DEFAULT '', ci_no TEXT DEFAULT '', sku_code TEXT NOT NULL, cartons INTEGER DEFAULT 0, qty_per_carton INTEGER DEFAULT 0, total_qty INTEGER DEFAULT 0, gross_weight DOUBLE PRECISION DEFAULT 0, net_weight DOUBLE PRECISION DEFAULT 0, cbm DOUBLE PRECISION DEFAULT 0, created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS logistics_batches (id TEXT PRIMARY KEY, batch_no TEXT NOT NULL UNIQUE, related_ci_id TEXT DEFAULT '', related_ci_no TEXT DEFAULT '', forwarder_name TEXT DEFAULT '', transport_mode TEXT DEFAULT 'sea', target_country TEXT DEFAULT '', target_warehouse TEXT DEFAULT '', actual_arrival_date TEXT DEFAULT '', logistics_status TEXT DEFAULT 'pending', total_cartons INTEGER DEFAULT 0, total_weight DOUBLE PRECISION DEFAULT 0, total_cbm DOUBLE PRECISION DEFAULT 0, freight_currency TEXT DEFAULT 'USD', international_freight NUMERIC(18,4) DEFAULT 0, local_charges NUMERIC(18,4) DEFAULT 0, customs_service_fee NUMERIC(18,4) DEFAULT 0, delivery_fee NUMERIC(18,4) DEFAULT 0, total_freight NUMERIC(18,4) DEFAULT 0, customs_duty NUMERIC(18,4) DEFAULT 0, vat_gst NUMERIC(18,4) DEFAULT 0, other_fees NUMERIC(18,4) DEFAULT 0, fee_status TEXT DEFAULT 'unpaid', created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS ci_cost_items (id TEXT PRIMARY KEY, ci_id TEXT NOT NULL, ci_no TEXT DEFAULT '', payment_request_id TEXT DEFAULT '', request_no TEXT DEFAULT '', cost_category TEXT DEFAULT '', cost_subcategory TEXT DEFAULT '', payable_amount NUMERIC(18,4) DEFAULT 0, paid_amount NUMERIC(18,4) DEFAULT 0, include_in_landing_cost INTEGER DEFAULT 1, payee_name TEXT DEFAULT '', currency TEXT DEFAULT 'USD', remark TEXT DEFAULT '', logistics_batch_id TEXT DEFAULT '', payable_item_id TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS payment_requests (id TEXT PRIMARY KEY, request_no TEXT NOT NULL UNIQUE, payment_category TEXT DEFAULT '', payment_subcategory TEXT DEFAULT '', source_type TEXT DEFAULT '', source_id TEXT DEFAULT '', source_no TEXT DEFAULT '', payee_key TEXT NOT NULL DEFAULT '', payee_name_snapshot TEXT NOT NULL DEFAULT '', supplier_name TEXT DEFAULT '', payable_amount NUMERIC(18,4) DEFAULT 0, paid_amount NUMERIC(18,4) DEFAULT 0, unpaid_amount NUMERIC(18,4) DEFAULT 0, currency TEXT DEFAULT 'USD', payment_status TEXT DEFAULT 'not_requested', approval_status TEXT DEFAULT 'pending', related_ci_id TEXT DEFAULT '', related_ci_no TEXT DEFAULT '', related_po_no TEXT DEFAULT '', include_in_landing_cost INTEGER DEFAULT 1, expense_country TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS payment_settlement_logs (id TEXT PRIMARY KEY, payment_request_id TEXT NOT NULL, event_type TEXT NOT NULL, amount NUMERIC(18,4) NOT NULL, status TEXT NOT NULL DEFAULT 'applied', reason TEXT DEFAULT '', paid_date TEXT DEFAULT '', payment_voucher TEXT DEFAULT '', original_currency TEXT DEFAULT '', settlement_country TEXT DEFAULT '', local_currency TEXT DEFAULT '', local_rate NUMERIC(18,8) DEFAULT 0, local_rate_date TEXT DEFAULT '', local_rate_type TEXT DEFAULT '', local_rate_direction TEXT DEFAULT '', local_amount NUMERIC(18,4) DEFAULT 0, rmb_rate NUMERIC(18,8) DEFAULT 0, rmb_rate_date TEXT DEFAULT '', rmb_rate_type TEXT DEFAULT '', rmb_rate_direction TEXT DEFAULT '', rmb_amount NUMERIC(18,4) DEFAULT 0, operator_id TEXT DEFAULT '', operator_name TEXT DEFAULT '', idempotency_key TEXT DEFAULT '', is_legacy INTEGER NOT NULL DEFAULT 0, reversal_of TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')), reversed_at TEXT DEFAULT '', reversed_by TEXT DEFAULT '', reversal_reason TEXT DEFAULT '');
    CREATE TABLE IF NOT EXISTS wac_history (id TEXT PRIMARY KEY, version_no INTEGER NOT NULL, ci_id TEXT DEFAULT '', ci_no TEXT DEFAULT '', po_id TEXT DEFAULT '', po_no TEXT DEFAULT '', pi_id TEXT DEFAULT '', pi_no TEXT DEFAULT '', sku_code TEXT NOT NULL, model TEXT DEFAULT '', brand TEXT DEFAULT '', country TEXT DEFAULT '', warehouse TEXT DEFAULT '', original_qty NUMERIC(18,4) DEFAULT 0, original_avg_cost NUMERIC(18,4) DEFAULT 0, original_inventory_value NUMERIC(18,4) DEFAULT 0, inbound_qty NUMERIC(18,4) DEFAULT 0, unit_landing_cost NUMERIC(18,4) DEFAULT 0, inbound_total_cost NUMERIC(18,4) DEFAULT 0, new_avg_cost NUMERIC(18,4) DEFAULT 0, settlement_date TEXT DEFAULT '', confirmation_status TEXT DEFAULT 'confirmed', is_locked INTEGER DEFAULT 1, confirmed_by TEXT DEFAULT '', confirmed_at TEXT DEFAULT '', logistics_batch_id TEXT, created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS inventory (id TEXT PRIMARY KEY, sku_code TEXT NOT NULL, country TEXT DEFAULT '', warehouse TEXT DEFAULT '', available_qty INTEGER DEFAULT 0, in_transit_qty INTEGER DEFAULT 0, weighted_avg_cost NUMERIC(18,4) DEFAULT 0, inventory_value NUMERIC(18,4) DEFAULT 0, updated_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS cost_update_logs (id TEXT PRIMARY KEY, sku_code TEXT NOT NULL, country TEXT DEFAULT '', warehouse TEXT DEFAULT '', related_po_no TEXT DEFAULT '', related_pi_no TEXT DEFAULT '', related_ci_no TEXT DEFAULT '', original_qty NUMERIC(18,4) DEFAULT 0, old_avg_cost NUMERIC(18,4) DEFAULT 0, inbound_qty NUMERIC(18,4) DEFAULT 0, ci_unit_cost NUMERIC(18,4) DEFAULT 0, unit_landing_cost NUMERIC(18,4) DEFAULT 0, new_qty NUMERIC(18,4) DEFAULT 0, new_avg_cost NUMERIC(18,4) DEFAULT 0, operator_id TEXT DEFAULT '', operator_name TEXT DEFAULT '', import_file TEXT DEFAULT '', remark TEXT DEFAULT '');
    CREATE TABLE IF NOT EXISTS exchange_rates (id TEXT PRIMARY KEY, from_currency TEXT NOT NULL, to_currency TEXT NOT NULL, rate NUMERIC(18,8) NOT NULL, rate_date TEXT NOT NULL, rate_type TEXT DEFAULT 'realtime', created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS warehouses (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, country_id TEXT DEFAULT '', country_name TEXT DEFAULT '', warehouse_type TEXT DEFAULT '', sort_order INTEGER DEFAULT 0);
  `);
}

function seedCountry(name, code, currency) {
  run('INSERT INTO countries (id, name, code, default_currency, sort_order) VALUES (?, ?, ?, ?, ?)',
    [`ctry_${name}`, name, code, currency, 0]);
}
function seedWarehouse(id, name, countryId, countryName) {
  run('INSERT INTO warehouses (id, name, country_id, country_name) VALUES (?, ?, ?, ?)',
    [id, name, countryId || '', countryName || '']);
}
function seedSku(skuCode, productName, model, brand) {
  run('INSERT OR REPLACE INTO skus (id, sku_code, product_name, model, brand) VALUES (?, ?, ?, ?, ?)',
    [`sku_${skuCode}`, skuCode, productName || '', model || '', brand || '']);
}
function seedCI(id, ciNo, currency, goodsAmount, transportBasis) {
  run(`INSERT OR REPLACE INTO commercial_invoices (id, ci_no, ci_date, currency, goods_amount, transport_basis, ci_status)
    VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, ciNo, '2026-01-01', currency, goodsAmount, transportBasis || null, 'shipped']);
}
function seedCIItem(id, ciId, skuCode, shippedQty, unitPrice, customsRate) {
  run(`INSERT OR REPLACE INTO commercial_invoice_items (id, ci_id, sku_code, shipped_qty, unit_price, net_unit_price, ci_amount, actual_customs_rate)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, ciId, skuCode, shippedQty, unitPrice, 0, shippedQty * unitPrice, customsRate !== undefined ? customsRate : null]);
}
function seedBatch(id, batchNo, ciId, opts = {}) {
  run(`INSERT OR REPLACE INTO logistics_batches (id, batch_no, related_ci_id, target_country, target_warehouse,
    actual_arrival_date, logistics_status, freight_currency, total_freight, customs_duty, vat_gst, other_fees)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, batchNo, ciId, opts.country || 'Indonesia', opts.warehouse || 'WH-JKT',
     opts.arrivalDate ?? '2026-03-01', opts.status || 'completed',
     opts.freightCurrency || 'USD', opts.totalFreight || 0, opts.customsDuty || 0, 0, 0]);
}
function seedPL(id, plNo, ciId, batchId, opts = {}) {
  run(`INSERT OR REPLACE INTO packing_lists (id, pl_no, related_ci_id, pl_date, total_qty, status, logistics_batch_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, plNo, ciId, opts.plDate || '2026-02-01', opts.totalQty || 0, opts.status || 'confirmed', batchId]);
}
function seedPLItem(id, plId, skuCode, totalQty, cbm, grossWeight) {
  run(`INSERT OR REPLACE INTO packing_list_items (id, pl_id, sku_code, total_qty, cbm, gross_weight)
    VALUES (?, ?, ?, ?, ?, ?)`,
    [id, plId, skuCode, totalQty, cbm || 1.0, grossWeight || 100]);
}
function seedExchangeRate(from, to, date, rate) {
  run('INSERT INTO exchange_rates (id, from_currency, to_currency, rate, rate_date, rate_type) VALUES (?, ?, ?, ?, ?, ?)',
    [`er_${from}_${to}_${date}_${Math.random().toString(36).slice(2,6)}`, from, to, rate, date, 'realtime']);
}
function seedInventory(skuCode, country, warehouse, availableQty, wac) {
  run('INSERT OR REPLACE INTO inventory (id, sku_code, country, warehouse, available_qty, weighted_avg_cost, inventory_value) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [`inv_${skuCode}_${country}_${warehouse}`, skuCode, country, warehouse, availableQty, wac, availableQty * wac]);
}

function buildBatch(numSkus, batchId, ciId, plId) {
  seedCI(ciId, `CI-${batchId}`, 'USD', numSkus * 100, 'cbm');
  for (let i = 0; i < numSkus; i++) {
    const sku = `SKU-${String(i).padStart(4, '0')}`;
    seedSku(sku, `Product ${i}`, `Model${i}`, 'BrandX');
    seedCIItem(`cii_${batchId}_${i}`, ciId, sku, 100, 50, 0.05);
    seedPLItem(`pli_${batchId}_${i}`, plId, sku, 100, 1.0, 100);
    seedInventory(sku, 'Indonesia', 'WH-JKT', 50, 1000);
  }
  seedBatch(batchId, `BATCH-${batchId}`, ciId, {
    arrivalDate: '2026-03-01', totalFreight: 0, customsDuty: 0
  });
  seedPL(plId, `PL-${batchId}`, ciId, batchId, { totalQty: numSkus * 100, status: 'confirmed' });
  seedExchangeRate('USD', 'IDR', '2026-03-01', 15000);
}

describe('WAC Query Count Performance', () => {
  before(() => {
    createTestSchema();
    seedCountry('Indonesia', 'ID', 'IDR');
    seedWarehouse('wh_id_jkt', 'WH-JKT', 'ctry_Indonesia', 'Indonesia');
  });

  test('1 SKU batch — baseline query count', () => {
    buildBatch(1, 'lb_perf_1', 'ci_perf_1', 'pl_perf_1');
    _resetQueryCount();
    const result = computeWacCostFacts('lb_perf_1');
    const q = _getQueryCount();
    console.log(`  1 SKU: ${q} queries, blockers=${result.blockers.length}, items=${result.items.length}`);
    assert.equal(result.blockers.length, 0, 'Should have 0 blockers');
    assert.equal(result.items.length, 1, 'Should have 1 item');
    assert.ok(q <= 25, `1 SKU should use <= 25 queries, got ${q}`);
  });

  test('45 SKU batch — query count must not scale linearly', () => {
    buildBatch(45, 'lb_perf_45', 'ci_perf_45', 'pl_perf_45');
    _resetQueryCount();
    const result = computeWacCostFacts('lb_perf_45');
    const q = _getQueryCount();
    console.log(`  45 SKU: ${q} queries, blockers=${result.blockers.length}, items=${result.items.length}`);
    assert.equal(result.blockers.length, 0, 'Should have 0 blockers');
    assert.equal(result.items.length, 45, 'Should have 45 items');
    assert.ok(q <= 25, `45 SKU should use <= 25 queries, got ${q}`);
  });

  test('100 SKU batch — query count stays O(1)', () => {
    buildBatch(100, 'lb_perf_100', 'ci_perf_100', 'pl_perf_100');
    _resetQueryCount();
    const result = computeWacCostFacts('lb_perf_100');
    const q = _getQueryCount();
    console.log(`  100 SKU: ${q} queries, blockers=${result.blockers.length}, items=${result.items.length}`);
    assert.equal(result.blockers.length, 0, 'Should have 0 blockers');
    assert.equal(result.items.length, 100, 'Should have 100 items');
    assert.ok(q <= 25, `100 SKU should use <= 25 queries, got ${q}`);
  });

  test('query count ratio: 100 SKU / 1 SKU <= 2.0', () => {
    const q1 = (() => {
      _resetQueryCount();
      computeWacCostFacts('lb_perf_1');
      return _getQueryCount();
    })();
    const q100 = (() => {
      _resetQueryCount();
      computeWacCostFacts('lb_perf_100');
      return _getQueryCount();
    })();
    const ratio = q100 / q1;
    console.log(`  Query ratio 100/1: ${ratio.toFixed(2)} (${q100}/${q1})`);
    assert.ok(ratio <= 2.0, `Query ratio ${ratio.toFixed(2)} should be <= 2.0`);
  });

  test('blocker regression: missing arrival date produces PRODUCT_FX_DATE_MISSING', () => {
    buildBatch(10, 'lb_perf_blocker', 'ci_perf_blocker', 'pl_perf_blocker');
    run('UPDATE logistics_batches SET actual_arrival_date = ? WHERE id = ?', ['', 'lb_perf_blocker']);
    _resetQueryCount();
    const result = computeWacCostFacts('lb_perf_blocker');
    const q = _getQueryCount();
    console.log(`  10 SKU (no arrival): ${q} queries, blockers=${result.blockers.length}`);
    const blockerCodes = result.blockers.map(b => b.code);
    assert.ok(blockerCodes.includes('PRODUCT_FX_DATE_MISSING'), 'Should have PRODUCT_FX_DATE_MISSING');
    assert.equal(result.items.length, 10, 'Should still have 10 items');
    assert.equal(result.meta.local_currency, 'IDR', 'Should still be IDR');
    assert.ok(q <= 25, `Should use <= 25 queries even with blockers, got ${q}`);
  });
});
