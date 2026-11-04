'use strict';

/**
 * TikTok Marketing API 客户端（广告线）。
 * ============================================================================================
 * 目的：调用 TikTok 的广告报表接口 —— GMV Max 与整合报表。
 *
 * ★ 为什么必须有一个独立的客户端，而不是复用 Shop Open API 客户端
 * ------------------------------------------------------------------
 * 两套 API 的**凭据域完全不同**，混用一定失败，而且失败方式极具误导性：
 *
 *                 Shop Open API              Marketing API
 *   域名          open-api.tiktokglobalshop.com   business-api.tiktok.com
 *   凭据头        x-tts-access-token          Access-Token（大小写敏感）
 *   请求签名      必须（app_key/timestamp/sign）  不签名
 *   凭据来源      卖家授权 → shop_id           广告主授权 → advertiser_id
 *   应用凭据      Shop 应用的 app_key/secret   TikTok for Business 的 app_id/secret
 *   token 有效期  7 天                        24 小时
 *
 * 拿 Shop 客户端去调 Marketing API，签名与鉴权头都是错的，
 * 平台返回的却是「权限不足」这类错误码 —— 会把人引到完全错误的方向
 * （去申请根本不存在的 Shop 权限），而真实原因是鉴权方式不对。
 *
 * 所以这里独立实现，并在客户端层就把 Shop 的路径挡住（见 assertMarketingApiPath）。
 *
 * ★ 口径纪律
 * GMV Max 报表的 gross_revenue 与 cost 出自**同一张报表**，两者相除就是平台面板上
 * 的 ROI；而整合报表的 spend 与 GMV Max 的 GMV **不同源**，混算无意义。
 * 这一点由落库层按 attribution_basis 分行保证，不在客户端混。
 */

/** Marketing API 的基址。与 Shop API 的域名不同，不能混用。 */
const MARKETING_BASE_URL = 'https://business-api.tiktok.com';

/** API 版本在路径里（v1.3），不在 query 里 —— 固定住版本，升级时机由我们自己定。 */
const MARKETING_API_PREFIX = '/open_api/v1.3';

/**
 * Shop Open API 的路径前缀。
 *
 * 出现在这里是要**挡住**它：Marketing 客户端绝不能发 Shop 的请求 ——
 * 鉴权方式不兼容，发过去只会得到误导性的"权限不足"。
 */
const SHOP_API_PREFIXES = Object.freeze([
  '/order/', '/product/', '/authorization/', '/finance/', '/promotion/',
  '/return_refund/', '/analytics/', '/affiliate_seller/', '/seller/',
]);

/** 业务错误码。取自 TikTok Marketing API 的 Common errors。 */
const ERROR_CODES = Object.freeze({
  /** 凭据无效或已过期。Marketing API 的 token 只有 24 小时，过期后必须重新授权。 */
  INVALID_TOKEN: 40001,
  /** app_id 与 secret 不匹配。 */
  INVALID_APP: 40005,
  /** 授权码无效或已使用过。授权码是一次性的。 */
  INVALID_AUTH_CODE: 40105,
  /** 广告账户无权限 —— token 没有被授权访问这个 advertiser_id。 */
  ADVERTISER_NOT_AUTHORIZED: 40002,
  /** 报表任务还在跑。同步报表的轮询会遇到。 */
  REPORT_TASK_NOT_READY: 40023,
  /** 请求过于频繁，需退避。 */
  RATE_LIMIT: 36009002,
});

/**
 * 判断一个路径是不是 Shop Open API 的路径。
 *
 * @param {string} path
 * @returns {boolean}
 */
function isShopApiPath(path) {
  const text = String(path || '');
  return SHOP_API_PREFIXES.some(prefix => text.startsWith(prefix));
}

/**
 * 断言路径属于 Marketing API。
 *
 * @param {string} path
 * @throws {Error} 路径是 Shop 的路径时抛出，并说明该用哪个客户端
 */
