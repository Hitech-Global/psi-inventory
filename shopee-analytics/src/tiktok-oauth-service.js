'use strict';

/**
 * TikTok Shop 授权服务。
 * ============================================================================================
 * 依据官方 Authorization overview（document_id 678e3a3292b0f40314a92d75）：
 *
 *   1. 用户打开授权链接并同意（或拒绝）
 *   2. 同意后跳转到 Redirect URL，带上临时 `code` 与 `state`
 *      拒绝时也会跳转，但 `code` 为 null 且带 `error=auth_denied`
 *   3. 用 code 换 token
 *
 * 三个容易踩的点：
 *
 *   - `auth_code` **30 分钟过期且只能用一次**，必须立即兑换。
 *   - `grant_type` 的合法值是 **`authorized_code`**，不是标准 OAuth 的 `authorization_code`。
 *     官方明确写了不要"修正"它，否则请求会失败。
 *   - 授权链接的域名按市场与角色区分：
 *       Seller · ROW → services.tiktokshop.com/open/authorize
 *       Seller · US  → services.us.tiktokshop.com/open/authorize
 *       Partner· ROW → partner.tiktokshop.com/open/authorize
 *       Partner· US  → partner.us.tiktokshop.com/open/authorize
 *     token 端点不分市场：`auth.tiktok-shops.com/api/v2/token/get` 与 `/token/refresh`。
 *
 * 本项目只用 Seller + ROW（东南亚），因此授权域名固定为 services.tiktokshop.com。
 *
 * 授权成功后必须立刻调 Get Authorized Shops 建立 (shop_id, shop_cipher) 台账 ——
 * cipher 只能从那个端点取，没有它就无法调用任何店铺级接口。
 */

const { TikTokTokenRepository } = require('./tiktok-token-repository');
const { loadMasterKey } = require('./token-crypto');
const {
  generateState,
  hashState,
  validateOAuthStateTtl,
  oauthError,
  safeError,
} = require('./oauth-security');

/** 授权链接域名。按市场与角色区分，本项目只用 Seller + ROW。 */
const AUTHORIZE_HOSTS = Object.freeze({
  'seller:ROW': 'https://services.tiktokshop.com/open/authorize',
  'seller:US': 'https://services.us.tiktokshop.com/open/authorize',
  'partner:ROW': 'https://partner.tiktokshop.com/open/authorize',
  'partner:US': 'https://partner.us.tiktokshop.com/open/authorize',
});

/** token 端点。不分市场。 */
const TOKEN_ENDPOINT = 'https://auth.tiktok-shops.com/api/v2/token/get';
const REFRESH_ENDPOINT = 'https://auth.tiktok-shops.com/api/v2/token/refresh';

/** Shop Open API 主机。 */
const API_BASE_URL = 'https://open-api.tiktokglobalshop.com';

/** 授权回调路径。 */
const TIKTOK_CALLBACK_PATH = '/api/shopee-analytics/tiktok/oauth/callback';

/** state cookie 名与作用域。 */
const TIKTOK_COOKIE = 'shopee_tiktok_oauth_state';

/**
 * 解析 Redirect URL。
 *
 * @param {object} env
 * @returns {string} 绝对 URL
 */
function resolveTikTokRedirectUrl(env = process.env) {
  const explicit = String(env.TIKTOK_REDIRECT_URL || '').trim();
  const base = String(env.FEISHU_EXTERNAL_BASE_URL || '').trim().replace(/\/$/, '');
  const raw = explicit || (base ? `${base}${TIKTOK_CALLBACK_PATH}` : '');
  if (!raw) throw new Error('TIKTOK_REDIRECT_URL or FEISHU_EXTERNAL_BASE_URL is required');
  let url;
  try { url = new URL(raw); } catch { throw new Error('TikTok redirect URL must be absolute'); }
  if (!url.pathname.endsWith(TIKTOK_CALLBACK_PATH)) {
    throw new Error(`TikTok redirect URL must end in ${TIKTOK_CALLBACK_PATH}`);
  }
  if (url.username || url.password || url.hash) {
    throw new Error('TikTok redirect URL must not carry credentials or a fragment');
  }
  return url.toString();
}

