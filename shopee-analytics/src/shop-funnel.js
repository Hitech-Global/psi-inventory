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
    key: 'afterSales',
    label: '售后与广告',
    labelEn: 'After-sales and advertising',
    kind: 'body',
    rows: [
      { key: 'refundOrder', label: 'Refund Order', labelEn: 'Refund Order', format: 'number' },
      { key: 'refundGmv', label: 'Refund GMV', labelEn: 'Refund GMV', format: 'money' },
      { key: 'cancelledOrder', label: 'Cancelled Order', labelEn: 'Cancelled Order', format: 'number' },
      { key: 'cancelledSales', label: 'Cancelled Sales', labelEn: 'Cancelled Sales', format: 'money' },
      { key: 'adsExpense', label: 'Ads Expense', labelEn: 'Ads Expense', format: 'money' },
    ],
  },
];

/** Metrics that need a source that has not been filled in to show anything. */
const SOURCE_LABELS = {
  visitor: '店铺访客数据（Business Insights）',
  productViews: '店铺访客数据（Business Insights）',
  productClicks: '店铺访客数据（Business Insights）',
  ctr: '店铺访客数据（Business Insights）',
  conversionRate: '店铺访客数据（Business Insights）',
  refundOrder: '退货数据（Order API 的 return 记录）',
  refundGmv: '退货数据（Order API 的 return 记录）',
  gmv: '销售额（店铺营业额报表或订单金额）',
  cancelledSales: '销售额（店铺营业额报表或订单金额）',
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
  return [...missing.entries()].map(([source, metrics]) => ({ source, metrics }));
}

module.exports = {
  METRIC_GROUPS,
  SOURCE_LABELS,
  buildDayMetrics,
  buildFunnelRows,
  computeChange,
  divide,
  missingSources,
  toNumber,
};
