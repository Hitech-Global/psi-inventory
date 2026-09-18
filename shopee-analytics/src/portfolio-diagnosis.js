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

function signal(code, severity, title, detail, action = null) {
  return { code, severity, title, detail, action };
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
      '先停止追求额外放量，进入广告诊断检查 ROAS、弱 SKU 与商品转化，恢复到经营约束内再测试扩量。',
    ));
  }

  if (changes.sales !== null && changes.sales <= declineThreshold) {
    signals.push(signal(
      'SALES_DOWN',
      'high',
      '销售额下降',
      '先拆流量、转化、客单价以及广告/自然销售变化，不直接把下降归因于广告。',
      '按 Product Clicks → 点击到订单 → AOV → 广告GMV/估算自然销售的顺序定位下降环节，再只改最主要变量。',
    ));
  }

  if (changes.productClicks !== null && changes.productClicks <= declineThreshold) {
    signals.push(signal(
      'TRAFFIC_DOWN',
      'medium',
      '商品点击流量下降',
      'Product Clicks 相比上一等长周期下降，优先检查流量获取与商品曝光/点击承接。',
      '先看活动日差异、商品曝光/点击变化和广告流量是否同步下降；不要先用降价解决纯流量问题。',
    ));
  }

  if (changes.clickToOrder !== null && changes.clickToOrder <= declineThreshold) {
    signals.push(signal(
      'CONVERSION_DOWN',
      'high',
      '点击到订单转化下降',
      'Orders / Product Clicks 下降，优先下钻商品价格、优惠、详情与广告流量质量。',
      '进入商品矩阵找低 CVR SKU，对照价格、Voucher/Discount、Product Card 与广告 Direct CVR 做单变量验证。',
    ));
  }

  if (changes.aov !== null && changes.aov <= declineThreshold) {
    signals.push(signal(
      'AOV_DOWN',
      'medium',
      '客单价下降',
      '销售额下降可能部分来自订单结构或售价变化，而不只是流量或转化。',
      '检查价格/优惠变化与高低客单 SKU 销量结构，确认是否是商品结构变化造成。',
    ));
  }

  if (changes.estimatedNaturalSales !== null && changes.estimatedNaturalSales <= declineThreshold) {
    signals.push(signal(
      'NATURAL_SALES_DOWN',
      'medium',
      '估算自然销售下降',
      'BI销售额减 Broad Ads GMV 的估算自然销售下降；需要结合 Product Card 与订单结构继续验证。',
      '优先找自然销售下降最大的 SKU，检查其商品流量、CVR、价格和活动变化；该指标是估算值，不单独作为归因结论。',
    ));
  }

  if (changes.broadGmv !== null && changes.broadGmv <= declineThreshold) {
    signals.push(signal(
      'AD_GMV_DOWN',
      'medium',
      '广告归因 GMV 下降',
      'Broad Ads GMV 下降；进入广告诊断页确认是订单量、ROAS、流量还是 SKU 结构问题。',
      '下钻 Campaign，严格按整体订单量 → ROAS → Funnel → SKU 赛马定位广告侧变化。',
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
      '记录本周期增长驱动，尽量保持其他变量稳定，再验证增长是否能延续到下一普通周期。',
    ));
  }

  if (!signals.length) {
    signals.push(signal(
      'STABLE',
      'neutral',
      '经营表现相对稳定',
      '与上一等长周期相比，没有指标越过当前 10% 变化阈值。',
      '保持核心变量稳定，继续积累一个完整周期后再判断是否需要调整。',
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
        '先补齐上一周期数据，不在缺少基线时生成增长/下降结论。',
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
