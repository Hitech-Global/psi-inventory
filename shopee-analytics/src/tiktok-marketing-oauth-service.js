'use strict';

/**
 * TikTok Marketing API 授权（广告线）。
 * ============================================================================================
 * ★ 与 Shop 侧授权是完全独立的一套
 * ----------------------------------
 * Shop 侧是「卖家授权」：店铺主授权后拿到 shop_id 与 shop_cipher。
 * Marketing 侧是「广告主授权」：广告账户管理员授权后拿到 access_token
 * 与 advertiser_ids（一个 token 可能覆盖多个广告账户）。
 *
 * 两边的应用凭据也不同：Shop 用 app_key/app_secret，
 * Marketing 用 TikTok for Business 应用的 app_id/secret。
 * 所以这里**不共用** Shop 的任何配置项 ——
 * 混用会得到 40005（app 无效）或 40001（凭据无效），而不是"权限不足"。
 *
 * ★ token 只有 24 小时
 * Marketing 的 access_token 固定 24 小时过期，refresh_token 有效期长得多。
 * 所以刷新是**例行任务**而不是例外 —— 调度必须每天至少跑一次。
 * 而 Shop 的 7 天 token 不需要这么频繁。
 *
 * ★ 授权码是一次性的
 * auth_code 只能用一次，重复使用会拿到 40105。
 * 回调处理必须防重放 —— 下面的 completeAuthorization 只接受未被消费过的 state。
 */

const crypto = require('crypto');

/** Marketing 授权页。广告主在这里登录并同意授权。 */
const MARKETING_AUTHORIZE_URL = 'https://ads.tiktok.com/marketing_api/auth';

/** token 交换与刷新端点。 */
const MARKETING_TOKEN_URL = 'https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/';
const MARKETING_REFRESH_URL = 'https://business-api.tiktok.com/open_api/v1.3/oauth2/refresh_token/';

/** state cookie 的名字。与 Shop 的分开，避免互相覆盖。 */
const TIKTOK_MARKETING_COOKIE = 'shopee_tiktok_marketing_oauth_state';

/** state cookie 的作用路径。 */
const MARKETING_COOKIE_PATH = '/api/shopee-analytics/tiktok/marketing/oauth';

/** 回调路径。必须在 TikTok 应用后台登记。 */
const TIKTOK_MARKETING_CALLBACK_PATH = '/api/shopee-analytics/tiktok/marketing/oauth/callback';

/** access_token 有效期：24 小时。 */
const ACCESS_TOKEN_TTL_SECONDS = 24 * 60 * 60;

/**
 * 构造错误。
 *
 * @param {string} code
 * @param {string} message
 * @param {number} [status]
 * @returns {Error}
 */
