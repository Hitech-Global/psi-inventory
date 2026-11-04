'use strict';

/**
 * TikTok 广告数据同步。
 * ============================================================================================
 * 拉两张报表，分别落成两种口径：
 *
 *   GMV Max 报表 → platform_attributed（平台归因）
 *     cost 与 gross_revenue 出自同一张报表，两者相除就是平台面板上的 ROI。
 *     ★ 但 gross_revenue **含自然流量** —— 所以它不能当纯付费分母用。
 *
 *   整合报表 → paid_only（纯付费）
 *     spend / impressions / clicks 是真正的付费侧数据，
 *     可以与 Shopee 的付费侧指标横向比较。
 *
 * ★ 两张报表落到 tiktok_shop_daily 的不同行
 *   同一张表，主键含 attribution_basis 与 source ——
 *   所以同一天的"平台归因"与"纯付费"天然是两行，不会互相覆盖，
 *   也不会被误当成同一个数相加。
 *
 * ★ 分窗拉取
 *   两张报表的跨度上限都是 30 天。要更长的区间就得按窗口分段，
 *   每段各自翻页 —— 这是 API 的硬限制，不是我们的选择。
 *
 * ★ 单个广告主失败不中断整批
 *   一个广告主撤了授权、或者它的店铺没投过广告，都不该让其他广告主的数据也拉不到。
 */

const { resolveMarketingEndpoint } = require('./tiktok-catalog');
const { mapGmvMaxRow, mapIntegratedRow } = require('./platforms/tiktok-adapter');
const { TikTokMarketingClient } = require('./tiktok-marketing-client');
const { isExpired } = require('./tiktok-marketing-token-repository');

/** 报表跨度上限：30 天。API 的硬限制。 */
const MAX_WINDOW_DAYS = 30;

/** 一次拉一页的条数上限。 */
const PAGE_SIZE = 1000;

/** GMV Max 报表要的指标。 */
const GMV_MAX_METRICS = Object.freeze([
  'cost',
  'gross_revenue',
  'orders',
  'product_impressions',
  'product_clicks',
]);

/** 整合报表要的指标（纯付费漏斗）。 */
const INTEGRATED_METRICS = Object.freeze([
  'spend',
  'impressions',
  'clicks',
  'conversion',
  'total_purchase_value',
]);

/**
 * 算出一个日期区间需要分成几个窗口。
 *
 * @param {object} options
 * @returns {Array<{startDate: string, endDate: string}>}
 */
function splitIntoWindows({ startDate, endDate, maxDays = MAX_WINDOW_DAYS }) {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error('invalid date range');
  }
  if (start > end) throw new Error('startDate must be <= endDate');

  const windows = [];
  let cursor = new Date(start);
  while (cursor <= end) {
    const windowEnd = new Date(cursor);
    windowEnd.setUTCDate(windowEnd.getUTCDate() + maxDays - 1);
    const bounded = windowEnd > end ? new Date(end) : windowEnd;
    windows.push({
      startDate: cursor.toISOString().slice(0, 10),
      endDate: bounded.toISOString().slice(0, 10),
    });
    cursor = new Date(bounded);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return windows;
}

/**
 * 从报表响应里取出数据行。
 *
 * TikTok 的报表响应形状不完全一致：list / rows / data.list 都可能。
 * 这里把几种都认一遍 —— 认错了会静默地拉不到数据。
 *
 * @param {object} data 响应的 data 字段
 * @returns {Array<object>}
 */
function extractRows(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.list)) return data.list;
  if (Array.isArray(data.rows)) return data.rows;
  if (data.data && Array.isArray(data.data.list)) return data.data.list;
  if (data.data && Array.isArray(data.data.rows)) return data.data.rows;
  return [];
}

/**
 * 一行报表里的 metrics 与 dimensions。
 *
 * 报表响应里，每一行是 { dimensions: {...}, metrics: {...} } 的形状，
 * 但也有把两者平铺在一起的变体。
 *
 * @param {object} row
 * @returns {{metrics: object, dimensions: object}}
 */
