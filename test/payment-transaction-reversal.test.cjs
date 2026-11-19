'use strict';

process.env.DB_DRIVER = 'sqlite';
process.env.DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const db = require('../db');
db.initDatabase();

const { run, queryOne, getDB } = db;
const {
  applyPaymentSettlement,
  reverseSettlementEvent,
  paymentVoucherFingerprint,
  backfillPaymentVoucherFingerprints,
  computeHistoricalCIPaymentFacts
} = require('../server');

function resetDb() {
  const d = getDB();
  d.pragma('foreign_keys = OFF');
  d.exec(
    "DELETE FROM payment_allocations;" +
    "DELETE FROM payment_transactions;" +
    "DELETE FROM payment_settlement_logs;" +
    "DELETE FROM payment_request_items;" +
    "DELETE FROM payment_requests;" +
    "DELETE FROM payable_items;" +
    "DELETE FROM historical_commercial_invoice_items;" +
    "DELETE FROM historical_commercial_invoices;"
  );
  d.pragma('foreign_keys = ON');
}

function seedRequest(id, requestNo, amount, status = 'approved') {
  run(
    "INSERT INTO payment_requests " +
    "(id, request_no, payment_category, payment_subcategory, source_type, source_id, source_no, " +
    "payee_type, payee_key, payee_name_snapshot, payable_amount, paid_amount, unpaid_amount, " +
    "currency, payment_mode, payment_status, approval_status) " +
    "VALUES (?, ?, 'goods', 'balance', '', '', '', 'supplier', 'supplier:test', " +
    "'Test Supplier', ?, 0, ?, 'RMB', 'single', ?, 'approved')",
    [id, requestNo, amount, amount, status]
  );
}

function seedHciPayment() {
  const hciId = 'hci_reversal_test';
  const payableId = 'payable_hci_reversal_test';
  const prId = 'pr_hci_reversal_test';
  const priId = 'pri_hci_reversal_test';
  const logId = 'settle_hci_reversal_test';
  const txId = 'txn_hci_reversal_test';

  run(
    "INSERT INTO historical_commercial_invoices " +
    "(id, historical_ci_no, supplier_name, supplier_identity, brand_name, country, ci_date, " +
    "currency, gross_goods_amount, payment_terms, credit_days, source_mode, idempotency_key, payload_hash) " +
    "VALUES (?, 'NHT260318B&NHT260417A', 'Netac', 'NETAC', 'Netac', 'ID', " +
    "'2026-03-18', 'RMB', 163836.15, 'Credit', 0, 'historical', ?, ?)",
    [hciId, hciId + '-idem', hciId + '-hash']
  );
  run(
    "INSERT INTO payable_items " +
    "(id, fee_no, source_type, source_id, source_no, source_ci_id, fee_type, " +
    "category_code, subcategory_code, payee_type, payee_key, payee_name_snapshot, " +
    "payer_entity_key, payer_name_snapshot, currency, payable_amount_minor, is_active, lifecycle_status) " +
    "VALUES (?, 'PAY-ITEM-HCI-TEST', 'historical_ci', ?, 'NHT260318B&NHT260417A', '', " +
    "'balance', 'goods', 'balance', 'supplier', 'supplier:test', 'Test Supplier', " +
    "'self', 'Hitech', 'RMB', 16383615, 1, 'partially_paid')",
    [payableId, hciId]
  );
  run(
    "INSERT INTO payment_requests " +
    "(id, request_no, payment_category, payment_subcategory, source_type, source_id, source_no, " +
    "payee_type, payee_key, payee_name_snapshot, payable_amount, paid_amount, unpaid_amount, " +
    "currency, payment_mode, payment_status, approval_status) " +
    "VALUES (?, 'PAY-HCI-REVERSAL-TEST', 'goods', 'balance', '', '', '', " +
    "'supplier', 'supplier:test', 'Test Supplier', 163836.15, 71589, 92247.15, " +
    "'RMB', 'multi', 'partial_paid', 'approved')",
    [prId]
  );
  run(
    "INSERT INTO payment_request_items (id, payment_request_id, payable_item_id, requested_amount_minor) " +
    "VALUES (?, ?, ?, 16383615)",
    [priId, prId, payableId]
  );
  run(
    "INSERT INTO payment_settlement_logs " +
    "(id, payment_request_id, event_type, amount, status, reason, paid_date, " +
    "original_currency, operator_id, operator_name) " +
    "VALUES (?, ?, 'payment', 71589, 'applied', '付款确认', '2026-04-21', 'RMB', 'tester', 'Tester')",
    [logId, prId]
  );
  run(
    "INSERT INTO payment_transactions " +
    "(id, trans_no, payment_request_id, paid_amount_minor, paid_date, payment_account, bank_ref_no, " +
    "trans_status, operator_id, operator_name, voucher_attachment, voucher_fingerprint, " +
    "settlement_log_id, currency) " +
    "VALUES (?, 'TXN-HCI-REVERSAL-TEST', ?, 7158900, '2026-04-21', 'Hitech', '', " +
    "'reconciled', 'tester', 'Tester', '', '', ?, 'RMB')",
    [txId, prId, logId]
  );
  run(
    "INSERT INTO payment_allocations " +
    "(id, transaction_id, payment_request_item_id, allocated_amount_minor, status) " +
    "VALUES ('alloc_hci_reversal_test', ?, ?, 7158900, 'reconciled')",
    [txId, priId]
  );
  return { hciId, payableId, prId, logId, txId };
}

