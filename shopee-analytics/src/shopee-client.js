'use strict';

const crypto = require('crypto');
const { withRateLimitRetry } = require('./rate-limit-retry');

function signShopRequest({ partnerId, partnerKey, path, timestamp, accessToken, shopId }) {
  if (!partnerId || !partnerKey || !path || !timestamp || !accessToken || !shopId) {
    throw new Error('Missing Shopee signing input');
  }
  const baseString = `${partnerId}${path}${timestamp}${accessToken}${shopId}`;
  return crypto.createHmac('sha256', partnerKey).update(baseString).digest('hex');
}

function signPrincipalRequest({ partnerId, partnerKey, path, timestamp, accessToken, principalId }) {
  if (!partnerId || !partnerKey || !path || !timestamp || !accessToken || !principalId) {
    throw new Error('Missing Shopee principal signing input');
  }
  const baseString = `${partnerId}${path}${timestamp}${accessToken}${principalId}`;
  return crypto.createHmac('sha256', partnerKey).update(baseString).digest('hex');
}

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

class ShopeeClient {
  constructor({
    partnerId,
    partnerKey,
    baseUrl = 'https://partner.shopeemobile.com',
    fetchImpl = global.fetch,
    retryOptions = {},
  }) {
    if (!fetchImpl) throw new Error('fetch implementation is required');
    this.partnerId = String(partnerId || '');
    this.partnerKey = String(partnerKey || '');
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.fetch = fetchImpl;
    // 限流退避参数（见 src/rate-limit-retry.js）：可由调用方覆盖，默认值适合单店铺常规同步。
    this.retryOptions = { ...retryOptions };
  }

  /**
   * 统一执行一次 Shopee 请求，失败时按限流策略退避重试。
   * 只读接口语义不变；重试耗尽后抛出最后一次原始错误。
   */
  async request({ buildParams, onRetry }) {
    return withRateLimitRetry(async () => {
      const params = buildParams();
      const response = await this.fetch(`${this.baseUrl}${params.path}?${params.query.toString()}`, {
        method: params.method,
        headers: params.body === undefined ? undefined : { 'content-type': 'application/json' },
        body: params.body === undefined ? undefined : JSON.stringify(params.body),
      });

      const text = await response.text();
      let payload;
      try { payload = text ? JSON.parse(text) : {}; }
      catch { throw new Error(`Shopee returned non-JSON (${response.status})`); }

      if (!response.ok || payload.error) {
        const err = new Error(payload.message || payload.error || `Shopee HTTP ${response.status}`);
        err.status = response.status;
        err.code = payload.error || null;
        err.requestId = payload.request_id || null;
        err.kind = err.code === 'ads_rate_limit_shop_api' ? 'RATE_LIMIT' : 'SHOPEE_API_ERROR';
        const retryAfter = response.headers && response.headers.get('retry-after');
        if (/^\d+$/.test(String(retryAfter || ''))) err.retryAfterSeconds = Number(retryAfter);
        throw err;
      }
      return payload;
    }, { ...this.retryOptions, onRetry });
  }

  async shopRequest({ path, shopId, accessToken, method = 'GET', query = {}, body, onRetry }) {
    return this.request({
      onRetry,
      buildParams: () => {
        const timestamp = Math.floor(Date.now() / 1000);
        const sign = signShopRequest({
          partnerId: this.partnerId,
          partnerKey: this.partnerKey,
          path,
          timestamp,
          accessToken,
          shopId,
        });

        const params = new URLSearchParams({
          partner_id: this.partnerId,
          timestamp: String(timestamp),
          sign,
          shop_id: String(shopId),
          access_token: accessToken,
        });
        for (const [key, value] of Object.entries(query || {})) appendQueryParam(params, key, value);
        return { path, query: params, method, body };
      },
    });
  }

  async principalRequest({ path, principalId, accessToken, method = 'GET', query = {}, body, onRetry }) {
    return this.request({
      onRetry,
      buildParams: () => {
        const timestamp = Math.floor(Date.now() / 1000);
        const sign = signPrincipalRequest({
          partnerId: this.partnerId, partnerKey: this.partnerKey, path, timestamp, accessToken, principalId,
        });
        const params = new URLSearchParams({
          partner_id: this.partnerId, timestamp: String(timestamp), sign,
          principal_id: String(principalId), access_token: accessToken,
        });
        for (const [key, value] of Object.entries(query || {})) appendQueryParam(params, key, value);
        return { path, query: params, method, body };
      },
    });
  }
}

module.exports = { ShopeeClient, signShopRequest, signPrincipalRequest, appendQueryParam };
