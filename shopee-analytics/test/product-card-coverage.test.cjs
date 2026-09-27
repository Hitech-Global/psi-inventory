'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { dateCoverage, reconcileRows } = require('../src/product-ads-v2-router');

assert.deepStrictEqual(
  dateCoverage('2026-09-22', '2026-09-25', [
    { eventDate: '2026-09-22' },
    { eventDate: '2026-09-24' },
    { eventDate: '2026-09-25' },
  ]),
  {
    expectedDays: 4,
    availableDays: 3,
    missingDays: 1,
    missingDates: ['2026-09-23'],
    complete: false,
  },
);

assert.deepStrictEqual(
  dateCoverage('2026-09-25', '2026-09-25', [{ event_date: '2026-09-25T00:00:00.000Z' }]),
  { expectedDays: 1, availableDays: 1, missingDays: 0, missingDates: [], complete: true },
);

const rawRows = [{
  eventDate: '2026-09-25', impressions: 100, clicks: 2, ctr: 0.02,
  directOrders: 1, broadOrders: 1, directUnits: 1, broadUnits: 1,
  directCvr: 0.5, broadCvr: 0.5, directGmv: 10.5, broadGmv: 10.5,
  expense: 2.1, cpc: null, costPerConversion: 2.1, costPerDirectConversion: null,
  directRoas: 5, broadRoas: 5, directAcos: null, broadAcos: null,
}];
const dbRows = [{ ...rawRows[0] }];
assert.deepStrictEqual(
  reconcileRows(rawRows, dbRows, '2026-09-25', '2026-09-25'),
  { rawDays: 1, dbDays: 1, mismatchCount: 0, match: true, mismatches: [] },
);

const badDbRows = [{ ...rawRows[0], expense: 2.2 }];
const mismatch = reconcileRows(rawRows, badDbRows, '2026-09-25', '2026-09-25');
assert.strictEqual(mismatch.match, false);
assert.strictEqual(mismatch.mismatchCount, 1);
assert.deepStrictEqual(mismatch.mismatches[0], { date: '2026-09-25', field: 'expense', raw: 2.1, db: 2.2 });

const ui = fs.readFileSync(path.join(__dirname, '..', 'web', 'product-card-coverage-v4.js'), 'utf8');
assert(ui.includes('不能当作完整周期总盘'), 'partial Product Card coverage must warn the operator');
assert(ui.includes('不会使用单品广告、全店推或广告组数据替代总览'), 'missing Product Card API data must not be substituted');

console.log('Product Card coverage and reconciliation tests: ok');
