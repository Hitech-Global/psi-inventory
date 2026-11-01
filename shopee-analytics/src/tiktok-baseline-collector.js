'use strict';

/**
 * 增量 GMV 的基线采集。
 * ============================================================================================
 * 为什么需要它
 * ------------
 * TikTok 的 GMV Max 报表把**自然流量订单也算进归因 GMV**，所以报表里的数字不是广告带来的增量。
 * 官方给出的判断方法是：**比较商品 GMV Max 使用前后的总非直播 GMV**，用差额作为增量。
 *
 * 官方原文（东南亚 TikTok Shop 广告指南）：
 *   > 由于所推广商品产生的所有订单，包括来自自然内容和联盟的订单，都将计入 GMV Max。
 *   > 我们建议商家比较商品 GMV Max 使用前后的总非直播 GMV，以确定增量 GMV。
 *   > 请勿将商品 GMV Max 的 GMV 与 VSA/PSA 的广告 GMV 进行比较，因为这两个指标的归因方式不同。
 *
 * 数据来源
 * --------
 *   非直播 GMV = 店铺 SKU 级 GMV（Analytics SKU 端点） − 直播 GMV（Analytics LIVE 端点）
 *
 *   - SKU 端点：`/analytics/202509/shop_skus/performance`
 *     返回 id / product_id / gmv.amount / gmv.currency / sku_orders / units_sold
 *   - LIVE 端点：`/analytics/202609/shop_lives/performance`
 *     返回 live_stream_sessions[].sales_performance.live_gmv.amount
 *
 * 三个必须处理的现实问题
 * ----------------------
 *   1. **自然 GMV 本身会波动**（促销期后自然量下跌），单日差额不可靠
 *      → 基线用**滚动窗口**（默认 14 天）求均值，而不是当天值。
 *   2. **广告挤占自然量时差额为负**，这是真实信息，必须如实保留。
 *   3. **两个端点的口径不同**：LIVE 端点的 GMV 可能含平台货补，
 *      而官方提醒"Seller Center 的 GMV 不含货补，广告看板的 GMV 含货补"。
 *      → 基线只做**同源相减**（都用 Analytics 口径），绝不用广告看板的数去减。
 *
 * 只读约束：本模块只调用查询类端点。
 */

const { SOURCES } = require('./platform-model');

/** SKU 级 Analytics 端点。 */
const SKU_PERFORMANCE_PATH = '/analytics/202509/shop_skus/performance';
/** LIVE 级 Analytics 端点。 */
const LIVE_PERFORMANCE_PATH = '/analytics/202609/shop_lives/performance';

/** 基线默认窗口天数。 */
const DEFAULT_BASELINE_WINDOW_DAYS = 14;

/**
 * 取金额对象里的数值。
 *
 * Analytics 的金额字段是 `{ amount: "135.42", currency: "USD" }` 结构，
 * 而 GMV Max 报表是裸数字。两边都要能读。
 */
function readAmount(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    // 空字符串不是 0 —— Number('') 会得到 0，把"无数据"变成"金额为零"。
    const trimmed = value.trim();
    if (trimmed === '') return null;
    const number = Number(trimmed);
    return Number.isFinite(number) ? number : null;
  }
  if (typeof value === 'object') {
    const amount = value.amount;
    if (amount === null || amount === undefined) return null;
    return readAmount(amount);
  }
  return null;
}

/**
 * 取货币。
 */
function readCurrency(value) {
  if (!value || typeof value !== 'object') return null;
  const currency = value.currency;
  return currency ? String(currency) : null;
}

/**
 * 从 SKU 性能响应里提取「商品 → SKU 级 GMV」。
 *
 * 注意：SKU 级 GMV 是**店铺口径**（自然+付费+达人都含），
 * 减去直播部分后得到非直播 GMV。
 *
 * @param {object} payload 响应体的 data 字段
 * @returns {object} { skuGmvByProduct: Map, skuOrdersByProduct: Map, currency }
 */
function extractSkuGmv(payload) {
  const skuGmvByProduct = new Map();
  const skuOrdersByProduct = new Map();
  let currency = null;

  const skus = payload && Array.isArray(payload.skus) ? payload.skus : [];
  for (const sku of skus) {
    if (!sku) continue;
    const productId = sku.product_id !== undefined && sku.product_id !== null ? String(sku.product_id) : null;
    if (!productId) continue;

    const amount = readAmount(sku.gmv);
    if (amount !== null) {
      skuGmvByProduct.set(productId, (skuGmvByProduct.get(productId) || 0) + amount);
    }
    const orders = Number(sku.sku_orders);
    if (Number.isFinite(orders)) {
      skuOrdersByProduct.set(productId, (skuOrdersByProduct.get(productId) || 0) + orders);
    }
    if (!currency) currency = readCurrency(sku.gmv);
  }

  return { skuGmvByProduct, skuOrdersByProduct, currency };
}

