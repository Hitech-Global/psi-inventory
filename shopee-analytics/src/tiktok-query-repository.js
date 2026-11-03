'use strict';

/**
 * TikTok Shop 数据查询。
 *
 * 为什么单独一个 repository：落库层（tiktok-data-repository.js）只管写入，
 * 查询要处理另一类问题 —— 口径怎么呈现、缺失怎么说明。
 *
 * ★ 口径纪律（本文件最重要的约束）
 *   三个 GMV 口径互不推导，所以**不能**把它们加总成一个"总 GMV"：
 *     gmv_order_total  订单实付   —— 来自订单的实付总额
 *     gmv_subtotal     货款小计   —— 来自订单的货款小计，不含运费
 *     gmv_settled      结算收入   —— 只来自 finance 端点
 *   前两个同源（都来自订单的 payment 字段），第三个是独立来源。
 *   把它们相加会得出一个没有任何业务含义的数字 —— 页面宁可少给一个数，
 *   也不能给一个"看起来合理"的错数。
 *
 *   所以这里按口径**分行**返回：同一行里的每个金额列都是同一个口径下的数，
 *   页面按 attribution_basis 分组展示，绝不横向相加。
 *
 * ★ 缺失与零的区别
 *   「没有数据」和「数据是 0」是两件事，页面上必须能分开看。
 *   某天没有订单，是那天真的没订单，还是那天没同步过来？
 *   后者说明数据是缺的，不能被当成 0 来算转化率。所以 null 一律保持 null。
 */

/**
 * 平台无关模型里的口径常量（与 src/platform-model.js 保持一致）。
 * 这里不 require 整个 platform-model —— 查询层只需要这几个字符串，
 * 且它们同时被数据库 CHECK 约束兜着，写错了插入就会失败。
 */
const ATTRIBUTION_BASES = Object.freeze({
  ORDER_LEVEL: 'order_level',
  PLATFORM_ATTRIBUTED: 'platform_attributed',
  PAID_ONLY: 'paid_only',
  DERIVED_INCREMENTAL: 'derived_incremental',
  DERIVED_NET: 'derived_net',
  UNKNOWN: 'unknown',
});

/** 结算口径的来源：只有 finance 端点能给出结算收入。 */
const SETTLEMENT_SOURCE = 'finance_statement';

/**
 * 口径的中文说明。
 *
 * 页面必须把口径写在数字旁边 —— 读者看到"订单实付 12,000"时，
 * 应当知道这是订单口径，不是平台归因口径，更不是结算收入。
 * 否则同一天的两行不同口径的数会被当成同一个指标的两条记录。
 */
const BASIS_LABELS = Object.freeze({
  order_level: '订单实付口径',
  platform_attributed: '平台归因口径',
  paid_only: '纯付费口径',
  derived_incremental: '增量口径',
  derived_net: '净额口径',
  unknown: '口径未知',
});

/** 来源的中文说明。 */
const SOURCE_LABELS = Object.freeze({
  shop_order: '订单数据',
  shop_analytics: '店铺分析',
  gmv_max_report: 'GMV Max 报表',
  integrated_report: '整合报表',
  finance_statement: '结算账单',
});

/** 币种缺失时的占位。与落库层的 UNKNOWN_CURRENCY 一致。 */
const UNKNOWN_CURRENCY = 'UNKNOWN';

/**
 * 区域分组对应的时区。
 *
 * TikTok 的店铺档案里没有独立的 timezone 字段（Shopee 那边有），
 * 只有 region_group —— ROW（东南亚）或 US。所以按区域取时区。
 * ROW 覆盖多个时区，用 UTC+8（新加坡/马来西亚/菲律宾/西加里曼丹的多数区域）。
 */
const REGION_TIME_ZONES = Object.freeze({
  ROW: 'Asia/Singapore',
  US: 'America/Los_Angeles',
});

/**
 * 取某个区域分组的时区。未知区域回退到 ROW。
 *
 * @param {string} regionGroup
 * @returns {string}
 */
