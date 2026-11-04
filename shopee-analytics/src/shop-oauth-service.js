'use strict';

const { ShopeeOAuthStateRepository } = require('./oauth-state-repository');
const { ShopeeShopProfileRepository } = require('./shop-profile-repository');
const { ShopeeTokenRepository } = require('./token-repository');
const { ShopeeAuthClient } = require('./auth-client');
const { loadAppCredentials } = require('./config');
const { loadMasterKey } = require('./token-crypto');
const {
  generateState,
  hashState,
  validateOAuthStateTtl,
  oauthError,
  safeError,
} = require('./oauth-security');

const SHOP_OAUTH_COOKIE = 'shopee_shop_oauth_state';
const SHOP_OAUTH_CALLBACK_PATH = '/api/shopee-analytics/shop-oauth/callback';

/**
 * The applications a shop may be connected to, and how each is named.
 *
 * Each of them is a partner of its own, so each has its own application
 * in the console, its own credentials here, and its own line in the panel
 * where the reader connects a shop. They all work the same way: the shop
 * signs in at the platform and ticks the shops, and the token that comes
 * back is stored against the shop.
 */
const SHOP_ROLES = Object.freeze({
  VIDEO: {
    role: 'VIDEO',
    label: '视频',
    labelEn: 'Video',
    scope: '店铺视频与视频表现',
    scopeEn: 'shop videos and their performance',
    // The videos belong to the person behind the shop rather than to the
    // shop itself, so the token is kept against that person and the
    // calls are made in their name.
    identity: 'user',
    userColumn: 'video_user_id',
  },
  ONLINE: {
    role: 'ONLINE',
    label: '直播',
    labelEn: 'Livestream',
    scope: '店铺直播与直播表现',
    scopeEn: 'shop livestreams and their performance',
    identity: 'user',
    userColumn: 'livestream_user_id',
    // The livestream endpoints are signed with the person's number, and
    // the authorization says which kind of person is being authorized:
    // a seller streamer keeps the shop, an affiliate streamer does not.
    authType: 'seller',
  },
});

/**
 * Where the platform sends the seller back to.
 *
 * Each application may have its own address, and where one is set it is
 * the one used — the address declared in the console for that application
 * is the one the platform will send the seller back to.
 */
function resolveShopOAuthRedirectUrl(env = process.env, role = null) {
  const explicit = role
    ? String(env[`SHOPEE_${String(role).toUpperCase()}_REDIRECT_URL`] || '').trim()
    : '';
  const base = String(env.FEISHU_EXTERNAL_BASE_URL || '').trim().replace(/\/$/, '');
  const raw = explicit || (base ? `${base}${SHOP_OAUTH_CALLBACK_PATH}` : '');
  if (!raw) throw new Error('FEISHU_EXTERNAL_BASE_URL is required');
  let url;
  try { url = new URL(raw); } catch { throw new Error('redirect URL must be absolute HTTPS'); }
  if (url.protocol !== 'https:' || url.pathname !== SHOP_OAUTH_CALLBACK_PATH || url.username || url.password || url.hash) {
    throw new Error(`redirect URL must be HTTPS and end in ${SHOP_OAUTH_CALLBACK_PATH}`);
  }
  return url.toString();
}

function stateCookie(state, ttlSeconds) {
  return `${SHOP_OAUTH_COOKIE}=${encodeURIComponent(state)}; Max-Age=${ttlSeconds}; Path=/api/shopee-analytics/shop-oauth; HttpOnly; Secure; SameSite=Lax`;
}

