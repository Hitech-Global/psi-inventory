'use strict';

/**
 * TikTok Shop 同步服务。
 * ============================================================================================
 * 负责把 TikTok 的订单、商品、结算与广告数据取回来，落原始快照，
 * 并映射成平台无关的中间模型。
 *
 * 与 Shopee 同步（src/sync-service.js）的差异
 * -------------------------------------------
 *   - 店铺标识是 (shop_id, shop_cipher) 二元组。cipher 只在授权时从
 *     Get Authorized Shops 取得，之后随请求带上。**绝不能猜、不能复用别的店的。**
 *   - 响应结构不统一：订单在 `orders`、商品在 `products`、报表在 `list`，
 *     所以每个端点要指定自己的数组路径。
 *   - 三个 GMV 口径分别落库：订单实付、货款小计、结算收入。
 *
 * 只读约束：本服务只调用查询类端点，不发起任何写操作。
 */

const { TikTokClient } = require('./tiktok-client');
const { ENDPOINTS, resolveEndpoint } = require('./tiktok-catalog');
const {
  mapGmvMaxRow,
  mapIntegratedRow,
  mapOrder,
  mapStatementRow,
} = require('./platforms/tiktok-adapter');
const {
  DEFAULT_BASELINE_WINDOW_DAYS,
  TikTokBaselineCollector,
  computeIncrementalByProduct,
} = require('./tiktok-baseline-collector');
const { fingerprintRequest } = require('./raw-snapshot');
const { ATTRIBUTION_BASES, CHANNELS, PLATFORMS } = require('./platform-model');

/**
 * 计算两个 ISO 日期之间的天数（含首尾）。
 */