function regionTimeZone(regionGroup) {
  const key = String(regionGroup || 'ROW').trim().toUpperCase();
  return REGION_TIME_ZONES[key] || REGION_TIME_ZONES.ROW;
}

/**
 * 把 pg 返回的 NUMERIC 字符串转成 number。
 *
 * PostgreSQL 的 NUMERIC 通过 pg 驱动返回的是字符串（为了不丢精度）。
 * 直接参与 JS 运算会得到字符串拼接的结果，所以必须显式转换。
 * 空值保持 null —— 「没有」不能变成 0。
 *
 * @param {*} value
 * @returns {number|null}
 */
function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * 把 pg 返回的 DATE 转成 'YYYY-MM-DD'。
 *
 * pg 默认把 DATE 当 Date 对象返回，但时区会让它偏移一天 ——
 * 订单日期是业务日期，不能因为服务器时区不同而错位。
 * 所以按本地日期取值，而不是 toISOString()（那是 UTC）。
 *
 * @param {*} value
 * @returns {string|null}
 */
function toDateString(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string') return value.slice(0, 10);
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return String(value).slice(0, 10);
}

/**
 * 把日期区间参数规整成 [startDate, endDate]。
 *
 * 允许的格式是 'YYYY-MM-DD'。空值会让区间变成"全部"，
 * 但全部可能拖垮数据库 —— 所以给一个默认上限。
 *
 * @param {object} options
 * @returns {{startDate: string, endDate: string}}
 */
function resolveDateRange({ startDate, endDate, today = new Date(), maxDays = 93 } = {}) {
  const end = /^\d{4}-\d{2}-\d{2}$/.test(String(endDate || '').trim())
    ? String(endDate).trim()
    : toDateString(today);
  const start = /^\d{4}-\d{2}-\d{2}$/.test(String(startDate || '').trim())
    ? String(startDate).trim()
    : null;
  if (!start) {
    // 没给开始日期就回退 30 天 —— 足以看出趋势，又不至于把整张表扫一遍。
    const base = new Date(`${end}T00:00:00Z`);
    base.setUTCDate(base.getUTCDate() - 29);
    return { startDate: base.toISOString().slice(0, 10), endDate: end };
  }
  const span = (new Date(`${end}T00:00:00Z`) - new Date(`${start}T00:00:00Z`)) / 86400000;
  if (span > maxDays) {
    const base = new Date(`${end}T00:00:00Z`);
    base.setUTCDate(base.getUTCDate() - (maxDays - 1));
    return { startDate: base.toISOString().slice(0, 10), endDate: end };
  }
  return { startDate: start, endDate: end };
}

/**
 * TikTok 数据查询。
 */
class TikTokQueryRepository {
  /**
   * @param {object} options
   * @param {object} options.pool PostgreSQL 连接池
   */
  constructor({ pool }) {
    if (!pool || typeof pool.query !== 'function') throw new Error('pool is required');
    this.pool = pool;
  }

  /**
   * 已连接的 TikTok 店铺。
   *
   * 来源是 tiktok_shop_tokens —— 那是唯一能证明「这家店授权过」的地方。
   * 没有授权记录却出现在列表里的店铺，用户会以为是自己授权失败了，
   * 所以未授权的店不列出，而是由页面单独说明"尚未接入任何 TikTok 店铺"。
   *
   * @param {object} [options]
   * @returns {Promise<Array<object>>}
   */
  async listShops({ regionGroup = null } = {}) {
    const params = [];
    let where = '';
    if (regionGroup) {
      params.push(regionGroup);
      where = 'WHERE region_group = $1';
    }
    const result = await this.pool.query(
      `SELECT region_group AS "regionGroup",
              shop_id AS "shopId",
              MAX(updated_at) AS "connectedAt",
              MAX(expires_at) AS "expiresAt",
              COUNT(*)::int AS "tokenCount"
         FROM tiktok_shop_tokens
         ${where}
        GROUP BY region_group, shop_id
        ORDER BY region_group, shop_id`,
      params,
    );
    return result.rows.map((row) => ({
      regionGroup: row.regionGroup,
      // TikTok 的 shop_id 是字符串，不能转成数字 —— 超出 JS 安全整数范围会丢精度。
      shopId: String(row.shopId),
      connectedAt: row.connectedAt ? new Date(row.connectedAt).toISOString() : null,
      expiresAt: row.expiresAt ? new Date(row.expiresAt).toISOString() : null,
      tokenCount: row.tokenCount,
    }));
  }

