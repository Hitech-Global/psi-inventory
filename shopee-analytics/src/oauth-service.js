'use strict';

const { ShopeeAuthClient } = require('./auth-client');
const { assertPilotOAuthAllowed } = require('./deployment-mode');
const {
  generateState,
  hashState,
  validateOAuthStateTtl,
  loadLiveRedirectUrl,
  oauthError,
  safeError,
} = require('./oauth-security');

function positiveSafeInteger(value, errorCode) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw oauthError(errorCode, 400);
  return number;
}

function positiveSafeIntegerList(value, errorCode, { optional = false } = {}) {
  if (value === undefined || value === null) {
    if (optional) return [];
    throw oauthError(errorCode, 502);
  }
  if (!Array.isArray(value)) throw oauthError(errorCode, 502);
  return [...new Set(value.map(entry => positiveSafeInteger(entry, errorCode)))];
}

class ShopeeOAuthService {
  constructor({
    stateRepository,
    tokenRepositoryFactory,
    credentialLoader,
    env = process.env,
    now = () => new Date(),
    randomBytes,
    authClientFactory = options => new ShopeeAuthClient(options),
    fetchImpl = global.fetch,
    logger = console,
  }) {
    if (!stateRepository) throw new Error('stateRepository is required');
    if (typeof tokenRepositoryFactory !== 'function') throw new Error('tokenRepositoryFactory is required');
    if (typeof credentialLoader !== 'function') throw new Error('credentialLoader is required');
    this.stateRepository = stateRepository;
    this.tokenRepositoryFactory = tokenRepositoryFactory;
    this.credentialLoader = credentialLoader;
    this.env = env;
    this.now = now;
    this.randomBytes = randomBytes;
    this.authClientFactory = authClientFactory;
    this.fetchImpl = fetchImpl;
    this.logger = logger;
  }

  policy() {
    try {
      return assertPilotOAuthAllowed(this.env);
    } catch {
      throw oauthError('OAUTH_DISABLED', 403);
    }
  }

  createAuthClient() {
    const credential = this.credentialLoader('ADS');
    return this.authClientFactory({
      partnerId: credential.partnerId,
      partnerKey: credential.partnerKey,
      fetchImpl: this.fetchImpl,
    });
  }

  async beginAuthorization() {
    const pilot = this.policy(); // Gate before any state write or client network operation.
    const redirectUri = loadLiveRedirectUrl(this.env);
    const ttlSeconds = validateOAuthStateTtl(this.env);
    const authClient = this.createAuthClient(); // Loads the local ADS credential before state persistence.
    const state = generateState(this.randomBytes);
    const now = this.now();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
    await this.stateRepository.create({
      stateHash: hashState(state),
      appRole: 'ADS',
      expectedShopId: pilot.shopId,
      redirectUri,
      expiresAt,
    });
    const authorizationUrl = authClient.buildAuthorizationUrl({ redirectUri });
    return { state, ttlSeconds, authorizationUrl, expectedShopId: pilot.shopId, expiresAt };
  }

  async completeAuthorization({ state, code, providerError = null }) {
    const pilot = this.policy(); // Gate before state reads, writes, or token exchange.
    const stateHash = hashState(state);
    const now = this.now();
    const active = await this.stateRepository.findActive({ stateHash, now });
    if (!active || active.app_role !== 'ADS') throw oauthError('OAUTH_INVALID_OR_EXPIRED_STATE', 400);

    if (providerError) throw oauthError('OAUTH_PROVIDER_ERROR', 400);
    if (!code || typeof code !== 'string') throw oauthError('OAUTH_MISSING_CODE', 400);

    if (Number(active.expected_shop_id) !== pilot.shopId) throw oauthError('OAUTH_SHOP_NOT_ALLOWED', 403);

    const consumed = await this.stateRepository.consume({ stateHash, now });
    if (!consumed) throw oauthError('OAUTH_INVALID_OR_REPLAYED_STATE', 400);

    let response;
    try {
      // Instantiate the encrypted repository before exchanging the code so a missing local key
      // cannot leave a successful code exchange without a secure persistence path.
      const tokenRepository = this.tokenRepositoryFactory();
      response = await this.createAuthClient().exchangeAuthorizationCode({ code });
      const authorizedShopIds = positiveSafeIntegerList(response && response.shop_id_list, 'OAUTH_INVALID_TOKEN_RESPONSE');
      // Merchant IDs are normalized as part of the response contract, but the Pilot
      // boundary is a shop-level allowlist and can only be satisfied by shop_id_list.
      const authorizedMerchantIds = positiveSafeIntegerList(
        response && response.merchant_id_list,
        'OAUTH_INVALID_TOKEN_RESPONSE',
        { optional: true },
      );
      if (!authorizedShopIds.includes(pilot.shopId)) {
        // These are validated numeric identifiers only. Never log the code, state,
        // token fields, credentials, or the complete provider response.
        this.logger.error(
          `[Shopee OAuth] OAUTH_SHOP_NOT_ALLOWED expectedShopId=${pilot.shopId} authorizedShopIds=[${authorizedShopIds.join(',')}] merchantIdCount=${authorizedMerchantIds.length}`,
        );
        throw oauthError('OAUTH_SHOP_NOT_ALLOWED', 403);
      }
      const expireIn = Number(response && response.expire_in);
      if (!response.access_token || !response.refresh_token || !Number.isFinite(expireIn) || expireIn <= 0) {
        throw oauthError('OAUTH_INVALID_TOKEN_RESPONSE', 502);
      }
      const expiresAt = new Date(now.getTime() + expireIn * 1000);
      await tokenRepository.save({
        appRole: 'ADS',
        shopId: pilot.shopId,
        accessToken: response.access_token,
        refreshToken: response.refresh_token,
        expiresAt,
        lastRefreshAt: now,
        refreshError: null,
      });
      return { appRole: 'ADS', shopId: pilot.shopId, expiresAt };
    } catch (error) {
      throw safeError(error, 'OAUTH_TOKEN_EXCHANGE_FAILED');
    }
  }
}

module.exports = { ShopeeOAuthService, positiveSafeInteger, positiveSafeIntegerList };