function assertMarketingApiPath(path) {
  if (!isShopApiPath(path)) return;
  const error = new Error(
    'Shop Open API path cannot be sent by the Marketing client: '
    + `${path}. Shop API needs x-tts-access-token plus a request signature; `
    + 'Marketing API needs an Access-Token header and no signature. '
    + 'Use TikTokClient for Shop paths and TikTokMarketingClient for Marketing paths.',
  );
  error.code = 'TIKTOK_WRONG_CLIENT';
  throw error;
}

/**
 * 判断响应信封是否表示成功。
 *
 * Marketing API 的信封形如 { code, message, data }，code 为 0 表示成功。
 *
 * @param {object} payload
 * @returns {boolean}
 */
function isSuccessPayload(payload) {
  if (!payload || typeof payload !== 'object') return false;
  if (typeof payload.code === 'number') return payload.code === 0;
  return true;
}

/**
 * 把值变成 query 参数能接受的形态。
 *
 * 数组要重复出现同一个键（TikTok 接受 store_ids=["a","b"] 与 store_ids=a&store_ids=b
 * 两种写法，前者更可读）。对象与布尔要序列化成 JSON ——
 * 报表的 dimensions/metrics 就是这种形状。
 *
 * @param {*} value
 * @returns {string|null}
 */