/**
 * 生成 state cookie。
 */
function stateCookie(state, ttlSeconds) {
  return `${TIKTOK_COOKIE}=${encodeURIComponent(state)}; Max-Age=${ttlSeconds}; Path=/api/shopee-analytics/tiktok/oauth; HttpOnly; Secure; SameSite=Lax`;
}

function clearStateCookie() {
  return `${TIKTOK_COOKIE}=; Max-Age=0; Path=/api/shopee-analytics/tiktok/oauth; HttpOnly; Secure; SameSite=Lax`;
}

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
 * @param {object} options
 * @param {string} options.appKey
 * @param {string} options.serviceId   应用详情页的服务标识
 * @param {string} options.redirectUri
 * @param {string} options.state
 * @param {string} [options.regionGroup] 区域组，决定授权域名
 * @param {string} [options.role] 授权角色，Seller 或 Partner
 * @returns {string} 授权链接
 */
function buildAuthorizationUrl({
  appKey,
  serviceId,
  redirectUri,
  state,
  regionGroup = 'ROW',
  role = 'seller',
}) {
  if (!appKey) throw new Error('appKey is required');
  if (!serviceId) throw new Error('serviceId is required');
  if (!redirectUri) throw new Error('redirectUri is required');
  if (!state) throw new Error('state is required');

  const host = AUTHORIZE_HOSTS[`${role}:${regionGroup}`];
  if (!host) throw new Error(`unsupported TikTok authorization role/region: ${role}/${regionGroup}`);

  const url = new URL(host);
  url.searchParams.set('service_id', serviceId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);
  return url.toString();
}

/**
 * 从 Get Authorized Shops 的响应里提取店铺台账。
 *
 * 每一项必须有 id 与 cipher —— 两者是配套的，缺一不可。
 *
 * @param {object} payload 响应体的 data 字段
 * @returns {Array<object>} 台账条目
 */
function parseAuthorizedShops(payload) {
  const shops = payload && Array.isArray(payload.shops) ? payload.shops : null;
  if (!shops) throw oauthError('TIKTOK_INVALID_SHOP_RESPONSE', 502);
  return shops.map(entry => {
    const shopId = entry && entry.id !== undefined && entry.id !== null ? String(entry.id) : '';
    const cipher = entry && entry.cipher ? String(entry.cipher) : '';
    if (!shopId) throw oauthError('TIKTOK_INVALID_SHOP_RESPONSE', 502);
    // cipher 是调用店铺级接口的必要条件；缺失说明响应不完整，不能静默跳过。
    if (!cipher) throw oauthError('TIKTOK_SHOP_MISSING_CIPHER', 502);
    return {
      shopId,
      shopCipher: cipher,
      region: entry.region ? String(entry.region) : null,
      sellerType: entry.seller_type ? String(entry.seller_type) : null,
      shopName: entry.name ? String(entry.name) : null,
    };
  });
}

class TikTokOAuthService {
  constructor({ pool, env = process.env, now = () => new Date(), randomBytes, fetchImpl = global.fetch } = {}) {
    if (!pool || typeof pool.query !== 'function') throw new Error('pool is required');
    this.pool = pool;
    this.env = env;
    this.now = now;
    this.randomBytes = randomBytes;
    this.fetchImpl = fetchImpl;
  }

  /**
   * 凭据是否已配置。
   */
  credentialsConfigured() {
    return Boolean(String(this.env.TIKTOK_APP_KEY || '').trim()) &&
      Boolean(String(this.env.TIKTOK_APP_SECRET || '').trim()) &&
      Boolean(String(this.env.TIKTOK_SERVICE_ID || '').trim());
  }

