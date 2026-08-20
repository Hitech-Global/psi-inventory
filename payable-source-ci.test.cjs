'use strict';

/**
 * Payable Source CI Validation — Targeted Tests
 *
 * Verifies:
 *   A) logistics payable with valid source_ci_id → validation PASS
 *   B) logistics payable with non-existent CI → 400 "来源CI不存在"
 *   C) logistics payable where source_ci_id ≠ batch.related_ci_id → 400 "不一致"
 *   D) non-logistics payable (ci type) → behavior unchanged
 *   E) production-equivalent fixture (log_1785822282160_jyjayz / ci_1785312736968_3sne9r)
 */

const { test, describe, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_DRIVER = 'sqlite';
process.env.DB_PATH = ':memory:';

const dbMod = require('./db');
const { query, queryOne, run, transaction, genId, initDatabase, getDB } = dbMod;
const serverMod = require('./server');
const { payableItemSourceExpenseCountry } = serverMod;

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
    DELETE FROM commercial_invoices;
  `);
  d.pragma('foreign_keys = ON');
}

function seedCI(id, ciNo, opts) {
  opts = opts || {};
  run(
    `INSERT INTO commercial_invoices (id, ci_no, ci_date, currency, goods_amount, ci_status, country)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, ciNo, opts.ciDate || '2026-01-01', opts.currency || 'USD',
     opts.goodsAmount || 10000, opts.ciStatus || 'shipped',
     opts.country || 'Indonesia']
  );
}

function seedBatch(id, batchNo, ciId, opts) {
  opts = opts || {};
  run(
    `INSERT INTO logistics_batches
     (id, batch_no, related_ci_id, related_ci_no, forwarder_name,
      freight_currency, international_freight, local_charges, customs_service_fee, delivery_fee,
      total_freight, fee_status, logistics_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, batchNo, ciId, opts.ciNo || 'CI-TEST', opts.forwarderName || 'TestForwarder',
     opts.freightCurrency || 'RMB', opts.intlFreight || 13601, opts.localCharges || 0,
     opts.customsServiceFee || 0, opts.deliveryFee || 0,
     opts.totalFreight || 13601, opts.feeStatus || 'cost_generated', opts.logisticsStatus || 'pending']
  );
}

function seedPayable(id, feeNo, sourceType, sourceId, opts) {
  opts = opts || {};
  run(
    `INSERT INTO payable_items
     (id, fee_no, source_type, source_id, source_no, source_ci_id,
      fee_type, category_code, subcategory_code, payee_type, payee_key, payee_name_snapshot,
      payer_entity_key, currency, payable_amount_minor, is_active, lifecycle_status, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, feeNo, sourceType, sourceId, opts.sourceNo || '',
     opts.sourceCiId || '',
     opts.feeType || 'freight', '', '', opts.payeeType || 'warehouse',
     opts.payeeKey || 'test-payee', opts.payeeNameSnapshot || 'TestPayee',
     opts.payerEntityKey || 'test-entity', opts.currency || 'RMB',
     opts.amountMinor || 1360100, 1, opts.lifecycleStatus || 'active', 'test']
  );
}

// ── Setup ──
before(() => {
  initDatabase();
});

// ── Tests ──

