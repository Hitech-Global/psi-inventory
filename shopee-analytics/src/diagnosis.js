'use strict';

const {
  normalizePerformance,
  deriveItemShares,
  explorationCostMultiple,
  safeDiv,
} = require('./metrics');

const DEFAULTS = Object.freeze({
  weeklyVolumeReference: 25,
  zeroOrderRiskMultiple: 1.5,
  insufficientExplorationMultiple: 0.5,
  explorationSpendShareCeiling: 0.15,
});

function diagnoseCampaign({
  campaign,
  items = [],
  targetRoas,
  breakEvenRoas,
  days = 7,
  settings = {},
}) {
  const cfg = { ...DEFAULTS, ...settings };
  const perf = normalizePerformance(campaign);
  const weeklyEquivalentOrders = days > 0 ? perf.broadOrders * 7 / days : 0;

  const roasState = breakEvenRoas > 0 && perf.broadRoas < breakEvenRoas
    ? 'BELOW_BREAK_EVEN'
    : targetRoas > 0 && perf.broadRoas < targetRoas
      ? 'PROFITABLE_BUT_BELOW_TARGET'
      : targetRoas > 0
        ? 'TARGET_MET'
        : 'TARGET_UNKNOWN';

  const volumeState = weeklyEquivalentOrders >= cfg.weeklyVolumeReference
    ? 'VOLUME_REFERENCE_MET'
    : 'LOW_VOLUME_SIGNAL';

  const itemResults = items.map(row => diagnoseItem({
    item: row,
    groupPerformance: perf,
    targetRoas,
    config: cfg,
  }));

  return {
    sequence: ['ORDERS', 'ROAS', 'FUNNEL', 'ITEM_STRUCTURE', 'ACTION'],
    campaign: {
      ...perf,
      days,
      weeklyEquivalentOrders,
      volumeState,
      roasState,
      targetRoas: Number(targetRoas || 0),
      breakEvenRoas: Number(breakEvenRoas || 0),
    },
    items: itemResults,
    notes: [
      'weeklyVolumeReference is an internal maturity/reference signal, not an official Shopee learning-complete rule.',
      'Item competitiveness should prefer direct metrics when evaluating the promoted item itself.',
      'Event-day performance should be separated from ordinary-day baseline before making persistent changes.',
    ],
  };
}

function diagnoseItem({ item, groupPerformance, targetRoas, config = DEFAULTS }) {
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

  let state = 'OBSERVE';
  if (p.directOrders === 0 && p.broadOrders === 0) {
    if (aovForCpa === 0) state = 'NO_ORDER_NEEDS_AOV_CONTEXT';
    else if (explorationMultiple < config.insufficientExplorationMultiple) state = 'INSUFFICIENT_EXPLORATION';
    else if (explorationMultiple >= config.zeroOrderRiskMultiple) state = 'HIGH_RISK_ZERO_ORDER';
    else state = 'ZERO_ORDER_STILL_TESTING';
  } else if (p.directOrders > 0 && targetRoas > 0 && p.directRoas >= targetRoas && shares.directGmvShare >= shares.spendShare) {
    state = 'CORE_CANDIDATE';
  } else if (p.directOrders > 0 && shares.spendShare <= config.explorationSpendShareCeiling) {
    state = 'EXPLORATION_KEEP';
  } else if (p.directOrders > 0 && targetRoas > 0 && p.directRoas < targetRoas) {
    state = 'PRODUCT_OPTIMIZATION_CANDIDATE';
  }

  return {
    itemId: item.item_id ?? item.itemId ?? null,
    ...p,
    ...shares,
    directAov,
    broadAov,
    explorationCostMultiple: explorationMultiple,
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
  diagnoseCampaign,
  diagnoseItem,
  splitEventBaseline,
};
