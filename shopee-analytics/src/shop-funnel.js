'use strict';

/**
 * Shop traffic funnel: one row per metric, one column per day.
 *
 * The shape follows the spreadsheet the team keeps by hand — metric names
 * down the left, dates across the top, and a change row above each of the
 * two headline numbers. What differs is that every metric here is derived
 * from a stored source, so a metric whose source has not been filled yet
 * reads as "no data" rather than as zero.
 *
 * That distinction matters. A funnel that shows zero visitors looks like a
 * shop with no traffic; a funnel that shows nothing tells the reader the
 * traffic data has not arrived. The second is true.
 */

const METRIC_GROUPS = [
  {
    key: 'change',
    label: '环比变化',
    labelEn: 'Change vs previous day',
    kind: 'change',
    rows: [
      { key: 'orderDelta', metric: 'order', label: 'Order 环比', labelEn: 'Order change' },
      { key: 'gmvDelta', metric: 'gmv', label: 'GMV 环比', labelEn: 'GMV change' },
    ],
  },
  {
    key: 'traffic',
    label: '流量漏斗',
    labelEn: 'Traffic funnel',
    kind: 'body',
    rows: [
      { key: 'visitor', label: 'Visitor', labelEn: 'Visitor', format: 'number' },
      { key: 'productViews', label: 'Product Views', labelEn: 'Product Views', format: 'number' },
      { key: 'productClicks', label: 'Product Clicks', labelEn: 'Product Clicks', format: 'number' },
      { key: 'ctr', label: 'CTR', labelEn: 'CTR', format: 'percent' },
      { key: 'order', label: 'Order', labelEn: 'Order', format: 'number' },
      { key: 'conversionRate', label: 'Conversion Rate', labelEn: 'Conversion Rate', format: 'percent' },
      { key: 'gmv', label: 'GMV', labelEn: 'GMV', format: 'money' },
    ],
  },
  {
    key: 'livestream',
    label: '直播表现',
    labelEn: 'Livestream',
    kind: 'body',
    rows: [
      { key: 'liveSessions', label: 'Live Session', labelEn: 'Live Session', format: 'number' },
      { key: 'liveHours', label: 'Live Hour', labelEn: 'Live Hour', format: 'number' },
      { key: 'liveViewers', label: 'Live Viewer', labelEn: 'Live Viewer', format: 'number' },
      { key: 'liveViews', label: 'Live Views', labelEn: 'Live Views', format: 'number' },
      { key: 'liveConfirmedOrders', label: 'Live Order', labelEn: 'Live Order', format: 'number' },
      { key: 'liveConfirmedSales', label: 'Live GMV', labelEn: 'Live GMV', format: 'money' },
    ],
  },
  {
    key: 'shopHealth',
    label: '店铺健康',
    labelEn: 'Shop Health',
    kind: 'body',
    rows: [
      { key: 'shopRating', label: '店铺评分', labelEn: 'Shop Rating', format: 'number' },
      { key: 'returnRefundRate', label: '退货退款率', labelEn: 'Return & Refund Rate', format: 'percent' },
      { key: 'cancellationRate', label: '取消率', labelEn: 'Cancellation Rate', format: 'percent' },
      { key: 'lateShipmentRate', label: '迟发率', labelEn: 'Late Shipment Rate', format: 'percent' },
      { key: 'csatRate', label: '客服满意率', labelEn: 'CSAT', format: 'percent' },
    ],
  },
  {
    key: 'afterSales',
    label: '售后',
    labelEn: 'After-sales',
    kind: 'body',
    rows: [
      { key: 'refundOrder', label: 'Refund Order', labelEn: 'Refund Order', format: 'number' },
      { key: 'refundGmv', label: 'Refund GMV', labelEn: 'Refund GMV', format: 'money' },
      { key: 'cancelledOrder', label: 'Cancelled Order', labelEn: 'Cancelled Order', format: 'number' },
      { key: 'cancelledSales', label: 'Cancelled Sales', labelEn: 'Cancelled Sales', format: 'money' },
    ],
  },
  {
    key: 'advertising',
    label: '广告',
    labelEn: 'Advertising',
    kind: 'body',
    rows: [
      { key: 'adsExpense', label: 'Ads Expense', labelEn: 'Ads Expense', format: 'money' },
      { key: 'adsImpressions', label: 'Ads View', labelEn: 'Ads View', format: 'number' },
      { key: 'adsClicks', label: 'Ads Click', labelEn: 'Ads Click', format: 'number' },
      { key: 'adsCtr', label: 'Ads CTR', labelEn: 'Ads CTR', format: 'percent' },
      { key: 'adsCpc', label: 'Ads CPC', labelEn: 'Ads CPC', format: 'money' },
      { key: 'adsOrders', label: 'Ads Order', labelEn: 'Ads Order', format: 'number' },
      { key: 'adsGmv', label: 'Ads GMV', labelEn: 'Ads GMV', format: 'money' },
      { key: 'adsRoas', label: 'Ads ROI', labelEn: 'Ads ROI', format: 'number' },
      { key: 'adsOrderShare', label: 'Ads Order/Total Order', labelEn: 'Ads Order Share', format: 'percent' },
    ],
  },
  {
    key: 'affiliate',
    label: '联盟营销',
    labelEn: 'Affiliate marketing',
    kind: 'body',
    rows: [
      { key: 'affiliateGmv', label: 'AMS GMV', labelEn: 'AMS GMV', format: 'money' },
      { key: 'affiliateOrders', label: 'AMS Order', labelEn: 'AMS Order', format: 'number' },
      { key: 'affiliateCommission', label: 'AMS Commission', labelEn: 'AMS Commission', format: 'money' },
      { key: 'affiliateRoas', label: 'AMS ROI', labelEn: 'AMS ROI', format: 'number' },
      { key: 'affiliateFreeSamples', label: 'AMS Free Sample', labelEn: 'AMS Free Sample', format: 'number' },
      { key: 'affiliateContentViews', label: 'AMS Content Views', labelEn: 'AMS Content Views', format: 'number' },
      { key: 'affiliateContentViewers', label: 'AMS Content Viewers', labelEn: 'AMS Content Viewers', format: 'number' },
      { key: 'affiliateProductClicks', label: 'AMS Product Clicks', labelEn: 'AMS Product Clicks', format: 'number' },
    ],
  },
];