  /**
   * 日粒度汇总 —— 按口径分行。
   *
   * ★ 每一行只属于一个口径。attribution_basis 与 source 在主键里，
   * 所以同一天的"订单口径"和"平台归因口径"天然是两行，不会互相覆盖。
   *
   * @param {object} options
   * @returns {Promise<Array<object>>}
   */
  async listDailySummary({ regionGroup, shopId, startDate, endDate } = {}) {
    if (!regionGroup) throw new Error('regionGroup is required');
    if (!shopId) throw new Error('shopId is required');
    const params = [regionGroup, String(shopId), startDate, endDate];
    const result = await this.pool.query(
      `SELECT event_date AS "eventDate",
              attribution_basis AS "attributionBasis",
              source,
              channel,
              currency,
              orders,
              units,
              spend,
              impressions,
              clicks,
              gmv_order_total AS "gmvOrderTotal",
              gmv_subtotal AS "gmvSubtotal",
              gmv_settled AS "gmvSettled",
              refunds,
              commission,
              shipping,
              cancellations,
              baseline_natural_gmv AS "baselineNaturalGmv",
              incremental_gmv AS "incrementalGmv"
         FROM tiktok_shop_daily
        WHERE region_group = $1
          AND shop_id = $2
          AND event_date BETWEEN $3::date AND $4::date
        ORDER BY event_date, attribution_basis, source, currency`,
      params,
    );
    return result.rows.map((row) => ({
      eventDate: toDateString(row.eventDate),
      attributionBasis: row.attributionBasis,
      attributionLabel: BASIS_LABELS[row.attributionBasis] || BASIS_LABELS.unknown,
      source: row.source,
      sourceLabel: SOURCE_LABELS[row.source] || row.source,
      channel: row.channel,
      currency: row.currency,
      orders: toNumber(row.orders),
      units: toNumber(row.units),
      spend: toNumber(row.spend),
      impressions: toNumber(row.impressions),
      clicks: toNumber(row.clicks),
      // ★ 三个口径分别返回，绝不在这里相加。
      gmvOrderTotal: toNumber(row.gmvOrderTotal),
      gmvSubtotal: toNumber(row.gmvSubtotal),
      gmvSettled: toNumber(row.gmvSettled),
      refunds: toNumber(row.refunds),
      commission: toNumber(row.commission),
      shipping: toNumber(row.shipping),
      cancellations: toNumber(row.cancellations),
      baselineNaturalGmv: toNumber(row.baselineNaturalGmv),
      incrementalGmv: toNumber(row.incrementalGmv),
    }));
  }

