'use strict';

const { safeDiv } = require('./metrics');
const { normalizeSourceAwarePerformance, sumSourceAwarePerformance } = require('./source-aware-metrics');
const { buildAnalysisTimeContext } = require('./analysis-time-context');

function rowDate(row) {
  const value = row.date ?? row.event_date ?? row.eventDate ?? '';
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10);
  const text = String(value).trim();
  const iso = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
}

function itemId(row) {
  return String(row.item_id ?? row.itemId ?? '');
}

function coefficientVariation(values) {
  const xs = values.map(Number).filter(Number.isFinite);
  if (xs.length < 2) return null;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  if (mean === 0) return null;
  const variance = xs.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / xs.length;
  return Math.sqrt(variance) / Math.abs(mean);
}

function performanceBetween(rows, startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  return sumSourceAwarePerformance((rows || []).filter(row => {
    const d = new Date(`${rowDate(row)}T00:00:00Z`);
    return Number.isFinite(d.getTime()) && d >= start && d <= end;
  }));
}

function rollingPerformance(rows, days, endDate) {
  const end = new Date(`${endDate}T00:00:00Z`);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - days + 1);
  return performanceBetween(rows, start.toISOString().slice(0, 10), endDate);
}

function previousRollingPerformance(rows, days, endDate) {
  const currentStart = new Date(`${endDate}T00:00:00Z`);
  currentStart.setUTCDate(currentStart.getUTCDate() - days + 1);
  const priorEnd = new Date(currentStart);
  priorEnd.setUTCDate(priorEnd.getUTCDate() - 1);
  const priorStart = new Date(priorEnd);
  priorStart.setUTCDate(priorStart.getUTCDate() - days + 1);
  return performanceBetween(rows, priorStart.toISOString().slice(0, 10), priorEnd.toISOString().slice(0, 10));
}

function observationDays(rows, days, endDate) {
  const end = new Date(`${endDate}T00:00:00Z`);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - days + 1);
  return new Set((rows || []).map(rowDate).filter(date => {
    if (!date) return false;
    const d = new Date(`${date}T00:00:00Z`);
    return Number.isFinite(d.getTime()) && d >= start && d <= end;
  })).size;
}

const COMPARISON_METRICS = [
  'impressions', 'clicks', 'ctr', 'addToCart', 'addToCartRate',
  'expense', 'cpc', 'costPerConversion', 'costPerDirectConversion',
  'directOrders', 'directCvr', 'directGmv', 'directRoas', 'directAcos',
  'broadOrders', 'broadCvr', 'broadGmv', 'broadRoas', 'broadAcos',
];

function relativeChange(current, previous) {
  const c = Number(current);
  const p = Number(previous);
  if (!Number.isFinite(c) || !Number.isFinite(p) || p === 0) return null;
  return (c - p) / Math.abs(p);
}

function performanceSnapshot(performance = {}) {
  return Object.fromEntries(COMPARISON_METRICS.map(key => [
    key,
    performance[key] === undefined ? null : performance[key],
  ]));
}

function comparePerformance(current = {}, previous = {}) {
  const changes = {};
  for (const key of COMPARISON_METRICS) {
    const c = current[key];
    const p = previous[key];
    changes[key] = {
      absolute: Number.isFinite(Number(c)) && Number.isFinite(Number(p)) ? Number(c) - Number(p) : null,
      relative: relativeChange(c, p),
    };
  }
  return {
    current: performanceSnapshot(current),
    previous: performanceSnapshot(previous),
    changes,
  };
}

function compareToThreshold(value, threshold) {
  const v = Number(value);
  const t = Number(threshold);
  if (!Number.isFinite(v) || !Number.isFinite(t) || t <= 0) return 'UNKNOWN';
  if (v > t) return 'ABOVE';
  if (v < t) return 'BELOW';
  return 'EQUAL';
}

