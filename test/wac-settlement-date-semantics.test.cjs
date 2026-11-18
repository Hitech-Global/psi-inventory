'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { MARKER, patchWacSettlementDateSource } = require('../scripts/wac-settlement-date-audit-hotfix.cjs');

test('keeps WAC settlement audit date separate from actual inbound date', () => {
  const source = [
    'generateWacVersion({ settlement_date: inboundDate || today, confirmed_by: user });',
    'generateWacVersion({ settlement_date: inboundDate || today, logistics_batch_id: batch.id, last_inbound_date: inboundDate, fx_rate_date: fxSnapshot.rate_date });'
  ].join('\n');
  const patched = patchWacSettlementDateSource(source);
  assert.equal((patched.match(/settlement_date: today,/g) || []).length, 2);
  assert.equal((patched.match(/settlement_date: inboundDate/g) || []).length, 0);
  assert.match(patched, /last_inbound_date: inboundDate/);
  assert.match(patched, /fx_rate_date: fxSnapshot\.rate_date/);
  assert.match(patched, new RegExp(MARKER));
  assert.equal(patchWacSettlementDateSource(patched), patched);
});

test('fails closed if the source assignments drift', () => {
  assert.throws(
    () => patchWacSettlementDateSource('settlement_date: inboundDate || today;'),
    /expected exactly 2/
  );
});


test('WAC uses actual arrival date for cost effective date and actual payment dates for FX', () => {
  const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const calculatorSource = fs.readFileSync(path.join(__dirname, '..', 'wac-calculator.js'), 'utf8');
  assert.ok(serverSource.includes("const inboundDate = normalizeWacHistoryDate(batch.actual_arrival_date) || '';"));
  assert.ok(serverSource.includes("const paymentFxDate = normalizeWacHistoryDate(meta.rmb_to_local_rate_date || meta.freight_last_paid_date) || '';"));
  assert.ok(serverSource.includes('last_inbound_date: inboundDate'));
  assert.ok(serverSource.includes('fx_rate_date: fxSnapshot ? fxSnapshot.rate_date : paymentFxDate'));
  assert.ok(!serverSource.includes('meta.freight_last_paid_date || inboundDate'));
  assert.ok(serverSource.includes("const fxDate = normalizeWacHistoryDate(r.fx_rate_date) || '';"));
  assert.ok(serverSource.includes("const fxDate = hasFxDate ? normalizeWacHistoryDate(fxDateRaw) : '';"));
  assert.ok(calculatorSource.includes("code: 'DUTY_PAYMENT_DATE_MISSING'"));
  assert.ok(!calculatorSource.includes('resolveExactFxRate(dutyCurrency, localCurrency, arrivalDate'));
});
