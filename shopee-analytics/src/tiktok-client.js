'use strict';

/**
 * TikTok Shop Open API 客户端骨架。
 * ============================================================================================
 * 依据官方文档：
 *   - 签名：Sign your API request（sign 由 src/tiktok-signer.js 计算）
 *   - 错误码：Common errors（36009002 = 限流，36009007 = 超时，36009004 = 多义校验失败）
 *   - 端点：各端点自身的文档页（per-endpoint requiresShopCipher 由 src/tiktok-catalog.js 声明）
 *
 * 与 Shopee 客户端的关键差异
 * -------------------------
 *   1. 鉴权头：API 版本 202309 起，access token 放在 `x-tts-access-token` 头里，
 *      **不参与签名**；Shopee 则是把 access_token 放进 query 并参与签名。
 *   2. shop_cipher：多数端点以 query 参数形式要求它，且**是否需要是端点级的**。
 *      官方错误码 `36009004` 有两种相反含义：
 *        - `Missing identifier.` → 缺少 shop_cipher
 *        - `Unexpected identifier.` → 带了多余的 shop_cipher
 *      且该码被复用于多种校验失败，**禁止仅凭数字码分支，必须结合 message 关键词**。
 *      因此这里用 requiresShopCipher 标志在客户端层判定，而不是靠错误反推。
 *   3. 限流：HTTP 429 与业务码 36009002 都表示限流；36009007 是请求超时，同样值得退避重试。
 *
 * 只读约束：本模块只发起 GET 与只读查询，不包含任何写操作。
 */

const { withRateLimitRetry } = require('./rate-limit-retry');
const { buildSignedQuery } = require('./tiktok-signer');

/** 业务错误码。取自官方 Common errors。 */
const ERROR_CODES = Object.freeze({
  /** 请求过于频繁，需退避。 */
  RATE_LIMIT: 36009002,
  /** 请求超时，可退避重试。 */
  REQUEST_TIMEOUT: 36009007,
  /** 参数校验失败，被复用于多种含义，必须结合 message 判断。 */
  INVALID_IDENTIFIER: 36009004,
  /** API 版本无效（新版网关用 36009014，旧网关可能仍是 36009004）。 */
  INVALID_API_VERSION: 36009014,
});

/** `36009004` 的 message 关键词索引（官方原文）。 */
const IDENTIFIER_MESSAGE_KEYS = Object.freeze({
  MISSING: 'missing identifier',
  UNEXPECTED: 'unexpected identifier',
  MISSING_CREDENTIALS: 'missing credentials',
  INVALID_ACCESS_TOKEN_HEADER: 'x-tts-access-token header is invalid',
  INVALID_APP_KEY: 'invalid app_key',
});

/**
 * 把业务码与 message 解析成可判定的错误种类。
 *
 * @param {number|null} code 业务错误码
 * @param {string} message 错误描述
 * @returns {string} 错误种类
 */
function classifyError(code, message) {
  if (code === ERROR_CODES.RATE_LIMIT) return 'RATE_LIMIT';
  if (code === ERROR_CODES.REQUEST_TIMEOUT) return 'TIMEOUT';

  const text = String(message || '').toLowerCase();
  if (text.includes(IDENTIFIER_MESSAGE_KEYS.MISSING)) return 'MISSING_SHOP_CIPHER';
  if (text.includes(IDENTIFIER_MESSAGE_KEYS.UNEXPECTED)) return 'UNEXPECTED_SHOP_CIPHER';
  if (text.includes(IDENTIFIER_MESSAGE_KEYS.INVALID_ACCESS_TOKEN_HEADER)) return 'INVALID_ACCESS_TOKEN';
  if (text.includes(IDENTIFIER_MESSAGE_KEYS.INVALID_APP_KEY)) return 'INVALID_APP_KEY';
  if (text.includes(IDENTIFIER_MESSAGE_KEYS.MISSING_CREDENTIALS)) return 'MISSING_CREDENTIALS';
  if (code === ERROR_CODES.INVALID_API_VERSION) return 'INVALID_API_VERSION';
  return 'TIKTOK_API_ERROR';
}

/**
 * 把对象追加到 query。数组会展开成重复键（与 Shopee 客户端行为一致）。
 */
function appendQueryParam(params, key, value) {
  if (value === undefined || value === null || value === '') return;
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (entry === undefined || entry === null || entry === '') continue;
      params.append(key, String(entry));
    }
    return;
  }
  params.set(key, String(value));
}

/**
 * 判断响应是否为 TikTok 的成功结构。
 * 官方响应形如 `{ code: 0, message: "Success", data: {...}, request_id: "..." }`。
 */
function isSuccessPayload(payload) {
  if (!payload || typeof payload !== 'object') return false;
  if (typeof payload.code === 'number') return payload.code === 0;
  // 没有业务码时以 HTTP 状态为准（由调用方处理）。
  return true;
}

class TikTokClient {
  constructor({
    appKey,
    appSecret,
    baseUrl = 'https://open-api.tiktokglobalshop.com',
    fetchImpl = global.fetch,
    retryOptions = {},
  }) {
    if (!fetchImpl) throw new Error('fetch implementation is required');
    this.appKey = String(appKey || '');
    this.appSecret = String(appSecret || '');
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.fetch = fetchImpl;
    this.retryOptions = { ...retryOptions };
  }

