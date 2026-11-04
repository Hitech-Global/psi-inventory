'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const start = source.indexOf('async function invBatchExport(ids){');
const end = source.indexOf('\n}\n', start);
assert.ok(start >= 0 && end > start, 'inventory export function should exist');
const exportFn = source.slice(start, end + 2);

test('inventory export uses the updated on-hand, transit and PI amount columns', () => {
  for (const key of [
    "inv.col.in_stock_qty",
    "inv.col.in_transit_qty",
    "inv.col.in_transit_amount",
    "inv.col.pi_unshipped_qty",
    "inv.col.pi_unshipped_amount",
    "inv.col.on_hand_amount_local",
    "inv.col.on_hand_amount_rmb"
  ]) assert.ok(exportFn.includes(key), `missing export column ${key}`);

  assert.match(exportFn, /d\.in_transit_amount_cny/);
  assert.match(exportFn, /d\.pi_unshipped_amount_cny/);
  assert.match(exportFn, /d\.available_qty/);
  assert.doesNotMatch(exportFn, /safety_stock|po_unconfirmed_pi_qty|html\.inv_export\.available/);
});

test('inventory export waits for asynchronous financial values before exporting', () => {
  assert.match(source, /window\._invFinancialLoadPromise = loadInvFinancialValues/);
  assert.match(exportFn, /await window\._invFinancialLoadPromise/);
  assert.match(source, /await invBatchExport\(ids\)/);
});
