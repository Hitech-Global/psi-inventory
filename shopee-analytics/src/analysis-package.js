'use strict';

const { normalizePerformance, safeDiv, sumPerformance } = require('./metrics');

function rowDate(row) {
  return String(row.date ?? row.event_date ?? row.eventDate ?? '').slice(0, 10);
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

function rollingPerformance(rows, days, endDate) {
  const end = new Date(`${endDate}T00:00:00Z`);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - days + 1);
  return sumPerformance((rows || []).filter(row => {
    const d = new Date(`${rowDate(row)}T00:00:00Z`);
    return Number.isFinite(d.getTime()) && d >= start && d <= end;
  }));
}

function consecutiveOrderDays(rows, endDate) {
  const byDate = new Map();
  for (const row of rows || []) {
    const d = rowDate(row);
    if (!d) continue;
    const p = normalizePerformance(row);
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
    const total = sumPerformance(rows);
    for (const row of rows) {
      const p = normalizePerformance(row);
      output.push({
        date,
        itemId: itemId(row),
        impressionShare: safeDiv(p.impressions, total.impressions),
        clickShare: safeDiv(p.clicks, total.clicks),
        spendShare: safeDiv(p.expense, total.expense),
        directOrderShare: safeDiv(p.directOrders, total.directOrders),
        directGmvShare: safeDiv(p.directGmv, total.directGmv),
      });
    }
  }
  return output;
}

function leaderSwitchCount(allocationRows = []) {
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
  itemDaily = [],
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

  const items = [...grouped.entries()].map(([id, rows]) => {
    const p = sumPerformance(rows);
    const itemAllocation = allocation.filter(row => row.itemId === id);
    return {
      itemId: id,
      ...p,
      gmvPerDirectOrder: safeDiv(p.directGmv, p.directOrders),
      consecutiveOrderDays: consecutiveOrderDays(rows, endDate),
      activeOrderDays: new Set(rows.filter(r => normalizePerformance(r).directOrders > 0).map(rowDate)).size,
      spendShareVolatility: coefficientVariation(itemAllocation.map(r => r.spendShare)),
    };
  });

  const p7 = rollingPerformance(campaignDaily, 7, endDate);
  const p14 = rollingPerformance(campaignDaily, 14, endDate);
  const campaignDailyPerf = campaignDaily.map(normalizePerformance);

  return {
    schemaVersion: '1.0',
    shop,
    period: { startDate, endDate, dataCutoff },
    trigger: { type: triggerType, reason: triggerReason },
    campaign,
    campaignDaily,
    items,
    itemDaily,
    operations,
    deterministicMetrics: {
      campaign: {
        directOrders7d: p7.directOrders,
        directOrders14d: p14.directOrders,
        broadRoas7d: p7.broadRoas,
        broadRoas14d: p14.broadRoas,
        directRoas7d: p7.directRoas,
        directRoas14d: p14.directRoas,
        directCvr7d: p7.directCvr,
        directCvr14d: p14.directCvr,
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
  leaderSwitchCount,
  buildAnalysisPackage,
};
