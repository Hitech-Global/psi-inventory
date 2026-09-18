'use strict';

const assert = require('assert');
const {
  eventMixForRange,
  comparisonContext,
} = require('../src/http-router');

const mix = eventMixForRange('2026-09-01', '2026-09-30');
assert.strictEqual(mix.doubleDayCount, 1);
assert.strictEqual(mix.payday25Count, 1);
assert(mix.dates.includes('2026-09-09'));
assert(mix.dates.includes('2026-09-25'));

const mismatch = comparisonContext(
  '2026-09-10',
  '2026-09-16',
  '2026-09-03',
  '2026-09-09',
);
assert.strictEqual(mismatch.eventMixMismatch, true);
assert(mismatch.warning && mismatch.warning.includes('大促日构成不同'));

const same = comparisonContext(
  '2026-09-11',
  '2026-09-17',
  '2026-09-03',
  '2026-09-09',
);
assert.strictEqual(same.currentEventMix.totalEventDays, 0);
assert.strictEqual(same.previousEventMix.doubleDayCount, 1);
assert.strictEqual(same.eventMixMismatch, true);

console.log('shopee router comparison helper tests: ok');
