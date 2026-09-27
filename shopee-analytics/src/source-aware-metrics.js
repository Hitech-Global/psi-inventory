'use strict';

const { normalizePerformance, safeDiv, sumPerformance } = require('./metrics');
const { normalizeGmsPerformance } = require('./sync-gms');

function rawGmsReport(row) {
  const raw = row && (row.raw_json || row.rawJson || row.raw);
  return raw && raw.report && typeof raw.report === 'object' ? raw.report : null;
}

function fallbackReport(row = {}) {
  return {
    impression: row.impressions,
    clicks: row.clicks,
    expense: row.expense,
    broad_gmv: row.broad_gmv ?? row.broadGmv,
    broad_order: row.broad_orders ?? row.broadOrders,
    broad_order_amount: row.broad_units ?? row.broadUnits,
    direct_gmv: row.direct_gmv ?? row.directGmv,
    direct_order: row.direct_orders ?? row.directOrders,
    direct_order_amount: row.direct_units ?? row.directUnits,
    broad_roi: row.broad_roas ?? row.broadRoas,
    direct_roi: row.direct_roas ?? row.directRoas,
  };
}

function isZeroPerformanceRow(row = {}) {
  const p = normalizePerformance(row);
  return ['impressions','clicks','expense','broadGmv','broadOrders','broadUnits','directOrders','directUnits']
    .every(key => Number(p[key] || 0) === 0) && p.directGmv === null;
}

function normalizeSourceAwarePerformance(row = {}) {
  const report = rawGmsReport(row);
  if (!report) return { ...normalizePerformance(row), sourceFamily: 'GENERIC', sourcePrecisionExpense: Number(row.expense || 0) };
  const p = normalizeGmsPerformance({ ...fallbackReport(row), ...report });
  const sourcePrecisionExpense = p.broadOrders > 0 && p.gmsCostPrecision.sourceCostPerConversionAvailable
    ? p.costPerConversion * p.broadOrders
    : p.expense;
  return { ...p, sourceFamily: 'GMS', sourcePrecisionExpense };
}

function isGmsSeries(rows = []) {
  const hasGms = rows.some(row => Boolean(rawGmsReport(row)));
  return hasGms && rows.every(row => Boolean(rawGmsReport(row)) || isZeroPerformanceRow(row));
}

function sumGmsPerformance(rows = []) {
  if (!rows.length) return sumPerformance([]);
  const ps = rows.map(row => {
    const report = rawGmsReport(row);
    if (report) return normalizeSourceAwarePerformance(row);
    return { ...normalizePerformance(row), sourceFamily: 'GMS_ZERO', sourcePrecisionExpense: 0 };
  });
  const totals = ps.reduce((a, p) => {
    for (const key of ['impressions','clicks','expense','broadGmv','broadOrders','broadUnits','directOrders','directUnits']) a[key] += Number(p[key] || 0);
    a.sourcePrecisionExpense += Number(p.sourcePrecisionExpense || 0);
    if (p.directGmv === null) a.directGmvComplete = false; else a.directGmv += p.directGmv;
    if (p.addToCart === null) a.addToCartComplete = false; else a.addToCart += p.addToCart;
    if (Number(p.sourcePrecisionExpense || 0) > 0) {
      if (p.directRoas === null || !Number.isFinite(Number(p.directRoas))) a.directRoasComplete = false;
      else a.directRoasWeightedNumerator += Number(p.directRoas) * Number(p.sourcePrecisionExpense);
    }
    return a;
  }, { impressions:0, clicks:0, expense:0, broadGmv:0, broadOrders:0, broadUnits:0, directGmv:0, directOrders:0, directUnits:0, addToCart:0, sourcePrecisionExpense:0, directGmvComplete:true, addToCartComplete:true, directRoasComplete:true, directRoasWeightedNumerator:0 });
  const spend = totals.sourcePrecisionExpense;
  const directGmv = totals.directGmvComplete ? totals.directGmv : null;
  const addToCart = totals.addToCartComplete ? totals.addToCart : null;
  return {
    impressions: totals.impressions, clicks: totals.clicks, expense: totals.expense,
    broadGmv: totals.broadGmv, broadOrders: totals.broadOrders, broadUnits: totals.broadUnits,
    directGmv, sourceDirectGmvPresent: totals.directGmvComplete, directGmvAvailable: totals.directGmvComplete, directMetricComplete: totals.directGmvComplete,
    directOrders: totals.directOrders, directUnits: totals.directUnits,
    addToCart, addToCartAvailable: totals.addToCartComplete, addToCartMetricComplete: totals.addToCartComplete,
    ctr: safeDiv(totals.clicks, totals.impressions), broadCvr: safeDiv(totals.broadOrders, totals.clicks), directCvr: safeDiv(totals.directOrders, totals.clicks),
    broadRoas: safeDiv(totals.broadGmv, spend),
    directRoas: spend === 0 ? 0 : (totals.directRoasComplete ? totals.directRoasWeightedNumerator / spend : null),
    directRoasSourceComplete: totals.directRoasComplete,
    addToCartRate: addToCart === null ? null : safeDiv(addToCart, totals.clicks),
    costPerConversion: safeDiv(spend, totals.broadOrders), costPerDirectConversion: safeDiv(spend, totals.directOrders),
    broadAcos: safeDiv(spend, totals.broadGmv), directAcos: directGmv === null ? null : safeDiv(spend, directGmv),
    cpc: safeDiv(spend, totals.clicks), sourceFamily: 'GMS', sourcePrecisionExpense: spend,
  };
}

function sumSourceAwarePerformance(rows = []) {
  return isGmsSeries(rows) ? sumGmsPerformance(rows) : sumPerformance(rows);
}

module.exports = { rawGmsReport, isGmsSeries, normalizeSourceAwarePerformance, sumGmsPerformance, sumSourceAwarePerformance };
