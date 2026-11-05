'use strict';

process.env.DB_DRIVER = 'sqlite';
process.env.DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const db = require('../db');

db.initDatabase();
const { run, queryOne } = db;
const {
  createPayableItemFromSource,
  syncPiDepositPayableDate,
  backfillPiDepositPayableDates
} = require('../server');

function seedPi(id, piDate) {
  run(
    'INSERT INTO proforma_invoices (id, pi_no, pi_date, brand, country) VALUES (?, ?, ?, ?, ?)',
    [id, 'PI-' + id, piDate, 'Netac', '印度尼西亚']
  );
}

function createDepositPayable(piId) {
  return createPayableItemFromSource({
    sourceType: 'pi',
    sourceId: piId,
    sourceNo: 'PI-' + piId,
    feeType: 'deposit',
    categoryCode: 'goods',
    subcategoryCode: 'deposit',
    payeeType: 'factory',
    payeeKey: 'supplier:' + piId,
    payeeName: 'Supplier ' + piId,
    currency: 'USD',
    payableAmount: 300,
    payableDate: '2000-01-01',
    createdBy: 'test'
  });
}

function seedDepositRequest(id, piId, paymentStatus, approvalStatus, payableDate) {
  run('INSERT INTO payment_requests (id, request_no) VALUES (?, ?)', [id, 'PR-' + id]);
  run(
    `UPDATE payment_requests
        SET payment_category = 'goods',
            payment_subcategory = 'deposit',
            source_type = 'pi',
            source_id = ?,
            source_no = ?,
            payable_date = ?,
            payment_status = ?,
            approval_status = ?
      WHERE id = ?`,
    [piId, 'PI-' + piId, payableDate || '', paymentStatus, approvalStatus, id]
  );
}

test('PI deposit payable creation always takes the PI date, not the passed date', () => {
  seedPi('pi-create-date', '2026-11-05');
  const item = createDepositPayable('pi-create-date');
  const saved = queryOne('SELECT payable_date FROM payable_items WHERE id = ?', [item.id]);
  assert.equal(saved.payable_date, '2026-11-05');
});

test('editing PI date syncs open deposit payable and pending deposit payment request', () => {
  seedPi('pi-edit-date', '2026-11-05');
  const item = createDepositPayable('pi-edit-date');
  run('UPDATE payable_items SET lifecycle_status = ?, payable_date = ? WHERE id = ?', [
    'reserved', '', item.id
  ]);
  seedDepositRequest('pr-edit-date', 'pi-edit-date', 'pending_approval', 'pending', '');
  const result = syncPiDepositPayableDate('pi-edit-date', '2026-11-06');
  assert.ok(result.payableItems >= 1);
  assert.ok(result.paymentRequests >= 1);
  assert.equal(queryOne('SELECT payable_date FROM payable_items WHERE id = ?', [item.id]).payable_date, '2026-11-06');
  assert.equal(queryOne('SELECT payable_date FROM payment_requests WHERE id = ?', ['pr-edit-date']).payable_date, '2026-11-06');
});

test('startup backfill repairs historical PI deposit dates without changing payment facts or cancelled records', () => {
  seedPi('pi-backfill-date', '2026-10-29');
  const paidItem = createDepositPayable('pi-backfill-date');
  run('UPDATE payable_items SET lifecycle_status = ?, payable_date = ? WHERE id = ?', [
    'paid', '', paidItem.id
  ]);
  seedDepositRequest('pr-backfill-date', 'pi-backfill-date', 'paid', 'approved', '');
  run('UPDATE payment_requests SET paid_date = ? WHERE id = ?', ['2026-10-30', 'pr-backfill-date']);

  seedPi('pi-cancelled-date', '2026-10-28');
  const cancelledItem = createDepositPayable('pi-cancelled-date');
  run('UPDATE payable_items SET lifecycle_status = ?, payable_date = ? WHERE id = ?', [
    'cancelled', '', cancelledItem.id
  ]);
  seedDepositRequest('pr-cancelled-date', 'pi-cancelled-date', 'cancelled', 'cancelled', '');

  const result = backfillPiDepositPayableDates();
  assert.ok(result.payableItems >= 1);
  assert.ok(result.paymentRequests >= 1);
  assert.equal(queryOne('SELECT payable_date FROM payable_items WHERE id = ?', [paidItem.id]).payable_date, '2026-10-29');
  const paidRequest = queryOne('SELECT payable_date, paid_date FROM payment_requests WHERE id = ?', ['pr-backfill-date']);
  assert.equal(paidRequest.payable_date, '2026-10-29');
  assert.equal(paidRequest.paid_date, '2026-10-30', 'actual paid date must remain unchanged');
  assert.equal(queryOne('SELECT payable_date FROM payable_items WHERE id = ?', [cancelledItem.id]).payable_date, '');
  assert.equal(queryOne('SELECT payable_date FROM payment_requests WHERE id = ?', ['pr-cancelled-date']).payable_date, '');
});

test('PI edit route and PI deposit payment request route both use PI date', () => {
  const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const editStart = serverSource.indexOf("app.put('/api/proforma-invoices/:id'");
  const editEnd = serverSource.indexOf("app.post('/api/proforma-invoices/:id/attachment'", editStart);
  assert.ok(editStart >= 0 && editEnd > editStart);
  const editRoute = serverSource.slice(editStart, editEnd);
  assert.match(editRoute, /syncPiDepositPayableDate\(id, nextPiDate\)/);
  assert.match(editRoute, /PI日期必须为有效的 YYYY-MM-DD 日期/);

  const requestStart = serverSource.indexOf("app.post('/api/payment-requests/from-pi-deposit'");
  const requestEnd = serverSource.indexOf("app.post('/api/payment-requests/from-ci-balance'", requestStart);
  assert.ok(requestStart >= 0 && requestEnd > requestStart);
  const requestRoute = serverSource.slice(requestStart, requestEnd);
  assert.match(requestRoute, /payable_date/);
  assert.match(requestRoute, /pi\.pi_date/);
  assert.match(serverSource, /backfillPiDepositPayableDates\(\)/);
});

test('PostgreSQL PI batch-import fast path persists PI date on insert and active update', () => {
  const importer = fs.readFileSync(path.join(__dirname, '..', 'wave2b-pi-batch-import-pg.js'), 'utf8');
  assert.match(importer, /currency, pi_date FROM proforma_invoices/);
  assert.match(importer, /payable_date = v\.pi_date/);
  assert.match(importer, /j\.pi_date, j\.created_by/);
});
