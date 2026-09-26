'use strict';

const assert = require('assert');
const crypto = require('crypto');
const { ShopeeClient, signShopRequest } = require('../src/shopee-client');

const sign = signShopRequest({
  partnerId: '123',
  partnerKey: 'secret',
  path: '/api/v2/product/get_item_list',
  timestamp: 100,
  accessToken: 'token',
  shopId: 456,
});
const expected = crypto.createHmac('sha256', 'secret')
  .update('123/api/v2/product/get_item_list100token456')
  .digest('hex');
assert.strictEqual(sign, expected);

let capturedUrl = '';
const client = new ShopeeClient({
  partnerId: '123',
  partnerKey: 'secret',
  fetchImpl: async url => {
    capturedUrl = String(url);
    return { ok: true, status: 200, text: async () => '{"response":{"ok":true}}' };
  },
});

(async () => {
  await client.shopRequest({
    path: '/api/v2/product/get_item_list',
    shopId: 456,
    accessToken: 'token',
    query: { item_status: ['NORMAL', 'BANNED'], page_size: 100 },
  });
  const parsed = new URL(capturedUrl);
  assert.deepStrictEqual(parsed.searchParams.getAll('item_status'), ['NORMAL', 'BANNED']);
  assert.strictEqual(parsed.searchParams.get('page_size'), '100');
  const rateLimited = new ShopeeClient({
    partnerId: '123', partnerKey: 'secret',
    fetchImpl: async () => ({
      ok: false, status: 429, text: async () => '{"error":"ads_rate_limit_shop_api"}',
      headers: { get: name => name === 'retry-after' ? '12' : null },
    }),
  });
  await assert.rejects(
    () => rateLimited.shopRequest({ path: '/api/v2/ads/get_gms_item_performance', shopId: 456, accessToken: 'token' }),
    error => error.kind === 'RATE_LIMIT' && error.code === 'ads_rate_limit_shop_api' && error.retryAfterSeconds === 12,
  );
  console.log('shopee client tests: ok');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
