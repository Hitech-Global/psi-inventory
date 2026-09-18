'use strict';

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function safeRatio(numerator, denominator) {
  const n = toNumber(numerator);
  const d = toNumber(denominator);
  return d === 0 ? null : n / d;
}

function pctChange(current, previous) {
  const c = toNumber(current);
  const p = toNumber(previous);
  if (p === 0) return c === 0 ? 0 : null;
  return (c - p) / Math.abs(p);
}

function isoDate(value) {
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid ISO date: ${value}`);
  return d;
}

function previousPeriod(startDate, endDate) {
  const start = isoDate(startDate);
  const end = isoDate(endDate);
  if (start > end) throw new Error('startDate must be <= endDate');
  const days = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
  const previousEnd = new Date(start.getTime() - 86400000);
  const previousStart = new Date(previousEnd.getTime() - (days - 1) * 86400000);
  return {
    days,
    startDate: previousStart.toISOString().slice(0, 10),
    endDate: previousEnd.toISOString().slice(0, 10),
  };
}

function metricSnapshot(row = {}) {
  const sales = toNumber(row.sales);
  const orders = toNumber(row.orders);
  const productClicks = toNumber(row.productClicks);
  const productViews = toNumber(row.productViews);
  const adExpense = toNumber(row.adExpense);
  const broadGmv = toNumber(row.broadGmv);
  const directGmv = toNumber(row.directGmv);
  const estimatedNaturalSales = row.estimatedNaturalSales === undefined
    ? Math.max(0, sales - broadGmv)
    : toNumber(row.estimatedNaturalSales);

  return {
    sales,
    orders,
    unitsSold: toNumber(row.unitsSold),
    productClicks,
    productViews,
    aov: safeRatio(sales, orders),
    clickToOrder: safeRatio(orders, productClicks),
    viewToClick: safeRatio(productClicks, productViews),
    adExpense,
    broadGmv,
    directGmv,
    broadOrders: toNumber(row.broadOrders),
    directOrders: toNumber(row.directOrders),
    adSpendRatio: safeRatio(adExpense, sales),
    adGmvShare: safeRatio(broadGmv, sales),
    estimatedNaturalSales,
    refundAmount: toNumber(row.refundAmount),
    returnCount: toNumber(row.returnCount),
  };
}

function changeSet(current, previous) {
  return {
    sales: pctChange(current.sales, previous.sales),
    orders: pctChange(current.orders, previous.orders),
    productClicks: pctChange(current.productClicks, previous.productClicks),
    productViews: pctChange(current.productViews, previous.productViews),
    aov: pctChange(current.aov, previous.aov),
    clickToOrder: pctChange(current.clickToOrder, previous.clickToOrder),
    viewToClick: pctChange(current.viewToClick, previous.viewToClick),
    adExpense: pctChange(current.adExpense, previous.adExpense),
    broadGmv: pctChange(current.broadGmv, previous.broadGmv),
    directGmv: pctChange(current.directGmv, previous.directGmv),
    estimatedNaturalSales: pctChange(current.estimatedNaturalSales, previous.estimatedNaturalSales),
    refundAmount: pctChange(current.refundAmount, previous.refundAmount),
  };
}

function signal(code, severity, title, detail) {
  return { code, severity, title, detail };
}

function buildSignals(current, previous, changes, {
  declineThreshold = -0.10,
  growthThreshold = 0.10,
  adSpendRatioLimit = 0.15,
} = {}) {
  const signals = [];

  if (current.adSpendRatio !== null && current.adSpendRatio > adSpendRatioLimit) {
    signals.push(signal(
      'AD_SPEND_RATIO_OVER_LIMIT',
      'high',
      '广告花费占比超出经营约束',
      `当前广告花费 / BI销售额为 ${(current.adSpendRatio * 100).toFixed(1)}%，高于 ${(adSpendRatioLimit * 100).toFixed(0)}% 约束。`,
    ));
  }

  if (changes.sales !== null && changes.sales <= declineThreshold) {
    signals.push(signal(
      'SALES_DOWN',
      'high',
      '销售额下降',
      '先拆流量、转化、客单价以及广告/自然销售变化，不直接把下降归因于广告。',
    ));
  }

  if (changes.productClicks !== null && changes.productClicks <= declineThreshold) {
    signals.push(signal(
      'TRAFFIC_DOWN',
      'medium',
      '商品点击流量下降',
      'Product Clicks 相比上一等长周期下降，优先检查流量获取与商品曝光/点击承接。',
    ));
  }

  if (changes.clickToOrder !== null && changes.clickToOrder <= declineThreshold) {
    signals.push(signal(
      'CONVERSION_DOWN',
      'high',
      '点击到订单转化下降',
      'Orders / Product Clicks 下降，优先下钻商品价格、优惠、详情与广告流量质量。',
    ));
  }

  if (changes.aov !== null && changes.aov <= declineThreshold) {
    signals.push(signal(
      'AOV_DOWN',
      'medium',
      '客单价下降',
      '销售额下降可能部分来自订单结构或售价变化，而不只是流量或转化。',
    ));
  }

  if (changes.estimatedNaturalSales !== null && changes.estimatedNaturalSales <= declineThreshold) {
    signals.push(signal(
      'NATURAL_SALES_DOWN',
      'medium',
      '估算自然销售下降',
      'BI销售额减 Broad Ads GMV 的估算自然销售下降；需要结合 Product Card 与订单结构继续验证。',
    ));
  }

  if (changes.broadGmv !== null && changes.broadGmv <= declineThreshold) {
    signals.push(signal(
      'AD_GMV_DOWN',
      'medium',
      '广告归因 GMV 下降',
      'Broad Ads GMV 下降；进入广告诊断页确认是订单量、ROAS、流量还是 SKU 结构问题。',
    ));
  }

  if (changes.sales !== null && changes.sales >= growthThreshold) {
    const drivers = [
      ['productClicks', '流量'],
      ['clickToOrder', '转化'],
      ['aov', '客单价'],
      ['broadGmv', '广告GMV'],
      ['estimatedNaturalSales', '估算自然销售'],
    ]
      .filter(([key]) => changes[key] !== null && changes[key] >= growthThreshold)
      .map(([, label]) => label);
    signals.push(signal(
      'SALES_GROWTH',
      'positive',
      '销售额增长',
      drivers.length ? `同步增长信号：${drivers.join('、')}。` : '销售额增长，但主要驱动项暂未达到 10% 变化阈值。',
    ));
  }

  if (!signals.length) {
    signals.push(signal(
      'STABLE',
      'neutral',
      '经营表现相对稳定',
      '与上一等长周期相比，没有指标越过当前 10% 变化阈值。',
    ));
  }

  const severityRank = { high: 0, medium: 1, neutral: 2, positive: 3 };
  return signals.sort((a, b) =>
    (severityRank[a.severity] ?? 9) - (severityRank[b.severity] ?? 9)
  );
}

function diagnoseRow(currentRow, previousRow = null, options = {}) {
  const current = metricSnapshot(currentRow || {});
  const previous = metricSnapshot(previousRow || {});
  const hasPrevious = Boolean(previousRow);
  const changes = hasPrevious ? changeSet(current, previous) : {};
  const signals = hasPrevious
    ? buildSignals(current, previous, changes, options)
    : [signal(
        'NO_PREVIOUS_PERIOD',
        'neutral',
        '缺少上一周期数据',
        '先完成上一等长周期同步，再做变化拆解。',
      )];

  return {
    current,
    previous: hasPrevious ? previous : null,
    changes: hasPrevious ? changes : null,
    primarySignal: signals[0],
    signals,
  };
}

function diagnosePortfolio(currentOverview, previousOverview, options = {}) {
  const previousShopMap = new Map(
    (previousOverview.shops || []).map(row => [String(row.shopId), row]),
  );
  const shops = (currentOverview.shops || []).map(row => ({
    shopId: row.shopId,
    diagnosis: diagnoseRow(row, previousShopMap.get(String(row.shopId)) || null, options),
  }));

  const groupKey = row => [row.countryCode, row.brandCode, row.currency].join('|');
  const previousGroupMap = new Map(
    (previousOverview.businessGroups || []).map(row => [groupKey(row), row]),
  );
  const businessGroups = (currentOverview.businessGroups || []).map(row => ({
    key: groupKey(row),
    countryCode: row.countryCode,
    brandCode: row.brandCode,
    currency: row.currency,
    diagnosis: diagnoseRow(row, previousGroupMap.get(groupKey(row)) || null, options),
  }));

  return { shops, businessGroups };
}

module.exports = {
  toNumber,
  safeRatio,
  pctChange,
  previousPeriod,
  metricSnapshot,
  changeSet,
  buildSignals,
  diagnoseRow,
  diagnosePortfolio,
};
