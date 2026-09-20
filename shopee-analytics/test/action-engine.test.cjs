'use strict';

const assert = require('assert');
const { itemAction, campaignActions, structuralActionGates } = require('../src/action-engine');

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
assert(lowVolumeEfficient.recommendations.some(x => x.code === 'THREE_DAY_CORE_VOUCHER'));
assert(!lowVolumeEfficient.recommendations.some(x => x.code === 'PROTECT_PROFIT'));

const overSpend = campaignActions({
  campaign: {
    roasState: 'ABOVE_BREAK_EVEN_BUT_OVER_SPEND_LIMIT',
    spendLimitState: 'OVER_SPEND_LIMIT',
    volumeState: 'LOW_VOLUME_SIGNAL',
  },
  items: [{ state: 'HIGH_RISK_ZERO_ORDER' }],
});
assert.strictEqual(overSpend.recommendations[0].code, 'PROTECT_PROFIT');
assert(overSpend.recommendations.some(x => x.code === 'CONCENTRATE_BUDGET'));

console.log('shopee action engine tests: ok');

const protectedCore = itemAction('CORE_CANDIDATE', {
  maturityStatus: 'CONVERGING',
  confidence: 'LOW',
  scaleEligible: false,
});
assert.strictEqual(protectedCore.code, 'PROTECT_CORE_SIGNAL');

const scalableCore = itemAction('CORE_CANDIDATE', {
  maturityStatus: 'STABLE',
  confidence: 'HIGH',
  scaleEligible: true,
});
assert.strictEqual(scalableCore.code, 'CONTROLLED_SINGLE_ITEM_SCALE');

const learningGates = structuralActionGates({
  campaign: { maturityStatus: 'LEARNING', roasState: 'TARGET_MET', spendLimitState: 'WITHIN_SPEND_LIMIT', budgetUtilization: 1 },
  items: [{ state: 'HIGH_RISK_ZERO_ORDER', scaleEligibility: { eligible: false } }],
});
assert.strictEqual(learningGates.REMOVE_SKU.allowed, false);
assert.strictEqual(learningGates.INCREASE_BUDGET.allowed, false);

const stableScaleGates = structuralActionGates({
  campaign: { maturityStatus: 'STABLE', roasState: 'TARGET_MET', spendLimitState: 'WITHIN_SPEND_LIMIT', budgetUtilization: 0.95 },
  items: [{ state: 'CORE_CANDIDATE', scaleEligibility: { eligible: true } }],
});
assert.strictEqual(stableScaleGates.SPLIT_SINGLE_ITEM.allowed, true);
assert.strictEqual(stableScaleGates.INCREASE_BUDGET.allowed, true);
assert.strictEqual(stableScaleGates.LOWER_TARGET_ROAS.allowed, false);

const underSpendGates = structuralActionGates({
  campaign: { maturityStatus: 'STABLE', roasState: 'TARGET_MET', spendLimitState: 'WITHIN_SPEND_LIMIT', budgetUtilization: 0.55 },
  items: [{ state: 'CORE_CANDIDATE', scaleEligibility: { eligible: true } }],
});
assert.strictEqual(underSpendGates.LOWER_TARGET_ROAS.allowed, true);
assert.strictEqual(underSpendGates.INCREASE_BUDGET.allowed, false);
