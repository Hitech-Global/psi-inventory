'use strict';

const { ShopeeAuthClient } = require('./auth-client');
const { sanitizeForPersistence, safeError } = require('./oauth-security');

class ShopeeTokenManager {
  constructor({
    tokenRepository,
    credentialLoader,
    refreshSkewSeconds = 300,
    now = () => new Date(),
    fetchImpl = global.fetch,
    baseUrl,
  }) {
    if (!tokenRepository) throw new Error('tokenRepository is required');
    if (typeof credentialLoader !== 'function') throw new Error('credentialLoader is required');
    this.tokenRepository = tokenRepository;
    this.credentialLoader = credentialLoader;
    this.refreshSkewSeconds = refreshSkewSeconds;
    this.now = now;
    this.fetchImpl = fetchImpl;
    this.baseUrl = baseUrl;
    this.inflight = new Map();
  }

  shouldRefresh(token) {
    if (!token || !token.expiresAt) return true;
    return token.expiresAt.getTime() - this.now().getTime() <= this.refreshSkewSeconds * 1000;
  }

  async getAccessToken({ appRole, shopId }) {
    const token = await this.tokenRepository.load({ appRole, shopId });
    if (!token) throw new Error(`No token stored for ${appRole} shop ${shopId}`);
    if (!this.shouldRefresh(token)) return token.accessToken;
    return this.refresh({ appRole, shopId, currentToken: token });
  }

  async refresh({ appRole, shopId, currentToken }) {
    const key = `${appRole}:${shopId}`;
    if (this.inflight.has(key)) return this.inflight.get(key);

    const promise = this._refresh({ appRole, shopId, currentToken })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, promise);
    return promise;
  }

  async _refresh({ appRole, shopId, currentToken }) {
    const token = currentToken || await this.tokenRepository.load({ appRole, shopId });
    if (!token) throw new Error(`No token stored for ${appRole} shop ${shopId}`);

    const credential = this.credentialLoader(appRole);
    const auth = new ShopeeAuthClient({
      partnerId: credential.partnerId,
      partnerKey: credential.partnerKey,
      baseUrl: this.baseUrl,
      fetchImpl: this.fetchImpl,
    });

    try {
      const payload = await auth.refreshAccessToken({
        shopId,
        refreshToken: token.refreshToken,
      });
      const expireIn = Number(payload.expire_in);
      if (!payload.access_token || !payload.refresh_token || !Number.isFinite(expireIn) || expireIn <= 0) {
        throw new Error('Shopee refresh response missing access_token/refresh_token/expire_in');
      }
      const refreshedAt = this.now();
      const expiresAt = new Date(refreshedAt.getTime() + expireIn * 1000);
      await this.tokenRepository.save({
        appRole,
        shopId,
        accessToken: payload.access_token,
        refreshToken: payload.refresh_token,
        expiresAt,
        lastRefreshAt: refreshedAt,
        refreshError: null,
      });
      return payload.access_token;
    } catch (error) {
      const sanitized = safeError(error, 'SHOPEE_TOKEN_REFRESH_FAILED');
      await this.tokenRepository.markRefreshError({ appRole, shopId, error: sanitizeForPersistence(sanitized) });
      throw sanitized;
    }
  }
}

module.exports = { ShopeeTokenManager };