describe('Payable Source CI Validation', () => {

  beforeEach(() => resetDB());

  test('TEST A — logistics payable with valid source_ci_id → validation PASS', () => {
    const ciId = 'ci_test_a';
    const batchId = 'log_test_a';

    seedCI(ciId, 'CI-A', { country: '印尼', currency: 'USD' });
    seedBatch(batchId, 'BATCH-A', ciId);
    seedPayable('pay_a', 'PAY-A', 'logistics', batchId, {
      sourceCiId: ciId,
      feeType: 'freight',
      currency: 'RMB',
      amountMinor: 1360100
    });

    // Simulate the multi-expense SELECT (must include source_ci_id)
    const item = queryOne(
      `SELECT id, fee_no, source_type, source_id, source_no, source_ci_id, fee_type,
              category_code, subcategory_code, payee_type, payee_key, payee_name_snapshot,
              currency, payable_amount_minor, lifecycle_status
       FROM payable_items WHERE id = ?`,
      ['pay_a']
    );

    // Prove source_ci_id survived the SELECT
    assert.ok(item.source_ci_id !== undefined, 'source_ci_id must be present in SELECT result');
    assert.equal(item.source_ci_id, ciId);

    // Validation must PASS
    const country = payableItemSourceExpenseCountry(item);
    assert.equal(country, '印尼');
  });

  test('TEST B — logistics payable with non-existent CI → 400 "来源CI不存在"', () => {
    const batchId = 'log_test_b';
    const fakeCiId = 'ci_does_not_exist';

    // Don't create the CI
    seedBatch(batchId, 'BATCH-B', fakeCiId);
    seedPayable('pay_b', 'PAY-B', 'logistics', batchId, {
      sourceCiId: fakeCiId
    });

    const item = queryOne('SELECT *, source_ci_id FROM payable_items WHERE id = ?', ['pay_b']);

    assert.throws(
      () => payableItemSourceExpenseCountry(item),
      (err) => err.status === 400 && /来源CI不存在/.test(err.message)
    );
  });

  test('TEST C — linkage conflict: source_ci_id ≠ batch.related_ci_id → 400 "不一致"', () => {
    const ciA = 'ci_conflict_a';
    const ciB = 'ci_conflict_b';
    const batchId = 'log_test_c';

    // Two CIs exist
    seedCI(ciA, 'CI-CONFLICT-A', { country: '印尼' });
    seedCI(ciB, 'CI-CONFLICT-B', { country: '泰国' });

    // Batch linked to ciB...
    seedBatch(batchId, 'BATCH-C', ciB);
    // ...but payable says source_ci_id = ciA (mismatch!)
    seedPayable('pay_c', 'PAY-C', 'logistics', batchId, {
      sourceCiId: ciA
    });

    const item = queryOne('SELECT *, source_ci_id FROM payable_items WHERE id = ?', ['pay_c']);

    assert.throws(
      () => payableItemSourceExpenseCountry(item),
      (err) => err.status === 400 && /不一致/.test(err.message)
    );
  });

  test('TEST D — non-logistics payable (ci type) → behavior unchanged', () => {
    const ciId = 'ci_test_d';

    seedCI(ciId, 'CI-D', { country: '泰国', currency: 'USD' });
    // source_type='ci', source_id=ciId (not logistics)
    seedPayable('pay_d', 'PAY-D', 'ci', ciId, {
      sourceCiId: '',
      feeType: 'balance',
      currency: 'USD',
      amountMinor: 500000
    });

    const item = queryOne('SELECT *, source_ci_id FROM payable_items WHERE id = ?', ['pay_d']);

    // Must not throw — ci type uses source_id, not source_ci_id
    const country = payableItemSourceExpenseCountry(item);
    assert.equal(country, '泰国');
  });

  test('TEST E — production-equivalent fixture (log_1785822282160_jyjayz)', () => {
    const prodCiId = 'ci_1785312736968_3sne9r';
    const prodBatchId = 'log_1785822282160_jyjayz';
    const prodPayableId = 'payitem_1787226953116_6m54ky';

    // CI exists with country=Indonesia
    seedCI(prodCiId, 'SZIAF014533/SZIAF014541', {
      country: '印尼',
      currency: 'USD',
      goodsAmount: 100000
    });

    // Batch linked to the same CI
    seedBatch(prodBatchId, 'SZIAF014533/SZIAF014541', prodCiId, {
      freightCurrency: 'RMB',
      intlFreight: 13601,
      totalFreight: 13601
    });

    // Payable: logistics freight, 13601 RMB
    seedPayable(prodPayableId, 'PAY-ITEM-2026-953116-d9w', 'logistics', prodBatchId, {
      sourceCiId: prodCiId,
      feeType: 'freight',
      currency: 'RMB',
      amountMinor: 1360100
    });

    // Simulate exact multi-expense SELECT
    const items = query(
      `SELECT id, fee_no, source_type, source_id, source_no, source_ci_id, fee_type,
              category_code, subcategory_code, payee_type, payee_key, payee_name_snapshot,
              currency, payable_amount_minor, lifecycle_status
       FROM payable_items WHERE id IN (?)`,
      [prodPayableId]
    );

    assert.equal(items.rows.length, 1);
    const item = items.rows[0];

    // Prove source_ci_id is in the SELECT result
    assert.equal(item.source_ci_id, prodCiId);

    // Validation must PASS — this is the exact scenario that was failing in production
    const country = payableItemSourceExpenseCountry(item);
    assert.equal(country, '印尼');
  });

});
