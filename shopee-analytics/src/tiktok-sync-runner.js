'use strict';

/**
 * TikTok Shop 增量同步 runner。
 * ============================================================================================
 * 这个 runner 负责把"取数 → 落库 → 推进游标"这三件事按正确的顺序做完，
 * 并且保证任何一家店铺出问题都不会连累其他店铺。
 *
 * TikTok 的增量不是时间戳增量
 * --------------------------
 * Shopee 侧可以按 `update_time` 往后拉，因为平台的增量查询本身就是时间维度。
 * TikTok 不是：订单搜索用的是 **page_token 游标分页** ——
 * 你给一个时间窗，平台在这个窗内翻页，页与页之间靠 `next_page_token` 串起来。
 * 这带来两个后果：
 *   1. "上次同步到哪儿"必须记 **page_token**，而不是一个时间戳；
 *   2. page_token 与时间窗是**绑定**的 —— 换了时间窗，旧 token 指向的是别的查询，
 *      拿它续传会拉到错的数据。因此游标里必须同时记时间窗。
 *
 * 断点续传
 * --------
 * 每页的处理顺序是**先落数据、再推进游标**：
 *   - 反过来的话，崩溃时游标已经指到下一页，而这一页的数据还没写进去 → 永久漏数据；
 *   - 现在这个顺序，崩溃时最坏是这一页被重新拉一次，
 *     而落库是幂等的（按业务主键覆盖写），重复拉不会产生重复行。
 *
 * 多店铺隔离
 * ----------
 * 一家店铺的凭据过期、cipher 不匹配、平台报错，都**不应该**让其他店铺同步不成。
 * Shopee 侧已经踩过这个坑（backfill-runner.js：某家店铺缺 timezone 时整批中断，
 * 结果一家店的问题让所有店都拿不到数据）。这里把隔离做在 runner 层：
 * 每家店铺单独 try/catch，失败只记进这家店铺的结果里。
 *
 * 限流
 * ----
 * 所有 API 调用都经过 client 的 withRateLimitRetry（TikTokClient.request 内部已接好），
 * 退避参数来自 loadTikTokRateLimitRetryOptions，**不重复造**一套。
 *
 * 只读约束：本模块只调用查询类端点，不发起任何写操作。
 */

const { TikTokClient } = require('./tiktok-client');
const { resolveEndpoint } = require('./tiktok-catalog');
const { splitDateRange } = require('./tiktok-sync-service');
const { fingerprintRequest } = require('./raw-snapshot');
const {
  TikTokDataRepository,
  TikTokSyncStateRepository,
  buildStatementDailyRows,
} = require('./tiktok-data-repository');
const { TikTokTokenRepository } = require('./tiktok-token-repository');
const { TikTokTokenManager, loadTikTokRateLimitRetryOptions } = require('./tiktok-token-manager');
const { loadMasterKey } = require('./token-crypto');

/** 可同步的数据源。key 是游标表里的 endpoint_key。 */
const SYNC_ENDPOINTS = Object.freeze({
  orders: { endpointKey: 'orderSearch', required: true, windowed: true },
  products: { endpointKey: 'productSearch', required: false, windowed: false },
  statements: { endpointKey: 'statements', required: false, windowed: true },
});

/** 默认要同步的数据源。 */
const DEFAULT_ENDPOINTS = Object.freeze(['orders', 'products', 'statements']);

/** 报表端点的跨度上限（天）。TikTok 的报表端点超过 30 天会报 max time span。 */
const DEFAULT_WINDOW_DAYS = 30;

/** 每页条数。与现有同步服务保持一致。 */
const DEFAULT_PAGE_SIZE = 100;

/**
 * 校验 ISO 日期。
 */
function isoDate(value, name) {
  const text = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(`${name} must be YYYY-MM-DD`);
  return text;
}

/**
 * TikTok 同步 runner。
 */