/**
 * Metrics that need a source that has not been filled in to show anything.
 *
 * The wording says where the figures come from and how to get them, because
 * a reader looking at a blank row should not have to work out whether the
 * data is missing because it was never fetched or because it was fetched
 * and came back empty.
 */
const SOURCE_LABELS = {
  visitor: '店铺访客数据（Business Insights，来自 Brand Portal）',
  productViews: '店铺访客数据（Business Insights，来自 Brand Portal）',
  productClicks: '店铺访客数据（Business Insights，来自 Brand Portal）',
  ctr: '店铺访客数据（Business Insights，来自 Brand Portal）',
  conversionRate: '店铺访客数据（Business Insights，来自 Brand Portal）',
  adsExpense: '广告数据（Shopee 广告接口，按天）',
  adsImpressions: '广告数据（Shopee 广告接口，按天）',
  adsClicks: '广告数据（Shopee 广告接口，按天）',
  adsCtr: '广告数据（Shopee 广告接口，按天）',
  adsCpc: '广告数据（Shopee 广告接口，按天）',
  adsOrders: '广告数据（Shopee 广告接口，按天）',
  adsGmv: '广告数据（Shopee 广告接口，按天）',
  adsRoas: '广告数据（Shopee 广告接口，按天）',
  adsOrderShare: '广告数据（Shopee 广告接口，按天）',
  affiliateGmv: '联盟营销数据（卖家中心导出）',
  affiliateOrders: '联盟营销数据（卖家中心导出）',
  affiliateCommission: '联盟营销数据（卖家中心导出）',
  affiliateRoas: '联盟营销数据（卖家中心导出）',
  affiliateFreeSamples: '联盟营销数据（卖家中心导出）',
  affiliateContentViews: '联盟营销数据（卖家中心导出）',
  affiliateContentViewers: '联盟营销数据（卖家中心导出）',
  affiliateProductClicks: '联盟营销数据（卖家中心导出）',
  refundOrder: '退货数据（ERP 退货接口）',
  refundGmv: '退货数据（ERP 退货接口）',
  shopRating: '店铺健康（ERP 店铺表现接口）',
  returnRefundRate: '店铺健康（ERP 店铺表现接口）',
  cancellationRate: '店铺健康（ERP 店铺表现接口）',
  lateShipmentRate: '店铺健康（ERP 店铺表现接口）',
  csatRate: '店铺健康（ERP 店铺表现接口）',
  gmv: '销售额（店铺营业额报表，来自 Brand Portal）',
  cancelledSales: '销售额（店铺营业额报表，来自 Brand Portal）',
  liveSessions: '直播表现（Brand Portal 直播接口）',
  liveHours: '直播表现（Brand Portal 直播接口）',
  liveViews: '直播表现（Brand Portal 直播接口）',
  liveViewers: '直播表现（Brand Portal 直播接口）',
  liveConfirmedOrders: '直播表现（Brand Portal 直播接口）',
  liveConfirmedSales: '直播表现（Brand Portal 直播接口）',
};

/**
 * What to do about a source that is not filled in. The two gaps have
 * different remedies, and the page says which is which.
 */
