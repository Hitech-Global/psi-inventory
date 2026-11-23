'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { deletePriceSystemSchemeRecords } = require('../price-system-api');

test('permanently deletes all records owned by a pricing scheme', () => {
  const calls = [];
  const result = deletePriceSystemSchemeRecords('scheme-123', (sql, params) => calls.push({ sql, params }));
  assert.equal(result, true);
  assert.deepEqual(calls.map(call => call.sql), [
    'DELETE FROM price_system_fields WHERE scheme_id = ?',
    'DELETE FROM price_system_values WHERE scheme_id = ?',
    'DELETE FROM price_system_landing_costs WHERE scheme_id = ?',
    'DELETE FROM price_system_srp_values WHERE scheme_id = ?',
    'DELETE FROM price_system_versions WHERE scheme_id = ?',
    'DELETE FROM price_system_schemes WHERE id = ?'
  ]);
  assert.ok(calls.every(call => call.params.length === 1 && call.params[0] === 'scheme-123'));
  assert.ok(calls.every(call => !/wac_history/i.test(call.sql)));
});

test('rejects an empty scheme ID without issuing delete statements', () => {
  const calls = [];
  assert.throws(() => deletePriceSystemSchemeRecords('  ', (sql, params) => calls.push({ sql, params })), /价格方案 ID/);
  assert.equal(calls.length, 0);
});