class TikTokSyncRunner {
  constructor({
    pool,
    client = null,
    env = process.env,
    dataRepository = null,
    syncStateRepository = null,
    tokenManager = null,
    tokenRepository = null,
    now = () => new Date(),
    windowDays = DEFAULT_WINDOW_DAYS,
    pageSize = DEFAULT_PAGE_SIZE,
    fetchImpl = global.fetch,
  }) {
    if (!pool || typeof pool.query !== 'function') throw new Error('pool is required');
    this.pool = pool;
    this.env = env;
    this.now = now;
    this.windowDays = windowDays;
    this.pageSize = pageSize;
    this.fetchImpl = fetchImpl;
    this.client = client || new TikTokClient({
      appKey: this.appKey(),
      appSecret: this.appSecret(),
      fetchImpl,
      // 所有 API 调用共用同一套退避参数。
      retryOptions: loadTikTokRateLimitRetryOptions(env),
    });
    this.dataRepository = dataRepository || new TikTokDataRepository({ pool });
    this.syncStateRepository = syncStateRepository || new TikTokSyncStateRepository({ pool });
    this.tokenRepository = tokenRepository || new TikTokTokenRepository({
      pool,
      masterKey: loadMasterKey(env),
    });
    this.tokenManager = tokenManager || new TikTokTokenManager({
      tokenRepository: this.tokenRepository,
      env,
      fetchImpl,
      retryOptions: loadTikTokRateLimitRetryOptions(env),
    });
  }

  appKey() {
    const value = String(this.env.TIKTOK_APP_KEY || '').trim();
    if (!value) throw new Error('TIKTOK_APP_KEY is required');
    return value;
  }

  appSecret() {
    const value = String(this.env.TIKTOK_APP_SECRET || '').trim();
    if (!value) throw new Error('TIKTOK_APP_SECRET is required');
    return value;
  }

  regionGroup() {
    const value = String(this.env.TIKTOK_REGION_GROUP || 'ROW').trim().toUpperCase();
    if (value !== 'ROW' && value !== 'US') {
      throw new Error('TIKTOK_REGION_GROUP must be ROW or US');
    }
    return value;
  }

  /**
   * 同步一家店铺。
   *
   * 每个数据源单独 try/catch：订单拉不到不影响商品快照，
   * 商品端点报错也不该把订单的结果一起作废。
   *
   * @param {object} options
   * @param {string} options.shopId
   * @param {string} options.startDate
   * @param {string} options.endDate
   * @param {Array<string>} [options.endpoints]
   * @param {(event: object) => void} [options.onProgress]
   * @returns {Promise<object>} 店铺级摘要
   */
  async runShop({ shopId, startDate, endDate, endpoints = DEFAULT_ENDPOINTS, onProgress = null }) {
    const id = String(shopId || '').trim();
    if (!id) throw new Error('shopId is required');
    const start = isoDate(startDate, 'startDate');
    const end = isoDate(endDate, 'endDate');
    if (start > end) throw new Error('startDate must be <= endDate');

    const regionGroup = this.regionGroup();
    const appKey = this.appKey();
    const summary = {
      shopId: id,
      regionGroup,
      startDate: start,
      endDate: end,
      ok: true,
      steps: [],
    };

    const emit = event => { if (onProgress) onProgress(event); };

    // 凭据（含 cipher）在这里取一次：cipher 与 shop_id 是配对的，
    // 后续所有请求都必须用这一对，不能各自去猜。
    let credentials = null;
    try {
      credentials = await this.tokenManager.getAccessToken({ appKey, regionGroup, shopId: id });
    } catch (error) {
      // 凭据拿不到，这家店这一步就没法做 —— 但不影响其他店。
      summary.ok = false;
      summary.steps.push({
        name: 'credentials',
        ok: false,
        required: true,
        error: error && error.message ? error.message : String(error),
      });
      emit({ type: 'step-complete', name: 'credentials', ok: false, required: true });
      summary.failedRequiredSteps = ['credentials'];
      summary.failedOptionalSteps = [];
      return summary;
    }

    const shopCipher = credentials.shopCipher;

    for (const name of endpoints) {
      const spec = SYNC_ENDPOINTS[name];
      if (!spec) {
        throw new Error(`unknown TikTok sync endpoint: ${name}`);
      }
      const startedAt = Date.now();
      emit({ type: 'step-start', name, required: spec.required });
      try {
        const result = await this.syncEndpoint({
          name,
          spec,
          shopId: id,
          shopCipher,
          accessToken: credentials.accessToken,
          regionGroup,
          startDate: start,
          endDate: end,
        });
        summary.steps.push({ name, ok: true, required: spec.required, ms: Date.now() - startedAt, result });
        emit({ type: 'step-complete', name, ok: true, required: spec.required });
      } catch (error) {
        summary.steps.push({
          name,
          ok: false,
          required: spec.required,
          ms: Date.now() - startedAt,
          error: error && error.message ? error.message : String(error),
        });
        emit({ type: 'step-complete', name, ok: false, required: spec.required });
        if (spec.required) summary.ok = false;
      }
    }

    summary.failedRequiredSteps = summary.steps
      .filter(step => step.required && step.ok === false)
      .map(step => step.name);
    summary.failedOptionalSteps = summary.steps
      .filter(step => step.required === false && step.ok === false)
      .map(step => step.name);
    return summary;
  }