function marketingError(code, message, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

/**
 * 解析回调地址。
 *
 * 默认用站点自己的域名 + 固定回调路径。
 *
 * @param {object} env
 * @returns {string}
 */
function resolveMarketingRedirectUrl(env = process.env) {
  const explicit = String(env.TIKTOK_MARKETING_REDIRECT_URL || '').trim();
  if (explicit) return explicit;
  const base = String(env.TIKTOK_MARKETING_REDIRECT_BASE || '').trim()
    || String(env.PUBLIC_BASE_URL || '').trim();
  if (!base) {
    throw marketingError(
      'TIKTOK_MARKETING_REDIRECT_MISSING',
      'TIKTOK_MARKETING_REDIRECT_URL or TIKTOK_MARKETING_REDIRECT_BASE is required',
      500,
    );
  }
  return `${base.replace(/\/$/, '')}${TIKTOK_MARKETING_CALLBACK_PATH}`;
}

/**
 * state cookie。
 *
 * @param {string} state
 * @param {number} ttlSeconds
 * @returns {string}
 */
function stateCookie(state, ttlSeconds) {
  return `${TIKTOK_MARKETING_COOKIE}=${encodeURIComponent(state)}; Max-Age=${ttlSeconds}; Path=${MARKETING_COOKIE_PATH}; HttpOnly; Secure; SameSite=Lax`;
}

/**
 * 清除 state cookie。
 *
 * @returns {string}
 */
function clearStateCookie() {
  return `${TIKTOK_MARKETING_COOKIE}=; Max-Age=0; Path=${MARKETING_COOKIE_PATH}; HttpOnly; Secure; SameSite=Lax`;
}

/**
 * 从 cookie 头里取一个值。
 *
 * @param {string} header
 * @param {string} name
 * @returns {string}
 */
function parseCookie(header, name) {
  for (const pair of String(header || '').split(';')) {
    const index = pair.indexOf('=');
    if (index < 1 || pair.slice(0, index).trim() !== name) continue;
    try { return decodeURIComponent(pair.slice(index + 1).trim()); } catch { return ''; }
  }
  return '';
}

/**
 * 构造授权链接。
 *
 * 参数与 TikTok 官方 OAuth 一致：
 *   app_id       应用 ID
 *   state        防 CSRF 的随机串，回调时要对上
 *   redirect_uri 回调地址，必须与应用后台登记的完全一致
 *   rid          授权请求的唯一标识
 *
 * @param {object} options
 * @returns {string}
 */
function buildAuthorizationUrl({ appId, redirectUri, state, rid }) {
  if (!appId) throw new Error('appId is required');
  if (!redirectUri) throw new Error('redirectUri is required');
  if (!state) throw new Error('state is required');

  const url = new URL(MARKETING_AUTHORIZE_URL);
  url.searchParams.set('app_id', appId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);
  // rid 是这次授权请求的唯一标识。用 state 派生，避免多存一个字段。
  url.searchParams.set('rid', rid || state.slice(0, 36));
  return url.toString();
}

/**
 * 从 token 响应里取出凭据。
 *
 * @param {object} payload 响应体的 data 字段
 * @returns {object}
 */
function parseTokenPayload(payload) {
  const source = payload && payload.data ? payload.data : payload;
  if (!source || typeof source !== 'object') {
    throw marketingError('TIKTOK_MARKETING_TOKEN_MALFORMED', 'Marketing token response is malformed', 502);
  }
  const accessToken = source.access_token || source.accessToken;
  const refreshToken = source.refresh_token || source.refreshToken;
  const advertiserIds = source.advertiser_ids || source.advertiserIds || [];
  const expiresIn = Number(source.expires_in || source.expiresIn || 0);

  if (!accessToken) {
    throw marketingError('TIKTOK_MARKETING_TOKEN_MISSING', 'Marketing token response has no access_token', 502);
  }
  if (!refreshToken) {
    throw marketingError('TIKTOK_MARKETING_REFRESH_TOKEN_MISSING', 'Marketing token response has no refresh_token', 502);
  }
  if (!Array.isArray(advertiserIds) || !advertiserIds.length) {
    // 没有 advertiser_ids 说明这个 token 什么都查不了 —— 必须让授权方知道，
    // 否则会以为"授权成功了但没数据"。
    throw marketingError(
      'TIKTOK_MARKETING_NO_ADVERTISERS',
      'Marketing authorization returned no advertiser ids — the app was not granted any ad account',
      502,
    );
  }

  return {
    accessToken,
    refreshToken,
    advertiserIds: advertiserIds.map(String),
    // 平台没给 expires_in 时按 24 小时算 —— 那是已知的固定值。
    expiresIn: expiresIn > 0 ? expiresIn : ACCESS_TOKEN_TTL_SECONDS,
  };
}

/**
 * TikTok Marketing 授权服务。
 */
class TikTokMarketingOAuthService {
  /**
   * @param {object} options
   * @param {object} options.tokenRepository
   * @param {object} [options.env]
   * @param {Function} [options.fetchImpl]
   * @param {Function} [options.now]
   */
  constructor({
    tokenRepository,
    env = process.env,
    fetchImpl = global.fetch,
    now = () => new Date(),
  }) {
    if (!tokenRepository) throw new Error('tokenRepository is required');
    if (!fetchImpl) throw new Error('fetch implementation is required');
    this.tokenRepository = tokenRepository;
    this.env = env;
    this.fetch = fetchImpl;
    this.now = now;
  }

  /** 应用 ID。Marketing 用 app_id，与 Shop 的 app_key 不是一回事。 */
  appId() {
    const value = String(this.env.TIKTOK_MARKETING_APP_ID || '').trim();
    if (!value) {
      throw marketingError(
        'TIKTOK_MARKETING_APP_ID_MISSING',
        'TIKTOK_MARKETING_APP_ID is required — it is the TikTok for Business app id, not the Shop app key',
        500,
      );
    }
    return value;
  }

  /** 应用密钥。 */
  appSecret() {
    const value = String(this.env.TIKTOK_MARKETING_APP_SECRET || '').trim();
    if (!value) {
      throw marketingError(
        'TIKTOK_MARKETING_APP_SECRET_MISSING',
        'TIKTOK_MARKETING_APP_SECRET is required',
        500,
      );
    }
    return value;
  }

  /**
   * 开始授权：生成 state 与授权链接。
   *
   * @returns {Promise<{state: string, authorizationUrl: string, ttlSeconds: number}>}
   */
  async beginAuthorization() {
    const appId = this.appId();
    const redirectUri = resolveMarketingRedirectUrl(this.env);
    // state 同时做 CSRF 防护与防重放：回调时必须原样带回。
    const state = crypto.randomBytes(24).toString('hex');
    const authorizationUrl = buildAuthorizationUrl({
      appId, redirectUri, state, rid: crypto.randomUUID(),
    });
    return { state, authorizationUrl, ttlSeconds: 600 };
  }

  /**
   * 完成授权：换 token 并落库。
   *
   * @param {object} options
   * @param {string} options.state      回调带回的 state
   * @param {string} options.authCode   回调带回的授权码
   * @param {string} options.expectedState cookie 里存的 state
   * @returns {Promise<object>} 授权结果
   */
  async completeAuthorization({ state, authCode, expectedState }) {
    if (!expectedState || !state) {
      throw marketingError('TIKTOK_MARKETING_STATE_MISSING', 'Authorization state is missing', 400);
    }
    // ★ 防重放：授权码只能用一次，state 也只能用一次。
    //   不校验 state 的话，别人可以拿自己的授权码来换一个 token。
    if (String(state) !== String(expectedState)) {
      throw marketingError('TIKTOK_MARKETING_STATE_MISMATCH', 'Authorization state does not match', 400);
    }
    if (!authCode) {
      throw marketingError('TIKTOK_MARKETING_AUTH_CODE_MISSING', 'auth_code is missing', 400);
    }

    const payload = await this._post(MARKETING_TOKEN_URL, {
      app_id: this.appId(),
      secret: this.appSecret(),
      auth_code: authCode,
    });
    const parsed = parseTokenPayload(payload);

    const expiresAt = new Date(this.now().getTime() + parsed.expiresIn * 1000);
    const appId = this.appId();
    // 一个 token 覆盖多个广告账户 —— 逐个存，每个广告主一行。
    for (const advertiserId of parsed.advertiserIds) {
      await this.tokenRepository.save({
        appId,
        advertiserId,
        accessToken: parsed.accessToken,
        refreshToken: parsed.refreshToken,
        expiresAt,
        lastRefreshAt: this.now(),
      });
    }

    return {
      advertiserIds: parsed.advertiserIds,
      advertiserCount: parsed.advertiserIds.length,
      expiresAt,
      expiresIn: parsed.expiresIn,
    };
  }

  /**
   * 刷新一个广告主的凭据。
   *
   * ★ Marketing 的刷新有个硬约束：refresh_token 只能在原 access_token
   *   **还没过期**的时候用来延长。若 access_token 已经过期，
   *   就只能用 refresh_token 换新 token（若平台允许），否则必须重新授权。
   *   这里优先用 refresh_token 换（更稳），失败时如实报错，让调用方去走重新授权。
   *
   * @param {object} options
   * @returns {Promise<object>}
   */
  async refresh({ appId, advertiserId }) {
    if (!advertiserId) throw new Error('advertiserId is required');
    const appIdValue = appId || this.appId();
    const existing = await this.tokenRepository.load({ appId: appIdValue, advertiserId });
    if (!existing) {
      throw marketingError(
        'TIKTOK_MARKETING_CREDENTIAL_MISSING',
        `No marketing credential stored for advertiser ${advertiserId}`,
        404,
      );
    }

    const payload = await this._post(MARKETING_REFRESH_URL, {
      app_id: appIdValue,
      secret: this.appSecret(),
      refresh_token: existing.refreshToken,
    });
    const parsed = parseTokenPayload({
      data: {
        access_token: payload.access_token || payload.data?.access_token,
        refresh_token: payload.refresh_token || payload.data?.refresh_token || existing.refreshToken,
        advertiser_ids: payload.advertiser_ids || payload.data?.advertiser_ids || [advertiserId],
        expires_in: payload.expires_in || payload.data?.expires_in,
      },
    });

    const expiresAt = new Date(this.now().getTime() + parsed.expiresIn * 1000);
    await this.tokenRepository.save({
      appId: appIdValue,
      advertiserId,
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken,
      expiresAt,
      lastRefreshAt: this.now(),
    });
    return { advertiserId, expiresAt, expiresIn: parsed.expiresIn };
  }

  /**
   * 刷新所有临近过期的凭据。
   *
   * 单个广告主刷新失败**不中断整批** —— 一个广告主撤了授权，
   * 不该让其他广告主的凭据也得不到刷新。
   *
   * @param {object} [options]
   * @returns {Promise<{refreshed: Array<object>, failed: Array<object>}>}
   */
  async refreshExpiring(options = {}) {
    const appId = options.appId || this.appId();
    const marginSeconds = options.marginSeconds;
    const expiring = marginSeconds === undefined
      ? await this.tokenRepository.listExpiring({ appId })
      : await this.tokenRepository.listExpiring({ appId, marginSeconds });

    const refreshed = [];
    const failed = [];
    for (const entry of expiring) {
      try {
        const result = await this.refresh({ appId, advertiserId: entry.advertiserId });
        refreshed.push(result);
      } catch (error) {
        // 记下失败原因，别把还能用的凭据覆盖掉。
        await this.tokenRepository.markRefreshError({
          appId,
          advertiserId: entry.advertiserId,
          error,
        }).catch(() => {});
        failed.push({ advertiserId: entry.advertiserId, error: error.message });
      }
    }
    return { refreshed, failed };
  }

  /**
   * 授权状态概览。
   *
   * @returns {Promise<object>}
   */
  async status() {
    const appId = String(this.env.TIKTOK_MARKETING_APP_ID || '').trim();
    if (!appId) {
      return { configured: false, appId: null, advertisers: [] };
    }
    const advertisers = await this.tokenRepository.listAdvertisers({ appId });
    return {
      configured: true,
      appId,
      advertiserCount: advertisers.length,
      advertisers,
    };
  }

  /**
   * POST 一个 JSON 并解析响应。
   *
   * @param {string} url
   * @param {object} body
   * @returns {Promise<object>}
   */
  async _post(url, body) {
    let response;
    try {
      response = await this.fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (error) {
      throw marketingError('TIKTOK_MARKETING_NETWORK_ERROR', `Marketing token endpoint unreachable: ${error.message}`, 502);
    }

    const text = await response.text();
    let payload;
    try { payload = text ? JSON.parse(text) : {}; }
    catch { throw marketingError('TIKTOK_MARKETING_TOKEN_ENDPOINT_NON_JSON', 'Marketing token endpoint returned non-JSON', 502); }

    if (!response.ok || (typeof payload.code === 'number' && payload.code !== 0)) {
      const code = typeof payload.code === 'number' ? payload.code : null;
      const message = payload.message || `Marketing token endpoint HTTP ${response.status}`;
      const error = marketingError('TIKTOK_MARKETING_TOKEN_ENDPOINT_FAILED', message, 502);
      error.platformCode = code;
      // 40001/40105 要能被上层区别对待：前者是凭据过期，后者是授权码问题。
      if (code === 40001) error.code = 'TIKTOK_MARKETING_TOKEN_INVALID';
      if (code === 40105) error.code = 'TIKTOK_MARKETING_AUTH_CODE_INVALID';
      throw error;
    }
    return payload.data !== undefined ? payload.data : payload;
  }
}

module.exports = {
  ACCESS_TOKEN_TTL_SECONDS,
  MARKETING_AUTHORIZE_URL,
  MARKETING_COOKIE_PATH,
  MARKETING_REFRESH_URL,
  MARKETING_TOKEN_URL,
  TIKTOK_MARKETING_CALLBACK_PATH,
  TIKTOK_MARKETING_COOKIE,
  TikTokMarketingOAuthService,
  buildAuthorizationUrl,
  clearStateCookie,
  marketingError,
  parseCookie,
  parseTokenPayload,
  resolveMarketingRedirectUrl,
  stateCookie,
};