/**
 * 从 LIVE 性能响应里提取直播 GMV 总额。
 *
 * @param {object} payload 响应体的 data 字段
 * @returns {object} { liveGmv, liveOrders, currency }
 */
function extractLiveGmv(payload) {
  let liveGmv = 0;
  let liveOrders = 0;
  let currency = null;
  let seen = false;

  const sessions = payload && Array.isArray(payload.live_stream_sessions)
    ? payload.live_stream_sessions
    : [];
  for (const session of sessions) {
    const sales = session && session.sales_performance;
    if (!sales) continue;
    const amount = readAmount(sales.live_gmv);
    if (amount !== null) {
      liveGmv += amount;
      seen = true;
    }
    const orders = Number(sales.live_attributed_orders);
    if (Number.isFinite(orders)) liveOrders += orders;
    if (!currency) currency = readCurrency(sales.live_gmv);
  }

  return { liveGmv: seen ? liveGmv : null, liveOrders: seen ? liveOrders : null, currency };
}

/**
 * 计算非直播 GMV（按商品）。
 *
 * 直播 GMV 是**店铺级**的，无法按商品拆分（直播是场次维度的）。
 * 因此：只有当店铺当天**没有直播**时，商品的非直播 GMV 才等于它的 SKU GMV。
 * 有直播时无法归因到商品 → 标记为不可用，而不是猜一个分配比例。
 *
 * @param {object} options
 * @param {Map<string, number>} options.skuGmvByProduct
 * @param {number|null} options.liveGmv 店铺当日直播 GMV
 * @returns {object} { byProduct: Map, liveGmv, hasLive }
 */
function computeNonLiveGmv({ skuGmvByProduct, liveGmv }) {
  const byProduct = new Map();
  const hasLive = liveGmv !== null && Number.isFinite(liveGmv) && liveGmv > 0;

  for (const [productId, amount] of skuGmvByProduct) {
    // 有直播时，直播 GMV 无法拆到商品 → 不可用。
    // 无直播时，SKU GMV 全部是非直播的。
    if (!hasLive) byProduct.set(productId, amount);
  }

  return { byProduct, liveGmv: hasLive ? liveGmv : null, hasLive };
}

/**
 * 建立商品的自然 GMV 基线序列。
 *
 * @param {object} options
 * @param {Array<object>} options.dailyRecords 按日期升序的记录，每条含
 *        { date, byProduct: Map<productId, nonLiveGmv> }
 * @param {number} [options.windowDays] 滚动窗口天数
 * @returns {Map<string, number[]>} 商品 → 自然 GMV 序列（按日期升序）
 */
function buildBaselineSeries({ dailyRecords = [], windowDays = DEFAULT_BASELINE_WINDOW_DAYS }) {
  const series = new Map();
  for (const record of dailyRecords) {
    if (!record || !record.byProduct) continue;
    for (const [productId, amount] of record.byProduct) {
      if (!series.has(productId)) series.set(productId, []);
      series.get(productId).push(amount);
    }
  }
  // 只保留最近窗口长度，且序列必须按日期升序（dailyRecords 已保证）。
  const limit = Math.max(1, windowDays);
  for (const [productId, values] of series) {
    if (values.length > limit) series.set(productId, values.slice(-limit));
  }
  return series;
}

/**
 * 按商品计算增量 GMV。
 *
 * @param {object} options
 * @param {Map<string, number>} options.attributedGmvByProduct GMV Max 归因的 GMV（按商品）
 * @param {Map<string, number[]>} options.baselineSeries 商品 → 自然 GMV 基线序列
 * @param {number} [options.windowDays] 滚动窗口天数
 * @returns {Array<object>} 每项含 productId / attributedGmv / baseline / incremental
 */
function computeIncrementalByProduct({ attributedGmvByProduct, baselineSeries, windowDays = DEFAULT_BASELINE_WINDOW_DAYS }) {
  const results = [];
  for (const [productId, attributedGmv] of attributedGmvByProduct) {
    const series = baselineSeries && baselineSeries.get ? baselineSeries.get(productId) : null;
    const window = series && series.length ? series.slice(-Math.max(1, windowDays)) : [];
    const baseline = window.length
      ? window.reduce((sum, value) => sum + Number(value), 0) / window.length
      : null;
    const incremental = baseline === null ? null : Number(attributedGmv) - baseline;
    results.push({
      productId,
      attributedGmv: Number(attributedGmv),
      baselineNaturalGmv: baseline,
      incrementalGmv: incremental,
      baselineSampleDays: window.length,
    });
  }
  return results;
}