  /**
   * 同步一批店铺。
   *
   * **单店失败不中断整批** —— 这是本 runner 存在的核心理由之一。
   * 每家店铺单独 try/catch，失败只记进它自己的摘要里。
   *
   * @param {object} options
   * @param {Array<string>} options.shopIds
   * @returns {Promise<object>} 批次摘要
   */
  async runAll({ shopIds = [], startDate, endDate, endpoints = DEFAULT_ENDPOINTS, onProgress = null }) {
    const summaries = [];
    for (const shopId of shopIds) {
      try {
        summaries.push(await this.runShop({ shopId, startDate, endDate, endpoints, onProgress }));
      } catch (error) {
        // runShop 内部已经把可预期的失败消化掉了；
        // 走到这里的是"这一家店彻底没法处理"（例如参数非法），记下来继续下一家。
        summaries.push({
          shopId: String(shopId),
          ok: false,
          steps: [{
            name: 'shop',
            ok: false,
            required: true,
            error: error && error.message ? error.message : String(error),
          }],
          failedRequiredSteps: ['shop'],
          failedOptionalSteps: [],
        });
        if (onProgress) onProgress({ type: 'step-complete', name: 'shop', ok: false, required: true });
      }
    }

    const failed = summaries.filter(summary => !summary.ok);
    return {
      shopCount: summaries.length,
      okShopCount: summaries.length - failed.length,
      failedShopCount: failed.length,
      summaries,
    };
  }

  /**
   * 同步一个数据源。
   *
   * @param {object} options
   * @returns {Promise<object>}
   */
  async syncEndpoint(options) {
    if (options.spec.windowed) return this.syncWindowed(options);
    return this.syncUnwindowed(options);
  }

  /**
   * 同步需要时间窗的数据源（订单、结算流水）。
   *
   * 时间窗按 30 天上限切分（与报表端点的跨度上限一致），每一窗独立走一遍游标。
   *
   * @param {object} options
   * @returns {Promise<object>}
   */
  async syncWindowed(options) {
    const windows = splitDateRange(options.startDate, options.endDate, this.windowDays);
    let count = 0;
    const windowResults = [];

    for (const window of windows) {
      const result = await this.syncWindow({ ...options, window });
      count += result.count;
      windowResults.push(result);
    }
    return { count, windows: windowResults };
  }