  appKey() {
    const value = String(this.env.TIKTOK_APP_KEY || '').trim();
    if (!value) throw oauthError('TIKTOK_CREDENTIALS_NOT_CONFIGURED', 503);
    return value;
  }

  appSecret() {
    const value = String(this.env.TIKTOK_APP_SECRET || '').trim();
    if (!value) throw oauthError('TIKTOK_CREDENTIALS_NOT_CONFIGURED', 503);
    return value;
  }

  serviceId() {
    const value = String(this.env.TIKTOK_SERVICE_ID || '').trim();
    if (!value) throw oauthError('TIKTOK_CREDENTIALS_NOT_CONFIGURED', 503);
    return value;
  }

  regionGroup() {
    const value = String(this.env.TIKTOK_REGION_GROUP || 'ROW').trim().toUpperCase();
    if (value !== 'ROW' && value !== 'US') {
      throw oauthError('TIKTOK_UNSUPPORTED_REGION_GROUP', 500);
    }
    return value;
  }

  /**
   * 当前授权状态。用于登录页展示。
   */
  async status() {
    const regionGroup = this.regionGroup();
    const result = await this.pool.query(
      `SELECT shop_id, shop_cipher, seller_type, region, expires_at, refresh_error, updated_at
       FROM tiktok_shop_tokens
       WHERE app_key=$1 AND region_group=$2
       ORDER BY shop_id`,
      [String(this.env.TIKTOK_APP_KEY || '').trim(), regionGroup],
    );
    return {
      platform: 'tiktok',
      credentialsConfigured: this.credentialsConfigured(),
      regionGroup,
      redirectUrl: (() => { try { return resolveTikTokRedirectUrl(this.env); } catch { return null; } })(),
      shops: result.rows.map(row => ({
        shopId: String(row.shop_id),
        // cipher 是内部标识，不回显给前端，避免被误当作可篡改的参数。
        cipherBound: Boolean(row.shop_cipher),
        sellerType: row.seller_type,
        region: row.region,
        tokenExpiresAt: row.expires_at || null,
        refreshError: row.refresh_error,
        updatedAt: row.updated_at || null,
      })),
    };
  }

  /**
   * 开始授权：生成 state 与授权链接。
   */
  async beginAuthorization() {
    const redirectUri = resolveTikTokRedirectUrl(this.env);
    const ttlSeconds = validateOAuthStateTtl(this.env);
    const state = generateState(this.randomBytes);
    const now = this.now();

    await this.pool.query(
      `INSERT INTO tiktok_oauth_states
       (state_hash, region_group, redirect_uri, expires_at, created_at)
       VALUES ($1,$2,$3,$4,$5)`,
      [
        hashState(state),
        this.regionGroup(),
        redirectUri,
        new Date(now.getTime() + ttlSeconds * 1000),
        now,
      ],
    );

    return {
      state,
      ttlSeconds,
      redirectUri,
      authorizationUrl: buildAuthorizationUrl({
        appKey: this.appKey(),
        serviceId: this.serviceId(),
        redirectUri,
        state,
        regionGroup: this.regionGroup(),
      }),
    };
  }