const SOURCE_ACTIONS = {
  '店铺访客数据（Business Insights，来自 Brand Portal）':
    '在「店铺诊断」页点击「连接 Brand Portal」完成授权后，同步与回填会自动带出访客、点击与转化率。',
  '销售额（店铺营业额报表，来自 Brand Portal）':
    '在「店铺诊断」页点击「连接 Brand Portal」完成授权后，同步与回填会自动带出销售额。',
  '退货数据（ERP 退货接口）':
    '在「店铺诊断」页点击「连接 ERP」完成授权后，同步与回填会自动带出退货数据。',
  '直播表现（Brand Portal 直播接口）':
    '在「店铺诊断」页点击「连接 Brand Portal」完成授权后，同步与回填会自动带出直播时长、观看与直播成交额。',
  '店铺健康（ERP 店铺表现接口）':
    '在「店铺接口」页点击「连接 ERP」完成授权后，同步会带出店铺评分与履约质量（发货时效、取消率、退货退款率、客服满意率）。',
  '广告数据（Shopee 广告接口，按天）':
    '在「广告诊断」页同步广告数据后，这里会带出曝光、点击、花费、成交与投产比。',
  '联盟营销数据（卖家中心导出）':
    '在卖家中心导出联盟营销（Ads & Affiliate）报表并导入，这里会带出联盟带来的曝光、成交、佣金与投产比。',
};

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function divide(numerator, denominator) {
  if (numerator === null || denominator === null) return null;
  if (!denominator) return null;
  return numerator / denominator;
}

/**
 * Turn one raw day into the metric values the table shows.
 *
 * `bi` is the shop's own reporting row and `orders` is what the order
 * records say. Where both exist for the same number they are kept apart
 * rather than blended, because they do not measure quite the same thing:
 * the shop total counts everything the shop sold, the order records count
 * what was actually placed. The reader is shown the shop total when there
 * is one and falls back to the order records otherwise.
 */
function buildDayMetrics(row = {}, sources = {}) {
  // A source that has nothing in it at all is not a day of zero. The
  // flags say whether the source has been filled in for this shop, which is
  // a different question from whether it has anything for a particular day.
  const shopReportFilled = sources.shopReport !== false;
  const returnsFilled = sources.returns !== false;
  const livestreamFilled = sources.livestream !== false;
  const shopHealthFilled = sources.shopHealth !== false;
  // The affiliate figures come from a report read out of the seller centre,
  // so until that has been read there is nothing to say — which is not the
  // same as saying the affiliate brought nothing.
  const affiliateFilled = sources.affiliate !== false;
  // Orders may be recorded with a number and a state but no amount, in
  // which case there is no sales figure to report.
  const orderAmountsFilled = sources.orderAmounts !== false;

  const biSales = shopReportFilled ? toNumber(row.sales) : null;
  const biOrders = shopReportFilled ? toNumber(row.orders) : null;
  const orderGmv = orderAmountsFilled ? toNumber(row.orderGmv) : null;
  const paidOrders = toNumber(row.paidOrders);

  const gmv = biSales !== null ? biSales : orderGmv;
  const order = biOrders !== null ? biOrders : paidOrders;

  const productViews = shopReportFilled ? toNumber(row.productViews) : null;
  const productClicks = shopReportFilled ? toNumber(row.productClicks) : null;
  const visitor = shopReportFilled ? toNumber(row.uniqueVisitors) : null;

  const reportedConversion = shopReportFilled ? toNumber(row.orderConversionRate) : null;
  const conversionRate = reportedConversion !== null
    ? reportedConversion
    : divide(order, visitor);

  return {
    visitor,
    productViews,
    productClicks,
    ctr: divide(productClicks, productViews),
    order,
    conversionRate,
    gmv,
    refundOrder: returnsFilled ? toNumber(row.refundOrders) : null,
    refundGmv: returnsFilled ? toNumber(row.refundAmount) : null,
    cancelledOrder: toNumber(row.cancelledOrders),
    cancelledSales: orderAmountsFilled ? toNumber(row.cancelledSales) : null,
    adsExpense: toNumber(row.adsExpense),
    adsImpressions: toNumber(row.adsImpressions),
    adsClicks: toNumber(row.adsClicks),
    adsGmv: toNumber(row.adsGmv),
    adsOrders: toNumber(row.adsOrders),
    adsCtr: divide(toNumber(row.adsClicks), toNumber(row.adsImpressions)),
    adsCpc: divide(toNumber(row.adsExpense), toNumber(row.adsClicks)),
    adsRoas: divide(toNumber(row.adsGmv), toNumber(row.adsExpense)),
    adsOrderShare: divide(toNumber(row.adsOrders), order),
    affiliateGmv: affiliateFilled ? toNumber(row.affiliateGmv) : null,
    affiliateOrders: affiliateFilled ? toNumber(row.affiliateOrders) : null,
    affiliateUnits: affiliateFilled ? toNumber(row.affiliateUnits) : null,
    affiliateContentViews: affiliateFilled ? toNumber(row.affiliateContentViews) : null,
    affiliateContentViewers: affiliateFilled ? toNumber(row.affiliateContentViewers) : null,
    affiliateProductClicks: affiliateFilled ? toNumber(row.affiliateProductClicks) : null,
    affiliateCommission: affiliateFilled ? toNumber(row.affiliateCommission) : null,
    affiliateFreeSamples: affiliateFilled ? toNumber(row.affiliateFreeSamples) : null,
    affiliateRoas: affiliateFilled
      ? divide(toNumber(row.affiliateGmv), toNumber(row.affiliateCommission)) : null,
    shopRating: shopHealthFilled ? toNumber(row.shopRating) : null,
    returnRefundRate: shopHealthFilled ? toNumber(row.returnRefundRate) : null,
    cancellationRate: shopHealthFilled ? toNumber(row.cancellationRate) : null,
    lateShipmentRate: shopHealthFilled ? toNumber(row.lateShipmentRate) : null,
    csatRate: shopHealthFilled ? toNumber(row.csatRate) : null,
    responseRate: shopHealthFilled ? toNumber(row.responseRate) : null,
    preparationTime: shopHealthFilled ? toNumber(row.preparationTime) : null,
    liveSessions: livestreamFilled ? toNumber(row.liveSessions) : null,
    liveHours: livestreamFilled ? toNumber(row.liveHours) : null,
    liveViews: livestreamFilled ? toNumber(row.liveViews) : null,
    liveViewers: livestreamFilled ? toNumber(row.liveViewers) : null,
    liveConfirmedOrders: livestreamFilled ? toNumber(row.liveConfirmedOrders) : null,
    liveConfirmedSales: livestreamFilled ? toNumber(row.liveConfirmedSales) : null,
  };
}