  /**
   * 同步单个时间窗。
   *
   * @param {object} options
   * @returns {Promise<object>}
   */
  async syncWindow(options) {
    const { name, spec, shopId, shopCipher, accessToken, regionGroup, window } = options;
    const endpointKey = spec.endpointKey;
    const endpoint = resolveEndpoint(endpointKey);

    const state = await this.syncStateRepository.getSyncState({
      regionGroup, endpointKey, shopId,
    });
    const cursor = (state && state.cursor) || {};

    // 这个窗已经完整同步过了 —— 跳过。
    // 增量同步的含义就是"只补没同步的部分"，不是"每次都重拉一遍"。
    if (cursor.completedThrough && cursor.completedThrough >= window.endDate) {
      return { window, skipped: 'ALREADY_COMPLETE', count: 0 };
    }

    // 同一个窗且有游标 → 从那儿接着翻。
    // 换了窗就必须从头发起：page_token 与查询绑定，跨窗复用会拉错数据。
    const resumeToken = (
      cursor.windowStart === window.startDate &&
      cursor.windowEnd === window.endDate &&
      cursor.pageToken
    ) ? cursor.pageToken : null;

    // 结算流水没有明细表可聚合，日汇总只能靠跨页累加。
    // 累加器放在游标里，断点续传时才能接上前面几页的金额。
    const accumulator = name === 'statements' ? this.readAccumulator(cursor) : null;
    let count = 0;

    try {
      await this.client.paginate({
        itemsPath: this.itemsPathFor(name),
        startPageToken: resumeToken,
        fetchPage: async ({ page_token }) => {
          const request = this.buildRequest({ name, endpoint, window, pageToken: page_token });
          const data = await this.client.request({
            path: endpoint.path,
            method: endpoint.method,
            accessToken,
            requiresShopCipher: endpoint.requiresShopCipher,
            shopCipher,
            query: request.query,
            body: request.body,
          });
          await this.recordSnapshot({
            endpointKey, shopId, shopCipher, request, data, window,
          });
          return data;
        },
        onPage: async ({ items, nextPageToken }) => {
          // 先落数据，再推进游标。顺序反了会在崩溃时永久漏掉这一页。
          count += await this.persistPage({
            name, shopId, shopCipher, regionGroup, items, window, accumulator,
          });
          await this.syncStateRepository.markSyncSuccess({
            regionGroup,
            endpointKey,
            shopId,
            cursor: {
              windowStart: window.startDate,
              windowEnd: window.endDate,
              pageToken: nextPageToken,
              completedThrough: cursor.completedThrough || null,
              accumulator: accumulator ? { days: accumulator.days } : null,
            },
          });
        },
      });
    } catch (error) {
      // 失败时保留游标（markSyncFailure 不覆盖 cursor_json），下次从断点继续。
      await this.syncStateRepository.markSyncFailure({
        regionGroup, endpointKey, shopId, error,
      });
      throw error;
    }

    // 整窗拉完：结算侧把累加出来的日汇总落库，然后这个窗标记为完成。
    if (accumulator) {
      await this.writeStatementDaily({ regionGroup, shopId, shopCipher, accumulator });
    }
    await this.syncStateRepository.markSyncSuccess({
      regionGroup,
      endpointKey,
      shopId,
      cursor: {
        windowStart: window.startDate,
        windowEnd: window.endDate,
        pageToken: null,
        completedThrough: window.endDate,
        accumulator: null,
      },
    });

    return { window, count };
  }