  /**
   * 完成授权：兑换 token，建立店铺台账。
   *
   * @param {object} options
   * @param {string} options.code
   * @param {string} options.state
   * @param {string|null} [options.providerError] 卖家拒绝时平台带来的 error
   */
  async completeAuthorization({ code, state, providerError = null }) {
    if (!state) throw oauthError('TIKTOK_OAUTH_MISSING_STATE', 400);
    const now = this.now();

    const stateHash = hashState(state);
    const found = await this.pool.query(
      `DELETE FROM tiktok_oauth_states
       WHERE state_hash=$1 AND expires_at > $2
       RETURNING region_group, redirect_uri`,
      [stateHash, now],
    );
    const record = found.rows[0];
    // state 不存在、已过期或被重放，都会走到这里。
    if (!record) throw oauthError('TIKTOK_OAUTH_INVALID_OR_REPLAYED_STATE', 400);

    if (providerError) throw oauthError('TIKTOK_OAUTH_PROVIDER_ERROR', 400);
    if (!code || typeof code !== 'string' || code === 'null') {
      throw oauthError('TIKTOK_OAUTH_MISSING_CODE', 400);
    }

    try {
      const tokenResponse = await this.exchangeCode(code);
      const shops = await this.fetchAuthorizedShops(tokenResponse.data.access_token);
      const masterKey = loadMasterKey(this.env);
      const repository = new TikTokTokenRepository({ pool: this.pool, masterKey });

      const expiresAt = tokenResponse.data.access_token_expire_in
        ? new Date(Number(tokenResponse.data.access_token_expire_in) * 1000)
        : new Date(now.getTime() + 7 * 24 * 3600 * 1000);

      for (const shop of shops) {
        // cipher 与 shop_id 成对写入 —— 仓库层会拒绝缺 cipher 的写入。
        await repository.save({
          appKey: this.appKey(),
          regionGroup: record.region_group,
          shopId: shop.shopId,
          shopCipher: shop.shopCipher,
          accessToken: tokenResponse.data.access_token,
          refreshToken: tokenResponse.data.refresh_token,
          expiresAt,
          lastRefreshAt: now,
          refreshError: null,
          sellerType: shop.sellerType,
          region: shop.region,
        });
      }

      return {
        regionGroup: record.region_group,
        shopCount: shops.length,
        shops: shops.map(shop => ({
          shopId: shop.shopId,
          sellerType: shop.sellerType,
          region: shop.region,
          shopName: shop.shopName,
        })),
      };
    } catch (error) {
      throw safeError(error, 'TIKTOK_OAUTH_TOKEN_EXCHANGE_FAILED');
    }
  }

  /**
   * 用 auth_code 兑换 token。
   *
   * 注意 grant_type 用的是 `authorized_code`，官方明确说这不是标准 OAuth 的
   * `authorization_code`，不要"修正"它。
   */
  async exchangeCode(code) {
    const url = new URL(TOKEN_ENDPOINT);
    url.searchParams.set('app_key', this.appKey());
    url.searchParams.set('app_secret', this.appSecret());
    url.searchParams.set('auth_code', code);
    url.searchParams.set('grant_type', 'authorized_code');

    const response = await this.fetchImpl(url.toString(), { method: 'GET' });
    const text = await response.text();
    let payload;
    try { payload = text ? JSON.parse(text) : {}; }
    catch { throw oauthError('TIKTOK_TOKEN_ENDPOINT_NON_JSON', 502); }

    if (!response.ok || payload.code !== 0) {
      throw oauthError('TIKTOK_TOKEN_EXCHANGE_FAILED', 502);
    }
    if (!payload.data || !payload.data.access_token || !payload.data.refresh_token) {
      throw oauthError('TIKTOK_INVALID_TOKEN_RESPONSE', 502);
    }
    return payload;
  }

  /**
   * 拉取已授权店铺台账（shop_id 与 cipher 的配对关系）。
   */
  async fetchAuthorizedShops(accessToken) {
    const { TikTokClient } = require('./tiktok-client');
    const client = new TikTokClient({
      appKey: this.appKey(),
      appSecret: this.appSecret(),
      baseUrl: API_BASE_URL,
      fetchImpl: this.fetchImpl,
    });
    const data = await client.request({
      path: '/authorization/202309/shops',
      accessToken,
    });
    return parseAuthorizedShops(data);
  }
}

module.exports = {
  API_BASE_URL,
  AUTHORIZE_HOSTS,
  REFRESH_ENDPOINT,
  TIKTOK_CALLBACK_PATH,
  TIKTOK_COOKIE,
  TOKEN_ENDPOINT,
  TikTokOAuthService,
  buildAuthorizationUrl,
  clearStateCookie,
  parseAuthorizedShops,
  parseCookie,
  resolveTikTokRedirectUrl,
  stateCookie,
};
