'use strict';

const assert = require('assert');
const { diagnoseCampaign, splitEventBaseline, requiredRoasForSpendLimit } = require('../src/diagnosis');
const { targetCpa } = require('../src/metrics');

assert.strictEqual(targetCpa({ aov: 800000, targetRoas: 5 }), 160000);

const result = diagnoseCampaign({
  campaign: {
    impression: 10000,
    clicks: 250,
    expense: 500000,
    broad_gmv: 3500000,
    broad_order: 20,
    direct_gmv: 3000000,
    direct_order: 18,
  },
  items: [
    { item_id: 1, expense: 300000, direct_gmv: 2400000, direct_order: 14, broad_gmv: 2600000, broad_order: 15 },
    { item_id: 2, expense: 50000, direct_gmv: 200000, direct_order: 2, broad_gmv: 300000, broad_order: 3 },
  ],
  targetRoas: 7,
  breakEvenRoas: 4,
  days: 7,
});

assert.strictEqual(result.sequence[0], 'DIRECT_ORDERS');
assert.strictEqual(result.campaign.maturityStatus, 'CONVERGING');
assert(result.sequence.includes('SIGNAL_CONFIDENCE'));
assert.strictEqual(result.items[0].signalConfidence.confidence, 'MEDIUM');
assert.strictEqual(result.campaign.volumeState, 'LOW_VOLUME_SIGNAL');
assert.strictEqual(result.campaign.roasState, 'TARGET_MET');
assert.strictEqual(result.items[0].state, 'CORE_CANDIDATE');
assert.strictEqual(result.items[1].state, 'EXPLORATION_KEEP');

const split = splitEventBaseline([
  { date: '2026-09-09', orders: 8 },
  { date: '2026-09-10', orders: 1 },
], new Set(['2026-09-09']));
assert.strictEqual(split.eventRows.length, 1);
assert.strictEqual(split.ordinaryRows.length, 1);

console.log('shopee diagnosis tests: ok');

assert(Math.abs(requiredRoasForSpendLimit(0.15) - 6.6666666667) < 1e-6);

const historicalGroup = diagnoseCampaign({
  campaign: {
    impression: 85664,
    clicks: 1652,
    expense: 2836734,
    broad_gmv: 16936390,
    broad_order: 21,
  },
  items: [],
  targetRoas: 8.3,
  breakEvenRoas: 3.5,
  recommendedRoi: {
    lower: { value: 5.1, percentile: 80 },
    exact: { value: 7.2, percentile: 50 },
    upper: { value: 8.7, percentile: 20 },
  },
  days: 13,
});
assert.strictEqual(historicalGroup.campaign.volumeState, 'LOW_VOLUME_SIGNAL');
assert.strictEqual(historicalGroup.campaign.spendLimitState, 'OVER_SPEND_LIMIT');
assert.strictEqual(historicalGroup.campaign.roasState, 'ABOVE_BREAK_EVEN_BUT_OVER_SPEND_LIMIT');
assert.strictEqual(historicalGroup.campaign.targetVsRecommended, 'WITHIN_RECOMMENDED_RANGE');
