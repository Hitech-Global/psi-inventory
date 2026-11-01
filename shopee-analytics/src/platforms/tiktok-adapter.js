'use strict';

/**
 * TikTok 数据 → 平台无关中间模型的映射。
 * ============================================================================================
 * 这一层是 M1 里最容易出错的地方，因为 TikTok 与 Shopee 的字段语义并不对齐：
 *
 *   - TikTok 的 GMV Max 报表把付费与自然流量**合并**在 gross_revenue / orders / roi 里，
 *     所以映射出来的 `gmv` 只能标 `platform_attributed`，不能标成 direct 语义；
 *   - TikTok 的 integrate 报表（spend / impressions / clicks / conversions）是**纯付费**，
 *     标 `paid_only`，可与 Shopee 的付费侧指标横向比较；
 *   - 订单侧三个 GMV 口径（订单实付 / 货款小计 / 结算收入）**分别落库、互不推导**；
 *   - 增量 GMV 需要自然基线，基线与增量一起保留，负增量如实呈现。
 *
 * 换算只在同一口径内进行：分子分母的 attributionBasis 不同就拒绝，
 * 这是防止「用混合归因的分子配纯付费分母得出看似合理实则错误的 ROAS」。
 */

const {
  ATTRIBUTION_BASES,
  CHANNELS,
  PLATFORMS,
  SOURCES,
} = require('../platform-model');

/**
 * 取第一个有值字段（Shopee 侧 metrics.js 的 pickMetric 是同一思路）。
 */
function pick(row, keys) {
  for (const key of keys) {
    const value = row ? row[key] : undefined;
    if (value === null || value === undefined || value === '') continue;
    return value;
  }
  return null;
}

/**
 * 取数值字段。
 */
