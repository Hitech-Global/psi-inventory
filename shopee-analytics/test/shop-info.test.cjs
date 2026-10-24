'use strict';

const assert = require('assert');
const { normalizeShopInfo } = require('../src/sync-shop');

const normalized = normalizeShopInfo({
  response: {
    shop_id: 123,
    shop_name: 'Redragon Official',
    region: 'ID',
    status: 'NORMAL',
    merchant_id: 456,
    auth_time: 100,
    expire_time: 200,
    is_cb: false,
    is_sip: true,
  },
});

assert.strictEqual(normalized.shopId, 123);
assert.strictEqual(normalized.shopName, 'Redragon Official');
assert.strictEqual(normalized.region, 'ID');
assert.strictEqual(normalized.merchantId, 456);
assert.strictEqual(normalized.isSip, true);

console.log('shopee shop info tests: ok');
