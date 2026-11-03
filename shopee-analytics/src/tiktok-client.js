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

/**
 * Marketing API 的路径前缀。
 *
 * 为什么要在客户端层拦下来
 * ----------------------
 * Shop Open API 与 Marketing API 的鉴权方式**完全不同**：
 *   - Shop Open API：access token 放 `x-tts-access-token` 头，**请求要签名**
 *     （app_key / timestamp / sign 三个参数都要进 query）；
 *   - Marketing API：token 放 `Access-Token` 头，**不签名**。
 *
 * 本客户端（TikTokClient）只会做 Shop Open API 的事：固定写 x-tts-access-token 头，
 * 并且固定给 query 加上 app_key/timestamp/sign。
 * 因此把 Marketing API 的路径喂给它，签名与鉴权头一定是错的 —— 平台必然拒绝。
 *
 * 与其让它带着一个必然失败的请求去撞平台（错误信息还会指向"权限不足"这种误导方向），
 * 不如在客户端层直接拦下并说清楚原因。广告线（#5 #6）不在本次范围内，
 * 需要它的人必须另起一个走 Marketing API 鉴权的客户端，而不是复用这一个。
 */
const MARKETING_API_PATH_PREFIX = '/open_api/';

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

/**
 * 判断一个路径是否属于 Marketing API。
 *
 * @param {string} path
 * @returns {boolean}
 */
function isMarketingApiPath(path) {
  return String(path || '').startsWith(MARKETING_API_PATH_PREFIX);
}

/**
 * 断言路径是 Shop Open API 的路径。
 *
 * @param {string} path
 * @throws {Error} 路径属于 Marketing API 时抛出，并说明原因与替代做法
 */
function assertShopOpenApiPath(path) {
  if (!isMarketingApiPath(path)) return;
  const error = new Error(
    `Marketing API is not available through the Shop Open API client: ${path}. ` +
    'Marketing API uses a different credential domain (Access-Token header, no request signature), ' +
    'so it cannot be called from this client. Use a dedicated Marketing API client instead.',
  );
  error.kind = 'MARKETING_API_UNSUPPORTED';
  error.code = 'TIKTOK_MARKETING_API_UNSUPPORTED';
  throw error;
}

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
    // 广告线的路径在这里被挡下：它们的鉴权方式与本客户端不兼容，
    // 硬发只会得到一个误导性的"权限不足"。
    assertShopOpenApiPath(path);

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
   *        也可以给一个数组：取第一个**存在且是数组**的路径。
   *        有些端点的字段名不唯一（结算流水可能是 statement_list 也可能是 statements），
   *        这时用候选列表比在调用方手写 if/else 更不容易写错。
   * @param {string} [options.nextPageTokenPath] 从响应里取下一页 token 的路径
   * @param {number} [options.maxPages] 最大页数保护
   * @param {string} [options.cursorPath] 请求参数里放 token 的键名
   * @param {string|null} [options.startPageToken] 从哪个 token 接着翻。
   *        断点续传用：把上次存下的游标传进来，就从那一页继续。
   * @param {(context: object) => Promise<void>} [options.onPage] 每页取到后调用。
   *        调用方在这里把该页的数据落库并推进游标 ——
   *        顺序很重要：**先落数据，再推进游标**，反过来会在崩溃时漏数据。
   * @returns {Promise<Array<object>>} 合并后的所有页
   */
  static async paginate({
    fetchPage,
    itemsPath,
    nextPageTokenPath = 'next_page_token',
    maxPages = 1000,
    cursorPath = 'page_token',
    startPageToken = null,
    onPage = null,
  }) {
    const pages = [];
    const seenTokens = new Set();
    let pageToken = startPageToken || null;
    // 续传起点本身也要参与"重复 token"检测：平台若原样退回同一个 token，
    // 说明它没有推进，继续翻只会拿到同一页。
    if (pageToken) seenTokens.add(pageToken);

    for (let page = 0; page < maxPages; page += 1) {
      const result = await fetchPage({ [cursorPath]: pageToken });

      let items;
      if (Array.isArray(itemsPath)) {
        // 候选路径：取第一个"存在且是数组"的。
        // 不能用"非空"来判断 —— 空数组也是合法的一页（这一页确实没有数据）。
        items = [];
        for (const candidate of itemsPath) {
          const value = readNested(result, candidate);
          if (Array.isArray(value)) { items = value; break; }
        }
      } else if (itemsPath) {
        items = readNested(result, itemsPath) || [];
      } else if (Array.isArray(result)) {
        items = result;
      } else {
        items = (result && result.data) || [];
      }

      const nextToken = readNested(result, nextPageTokenPath);

      // 异常页检测：token 重复说明平台没有推进，继续请求只会拿到同一页。
      // 这个检查必须在交出该页之前做 —— 交出去就会把一个坏游标存下来，
      // 下一轮续传会带着它从头再来，永远走不出去。
      if (nextToken && seenTokens.has(nextToken)) {
        const error = new Error('TikTok pagination did not advance (repeated token)');
        error.kind = 'PAGINATION_STALLED';
        throw error;
      }

      pages.push(...items);

      if (onPage) {
        // 先落数据、再推进游标。顺序反了会在崩溃时漏掉这一页。
        await onPage({
          page,
          pageToken,
          nextPageToken: nextToken || null,
          items,
          result,
        });
      }

      if (!nextToken) break;

      seenTokens.add(nextToken);
      pageToken = nextToken;
    }

    return pages;
  }

  /**
   * 实例版的分页。行为与静态版一致，只是让调用方可以直接走 client 的能力，
   * 而不必知道分页逻辑住在类的静态方法上。
   *
   * @param {object} options 见静态 paginate
   * @returns {Promise<Array<object>>}
   */
  paginate(options) {
    return TikTokClient.paginate(options);
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
  MARKETING_API_PATH_PREFIX,
  TikTokClient,
  appendQueryParam,
  assertShopOpenApiPath,
  classifyError,
  isMarketingApiPath,
  isSuccessPayload,
  readNested,
};
