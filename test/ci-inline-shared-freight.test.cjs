'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { sharedFreightDisplayForBatch } = require('../ci-list-inline-logistics');

test('expanded CI list displays the same RMB shared-fee allocation as CI detail', () => {
  const summary = {
    ci_currency: 'RMB',
    batch_totals_rmb: {
      batch_15359: { batch_no: 'SZIS0015359', total_minor: 177510, errors: [] },
      batch_15360: { batch_no: 'SZIS0015360', total_minor: 969314, errors: [] },
      batch_15358: { batch_no: 'SZIS0015358', total_minor: 1064486, errors: [] }
    }
  };
  const batches = [
    { id: 'batch_15359', cargo_value: 6918.80 },
    { id: 'batch_15360', cargo_value: 194668.80 },
    { id: 'batch_15358', cargo_value: 77929.60 }
  ];
  const rows = batches.map(batch => sharedFreightDisplayForBatch(batch, summary));

  assert.deepEqual(rows.map(row => row.amount), [1775.10, 9693.14, 10644.86]);
  assert.deepEqual(rows.map(row => Number(row.ratio.toFixed(2))), [25.66, 4.98, 13.66]);
  assert.equal(rows.reduce((sum, row) => sum + row.amount, 0), 22113.10);
  assert.ok(rows.every(row => row.currency === 'RMB' && row.status === 'ok'));
});

test('shared freight ratio is not calculated for non-RMB CI goods values', () => {
  const result = sharedFreightDisplayForBatch(
    { id: 'batch_idr', cargo_value: 900000, ci_currency: 'IDR' },
    { ci_currency: 'IDR', batch_totals_rmb: { batch_idr: { total_minor: 33120, errors: [] } } }
  );
  assert.equal(result.amount, 331.20);
  assert.equal(result.currency, 'RMB');
  assert.equal(result.ratio, null);
});

test('missing FX evidence is shown as pending instead of being displayed as zero', () => {
  const result = sharedFreightDisplayForBatch(
    { id: 'batch_pending', cargo_value: 1000 },
    { ci_currency: 'RMB', batch_totals_rmb: { batch_pending: { total_minor: null, errors: ['missing payment FX'] } } }
  );
  assert.equal(result.status, 'pending_fx');
  assert.equal(result.amount, null);
  assert.match(result.error, /missing payment FX/);
});

test('expanded logistics rows hydrate shared allocations by batch ID on every open and refresh', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'ci-list-inline-logistics.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(source, /data-ci-logi-freight="1"/);
  assert.match(source, /data-ci-logi-freight-ratio="1"/);
  assert.match(source, /\/shared-logistics-fees\?view=ci-summary/);
  assert.match(source, /batch_totals_rmb/);
  assert.match(source, /hydrateSharedFreight\(ciId, cached\.data \|\| \[\], token\)/);
  assert.match(source, /hydrateSharedFreight\(ciId, data \|\| \[\], token\)/);
  assert.match(source, /hydrateSharedFreight\(ciId, rows \|\| \[\], state\.reqSeq\)/);
  assert.match(source, /Number\(item\.total_minor\) \/ 100/);
  assert.match(html, /ci-list-inline-logistics\.js\?v=20261113-2/);
});
