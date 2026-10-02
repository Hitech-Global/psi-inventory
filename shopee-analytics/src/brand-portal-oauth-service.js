'use strict';

const { ShopeeAuthClient } = require('./auth-client');
const { ShopeeOAuthStateRepository } = require('./oauth-state-repository');
const { ShopeeTokenRepository } = require('./token-repository');
const { loadMasterKey } = require('./token-crypto');
const { loadAppCredential } = require('./config');
const {
  generateState,
  hashState,
  validateOAuthStateTtl,
  oauthError,
  safeError,
} = require('./oauth-security');

const BRAND_PORTAL_COOKIE = 'shopee_brand_portal_oauth_state';
const BRAND_PORTAL_CALLBACK_PATH = '/api/shopee-analytics/brand-portal/oauth/callback';

function resolveBrandPortalRedirectUrl(env = process.env) {
  const explicit = String(env.SHOPEE_BRAND_PORTAL_REDIRECT_URL || '').trim();
  const base = String(env.FEISHU_EXTERNAL_BASE_URL || '').trim().replace(/\/$/, '');
  const raw = explicit || (base ? `${base}${BRAND_PORTAL_CALLBACK_PATH}` : '');
  if (!raw) throw new Error('SHOPEE_BRAND_PORTAL_REDIRECT_URL or FEISHU_EXTERNAL_BASE_URL is required');
  let url;
  try { url = new URL(raw); } catch { throw new Error('Brand Portal redirect URL must be absolute HTTPS'); }
  if (url.protocol !== 'https:' || url.pathname !== BRAND_PORTAL_CALLBACK_PATH || url.username || url.password || url.hash) {
    throw new Error(`Brand Portal redirect URL must be HTTPS and end in ${BRAND_PORTAL_CALLBACK_PATH}`);
  }
  return url.toString();
}

function stateCookie(state, ttlSeconds) {
  return `${BRAND_PORTAL_COOKIE}=${encodeURIComponent(state)}; Max-Age=${ttlSeconds}; Path=/api/shopee-analytics/brand-portal/oauth; HttpOnly; Secure; SameSite=Lax`;
}

function clearStateCookie() {
  return `${BRAND_PORTAL_COOKIE}=; Max-Age=0; Path=/api/shopee-analytics/brand-portal/oauth; HttpOnly; Secure; SameSite=Lax`;
}

function parseCookie(header, name) {
  for (const pair of String(header || '').split(';')) {
    const index = pair.indexOf('=');
    if (index < 1) continue;
    if (pair.slice(0, index).trim() !== name) continue;
    try { return decodeURIComponent(pair.slice(index + 1).trim()); } catch { return ''; }
  }
  return '';
}

