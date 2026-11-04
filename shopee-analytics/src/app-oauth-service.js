'use strict';

/**
 * The authorization of a shop for one of the other applications.
 *
 * The shop side and the ERP each have their own service, because each
 * was written when its application was the only one of its kind. The
 * applications that came afterwards — the affiliate marketing, the
 * videos, the online shops — are all authorized the same way: the shop
 * signs in on Shopee's own page, ticks the shops, and comes back with a
 * code. So one service does that for whichever application asked for it.
 *
 * Which application a callback belongs to is not carried in the query:
 * it is read back from the state, which is where it was put when the
 * authorization began.
 */

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

const APP_CALLBACK_PATH = '/api/shopee-analytics/app/oauth/callback';
const APP_STATE_COOKIE = 'shopee_app_oauth_state';

/**
 * The applications this service may authorize a shop for.
 *
 * The shop side and the ERP are not here: they have services of their
 * own, and an authorization that went through the wrong one would store
 * its token against the wrong application.
 */
const SUPPORTED_ROLES = Object.freeze(['MARKETING', 'VIDEO', 'ONLINE', 'STORE_OPS_BRAIN', 'ORDER_ANALYSIS']);

function rolePrefix(role) {
  return `SHOPEE_${String(role || '').trim().toUpperCase()}`;
}

/**
 * Where the application is told to send the seller back.
 *
 * The domain has to be the one the application declared in the console,
 * and the path is counted as part of it — a trailing slash is a
 * different path.
 */
function resolveAppRedirectUrl(role, env = process.env) {
  const prefix = rolePrefix(role);
  const explicit = String(env[`${prefix}_REDIRECT_URL`] || '').trim();
  const raw = explicit;
  if (!raw) throw new Error(`${prefix}_REDIRECT_URL is required for ${role}`);
  let url;
  try { url = new URL(raw); } catch { throw new Error(`${role} redirect URL must be absolute`); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
    throw new Error(`${role} redirect URL must be HTTPS and carry no credentials`);
  }
  return url.toString();
}

function stateCookie(state, ttlSeconds) {
  return `${APP_STATE_COOKIE}=${encodeURIComponent(state)}; Max-Age=${ttlSeconds}; Path=/api/shopee-analytics/app/oauth; HttpOnly; Secure; SameSite=Lax`;
}

function clearStateCookie() {
  return `${APP_STATE_COOKIE}=; Max-Age=0; Path=/api/shopee-analytics/app/oauth; HttpOnly; Secure; SameSite=Lax`;
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

/**
 * The shops a token reaches.
 */
function authorizedShopIdsFrom(response) {
  const raw = response && (response.authorized_shops || response.shop_id_list);
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map(Number).filter(Number.isSafeInteger).filter(id => id > 0))];
}

class AppOAuthService {
  constructor({ pool, env = process.env, now = () => new Date(), randomBytes, fetchImpl = global.fetch } = {}) {
    if (!pool || typeof pool.query !== 'function') throw new Error('pool is required');
    this.pool = pool;
    this.env = env;
    this.now = now;
    this.randomBytes = randomBytes;
    this.fetchImpl = fetchImpl;
    this.stateRepository = new ShopeeOAuthStateRepository({ pool });
  }

  credentialsConfigured(role) {
    const prefix = rolePrefix(role);
    return Boolean(String(this.env[`${prefix}_PARTNER_ID`] || '').trim()) &&
      Boolean(String(this.env[`${prefix}_PARTNER_KEY`] || '').trim());
  }

  authClient(role) {
    const credential = loadAppCredential(role, { requireToken: false, env: this.env });
    return new ShopeeAuthClient({
      partnerId: credential.partnerId,
      partnerKey: credential.partnerKey,
      fetchImpl: this.fetchImpl,
    });
  }

  async status({ role, shopId }) {
    const id = Number(shopId);
    const result = await this.pool.query(
      `SELECT EXISTS(SELECT 1 FROM shopee_app_tokens t
                WHERE t.app_role=$1 AND t.shop_id=$2) AS token_present,
              (SELECT t.refresh_error FROM shopee_app_tokens t
                WHERE t.app_role=$1 AND t.shop_id=$2) AS token_refresh_error`,
      [role, id],
    );
    const row = result.rows[0] || {};
    return {
      role,
      shopId: id,
      credentialConfigured: this.credentialsConfigured(role),
      tokenPresent: Boolean(row.token_present),
      tokenRefreshError: row.token_refresh_error || null,
      redirectUrl: (() => { try { return resolveAppRedirectUrl(role, this.env); } catch { return null; } })(),
    };
  }