function pickNumber(row, keys) {
  const value = pick(row, keys);
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * 把 TikTok 的订单行映射成中间模型的一条事实。
 *
 * 订单侧只能给出订单级的事实；流量来源在 TikTok 侧不存在（Open API 无该字段），
 * 所以 channel 恒为 unknown，attributionBasis 恒为 order_level —— 这如实反映了
 * 「拿不到订单级归因」，而不是假装能拿到。
 *
 * @param {object} options
 * @param {object} options.order TikTok 订单对象
 * @param {string} [options.contentType] 'live' / 'video' / 'product'
 * @returns {object} 中间模型事实
 */
function mapOrder({ order, contentType = null }) {
  const payment = (order && order.payment) || {};
  const lineItems = Array.isArray(order && order.line_items) ? order.line_items : [];

  const units = lineItems.reduce((sum, item) => {
    const quantity = Number(item && item.quantity);
    return sum + (Number.isFinite(quantity) ? quantity : 0);
  }, 0);

  return {
    platform: PLATFORMS.TIKTOK,
    // 订单级事实：TikTok 无订单级流量来源，channel 只能是 unknown。
    attributionBasis: ATTRIBUTION_BASES.ORDER_LEVEL,
    channel: CHANNELS.UNKNOWN,
    contentType,
    source: SOURCES.SHOP_ORDER,

    impressions: null,
    clicks: null,
    spend: null,

    orders: 1,
    units,

    // 三个 GMV 口径各自独立，绝不用其中一个覆盖另一个。
    gmvOrderTotal: pickNumber(payment, ['total_amount', 'totalAmount']),
    gmvSubtotal: pickNumber(payment, ['sub_total', 'subTotal']),
    gmvSettled: null, // 结算收入来自 finance 端点，不在订单里

    baselineNaturalGmv: null,
    incrementalGmv: null,

    refunds: null,
    cancellations: order && order.status === 'CANCELLED' ? 1 : null,
    commission: null,
    shipping: pickNumber(payment, ['shipping_fee', 'shippingFee']),
    currency: (order && order.currency) || null,
  };
}

/**
 * 把 GMV Max 报表的一行映射成中间模型事实。
 *
 * 关键：gross_revenue / orders / roi **全部含自然流量**，因此 basis 是 platform_attributed。
 * 绝不标成 direct 语义。
 *
 * @param {object} options
 * @param {object} options.metrics 报表行的 metrics 对象
 * @param {object} [options.dimensions] 报表行的 dimensions 对象
 * @returns {object}
 */
function mapGmvMaxRow({ metrics = {}, dimensions = {} } = {}) {
  const cost = pickNumber(metrics, ['cost', 'spend']);
  const grossRevenue = pickNumber(metrics, ['gross_revenue', 'grossRevenue']);
  const orders = pickNumber(metrics, ['orders']);

  return {
    platform: PLATFORMS.TIKTOK,
    attributionBasis: ATTRIBUTION_BASES.PLATFORM_ATTRIBUTED,
    channel: CHANNELS.UNKNOWN,
    contentType: null,
    // cost 与 gross_revenue 出自同一张 GMV Max 报表，因此同源时相除得到的
    // 就是平台面板上的 ROI；与整合报表的 spend 相除则无意义（来源检查会拦下）。
    source: SOURCES.GMV_MAX_REPORT,

    impressions: pickNumber(metrics, ['product_impressions', 'productImpressions']),
    clicks: pickNumber(metrics, ['product_clicks', 'productClicks']),
    spend: cost,

    orders,
    units: null,

    // 平台归因口径的 GMV：含自然流量，不可与纯付费分母混算。
    gmvOrderTotal: grossRevenue,
    gmvSubtotal: null,
    gmvSettled: null,

    baselineNaturalGmv: null,
    incrementalGmv: null,

    refunds: null,
    cancellations: null,
    commission: null,
    shipping: null,
    currency: dimensions && dimensions.currency ? String(dimensions.currency) : null,
  };
}

/**
 * 把整合报表（纯付费）的一行映射成中间模型事实。
 *
 * @param {object} options
 * @param {object} options.metrics
 * @param {object} [options.dimensions]
 * @returns {object}
 */
function mapIntegratedRow({ metrics = {}, dimensions = {} } = {}) {
  return {
    platform: PLATFORMS.TIKTOK,
    // 纯付费数据：可与 Shopee 的付费侧指标横向比较。
    attributionBasis: ATTRIBUTION_BASES.PAID_ONLY,
    channel: CHANNELS.UNKNOWN,
    contentType: null,
    source: SOURCES.INTEGRATED_REPORT,

    impressions: pickNumber(metrics, ['impressions']),
    clicks: pickNumber(metrics, ['clicks']),
    spend: pickNumber(metrics, ['spend']),

    // conversions 是平台归因的转化数，订单口径，不与 GMV Max 的 orders 混用。
    orders: pickNumber(metrics, ['conversions']),
    units: null,

    gmvOrderTotal: null,
    gmvSubtotal: null,
    gmvSettled: null,

    baselineNaturalGmv: null,
    incrementalGmv: null,

    refunds: null,
    cancellations: null,
    commission: null,
    shipping: null,
    currency: dimensions && dimensions.currency ? String(dimensions.currency) : null,
  };
}

/**
 * 把结算流水的一行映射成中间模型事实（结算净收益的数据来源）。
 *
 * @param {object} options
 * @param {object} options.row 结算流水行
 * @returns {object}
 */
function mapStatementRow({ row = {} } = {}) {
  const revenue = pickNumber(row, ['revenue_amount', 'revenueAmount', 'amount']);
  const commission = pickNumber(row, ['commission', 'platform_commission', 'platformCommission']);
  const shipping = pickNumber(row, ['shipping_fee', 'shippingFee']);
  const refund = pickNumber(row, ['refund_amount', 'refundAmount']);
  const affiliate = pickNumber(row, ['affiliate_commission', 'affiliateCommission']);

  return {
    platform: PLATFORMS.TIKTOK,
    attributionBasis: ATTRIBUTION_BASES.DERIVED_NET,
    channel: CHANNELS.UNKNOWN,
    contentType: null,
    source: SOURCES.FINANCE_STATEMENT,

    impressions: null,
    clicks: null,
    spend: null,

    orders: null,
    units: null,

    gmvOrderTotal: null,
    gmvSubtotal: null,
    gmvSettled: revenue,

    baselineNaturalGmv: null,
    incrementalGmv: null,

    refunds: refund,
    cancellations: null,
    commission: (commission || 0) + (affiliate || 0),
    shipping,
    currency: row.currency ? String(row.currency) : null,
  };
}

/**
 * 计算增量 GMV。
 *
 * 官方推荐的算法：用同商品的**非直播 GMV** 与 GMV Max 归因 GMV 相减。
 * 两个已知缺陷必须在这里处理：
 *   1. 自然 GMV 本身会波动（促销期后自然量下跌），单日增量不可靠 → 用滚动基线；
 *   2. 广告挤占自然量时增量可以为负 → 如实保留，不抹平。
 *
 * @param {object} options
 * @param {number|null} options.attributedGmv GMV Max 归因的 GMV
 * @param {number[]} options.baselineSeries 基线序列（自然 GMV），越靠后越近
 * @param {number} [options.windowSize] 基线窗口天数
 * @returns {object} 增量事实
 */
function buildIncrementalFact({ attributedGmv, baselineSeries = [], windowSize = 14 }) {
  const series = (baselineSeries || []).filter(value => Number.isFinite(Number(value)));
  const window = series.slice(-Math.max(1, windowSize));
  const baseline = window.length
    ? window.reduce((sum, value) => sum + Number(value), 0) / window.length
    : null;

  const attributed = Number.isFinite(Number(attributedGmv)) ? Number(attributedGmv) : null;
  const incremental = attributed !== null && baseline !== null ? attributed - baseline : null;

  return {
    platform: PLATFORMS.TIKTOK,
    attributionBasis: ATTRIBUTION_BASES.DERIVED_INCREMENTAL,
    channel: CHANNELS.UNKNOWN,
    contentType: null,
    // 增量由 GMV Max 归因 GMV 与自然基线相减得到，来源同 GMV Max 报表，
    // 因此与同来源的花费相除得到增量 ROAS。
    source: SOURCES.GMV_MAX_REPORT,

    impressions: null,
    clicks: null,
    spend: null,

    orders: null,
    units: null,

    gmvOrderTotal: null,
    gmvSubtotal: null,
    gmvSettled: null,

    // 基线与增量一起保留：基线可解释增量从哪来，负增量也有据可查。
    baselineNaturalGmv: baseline,
    incrementalGmv: incremental,

    refunds: null,
    cancellations: null,
    commission: null,
    shipping: null,
    currency: null,
  };
}

module.exports = {
  buildIncrementalFact,
  mapGmvMaxRow,
  mapIntegratedRow,
  mapOrder,
  mapStatementRow,
  pick,
  pickNumber,
};
