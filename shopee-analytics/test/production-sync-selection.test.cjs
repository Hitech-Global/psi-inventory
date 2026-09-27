'use strict';

const assert = require('assert');
const { selectProductionApiShops } = require('../scripts/sync-all-shops.cjs');

const selection = selectProductionApiShops([
  { shopId: 1, oauthAuthorized: true, timezone: 'Asia/Kuala_Lumpur' },
  { shopId: 2, oauthAuthorized: false, timezone: 'Asia/Jakarta' },
  { shopId: 3, oauthAuthorized: true, timezone: null },
]);

assert.deepStrictEqual(selection.shops.map(row => row.shopId), [1]);
assert.deepStrictEqual(selection.skippedShops, [
  { shopId: 2, reason: 'NO_ADS_TOKEN' },
  { shopId: 3, reason: 'NO_TIMEZONE' },
]);
console.log('production Shopee sync shop selection tests: ok');