function clearStateCookie() {
  return `${SHOP_OAUTH_COOKIE}=; Max-Age=0; Path=/api/shopee-analytics/shop-oauth; HttpOnly; Secure; SameSite=Lax`;
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

/**
 * The people a token speaks for.
 *
 * The videos and the livestreams belong to the person behind the shop,
 * so the token that comes back carries their number rather than the
 * shop's.
 */
function authorizedUserIdsFrom(response) {
  const ids = [];
  if (response && Array.isArray(response.user_id_list)) ids.push(...response.user_id_list);
  if (response && response.user_id !== undefined && response.user_id !== null) ids.push(response.user_id);
  const normalized = ids
    .map(entry => Number(entry))
    .filter(number => Number.isSafeInteger(number) && number > 0);
  return [...new Set(normalized)];
}

/**
 * The applications that may be connected this way.
 */
function shopRoleSpec(role) {
  const spec = SHOP_ROLES[String(role || '').toUpperCase()];
  if (!spec) throw oauthError('SHOP_OAUTH_UNKNOWN_APPLICATION', 400);
  return spec;
}

class ShopOAuthService {
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

  /**
   * The credentials of an application.
   *
   * There may be more than one pair here — a test one and a live one — and
   * the live one is the one with the larger partner number. The seller
   * signs in at the platform for real, so the live one is the one that has
   * to be used.
   */
  liveCredential(role) {
    const list = loadAppCredentials(role, { requireToken: false, env: this.env });
    if (!list.length) throw oauthError('SHOP_OAUTH_CREDENTIALS_NOT_CONFIGURED', 503);
    const live = list
      .slice()
      .sort((a, b) => Number(b.partnerId || 0) - Number(a.partnerId || 0))[0];
    if (!live.partnerId || !live.partnerKey) {
      throw oauthError('SHOP_OAUTH_CREDENTIALS_NOT_CONFIGURED', 503);
    }
    return live;
  }

  credentialsConfigured(role) {
    try {
      const credential = this.liveCredential(role);
      return Boolean(credential.partnerId && credential.partnerKey);
    } catch {
      return false;
    }
  }

  authClient(role) {
    const credential = this.liveCredential(role);
    return new ShopeeAuthClient({
      partnerId: credential.partnerId,
      partnerKey: credential.partnerKey,
      fetchImpl: this.fetchImpl,
    });
  }

  /**
   * Whether a shop is connected to one of these applications.
   */
  async status({ role, shopId }) {
    const spec = shopRoleSpec(role);
    const id = Number(shopId);
    const result = await this.pool.query(
      `SELECT p.shop_id,
              t.expires_at AS token_expires_at,
              t.refresh_error AS token_refresh_error
       FROM shopee_shop_profiles p
       LEFT JOIN shopee_app_tokens t ON t.app_role=$2 AND t.shop_id=p.shop_id
       WHERE p.shop_id=$1`,
      [id, spec.role],
    );
    if (!result.rows.length) throw oauthError('SHOP_NOT_CONFIGURED', 404);
    const row = result.rows[0];
    return {
      appRole: spec.role,
      shopId: id,
      credentialConfigured: this.credentialsConfigured(spec.role),
      tokenPresent: Boolean(row.token_expires_at),
      tokenExpiresAt: row.token_expires_at || null,
      tokenRefreshError: row.token_refresh_error || null,
      redirectUrl: (() => { try { return resolveShopOAuthRedirectUrl(this.env, spec.role); } catch { return null; } })(),
    };
  }

  /**
   * Begin an authorization.
   *
   * The shop signs in at the platform and ticks the shops; the token that
   * comes back reaches every shop that was ticked, and each of those shops
   * that is known here is given a copy of it.
   */
  async beginAuthorization({ role, shopId }) {
    const spec = shopRoleSpec(role);
    const id = Number(shopId);
    if (!Number.isSafeInteger(id) || id <= 0) throw oauthError('INVALID_SHOP_ID', 400);
    const exists = await this.pool.query(
      'SELECT 1 FROM shopee_shop_profiles WHERE shop_id=$1 AND active=true',
      [id],
    );
    if (!exists.rows.length) throw oauthError('SHOP_NOT_CONFIGURED', 404);
    const redirectUri = resolveShopOAuthRedirectUrl(this.env, spec.role);
    const ttlSeconds = validateOAuthStateTtl(this.env);
    const state = generateState(this.randomBytes);
    const now = this.now();
    await this.stateRepository.create({
      stateHash: hashState(state),
      appRole: spec.role,
      expectedShopId: id,
      redirectUri,
      expiresAt: new Date(now.getTime() + ttlSeconds * 1000),
    });
    return {
      state,
      ttlSeconds,
      appRole: spec.role,
      authorizationUrl: this.authClient(spec.role).buildAuthorizationUrl({
        redirectUri,
        authType: spec.authType || null,
      }),
      shopId: id,
    };
  }

  async completeAuthorization({ state, code, providerError = null }) {
    const stateHash = hashState(state);
    const now = this.now();
    const active = await this.stateRepository.findActive({ stateHash, now });
    if (!active || !SHOP_ROLES[active.app_role]) throw oauthError('SHOP_OAUTH_INVALID_OR_EXPIRED_STATE', 400);
    const spec = SHOP_ROLES[active.app_role];
    if (providerError) throw oauthError('SHOP_OAUTH_PROVIDER_ERROR', 400);
    if (!code || typeof code !== 'string') throw oauthError('SHOP_OAUTH_MISSING_CODE', 400);
    const consumed = await this.stateRepository.consume({ stateHash, now });
    if (!consumed) throw oauthError('SHOP_OAUTH_INVALID_OR_REPLAYED_STATE', 400);

    try {
      const response = await this.authClient(spec.role).exchangeAuthorizationCode({ code });
      const authorizedShopIds = authorizedShopIdsFrom(response);
      const authorizedUserIds = authorizedUserIdsFrom(response);
      if (!authorizedShopIds.length) throw oauthError('SHOP_OAUTH_INVALID_TOKEN_RESPONSE', 502);
      const shopId = Number(active.expected_shop_id);
      const expireIn = Number(response && response.expire_in);
      if (!response.access_token || !response.refresh_token || !Number.isFinite(expireIn) || expireIn <= 0) {
        throw oauthError('SHOP_OAUTH_INVALID_TOKEN_RESPONSE', 502);
      }
      const tokenRepository = new ShopeeTokenRepository({
        pool: this.pool,
        masterKey: loadMasterKey(this.env),
      });
      // A main account authorizes its shops in one go, and the token it
      // returns reaches every shop the seller ticked. Storing it against
      // one shop would leave the others unable to fetch anything, so each
      // shop that is both authorized and known here gets a copy.
      const known = await this.pool.query(
        'SELECT shop_id FROM shopee_shop_profiles WHERE shop_id = ANY($1::bigint[]) AND active=true',
        [authorizedShopIds],
      );
      const targetShopIds = known.rows.map(row => Number(row.shop_id));
      if (!targetShopIds.length) {
        throw oauthError(
          'SHOP_OAUTH_SHOP_NOT_ALLOWED',
          403,
          `授权的店铺（${authorizedShopIds.join('、')}）不在本系统已配置的店铺里，请在授权页勾选已配置的店铺后重试。`,
        );
      }
      // Where the application speaks for a person rather than for a shop,
      // the token belongs to that person: it is kept against their
      // number, and each shop that was authorized records who it was
      // that spoke for it.
      if (spec.identity === 'user') {
        const userId = authorizedUserIds[0];
        if (!userId) throw oauthError('SHOP_OAUTH_INVALID_TOKEN_RESPONSE', 502);
        await tokenRepository.save({
          appRole: spec.role,
          shopId: userId,
          accessToken: response.access_token,
          refreshToken: response.refresh_token,
          expiresAt: new Date(now.getTime() + expireIn * 1000),
          lastRefreshAt: now,
          refreshError: null,
        });
        if (spec.userColumn) {
          await this.pool.query(
            `UPDATE shopee_shop_profiles
             SET ${spec.userColumn}=$2,updated_at=now()
             WHERE shop_id = ANY($1::bigint[])`,
            [targetShopIds, userId],
          );
        }
      } else {
        for (const targetShopId of targetShopIds) {
          await tokenRepository.save({
            appRole: spec.role,
            shopId: targetShopId,
            accessToken: response.access_token,
            refreshToken: response.refresh_token,
            expiresAt: new Date(now.getTime() + expireIn * 1000),
            lastRefreshAt: now,
            refreshError: null,
          });
        }
      }
      const connectedExpected = targetShopIds.includes(shopId);
      return {
        appRole: spec.role,
        shopId: connectedExpected ? shopId : targetShopIds[0],
        authorizedShopIds,
        authorizedUserIds,
        connectedShopIds: targetShopIds,
        expectedShopId: shopId,
        expectedShopConnected: connectedExpected,
      };
    } catch (error) {
      throw safeError(error, 'SHOP_OAUTH_TOKEN_EXCHANGE_FAILED');
    }
  }
}

module.exports = {
  SHOP_OAUTH_COOKIE,
  SHOP_OAUTH_CALLBACK_PATH,
  SHOP_ROLES,
  resolveShopOAuthRedirectUrl,
  stateCookie,
  clearStateCookie,
  parseCookie,
  authorizedShopIdsFrom,
  authorizedUserIdsFrom,
  shopRoleSpec,
  ShopOAuthService,
};
