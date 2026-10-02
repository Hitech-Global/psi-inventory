'use strict';

const { ShopeeOAuthStateRepository } = require('./oauth-state-repository');
const { ShopeeTokenRepository } = require('./token-repository');
const { ShopeeAuthClient } = require('./auth-client');
const { loadAppCredential } = require('./config');
const { loadMasterKey } = require('./token-crypto');
const {
  generateState,
  hashState,
  validateOAuthStateTtl,
  oauthError,
  safeError,
} = require('./oauth-security');

const ERP_COOKIE = 'shopee_erp_oauth_state';
const ERP_CALLBACK_PATH = '/api/shopee-analytics/erp/oauth/callback';

function resolveErpRedirectUrl(env = process.env) {
  const explicit = String(env.SHOPEE_ERP_REDIRECT_URL || '').trim();
  const base = String(env.FEISHU_EXTERNAL_BASE_URL || '').trim().replace(/\/$/, '');
  const raw = explicit || (base ? `${base}${ERP_CALLBACK_PATH}` : '');
  if (!raw) throw new Error('SHOPEE_ERP_REDIRECT_URL or FEISHU_EXTERNAL_BASE_URL is required');
  let url;
  try { url = new URL(raw); } catch { throw new Error('ERP redirect URL must be absolute HTTPS'); }
  if (url.protocol !== 'https:' || url.pathname !== ERP_CALLBACK_PATH || url.username || url.password || url.hash) {
    throw new Error(`ERP redirect URL must be HTTPS and end in ${ERP_CALLBACK_PATH}`);
  }
  return url.toString();
}

function stateCookie(state, ttlSeconds) {
  return `${ERP_COOKIE}=${encodeURIComponent(state)}; Max-Age=${ttlSeconds}; Path=/api/shopee-analytics/erp/oauth; HttpOnly; Secure; SameSite=Lax`;
}

function clearStateCookie() {
  return `${ERP_COOKIE}=; Max-Age=0; Path=/api/shopee-analytics/erp/oauth; HttpOnly; Secure; SameSite=Lax`;
}

function parseCookie(header, name) {
  for (const pair of String(header || '').split(';')) {
    const index = pair.indexOf('=');
    if (index < 1 || pair.slice(0, index).trim() !== name) continue;
    try { return decodeURIComponent(pair.slice(index + 1).trim()); } catch { return ''; }
  }
  return '';
}

function positiveShopIds(value) {
  if (!Array.isArray(value) || !value.length) throw oauthError('ERP_OAUTH_INVALID_TOKEN_RESPONSE', 502);
  const ids = value.map(entry => {
    const number = Number(entry);
    if (!Number.isSafeInteger(number) || number <= 0) throw oauthError('ERP_OAUTH_INVALID_TOKEN_RESPONSE', 502);
    return number;
  });
  return [...new Set(ids)];
}

class ErpOAuthService {
  constructor({ pool, env = process.env, now = () => new Date(), randomBytes, fetchImpl = global.fetch } = {}) {
    if (!pool || typeof pool.query !== 'function') throw new Error('pool is required');
    this.pool = pool;
    this.env = env;
    this.now = now;
    this.randomBytes = randomBytes;
    this.fetchImpl = fetchImpl;
    this.stateRepository = new ShopeeOAuthStateRepository({ pool });
  }

  credentialsConfigured() {
    return Boolean(String(this.env.SHOPEE_ERP_PARTNER_ID || '').trim()) &&
      Boolean(String(this.env.SHOPEE_ERP_PARTNER_KEY || '').trim());
  }