  /**
   * 同步不需要时间窗的数据源（商品当前状态）。
   *
   * @param {object} options
   * @returns {Promise<object>}
   */
  async syncUnwindowed(options) {
    const { name, spec, shopId, shopCipher, accessToken, regionGroup } = options;
    const endpointKey = spec.endpointKey;
    const endpoint = resolveEndpoint(endpointKey);

    const state = await this.syncStateRepository.getSyncState({ regionGroup, endpointKey, shopId });
    const cursor = (state && state.cursor) || {};
    const resumeToken = cursor.pageToken || null;
    let count = 0;

    try {
      await this.client.paginate({
        itemsPath: this.itemsPathFor(name),
        startPageToken: resumeToken,
        fetchPage: async ({ page_token }) => {
          const request = this.buildRequest({ name, endpoint, window: null, pageToken: page_token });
          const data = await this.client.request({
            path: endpoint.path,
            method: endpoint.method,
            accessToken,
            requiresShopCipher: endpoint.requiresShopCipher,
            shopCipher,
            query: request.query,
            body: request.body,
          });
          await this.recordSnapshot({
            endpointKey, shopId, shopCipher, request, data, window: null,
          });
          return data;
        },
        onPage: async ({ items, nextPageToken }) => {
          count += await this.persistPage({
            name, shopId, shopCipher, regionGroup, items, window: null, accumulator: null,
          });
          await this.syncStateRepository.markSyncSuccess({
            regionGroup,
            endpointKey,
            shopId,
            cursor: { pageToken: nextPageToken },
          });
        },
      });
    } catch (error) {
      await this.syncStateRepository.markSyncFailure({ regionGroup, endpointKey, shopId, error });
      throw error;
    }

    await this.syncStateRepository.markSyncSuccess({
      regionGroup,
      endpointKey,
      shopId,
      cursor: { pageToken: null },
    });
    return { count };
  }

  /**
   * 各端点的数组字段路径。
   */
  itemsPathFor(name) {
    if (name === 'orders') return 'orders';
    if (name === 'products') return 'products';
    // 结算流水两个字段名平台都用过，取第一个存在的。
    if (name === 'statements') return ['statement_list', 'statements'];
    throw new Error(`unknown TikTok sync endpoint: ${name}`);
  }

  /**
   * 构造请求参数。
   *
   * page_token 只在有值时带上：把 null 传给平台会被当成参数非法。
   */
  buildRequest({ name, endpoint, window, pageToken }) {
    if (name === 'orders') {
      return {
        query: {},
        body: {
          ...(pageToken ? { page_token: pageToken } : {}),
          page_size: this.pageSize,
          start_date: window.startDate,
          end_date: window.endDate,
          time_zone: 'UTC',
        },
      };
    }
    if (name === 'products') {
      return {
        query: {},
        body: {
          ...(pageToken ? { page_token: pageToken } : {}),
          page_size: this.pageSize,
        },
      };
    }
    if (name === 'statements') {
      return {
        query: {
          ...(pageToken ? { page_token: pageToken } : {}),
          page_size: this.pageSize,
          statement_time_start: window.startDate,
          statement_time_end: window.endDate,
        },
        body: undefined,
      };
    }
    throw new Error(`unknown TikTok sync endpoint: ${name}`);
  }

  /**
   * 落一页数据。
   *
   * @param {object} options
   * @returns {Promise<number>} 落库的行数
   */
  async persistPage({ name, shopId, shopCipher, regionGroup, items = [], window, accumulator }) {
    if (name === 'orders') {
      const written = await this.dataRepository.upsertOrders({
        regionGroup, shopId, shopCipher, orders: items,
      });
      // 日汇总由订单表重新聚合 —— 这样它永远与订单表一致，
      // 不会因为"只拉到一半"而出现一个看似完整的日汇总。
      await this.dataRepository.rebuildOrderDaily({
        regionGroup, shopId, shopCipher,
        startDate: window.startDate,
        endDate: window.endDate,
      });
      return written.orders;
    }
    if (name === 'products') {
      return this.dataRepository.upsertProducts({ regionGroup, shopId, shopCipher, products: items });
    }
    if (name === 'statements') {
      this.accumulateStatements({ accumulator, items, regionGroup, shopId, shopCipher });
      return items.length;
    }
    throw new Error(`unknown TikTok sync endpoint: ${name}`);
  }

  /**
   * 从游标里取回累加器。
   */
  readAccumulator(cursor) {
    const stored = cursor && cursor.accumulator;
    if (!stored || typeof stored !== 'object') return { days: {} };
    return { days: { ...(stored.days || {}) } };
  }

