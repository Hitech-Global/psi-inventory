'use strict';

const { ShopeeOAuthStateRepository } = require('./oauth-state-repository');
const { ShopeeShopProfileRepository } = require('./shop-profile-repository');
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

/**
 * The shops a token reaches.
 *
 * Shopee answers with a single shop when one shop was authorized, and with
 * a list when a main account authorized several. Reading only the list
 * meant that the single-shop case looked like nothing had been authorized.
 */
function authorizedShopIdsFrom(response) {
  const ids = [];
  if (response && Array.isArray(response.shop_id_list)) ids.push(...response.shop_id_list);
  if (response && response.shop_id !== undefined && response.shop_id !== null) ids.push(response.shop_id);
  const normalized = ids
    .map(entry => Number(entry))
    .filter(number => Number.isSafeInteger(number) && number > 0);
  return [...new Set(normalized)];
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
  constructor({
    pool,
    env = process.env,
    now = () => new Date(),
    randomBytes,
    fetchImpl = global.fetch,
    profileRepository = null,
  } = {}) {
    if (!pool || typeof pool.query !== 'function') throw new Error('pool is required');
    this.pool = pool;
    this.env = env;
    this.now = now;
    this.randomBytes = randomBytes;
    this.fetchImpl = fetchImpl;
    this.stateRepository = new ShopeeOAuthStateRepository({ pool });
    this.profileRepository = profileRepository || new ShopeeShopProfileRepository({ pool });
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

  /**
   * Begin an authorization.
   *
   * Normally this connects an existing shop to the returns role. When the
   * reader is adding a shop that is not known here yet, the shop's number
   * is not known either — it only becomes known when the code is exchanged.
   * So the details the reader gave travel with the request, and the shop
   * is registered on the way back.
   */
  async beginAuthorization({ shopId, register = null }) {
    const id = Number(shopId);
    const registration = register ? this.normalizeRegistration(register) : null;
    if (!registration && (!Number.isSafeInteger(id) || id <= 0)) {
      throw oauthError('INVALID_SHOP_ID', 400);
    }
    if (!registration) {
      const exists = await this.pool.query(
        'SELECT 1 FROM shopee_shop_profiles WHERE shop_id=$1 AND active=true',
        [id],
      );
      if (!exists.rows.length) throw oauthError('SHOP_NOT_CONFIGURED', 404);
    }
    const redirectUri = resolveErpRedirectUrl(this.env);
    const ttlSeconds = validateOAuthStateTtl(this.env);
    const state = generateState(this.randomBytes);
    const now = this.now();
    await this.stateRepository.create({
      stateHash: hashState(state),
      appRole: 'ERP',
      // The shop's own number is not known until the code is exchanged, so
      // the request carries zero in its place.
      expectedShopId: registration ? 0 : id,
      redirectUri,
      expiresAt: new Date(now.getTime() + ttlSeconds * 1000),
      registerMode: registration ? 'REGISTER' : null,
      registerCountryCode: registration ? registration.countryCode : null,
      registerBrandCode: registration ? registration.brandCode : null,
      registerDisplayName: registration ? registration.displayName : null,
    });
    return {
      state,
      ttlSeconds,
      authorizationUrl: this.authClient().buildAuthorizationUrl({ redirectUri }),
      shopId: registration ? null : id,
      registering: Boolean(registration),
    };
  }

  /**
   * The details a reader gave for a shop they are adding.
   */
  normalizeRegistration(register) {
    const countryCode = String(register.countryCode || '').trim().toUpperCase();
    const brandCode = String(register.brandCode || '').trim().toUpperCase();
    const displayName = String(register.displayName || '').trim();
    if (!countryCode) throw oauthError('INVALID_SHOP_ID', 400);
    if (!brandCode) throw oauthError('INVALID_SHOP_ID', 400);
    if (!displayName) throw oauthError('INVALID_SHOP_ID', 400);
    return { countryCode, brandCode, displayName };
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
      const authorizedShopIds = authorizedShopIdsFrom(response);
      if (!authorizedShopIds.length) throw oauthError('ERP_OAUTH_INVALID_TOKEN_RESPONSE', 502);
      const registering = active.register_mode === 'REGISTER';
      const shopId = registering ? authorizedShopIds[0] : Number(active.expected_shop_id);
      const expireIn = Number(response && response.expire_in);
      if (!response.access_token || !response.refresh_token || !Number.isFinite(expireIn) || expireIn <= 0) {
        throw oauthError('ERP_OAUTH_INVALID_TOKEN_RESPONSE', 502);
      }
      const tokenRepository = new ShopeeTokenRepository({
        pool: this.pool,
        masterKey: loadMasterKey(this.env),
      });
      // A main account authorizes its shops in one go, and the token it
      // returns reaches every shop the seller ticked. Storing it against
      // one shop would leave the others unable to fetch anything, so each
      // shop that is both authorized and known here gets a copy.
      let targetShopIds;
      if (registering) {
        // The shop is on the platform and the token reaches it; it is now
        // known here too, so its figures have somewhere to arrive.
        const registered = await this.profileRepository.registerApiShop({
          shopId,
          countryCode: active.register_country_code,
          brandCode: active.register_brand_code,
          displayName: active.register_display_name,
        });
        targetShopIds = [registered.shopId];
      } else {
        const known = await this.pool.query(
          'SELECT shop_id FROM shopee_shop_profiles WHERE shop_id = ANY($1::bigint[])',
          [authorizedShopIds],
        );
        targetShopIds = known.rows.map(row => Number(row.shop_id));
      }
      if (!targetShopIds.length) {
        // The seller authorized shops that this system does not know. Say so
        // in terms they can act on, and name the shops, rather than
        // returning a code that means nothing to the person who read it.
        throw oauthError(
          'ERP_OAUTH_SHOP_NOT_ALLOWED',
          403,
          `授权的店铺（${authorizedShopIds.join('、')}）不在本系统已配置的店铺里，请在授权页勾选已配置的店铺后重试。`,
        );
      }
      for (const targetShopId of targetShopIds) {
        await tokenRepository.save({
          appRole: 'ERP',
          shopId: targetShopId,
          accessToken: response.access_token,
          refreshToken: response.refresh_token,
          expiresAt: new Date(now.getTime() + expireIn * 1000),
          lastRefreshAt: now,
          refreshError: null,
        });
      }
      // The reader may have started from a shop that was not among those
      // ticked. The connection that was made is still worth having, but
      // saying so plainly matters more than the connection: a reader who
      // asked for one shop and was given another would otherwise think
      // the shop they asked for is connected when it is not.
      const connectedExpected = targetShopIds.includes(shopId);
      return {
        shopId: connectedExpected ? shopId : targetShopIds[0],
        authorizedShopIds,
        connectedShopIds: targetShopIds,
        expectedShopId: shopId,
        expectedShopConnected: connectedExpected,
        registered: registering,
      };
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
