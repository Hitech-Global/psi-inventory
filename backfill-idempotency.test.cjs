'use strict';
process.env.DB_DRIVER = 'sqlite';
process.env.DB_PATH = ':memory:';
const { test, describe, before, beforeEach } = require('node:test');
const assert = require('node:assert');
const { getDB, query, queryOne, run, genId } = require('./db');

function createTestSchema() {
  const db = getDB();
  db.exec(`
    CREATE TABLE IF NOT EXISTS countries (id TEXT PRIMARY KEY, name TEXT NOT NULL, country_code TEXT DEFAULT '', default_currency TEXT DEFAULT '', sort_order INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS skus (id TEXT PRIMARY KEY, sku_code TEXT NOT NULL UNIQUE, product_name TEXT DEFAULT '', model TEXT DEFAULT '', brand TEXT DEFAULT '');
    CREATE TABLE IF NOT EXISTS commercial_invoices (id TEXT PRIMARY KEY, ci_no TEXT NOT NULL UNIQUE, related_po_id TEXT DEFAULT '', supplier_id TEXT DEFAULT '', supplier_name TEXT DEFAULT '', brand TEXT DEFAULT '', country TEXT DEFAULT '', target_warehouse TEXT DEFAULT '', ci_date TEXT NOT NULL, shipment_batch INTEGER DEFAULT 1, ci_currency TEXT DEFAULT 'USD', goods_amount NUMERIC(18,4) DEFAULT 0, ci_status TEXT DEFAULT 'draft', transport_basis TEXT DEFAULT NULL, import_duty_total NUMERIC(18,4) DEFAULT 0, has_customs_duty INTEGER DEFAULT 0, has_inspection_fee INTEGER DEFAULT 0, wac_confirmed INTEGER DEFAULT 0, actual_ship_date TEXT DEFAULT '', payment_term_id TEXT DEFAULT '', credit_days INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS commercial_invoice_items (id TEXT PRIMARY KEY, ci_id TEXT NOT NULL, ci_no TEXT DEFAULT '', pi_no TEXT DEFAULT '', sku_code TEXT NOT NULL, shipped_qty INTEGER DEFAULT 0, unit_price NUMERIC(18,4) DEFAULT 0, net_unit_price NUMERIC(18,4) DEFAULT 0, ci_amount NUMERIC(18,4) DEFAULT 0, actual_customs_rate NUMERIC(18,8) DEFAULT NULL, customs_rate NUMERIC(18,8) DEFAULT NULL, created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS packing_lists (id TEXT PRIMARY KEY, pl_no TEXT NOT NULL UNIQUE, related_po_id TEXT DEFAULT '', related_pi_id TEXT DEFAULT '', related_ci_id TEXT DEFAULT '', related_ci_no TEXT DEFAULT '', supplier_id TEXT DEFAULT '', supplier_name TEXT DEFAULT '', brand TEXT DEFAULT '', country TEXT DEFAULT '', target_warehouse TEXT DEFAULT '', pl_date TEXT DEFAULT '', total_qty INTEGER DEFAULT 0, total_cartons INTEGER DEFAULT 0, total_gross_weight DOUBLE PRECISION DEFAULT 0, total_net_weight DOUBLE PRECISION DEFAULT 0, total_cbm DOUBLE PRECISION DEFAULT 0, status TEXT DEFAULT 'draft', logistics_batch_id TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS packing_list_items (id TEXT PRIMARY KEY, pl_id TEXT NOT NULL, pl_no TEXT DEFAULT '', ci_no TEXT DEFAULT '', sku_code TEXT NOT NULL, cartons INTEGER DEFAULT 0, qty_per_carton INTEGER DEFAULT 0, total_qty INTEGER DEFAULT 0, gross_weight DOUBLE PRECISION DEFAULT 0, net_weight DOUBLE PRECISION DEFAULT 0, cbm DOUBLE PRECISION DEFAULT 0, created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS logistics_batches (id TEXT PRIMARY KEY, batch_no TEXT NOT NULL UNIQUE, related_ci_id TEXT DEFAULT '', related_ci_no TEXT DEFAULT '', forwarder_name TEXT DEFAULT '', transport_mode TEXT DEFAULT 'sea', target_country TEXT DEFAULT '', target_warehouse TEXT DEFAULT '', actual_arrival_date TEXT DEFAULT '', logistics_status TEXT DEFAULT 'pending', total_cartons INTEGER DEFAULT 0, total_weight DOUBLE PRECISION DEFAULT 0, total_cbm DOUBLE PRECISION DEFAULT 0, freight_currency TEXT DEFAULT 'USD', international_freight NUMERIC(18,4) DEFAULT 0, local_charges NUMERIC(18,4) DEFAULT 0, customs_service_fee NUMERIC(18,4) DEFAULT 0, delivery_fee NUMERIC(18,4) DEFAULT 0, total_freight NUMERIC(18,4) DEFAULT 0, customs_duty NUMERIC(18,4) DEFAULT 0, vat_gst NUMERIC(18,4) DEFAULT 0, other_fees NUMERIC(18,4) DEFAULT 0, fee_status TEXT DEFAULT 'unpaid', remark TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS ci_cost_items (id TEXT PRIMARY KEY, ci_id TEXT NOT NULL, ci_no TEXT DEFAULT '', payment_request_id TEXT DEFAULT '', request_no TEXT DEFAULT '', cost_category TEXT DEFAULT '', cost_subcategory TEXT DEFAULT '', payable_amount NUMERIC(18,4) DEFAULT 0, paid_amount NUMERIC(18,4) DEFAULT 0, include_in_landing_cost INTEGER DEFAULT 1, payee_name TEXT DEFAULT '', currency TEXT DEFAULT 'USD', remark TEXT DEFAULT '', logistics_batch_id TEXT DEFAULT '', payable_item_id TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS payment_requests (id TEXT PRIMARY KEY, request_no TEXT NOT NULL UNIQUE, payment_category TEXT DEFAULT '', payment_subcategory TEXT DEFAULT '', source_type TEXT DEFAULT '', source_id TEXT DEFAULT '', source_no TEXT DEFAULT '', payee_type TEXT DEFAULT '', payee_key TEXT NOT NULL DEFAULT '', payee_name_snapshot TEXT NOT NULL DEFAULT '', supplier_name TEXT DEFAULT '', payable_amount NUMERIC(18,4) DEFAULT 0, paid_amount NUMERIC(18,4) DEFAULT 0, unpaid_amount NUMERIC(18,4) DEFAULT 0, currency TEXT DEFAULT 'USD', payment_status TEXT DEFAULT 'not_requested', approval_status TEXT DEFAULT 'pending', related_ci_id TEXT DEFAULT '', related_ci_no TEXT DEFAULT '', related_po_no TEXT DEFAULT '', include_in_landing_cost INTEGER DEFAULT 1, expense_country TEXT DEFAULT '', remark TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS payment_settlement_logs (id TEXT PRIMARY KEY, payment_request_id TEXT NOT NULL, event_type TEXT NOT NULL, amount NUMERIC(18,4) NOT NULL, status TEXT NOT NULL DEFAULT 'applied', reason TEXT DEFAULT '', paid_date TEXT DEFAULT '', payment_voucher TEXT DEFAULT '', original_currency TEXT DEFAULT '', settlement_country TEXT DEFAULT '', local_currency TEXT DEFAULT '', local_rate NUMERIC(18,8) DEFAULT 0, local_rate_date TEXT DEFAULT '', local_rate_type TEXT DEFAULT '', local_rate_direction TEXT DEFAULT '', local_amount NUMERIC(18,4) DEFAULT 0, rmb_rate NUMERIC(18,8) DEFAULT 0, rmb_rate_date TEXT DEFAULT '', rmb_rate_type TEXT DEFAULT '', rmb_rate_direction TEXT DEFAULT '', rmb_amount NUMERIC(18,4) DEFAULT 0, operator_id TEXT DEFAULT '', operator_name TEXT DEFAULT '', idempotency_key TEXT DEFAULT '', is_legacy INTEGER NOT NULL DEFAULT 0, reversal_of TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')), reversed_at TEXT DEFAULT '', reversed_by TEXT DEFAULT '', reversal_reason TEXT DEFAULT '');
    CREATE TABLE IF NOT EXISTS wac_history (id TEXT PRIMARY KEY, logistics_batch_id TEXT NOT NULL, batch_no TEXT DEFAULT '', sku_code TEXT NOT NULL, old_qty INTEGER DEFAULT 0, batch_qty INTEGER DEFAULT 0, unit_landing_cost NUMERIC(18,4) DEFAULT 0, old_wac NUMERIC(18,4) DEFAULT 0, new_wac NUMERIC(18,4) DEFAULT 0, confirmed_by TEXT DEFAULT '', confirmed_at TEXT DEFAULT (datetime('now')), currency TEXT DEFAULT '');
    CREATE TABLE IF NOT EXISTS inventory (id TEXT PRIMARY KEY, sku_code TEXT NOT NULL, country TEXT NOT NULL, warehouse TEXT NOT NULL, available_qty INTEGER DEFAULT 0, committed_qty INTEGER DEFAULT 0, in_transit_qty INTEGER DEFAULT 0, weighted_avg_cost NUMERIC(18,4) DEFAULT 0, updated_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS cost_update_logs (id TEXT PRIMARY KEY, sku_code TEXT NOT NULL, country TEXT DEFAULT '', warehouse TEXT DEFAULT '', change_type TEXT DEFAULT '', old_qty INTEGER DEFAULT 0, new_qty INTEGER DEFAULT 0, old_wac NUMERIC(18,4) DEFAULT 0, new_wac NUMERIC(18,4) DEFAULT 0, ref_type TEXT DEFAULT '', ref_id TEXT DEFAULT '', operator_id TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS exchange_rates (id TEXT PRIMARY KEY, from_currency TEXT NOT NULL, to_currency TEXT NOT NULL, rate_date TEXT NOT NULL, rate NUMERIC(18,8) NOT NULL, rate_type TEXT DEFAULT 'realtime', created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS warehouses (id TEXT PRIMARY KEY, warehouse_code TEXT NOT NULL UNIQUE, warehouse_name TEXT DEFAULT '', country TEXT DEFAULT '', warehouse_type TEXT DEFAULT 'self', address TEXT DEFAULT '', status TEXT DEFAULT 'active', brands TEXT DEFAULT '', sort_order INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')));
  `);
}
createTestSchema();