function seedExistingPayment(opts) {
  const id = opts.id;
  const logId = 'settle_' + id;
  seedRequest(id, opts.requestNo, 100, 'paid');
  run(
    "INSERT INTO payment_settlement_logs " +
    "(id, payment_request_id, event_type, amount, status, reason, paid_date, " +
    "payment_voucher, original_currency, operator_id, operator_name) " +
    "VALUES (?, ?, 'payment', 100, 'applied', '付款确认', '2026-04-21', '', 'RMB', 'tester', 'Tester')",
    [logId, id]
  );
  run(
    "INSERT INTO payment_transactions " +
    "(id, trans_no, payment_request_id, paid_amount_minor, paid_date, payment_account, bank_ref_no, " +
    "trans_status, operator_id, operator_name, voucher_attachment, voucher_fingerprint, " +
    "settlement_log_id, currency) " +
    "VALUES (?, ?, ?, 10000, '2026-04-21', ?, ?, 'reconciled', 'tester', 'Tester', ?, '', ?, 'RMB')",
    [opts.transactionId, opts.transNo, id, opts.account !== undefined ? opts.account : 'Hitech', opts.bankRefNo || '', opts.attachment || '', logId]
  );
  return { id, logId, transactionId: opts.transactionId };
}

const operator = { currentUserId: 'tester', currentUserName: 'Test Operator' };

test('PostgreSQL worker-thread migration creates voucher fingerprint before startup backfill', () => {
  const dbSource = fs.readFileSync(path.join(__dirname, '..', 'db.js'), 'utf8');
  assert.match(dbSource, /ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS voucher_fingerprint/);
  assert.match(dbSource, /ix_tx_voucher_fingerprint/);
  assert.match(dbSource, /ix_tx_bank_ref_active/);
  const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(serverSource, /实际付款必须填写银行流水号\/交易参考号/);
});

test('payment voucher fingerprint ignores upload metadata and filenames', () => {
  const a = JSON.stringify([{ name: 'proof-a.png', dataUrl: 'data:image/png;base64,QUJD\nREVG' }]);
  const b = JSON.stringify([{ name: 'renamed.png', dataUrl: 'data:image/png;base64,QUJDREVG' }]);
  assert.equal(paymentVoucherFingerprint(a), paymentVoucherFingerprint(b));
});

test('reversing a payment transaction reverses allocation and restores historical CI outstanding', async () => {
  resetDb();
  const ids = seedHciPayment();

  const result = await reverseSettlementEvent(
    ids.prId,
    ids.logId,
    'payment',
    '与 PI 定金付款凭证重复，纠正重复入账',
    operator
  );

  assert.equal(result.reversed_transaction_id, ids.txId);
  assert.equal(result.reversed_trans_no, 'TXN-HCI-REVERSAL-TEST');
  assert.equal(result.effectivePaid, 0);
  assert.equal(result.outstanding, 163836.15);
  assert.equal(result.payment_status, 'reversed');

  assert.equal(queryOne('SELECT trans_status FROM payment_transactions WHERE id = ?', [ids.txId]).trans_status, 'cancelled');
  assert.equal(queryOne('SELECT status FROM payment_allocations WHERE transaction_id = ?', [ids.txId]).status, 'cancelled');

  const log = queryOne('SELECT status, reversal_reason FROM payment_settlement_logs WHERE id = ?', [ids.logId]);
  assert.equal(log.status, 'reversed');
  assert.equal(log.reversal_reason, '与 PI 定金付款凭证重复，纠正重复入账');

  const request = queryOne('SELECT paid_amount, unpaid_amount, payment_status FROM payment_requests WHERE id = ?', [ids.prId]);
  assert.equal(Number(request.paid_amount), 0);
  assert.equal(Number(request.unpaid_amount), 163836.15);
  assert.equal(request.payment_status, 'reversed');
  assert.equal(queryOne('SELECT lifecycle_status FROM payable_items WHERE id = ?', [ids.payableId]).lifecycle_status, 'reserved');

  const hciFacts = computeHistoricalCIPaymentFacts(ids.hciId);
  assert.equal(hciFacts.subsequent_paid_amount, 0);
  assert.equal(hciFacts.unpaid_amount, 163836.15);
  assert.equal(hciFacts.payment_status, 'unpaid');

  await assert.rejects(
    reverseSettlementEvent(ids.prId, ids.logId, 'payment', '重复撤销测试', operator),
    error => error && error.status === 409
  );
});