  /**
   * 执行一次已签名的请求，失败时按限流策略退避重试。
   *
   * @param {object} options
   * @param {string} options.path
   * @param {string} options.accessToken
   * @param {string} [options.method]
   * @param {object} [options.query] 额外的 query 参数（不含 app_key/timestamp/sign）
   * @param {object} [options.body]   请求体对象
   * @param {boolean} [options.requiresShopCipher] 该端点是否要求 shop_cipher
   * @param {string} [options.shopCipher]
   * @param {(info: object) => void} [options.onRetry]
   * @returns {Promise<object>} 响应体的 data 字段
   */
  async request({
    path,
    accessToken,
    method = 'GET',
    query = {},
    body,
    requiresShopCipher = false,
    shopCipher,
    onRetry,
  }) {
    if (!path) throw new Error('path is required');
    if (!accessToken) throw new Error('accessToken is required');

    return withRateLimitRetry(async () => {
      // 请求体先序列化一次，签名与发送都用同一份字节 —— 重新序列化会改变签名。
      const bodyText = body === undefined ? '' : JSON.stringify(body);
      const contentType = body === undefined ? '' : 'application/json';

      const effectiveQuery = { ...(query || {}) };
      if (requiresShopCipher) {
        if (!shopCipher) {
          throw new Error(`shop_cipher is required for ${path}`);
        }
        effectiveQuery.shop_cipher = shopCipher;
      } else if (shopCipher) {
        // 该端点不接受 shop_cipher：官方对多余参数会返回 36009004 Unexpected identifier。
        delete effectiveQuery.shop_cipher;
      }

      const signedQuery = buildSignedQuery({
        appKey: this.appKey,
        appSecret: this.appSecret,
        path,
        query: effectiveQuery,
        body: bodyText,
        contentType,
      });

      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(signedQuery)) appendQueryParam(params, key, value);

      const headers = {
        'x-tts-access-token': accessToken,
        'content-type': 'application/json',
      };

      const response = await this.fetch(`${this.baseUrl}${path}?${params.toString()}`, {
        method,
        headers,
        body: body === undefined ? undefined : bodyText,
      });

      const text = await response.text();
      let payload;
      try { payload = text ? JSON.parse(text) : {}; }
      catch { throw new Error(`TikTok returned non-JSON (${response.status})`); }

      if (!response.ok || !isSuccessPayload(payload)) {
        const code = typeof payload.code === 'number' ? payload.code : null;
        const message = payload.message || '';
        const error = new Error(message || `TikTok HTTP ${response.status}`);
        error.status = response.status;
        error.code = code;
        error.requestId = payload.request_id || null;
        error.kind = classifyError(code, message);
        const retryAfter = response.headers && response.headers.get('retry-after');
        if (/^\d+$/.test(String(retryAfter || ''))) error.retryAfterSeconds = Number(retryAfter);
        throw error;
      }

      return payload.data !== undefined ? payload.data : payload;
    }, { ...this.retryOptions, onRetry });
  }

  /**
   * 逐页拉取，直到没有下一页。
   *
   * TikTok 用游标分页：`page_token` 传入下一次请求，响应里的 `next_page_token`
   * 为空表示结束。**游标分页会静默漏数据** —— 若下一页 token 与当前页重复，
   * 说明平台返回了异常页，此时必须停下而不是无限循环。
   *
   * @param {object} options
   * @param {(context: object) => Promise<object>} options.fetchPage
   *        接收 { page_token } 并返回该页数据
   * @param {string} [options.itemsPath] 该页数据里数组所在的路径，例如 'orders'。
   *        TikTok 各端点的数组字段名不同（orders / products / returns ...），
   *        因此由调用方指定；未指定时若响应本身是数组则直接使用。
   * @param {string} [options.nextPageTokenPath] 从响应里取下一页 token 的路径
   * @param {number} [options.maxPages] 最大页数保护
   * @param {string} [options.cursorPath] 请求参数里放 token 的键名
   * @returns {Promise<Array<object>>} 合并后的所有页
   */
  static async paginate({
    fetchPage,
    itemsPath,
    nextPageTokenPath = 'next_page_token',
    maxPages = 1000,
    cursorPath = 'page_token',
  }) {
    const pages = [];
    const seenTokens = new Set();
    let pageToken = null;

    for (let page = 0; page < maxPages; page += 1) {
      const result = await fetchPage({ [cursorPath]: pageToken });

      let items;
      if (itemsPath) {
        items = readNested(result, itemsPath) || [];
      } else if (Array.isArray(result)) {
        items = result;
      } else {
        items = (result && result.data) || [];
      }
      pages.push(...items);

      const nextToken = readNested(result, nextPageTokenPath);
      if (!nextToken) break;

      // 异常页检测：token 重复说明平台没有推进，继续请求只会拿到同一页。
      if (seenTokens.has(nextToken)) {
        const error = new Error('TikTok pagination did not advance (repeated token)');
        error.kind = 'PAGINATION_STALLED';
        throw error;
      }
      seenTokens.add(nextToken);
      pageToken = nextToken;
    }

    return pages;
  }
}

/**
 * 按点号路径读取嵌套字段，例如 'data.next_page_token'。
 */
function readNested(source, path) {
  if (!source || !path) return undefined;
  let current = source;
  for (const key of String(path).split('.')) {
    if (current === null || current === undefined) return undefined;
    current = current[key];
  }
  return current;
}

module.exports = {
  ERROR_CODES,
  IDENTIFIER_MESSAGE_KEYS,
  TikTokClient,
  appendQueryParam,
  classifyError,
  isSuccessPayload,
  readNested,
};
