'use strict';

const assert = require('assert');
const {
  coefficientVariation,
  allocationStability,
  evaluateCampaignMaturity,
  evaluateSignalConfidence,
} = require('../src/maturity-engine');

assert.strictEqual(coefficientVariation([5, 5, 5]), 0);

const stableItems = [];
for (let day = 1; day <= 8; day += 1) {
  const date = `2026-09-${String(day).padStart(2, '0')}`;
  stableItems.push({ date, item_id: 1, expense: 600, direct_order: 3 });
  stableItems.push({ date, item_id: 2, expense: 400, direct_order: 1 });
}
assert(allocationStability(stableItems).meanAbsDelta < 0.001);

const stableDaily = Array.from({ length: 8 }, (_, i) => ({
  date: `2026-09-${String(i + 1).padStart(2, '0')}`,
  clicks: i < 4 ? 100 : 130,
  direct_order: i < 4 ? 4 : 5,
  expense: i < 4 ? 100 : 130,
  direct_gmv: i < 4 ? 800 : 1000,
}));
const stable = evaluateCampaignMaturity({
  days: 8,
  directOrders: 32,
  dailyRows: stableDaily,
  itemDailyRows: stableItems,
});
assert.strictEqual(stable.status, 'STABLE');
assert.strictEqual(stable.evidence.sample, true);
assert.strictEqual(stable.evidence.allocation, true);

const learning = evaluateCampaignMaturity({
  days: 5,
  directOrders: 30,
  dailyRows: stableDaily.slice(0, 5),
  itemDailyRows: stableItems.filter(row => row.date <= '2026-09-05'),
});
assert.strictEqual(learning.status, 'LEARNING', 'order volume must not bypass minimum observation time');

const volatileItems = [];
for (let day = 1; day <= 14; day += 1) {
  const date = `2026-09-${String(day).padStart(2, '0')}`;
  const firstShare = day % 2 ? 0.9 : 0.1;
  volatileItems.push({ date, item_id: 1, expense: firstShare * 1000, direct_order: day % 2 ? 4 : 0 });
  volatileItems.push({ date, item_id: 2, expense: (1 - firstShare) * 1000, direct_order: day % 2 ? 0 : 4 });
}
const volatileDaily = Array.from({ length: 14 }, (_, i) => ({
  date: `2026-09-${String(i + 1).padStart(2, '0')}`,
  clicks: 100,
  direct_order: i % 2 ? 1 : 8,
  expense: 1000,
  direct_gmv: i % 2 ? 2000 : 12000,
}));
const unstable = evaluateCampaignMaturity({
  days: 14,
  directOrders: 56,
  dailyRows: volatileDaily,
  itemDailyRows: volatileItems,
});
assert.strictEqual(unstable.status, 'UNSTABLE');
assert.strictEqual(unstable.evidence.allocation, false);

const lowSample = evaluateCampaignMaturity({
  days: 10,
  directOrders: 3,
  dailyRows: [
    { date: '2026-09-01', clicks: 12, direct_order: 1, expense: 100, direct_gmv: 4600 },
    { date: '2026-09-02', clicks: 10, direct_order: 0, expense: 100, direct_gmv: 0 },
  ],
});
assert.strictEqual(lowSample.status, 'CONVERGING');
assert.notStrictEqual(lowSample.status, 'STABLE');

const signal = evaluateSignalConfidence({
  clicks: 12,
  direct_order: 1,
  expense: 100,
  direct_gmv: 4600,
}, { days: 1 });
assert(signal.signal.directRoas > 40);
assert.strictEqual(signal.confidence, 'LOW');

console.log('shopee maturity engine tests: ok');
