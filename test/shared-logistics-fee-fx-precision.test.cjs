'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.DB_DRIVER = 'sqlite';
process.env.DB_PATH = ':memory:';

const db = require('../db');
const { settledConversion } = require('../shared-logistics-fee-server');

test('PAYMENT-FX-PRECISION-01: PostgreSQL schema and boot migration preserve 12 decimal places', () => {
  const pgSchema = fs.readFileSync(path.join(__dirname, '..', 'db-pg.js'), 'utf8');
  const productionMigration = fs.readFileSync(path.join(__dirname, '..', 'db.js'), 'utf8');

  assert.match(pgSchema, /local_rate NUMERIC\(24,12\) DEFAULT 0/);
  assert.match(pgSchema, /rmb_rate NUMERIC\(24,12\) DEFAULT 0/);
  assert.match(pgSchema, /PAYMENT-FX-PRECISION-01/);
  assert.match(productionMigration, /PAYMENT-FX-PRECISION-01/);
  assert.match(productionMigration, /ALTER COLUMN local_rate TYPE NUMERIC\(24,12\)/);
  assert.match(productionMigration, /ALTER COLUMN rmb_rate TYPE NUMERIC\(24,12\)/);
});

test('large IDR payment: truncated 8-decimal snapshot blocks; exact 12-decimal snapshot converts to RMB', () => {
  db.initDatabase();

  const requestId = 'pay_fx_precision_regression';
  const settlementId = 'settle_fx_precision_regression';
  const amountIdr = 14382235;
  const exactRate = 0.000366504475;
  const expectedRmb = 5271.15;

  db.run(
    `INSERT INTO payment_requests
      (id, request_no, currency, payment_status, approval_status)
     VALUES (?, ?, ?, ?, ?)`,
    [requestId, 'PAY-FX-PRECISION-REGRESSION', 'IDR', 'paid', 'approved']
  );

  db.run(
    `INSERT INTO payment_settlement_logs
      (id, payment_request_id, event_type, status, amount, paid_date,
       original_currency, local_currency, local_rate, local_rate_date, local_amount,
       rmb_rate, rmb_rate_date, rmb_amount)
     VALUES (?, ?, 'payment', 'applied', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [settlementId, requestId, amountIdr, '2026-11-16',
      'IDR', 'IDR', 1, '2026-11-16', amountIdr,
      0.00036650, '2026-11-16', expectedRmb]
  );

  const amountMinor = amountIdr * 100;
  const truncated = settledConversion(requestId, amountMinor, 'IDR', 'RMB', true);
  assert.equal(truncated.error, '付款RMB金额与锁定汇率快照不一致');

  // The payment transaction retains the original full-precision rate. The
  // corrected settlement snapshot must match that immutable source value.
  db.run('UPDATE payment_settlement_logs SET rmb_rate = ? WHERE id = ?', [exactRate, settlementId]);

  const corrected = settledConversion(requestId, amountMinor, 'IDR', 'RMB', true);
  assert.equal(corrected.error, undefined);
  assert.equal(corrected.amount_minor, 527115);
  assert.equal(corrected.fx.length, 1);
  assert.equal(corrected.fx[0].rate, exactRate);
  assert.equal(corrected.fx[0].rmb_amount, expectedRmb);
});
