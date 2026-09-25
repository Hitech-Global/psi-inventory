'use strict';

function num(value) {
  if (value === null || value === undefined || value === '') return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function safeDiv(numerator, denominator) {
  const n = num(numerator);
  const d = num(denominator);
  return d === 0 ? 0 : n / d;
}

function pickMetric(row, names) {
  for (const name of names) {
    if (row && row[name] !== undefined && row[name] !== null) return num(row[name]);
  }
  return 0;
}

// Unlike ordinary counters, an absent Direct GMV source value is not zero.  Shopee
// can provide Direct ROI/order values without providing a Direct GMV field, so
// preserving absence here is required to avoid inventing a financially meaningful 0.
function pickOptionalMetric(row, names) {
  for (const name of names) {
    if (row && row[name] !== undefined && row[name] !== null) return num(row[name]);
  }
  return null;
}

function normalizePerformance(row = {}) {
  const expense = pickMetric(row, ['expense', 'spend']);
  const impressions = pickMetric(row, ['impression', 'impressions']);
  const clicks = pickMetric(row, ['click', 'clicks']);
  const broadGmv = pickMetric(row, ['broad_gmv', 'broadGmv', 'gmv', 'sales']);
  const broadOrders = pickMetric(row, ['broad_order', 'broad_orders', 'broadOrders', 'orders']);
  const broadUnits = pickMetric(row, ['broad_order_amount', 'broad_item_sold', 'broad_units', 'broadUnits', 'units']);
  const directGmv = pickOptionalMetric(row, ['direct_gmv', 'directGmv']);
  const directOrders = pickMetric(row, ['direct_order', 'direct_orders', 'directOrders']);
  const directUnits = pickMetric(row, ['direct_order_amount', 'direct_item_sold', 'direct_units', 'directUnits']);

  const sourceDirectRoas = pickOptionalMetric(row, ['direct_roi', 'direct_roas', 'directRoas']);
  const directRoas = sourceDirectRoas !== null
    ? sourceDirectRoas
    : (directGmv !== null && expense > 0 ? directGmv / expense : null);
  const sourceDirectGmvPresent = directGmv !== null;

  return {
    impressions,
    clicks,
    expense,
    broadGmv,
    broadOrders,
    broadUnits,
    directGmv,
    sourceDirectGmvPresent,
    directGmvAvailable: sourceDirectGmvPresent,
    directOrders,
    directUnits,
    ctr: row.ctr !== undefined ? num(row.ctr) : safeDiv(clicks, impressions),
    broadCvr: row.broad_cvr !== undefined ? num(row.broad_cvr) : safeDiv(broadOrders, clicks),
    directCvr: row.direct_cvr !== undefined ? num(row.direct_cvr) : safeDiv(directOrders, clicks),
    broadRoas: pickMetric(row, ['broad_roi', 'broad_roas', 'broadRoas']) || safeDiv(broadGmv, expense),
    directRoas,
    dataQualityFlags: !sourceDirectGmvPresent && (sourceDirectRoas !== null || directOrders !== 0)
      ? ['SOURCE_DIRECT_GMV_MISSING']
      : [],
    cpc: row.cpc !== undefined ? num(row.cpc) : safeDiv(expense, clicks),
  };
}

function sumPerformance(rows = []) {
  let directGmvAvailable = true;
  const totals = rows.reduce((acc, row) => {
    const p = normalizePerformance(row);
    for (const key of ['impressions','clicks','expense','broadGmv','broadOrders','broadUnits','directOrders','directUnits']) {
      acc[key] += p[key];
    }
    if (p.directGmv === null) directGmvAvailable = false;
    else acc.directGmv += p.directGmv;
    return acc;
  }, {
    impressions: 0,
    clicks: 0,
    expense: 0,
    broadGmv: 0,
    broadOrders: 0,
    broadUnits: 0,
    directGmv: 0,
    directOrders: 0,
    directUnits: 0,
  });

  const completeDirectGmv = directGmvAvailable ? totals.directGmv : null;
  return {
    ...totals,
    directGmv: completeDirectGmv,
    sourceDirectGmvPresent: directGmvAvailable,
    directGmvAvailable,
    directMetricComplete: directGmvAvailable,
    ctr: safeDiv(totals.clicks, totals.impressions),
    broadCvr: safeDiv(totals.broadOrders, totals.clicks),
    directCvr: safeDiv(totals.directOrders, totals.clicks),
    broadRoas: safeDiv(totals.broadGmv, totals.expense),
    directRoas: completeDirectGmv !== null && totals.expense > 0 ? completeDirectGmv / totals.expense : null,
    cpc: safeDiv(totals.expense, totals.clicks),
  };
}

function deriveItemShares(itemRow, groupPerformance) {
  const item = normalizePerformance(itemRow);
  const group = normalizePerformance(groupPerformance);
  return {
    impressionShare: safeDiv(item.impressions, group.impressions),
    clickShare: safeDiv(item.clicks, group.clicks),
    spendShare: safeDiv(item.expense, group.expense),
    broadGmvShare: safeDiv(item.broadGmv, group.broadGmv),
    directGmvShare: item.directGmv === null || group.directGmv === null ? null : safeDiv(item.directGmv, group.directGmv),
    broadOrderShare: safeDiv(item.broadOrders, group.broadOrders),
    directOrderShare: safeDiv(item.directOrders, group.directOrders),
    gmvPerDirectOrder: item.directGmv === null ? null : safeDiv(item.directGmv, item.directOrders),
  };
}

function targetCpa({ aov, targetRoas }) {
  return safeDiv(aov, targetRoas);
}

function explorationCostMultiple({ spend, aov, targetRoas }) {
  const cpa = targetCpa({ aov, targetRoas });
  return cpa > 0 ? safeDiv(spend, cpa) : 0;
}

module.exports = {
  num,
  safeDiv,
  pickOptionalMetric,
  normalizePerformance,
  sumPerformance,
  deriveItemShares,
  targetCpa,
  explorationCostMultiple,
};