// Helpers (reuse from wac-calculator.test.cjs pattern)
function seedCountry(name, code, currency) {
  const db = getDB();
  const id = 'ctry_' + name;
  db.prepare('INSERT OR REPLACE INTO countries (id, name, country_code, default_currency) VALUES (?,?,?,?)').run(id, name, code, currency);
}
function seedWarehouse(code, name, country, countryName) {
  const db = getDB();
  db.prepare('INSERT OR REPLACE INTO warehouses (warehouse_code, warehouse_name, country) VALUES (?,?,?)').run(code, name, country);
}
function seedSku(code, name, model, brand) {
  const db = getDB();
  db.prepare('INSERT OR REPLACE INTO skus (sku_code, product_name, model, brand) VALUES (?,?,?,?)').run(code, name, model, brand);
}
function seedCI(id, ciNo, currency, total, basis) {
  const db = getDB();
  db.prepare('INSERT OR REPLACE INTO commercial_invoices (id, ci_no, ci_currency, goods_amount, transport_basis, ci_date) VALUES (?,?,?,?,?,?)').run(id, ciNo, currency, total, basis, '2026-01-01');
}
function seedBatch(id, batchNo, ciId, opts) {
  const db = getDB();
  db.prepare(`INSERT OR REPLACE INTO logistics_batches (id, batch_no, related_ci_id, related_ci_no, logistics_status, actual_arrival_date, freight_currency, international_freight, local_charges, total_freight, customs_duty, vat_gst, other_fees, target_country, target_warehouse)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, batchNo, ciId, '', 'completed', opts.arrivalDate || '', opts.freightCurrency || 'USD',
    opts.internationalFreight || opts.totalFreight || 0, opts.localCharges || 0, opts.totalFreight || 0,
    opts.customsDuty || 0, opts.vatGst || 0, opts.otherFees || 0,
    opts.country || 'Indonesia', opts.warehouse || 'WH-JKT'
  );
}
function seedPL(id, plNo, ciId, batchId, opts) {
  const db = getDB();
  db.prepare(`INSERT OR REPLACE INTO packing_lists (id, pl_no, related_ci_id, logistics_batch_id, status, total_qty)
    VALUES (?,?,?,?,?,?)`).run(id, plNo, ciId, batchId, opts.status || 'confirmed', opts.totalQty || 0);
}
function seedPLItem(id, plId, sku, qty, cbm, grossWt) {
  const db = getDB();
  db.prepare(`INSERT OR REPLACE INTO packing_list_items (id, pl_id, sku_code, total_qty, cbm, gross_weight)
    VALUES (?,?,?,?,?,?)`).run(id, plId, sku, qty, cbm, grossWt);
}
function seedInventory(sku, country, warehouse, qty, wac) {
  const db = getDB();
  db.prepare(`INSERT OR REPLACE INTO inventory (sku_code, country, warehouse, available_qty, weighted_avg_cost)
    VALUES (?,?,?,?,?)`).run(sku, country, warehouse, qty, wac);
}
function seedCIItem(id, ciId, sku, qty, unitPrice, netUnitPrice, customsRate) {
  const db = getDB();
  db.prepare(`INSERT OR REPLACE INTO commercial_invoice_items (id, ci_id, sku_code, shipped_qty, unit_price, net_unit_price, customs_rate)
    VALUES (?,?,?,?,?,?,?)`).run(id, ciId, sku, qty, unitPrice, netUnitPrice, customsRate);
}
function seedExchangeRate(from, to, date, rate) {
  const db = getDB();
  db.prepare(`INSERT OR REPLACE INTO exchange_rates (from_currency, to_currency, rate_date, rate, rate_type)
    VALUES (?,?,?,?,?)`).run(from, to, date, rate, 'realtime');
}

// Simulate freight backfill logic (mirrors server.js endpoint)
function simulateFreightBackfill(batchId, payload) {
  const batch = queryOne('SELECT * FROM logistics_batches WHERE id = ?', [batchId]);
  if (!batch) return { status: 404, error: 'Batch not found' };
  if (!batch.related_ci_id) return { status: 400, error: 'No CI' };
  const d = payload;

  // Check if freight cost item already exists
  let costItem = queryOne(
    "SELECT * FROM ci_cost_items WHERE ci_id = ? AND logistics_batch_id = ? AND include_in_landing_cost = 1 AND cost_category = 'warehouse_arrival' AND cost_subcategory = 'freight'",
    [batch.related_ci_id, batch.id]
  );

  let paymentRequest = null;
  if (costItem && costItem.payment_request_id) {
    paymentRequest = queryOne('SELECT * FROM payment_requests WHERE id = ?', [costItem.payment_request_id]);
  }

  // Create payment_request if not exists
  if (!paymentRequest) {
    const prId = genId('pr');
    const prNo = 'PR-TEST-' + Date.now().toString().slice(-6);
    run(
      `INSERT INTO payment_requests (id, request_no, payment_category, payment_subcategory, source_type, source_id, source_no, payee_type, payee_key, payee_name_snapshot, supplier_name, payable_amount, paid_amount, unpaid_amount, currency, payment_status, approval_status, remark)
       VALUES (?, ?, 'logistics', 'freight', 'logistics_batch', ?, ?, 'forwarder', 'test', 'test', 'test', ?, 0, 0, ?, 'approved', 'approved', ?)`,
      [prId, prNo, batch.id, batch.batch_no, d.original_amount, d.original_currency, '[test]']
    );
    paymentRequest = { id: prId, request_no: prNo, currency: d.original_currency };
  }

  // Create or update ci_cost_items
  if (!costItem) {
    const ciId = genId('ci');
    run(
      `INSERT INTO ci_cost_items (id, ci_id, ci_no, payment_request_id, request_no, cost_category, cost_subcategory, payable_amount, paid_amount, include_in_landing_cost, payee_name, currency, logistics_batch_id, remark)
       VALUES (?, ?, ?, ?, ?, 'warehouse_arrival', 'freight', ?, ?, 1, 'test', ?, ?, '[test]')`,
      [ciId, batch.related_ci_id, '', paymentRequest.id, paymentRequest.request_no, d.original_amount, d.original_amount, d.original_currency, batch.id]
    );
  } else if (!costItem.payment_request_id) {
    run('UPDATE ci_cost_items SET payment_request_id = ?, request_no = ?, paid_amount = ? WHERE id = ?',
      [paymentRequest.id, paymentRequest.request_no, d.original_amount, costItem.id]);
  }

  // Check for duplicate settlement log
  const existingLog = queryOne(
    'SELECT id FROM payment_settlement_logs WHERE payment_request_id = ? AND event_type = ? AND status = ? AND amount = ? AND paid_date = ?',
    [paymentRequest.id, 'payment', 'applied', d.original_amount, d.paid_date]
  );
  if (existingLog) {
    return { status: 409, error: '相同的付款记录已存在', payment_request_id: paymentRequest.id };
  }

  // Create settlement log
  const logId = genId('psl');
  run(
    `INSERT INTO payment_settlement_logs (id, payment_request_id, event_type, amount, status, paid_date, original_currency, settlement_country, local_currency, local_rate, local_rate_date, local_rate_type, local_amount, reason, is_legacy)
     VALUES (?, ?, 'payment', ?, 'applied', ?, ?, ?, ?, ?, ?, 'realtime', ?, ?, 1)`,
    [logId, paymentRequest.id, d.original_amount, d.paid_date, d.original_currency, batch.target_country || '',
     d.local_currency, d.local_rate, d.local_rate_date, d.local_amount, '[test]']
  );

  // Update payment_request
  const totalPaid = query(
    'SELECT COALESCE(SUM(amount), 0) AS total FROM payment_settlement_logs WHERE payment_request_id = ? AND event_type = ? AND status = ?',
    [paymentRequest.id, 'payment', 'applied']
  ).rows[0].total;
  run('UPDATE payment_requests SET paid_amount = ?, unpaid_amount = ?, payment_status = ? WHERE id = ?',
    [totalPaid, Math.max(0, d.original_amount - totalPaid), totalPaid >= d.original_amount ? 'paid' : 'partial', paymentRequest.id]);

  // Update ci_cost_items
  run('UPDATE ci_cost_items SET paid_amount = ? WHERE payment_request_id = ? AND logistics_batch_id = ?',
    [totalPaid, paymentRequest.id, batch.id]);

  return { status: 200, success: true, payment_request_id: paymentRequest.id, settlement_log_id: logId };
}

describe('Historical Backfill Idempotency', () => {
  beforeEach(() => {
    const db = getDB();
    db.exec('PRAGMA foreign_keys = OFF');
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
    db.exec('PRAGMA foreign_keys = ON');

    // Seed
    seedCountry('Indonesia', 'ID', 'IDR');
    seedWarehouse('WH-JKT', 'Jakarta Warehouse', 'Indonesia');
    seedSku('SKU-IDEMP', 'Idempotency Test Product', 'MODEL-T', 'BrandT');
    seedCI('ci_idemp', 'CI-IDEMP', 'USD', 5000, 'cbm');
    seedCIItem('cii_idemp', 'ci_idemp', 'SKU-IDEMP', 50, 100, 90, 0.05);
    seedBatch('lb_idemp', 'BATCH-IDEMP', 'ci_idemp', {
      arrivalDate: '2026-01-15', totalFreight: 1000, customsDuty: 50
    });
    seedPL('pl_idemp', 'PL-IDEMP', 'ci_idemp', 'lb_idemp', { status: 'confirmed', totalQty: 50 });
    seedPLItem('pli_idemp', 'pl_idemp', 'SKU-IDEMP', 50, 1, 100);
    seedExchangeRate('USD', 'IDR', '2026-01-15', 15000);
    seedInventory('SKU-IDEMP', 'Indonesia', 'WH-JKT', 30, 200);
  });

  test('same freight backfill payload submitted twice → 2nd is 409 duplicate', () => {
    const payload = {
      original_amount: 1000,
      original_currency: 'USD',
      paid_date: '2026-01-20',
      local_currency: 'IDR',
      local_rate: 15000,
      local_rate_date: '2026-01-20',
      local_amount: 15000000,
      evidence: 'test-evidence-001'
    };

    // 1st submission
    const r1 = simulateFreightBackfill('lb_idemp', payload);
    assert.strictEqual(r1.status, 200, '1st submission should succeed');
    assert.ok(r1.payment_request_id, '1st should return payment_request_id');
    assert.ok(r1.settlement_log_id, '1st should return settlement_log_id');
    const prId1 = r1.payment_request_id;

    // Count after 1st
    const prCount1 = query('SELECT COUNT(*) AS n FROM payment_requests').rows[0].n;
    const cciCount1 = query("SELECT COUNT(*) AS n FROM ci_cost_items WHERE logistics_batch_id = 'lb_idemp'").rows[0].n;
    const pslCount1 = query("SELECT COUNT(*) AS n FROM payment_settlement_logs WHERE payment_request_id = ?", [prId1]).rows[0].n;

    assert.strictEqual(prCount1, 1, 'Should have exactly 1 payment_request');
    assert.strictEqual(cciCount1, 1, 'Should have exactly 1 ci_cost_item');
    assert.strictEqual(pslCount1, 1, 'Should have exactly 1 settlement_log');

    // 2nd submission (same payload)
    const r2 = simulateFreightBackfill('lb_idemp', payload);
    assert.strictEqual(r2.status, 409, '2nd submission must return 409');
    assert.ok(r2.error.includes('已存在') || r2.error.includes('duplicate') || r2.error.includes('已存在'), 'Error should indicate duplicate');

    // Count after 2nd — must NOT increase
    const prCount2 = query('SELECT COUNT(*) AS n FROM payment_requests').rows[0].n;
    const cciCount2 = query("SELECT COUNT(*) AS n FROM ci_cost_items WHERE logistics_batch_id = 'lb_idemp'").rows[0].n;
    const pslCount2 = query("SELECT COUNT(*) AS n FROM payment_settlement_logs WHERE payment_request_id = ?", [prId1]).rows[0].n;

    assert.strictEqual(prCount2, prCount1, 'payment_requests count must NOT increase');
    assert.strictEqual(cciCount2, cciCount1, 'ci_cost_items count must NOT increase');
    assert.strictEqual(pslCount2, pslCount1, 'payment_settlement_logs count must NOT increase');

    console.log('  Idempotency verified:');
    console.log('    1st: status=200, pr_id=' + prId1);
    console.log('    2nd: status=409 (duplicate)');
    console.log('    PR count: ' + prCount1 + ' → ' + prCount2);
    console.log('    ci_cost_items count: ' + cciCount1 + ' → ' + cciCount2);
    console.log('    settlement_logs count: ' + pslCount1 + ' → ' + pslCount2);
  });

  test('different paid_date creates new log (multi-payment scenario)', () => {
    const payload1 = {
      original_amount: 600,
      original_currency: 'USD',
      paid_date: '2026-01-20',
      local_currency: 'IDR',
      local_rate: 15000,
      local_rate_date: '2026-01-20',
      local_amount: 9000000,
      evidence: 'partial-1'
    };
    const payload2 = {
      original_amount: 400,
      original_currency: 'USD',
      paid_date: '2026-02-05',
      local_currency: 'IDR',
      local_rate: 15200,
      local_rate_date: '2026-02-05',
      local_amount: 6080000,
      evidence: 'partial-2'
    };

    const r1 = simulateFreightBackfill('lb_idemp', payload1);
    assert.strictEqual(r1.status, 200, '1st partial should succeed');

    const r2 = simulateFreightBackfill('lb_idemp', payload2);
    assert.strictEqual(r2.status, 200, '2nd partial (different date) should succeed');

    const prId = r1.payment_request_id;
    const pslCount = query("SELECT COUNT(*) AS n FROM payment_settlement_logs WHERE payment_request_id = ?", [prId]).rows[0].n;
    assert.strictEqual(pslCount, 2, 'Should have 2 settlement_logs for multi-payment');

    // Re-submit payload2 → should be 409
    const r3 = simulateFreightBackfill('lb_idemp', payload2);
    assert.strictEqual(r3.status, 409, 'Re-submit same (date) should be 409');

    const pslCount2 = query("SELECT COUNT(*) AS n FROM payment_settlement_logs WHERE payment_request_id = ?", [prId]).rows[0].n;
    assert.strictEqual(pslCount2, 2, 'Count must NOT increase after duplicate');

    console.log('  Multi-payment idempotency verified:');
    console.log('    2 distinct payments → 2 logs');
    console.log('    Re-submit same → 409, count stays ' + pslCount2);
  });

  test('arrival backfill is idempotent (UPDATE overwrites)', () => {
    // Simulate arrival backfill: UPDATE logistics_batches SET actual_arrival_date
    run('UPDATE logistics_batches SET actual_arrival_date = ?, remark = ? WHERE id = ?',
      ['2026-01-10', '[补录凭证: customs-clearance.pdf]', 'lb_idemp']);

    const b1 = queryOne('SELECT actual_arrival_date, remark FROM logistics_batches WHERE id = ?', ['lb_idemp']);
    assert.strictEqual(b1.actual_arrival_date, '2026-01-10');
    assert.ok(b1.remark.includes('补录凭证'));

    // Re-submit with different date
    const oldRemark = b1.remark;
    run('UPDATE logistics_batches SET actual_arrival_date = ?, remark = ? WHERE id = ?',
      ['2026-01-12', oldRemark + ' [补录凭证: revised.pdf]', 'lb_idemp']);

    const b2 = queryOne('SELECT actual_arrival_date, remark FROM logistics_batches WHERE id = ?', ['lb_idemp']);
    assert.strictEqual(b2.actual_arrival_date, '2026-01-12', 'Date should be updated');
    assert.ok(b2.remark.includes('revised.pdf'), 'Remark should include new evidence');

    // Verify only 1 batch row (no duplicates)
    const batchCount = query('SELECT COUNT(*) AS n FROM logistics_batches WHERE id = ?', ['lb_idemp']).rows[0].n;
    assert.strictEqual(batchCount, 1, 'Should still have exactly 1 batch row');

    console.log('  Arrival backfill idempotency verified:');
    console.log('    1st: 2026-01-10, evidence: customs-clearance.pdf');
    console.log('    2nd: 2026-01-12, evidence: revised.pdf');
    console.log('    Batch count: ' + batchCount + ' (no duplicates)');
  });
});