/**
 * Change against the day before. A rise is positive, a fall negative.
 *
 * When either side is missing the change is unknown rather than zero, and
 * when the earlier day was zero the change is unknown too — a jump from
 * nothing is not a percentage.
 */
function computeChange(current, previous) {
  if (current === null || current === undefined) return null;
  if (previous === null || previous === undefined) return null;
  if (previous === 0) return null;
  return (current - previous) / Math.abs(previous);
}

/**
 * Build the table body: metric rows in display order, each holding one
 * value per day, plus the change row for the two headline numbers.
 */
function buildFunnelRows(dailyRows = [], sources = {}) {
  const days = dailyRows.map(row => ({
    eventDate: String(row.eventDate).slice(0, 10),
    metrics: buildDayMetrics(row, sources),
  }));

  const rows = [];
  for (const group of METRIC_GROUPS) {
    for (const definition of group.rows) {
      if (group.kind === 'change') {
        const values = days.map((day, index) => {
          const current = day.metrics[definition.metric];
          const previous = index > 0 ? days[index - 1].metrics[definition.metric] : null;
          return computeChange(current, previous);
        });
        rows.push({
          key: definition.key,
          label: definition.label,
          labelEn: definition.labelEn,
          group: group.key,
          groupLabel: group.label,
          groupLabelEn: group.labelEn,
          kind: 'change',
          format: 'percent',
          values,
        });
        continue;
      }

      const values = days.map(day => day.metrics[definition.key]);
      rows.push({
        key: definition.key,
        label: definition.label,
        labelEn: definition.labelEn,
        group: group.key,
        groupLabel: group.label,
        groupLabelEn: group.labelEn,
        kind: 'body',
        format: definition.format,
        values,
        source: SOURCE_LABELS[definition.key] || null,
      });
    }
  }

  return { dates: days.map(day => day.eventDate), rows };
}

/**
 * Which metrics have no source filled in. The page says so out loud rather
 * than leaving blank cells to be puzzling.
 */
function missingSources(rows = []) {
  const missing = new Map();
  for (const row of rows) {
    if (!row.source) continue;
    if (row.values.some(value => value !== null)) continue;
    missing.set(row.source, (missing.get(row.source) || []).concat(row.label));
  }
  return [...missing.entries()].map(([source, metrics]) => ({
    source,
    metrics,
    action: SOURCE_ACTIONS[source] || null,
  }));
}

module.exports = {
  METRIC_GROUPS,
  SOURCE_LABELS,
  SOURCE_ACTIONS,
  buildDayMetrics,
  buildFunnelRows,
  computeChange,
  divide,
  missingSources,
  toNumber,
};