/**
 * 基线采集器。负责拉两个 Analytics 端点并算出每日非直播 GMV。
 */
class TikTokBaselineCollector {
  constructor({ client, env = process.env, fetchImpl = global.fetch } = {}) {
    this.client = client;
    this.env = env;
    this.fetchImpl = fetchImpl;
  }

  /**
   * 拉一天的 SKU 级 GMV。
   */
  async fetchSkuGmv({ accessToken, shopCipher, startDate, endDate }) {
    const query = {
      start_date_ge: startDate,
      end_date_lt: endDate,
      page_size: 500,
      sort_field: 'gmv',
      sort_order: 'DESC',
    };
    const data = await this.client.request({
      path: SKU_PERFORMANCE_PATH,
      accessToken,
      requiresShopCipher: true,
      shopCipher,
      query,
    });
    return extractSkuGmv(data);
  }

  /**
   * 拉一天的直播 GMV。
   */
  async fetchLiveGmv({ accessToken, shopCipher, startDate, endDate }) {
    const query = {
      start_date_ge: startDate,
      end_date_lt: endDate,
      page_size: 500,
    };
    const data = await this.client.request({
      path: LIVE_PERFORMANCE_PATH,
      accessToken,
      requiresShopCipher: true,
      shopCipher,
      query,
    });
    return extractLiveGmv(data);
  }

  /**
   * 采集一天的非直播 GMV（按商品）。
   *
   * @param {object} options
   * @param {string} options.accessToken
   * @param {string} options.shopCipher
   * @param {string} options.date 目标日（YYYY-MM-DD）
   * @returns {Promise<object>} { date, byProduct, liveGmv, hasLive, currency }
   */
  async collectDailyNonLiveGmv({ accessToken, shopCipher, date }) {
    // 官方端点用左闭右开的日期区间，这里用 [date, date+1) 取当天。
    const nextDate = new Date(new Date(`${date}T00:00:00Z`).getTime() + 86400000)
      .toISOString().slice(0, 10);

    const sku = await this.fetchSkuGmv({
      accessToken, shopCipher, startDate: date, endDate: nextDate,
    });
    const live = await this.fetchLiveGmv({
      accessToken, shopCipher, startDate: date, endDate: nextDate,
    });

    const nonLive = computeNonLiveGmv({
      skuGmvByProduct: sku.skuGmvByProduct,
      liveGmv: live.liveGmv,
    });

    return {
      date,
      byProduct: nonLive.byProduct,
      liveGmv: nonLive.liveGmv,
      hasLive: nonLive.hasLive,
      currency: sku.currency || live.currency || null,
      skuOrdersByProduct: sku.skuOrdersByProduct,
      liveOrders: live.liveOrders,
    };
  }

  /**
   * 采集一段窗口的自然 GMV 基线序列。
   *
   * @param {object} options
   * @param {string} options.accessToken
   * @param {string} options.shopCipher
   * @param {string} options.endDate 窗口最后一天
   * @param {number} [options.windowDays] 窗口天数
   * @returns {Promise<object>} { series, dailyRecords }
   */
  async collectBaseline({ accessToken, shopCipher, endDate, windowDays = DEFAULT_BASELINE_WINDOW_DAYS }) {
    const dailyRecords = [];
    for (let offset = windowDays - 1; offset >= 0; offset -= 1) {
      const date = new Date(new Date(`${endDate}T00:00:00Z`).getTime() - offset * 86400000)
        .toISOString().slice(0, 10);
      const record = await this.collectDailyNonLiveGmv({ accessToken, shopCipher, date });
      dailyRecords.push(record);
    }
    const series = buildBaselineSeries({ dailyRecords, windowDays });
    return { series, dailyRecords };
  }
}

module.exports = {
  DEFAULT_BASELINE_WINDOW_DAYS,
  LIVE_PERFORMANCE_PATH,
  SKU_PERFORMANCE_PATH,
  SOURCES,
  TikTokBaselineCollector,
  buildBaselineSeries,
  computeIncrementalByProduct,
  computeNonLiveGmv,
  extractLiveGmv,
  extractSkuGmv,
  readAmount,
  readCurrency,
};
