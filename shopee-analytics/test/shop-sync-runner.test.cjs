'use strict';

const assert = require('assert');
const { normalizeShopProfile } = require('../src/shop-sync-runner');

const normalized = normalizeShopProfile({
  shopId: '123',
  displayName: 'Redragon ID',
  timezone: 'Asia/Jakarta',
  brandPortalTimezone: 'GMT+7',
});
assert.strictEqual(normalized.shopId, 123);
assert.strictEqual(normalized.timezone, 'Asia/Jakarta');
assert.strictEqual(normalized.brandPortalTimezone, 'GMT+7');

assert.throws(
  () => normalizeShopProfile({ shopId: 123 }),
  /timezone is required/,
);

console.log('shopee shop sync runner tests: ok');
