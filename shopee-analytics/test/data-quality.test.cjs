'use strict';

const assert = require('assert');
const {
  evaluateItemCoverage,
  freshnessState,
  buildSystemWarnings,
} = require('../src/data-quality');

const good = evaluateItemCoverage({
  campaignExpense: 100,
  itemExpense: 99,
  membershipCount: 4,
  performanceItemCount: 4,
});
assert.strictEqual(good.warnings.length, 0);
assert(Math.abs(good.spendCoverage - 0.99) < 1e-12);

const gap = evaluateItemCoverage({
  campaignExpense: 100,
  itemExpense: 75,
  membershipCount: 4,
  performanceItemCount: 3,
});
assert(gap.warnings.some(x => x.code === 'ITEM_SPEND_COVERAGE_GAP'));
assert(gap.warnings.some(x => x.code === 'MEMBERSHIP_PERFORMANCE_GAP'));

const now = new Date('2026-09-18T08:00:00Z');
assert.strictEqual(
  freshnessState('2026-09-18T06:00:00Z', { now }).state,
  'FRESH',
);
assert.strictEqual(
  freshnessState('2026-09-16T00:00:00Z', { now }).state,
  'STALE',
);

const warnings = buildSystemWarnings({
  sources: [
    { source: 'GMS', lastSyncedAt: '2026-09-16T00:00:00Z' },
    { source: 'ORDERS', lastSyncedAt: null },
  ],
  tokens: [
    { appRole: 'ADS', expiresAt: '2026-09-18T08:30:00Z', refreshError: null },
    { appRole: 'ERP', expiresAt: '2026-09-19T08:00:00Z', refreshError: 'test failure' },
  ],
}, now);
assert(warnings.some(x => x.code === 'SOURCE_STALE'));
assert(warnings.some(x => x.code === 'SOURCE_NEVER_SYNCED'));
assert(warnings.some(x => x.code === 'TOKEN_EXPIRING_SOON'));
assert(warnings.some(x => x.code === 'TOKEN_REFRESH_ERROR'));

console.log('shopee data quality tests: ok');