  /**
   * 店铺概览 —— 把日粒度按口径分别汇总。
   *
   * ★ 每个口径各自汇总，返回的是一个「按口径分的对象」，
   * 而不是「一个加总后的数字」。调用方要展示哪个口径就取哪个，
   * 不会因为多写了一行 SQL 就把口径混起来。
   *
   * @param {object} options
   * @returns {Promise<object>}
   */
  async getShopOverview({ regionGroup, shopId, startDate, endDate } = {}) {
    if (!regionGroup) throw new Error('regionGroup is required');
    if (!shopId) throw new Error('shopId is required');
    const params = [regionGroup, String(shopId), startDate, endDate];
    const result = await this.pool.query(
      `SELECT attribution_basis AS "attributionBasis",
              source,
              currency,
              COUNT(*)::int AS "dayCount",
              SUM(orders) AS orders,
              SUM(units) AS units,
              SUM(spend) AS spend,
              SUM(impressions) AS impressions,
              SUM(clicks) AS clicks,
              SUM(gmv_order_total) AS "gmvOrderTotal",
              SUM(gmv_subtotal) AS "gmvSubtotal",
              SUM(gmv_settled) AS "gmvSettled",
              SUM(refunds) AS refunds,
              SUM(commission) AS commission,
              SUM(shipping) AS shipping,
              SUM(cancellations) AS cancellations,
              SUM(incremental_gmv) AS "incrementalGmv",
              MIN(event_date) AS "firstDate",
              MAX(event_date) AS "lastDate"
         FROM tiktok_shop_daily
        WHERE region_group = $1
          AND shop_id = $2
          AND event_date BETWEEN $3::date AND $4::date
        GROUP BY attribution_basis, source, currency
        ORDER BY attribution_basis, source, currency`,
      params,
    );

    const byBasis = {};
    for (const row of result.rows) {
      const basis = row.attributionBasis;
      if (!byBasis[basis]) {
        byBasis[basis] = {
          attributionBasis: basis,
          attributionLabel: BASIS_LABELS[basis] || BASIS_LABELS.unknown,
          source: row.source,
          sourceLabel: SOURCE_LABELS[row.source] || row.source,
          currency: row.currency,
          dayCount: row.dayCount,
          orders: toNumber(row.orders),
          units: toNumber(row.units),
          spend: toNumber(row.spend),
          impressions: toNumber(row.impressions),
          clicks: toNumber(row.clicks),
          // ★ 三个口径各自独立汇总 —— 绝不加总成一个"总 GMV"。
          gmvOrderTotal: toNumber(row.gmvOrderTotal),
          gmvSubtotal: toNumber(row.gmvSubtotal),
          gmvSettled: toNumber(row.gmvSettled),
          refunds: toNumber(row.refunds),
          commission: toNumber(row.commission),
          shipping: toNumber(row.shipping),
          cancellations: toNumber(row.cancellations),
          incrementalGmv: toNumber(row.incrementalGmv),
          firstDate: toDateString(row.firstDate),
          lastDate: toDateString(row.lastDate),
        };
      }
    }
    return { shopId: String(shopId), regionGroup, startDate, endDate, byBasis };
  }

  /**
   * 商品销售概览。
   *
   * ★ 商品维度的金额只从订单侧来（gmv_order_total / gmv_subtotal），
   *   结算口径在商品级不存在 —— 所以这里不返回 gmvSettled。
   *
   * @param {object} options
   * @returns {Promise<Array<object>>}
   */
  async listProductSummary({ regionGroup, shopId, startDate, endDate, limit = 100 } = {}) {
    if (!regionGroup) throw new Error('regionGroup is required');
    if (!shopId) throw new Error('shopId is required');
    const params = [regionGroup, String(shopId), startDate, endDate, limit];
    const result = await this.pool.query(
      `SELECT items.product_id AS "productId",
              MAX(items.product_name) AS "productName",
              COUNT(DISTINCT items.order_id)::int AS "orderCount",
              SUM(items.quantity) AS units,
              SUM(items.quantity * items.unit_price) AS "grossAmount",
              SUM(items.discount_amount) AS discounts
         FROM tiktok_order_items items
         JOIN tiktok_orders orders
           ON orders.region_group = items.region_group
          AND orders.shop_id = items.shop_id
          AND orders.order_id = items.order_id
        WHERE items.region_group = $1
          AND items.shop_id = $2
          AND orders.order_date BETWEEN $3::date AND $4::date
        GROUP BY items.product_id
        ORDER BY units DESC NULLS LAST, "orderCount" DESC
        LIMIT $5`,
      params,
    );
    return result.rows.map((row) => ({
      productId: row.productId,
      productName: row.productName || `商品 ${row.productId}`,
      orderCount: row.orderCount,
      units: toNumber(row.units),
      grossAmount: toNumber(row.grossAmount),
      discounts: toNumber(row.discounts),
    }));
  }

