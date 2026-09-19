'use strict';

const crypto = require('crypto');

function signShopRequest({ partnerId, partnerKey, path, timestamp, accessToken, shopId }) {
  if (!partnerId || !partnerKey || !path || !timestamp || !accessToken || !shopId) {
    throw new Error('Missing Shopee signing input');
  }
  const baseString = `${partnerId}${path}${timestamp}${accessToken}${shopId}`;
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
  constructor({ partnerId, partnerKey, baseUrl = 'https://partner.shopeemobile.com', fetchImpl = global.fetch }) {
    if (!fetchImpl) throw new Error('fetch implementation is required');
    this.partnerId = String(partnerId || '');
    this.partnerKey = String(partnerKey || '');
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.fetch = fetchImpl;
  }

  async shopRequest({ path, shopId, accessToken, method = 'GET', query = {}, body }) {
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

    const response = await this.fetch(`${this.baseUrl}${path}?${params.toString()}`, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
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
      throw err;
    }
    return payload;
  }
}

module.exports = { ShopeeClient, signShopRequest, appendQueryParam };
