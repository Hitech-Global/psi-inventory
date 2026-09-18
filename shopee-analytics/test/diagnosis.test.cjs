'use strict';

const assert = require('assert');
const { diagnoseCampaign, splitEventBaseline } = require('../src/diagnosis');
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

assert.strictEqual(result.sequence[0], 'ORDERS');
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
