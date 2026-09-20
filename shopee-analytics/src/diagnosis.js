'use strict';

const {
  normalizePerformance,
  deriveItemShares,
  explorationCostMultiple,
  safeDiv,
} = require('./metrics');
const { itemAction, campaignActions } = require('./action-engine');
const { evaluateCampaignMaturity, evaluateSignalConfidence } = require('./maturity-engine');

const DEFAULTS = Object.freeze({
  weeklyVolumeReference: 25,
  zeroOrderRiskMultiple: 1.5,
  insufficientExplorationMultiple: 0.5,
  explorationSpendShareCeiling: 0.15,
  adSpendRatioLimit: 0.15,
});

function requiredRoasForSpendLimit(limit) {
  const n = Number(limit);
  return Number.isFinite(n) && n > 0 ? 1 / n : 0;
}

function recommendedRangeState(targetRoas, recommendedRoi) {
  const target = Number(targetRoas || 0);
  if (!target || !recommendedRoi) return 'UNKNOWN';
  const lower = Number(recommendedRoi.lower && recommendedRoi.lower.value);
  const upper = Number(recommendedRoi.upper && recommendedRoi.upper.value);
  if (Number.isFinite(lower) && lower > 0 && target < lower) return 'BELOW_RECOMMENDED_RANGE';
  if (Number.isFinite(upper) && upper > 0 && target > upper) return 'ABOVE_RECOMMENDED_RANGE';
  if ((Number.isFinite(lower) && lower > 0) || (Number.isFinite(upper) && upper > 0)) {
    return 'WITHIN_RECOMMENDED_RANGE';
  }
  return 'UNKNOWN';
}

function diagnoseCampaign({
  campaign,
  items = [],
  targetRoas,
  breakEvenRoas,
  recommendedRoi,
  campaignBudget,
  days = 7,
  settings = {},
  dailyRows = [],
  itemDailyRows = [],
}) {
  const cfg = { ...DEFAULTS, ...settings };
  const perf = normalizePerformance(campaign);
  const weeklyEquivalentOrders = days > 0 ? perf.broadOrders * 7 / days : 0;
  const avgDailySpend = days > 0 ? perf.expense / days : 0;
  const dailyBudget = Number(campaignBudget || 0);
  const budgetUtilization = dailyBudget > 0 ? avgDailySpend / dailyBudget : null;
  const adCostRatio = safeDiv(perf.expense, perf.broadGmv);
  const spendLimitRoas = requiredRoasForSpendLimit(cfg.adSpendRatioLimit);

  const spendLimitState = perf.broadGmv <= 0
    ? 'NO_ATTRIBUTED_GMV'
    : adCostRatio <= cfg.adSpendRatioLimit
      ? 'WITHIN_SPEND_LIMIT'
      : 'OVER_SPEND_LIMIT';

  const roasState = breakEvenRoas > 0 && perf.broadRoas < breakEvenRoas
    ? 'BELOW_BREAK_EVEN'
    : spendLimitState === 'OVER_SPEND_LIMIT'
      ? 'ABOVE_BREAK_EVEN_BUT_OVER_SPEND_LIMIT'
      : targetRoas > 0 && perf.broadRoas < targetRoas
        ? 'PROFITABLE_BUT_BELOW_TARGET'
        : targetRoas > 0
          ? 'TARGET_MET'
          : 'TARGET_UNKNOWN';

  const volumeState = weeklyEquivalentOrders >= cfg.weeklyVolumeReference
    ? 'VOLUME_REFERENCE_MET'
    : 'LOW_VOLUME_SIGNAL';

  const maturity = evaluateCampaignMaturity({
    days,
    directOrders: perf.directOrders,
    dailyRows,
    itemDailyRows,
    settings,
  });
  const itemResults = items.map(row => diagnoseItem({
    item: row,
    groupPerformance: perf,
    targetRoas,
    config: cfg,
    days,
  }));

  const campaignResult = {
    ...perf,
    days,
    weeklyEquivalentOrders,
    volumeState,
    roasState,
    avgDailySpend,
    dailyBudget,
    budgetUtilization,
    adCostRatio,
    adSpendRatioLimit: cfg.adSpendRatioLimit,
    spendLimitRoas,
    spendLimitState,
    targetRoas: Number(targetRoas || 0),
    breakEvenRoas: Number(breakEvenRoas || 0),
    targetVsRecommended: recommendedRangeState(targetRoas, recommendedRoi),
    recommendedRoi: recommendedRoi || null,
    maturity,
    maturityStatus: maturity.status,
    confidence: maturity.confidence,
  };

  const efficient = campaignResult.roasState === 'TARGET_MET' &&
    campaignResult.spendLimitState === 'WITHIN_SPEND_LIMIT';
  const lowVolume = campaignResult.volumeState === 'LOW_VOLUME_SIGNAL';
  const itemsWithActions = itemResults.map(item => ({
    ...item,
    action: itemAction(item.state, { lowVolumeAndEfficient: lowVolume && efficient }),
  }));

  return {
    sequence: ['DIRECT_ORDERS', 'ROAS', 'PROFITABILITY', 'SKU_SPEND_ALLOCATION', 'SKU_DIRECT_ORDERS', 'SKU_DIRECT_ROAS', 'CTR', 'CVR', 'GMV_PER_ORDER', 'MULTI_DAY_CONTINUITY', 'SIGNAL_CONFIDENCE', 'ACTION'],
    campaign: campaignResult,
    actions: campaignActions({ campaign: campaignResult, items: itemsWithActions }),
    items: itemsWithActions,
    notes: [
      'weeklyVolumeReference is an internal maturity/reference signal, not an official Shopee learning-complete rule.',
      'Item competitiveness should prefer direct metrics when evaluating the promoted item itself.',
      'Event-day performance should be separated from ordinary-day baseline before making persistent changes.',
      'The ad-spend-ratio limit is a business constraint, not a Shopee platform rule.',
      'Stable status requires converging evidence across sample, allocation, CVR, ROAS, order-source continuity and scale resilience; elapsed days alone never imply stability.',
      'A/B/C traffic is an internal analytical model; highest spend alone does not imply an A-pool SKU.',
    ],
  };
}

