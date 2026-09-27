'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { dateCoverage } = require('../src/product-ads-v2-router');

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

const ui = fs.readFileSync(path.join(__dirname, '..', 'web', 'product-card-coverage-v4.js'), 'utf8');
assert(ui.includes('不能当作完整周期总盘'), 'partial Product Card coverage must warn the operator');
assert(ui.includes('不会使用单品广告、全店推或广告组数据替代总览'), 'missing Product Card API data must not be substituted');

console.log('Product Card coverage guard tests: ok');
