'use strict';

const assert = require('assert');
const { itemAction, campaignActions } = require('../src/action-engine');

const item = itemAction('PRODUCT_OPTIMIZATION_CANDIDATE');
assert.strictEqual(item.code, 'PRODUCT_TEST_FIRST');
assert(item.action.includes('不建议'));

const lowVolumeEfficient = campaignActions({
  campaign: {
    roasState: 'TARGET_MET',
    spendLimitState: 'WITHIN_SPEND_LIMIT',
    volumeState: 'LOW_VOLUME_SIGNAL',
  },
  items: [
    { state: 'CORE_CANDIDATE' },
    { state: 'EXPLORATION_KEEP' },
  ],
});
assert(lowVolumeEfficient.some(x => x.code === 'THREE_DAY_CORE_VOUCHER'));
assert(!lowVolumeEfficient.some(x => x.code === 'PROTECT_PROFIT'));

const overSpend = campaignActions({
  campaign: {
    roasState: 'ABOVE_BREAK_EVEN_BUT_OVER_SPEND_LIMIT',
    spendLimitState: 'OVER_SPEND_LIMIT',
    volumeState: 'LOW_VOLUME_SIGNAL',
  },
  items: [{ state: 'HIGH_RISK_ZERO_ORDER' }],
});
assert.strictEqual(overSpend[0].code, 'PROTECT_PROFIT');
assert(overSpend.some(x => x.code === 'CONCENTRATE_BUDGET'));

console.log('shopee action engine tests: ok');