  authClient() {
    const credential = loadAppCredential('ERP', { requireToken: false, env: this.env });
    return new ShopeeAuthClient({
      partnerId: credential.partnerId,
      partnerKey: credential.partnerKey,
      fetchImpl: this.fetchImpl,
    });
  }
  async status({ shopId }) {
    const id = Number(shopId);
    const result = await this.pool.query(
      `SELECT p.shop_id,
              t.expires_at AS token_expires_at,
              t.refresh_error AS token_refresh_error
       FROM shopee_shop_profiles p
       LEFT JOIN shopee_app_tokens t ON t.app_role='ERP' AND t.shop_id=p.shop_id
       WHERE p.shop_id=$1`,
      [id],
    );
    if (!result.rows.length) throw oauthError('SHOP_NOT_CONFIGURED', 404);
    const row = result.rows[0];
    return {
      shopId: id,
      credentialConfigured: this.credentialsConfigured(),
      tokenPresent: Boolean(row.token_expires_at),
      tokenExpiresAt: row.token_expires_at || null,
      tokenRefreshError: row.token_refresh_error || null,
      redirectUrl: (() => { try { return resolveErpRedirectUrl(this.env); } catch { return null; } })(),
    };
  }

  async beginAuthorization({ shopId }) {
    const id = Number(shopId);
    if (!Number.isSafeInteger(id) || id <= 0) throw oauthError('INVALID_SHOP_ID', 400);
    const exists = await this.pool.query(
      'SELECT 1 FROM shopee_shop_profiles WHERE shop_id=$1 AND active=true',
      [id],
    );
    if (!exists.rows.length) throw oauthError('SHOP_NOT_CONFIGURED', 404);
    const redirectUri = resolveErpRedirectUrl(this.env);
    const ttlSeconds = validateOAuthStateTtl(this.env);
    const state = generateState(this.randomBytes);
    const now = this.now();
    await this.stateRepository.create({
      stateHash: hashState(state),
      appRole: 'ERP',
      expectedShopId: id,
      redirectUri,
      expiresAt: new Date(now.getTime() + ttlSeconds * 1000),
    });
    return {
      state,
      ttlSeconds,
      authorizationUrl: this.authClient().buildAuthorizationUrl({ redirectUri }),
      shopId: id,
    };
  }

  async completeAuthorization({ state, code, providerError = null }) {
    const stateHash = hashState(state);
    const now = this.now();
    const active = await this.stateRepository.findActive({ stateHash, now });
    if (!active || active.app_role !== 'ERP') throw oauthError('ERP_OAUTH_INVALID_OR_EXPIRED_STATE', 400);
    if (providerError) throw oauthError('ERP_OAUTH_PROVIDER_ERROR', 400);
    if (!code || typeof code !== 'string') throw oauthError('ERP_OAUTH_MISSING_CODE', 400);
    const consumed = await this.stateRepository.consume({ stateHash, now });
    if (!consumed) throw oauthError('ERP_OAUTH_INVALID_OR_REPLAYED_STATE', 400);

    try {
      const response = await this.authClient().exchangeAuthorizationCode({ code });
      const authorizedShopIds = positiveShopIds(response && response.shop_id_list);
      const shopId = Number(active.expected_shop_id);
      if (!authorizedShopIds.includes(shopId)) throw oauthError('ERP_OAUTH_SHOP_NOT_ALLOWED', 403);
      const expireIn = Number(response && response.expire_in);
      if (!response.access_token || !response.refresh_token || !Number.isFinite(expireIn) || expireIn <= 0) {
        throw oauthError('ERP_OAUTH_INVALID_TOKEN_RESPONSE', 502);
      }
      const tokenRepository = new ShopeeTokenRepository({
        pool: this.pool,
        masterKey: loadMasterKey(this.env),
      });
      await tokenRepository.save({
        appRole: 'ERP',
        shopId,
        accessToken: response.access_token,
        refreshToken: response.refresh_token,
        expiresAt: new Date(now.getTime() + expireIn * 1000),
        lastRefreshAt: now,
        refreshError: null,
      });
      return { shopId, authorizedShopIds };
    } catch (error) {
      throw safeError(error, 'ERP_OAUTH_TOKEN_EXCHANGE_FAILED');
    }
  }
}

module.exports = {
  ERP_COOKIE,
  ERP_CALLBACK_PATH,
  resolveErpRedirectUrl,
  stateCookie,
  clearStateCookie,
  parseCookie,
  positiveShopIds,
  ErpOAuthService,
};
