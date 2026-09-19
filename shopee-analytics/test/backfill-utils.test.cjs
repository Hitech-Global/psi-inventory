'use strict';

const assert = require('assert');
const {
  daysInclusive,
  chunkDateRange,
  zonedMidnightEpoch,
  localDateRangeEpoch,
  parseSources,
  completedThrough,
} = require('../src/backfill-utils');

assert.strictEqual(daysInclusive('2026-09-01', '2026-09-07'), 7);
assert.deepStrictEqual(
  chunkDateRange('2026-09-01', '2026-09-16', 7),
  [
    { startDate: '2026-09-01', endDate: '2026-09-07' },
    { startDate: '2026-09-08', endDate: '2026-09-14' },
    { startDate: '2026-09-15', endDate: '2026-09-16' },
  ],
);

assert.strictEqual(
  zonedMidnightEpoch('2026-09-18', 'Asia/Jakarta'),
  Math.floor(new Date('2026-09-17T17:00:00Z').getTime() / 1000),
);

const th = localDateRangeEpoch('2026-09-18', '2026-09-18', 'Asia/Bangkok');
assert.strictEqual(th.timeTo - th.timeFrom, 86399);

assert.deepStrictEqual(parseSources('gms,orders,gms'), ['gms', 'orders']);
assert(parseSources('').includes('shop-bi'));
assert.throws(() => parseSources('bad-source'), /Unsupported/);

assert.strictEqual(
  completedThrough({
    cursor: {
      requestedStartDate: '2026-09-01',
      requestedEndDate: '2026-09-30',
      completedThrough: '2026-09-14',
    },
  }, '2026-09-01', '2026-09-30'),
  '2026-09-14',
);
assert.strictEqual(
  completedThrough({
    cursor: {
      requestedStartDate: '2026-08-01',
      requestedEndDate: '2026-08-31',
      completedThrough: '2026-08-14',
    },
  }, '2026-09-01', '2026-09-30'),
  null,
);

console.log('shopee backfill utility tests: ok');