class BrandPortalOAuthService {
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
    return Boolean(String(this.env.SHOPEE_BRAND_PORTAL_PARTNER_ID || '').trim()) &&
      Boolean(String(this.env.SHOPEE_BRAND_PORTAL_PARTNER_KEY || '').trim());
  }

  authClient() {
    const credential = loadAppCredential('BRAND_PORTAL', { requireToken: false, env: this.env });
    return new ShopeeAuthClient({
      partnerId: credential.partnerId,
      partnerKey: credential.partnerKey,
      fetchImpl: this.fetchImpl,
    });
  }

  async status({ shopId }) {
    const id = Number(shopId);
    const result = await this.pool.query(
      `SELECT p.brand_portal_principal_id,p.brand_portal_timezone,
              EXISTS(SELECT 1 FROM shopee_app_tokens t
                     WHERE t.app_role='BRAND_PORTAL' AND t.shop_id=p.brand_portal_principal_id) AS token_present
       FROM shopee_shop_profiles p WHERE p.shop_id=$1`,
      [id],
    );
    if (!result.rows.length) throw oauthError('SHOP_NOT_CONFIGURED', 404);
    const row = result.rows[0];
    return {
      shopId: id,
      credentialConfigured: this.credentialsConfigured(),
      principalId: row.brand_portal_principal_id == null ? null : Number(row.brand_portal_principal_id),
      timezoneConfigured: Boolean(row.brand_portal_timezone),
      tokenPresent: Boolean(row.token_present),
      redirectUrl: (() => { try { return resolveBrandPortalRedirectUrl(this.env); } catch { return null; } })(),
    };
  }

  async beginAuthorization({ shopId }) {
    const id = Number(shopId);
    if (!Number.isSafeInteger(id) || id <= 0) throw oauthError('INVALID_SHOP_ID', 400);
    const exists = await this.pool.query('SELECT 1 FROM shopee_shop_profiles WHERE shop_id=$1 AND active=true', [id]);
    if (!exists.rows.length) throw oauthError('SHOP_NOT_CONFIGURED', 404);
    const redirectUri = resolveBrandPortalRedirectUrl(this.env);
    const ttlSeconds = validateOAuthStateTtl(this.env);
    const authClient = this.authClient();
    const state = generateState(this.randomBytes);
    const now = this.now();
    await this.stateRepository.create({
      stateHash: hashState(state),
      appRole: 'BRAND_PORTAL',
      expectedShopId: id,
      redirectUri,
      expiresAt: new Date(now.getTime() + ttlSeconds * 1000),
    });
    return {
      state,
      ttlSeconds,
      authorizationUrl: authClient.buildAuthorizationUrl({ redirectUri, authType: 'principal' }),
      shopId: id,
    };
  }

  async completeAuthorization({ state, code, providerError = null }) {
    const stateHash = hashState(state);
    const now = this.now();
    const active = await this.stateRepository.findActive({ stateHash, now });
    if (!active || active.app_role !== 'BRAND_PORTAL') throw oauthError('BRAND_PORTAL_OAUTH_INVALID_OR_EXPIRED_STATE', 400);
    if (providerError) throw oauthError('BRAND_PORTAL_OAUTH_PROVIDER_ERROR', 400);
    if (!code || typeof code !== 'string') throw oauthError('BRAND_PORTAL_OAUTH_MISSING_CODE', 400);
    const consumed = await this.stateRepository.consume({ stateHash, now });
    if (!consumed) throw oauthError('BRAND_PORTAL_OAUTH_INVALID_OR_REPLAYED_STATE', 400);

    try {
      const response = await this.authClient().exchangeAuthorizationCode({ code });
      const principalIds = Array.isArray(response && response.principal_id_list)
        ? [...new Set(response.principal_id_list.map(Number).filter(Number.isSafeInteger))]
        : [];
      if (principalIds.length !== 1 || principalIds[0] <= 0) {
        throw oauthError(principalIds.length > 1 ? 'BRAND_PORTAL_MULTIPLE_PRINCIPALS' : 'BRAND_PORTAL_INVALID_PRINCIPAL_RESPONSE', 409);
      }
      const expireIn = Number(response && response.expire_in);
      if (!response.access_token || !response.refresh_token || !Number.isFinite(expireIn) || expireIn <= 0) {
        throw oauthError('BRAND_PORTAL_INVALID_TOKEN_RESPONSE', 502);
      }
      const principalId = principalIds[0];
      const shopId = Number(active.expected_shop_id);
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        const tokenRepository = new ShopeeTokenRepository({ pool: client, masterKey: loadMasterKey(this.env) });
        await tokenRepository.save({
          appRole: 'BRAND_PORTAL',
          shopId: principalId,
          accessToken: response.access_token,
          refreshToken: response.refresh_token,
          expiresAt: new Date(now.getTime() + expireIn * 1000),
          lastRefreshAt: now,
          refreshError: null,
        });
        const mapped = await client.query(
          `UPDATE shopee_shop_profiles
           SET brand_portal_principal_id=$2,updated_at=now()
           WHERE shop_id=$1 RETURNING shop_id`,
          [shopId, principalId],
        );
        if (!mapped.rows.length) throw oauthError('SHOP_NOT_CONFIGURED', 404);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally { client.release(); }
      return { shopId, principalId };
    } catch (error) {
      throw safeError(error, 'BRAND_PORTAL_OAUTH_TOKEN_EXCHANGE_FAILED');
    }
  }
}

module.exports = {
  BRAND_PORTAL_COOKIE,
  BRAND_PORTAL_CALLBACK_PATH,
  resolveBrandPortalRedirectUrl,
  stateCookie,
  clearStateCookie,
  parseCookie,
  BrandPortalOAuthService,
};