function queryValue(value) {
  if (value === undefined || value === null) return null;
  if (Array.isArray(value)) return JSON.stringify(value);
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * TikTok Marketing API 客户端。
 */
class TikTokMarketingClient {
  /**
   * @param {object} options
   * @param {string} [options.baseUrl]
   * @param {Function} options.fetchImpl
   * @param {object} [options.retryOptions] 退避参数，交给共享的 rate-limit-retry
   */
  constructor({
    baseUrl = MARKETING_BASE_URL,
    fetchImpl = global.fetch,
    retryOptions = {},
  } = {}) {
    if (!fetchImpl) throw new Error('fetch implementation is required');
    this.baseUrl = String(baseUrl || '').replace(/\/$/, '');
    this.fetch = fetchImpl;
    this.retryOptions = { ...retryOptions };
  }

  /**
   * 执行一次请求。
   *
   * ★ 与 Shop 客户端的三点差异（每一处都是必须的）：
   *   1. 域名不同；
   *   2. 头是 `Access-Token`，不是 `x-tts-access-token`；
   *   3. **不做签名** —— query 里不加 app_key/timestamp/sign。
   *
   * @param {object} options
   * @param {string} options.path 形如 /gmv_max/report/get/
   * @param {string} options.accessToken
   * @param {string} [options.method]
   * @param {object} [options.query]
   * @param {object} [options.body]
   * @param {(info: object) => void} [options.onRetry]
   * @returns {Promise<object>} 响应体的 data 字段
   */
  async request({
    path,
    accessToken,
    method = 'GET',
    query = {},
    body,
    onRetry,
  }) {
    if (!path) throw new Error('path is required');
    if (!accessToken) throw new Error('accessToken is required');
    assertMarketingApiPath(path);

    // 路径若已带版本前缀就不重复加。
    const fullPath = path.startsWith(MARKETING_API_PREFIX)
      ? path
      : `${MARKETING_API_PREFIX}${path.startsWith('/') ? path : `/${path}`}`;

    const { withRateLimitRetry } = require('./rate-limit-retry');
    const options = { ...this.retryOptions };
    if (onRetry) options.onRetry = onRetry;

    return withRateLimitRetry(async () => {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(query || {})) {
        const rendered = queryValue(value);
        if (rendered === null) continue;
        params.append(key, rendered);
      }

      const headers = {
        // ★ 大小写敏感：TikTok 认的是 `Access-Token`。
        // 用 `Authorization: Bearer` 或 `access-token` 都会拿到 40001。
        'Access-Token': accessToken,
        'content-type': 'application/json',
        accept: 'application/json',
      };

      const queryString = params.toString();
      const url = `${this.baseUrl}${fullPath}${queryString ? `?${queryString}` : ''}`;

      const response = await this.fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });

      const text = await response.text();
      let payload;
      try { payload = text ? JSON.parse(text) : {}; }
      catch { throw new Error(`TikTok Marketing returned non-JSON (${response.status})`); }

      if (!response.ok || !isSuccessPayload(payload)) {
        const code = typeof payload.code === 'number' ? payload.code : null;
        const message = payload.message || '';
        const error = new Error(message || `TikTok Marketing HTTP ${response.status}`);
        error.status = response.status;
        error.code = code;
        error.kind = 'TIKTOK_MARKETING_ERROR';
        // 40001 是最常见的一种，且有专门的处置方式（重新授权），
        // 所以把它单列出来 —— 调用方要能据此决定「刷新」还是「重新授权」。
        if (code === ERROR_CODES.INVALID_TOKEN) error.kind = 'TIKTOK_MARKETING_TOKEN_INVALID';
        if (code === ERROR_CODES.INVALID_AUTH_CODE) error.kind = 'TIKTOK_MARKETING_AUTH_CODE_INVALID';
        throw error;
      }

      return payload.data !== undefined ? payload.data : payload;
    }, options);
  }

  /**
   * GMV Max 报表：花费 + 混合归因的 GMV / 订单 / ROI。
   *
   * @param {object} options
   * @returns {Promise<object>}
   */
  async gmvMaxReport({
    accessToken,
    advertiserId,
    storeIds = [],
    dimensions = [],
    metrics = [],
    startDate,
    endDate,
    page = 1,
    pageSize = 1000,
  }) {
    if (!advertiserId) throw new Error('advertiserId is required');
    if (!startDate || !endDate) throw new Error('startDate and endDate are required');
    if (!Array.isArray(storeIds) || !storeIds.length) {
      throw new Error('storeIds is required for the GMV Max report');
    }
    return this.request({
      path: '/gmv_max/report/get/',
      accessToken,
      method: 'GET',
      query: {
        advertiser_id: advertiserId,
        store_ids: storeIds,
        dimensions,
        metrics,
        start_date: startDate,
        end_date: endDate,
        page,
        page_size: pageSize,
      },
    });
  }

  /**
   * 整合报表：纯付费漏斗（spend / impressions / clicks / conversions）。
   *
   * @param {object} options
   * @returns {Promise<object>}
   */
  async integratedReport({
    accessToken,
    advertiserId,
    reportType = 'BASIC',
    dimensions = [],
    metrics = [],
    startDate,
    endDate,
    page = 1,
    pageSize = 1000,
  }) {
    if (!advertiserId) throw new Error('advertiserId is required');
    if (!startDate || !endDate) throw new Error('startDate and endDate are required');
    return this.request({
      path: '/report/integrated/get/',
      accessToken,
      method: 'GET',
      query: {
        report_type: reportType,
        advertiser_id: advertiserId,
        dimensions,
        metrics,
        start_date: startDate,
        end_date: endDate,
        page,
        page_size: pageSize,
      },
    });
  }

  /**
   * 广告账户信息 —— 用来验证 token 与 advertiser_id 是否匹配。
   *
   * @param {object} options
   * @returns {Promise<object>}
   */
  async advertiserInfo({ accessToken, advertiserId }) {
    if (!advertiserId) throw new Error('advertiserId is required');
    return this.request({
      path: '/advertiser/info/',
      accessToken,
      method: 'GET',
      query: { advertiser_ids: [advertiserId] },
    });
  }
}

module.exports = {
  ERROR_CODES,
  MARKETING_API_PREFIX,
  MARKETING_BASE_URL,
  SHOP_API_PREFIXES,
  TikTokMarketingClient,
  assertMarketingApiPath,
  isShopApiPath,
  isSuccessPayload,
  queryValue,
};
