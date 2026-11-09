'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
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
