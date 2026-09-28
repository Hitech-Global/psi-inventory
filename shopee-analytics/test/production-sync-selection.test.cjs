'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { parseIdFilter, selectProductionApiShops } = require('../scripts/sync-all-shops.cjs');

assert.strictEqual(parseIdFilter('').size, 0);
assert.deepStrictEqual(Array.from(parseIdFilter('1770037299, ,0,-1,bad')), [1770037299]);

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

const syncAll = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'sync-all-shops.cjs'), 'utf8');
assert(syncAll.includes('if (!pilot) {\n        try {\n          summary.historyRepair'), 'Production hourly and daily cycles must both run resumable history repair');
assert(!syncAll.includes("if (mode === 'daily' && !pilot)"), 'history repair must not wait for daily mode');
console.log('production Shopee sync shop selection tests: ok');