  /**
   * 把结算流水累加到累加器里。
   *
   * 累加器按"日期::币种"分桶，与日汇总表的行一一对应。
   * 同一天跨页出现时相加 —— 因为结算流水是逐笔的，一天可能有几十笔。
   */
  accumulateStatements({ accumulator, items = [], regionGroup, shopId, shopCipher }) {
    if (!accumulator) return;
    const rows = items.map(item => ({
      region_group: regionGroup,
      shop_id: shopId,
      shop_cipher: shopCipher,
      ...item,
    }));
    const dailyRows = buildStatementDailyRows({
      regionGroup, shopId, shopCipher, rows,
    });
    for (const row of dailyRows) {
      const key = `${row.event_date}::${row.currency}`;
      const existing = accumulator.days[key];
      if (!existing) {
        accumulator.days[key] = {
          eventDate: row.event_date,
          currency: row.currency,
          gmvSettled: row.gmv_settled,
          refunds: row.refunds,
          commission: row.commission,
          shipping: row.shipping,
        };
        continue;
      }
      existing.gmvSettled = addNullable(existing.gmvSettled, row.gmv_settled);
      existing.refunds = addNullable(existing.refunds, row.refunds);
      existing.commission = addNullable(existing.commission, row.commission);
      existing.shipping = addNullable(existing.shipping, row.shipping);
    }
  }

  /**
   * 写日汇总（结算流水口径）。
   *
   * 订单侧的日汇总走 rebuildOrderDaily（从订单表重新聚合），
   * 结算侧走这里 —— 因为结算流水没有明细表可聚合。
   */
  async writeStatementDaily({ regionGroup, shopId, shopCipher, accumulator }) {
    if (!accumulator) return 0;
    const rows = Object.values(accumulator.days || {}).map(day => ({
      region_group: regionGroup,
      shop_id: shopId,
      shop_cipher: shopCipher,
      event_date: day.eventDate,
      attribution_basis: 'derived_net',
      source: 'finance_statement',
      channel: 'unknown',
      currency: day.currency,
      orders: null,
      units: null,
      spend: null,
      impressions: null,
      clicks: null,
      gmv_order_total: null,
      gmv_subtotal: null,
      gmv_settled: day.gmvSettled === undefined ? null : day.gmvSettled,
      baseline_natural_gmv: null,
      incremental_gmv: null,
      raw_json: JSON.stringify({ aggregation: 'statement_daily' }),
    }));
    return this.dataRepository.upsertShopDaily({ rows });
  }

  /**
   * 记录原始快照。
   *
   * 快照是回放与排查的依据：出问题时能拿原始响应看平台到底返回了什么。
   */
  async recordSnapshot({ endpointKey, shopId, shopCipher, request, data, window }) {
    const requestJson = request.body || request.query || {};
    await this.pool.query(
      `INSERT INTO tiktok_raw_api_snapshots
       (region_group, endpoint_key, shop_id, shop_cipher, advertiser_id,
        event_date_from, event_date_to, request_fingerprint, request_json, response_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        this.regionGroup(),
        endpointKey,
        shopId,
        shopCipher,
        null,
        window ? window.startDate : null,
        window ? window.endDate : null,
        fingerprintRequest(requestJson),
        JSON.stringify(requestJson),
        JSON.stringify(data),
      ],
    );
  }
}

/**
 * 两个可空数字相加：任一为 null 时返回另一个，全为 null 时返回 null。
 *
 * 不能用 `a + b`：null + 5 会得到 5，而"这一项没有数据"与"这一项是 5"是两回事。
 */
function addNullable(a, b) {
  const left = a === null || a === undefined ? null : Number(a);
  const right = b === null || b === undefined ? null : Number(b);
  if (left === null && right === null) return null;
  return (left || 0) + (right || 0);
}

module.exports = {
  DEFAULT_ENDPOINTS,
  DEFAULT_PAGE_SIZE,
  DEFAULT_WINDOW_DAYS,
  SYNC_ENDPOINTS,
  TikTokSyncRunner,
  addNullable,
};