function diagnoseItem({ item, groupPerformance, targetRoas, config = DEFAULTS, days = 7 }) {
  const p = normalizePerformance(item);
  const shares = deriveItemShares(item, groupPerformance);
  const directAov = p.directOrders > 0 ? safeDiv(p.directGmv, p.directOrders) : 0;
  const broadAov = p.broadOrders > 0 ? safeDiv(p.broadGmv, p.broadOrders) : 0;
  const aovForCpa = directAov || broadAov;
  const explorationMultiple = explorationCostMultiple({
    spend: p.expense,
    aov: aovForCpa,
    targetRoas,
  });
  const itemBreakEvenRoas = Number(item.breakEvenRoas ?? item.break_even_roas ?? 0) || 0;
  const spendLimitRoas = requiredRoasForSpendLimit(config.adSpendRatioLimit);
  const viabilityRoas = Math.max(itemBreakEvenRoas, spendLimitRoas);

  let state = 'OBSERVE';
  if (p.directOrders === 0 && p.broadOrders === 0) {
    if (aovForCpa === 0) state = 'NO_ORDER_NEEDS_AOV_CONTEXT';
    else if (explorationMultiple < config.insufficientExplorationMultiple) state = 'INSUFFICIENT_EXPLORATION';
    else if (explorationMultiple >= config.zeroOrderRiskMultiple) state = 'HIGH_RISK_ZERO_ORDER';
    else state = 'ZERO_ORDER_STILL_TESTING';
  } else if (p.directOrders > 0 && p.directRoas >= viabilityRoas && shares.directGmvShare >= shares.spendShare) {
    state = 'CORE_CANDIDATE';
  } else if (p.directOrders > 0 && shares.spendShare <= config.explorationSpendShareCeiling) {
    state = 'EXPLORATION_KEEP';
  } else if (p.directOrders > 0 && viabilityRoas > 0 && p.directRoas < viabilityRoas) {
    state = 'PRODUCT_OPTIMIZATION_CANDIDATE';
  }

  const signalConfidence = evaluateSignalConfidence(item, { days, matureOrdersReference: config.weeklyVolumeReference });

  return {
    itemId: item.item_id ?? item.itemId ?? null,
    ...p,
    ...shares,
    directAov,
    broadAov,
    itemBreakEvenRoas,
    spendLimitRoas,
    viabilityRoas,
    explorationCostMultiple: explorationMultiple,
    signalConfidence,
    state,
  };
}

function splitEventBaseline(rows = [], eventDateSet = new Set()) {
  const eventRows = [];
  const ordinaryRows = [];
  for (const row of rows) {
    const key = String(row.date || row.event_date || '').slice(0, 10);
    (eventDateSet.has(key) ? eventRows : ordinaryRows).push(row);
  }
  return { eventRows, ordinaryRows };
}

module.exports = {
  DEFAULTS,
  requiredRoasForSpendLimit,
  recommendedRangeState,
  diagnoseCampaign,
  diagnoseItem,
  splitEventBaseline,
};