  async beginAuthorization({ role, shopId }) {
    const appRole = String(role || '').trim().toUpperCase();
    if (!SUPPORTED_ROLES.includes(appRole)) throw oauthError('UNSUPPORTED_APP_ROLE', 400);
    const id = Number(shopId);
    if (!Number.isSafeInteger(id) || id <= 0) throw oauthError('INVALID_SHOP_ID', 400);
    const exists = await this.pool.query('SELECT 1 FROM shopee_shop_profiles WHERE shop_id=$1 AND active=true', [id]);
    if (!exists.rows.length) throw oauthError('SHOP_NOT_CONFIGURED', 404);
    const redirectUri = resolveAppRedirectUrl(appRole, this.env);
    const ttlSeconds = validateOAuthStateTtl(this.env);
    const authClient = this.authClient(appRole);
    const state = generateState(this.randomBytes);
    const now = this.now();
    await this.stateRepository.create({
      stateHash: hashState(state),
      appRole,
      expectedShopId: id,
      redirectUri,
      expiresAt: new Date(now.getTime() + ttlSeconds * 1000),
    });
    return {
      state,
      ttlSeconds,
      authorizationUrl: authClient.buildAuthorizationUrl({ redirectUri }),
      shopId: id,
      role: appRole,
    };
  }

  async completeAuthorization({ state, code, providerError = null }) {
    const stateHash = hashState(state);
    const now = this.now();
    const active = await this.stateRepository.findActive({ stateHash, now });
    if (!active || !SUPPORTED_ROLES.includes(active.app_role)) {
      throw oauthError('APP_OAUTH_INVALID_OR_EXPIRED_STATE', 400);
    }
    if (providerError) throw oauthError('APP_OAUTH_PROVIDER_ERROR', 400);
    if (!code || typeof code !== 'string') throw oauthError('APP_OAUTH_MISSING_CODE', 400);
    const consumed = await this.stateRepository.consume({ stateHash, now });
    if (!consumed) throw oauthError('APP_OAUTH_INVALID_OR_REPLAYED_STATE', 400);

    const appRole = active.app_role;
    try {
      const response = await this.authClient(appRole).exchangeAuthorizationCode({ code });
      const authorizedShopIds = authorizedShopIdsFrom(response);
      if (!authorizedShopIds.length) throw oauthError('APP_OAUTH_INVALID_TOKEN_RESPONSE', 502);
      const expireIn = Number(response && response.expire_in);
      if (!response.access_token || !response.refresh_token || !Number.isFinite(expireIn) || expireIn <= 0) {
        throw oauthError('APP_OAUTH_INVALID_TOKEN_RESPONSE', 502);
      }
      const expectedShopId = Number(active.expected_shop_id);
      const tokenRepository = new ShopeeTokenRepository({
        pool: this.pool,
        masterKey: loadMasterKey(this.env),
      });
      // A main account authorizes its shops in one go and the token it
      // returns reaches every shop the seller ticked, so each shop that
      // is both authorized and known here gets a copy of it.
      const known = await this.pool.query(
        'SELECT shop_id FROM shopee_shop_profiles WHERE shop_id = ANY($1::bigint[])',
        [authorizedShopIds],
      );
      const targetShopIds = known.rows.map(row => Number(row.shop_id));
      if (!targetShopIds.includes(expectedShopId)) targetShopIds.push(expectedShopId);
      for (const shopId of targetShopIds) {
        await tokenRepository.save({
          appRole,
          shopId,
          accessToken: response.access_token,
          refreshToken: response.refresh_token,
          expiresAt: new Date(now.getTime() + expireIn * 1000),
          lastRefreshAt: now,
          refreshError: null,
        });
      }
      return { role: appRole, shopId: expectedShopId, shopIds: targetShopIds };
    } catch (error) {
      throw safeError(error, 'APP_OAUTH_TOKEN_EXCHANGE_FAILED');
    }
  }
}

module.exports = {
  APP_CALLBACK_PATH,
  APP_STATE_COOKIE,
  SUPPORTED_ROLES,
  resolveAppRedirectUrl,
  stateCookie,
  clearStateCookie,
  parseCookie,
  AppOAuthService,
};
