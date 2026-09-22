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

function normalizePerformance(row = {}) {
  const expense = pickMetric(row, ['expense', 'spend']);
  const impressions = pickMetric(row, ['impression', 'impressions']);
  const clicks = pickMetric(row, ['click', 'clicks']);
  const broadGmv = pickMetric(row, ['broad_gmv', 'broadGmv', 'gmv', 'sales']);
  const broadOrders = pickMetric(row, ['broad_order', 'broad_orders', 'broadOrders', 'orders']);
  const broadUnits = pickMetric(row, ['broad_order_amount', 'broad_item_sold', 'broad_units', 'broadUnits', 'units']);
  const directGmv = pickMetric(row, ['direct_gmv', 'directGmv']);
  const directOrders = pickMetric(row, ['direct_order', 'direct_orders', 'directOrders']);
  const directUnits = pickMetric(row, ['direct_order_amount', 'direct_item_sold', 'direct_units', 'directUnits']);

  return {
    impressions,
    clicks,
    expense,
    broadGmv,
    broadOrders,
    broadUnits,
    directGmv,
    directOrders,
    directUnits,
    ctr: row.ctr !== undefined ? num(row.ctr) : safeDiv(clicks, impressions),
    broadCvr: row.broad_cvr !== undefined ? num(row.broad_cvr) : safeDiv(broadOrders, clicks),
    directCvr: row.direct_cvr !== undefined ? num(row.direct_cvr) : safeDiv(directOrders, clicks),
    broadRoas: pickMetric(row, ['broad_roi', 'broad_roas', 'broadRoas']) || safeDiv(broadGmv, expense),
    directRoas: pickMetric(row, ['direct_roi', 'direct_roas', 'directRoas']) || safeDiv(directGmv, expense),
    cpc: row.cpc !== undefined ? num(row.cpc) : safeDiv(expense, clicks),
  };
}

function sumPerformance(rows = []) {
  const totals = rows.reduce((acc, row) => {
    const p = normalizePerformance(row);
    for (const key of ['impressions','clicks','expense','broadGmv','broadOrders','broadUnits','directGmv','directOrders','directUnits']) {
      acc[key] += p[key];
    }
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

  return {
    ...totals,
    ctr: safeDiv(totals.clicks, totals.impressions),
    broadCvr: safeDiv(totals.broadOrders, totals.clicks),
    directCvr: safeDiv(totals.directOrders, totals.clicks),
    broadRoas: safeDiv(totals.broadGmv, totals.expense),
    directRoas: safeDiv(totals.directGmv, totals.expense),
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
    directGmvShare: safeDiv(item.directGmv, group.directGmv),
    broadOrderShare: safeDiv(item.broadOrders, group.broadOrders),
    directOrderShare: safeDiv(item.directOrders, group.directOrders),
    gmvPerDirectOrder: safeDiv(item.directGmv, item.directOrders),
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
  normalizePerformance,
  sumPerformance,
  deriveItemShares,
  targetCpa,
  explorationCostMultiple,
};
