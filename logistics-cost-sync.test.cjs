'use strict';

/**
 * 物流保存 → 自动同步财务应付费用 — 12 项测试
 *
 * 覆盖状态模型：
 *   NONE / GENERATED_NOT_REQUESTED / PAYMENT_FLOW_STARTED / CONFLICT
 *   + amount sync + currency sync + soft-cancel + reactivate + mid-tx failure
 */

const { test, describe, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_DRIVER = 'sqlite';
process.env.DB_PATH = ':memory:';

const dbMod = require('./db');
const { query, queryOne, run, transaction, genId, initDatabase, getDB } = dbMod;
const serverMod = require('./server');
const { syncLogisticsCostFactsCore } = serverMod;

// ── Helpers ──

function resetDB() {
  const d = getDB();
  d.pragma('foreign_keys = OFF');
  d.exec(`
    DELETE FROM payment_request_items;
    DELETE FROM payment_requests;
    DELETE FROM ci_cost_items;
    DELETE FROM payable_items;
    DELETE FROM logistics_batches;
    DELETE FROM commercial_invoice_items;
    DELETE FROM commercial_invoices;
  `);
  d.pragma('foreign_keys = ON');
}

function seedCI(id, ciNo, opts) {
  opts = opts || {};
  run(
    `INSERT INTO commercial_invoices (id, ci_no, ci_date, currency, goods_amount, ci_status, cost_confirmed, has_customs_duty, import_duty_total)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, ciNo, opts.ciDate || '2026-01-01', opts.currency || 'USD', opts.goodsAmount || 10000,
     opts.ciStatus || 'shipped', opts.costConfirmed || 0, opts.hasCustomsDuty || 0, opts.importDutyTotal || 0]
  );
}

function seedBatch(id, batchNo, ciId, opts) {
  opts = opts || {};
  run(
    `INSERT INTO logistics_batches
     (id, batch_no, related_ci_id, related_ci_no, forwarder_name,
      freight_currency, international_freight, local_charges, customs_service_fee, delivery_fee,
      total_freight, customs_duty, vat_gst, other_fees, fee_status, logistics_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, batchNo, ciId, opts.ciNo || 'CI-TEST', opts.forwarderName || 'TestForwarder',
     opts.freightCurrency || 'RMB', opts.internationalFreight || 0, opts.localCharges || 0,
     opts.customsServiceFee || 0, opts.deliveryFee || 0,
     opts.totalFreight || 0, opts.customsDuty || 0, opts.vatGst || 0, opts.otherFees || 0,
     opts.feeStatus || 'unpaid', opts.logisticsStatus || 'pending']
  );
}

function updateBatchFreight(id, freightCurrency, internationalFreight, localCharges, customsServiceFee, deliveryFee) {
  const intl = Number(internationalFreight) || 0;
  const local = Number(localCharges) || 0;
  const customs = Number(customsServiceFee) || 0;
  const delivery = Number(deliveryFee) || 0;
  const total = intl + local + customs + delivery;
  run(
    `UPDATE logistics_batches SET freight_currency = ?, international_freight = ?, local_charges = ?, customs_service_fee = ?, delivery_fee = ?, total_freight = ?, updated_at = datetime('now') WHERE id = ?`,
    [freightCurrency, intl, local, customs, delivery, total, id]
  );
}

function getBatch(id) {
  return queryOne('SELECT * FROM logistics_batches WHERE id = ?', [id]);
}

function countActivePayables(batchId, feeType) {
  const row = queryOne(
    `SELECT COUNT(*) AS cnt FROM payable_items WHERE source_type = 'logistics' AND source_id = ? AND fee_type = ? AND lifecycle_status = 'active'`,
    [batchId, feeType]
  );
  return Number(row.cnt);
}

function countAllPayables(batchId, feeType) {
  const row = queryOne(
    `SELECT COUNT(*) AS cnt FROM payable_items WHERE source_type = 'logistics' AND source_id = ? AND fee_type = ?`,
    [batchId, feeType]
  );
  return Number(row.cnt);
}

function countCurrentCiCost(batchId, subcategory) {
  const row = queryOne(
    `SELECT COUNT(*) AS cnt FROM ci_cost_items WHERE logistics_batch_id = ? AND cost_subcategory = ? AND include_in_landing_cost = 1`,
    [batchId, subcategory]
  );
  return Number(row.cnt);
}

function countAllCiCost(batchId, subcategory) {
  const row = queryOne(
    `SELECT COUNT(*) AS cnt FROM ci_cost_items WHERE logistics_batch_id = ? AND cost_subcategory = ?`,
    [batchId, subcategory]
  );
  return Number(row.cnt);
}

function getPayable(batchId, feeType) {
  return queryOne(
    `SELECT * FROM payable_items WHERE source_type = 'logistics' AND source_id = ? AND fee_type = ?`,
    [batchId, feeType]
  );
}

function getCiCost(batchId, subcategory) {
  return queryOne(
    `SELECT * FROM ci_cost_items WHERE logistics_batch_id = ? AND cost_subcategory = ? AND include_in_landing_cost = 1`,
    [batchId, subcategory]
  );
}

function insertPayableDirect(batchId, ciId, feeType, amount, currency, lifecycleStatus) {
  const id = genId('payitem');
  const feeNo = `PAY-ITEM-TEST-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`;
  const amountMinor = Math.round(amount * 100);
  run(
    `INSERT INTO payable_items (id, fee_no, source_type, source_id, source_no, source_ci_id, fee_type, category_code, subcategory_code, payee_type, payee_key, payee_name_snapshot, payer_entity_key, currency, payable_amount_minor, is_active, lifecycle_status, created_by)
     VALUES (?, ?, 'logistics', ?, '', ?, ?, 'warehouse_arrival', 'freight', 'service_provider', 'sp:TestForwarder', 'TestForwarder', 'self', ?, ?, 1, ?, '')`,
    [id, feeNo, batchId, ciId, feeType, currency, amountMinor, lifecycleStatus || 'active']
  );
  return id;
}

function insertCiCostDirect(batchId, ciId, subcategory, amount, currency, includeInLandingCost) {
  const id = genId('cci');
  run(
    `INSERT INTO ci_cost_items (id, ci_id, ci_no, payment_request_id, request_no, cost_category, cost_subcategory, payable_amount, paid_amount, include_in_landing_cost, payee_name, currency, remark, logistics_batch_id, payable_item_id)
     VALUES (?, ?, '', '', '', 'warehouse_arrival', ?, ?, 0, ?, 'TestForwarder', ?, '', ?, '')`,
    [id, ciId, subcategory, amount, includeInLandingCost !== undefined ? includeInLandingCost : 1, currency, batchId]
  );
  return id;
}

function insertPaymentRequestItem(payableItemId, opts) {
  opts = opts || {};
  const paymentStatus = opts.paymentStatus || 'pending_approval';
  const approvalStatus = opts.approvalStatus || 'pending';
  const prId = genId('payreq');
  run(
    `INSERT INTO payment_requests (id, request_no, payment_category, payment_subcategory, payee_key, payee_name_snapshot, payable_amount, paid_amount, unpaid_amount, currency, payment_status, approval_status)
     VALUES (?, ?, 'warehouse_arrival', 'freight', 'sp:TestForwarder', 'TestForwarder', 0, 0, 0, 'RMB', ?, ?)`,
    [prId, `PR-TEST-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`, paymentStatus, approvalStatus]
  );
  const priId = genId('pri');
  run(
    `INSERT INTO payment_request_items (id, payment_request_id, payable_item_id, requested_amount_minor) VALUES (?, ?, ?, ?)`,
    [priId, prId, payableItemId, 0]
  );
  return prId;
}

// ── Constants ──
const CI_ID = 'ci_test_001';
const BATCH_ID = 'lb_test_001';
const CI_NO = 'CI-TEST-001';
const BATCH_NO = 'LB-TEST-001';

// ── Setup ──
before(() => {
  initDatabase();
});

// ── Tests ──

describe('TEST 1: NONE → CREATE (fee_status=paid, Freight=13601, payable=0, ci=0)', () => {
  beforeEach(() => {
    resetDB();
    seedCI(CI_ID, CI_NO, {});
    seedBatch(BATCH_ID, BATCH_NO, CI_ID, {
      freightCurrency: 'RMB',
      internationalFreight: 13601,
      feeStatus: 'paid'
    });
    run(`UPDATE logistics_batches SET total_freight = 13601 WHERE id = ?`, [BATCH_ID]);
  });

  test('PUT save → 1 payable + 1 ci, amount=13601 RMB', () => {
    const batch = getBatch(BATCH_ID);
    const result = transaction(() => syncLogisticsCostFactsCore(batch, { createdBy: 'test_user', payeeName: '' }));

    assert.ok(result.synced.length > 0, 'should have synced entries');
    assert.strictEqual(countActivePayables(BATCH_ID, 'freight'), 1, '1 active payable');
    assert.strictEqual(countCurrentCiCost(BATCH_ID, 'freight'), 1, '1 current ci_cost_item');

    const payable = getPayable(BATCH_ID, 'freight');
    assert.strictEqual(payable.payable_amount_minor, 1360100, 'payable amount = 13601 RMB (minor)');
    assert.strictEqual(payable.currency, 'RMB');
    assert.strictEqual(payable.lifecycle_status, 'active');

    const ciCost = getCiCost(BATCH_ID, 'freight');
    assert.strictEqual(Number(ciCost.payable_amount), 13601, 'ci_cost amount = 13601');
    assert.strictEqual(ciCost.currency, 'RMB');
  });
});

describe('TEST 2: GENERATED_NOT_REQUESTED → idempotent (same batch PUT save again)', () => {
  beforeEach(() => {
    resetDB();
    seedCI(CI_ID, CI_NO, {});
    seedBatch(BATCH_ID, BATCH_NO, CI_ID, {
      freightCurrency: 'RMB',
      internationalFreight: 13601,
      feeStatus: 'paid'
    });
    run(`UPDATE logistics_batches SET total_freight = 13601 WHERE id = ?`, [BATCH_ID]);
    const batch = getBatch(BATCH_ID);
    transaction(() => syncLogisticsCostFactsCore(batch, { createdBy: 'test_user', payeeName: '' }));
  });

  test('re-save → no duplicate, count 1/1', () => {
    const batch = getBatch(BATCH_ID);
    const result = transaction(() => syncLogisticsCostFactsCore(batch, { createdBy: 'test_user', payeeName: '' }));

    assert.strictEqual(countActivePayables(BATCH_ID, 'freight'), 1, 'still 1 active payable');
    assert.strictEqual(countCurrentCiCost(BATCH_ID, 'freight'), 1, 'still 1 current ci_cost_item');
    assert.strictEqual(countAllPayables(BATCH_ID, 'freight'), 1, 'no extra payable rows');
    assert.strictEqual(countAllCiCost(BATCH_ID, 'freight'), 1, 'no extra ci_cost rows');
  });
});

describe('TEST 3: SYNC amount change (13601 → 14000, no payment flow)', () => {
  beforeEach(() => {
    resetDB();
    seedCI(CI_ID, CI_NO, {});
    seedBatch(BATCH_ID, BATCH_NO, CI_ID, {
      freightCurrency: 'RMB',
      internationalFreight: 13601,
      feeStatus: 'paid'
    });
    run(`UPDATE logistics_batches SET total_freight = 13601 WHERE id = ?`, [BATCH_ID]);
    const batch = getBatch(BATCH_ID);
    transaction(() => syncLogisticsCostFactsCore(batch, { createdBy: 'test_user', payeeName: '' }));
  });

  test('Freight 13601→14000 → payable=14000, ci=14000', () => {
    updateBatchFreight(BATCH_ID, 'RMB', 14000, 0, 0, 0);
    const batch = getBatch(BATCH_ID);
    transaction(() => syncLogisticsCostFactsCore(batch, { createdBy: 'test_user', payeeName: '' }));

    const payable = getPayable(BATCH_ID, 'freight');
    assert.strictEqual(payable.payable_amount_minor, 1400000, 'payable amount updated to 14000');
    assert.strictEqual(payable.lifecycle_status, 'active');

    const ciCost = getCiCost(BATCH_ID, 'freight');
    assert.strictEqual(Number(ciCost.payable_amount), 14000, 'ci_cost amount updated to 14000');
  });
});

describe('TEST 4: SYNC currency change (RMB → USD)', () => {
  beforeEach(() => {
    resetDB();
    seedCI(CI_ID, CI_NO, {});
    seedBatch(BATCH_ID, BATCH_NO, CI_ID, {
      freightCurrency: 'RMB',
      internationalFreight: 13601,
      feeStatus: 'paid'
    });
    run(`UPDATE logistics_batches SET total_freight = 13601 WHERE id = ?`, [BATCH_ID]);
    const batch = getBatch(BATCH_ID);
    transaction(() => syncLogisticsCostFactsCore(batch, { createdBy: 'test_user', payeeName: '' }));
  });

  test('RMB→USD → payable.currency=USD, ci.currency=USD', () => {
    updateBatchFreight(BATCH_ID, 'USD', 13601, 0, 0, 0);
    const batch = getBatch(BATCH_ID);
    transaction(() => syncLogisticsCostFactsCore(batch, { createdBy: 'test_user', payeeName: '' }));

    const payable = getPayable(BATCH_ID, 'freight');
    assert.strictEqual(payable.currency, 'USD', 'payable currency changed to USD');

    const ciCost = getCiCost(BATCH_ID, 'freight');
    assert.strictEqual(ciCost.currency, 'USD', 'ci_cost currency changed to USD');
  });
});

describe('TEST 5: PAYMENT_FLOW_STARTED (payment_request_items exists → 409 + rollback)', () => {
  beforeEach(() => {
    resetDB();
    seedCI(CI_ID, CI_NO, {});
    seedBatch(BATCH_ID, BATCH_NO, CI_ID, {
      freightCurrency: 'RMB',
      internationalFreight: 13601,
      feeStatus: 'paid'
    });
    run(`UPDATE logistics_batches SET total_freight = 13601 WHERE id = ?`, [BATCH_ID]);
    const batch = getBatch(BATCH_ID);
    transaction(() => syncLogisticsCostFactsCore(batch, { createdBy: 'test_user', payeeName: '' }));
    const payable = getPayable(BATCH_ID, 'freight');
    insertPaymentRequestItem(payable.id);
  });

  test('modify amount → 409 + logistics/payable/ci unchanged', () => {
    const origPayable = getPayable(BATCH_ID, 'freight');
    const origCi = getCiCost(BATCH_ID, 'freight');

    let caught = null;
    try {
      transaction(() => {
        run(`UPDATE logistics_batches SET international_freight = 14000, total_freight = 14000 WHERE id = ?`, [BATCH_ID]);
        const batch = getBatch(BATCH_ID);
        syncLogisticsCostFactsCore(batch, { createdBy: 'test_user', payeeName: '' });
      });
    } catch (e) { caught = e; }

    assert.ok(caught, 'should throw');
    assert.strictEqual(caught.status, 409);
    assert.strictEqual(caught.code, 'LOGISTICS_COST_ALREADY_IN_PAYMENT_FLOW');

    const batch = getBatch(BATCH_ID);
    assert.strictEqual(Number(batch.international_freight), 13601, 'logistics batch rolled back to 13601');

    const payable = getPayable(BATCH_ID, 'freight');
    assert.strictEqual(payable.payable_amount_minor, origPayable.payable_amount_minor, 'payable amount unchanged');
    assert.strictEqual(payable.currency, origPayable.currency, 'payable currency unchanged');

    const ciCost = getCiCost(BATCH_ID, 'freight');
    assert.strictEqual(Number(ciCost.payable_amount), Number(origCi.payable_amount), 'ci_cost amount unchanged');
  });
});

describe('TEST 6: CONFLICT payable-only (active payable, no ci_cost_item → 409 + rollback)', () => {
  beforeEach(() => {
    resetDB();
    seedCI(CI_ID, CI_NO, {});
    seedBatch(BATCH_ID, BATCH_NO, CI_ID, {
      freightCurrency: 'RMB',
      internationalFreight: 13601,
      feeStatus: 'paid'
    });
    run(`UPDATE logistics_batches SET total_freight = 13601 WHERE id = ?`, [BATCH_ID]);
    insertPayableDirect(BATCH_ID, CI_ID, 'freight', 13601, 'RMB', 'active');
  });

  test('payable only → 409 COST_GENERATION_STATE_CONFLICT + logistics rollback', () => {
    const origFreight = getBatch(BATCH_ID).international_freight;

    let caught = null;
    try {
      transaction(() => {
        run(`UPDATE logistics_batches SET international_freight = 14000, total_freight = 14000 WHERE id = ?`, [BATCH_ID]);
        const batch = getBatch(BATCH_ID);
        syncLogisticsCostFactsCore(batch, { createdBy: 'test_user', payeeName: '' });
      });
    } catch (e) { caught = e; }

    assert.ok(caught, 'should throw');
    assert.strictEqual(caught.status, 409);
    assert.strictEqual(caught.code, 'COST_GENERATION_STATE_CONFLICT');

    const batch = getBatch(BATCH_ID);
    assert.strictEqual(Number(batch.international_freight), Number(origFreight), 'logistics batch rolled back');
  });
});

describe('TEST 7: CONFLICT ci-only (current ci_cost_item, no payable → 409 + rollback)', () => {
  beforeEach(() => {
    resetDB();
    seedCI(CI_ID, CI_NO, {});
    seedBatch(BATCH_ID, BATCH_NO, CI_ID, {
      freightCurrency: 'RMB',
      internationalFreight: 13601,
      feeStatus: 'paid'
    });
    run(`UPDATE logistics_batches SET total_freight = 13601 WHERE id = ?`, [BATCH_ID]);
    insertCiCostDirect(BATCH_ID, CI_ID, 'freight', 13601, 'RMB', 1);
  });

  test('ci only → 409 COST_GENERATION_STATE_CONFLICT + logistics rollback', () => {
    const origFreight = getBatch(BATCH_ID).international_freight;

    let caught = null;
    try {
      transaction(() => {
        run(`UPDATE logistics_batches SET international_freight = 14000, total_freight = 14000 WHERE id = ?`, [BATCH_ID]);
        const batch = getBatch(BATCH_ID);
        syncLogisticsCostFactsCore(batch, { createdBy: 'test_user', payeeName: '' });
      });
    } catch (e) { caught = e; }

    assert.ok(caught, 'should throw');
    assert.strictEqual(caught.status, 409);
    assert.strictEqual(caught.code, 'COST_GENERATION_STATE_CONFLICT');

    const batch = getBatch(BATCH_ID);
    assert.strictEqual(Number(batch.international_freight), Number(origFreight), 'logistics batch rolled back');
  });
});

describe('TEST 8: Freight >0 → 0 (no payment flow → soft-cancel)', () => {
  beforeEach(() => {
    resetDB();
    seedCI(CI_ID, CI_NO, {});
    seedBatch(BATCH_ID, BATCH_NO, CI_ID, {
      freightCurrency: 'RMB',
      internationalFreight: 13601,
      feeStatus: 'paid'
    });
    run(`UPDATE logistics_batches SET total_freight = 13601 WHERE id = ?`, [BATCH_ID]);
    const batch = getBatch(BATCH_ID);
    transaction(() => syncLogisticsCostFactsCore(batch, { createdBy: 'test_user', payeeName: '' }));
  });

  test('13601→0 → payable cancelled, ci disabled, no DELETE', () => {
    updateBatchFreight(BATCH_ID, 'RMB', 0, 0, 0, 0);
    const batch = getBatch(BATCH_ID);
    transaction(() => syncLogisticsCostFactsCore(batch, { createdBy: 'test_user', payeeName: '' }));

    assert.strictEqual(countActivePayables(BATCH_ID, 'freight'), 0, 'no active payable');
    assert.strictEqual(countAllPayables(BATCH_ID, 'freight'), 1, 'payable row still exists (soft-cancel)');

    const payable = queryOne(`SELECT * FROM payable_items WHERE source_type = 'logistics' AND source_id = ? AND fee_type = 'freight'`, [BATCH_ID]);
    assert.strictEqual(payable.lifecycle_status, 'cancelled', 'payable is cancelled');

    assert.strictEqual(countCurrentCiCost(BATCH_ID, 'freight'), 0, 'no current ci_cost_item');
    assert.strictEqual(countAllCiCost(BATCH_ID, 'freight'), 1, 'ci_cost_item row still exists (disabled)');

    const disabledCi = queryOne(`SELECT * FROM ci_cost_items WHERE logistics_batch_id = ? AND cost_subcategory = 'freight' AND include_in_landing_cost = 0`, [BATCH_ID]);
    assert.ok(disabledCi, 'disabled ci_cost_item exists');
  });
});

describe('TEST 9: Freight >0 → 0 with payment flow (→ 409 + all preserved)', () => {
  beforeEach(() => {
    resetDB();
    seedCI(CI_ID, CI_NO, {});
    seedBatch(BATCH_ID, BATCH_NO, CI_ID, {
      freightCurrency: 'RMB',
      internationalFreight: 13601,
      feeStatus: 'paid'
    });
    run(`UPDATE logistics_batches SET total_freight = 13601 WHERE id = ?`, [BATCH_ID]);
    const batch = getBatch(BATCH_ID);
    transaction(() => syncLogisticsCostFactsCore(batch, { createdBy: 'test_user', payeeName: '' }));
    const payable = getPayable(BATCH_ID, 'freight');
    insertPaymentRequestItem(payable.id);
  });

  test('13601→0 with PR → 409 + all preserved', () => {
    const origPayable = getPayable(BATCH_ID, 'freight');
    const origCi = getCiCost(BATCH_ID, 'freight');

    let caught = null;
    try {
      transaction(() => {
        run(`UPDATE logistics_batches SET international_freight = 0, total_freight = 0 WHERE id = ?`, [BATCH_ID]);
        const batch = getBatch(BATCH_ID);
        syncLogisticsCostFactsCore(batch, { createdBy: 'test_user', payeeName: '' });
      });
    } catch (e) { caught = e; }

    assert.ok(caught, 'should throw');
    assert.strictEqual(caught.status, 409);
    assert.strictEqual(caught.code, 'LOGISTICS_COST_ALREADY_IN_PAYMENT_FLOW');

    const batch = getBatch(BATCH_ID);
    assert.strictEqual(Number(batch.international_freight), 13601, 'logistics batch preserved');

    const payable = getPayable(BATCH_ID, 'freight');
    assert.strictEqual(payable.lifecycle_status, 'active', 'payable still active');
    assert.strictEqual(payable.payable_amount_minor, origPayable.payable_amount_minor, 'payable amount preserved');

    const ciCost = getCiCost(BATCH_ID, 'freight');
    assert.ok(ciCost, 'ci_cost_item still current');
    assert.strictEqual(Number(ciCost.payable_amount), Number(origCi.payable_amount), 'ci_cost amount preserved');
  });
});

describe('TEST 10: >0 → 0 → >0 (reactivate, no permanent CONFLICT)', () => {
  beforeEach(() => {
    resetDB();
    seedCI(CI_ID, CI_NO, {});
    seedBatch(BATCH_ID, BATCH_NO, CI_ID, {
      freightCurrency: 'RMB',
      internationalFreight: 13601,
      feeStatus: 'paid'
    });
    run(`UPDATE logistics_batches SET total_freight = 13601 WHERE id = ?`, [BATCH_ID]);
    const batch = getBatch(BATCH_ID);
    transaction(() => syncLogisticsCostFactsCore(batch, { createdBy: 'test_user', payeeName: '' }));
  });

  test('13601 → 0 → 14000 → only one set of active facts', () => {
    // Step 1: 13601 → 0 (soft-cancel)
    updateBatchFreight(BATCH_ID, 'RMB', 0, 0, 0, 0);
    const batch0 = getBatch(BATCH_ID);
    transaction(() => syncLogisticsCostFactsCore(batch0, { createdBy: 'test_user', payeeName: '' }));

    assert.strictEqual(countActivePayables(BATCH_ID, 'freight'), 0, 'after →0: no active payable');
    assert.strictEqual(countCurrentCiCost(BATCH_ID, 'freight'), 0, 'after →0: no current ci_cost');

    // Step 2: 0 → 14000 (reactivate)
    updateBatchFreight(BATCH_ID, 'RMB', 14000, 0, 0, 0);
    const batch14k = getBatch(BATCH_ID);
    let caught = null;
    try {
      transaction(() => syncLogisticsCostFactsCore(batch14k, { createdBy: 'test_user', payeeName: '' }));
    } catch (e) { caught = e; }

    assert.ok(!caught, 'should NOT throw CONFLICT: ' + (caught ? caught.code : ''));

    assert.strictEqual(countActivePayables(BATCH_ID, 'freight'), 1, 'after →14000: 1 active payable');
    assert.strictEqual(countCurrentCiCost(BATCH_ID, 'freight'), 1, 'after →14000: 1 current ci_cost');

    const payable = getPayable(BATCH_ID, 'freight');
    assert.strictEqual(payable.lifecycle_status, 'active');
    assert.strictEqual(payable.payable_amount_minor, 1400000, 'reactivated payable amount = 14000');

    const ciCost = getCiCost(BATCH_ID, 'freight');
    assert.strictEqual(Number(ciCost.payable_amount), 14000, 'reactivated ci_cost amount = 14000');

    assert.strictEqual(countAllPayables(BATCH_ID, 'freight'), 1, 'only 1 payable row total (reactivated, not duplicated)');
    assert.strictEqual(countAllCiCost(BATCH_ID, 'freight'), 1, 'only 1 ci_cost row total (reactivated, not duplicated)');
  });
});

describe('TEST 11: mid-transaction failure (create payable OK, ci insert fails → rollback)', () => {
  beforeEach(() => {
    resetDB();
    seedCI(CI_ID, CI_NO, {});
    seedBatch(BATCH_ID, BATCH_NO, CI_ID, {
      freightCurrency: 'RMB',
      internationalFreight: 13601,
      feeStatus: 'paid'
    });
    run(`UPDATE logistics_batches SET total_freight = 13601 WHERE id = ?`, [BATCH_ID]);
  });

  test('ci insert failure → payable + logistics rolled back', () => {
    const d = getDB();
    d.exec('ALTER TABLE ci_cost_items RENAME TO ci_cost_items_bak');

    let caught = null;
    try {
      transaction(() => {
        const batch = getBatch(BATCH_ID);
        syncLogisticsCostFactsCore(batch, { createdBy: 'test_user', payeeName: '' });
      });
    } catch (e) { caught = e; }

    d.exec('ALTER TABLE ci_cost_items_bak RENAME TO ci_cost_items');

    assert.ok(caught, 'should throw (ci_cost_items table missing)');

    assert.strictEqual(countAllPayables(BATCH_ID, 'freight'), 0, 'no payable created (rolled back)');
    assert.strictEqual(countAllCiCost(BATCH_ID, 'freight'), 0, 'no ci_cost_item created (table was missing)');

    const batch = getBatch(BATCH_ID);
    assert.strictEqual(Number(batch.international_freight), 13601, 'logistics batch unchanged (no UPDATE was in this tx)');
  });
});

describe('TEST 12: Freight=0, never had cost facts (→ no creation)', () => {
  beforeEach(() => {
    resetDB();
    seedCI(CI_ID, CI_NO, {});
    seedBatch(BATCH_ID, BATCH_NO, CI_ID, {
      freightCurrency: 'RMB',
      internationalFreight: 0,
      feeStatus: 'unpaid'
    });
    run(`UPDATE logistics_batches SET total_freight = 0 WHERE id = ?`, [BATCH_ID]);
  });

  test('Freight=0 → no payable, no ci_cost_item', () => {
    const batch = getBatch(BATCH_ID);
    const result = transaction(() => syncLogisticsCostFactsCore(batch, { createdBy: 'test_user', payeeName: '' }));

    assert.strictEqual(countAllPayables(BATCH_ID, 'freight'), 0, 'no payable created');
    assert.strictEqual(countAllCiCost(BATCH_ID, 'freight'), 0, 'no ci_cost_item created');
    assert.ok(!result.synced || result.synced.length === 0 || result.synced.every(s => s.feeType !== 'freight'),
      'freight not in synced results (amount=0)');
  });
});

// ── TEST 13-18: NO_CHANGE + payment flow + cost_confirmed + fee_status ──

// Helper: set payable lifecycle + insert PR item
function setPayableLifecycle(batchId, feeType, lifecycle) {
  const payable = getPayable(batchId, feeType);
  if (!payable) throw new Error('payable not found for ' + feeType);
  run('UPDATE payable_items SET lifecycle_status = ? WHERE id = ?', [lifecycle, payable.id]);
  if (lifecycle !== 'active' && lifecycle !== 'cancelled') {
    insertPaymentRequestItem(payable.id);
  }
  return payable;
}

describe('TEST 13A: lifecycle=reserved + cost unchanged → save non-financial field succeeds', () => {
  beforeEach(() => {
    resetDB();
    seedCI(CI_ID, CI_NO, {});
    seedBatch(BATCH_ID, BATCH_NO, CI_ID, {
      freightCurrency: 'RMB',
      internationalFreight: 13601,
      feeStatus: 'cost_generated'
    });
    run(`UPDATE logistics_batches SET total_freight = 13601 WHERE id = ?`, [BATCH_ID]);
    const batch = getBatch(BATCH_ID);
    transaction(() => syncLogisticsCostFactsCore(batch, { createdBy: 'test_user', payeeName: '' }));
    setPayableLifecycle(BATCH_ID, 'freight', 'reserved');
  });

  test('reserved + facts consistent → modify eta_date → success', () => {
    const origPayable = getPayable(BATCH_ID, 'freight');
    const origCi = getCiCost(BATCH_ID, 'freight');

    const result = transaction(() => {
      run(`UPDATE logistics_batches SET eta_date = '2026-05-15', updated_at = datetime('now') WHERE id = ?`, [BATCH_ID]);
      const batch = getBatch(BATCH_ID);
      return syncLogisticsCostFactsCore(batch, { createdBy: 'test_user', payeeName: '' });
    });

    assert.ok(result, 'save should succeed');
    assert.ok(!result.synced || result.synced.length === 0, 'no mutations (NO_CHANGE)');

    const payable = getPayable(BATCH_ID, 'freight');
    assert.strictEqual(payable.payable_amount_minor, origPayable.payable_amount_minor, 'payable unchanged');
    assert.strictEqual(payable.lifecycle_status, 'reserved', 'lifecycle still reserved');
    assert.strictEqual(payable.currency, origPayable.currency, 'currency unchanged');

    const ciCost = getCiCost(BATCH_ID, 'freight');
    assert.strictEqual(Number(ciCost.payable_amount), Number(origCi.payable_amount), 'ci_cost unchanged');

    const batch = getBatch(BATCH_ID);
    assert.strictEqual(batch.eta_date, '2026-05-15', 'eta_date saved');
  });
});

describe('TEST 13B: lifecycle=partially_paid + cost unchanged → save succeeds', () => {
  beforeEach(() => {
    resetDB();
    seedCI(CI_ID, CI_NO, {});
    seedBatch(BATCH_ID, BATCH_NO, CI_ID, {
      freightCurrency: 'RMB',
      internationalFreight: 13601,
      feeStatus: 'cost_generated'
    });
    run(`UPDATE logistics_batches SET total_freight = 13601 WHERE id = ?`, [BATCH_ID]);
    const batch = getBatch(BATCH_ID);
    transaction(() => syncLogisticsCostFactsCore(batch, { createdBy: 'test_user', payeeName: '' }));
    setPayableLifecycle(BATCH_ID, 'freight', 'partially_paid');
  });

  test('partially_paid + facts consistent → modify remark → success', () => {
    const result = transaction(() => {
      run(`UPDATE logistics_batches SET remark = 'updated', updated_at = datetime('now') WHERE id = ?`, [BATCH_ID]);
      const batch = getBatch(BATCH_ID);
      return syncLogisticsCostFactsCore(batch, { createdBy: 'test_user', payeeName: '' });
    });

    assert.ok(result, 'save should succeed');
    assert.ok(!result.synced || result.synced.length === 0, 'no mutations (NO_CHANGE)');

    const payable = getPayable(BATCH_ID, 'freight');
    assert.strictEqual(payable.lifecycle_status, 'partially_paid', 'lifecycle preserved');

    const batch = getBatch(BATCH_ID);
    assert.strictEqual(batch.remark, 'updated', 'remark saved');
  });
});

describe('TEST 13C: lifecycle=paid + cost unchanged → save succeeds', () => {
  beforeEach(() => {
    resetDB();
    seedCI(CI_ID, CI_NO, {});
    seedBatch(BATCH_ID, BATCH_NO, CI_ID, {
      freightCurrency: 'RMB',
      internationalFreight: 13601,
      feeStatus: 'cost_generated'
    });
    run(`UPDATE logistics_batches SET total_freight = 13601 WHERE id = ?`, [BATCH_ID]);
    const batch = getBatch(BATCH_ID);
    transaction(() => syncLogisticsCostFactsCore(batch, { createdBy: 'test_user', payeeName: '' }));
    setPayableLifecycle(BATCH_ID, 'freight', 'paid');
  });

  test('paid + facts consistent → modify transport_mode → success', () => {
    const result = transaction(() => {
      run(`UPDATE logistics_batches SET transport_mode = 'air', updated_at = datetime('now') WHERE id = ?`, [BATCH_ID]);
      const batch = getBatch(BATCH_ID);
      return syncLogisticsCostFactsCore(batch, { createdBy: 'test_user', payeeName: '' });
    });

    assert.ok(result, 'save should succeed');
    assert.ok(!result.synced || result.synced.length === 0, 'no mutations (NO_CHANGE)');

    const payable = getPayable(BATCH_ID, 'freight');
    assert.strictEqual(payable.lifecycle_status, 'paid', 'lifecycle preserved');

    const batch = getBatch(BATCH_ID);
    assert.strictEqual(batch.transport_mode, 'air', 'transport_mode saved');
  });
});

describe('TEST 14: lifecycle=reserved + modify freight amount → 409', () => {
  beforeEach(() => {
    resetDB();
    seedCI(CI_ID, CI_NO, {});
    seedBatch(BATCH_ID, BATCH_NO, CI_ID, {
      freightCurrency: 'RMB',
      internationalFreight: 13601,
      feeStatus: 'cost_generated'
    });
    run(`UPDATE logistics_batches SET total_freight = 13601 WHERE id = ?`, [BATCH_ID]);
    const batch = getBatch(BATCH_ID);
    transaction(() => syncLogisticsCostFactsCore(batch, { createdBy: 'test_user', payeeName: '' }));
    setPayableLifecycle(BATCH_ID, 'freight', 'reserved');
  });

  test('reserved + modify freight → 409 + rollback', () => {
    let caught = null;
    try {
      transaction(() => {
        run(`UPDATE logistics_batches SET international_freight = 14000, total_freight = 14000 WHERE id = ?`, [BATCH_ID]);
        const batch = getBatch(BATCH_ID);
        syncLogisticsCostFactsCore(batch, { createdBy: 'test_user', payeeName: '' });
      });
    } catch (e) { caught = e; }

    assert.ok(caught, 'should throw');
    assert.strictEqual(caught.status, 409);
    assert.strictEqual(caught.code, 'LOGISTICS_COST_ALREADY_IN_PAYMENT_FLOW');

    const batch = getBatch(BATCH_ID);
    assert.strictEqual(Number(batch.international_freight), 13601, 'logistics rolled back');
  });
});

describe('TEST 15: lifecycle=reserved + modify freight_currency → 409', () => {
  beforeEach(() => {
    resetDB();
    seedCI(CI_ID, CI_NO, {});
    seedBatch(BATCH_ID, BATCH_NO, CI_ID, {
      freightCurrency: 'RMB',
      internationalFreight: 13601,
      feeStatus: 'cost_generated'
    });
    run(`UPDATE logistics_batches SET total_freight = 13601 WHERE id = ?`, [BATCH_ID]);
    const batch = getBatch(BATCH_ID);
    transaction(() => syncLogisticsCostFactsCore(batch, { createdBy: 'test_user', payeeName: '' }));
    setPayableLifecycle(BATCH_ID, 'freight', 'reserved');
  });

  test('reserved + modify currency → 409 + rollback', () => {
    let caught = null;
    try {
      transaction(() => {
        run(`UPDATE logistics_batches SET freight_currency = 'USD' WHERE id = ?`, [BATCH_ID]);
        const batch = getBatch(BATCH_ID);
        syncLogisticsCostFactsCore(batch, { createdBy: 'test_user', payeeName: '' });
      });
    } catch (e) { caught = e; }

    assert.ok(caught, 'should throw');
    assert.strictEqual(caught.status, 409);
    assert.strictEqual(caught.code, 'LOGISTICS_COST_ALREADY_IN_PAYMENT_FLOW');

    const batch = getBatch(BATCH_ID);
    assert.strictEqual(batch.freight_currency, 'RMB', 'freight_currency rolled back');
  });
});

describe('TEST 16: CI cost_confirmed=1 + cost unchanged → modify eta_date succeeds', () => {
  beforeEach(() => {
    resetDB();
    seedCI(CI_ID, CI_NO, { costConfirmed: 1 });
    seedBatch(BATCH_ID, BATCH_NO, CI_ID, {
      freightCurrency: 'RMB',
      internationalFreight: 13601,
      feeStatus: 'cost_generated'
    });
    run(`UPDATE logistics_batches SET total_freight = 13601 WHERE id = ?`, [BATCH_ID]);
    // Manually create payable + ci_cost (simulating pre-existing facts before CI confirm)
    insertPayableDirect(BATCH_ID, CI_ID, 'freight', 13601, 'RMB', 'active');
    const payable = getPayable(BATCH_ID, 'freight');
    insertCiCostDirect(BATCH_ID, CI_ID, 'freight', 13601, 'RMB', 1);
    // Link ci_cost to payable
    run('UPDATE ci_cost_items SET payable_item_id = ? WHERE logistics_batch_id = ? AND cost_subcategory = ?', [payable.id, BATCH_ID, 'freight']);
  });

  test('cost_confirmed + facts unchanged → modify eta → success (no CI_COST_CONFIRMED)', () => {
    let caught = null;
    let result = null;
    try {
      result = transaction(() => {
        run(`UPDATE logistics_batches SET eta_date = '2026-06-20', updated_at = datetime('now') WHERE id = ?`, [BATCH_ID]);
        const batch = getBatch(BATCH_ID);
        return syncLogisticsCostFactsCore(batch, { createdBy: 'test_user', payeeName: '' });
      });
    } catch (e) { caught = e; }

    assert.ok(!caught, 'should NOT throw CI_COST_CONFIRMED: ' + (caught ? caught.code : ''));
    assert.ok(result, 'save succeeded');

    const batch = getBatch(BATCH_ID);
    assert.strictEqual(batch.eta_date, '2026-06-20', 'eta_date saved');
  });
});

describe('TEST 17: CI cost_confirmed=1 + modify freight amount → 409', () => {
  beforeEach(() => {
    resetDB();
    seedCI(CI_ID, CI_NO, { costConfirmed: 1 });
    seedBatch(BATCH_ID, BATCH_NO, CI_ID, {
      freightCurrency: 'RMB',
      internationalFreight: 13601,
      feeStatus: 'cost_generated'
    });
    run(`UPDATE logistics_batches SET total_freight = 13601 WHERE id = ?`, [BATCH_ID]);
    insertPayableDirect(BATCH_ID, CI_ID, 'freight', 13601, 'RMB', 'active');
    const payable = getPayable(BATCH_ID, 'freight');
    insertCiCostDirect(BATCH_ID, CI_ID, 'freight', 13601, 'RMB', 1);
    run('UPDATE ci_cost_items SET payable_item_id = ? WHERE logistics_batch_id = ? AND cost_subcategory = ?', [payable.id, BATCH_ID, 'freight']);
  });

  test('cost_confirmed + modify freight → 409 CI_COST_CONFIRMED', () => {
    let caught = null;
    try {
      transaction(() => {
        run(`UPDATE logistics_batches SET international_freight = 14000, total_freight = 14000 WHERE id = ?`, [BATCH_ID]);
        const batch = getBatch(BATCH_ID);
        syncLogisticsCostFactsCore(batch, { createdBy: 'test_user', payeeName: '' });
      });
    } catch (e) { caught = e; }

    assert.ok(caught, 'should throw');
    assert.strictEqual(caught.status, 409);
    assert.strictEqual(caught.code, 'CI_COST_CONFIRMED');

    const batch = getBatch(BATCH_ID);
    assert.strictEqual(Number(batch.international_freight), 13601, 'logistics rolled back');
  });
});

describe('TEST 18: fee_status=paid + cost unchanged → fee_status not rewritten', () => {
  beforeEach(() => {
    resetDB();
    seedCI(CI_ID, CI_NO, {});
    seedBatch(BATCH_ID, BATCH_NO, CI_ID, {
      freightCurrency: 'RMB',
      internationalFreight: 13601,
      feeStatus: 'paid'
    });
    run(`UPDATE logistics_batches SET total_freight = 13601 WHERE id = ?`, [BATCH_ID]);
    // Create facts manually (simulating complete state)
    insertPayableDirect(BATCH_ID, CI_ID, 'freight', 13601, 'RMB', 'active');
    const payable = getPayable(BATCH_ID, 'freight');
    insertCiCostDirect(BATCH_ID, CI_ID, 'freight', 13601, 'RMB', 1);
    run('UPDATE ci_cost_items SET payable_item_id = ? WHERE logistics_batch_id = ? AND cost_subcategory = ?', [payable.id, BATCH_ID, 'freight']);
  });

  test('fee_status=paid + facts unchanged → stays paid after save', () => {
    const result = transaction(() => {
      run(`UPDATE logistics_batches SET eta_date = '2026-07-01', remark = 'updated remark', updated_at = datetime('now') WHERE id = ?`, [BATCH_ID]);
      const batch = getBatch(BATCH_ID);
      return syncLogisticsCostFactsCore(batch, { createdBy: 'test_user', payeeName: '' });
    });

    assert.ok(result, 'save succeeded');
    assert.ok(!result.synced || result.synced.length === 0, 'no mutations (NO_CHANGE)');

    const batch = getBatch(BATCH_ID);
    assert.strictEqual(batch.fee_status, 'paid', 'fee_status still paid (not rewritten to cost_generated)');
    assert.strictEqual(batch.eta_date, '2026-07-01', 'eta_date saved');
    assert.strictEqual(batch.remark, 'updated remark', 'remark saved');
  });
});

// ── TEST 19-21: Fact drift + cancelled/enabled CONFLICT ──

describe('TEST 19: payable/ci_cost drift (no payment flow → sync to fix)', () => {
  beforeEach(() => {
    resetDB();
    seedCI(CI_ID, CI_NO, {});
    seedBatch(BATCH_ID, BATCH_NO, CI_ID, {
      freightCurrency: 'RMB',
      internationalFreight: 13601,
      feeStatus: 'cost_generated'
    });
    run(`UPDATE logistics_batches SET total_freight = 13601 WHERE id = ?`, [BATCH_ID]);
    // Create payable with 13601 and ci_cost with 13000 (drift)
    insertPayableDirect(BATCH_ID, CI_ID, 'freight', 13601, 'RMB', 'active');
    const payable = getPayable(BATCH_ID, 'freight');
    insertCiCostDirect(BATCH_ID, CI_ID, 'freight', 13000, 'RMB', 1);
    run('UPDATE ci_cost_items SET payable_item_id = ? WHERE logistics_batch_id = ? AND cost_subcategory = ?', [payable.id, BATCH_ID, 'freight']);
  });

  test('drift (payable=13601, ci=13000) + no PR → sync fixes ci to 13601', () => {
    const result = transaction(() => {
      const batch = getBatch(BATCH_ID);
      return syncLogisticsCostFactsCore(batch, { createdBy: 'test_user', payeeName: '' });
    });

    assert.ok(result.synced && result.synced.length > 0, 'should have a SYNC mutation');

    const payable = getPayable(BATCH_ID, 'freight');
    assert.strictEqual(payable.payable_amount_minor, 1360100, 'payable = 13601');

    const ciCost = getCiCost(BATCH_ID, 'freight');
    assert.strictEqual(Number(ciCost.payable_amount), 13601, 'ci_cost fixed to 13601');
    assert.strictEqual(ciCost.payable_item_id, payable.id, 'linkage restored');
  });
});

describe('TEST 20: payable/ci_cost drift + payment flow started → 409 CONFLICT', () => {
  beforeEach(() => {
    resetDB();
    seedCI(CI_ID, CI_NO, {});
    seedBatch(BATCH_ID, BATCH_NO, CI_ID, {
      freightCurrency: 'RMB',
      internationalFreight: 13601,
      feeStatus: 'cost_generated'
    });
    run(`UPDATE logistics_batches SET total_freight = 13601 WHERE id = ?`, [BATCH_ID]);
    // Create payable with 13601 and ci_cost with 13000 (drift) + reserved lifecycle
    insertPayableDirect(BATCH_ID, CI_ID, 'freight', 13601, 'RMB', 'active');
    const payable = getPayable(BATCH_ID, 'freight');
    insertCiCostDirect(BATCH_ID, CI_ID, 'freight', 13000, 'RMB', 1);
    run('UPDATE ci_cost_items SET payable_item_id = ? WHERE logistics_batch_id = ? AND cost_subcategory = ?', [payable.id, BATCH_ID, 'freight']);
    // Set to reserved + insert PR
    setPayableLifecycle(BATCH_ID, 'freight', 'reserved');
  });

  test('drift + reserved → 409 COST_GENERATION_STATE_CONFLICT', () => {
    let caught = null;
    try {
      transaction(() => {
        const batch = getBatch(BATCH_ID);
        syncLogisticsCostFactsCore(batch, { createdBy: 'test_user', payeeName: '' });
      });
    } catch (e) { caught = e; }

    assert.ok(caught, 'should throw');
    assert.strictEqual(caught.status, 409);
    assert.strictEqual(caught.code, 'COST_GENERATION_STATE_CONFLICT');
    assert.ok(caught.detail, 'should have detail with drift info');
    assert.strictEqual(caught.detail.payable_amount_minor, 1360100, 'detail has payable amount');
    assert.strictEqual(caught.detail.ci_cost_amount_minor, 1300000, 'detail has ci_cost amount');

    // Verify nothing was changed
    const payable = getPayable(BATCH_ID, 'freight');
    assert.strictEqual(payable.payable_amount_minor, 1360100, 'payable unchanged');
    const ciCost = getCiCost(BATCH_ID, 'freight');
    assert.strictEqual(Number(ciCost.payable_amount), 13000, 'ci_cost unchanged');
  });
});

describe('TEST 21: cancelled payable + enabled ci_cost → 409 CONFLICT', () => {
  beforeEach(() => {
    resetDB();
    seedCI(CI_ID, CI_NO, {});
    seedBatch(BATCH_ID, BATCH_NO, CI_ID, {
      freightCurrency: 'RMB',
      internationalFreight: 0,
      feeStatus: 'cost_generated'
    });
    run(`UPDATE logistics_batches SET total_freight = 0 WHERE id = ?`, [BATCH_ID]);
    // Create cancelled payable + ENABLED ci_cost (broken state)
    insertPayableDirect(BATCH_ID, CI_ID, 'freight', 13601, 'RMB', 'cancelled');
    const payable = getPayable(BATCH_ID, 'freight');
    insertCiCostDirect(BATCH_ID, CI_ID, 'freight', 13601, 'RMB', 1);
    run('UPDATE ci_cost_items SET payable_item_id = ? WHERE logistics_batch_id = ? AND cost_subcategory = ?', [payable.id, BATCH_ID, 'freight']);
  });

  test('cancelled payable + enabled ci_cost → 409 (not NO_CHANGE)', () => {
    let caught = null;
    try {
      transaction(() => {
        const batch = getBatch(BATCH_ID);
        syncLogisticsCostFactsCore(batch, { createdBy: 'test_user', payeeName: '' });
      });
    } catch (e) { caught = e; }

    assert.ok(caught, 'should throw');
    assert.strictEqual(caught.status, 409);
    assert.strictEqual(caught.code, 'COST_GENERATION_STATE_CONFLICT');
    assert.ok(caught.detail, 'detail with state info');
  });
});

// ── TEST 22-25: payment_request_items retained after reject — must not block editing ──

describe('TEST 22: payable active + rejected PR → modify amount allows SYNC', () => {
  beforeEach(() => {
    resetDB();
    seedCI(CI_ID, CI_NO, {});
    seedBatch(BATCH_ID, BATCH_NO, CI_ID, {
      freightCurrency: 'RMB',
      internationalFreight: 13601,
      feeStatus: 'cost_generated'
    });
    run(`UPDATE logistics_batches SET total_freight = 13601 WHERE id = ?`, [BATCH_ID]);
    // Sync to create payable + ci_cost
    const batch = getBatch(BATCH_ID);
    transaction(() => syncLogisticsCostFactsCore(batch, { createdBy: 'test_user', payeeName: '' }));
    // Insert a REJECTED PR — payment_request_items retained for audit
    const payable = getPayable(BATCH_ID, 'freight');
    insertPaymentRequestItem(payable.id, { paymentStatus: 'rejected', approvalStatus: 'rejected' });
  });

  test('rejected PR + amount 13601→14000 → SYNC allowed', () => {
    const result = transaction(() => {
      run(`UPDATE logistics_batches SET international_freight = 14000, total_freight = 14000 WHERE id = ?`, [BATCH_ID]);
      const batch = getBatch(BATCH_ID);
      return syncLogisticsCostFactsCore(batch, { createdBy: 'test_user', payeeName: '' });
    });

    assert.ok(result.synced && result.synced.length > 0, 'should have a SYNC mutation');

    const payable = getPayable(BATCH_ID, 'freight');
    assert.strictEqual(payable.payable_amount_minor, 1400000, 'payable = 14000');

    const ciCost = getCiCost(BATCH_ID, 'freight');
    assert.strictEqual(Number(ciCost.payable_amount), 14000, 'ci_cost = 14000');
  });
});

describe('TEST 23: payable active + rejected PR → modify currency allows SYNC', () => {
  beforeEach(() => {
    resetDB();
    seedCI(CI_ID, CI_NO, {});
    seedBatch(BATCH_ID, BATCH_NO, CI_ID, {
      freightCurrency: 'RMB',
      internationalFreight: 13601,
      feeStatus: 'cost_generated'
    });
    run(`UPDATE logistics_batches SET total_freight = 13601 WHERE id = ?`, [BATCH_ID]);
    const batch = getBatch(BATCH_ID);
    transaction(() => syncLogisticsCostFactsCore(batch, { createdBy: 'test_user', payeeName: '' }));
    const payable = getPayable(BATCH_ID, 'freight');
    insertPaymentRequestItem(payable.id, { paymentStatus: 'rejected', approvalStatus: 'rejected' });
  });

  test('rejected PR + currency RMB→USD → SYNC allowed', () => {
    const result = transaction(() => {
      run(`UPDATE logistics_batches SET freight_currency = 'USD' WHERE id = ?`, [BATCH_ID]);
      const batch = getBatch(BATCH_ID);
      return syncLogisticsCostFactsCore(batch, { createdBy: 'test_user', payeeName: '' });
    });

    assert.ok(result.synced && result.synced.length > 0, 'should have a SYNC mutation');

    const payable = getPayable(BATCH_ID, 'freight');
    assert.strictEqual(payable.currency, 'USD', 'payable currency = USD');

    const ciCost = getCiCost(BATCH_ID, 'freight');
    assert.strictEqual(ciCost.currency, 'USD', 'ci_cost currency = USD');
  });
});

describe('TEST 24: payable active + pending PR → 409 PAYMENT_FLOW_STARTED', () => {
  beforeEach(() => {
    resetDB();
    seedCI(CI_ID, CI_NO, {});
    seedBatch(BATCH_ID, BATCH_NO, CI_ID, {
      freightCurrency: 'RMB',
      internationalFreight: 13601,
      feeStatus: 'cost_generated'
    });
    run(`UPDATE logistics_batches SET total_freight = 13601 WHERE id = ?`, [BATCH_ID]);
    const batch = getBatch(BATCH_ID);
    transaction(() => syncLogisticsCostFactsCore(batch, { createdBy: 'test_user', payeeName: '' }));
    // Insert a PENDING PR — active, should block
    const payable = getPayable(BATCH_ID, 'freight');
    assert.strictEqual(payable.lifecycle_status, 'active', 'payable should be active');
    insertPaymentRequestItem(payable.id);
  });

  test('active payable + pending PR + amount 13601→14000 → 409', () => {
    let caught = null;
    try {
      transaction(() => {
        run(`UPDATE logistics_batches SET international_freight = 14000, total_freight = 14000 WHERE id = ?`, [BATCH_ID]);
        const batch = getBatch(BATCH_ID);
        syncLogisticsCostFactsCore(batch, { createdBy: 'test_user', payeeName: '' });
      });
    } catch (e) { caught = e; }

    assert.ok(caught, 'should throw');
    assert.strictEqual(caught.status, 409);
    assert.strictEqual(caught.code, 'LOGISTICS_COST_ALREADY_IN_PAYMENT_FLOW');

    const payable = getPayable(BATCH_ID, 'freight');
    assert.strictEqual(payable.payable_amount_minor, 1360100, 'payable unchanged');
    const ciCost = getCiCost(BATCH_ID, 'freight');
    assert.strictEqual(Number(ciCost.payable_amount), 13601, 'ci_cost unchanged');
  });
});

describe('TEST 25: rejected PR + new pending PR → active PR blocks', () => {
  beforeEach(() => {
    resetDB();
    seedCI(CI_ID, CI_NO, {});
    seedBatch(BATCH_ID, BATCH_NO, CI_ID, {
      freightCurrency: 'RMB',
      internationalFreight: 13601,
      feeStatus: 'cost_generated'
    });
    run(`UPDATE logistics_batches SET total_freight = 13601 WHERE id = ?`, [BATCH_ID]);
    const batch = getBatch(BATCH_ID);
    transaction(() => syncLogisticsCostFactsCore(batch, { createdBy: 'test_user', payeeName: '' }));
    const payable = getPayable(BATCH_ID, 'freight');
    // Historical rejected PR (terminal, retained for audit)
    insertPaymentRequestItem(payable.id, { paymentStatus: 'rejected', approvalStatus: 'rejected' });
    // New active pending PR (should block)
    insertPaymentRequestItem(payable.id);
  });

  test('rejected + pending PR → 403/409 (active PR takes priority)', () => {
    let caught = null;
    try {
      transaction(() => {
        run(`UPDATE logistics_batches SET international_freight = 14000, total_freight = 14000 WHERE id = ?`, [BATCH_ID]);
        const batch = getBatch(BATCH_ID);
        syncLogisticsCostFactsCore(batch, { createdBy: 'test_user', payeeName: '' });
      });
    } catch (e) { caught = e; }

    assert.ok(caught, 'should throw');
    assert.strictEqual(caught.status, 409);
    assert.strictEqual(caught.code, 'LOGISTICS_COST_ALREADY_IN_PAYMENT_FLOW');

    const payable = getPayable(BATCH_ID, 'freight');
    assert.strictEqual(payable.payable_amount_minor, 1360100, 'payable unchanged');
  });
});