function consecutiveOrderDays(rows, endDate) {
  const byDate = new Map();
  for (const row of rows || []) {
    const d = rowDate(row);
    if (!d) continue;
    const p = normalizeSourceAwarePerformance(row);
    byDate.set(d, (byDate.get(d) || 0) + p.directOrders);
  }
  let count = 0;
  const cursor = new Date(`${endDate}T00:00:00Z`);
  while (true) {
    const key = cursor.toISOString().slice(0, 10);
    if ((byDate.get(key) || 0) <= 0) break;
    count += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return count;
}

function buildDailyAllocation(itemDailyRows = []) {
  const grouped = new Map();
  for (const row of itemDailyRows) {
    const date = rowDate(row);
    if (!date) continue;
    if (!grouped.has(date)) grouped.set(date, []);
    grouped.get(date).push(row);
  }

  const output = [];
  for (const [date, rows] of [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const total = sumSourceAwarePerformance(rows);
    for (const row of rows) {
      const p = normalizeSourceAwarePerformance(row);
      output.push({
        date,
        itemId: itemId(row),
        impressionShare: safeDiv(p.impressions, total.impressions),
        clickShare: safeDiv(p.clicks, total.clicks),
        spendShare: safeDiv(p.expense, total.expense),
        directOrderShare: safeDiv(p.directOrders, total.directOrders),
        directGmvShare: p.directGmv === null || total.directGmv === null
          ? null
          : safeDiv(p.directGmv, total.directGmv),
      });
    }
  }
  return output;
}

function normalizeOperationActor(operation = {}) {
  const raw = String(operation.actorType ?? operation.actor ?? operation.sourceActor ?? '').trim().toUpperCase();
  if (['SELLER','OPERATOR','USER','MANUAL'].includes(raw)) return 'SELLER';
  if (['SHOPEE_SYSTEM','SYSTEM','PLATFORM','AUTO','AUTOMATION'].includes(raw)) return 'SHOPEE_SYSTEM';
  return 'UNKNOWN';
}

function changedOperationFields(operation = {}) {
  const before = operation.before || {};
  const after = operation.after || {};
  return ['status','biddingMethod','campaignBudget','targetRoas'].filter(key =>
    String(before[key] ?? null) !== String(after[key] ?? null));
}

function classifyLearningOperation(operation = {}) {
  const operationType = String(operation.operationType || operation.operation_type || '').toUpperCase();
  const actor = normalizeOperationActor(operation);
  const changedFields = changedOperationFields(operation);
  let eventType = operationType || 'UNKNOWN_OPERATION';
  let resetClass = 'CONTEXT_ONLY';

  if (operationType === 'CAMPAIGN_SETTING_CHANGE') {
    if (changedFields.includes('targetRoas')) eventType = 'TARGET_ROAS_CHANGE';
    else if (changedFields.includes('campaignBudget')) eventType = 'BUDGET_CHANGE';
    else if (changedFields.includes('status')) eventType = 'STATUS_CHANGE';
    else if (changedFields.includes('biddingMethod')) eventType = 'BIDDING_METHOD_CHANGE';

    if (eventType === 'TARGET_ROAS_CHANGE') {
      resetClass = actor === 'SELLER' ? 'CONFIRMED_RESET'
        : actor === 'SHOPEE_SYSTEM' ? 'SYSTEM_OPTIMIZATION'
          : 'RESET_CANDIDATE';
    } else if (['BUDGET_CHANGE','STATUS_CHANGE','BIDDING_METHOD_CHANGE'].includes(eventType)) {
      resetClass = actor === 'SHOPEE_SYSTEM' ? 'SYSTEM_OPTIMIZATION' : 'LEARNING_IMPACT';
    }
  } else if (operationType === 'CAMPAIGN_CREATED') {
    eventType = 'CAMPAIGN_CREATED';
    resetClass = 'EPOCH_START';
  } else if (['CAMPAIGN_SURGE_OPTIMIZATION_STARTED','CAMPAIGN_SURGE_OPTIMIZATION_FINISHED'].includes(operationType)) {
    eventType = operationType;
    resetClass = 'SYSTEM_OPTIMIZATION';
  } else if (operationType === 'CAMPAIGN_STATUS_CHANGE') {
    eventType = 'STATUS_CHANGE';
    resetClass = actor === 'SHOPEE_SYSTEM' ? 'SYSTEM_OPTIMIZATION' : 'LEARNING_IMPACT';
  } else if (['SKU_ADDED_TO_CAMPAIGN','SKU_REMOVED_FROM_CAMPAIGN'].includes(operationType)) {
    eventType = 'SKU_STRUCTURE_CHANGE';
    resetClass = 'LEARNING_IMPACT';
  }

  return {
    eventType,
    actor,
    resetClass,
    changedFields,
    effectiveFrom: operation.effectiveFrom ?? operation.effective_from ?? null,
    effectiveDate: operation.effectiveDate ?? operation.effective_date ?? null,
    effectiveTime: operation.effectiveTime ?? operation.effective_time ?? null,
    before: operation.before || null,
    after: operation.after || null,
    reason: operation.reason || null,
    itemId: operation.itemId ?? operation.item_id ?? null,
  };
}

function buildLearningTimeline(operations = []) {
  const events = (operations || []).map(classifyLearningOperation)
    .sort((a, b) => String(a.effectiveFrom || '').localeCompare(String(b.effectiveFrom || '')));
  const materialEvents = events.filter(row => row.resetClass !== 'CONTEXT_ONLY');
  const confirmedResets = events.filter(row => row.resetClass === 'CONFIRMED_RESET');
  const epochStarts = events.filter(row => row.resetClass === 'EPOCH_START');
  const resetCandidates = events.filter(row => row.resetClass === 'RESET_CANDIDATE');
  const latestConfirmedReset = confirmedResets.length ? confirmedResets[confirmedResets.length - 1] : null;
  const latestEpochStart = epochStarts.length ? epochStarts[epochStarts.length - 1] : null;
  const latestResolvedEpoch = [latestConfirmedReset, latestEpochStart]
    .filter(Boolean)
    .sort((a, b) => String(a.effectiveFrom || '').localeCompare(String(b.effectiveFrom || '')))
    .pop() || null;
  const unresolvedResetCandidates = resetCandidates.filter(row =>
    !latestResolvedEpoch || String(row.effectiveFrom || '') > String(latestResolvedEpoch.effectiveFrom || ''));
  return {
    events,
    latestMaterialEvent: materialEvents.length ? materialEvents[materialEvents.length - 1] : null,
    latestConfirmedReset,
    latestEpochStart,
    unresolvedResetCandidates,
    requiresSourceDisambiguation: unresolvedResetCandidates.length > 0,
  };
}

function leaderSwitchCount(allocationRows = []) {
  if (!allocationRows.length) return null;
  const byDate = new Map();
  for (const row of allocationRows) {
    if (!byDate.has(row.date)) byDate.set(row.date, []);
    byDate.get(row.date).push(row);
  }
  let previous = null;
  let switches = 0;
  for (const [, rows] of [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const leader = [...rows].sort((a, b) =>
      (b.directOrderShare - a.directOrderShare) || (b.spendShare - a.spendShare)
    )[0];
    if (!leader) continue;
    if (previous !== null && leader.itemId !== previous) switches += 1;
    previous = leader.itemId;
  }
  return switches;
}

function buildAnalysisPackage({
  shop,
  campaign,
  campaignDaily = [],
  comparisonCampaignDaily = [],
  historyCampaignDaily = [],
  comparisonPeriod = null,
  itemDaily = [],
  comparisonItemDaily = [],
  itemMetadata = new Map(),
  itemBreakEvenMap = new Map(),
  recommendedRoiMap = new Map(),
  weeklyOrderReference = 25,
  operations = [],
  startDate,
  endDate,
  dataCutoff = endDate,
  triggerType = 'MANUAL',
  triggerReason = null,
  dataQuality = {},
}) {
  const allocation = buildDailyAllocation(itemDaily);
  const grouped = new Map();
  for (const row of itemDaily) {
    const key = itemId(row);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }
  const comparisonGrouped = new Map();
  for (const row of comparisonItemDaily) {
    const key = itemId(row);
    if (!comparisonGrouped.has(key)) comparisonGrouped.set(key, []);
    comparisonGrouped.get(key).push(row);
  }

  const selectedPerformance = sumSourceAwarePerformance(campaignDaily);
  const previousPerformance = comparisonCampaignDaily.length
    ? sumSourceAwarePerformance(comparisonCampaignDaily)
    : null;

  const items = [...grouped.entries()].map(([id, rows]) => {
    const p = sumSourceAwarePerformance(rows);
    const itemAllocation = allocation.filter(row => row.itemId === id);
    const metadata = itemMetadata.get && itemMetadata.get(id) || {};
    const breakEvenRaw = itemBreakEvenMap.get && itemBreakEvenMap.get(id);
    const breakEvenRoas = Number(breakEvenRaw);
    const normalizedBreakEvenRoas = Number.isFinite(breakEvenRoas) && breakEvenRoas > 0 ? breakEvenRoas : null;
    const recommendedRoas = recommendedRoiMap.get && recommendedRoiMap.get(id) || null;
    const shares = {
      impressionShare: safeDiv(p.impressions, selectedPerformance.impressions),
      clickShare: safeDiv(p.clicks, selectedPerformance.clicks),
      spendShare: safeDiv(p.expense, selectedPerformance.expense),
      directOrderShare: safeDiv(p.directOrders, selectedPerformance.directOrders),
      directGmvShare: p.directGmv === null || selectedPerformance.directGmv === null
        ? null
        : safeDiv(p.directGmv, selectedPerformance.directGmv),
    };
    const previousRows = comparisonGrouped.get(id) || null;
    const previousItemPerformance = previousRows ? sumSourceAwarePerformance(previousRows) : null;
    const previousShares = previousItemPerformance && previousPerformance ? {
      impressionShare: safeDiv(previousItemPerformance.impressions, previousPerformance.impressions),
      clickShare: safeDiv(previousItemPerformance.clicks, previousPerformance.clicks),
      spendShare: safeDiv(previousItemPerformance.expense, previousPerformance.expense),
      directOrderShare: safeDiv(previousItemPerformance.directOrders, previousPerformance.directOrders),
      directGmvShare: previousItemPerformance.directGmv === null || previousPerformance.directGmv === null
        ? null
        : safeDiv(previousItemPerformance.directGmv, previousPerformance.directGmv),
    } : null;
    return {
      itemId: id,
      itemName: metadata.itemName || null,
      itemSku: metadata.itemSku || null,
      breakEvenRoas: normalizedBreakEvenRoas,
      recommendedRoas,
      ...p,
      roasVsBreakEven: normalizedBreakEvenRoas === null || p.directRoas === null
        ? 'UNKNOWN'
        : compareToThreshold(p.directRoas, normalizedBreakEvenRoas),
      shares,
      previousShares,
      shareChanges: previousShares ? {
        spendShare: shares.spendShare - previousShares.spendShare,
        directOrderShare: shares.directOrderShare - previousShares.directOrderShare,
        directGmvShare: shares.directGmvShare === null || previousShares.directGmvShare === null
          ? null
          : shares.directGmvShare - previousShares.directGmvShare,
      } : null,
      allocationGaps: {
        spendMinusDirectOrderShare: shares.spendShare - shares.directOrderShare,
        spendMinusDirectGmvShare: shares.directGmvShare === null ? null : shares.spendShare - shares.directGmvShare,
      },
      gmvPerDirectOrder: p.directGmv === null ? null : safeDiv(p.directGmv, p.directOrders),
      consecutiveOrderDays: consecutiveOrderDays(rows, endDate),
      activeOrderDays: new Set(rows.filter(r => normalizeSourceAwarePerformance(r).directOrders > 0).map(rowDate)).size,
      spendShareVolatility: coefficientVariation(itemAllocation.map(r => r.spendShare)),
    };
  });

  const historyDaily = historyCampaignDaily.length
    ? historyCampaignDaily
    : [...comparisonCampaignDaily, ...campaignDaily];
  const p7 = rollingPerformance(historyDaily, 7, endDate);
  const p14 = rollingPerformance(historyDaily, 14, endDate);
  const campaignDailyPerf = campaignDaily.map(normalizeSourceAwarePerformance);
  const weeklyReference = Number.isFinite(Number(weeklyOrderReference)) && Number(weeklyOrderReference) > 0
    ? Number(weeklyOrderReference)
    : 25;
  const observedDays7d = observationDays(historyDaily, 7, endDate);
  const targetRoas = Number(campaign && campaign.targetRoas);
  const normalizedTargetRoas = Number.isFinite(targetRoas) && targetRoas > 0 ? targetRoas : null;
  const breakEvenRoas = Number(campaign && campaign.breakEvenRoas);
  const normalizedBreakEvenRoas = Number.isFinite(breakEvenRoas) && breakEvenRoas > 0 ? breakEvenRoas : null;
  const spendRatioLimit = Number(campaign && campaign.adSpendRatioLimit);
  const normalizedSpendRatioLimit = Number.isFinite(spendRatioLimit) && spendRatioLimit > 0 ? spendRatioLimit : null;
  const requiredRoasForSpendLimit = normalizedSpendRatioLimit ? 1 / normalizedSpendRatioLimit : null;
  const learningTimeline = buildLearningTimeline(operations);
  const timeContext = buildAnalysisTimeContext({
    historyRows: historyDaily,
    learningTimeline,
    endDate,
    weeklyOrderReference: weeklyReference,
  });
  const epochMaturity = timeContext.learningEpoch && timeContext.learningEpoch.available
    ? timeContext.learningEpoch
    : null;
  const maturityObservedDays = epochMaturity ? epochMaturity.calendarDays : observedDays7d;
  const maturityDirectOrders = epochMaturity ? epochMaturity.directOrders : p7.directOrders;
  const maturitySampleMature = epochMaturity
    ? epochMaturity.maturityFloorMet && !timeContext.stabilityJudgmentBlocked
    : observedDays7d >= 7 && p7.directOrders >= weeklyReference;

  return {
    schemaVersion: '1.0',
    shop,
    period: { startDate, endDate, dataCutoff },
    comparisonPeriod,
    trigger: { type: triggerType, reason: triggerReason },
    campaign,
    campaignDaily,
    comparisonCampaignDaily,
    items,
    itemDaily,
    comparisonItemDaily,
    operations,
    deterministicMetrics: {
      learningTimeline,
      timeContext,
      maturity: {
        minimumObservationDays: 7,
        weeklyOrderReference: weeklyReference,
        observedCalendarDays: maturityObservedDays,
        directOrdersSinceEpoch: maturityDirectOrders,
        observedDays7d: maturityObservedDays,
        directOrders7d: maturityDirectOrders,
        sampleMature: maturitySampleMature,
        basis: epochMaturity ? 'CURRENT_LEARNING_EPOCH' : 'LATEST_7_CALENDAR_DAYS',
      },
      campaign: {
        directOrders7d: p7.directOrders,
        directOrders14d: p14.directOrders,
        broadRoas7d: p7.broadRoas,
        broadRoas14d: p14.broadRoas,
        directRoas7d: p7.directRoas,
        directRoas14d: p14.directRoas,
        directCvr7d: p7.directCvr,
        directCvr14d: p14.directCvr,
        current7d: performanceSnapshot(p7),
        currentWindow: performanceSnapshot(selectedPerformance),
        previousWindow: previousPerformance ? performanceSnapshot(previousPerformance) : null,
        windowComparison: previousPerformance ? comparePerformance(selectedPerformance, previousPerformance) : null,
        economics: {
          targetRoas: normalizedTargetRoas,
          breakEvenRoas: normalizedBreakEvenRoas,
          adSpendRatioLimit: normalizedSpendRatioLimit,
          requiredBroadRoasForSpendLimit: requiredRoasForSpendLimit,
          directRoasVsTarget: normalizedTargetRoas === null || p7.directRoas === null
            ? 'UNKNOWN'
            : compareToThreshold(p7.directRoas, normalizedTargetRoas),
          directRoasVsBreakEven: normalizedBreakEvenRoas === null || p7.directRoas === null
            ? 'UNKNOWN'
            : compareToThreshold(p7.directRoas, normalizedBreakEvenRoas),
          broadRoasVsSpendLimit: requiredRoasForSpendLimit === null
            ? 'UNKNOWN'
            : compareToThreshold(p7.broadRoas, requiredRoasForSpendLimit),
        },
        roasVolatility: coefficientVariation(campaignDailyPerf.map(p => p.directRoas)),
        cvrVolatility: coefficientVariation(campaignDailyPerf.map(p => p.directCvr)),
        leaderSwitchCount: leaderSwitchCount(allocation),
      },
      dailyAllocation: allocation,
    },
    dataQuality,
  };
}

module.exports = {
  coefficientVariation,
  rollingPerformance,
  consecutiveOrderDays,
  buildDailyAllocation,
  classifyLearningOperation,
  buildLearningTimeline,
  leaderSwitchCount,
  buildAnalysisPackage,
};
