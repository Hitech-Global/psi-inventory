'use strict';

const crypto = require('crypto');

function signPublicRequest({ partnerId, partnerKey, path, timestamp }) {
  if (!partnerId || !partnerKey || !path || !timestamp) {
    throw new Error('Missing Shopee public signing input');
  }
  const baseString = `${partnerId}${path}${timestamp}`;
  return crypto.createHmac('sha256', partnerKey).update(baseString).digest('hex');
}

class ShopeeAuthClient {
  constructor({
    partnerId,
    partnerKey,
    baseUrl = 'https://partner.shopeemobile.com',
    fetchImpl = global.fetch,
  }) {
    if (!fetchImpl) throw new Error('fetch implementation is required');
    this.partnerId = String(partnerId || '');
    this.partnerKey = String(partnerKey || '');
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.fetch = fetchImpl;
  }

  async publicPost({ path, body }) {
    const timestamp = Math.floor(Date.now() / 1000);
    const sign = signPublicRequest({
      partnerId: this.partnerId,
      partnerKey: this.partnerKey,
      path,
      timestamp,
    });
    const params = new URLSearchParams({
      partner_id: this.partnerId,
      timestamp: String(timestamp),
      sign,
    });

    const response = await this.fetch(`${this.baseUrl}${path}?${params}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    const text = await response.text();
    let payload;
    try { payload = text ? JSON.parse(text) : {}; }
    catch { throw new Error(`Shopee auth returned non-JSON (${response.status})`); }

    if (!response.ok || payload.error) {
      const error = new Error(payload.message || payload.error || `Shopee auth HTTP ${response.status}`);
      error.status = response.status;
      error.code = payload.error || null;
      error.requestId = payload.request_id || null;
      throw error;
    }
    return payload;
  }

  async refreshAccessToken({ shopId, refreshToken }) {
    const path = '/api/v2/auth/access_token/get';
    return this.publicPost({
      path,
      body: {
        refresh_token: refreshToken,
        partner_id: Number(this.partnerId),
        shop_id: Number(shopId),
      },
    });
  }

  buildAuthorizationUrl({ redirectUri, timestamp = Math.floor(Date.now() / 1000) }) {
    const path = '/api/v2/shop/auth_partner';
    if (!redirectUri) throw new Error('OAuth redirect URI is required');
    const sign = signPublicRequest({
      partnerId: this.partnerId,
      partnerKey: this.partnerKey,
      path,
      timestamp,
    });
    const params = new URLSearchParams({
      partner_id: this.partnerId,
      timestamp: String(timestamp),
      redirect: redirectUri,
      sign,
    });
    return `${this.baseUrl}${path}?${params.toString()}`;
  }

  async exchangeAuthorizationCode({ code, shopId }) {
    const path = '/api/v2/auth/token/get';
    return this.publicPost({
      path,
      body: {
        code: String(code || ''),
        partner_id: Number(this.partnerId),
        shop_id: Number(shopId),
      },
    });
  }
}

module.exports = { signPublicRequest, ShopeeAuthClient };