test('payment confirmation rejects a voucher already used by another active transaction', async () => {
  resetDb();
  const attachment = JSON.stringify([{ name: 'old.png', dataUrl: 'data:image/png;base64,QUJDREVG' }]);
  seedExistingPayment({
    id: 'pr_existing_voucher',
    requestNo: 'PAY-EXISTING-VOUCHER',
    transactionId: 'txn_existing_voucher',
    transNo: 'TXN-EXISTING-VOUCHER',
    attachment
  });
  seedRequest('pr_new_voucher', 'PAY-NEW-VOUCHER', 100);
  assert.equal(backfillPaymentVoucherFingerprints(), 1);
  assert.ok(queryOne('SELECT voucher_fingerprint FROM payment_transactions WHERE id = ?', ['txn_existing_voucher']).voucher_fingerprint);

  await assert.rejects(
    applyPaymentSettlement('pr_new_voucher', 100, '2026-11-18', '', operator, 'idem-new-voucher', {
      payment_account: 'Hitech',
      bank_ref_no: 'BANK-REF-NEW-VOUCHER',
      voucher_attachment: JSON.stringify([{ name: 'new-name.png', dataUrl: 'data:image/png;base64,QUJDREVG' }])
    }),
    error => error && error.status === 409 && /付款凭证已用于付款单 PAY-EXISTING-VOUCHER/.test(error.message)
  );

  assert.equal(queryOne('SELECT COUNT(*) AS count FROM payment_transactions WHERE payment_request_id = ?', ['pr_new_voucher']).count, 0);
});

test('payment confirmation rejects a duplicate bank reference when the historical account is blank', async () => {
  resetDb();
  seedExistingPayment({
    id: 'pr_existing_ref',
    requestNo: 'PAY-EXISTING-REF',
    transactionId: 'txn_existing_ref',
    transNo: 'TXN-EXISTING-REF',
    bankRefNo: 'BANK-REF-20261118',
    account: ''
  });
  seedRequest('pr_new_ref', 'PAY-NEW-REF', 100);

  await assert.rejects(
    applyPaymentSettlement('pr_new_ref', 100, '2026-11-18', '', operator, 'idem-new-ref', {
      payment_account: 'hitech',
      bank_ref_no: 'BANK-REF-20261118',
      voucher_attachment: JSON.stringify([{ name: 'different.png', dataUrl: 'data:image/png;base64,QUJDREVGSEk=' }])
    }),
    error => error && error.status === 409 && /银行流水号 BANK-REF-20261118 已用于付款单 PAY-EXISTING-REF/.test(error.message)
  );

  assert.equal(queryOne('SELECT COUNT(*) AS count FROM payment_transactions WHERE payment_request_id = ?', ['pr_new_ref']).count, 0);
});

test('manual payment confirmation requires a bank transaction reference', async () => {
  resetDb();
  seedRequest('pr_missing_ref', 'PAY-MISSING-REF', 100);
  await assert.rejects(
    applyPaymentSettlement('pr_missing_ref', 100, '2026-11-18', '', operator, 'idem-missing-ref', {
      payment_account: 'Hitech',
      voucher_attachment: JSON.stringify([{ name: 'proof.png', dataUrl: 'data:image/png;base64,QUJD' }])
    }),
    error => error && error.status === 400 && /银行流水号\/交易参考号/.test(error.message)
  );
  assert.equal(queryOne('SELECT COUNT(*) AS count FROM payment_transactions WHERE payment_request_id = ?', ['pr_missing_ref']).count, 0);
});

test('legacy payment-result import remains compatible when bank reference is unavailable', async () => {
  resetDb();
  seedRequest('pr_legacy_import', 'PAY-LEGACY-IMPORT', 100);
  const result = await applyPaymentSettlement('pr_legacy_import', 100, '2026-11-18', '', operator, 'idem-legacy-import', {
    allow_missing_bank_ref: true
  });
  assert.equal(result.effectivePaid, 100);
  assert.equal(queryOne('SELECT COUNT(*) AS count FROM payment_transactions WHERE payment_request_id = ?', ['pr_legacy_import']).count, 1);
});