function daysInclusive(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00Z`).getTime();
  const end = new Date(`${endDate}T00:00:00Z`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;
  return Math.floor((end - start) / 86400000) + 1;
}

/**
 * 拆成不超过 spanMaxDays 的时间窗。
 *
 * TikTok 的报表端点带 stat_time_day 维度时跨度不得超过 30 天，超限会报
 * `max time span is 30 days`。这里在客户端侧先拆好，避免把错误留给平台。
 */
function splitDateRange(startDate, endDate, spanMaxDays = 30) {
  const total = daysInclusive(startDate, endDate);
  if (total <= 0) return [];
  if (total <= spanMaxDays) return [{ startDate, endDate }];

  const windows = [];
  let cursor = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  while (cursor <= end) {
    const windowEnd = new Date(cursor.getTime() + (spanMaxDays - 1) * 86400000);
    const clamped = windowEnd > end ? end : windowEnd;
    windows.push({
      startDate: cursor.toISOString().slice(0, 10),
      endDate: clamped.toISOString().slice(0, 10),
    });
    cursor = new Date(clamped.getTime() + 86400000);
  }
  return windows;
}

class TikTokSyncService {
  constructor({ pool, client, repository = null, env = process.env, fetchImpl = global.fetch } = {}) {
    if (!pool || typeof pool.query !== 'function') throw new Error('pool is required');
    this.pool = pool;
    this.client = client;
    this.repository = repository;
    this.env = env;
    this.fetchImpl = fetchImpl;
  }

  /**
   * 取一个店铺的凭据。
   *
   * @param {object} options
   * @param {string} options.appKey
   * @param {string} options.regionGroup
   * @param {string} options.shopId
   * @returns {Promise<object>} 含 accessToken 与 shopCipher 的凭据
   */
  async loadCredentials({ appKey, regionGroup, shopId }) {
    const result = await this.pool.query(
      `SELECT shop_cipher, token_blob, token_iv, token_tag
       FROM tiktok_shop_tokens
       WHERE app_key=$1 AND region_group=$2 AND shop_id=$3`,
      [appKey, regionGroup, shopId],
    );
    const row = result.rows[0];
    if (!row) {
      const error = new Error(`No TikTok credential stored for shop ${shopId}`);
      error.code = 'TIKTOK_CREDENTIAL_MISSING';
      throw error;
    }
    const { decryptTokenBundle } = require('./token-crypto');
    const bundle = decryptTokenBundle({
      tokenBlob: row.token_blob,
      tokenIv: row.token_iv,
      tokenTag: row.token_tag,
    }, require('./token-crypto').loadMasterKey(this.env));

    return {
      accessToken: bundle.accessToken,
      refreshToken: bundle.refreshToken,
      // cipher 与 shop_id 是配对的：这里只取回该店自己的 cipher。
      shopCipher: row.shop_cipher,
    };
  }

  /**
   * 记录原始快照。
   */
  async recordSnapshot({ endpointKey, shopId, shopCipher, advertiserId = null, requestJson = {}, responseJson = {}, eventDateFrom = null, eventDateTo = null }) {
    await this.pool.query(
      `INSERT INTO tiktok_raw_api_snapshots
       (region_group, endpoint_key, shop_id, shop_cipher, advertiser_id,
        event_date_from, event_date_to, request_fingerprint, request_json, response_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        String(this.env.TIKTOK_REGION_GROUP || 'ROW').trim().toUpperCase(),
        endpointKey,
        shopId || null,
        shopCipher || null,
        advertiserId,
        eventDateFrom,
        eventDateTo,
        fingerprintRequest(requestJson),
        JSON.stringify(requestJson),
        JSON.stringify(responseJson),
      ],
    );
  }

  /**
   * 同步订单。
   *
   * @param {object} options
   * @param {string} options.shopId
   * @param {string} options.startDate
   * @param {string} options.endDate
   * @returns {Promise<object>} 同步摘要
   */
  async syncOrders({ shopId, startDate, endDate }) {
    const credentials = await this.loadCredentials({
      appKey: String(this.env.TIKTOK_APP_KEY || '').trim(),
      regionGroup: this.regionGroup(),
      shopId,
    });
    const endpoint = resolveEndpoint('orderSearch');

    const facts = [];
    let pageToken = null;
    let pageIndex = 0;

    for (;;) {
      const body = {
        ...(pageToken ? { page_token: pageToken } : {}),
        page_size: 100,
        start_date: startDate,
        end_date: endDate,
        time_zone: 'UTC',
      };
      const data = await this.client.request({
        path: endpoint.path,
        method: endpoint.method,
        accessToken: credentials.accessToken,
        requiresShopCipher: endpoint.requiresShopCipher,
        shopCipher: credentials.shopCipher,
        body,
      });

      await this.recordSnapshot({
        endpointKey: 'orderSearch',
        shopId,
        shopCipher: credentials.shopCipher,
        requestJson: body,
        responseJson: data,
        eventDateFrom: startDate,
        eventDateTo: endDate,
      });

      const orders = Array.isArray(data.orders) ? data.orders : [];
      for (const order of orders) facts.push(mapOrder({ order }));

      const nextToken = data.next_page_token || null;
      pageIndex += 1;
      // 异常页保护：token 重复说明平台没推进，继续拉只会拿到同一页。
      if (!nextToken) break;
      if (nextToken === pageToken) break;
      pageToken = nextToken;
      if (pageIndex > 1000) break;
    }

    return { endpointKey: 'orderSearch', shopId, count: facts.length, facts };
  }

  /**
   * 同步商品。
   */
  async syncProducts({ shopId }) {
    const credentials = await this.loadCredentials({
      appKey: String(this.env.TIKTOK_APP_KEY || '').trim(),
      regionGroup: this.regionGroup(),
      shopId,
    });
    const endpoint = resolveEndpoint('productSearch');

    const products = [];
    let pageToken = null;
    let pageIndex = 0;

    for (;;) {
      const body = {
        ...(pageToken ? { page_token: pageToken } : {}),
        page_size: 100,
      };
      const data = await this.client.request({
        path: endpoint.path,
        method: endpoint.method,
        accessToken: credentials.accessToken,
        requiresShopCipher: endpoint.requiresShopCipher,
        shopCipher: credentials.shopCipher,
        body,
      });

      await this.recordSnapshot({
        endpointKey: 'productSearch',
        shopId,
        shopCipher: credentials.shopCipher,
        requestJson: body,
        responseJson: data,
      });

      const items = Array.isArray(data.products) ? data.products : [];
      products.push(...items);

      const nextToken = data.next_page_token || null;
      pageIndex += 1;
      if (!nextToken) break;
      if (nextToken === pageToken) break;
      pageToken = nextToken;
      if (pageIndex > 1000) break;
    }

    return { endpointKey: 'productSearch', shopId, count: products.length, products };
  }

  /**
   * 同步结算流水（净收益的数据来源）。
   */
  async syncStatements({ shopId, startDate, endDate }) {
    const credentials = await this.loadCredentials({
      appKey: String(this.env.TIKTOK_APP_KEY || '').trim(),
      regionGroup: this.regionGroup(),
      shopId,
    });
    const endpoint = resolveEndpoint('statements');

    const rows = [];
    let pageToken = null;
    let pageIndex = 0;

    for (;;) {
      const query = {
        ...(pageToken ? { page_token: pageToken } : {}),
        page_size: 100,
        statement_time_start: startDate,
        statement_time_end: endDate,
      };
      const data = await this.client.request({
        path: endpoint.path,
        accessToken: credentials.accessToken,
        requiresShopCipher: endpoint.requiresShopCipher,
        shopCipher: credentials.shopCipher,
        query,
      });

      await this.recordSnapshot({
        endpointKey: 'statements',
        shopId,
        shopCipher: credentials.shopCipher,
        requestJson: query,
        responseJson: data,
        eventDateFrom: startDate,
        eventDateTo: endDate,
      });

      const items = Array.isArray(data.statement_list) ? data.statement_list
        : (Array.isArray(data.statements) ? data.statements : []);
      rows.push(...items);

      const nextToken = data.next_page_token || null;
      pageIndex += 1;
      if (!nextToken) break;
      if (nextToken === pageToken) break;
      pageToken = nextToken;
      if (pageIndex > 1000) break;
    }

    const facts = rows.map(row => mapStatementRow({ row }));
    return { endpointKey: 'statements', shopId, count: facts.length, facts };
  }

  /**
   * 同步 GMV Max 广告报表（平台归因口径，含自然流量）。
   */
  async syncGmvMaxReport({ shopId, storeId, advertiserId, accessToken, startDate, endDate }) {
    const windows = splitDateRange(startDate, endDate, 30);
    const facts = [];

    for (const window of windows) {
      const query = {
        advertiser_id: advertiserId,
        store_ids: JSON.stringify([storeId]),
        start_date: window.startDate,
        end_date: window.endDate,
        metrics: JSON.stringify(['cost', 'orders', 'gross_revenue', 'roi', 'product_impressions', 'product_clicks']),
        dimensions: JSON.stringify(['stat_time_day']),
      };
      const data = await this.client.request({
        path: '/open_api/v1.3/gmv_max/report/get/',
        accessToken,
        query,
      });

      await this.recordSnapshot({
        endpointKey: 'gmvMaxReport',
        shopId,
        shopCipher: null,
        advertiserId,
        requestJson: query,
        responseJson: data,
        eventDateFrom: window.startDate,
        eventDateTo: window.endDate,
      });

      const list = Array.isArray(data.list) ? data.list : [];
      for (const row of list) {
        facts.push(mapGmvMaxRow({ metrics: row.metrics || {}, dimensions: row.dimensions || {} }));
      }
    }

    return { endpointKey: 'gmvMaxReport', shopId, count: facts.length, facts };
  }

  /**
   * 端到端算增量 GMV：GMV Max 归因 GMV 减去自然基线。
   *
   * 这是 TikTok 侧唯一能表达「广告贡献」的量。归因 GMV 含自然流量，
   * 直接拿它当广告成果会高估；基线来自 Analytics 的非直播 GMV 滚动窗口。
   *
   * @param {object} options
   * @param {string} options.shopId
   * @param {string} options.shopCipher 该店自己的 cipher
   * @param {string} options.shopAccessToken Shop API 的令牌
   * @param {string} options.advertiserAccessToken Marketing API 的令牌（与上面是两套凭据）
   * @param {string} options.advertiserId
   * @param {string} options.storeId
   * @param {string} options.startDate
   * @param {string} options.endDate
   * @param {number} [options.windowDays] 基线窗口天数
   * @returns {Promise<object>} 增量结果
   */
  async syncIncrementalGmv({
    shopId,
    shopCipher,
    shopAccessToken,
    advertiserAccessToken,
    advertiserId,
    storeId,
    startDate,
    endDate,
    windowDays = DEFAULT_BASELINE_WINDOW_DAYS,
  }) {
    // 1) GMV Max 归因（按商品与日期）
    const attributedByProduct = new Map();
    const spendByProduct = new Map();
    const windows = splitDateRange(startDate, endDate, 30);

    for (const window of windows) {
      const query = {
        advertiser_id: advertiserId,
        store_ids: JSON.stringify([storeId]),
        start_date: window.startDate,
        end_date: window.endDate,
        metrics: JSON.stringify(['cost', 'gross_revenue']),
        dimensions: JSON.stringify(['stat_time_day', 'item_id']),
      };
      const data = await this.client.request({
        path: '/open_api/v1.3/gmv_max/report/get/',
        accessToken: advertiserAccessToken,
        query,
      });
      await this.recordSnapshot({
        endpointKey: 'gmvMaxReport',
        shopId,
        shopCipher: null,
        advertiserId,
        requestJson: query,
        responseJson: data,
        eventDateFrom: window.startDate,
        eventDateTo: window.endDate,
      });

      const list = Array.isArray(data.list) ? data.list : [];
      for (const row of list) {
        const metrics = row.metrics || {};
        const dimensions = row.dimensions || {};
        // item_id 是 GMV Max 的商品维度；缺失则无法按商品归因，跳过而不是归到未知桶。
        const itemId = dimensions.item_id !== undefined && dimensions.item_id !== null
          ? String(dimensions.item_id)
          : null;
        if (!itemId) continue;
        const revenue = Number(metrics.gross_revenue);
        const cost = Number(metrics.cost);
        if (Number.isFinite(revenue)) {
          attributedByProduct.set(itemId, (attributedByProduct.get(itemId) || 0) + revenue);
        }
        if (Number.isFinite(cost)) {
          spendByProduct.set(itemId, (spendByProduct.get(itemId) || 0) + cost);
        }
      }
    }

    // 2) 自然基线（Analytics 非直播 GMV 滚动窗口）
    const collector = new TikTokBaselineCollector({ client: this.client, env: this.env });
    const baseline = await collector.collectBaseline({
      accessToken: shopAccessToken,
      shopCipher,
      endDate,
      windowDays,
    });

    // 3) 相减
    const items = this.buildIncrementalFacts({
      attributedGmvByProduct: attributedByProduct,
      baselineSeries: baseline.series,
      windowSize: windowDays,
      spendByProduct,
    });

    return {
      endpointKey: 'incrementalGmv',
      shopId,
      count: items.length,
      items,
      baselineDays: baseline.dailyRecords.length,
      liveDays: baseline.dailyRecords.filter(record => record.hasLive).length,
    };
  }

  /**
   * 同步整合报表（纯付费漏斗）。
   */
  async syncIntegratedReport({ shopId, advertiserId, accessToken, startDate, endDate }) {
    const windows = splitDateRange(startDate, endDate, 30);
    const facts = [];

    for (const window of windows) {
      const query = {
        advertiser_id: advertiserId,
        report_type: 'BASIC',
        data_level: 'AUCTION_CAMPAIGN',
        start_date: window.startDate,
        end_date: window.endDate,
        metrics: JSON.stringify(['spend', 'impressions', 'clicks', 'conversions']),
        dimensions: JSON.stringify(['stat_time_day']),
      };
      const data = await this.client.request({
        path: '/open_api/v1.3/report/integrated/get/',
        accessToken,
        query,
      });

      await this.recordSnapshot({
        endpointKey: 'integratedReport',
        shopId,
        shopCipher: null,
        advertiserId,
        requestJson: query,
        responseJson: data,
        eventDateFrom: window.startDate,
        eventDateTo: window.endDate,
      });

      const list = Array.isArray(data.list) ? data.list : [];
      for (const row of list) {
        facts.push(mapIntegratedRow({ metrics: row.metrics || {}, dimensions: row.dimensions || {} }));
      }
    }

    return { endpointKey: 'integratedReport', shopId, count: facts.length, facts };
  }

  /**
   * 计算增量 GMV（TikTok 侧唯一能表达"广告贡献"的量）。
   *
   * @param {object} options
   * @param {Array<object>} options.attributedFacts GMV Max 事实
   * @param {Map<string, number[]>} options.baselineByItem 商品 → 自然 GMV 基线序列
   * @param {number} [options.windowSize] 基线窗口
   */
  /**
   * 计算增量 GMV（TikTok 侧唯一能表达"广告贡献"的量）。
   *
   * 数据来源是 Analytics 的两个端点：SKU 级 GMV 减去直播 GMV 得到非直播 GMV，
   * 再与 GMV Max 归因的 GMV 相减。详见 src/tiktok-baseline-collector.js。
   *
   * @param {object} options
   * @param {Map<string, number>} options.attributedGmvByProduct GMV Max 归因的 GMV（按商品）
   * @param {Map<string, number[]>} options.baselineSeries 商品 → 自然 GMV 基线序列
   * @param {number} [options.windowSize] 基线窗口天数
   * @param {Map<string, number>} [options.spendByProduct] 商品 → 广告花费
   * @returns {Array<object>} 每项含 productId / attributedGmv / baseline / incremental
   */
  buildIncrementalFacts({
    attributedGmvByProduct = new Map(),
    baselineSeries = new Map(),
    windowSize = DEFAULT_BASELINE_WINDOW_DAYS,
    spendByProduct = new Map(),
  }) {
    return computeIncrementalByProduct({
      attributedGmvByProduct,
      baselineSeries,
      windowDays: windowSize,
    }).map(item => ({
      ...item,
      spend: spendByProduct.has(item.productId) ? spendByProduct.get(item.productId) : null,
    }));
  }

  regionGroup() {
    const value = String(this.env.TIKTOK_REGION_GROUP || 'ROW').trim().toUpperCase();
    if (value !== 'ROW' && value !== 'US') {
      const error = new Error('TIKTOK_REGION_GROUP must be ROW or US');
      error.code = 'TIKTOK_UNSUPPORTED_REGION_GROUP';
      throw error;
    }
    return value;
  }
}

module.exports = {
  ATTRIBUTION_BASES,
  CHANNELS,
  DEFAULT_BASELINE_WINDOW_DAYS,
  PLATFORMS,
  TikTokBaselineCollector,
  TikTokSyncService,
  computeIncrementalByProduct,
  daysInclusive,
  splitDateRange,
};
