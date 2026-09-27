'use strict';

function num(value) {
  if (value === null || value === undefined || value === '') return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function optionalNum(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
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
  const addToCart = pickMetric(row, ['add_to_cart', 'addToCart']);

  const sourceCtr = pickOptionalMetric(row, ['ctr']);
  const sourceBroadCvr = pickOptionalMetric(row, ['broad_cvr', 'broadCvr']);
  const sourceDirectCvr = pickOptionalMetric(row, ['direct_cvr', 'directCvr']);
  const sourceBroadRoas = pickOptionalMetric(row, ['broad_roi', 'broad_roas', 'broadRoas', 'roi', 'roas']);
  const sourceDirectRoas = pickOptionalMetric(row, ['direct_roi', 'direct_roas', 'directRoas']);
  const sourceAddToCartRate = pickOptionalMetric(row, ['add_to_cart_rate', 'addToCartRate']);
  const sourceCostPerConversion = pickOptionalMetric(row, ['cost_per_conversion', 'costPerConversion']);
  const sourceCostPerDirectConversion = pickOptionalMetric(row, ['cost_per_direct_conversion', 'costPerDirectConversion']);
  const sourceBroadAcos = pickOptionalMetric(row, ['broad_acos', 'broadAcos']);
  const sourceDirectAcos = pickOptionalMetric(row, ['direct_acos', 'directAcos']);

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
    addToCart,
    ctr: sourceCtr !== null ? sourceCtr : safeDiv(clicks, impressions),
    broadCvr: sourceBroadCvr !== null ? sourceBroadCvr : safeDiv(broadOrders, clicks),
    directCvr: sourceDirectCvr !== null ? sourceDirectCvr : safeDiv(directOrders, clicks),
    broadRoas: sourceBroadRoas !== null ? sourceBroadRoas : safeDiv(broadGmv, expense),
    directRoas,
    addToCartRate: sourceAddToCartRate !== null ? sourceAddToCartRate : safeDiv(addToCart, clicks),
    costPerConversion: sourceCostPerConversion !== null ? sourceCostPerConversion : safeDiv(expense, broadOrders),
    costPerDirectConversion: sourceCostPerDirectConversion !== null ? sourceCostPerDirectConversion : safeDiv(expense, directOrders),
    broadAcos: sourceBroadAcos !== null ? sourceBroadAcos : safeDiv(expense, broadGmv),
    directAcos: sourceDirectAcos !== null
      ? sourceDirectAcos
      : (directGmv !== null ? safeDiv(expense, directGmv) : null),
    dataQualityFlags: !sourceDirectGmvPresent && (sourceDirectRoas !== null || directOrders !== 0)
      ? ['SOURCE_DIRECT_GMV_MISSING']
      : [],
    // Backward-compatible CPC means cost-per-click in the read model. Product
    // Ads API field `cpc` is handled separately as source cost-per-conversion.
    cpc: safeDiv(expense, clicks),
  };
}

function sumPerformance(rows = []) {
  if (rows.length === 1) {
    const single = normalizePerformance(rows[0]);
    return {
      ...single,
      directMetricComplete: single.directGmv !== null,
    };
  }

  let directGmvAvailable = true;
  const totals = rows.reduce((acc, row) => {
    const p = normalizePerformance(row);
    for (const key of ['impressions','clicks','expense','broadGmv','broadOrders','broadUnits','directOrders','directUnits','addToCart']) {
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
    addToCart: 0,
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
    addToCartRate: safeDiv(totals.addToCart, totals.clicks),
    costPerConversion: safeDiv(totals.expense, totals.broadOrders),
    costPerDirectConversion: safeDiv(totals.expense, totals.directOrders),
    broadAcos: safeDiv(totals.expense, totals.broadGmv),
    directAcos: completeDirectGmv !== null ? safeDiv(totals.expense, completeDirectGmv) : null,
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
  optionalNum,
  safeDiv,
  pickOptionalMetric,
  normalizePerformance,
  sumPerformance,
  deriveItemShares,
  targetCpa,
  explorationCostMultiple,
};
