'use strict';

const assert = require('assert');
const { itemAction, campaignActions, structuralActionGates, recentOperationGuard } = require('../src/action-engine');

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

const recentGuard = recentOperationGuard({
  asOfDate: '2026-09-20',
  cooldownDays: 3,
  operations: [{ operationType: 'CAMPAIGN_SETTING_CHANGE', effectiveFrom: '2026-09-19T10:00:00Z' }],
});
assert.strictEqual(recentGuard.blocked, true);
const cooledGates = structuralActionGates({
  campaign: { maturityStatus: 'STABLE', roasState: 'TARGET_MET', spendLimitState: 'WITHIN_SPEND_LIMIT', budgetUtilization: 0.95 },
  items: [{ state: 'CORE_CANDIDATE', scaleEligibility: { eligible: true } }],
  operationGuard: recentGuard,
});
assert.strictEqual(cooledGates.SPLIT_SINGLE_ITEM.allowed, false);
assert.strictEqual(cooledGates.INCREASE_BUDGET.allowed, false);
assert(cooledGates.INCREASE_BUDGET.reason.includes('CAMPAIGN_SETTING_CHANGE'));

const expiredGuard = recentOperationGuard({
  asOfDate: '2026-09-20',
  cooldownDays: 3,
  operations: [{ operationType: 'SKU_ADDED_TO_CAMPAIGN', effectiveFrom: '2026-09-15T10:00:00Z' }],
});
assert.strictEqual(expiredGuard.blocked, false);