  /**
   * 最近订单。
   *
   * @param {object} options
   * @returns {Promise<Array<object>>}
   */
  async listRecentOrders({ regionGroup, shopId, startDate, endDate, limit = 50 } = {}) {
    if (!regionGroup) throw new Error('regionGroup is required');
    if (!shopId) throw new Error('shopId is required');
    const params = [regionGroup, String(shopId), startDate, endDate, limit];
    const result = await this.pool.query(
      `SELECT order_id AS "orderId",
              order_status AS "orderStatus",
              attribution_basis AS "attributionBasis",
              channel,
              currency,
              order_date AS "orderDate",
              units,
              gmv_order_total AS "gmvOrderTotal",
              gmv_subtotal AS "gmvSubtotal",
              gmv_settled AS "gmvSettled",
              shipping_fee AS "shippingFee"
         FROM tiktok_orders
        WHERE region_group = $1
          AND shop_id = $2
          AND order_date BETWEEN $3::date AND $4::date
        ORDER BY order_date DESC, order_id DESC
        LIMIT $5`,
      params,
    );
    return result.rows.map((row) => ({
      orderId: row.orderId,
      orderStatus: row.orderStatus,
      attributionBasis: row.attributionBasis,
      attributionLabel: BASIS_LABELS[row.attributionBasis] || BASIS_LABELS.unknown,
      channel: row.channel,
      currency: row.currency,
      orderDate: toDateString(row.orderDate),
      units: toNumber(row.units),
      gmvOrderTotal: toNumber(row.gmvOrderTotal),
      gmvSubtotal: toNumber(row.gmvSubtotal),
      // 订单级恒为 null（数据库 CHECK 约束保证），这里仍原样返回以示口径纪律。
      gmvSettled: toNumber(row.gmvSettled),
      shippingFee: toNumber(row.shippingFee),
    }));
  }

  /**
   * 数据覆盖情况 —— 让页面能说清「哪些数据还没有」。
   *
   * 一个店铺授权了但从没同步过，和同步过但某天缺数据，是两回事。
   * 页面必须能分开说，否则用户会以为"没数据 = 没生意"。
   *
   * @param {object} options
   * @returns {Promise<object>}
   */
  async getDataCoverage({ regionGroup, shopId, startDate, endDate } = {}) {
    if (!regionGroup) throw new Error('regionGroup is required');
    if (!shopId) throw new Error('shopId is required');
    const params = [regionGroup, String(shopId), startDate, endDate];
    const result = await this.pool.query(
      `SELECT (SELECT COUNT(*)::int FROM tiktok_orders
                WHERE region_group = $1 AND shop_id = $2
                  AND order_date BETWEEN $3::date AND $4::date) AS "orderCount",
              (SELECT COUNT(*)::int FROM tiktok_products
                WHERE region_group = $1 AND shop_id = $2) AS "productCount",
              (SELECT COUNT(DISTINCT event_date)::int FROM tiktok_shop_daily
                WHERE region_group = $1 AND shop_id = $2
                  AND event_date BETWEEN $3::date AND $4::date) AS "coveredDayCount",
              (SELECT COUNT(*)::int FROM tiktok_sync_state
                WHERE region_group = $1 AND shop_id = $2) AS "syncStateCount",
              (SELECT MIN(order_date) FROM tiktok_orders
                WHERE region_group = $1 AND shop_id = $2) AS "firstOrderDate",
              (SELECT MAX(order_date) FROM tiktok_orders
                WHERE region_group = $1 AND shop_id = $2) AS "lastOrderDate"`,
      params,
    );
    const row = result.rows[0] || {};
    return {
      orderCount: row.orderCount ?? 0,
      productCount: row.productCount ?? 0,
      coveredDayCount: row.coveredDayCount ?? 0,
      syncStateCount: row.syncStateCount ?? 0,
      firstOrderDate: toDateString(row.firstOrderDate),
      lastOrderDate: toDateString(row.lastOrderDate),
      startDate,
      endDate,
    };
  }
}

module.exports = {
  ATTRIBUTION_BASES,
  BASIS_LABELS,
  REGION_TIME_ZONES,
  SETTLEMENT_SOURCE,
  SOURCE_LABELS,
  TikTokQueryRepository,
  UNKNOWN_CURRENCY,
  regionTimeZone,
  resolveDateRange,
  toDateString,
  toNumber,
};