function splitRow(row = {}) {
  if (row && typeof row === 'object' && (row.metrics || row.dimensions)) {
    return {
      metrics: row.metrics && typeof row.metrics === 'object' ? row.metrics : {},
      dimensions: row.dimensions && typeof row.dimensions === 'object' ? row.dimensions : {},
    };
  }
  // 平铺的情况：按前缀猜 —— stat_time_day 是日期，currency 是币种，其余算指标。
  const metrics = {};
  const dimensions = {};
  for (const [key, value] of Object.entries(row || {})) {
    if (key === 'stat_time_day' || key === 'date' || key === 'currency' || key === 'store_id') {
      dimensions[key] = value;
    } else {
      metrics[key] = value;
    }
  }
  return { metrics, dimensions };
}

/**
 * 取一行里的日期。
 *
 * @param {object} dimensions
 * @returns {string|null}
 */
function readDate(dimensions = {}) {
  const raw = dimensions.stat_time_day || dimensions.date || dimensions.stat_time;
  if (!raw) return null;
  // 报表的日期是 'YYYY-MM-DD' 或时间戳，统一成日期。
  const text = String(raw);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

/**
 * TikTok 广告同步。
 */
class TikTokMarketingSyncRunner {
  /**
   * @param {object} options
   * @param {object} options.pool
   * @param {object} options.tokenRepository
   * @param {object} [options.dataRepository] 落库用；不给就用 tiktok-data-repository 的实现
   * @param {object} [options.client]
   * @param {object} [options.env]
   * @param {Function} [options.now]
   */
  constructor({
    pool,
    tokenRepository,
    dataRepository = null,
    client = null,
    env = process.env,
    fetchImpl = global.fetch,
    now = () => new Date(),
  }) {
    if (!pool || typeof pool.query !== 'function') throw new Error('pool is required');
    if (!tokenRepository) throw new Error('tokenRepository is required');
    this.pool = pool;
    this.tokenRepository = tokenRepository;
    this.env = env;
    this.fetch = fetchImpl;
    this.now = now;
    this.client = client || new TikTokMarketingClient({ fetchImpl });
    if (!dataRepository) {
      const { TikTokDataRepository } = require('./tiktok-data-repository');
      this.dataRepository = new TikTokDataRepository({ pool });
    } else {
      this.dataRepository = dataRepository;
    }
  }

  /**
   * 同步一个广告主的广告数据。
   *
   * @param {object} options
   * @param {string} options.advertiserId
   * @param {Array<string>} options.storeIds 关联的店铺 ID（TikTok 的 shop_id）
   * @param {string} options.shopCipher     店铺 cipher（与 shop_id 成对）
   * @param {string} options.regionGroup
   * @param {string} options.startDate
   * @param {string} options.endDate
   * @returns {Promise<object>} 同步摘要
   */
  async syncAdvertiser({
    advertiserId,
    storeIds = [],
    shopCipher,
    regionGroup = 'ROW',
    startDate,
    endDate,
  }) {
    if (!advertiserId) throw new Error('advertiserId is required');
    if (!shopCipher) throw new Error('shopCipher is required: cipher and shop id are a pair');
    if (!startDate || !endDate) throw new Error('startDate and endDate are required');

    const appId = this.appId();
    const credential = await this.tokenRepository.load({ appId, advertiserId });
    if (!credential) {
      const error = new Error(`No marketing credential for advertiser ${advertiserId}`);
      error.code = 'TIKTOK_MARKETING_CREDENTIAL_MISSING';
      throw error;
    }
    // 过期就刷新一次 —— 24 小时的 token 很容易在同步时刚好过期。
    let accessToken = credential.accessToken;
    if (isExpired(credential.expiresAt, this.now().getTime())) {
      accessToken = await this._refreshAccessToken({ appId, advertiserId, credential });
    }

    const windows = splitIntoWindows({ startDate, endDate });
    const summary = {
      advertiserId,
      windows: windows.length,
      gmvMaxRows: 0,
      integratedRows: 0,
      written: 0,
      errors: [],
    };

    for (const window of windows) {
      // ★ 两张报表分别拉、分别落。它们的口径不同，绝不能混成一批。
      try {
        const gmvMax = await this._fetchAll({
          fetchOne: (page) => this.client.gmvMaxReport({
            accessToken,
            advertiserId,
            storeIds,
            metrics: GMV_MAX_METRICS,
            dimensions: ['stat_time_day'],
            startDate: window.startDate,
            endDate: window.endDate,
            page,
            pageSize: PAGE_SIZE,
          }),
        });
        summary.gmvMaxRows += gmvMax.length;
        summary.written += await this._persistGmvMax({
          rows: gmvMax,
          regionGroup,
          shopId: (storeIds[0] || advertiserId),
          shopCipher,
        });
      } catch (error) {
        summary.errors.push({ report: 'gmv_max', window, message: error.message });
      }

      try {
        const integrated = await this._fetchAll({
          fetchOne: (page) => this.client.integratedReport({
            accessToken,
            advertiserId,
            metrics: INTEGRATED_METRICS,
            dimensions: ['stat_time_day'],
            startDate: window.startDate,
            endDate: window.endDate,
            page,
            pageSize: PAGE_SIZE,
          }),
        });
        summary.integratedRows += integrated.length;
        summary.written += await this._persistIntegrated({
          rows: integrated,
          regionGroup,
          shopId: (storeIds[0] || advertiserId),
          shopCipher,
        });
      } catch (error) {
        summary.errors.push({ report: 'integrated', window, message: error.message });
      }
    }

    return summary;
  }

  /**
   * 同步所有已授权的广告主。
   *
   * ★ 单个广告主失败不中断整批 —— 一个撤了授权不该让其他广告主也拉不到。
   *
   * @param {object} options
   * @returns {Promise<object>}
   */
  async syncAll({ storeIdsByAdvertiser = {}, startDate, endDate, regionGroup = 'ROW' }) {
    const appId = this.appId();
    const advertisers = await this.tokenRepository.listAdvertisers({ appId });
    const summaries = [];
    for (const entry of advertisers) {
      const mapping = storeIdsByAdvertiser[entry.advertiserId] || {};
      try {
        summaries.push(await this.syncAdvertiser({
          advertiserId: entry.advertiserId,
          storeIds: mapping.storeIds || [],
          shopCipher: mapping.shopCipher,
          regionGroup: mapping.regionGroup || regionGroup,
          startDate,
          endDate,
        }));
      } catch (error) {
        summaries.push({
          advertiserId: entry.advertiserId,
          ok: false,
          error: error.message,
          written: 0,
        });
      }
    }
    return {
      advertiserCount: advertisers.length,
      okCount: summaries.filter(item => !item.error).length,
      failedCount: summaries.filter(item => item.error).length,
      written: summaries.reduce((sum, item) => sum + (item.written || 0), 0),
      summaries,
    };
  }

  /**
   * 翻页拉完一个窗口。
   *
   * @param {object} options
   * @returns {Promise<Array<object>>}
   */
  async _fetchAll({ fetchOne }) {
    const rows = [];
    let page = 1;
    // 上限是防御性的：分页出问题时不能无限拉下去。
    for (let guard = 0; guard < 100; guard += 1) {
      const data = await fetchOne(page);
      const pageRows = extractRows(data);
      rows.push(...pageRows);
      const total = Number(data && (data.page_info?.total_page || data.total_page || data.page_count) || 0);
      if (!pageRows.length) break;
      if (total && page >= total) break;
      if (pageRows.length < PAGE_SIZE) break;
      page += 1;
    }
    return rows;
  }

  /**
   * 落 GMV Max 报表（平台归因口径）。
   *
   * @param {object} options
   * @returns {Promise<number>} 写入行数
   */
  async _persistGmvMax({ rows, regionGroup, shopId, shopCipher }) {
    const factRows = [];
    for (const row of rows) {
      const { metrics, dimensions } = splitRow(row);
      const eventDate = readDate(dimensions);
      if (!eventDate) continue;
      const fact = mapGmvMaxRow({ metrics, dimensions });
      factRows.push({
        region_group: regionGroup,
        shop_id: String(shopId),
        shop_cipher: shopCipher,
        event_date: eventDate,
        attribution_basis: fact.attributionBasis,
        source: fact.source,
        channel: fact.channel,
        currency: fact.currency || 'UNKNOWN',
        orders: fact.orders,
        units: fact.units,
        spend: fact.spend,
        impressions: fact.impressions,
        clicks: fact.clicks,
        // ★ 平台归因口径的 GMV 落在 gmv_order_total，货款小计与结算收入都是 null ——
        //   平台归因的 GMV 不是货款小计，也不是结算收入。
        gmv_order_total: fact.gmvOrderTotal,
        gmv_subtotal: fact.gmvSubtotal,
        gmv_settled: fact.gmvSettled,
        refunds: fact.refunds,
        commission: fact.commission,
        shipping: fact.shipping,
        cancellations: fact.cancellations,
        baseline_natural_gmv: fact.baselineNaturalGmv,
        incremental_gmv: fact.incrementalGmv,
        raw_json: JSON.stringify(row),
      });
    }
    if (!factRows.length) return 0;
    await this.dataRepository.upsertShopDaily({ rows: factRows });
    return factRows.length;
  }

  /**
   * 落整合报表（纯付费口径）。
   *
   * @param {object} options
   * @returns {Promise<number>} 写入行数
   */
  async _persistIntegrated({ rows, regionGroup, shopId, shopCipher }) {
    const factRows = [];
    for (const row of rows) {
      const { metrics, dimensions } = splitRow(row);
      const eventDate = readDate(dimensions);
      if (!eventDate) continue;
      const fact = mapIntegratedRow({ metrics, dimensions });
      factRows.push({
        region_group: regionGroup,
        shop_id: String(shopId),
        shop_cipher: shopCipher,
        event_date: eventDate,
        attribution_basis: fact.attributionBasis,
        source: fact.source,
        channel: fact.channel,
        currency: fact.currency || 'UNKNOWN',
        orders: fact.orders,
        units: fact.units,
        spend: fact.spend,
        impressions: fact.impressions,
        clicks: fact.clicks,
        // ★ 纯付费口径没有 GMV —— 整合报表给的是花费与漏斗，
        //   它的 GMV 在另一个口径的行里。这里必须留 null，不能拿花费反推。
        gmv_order_total: fact.gmvOrderTotal,
        gmv_subtotal: fact.gmvSubtotal,
        gmv_settled: fact.gmvSettled,
        refunds: fact.refunds,
        commission: fact.commission,
        shipping: fact.shipping,
        cancellations: fact.cancellations,
        baseline_natural_gmv: fact.baselineNaturalGmv,
        incremental_gmv: fact.incrementalGmv,
        raw_json: JSON.stringify(row),
      });
    }
    if (!factRows.length) return 0;
    await this.dataRepository.upsertShopDaily({ rows: factRows });
    return factRows.length;
  }

  /**
   * 刷新一次凭据并返回新的 access token。
   *
   * @param {object} options
   * @returns {Promise<string>}
   */
  async _refreshAccessToken({ appId, advertiserId, credential }) {
    const { TikTokMarketingOAuthService } = require('./tiktok-marketing-oauth-service');
    const service = new TikTokMarketingOAuthService({
      tokenRepository: this.tokenRepository,
      env: this.env,
      fetchImpl: this.fetch,
      now: this.now,
    });
    await service.refresh({ appId, advertiserId });
    const refreshed = await this.tokenRepository.load({ appId, advertiserId });
    if (!refreshed || !refreshed.accessToken) {
      throw new Error(`Marketing token refresh produced no credential for advertiser ${advertiserId}`);
    }
    return refreshed.accessToken;
  }

  /** 应用 ID。 */
  appId() {
    const value = String(this.env.TIKTOK_MARKETING_APP_ID || '').trim();
    if (!value) throw new Error('TIKTOK_MARKETING_APP_ID is required');
    return value;
  }
}

module.exports = {
  GMV_MAX_METRICS,
  INTEGRATED_METRICS,
  MAX_WINDOW_DAYS,
  PAGE_SIZE,
  TikTokMarketingSyncRunner,
  extractRows,
  readDate,
  splitIntoWindows,
  splitRow,
};
