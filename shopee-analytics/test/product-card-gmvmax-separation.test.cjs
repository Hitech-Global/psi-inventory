'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const read = rel => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

const index = read('web/index.html');
const ui = read('web/product-card-ui-v2.js');
const router = read('src/http-router.js');

assert(!index.includes('data-ads-type="gmvmax"'), 'GMV Max must not render as a Product Card child tab');
assert(!index.includes('data-ads-type="gms"'), 'Product Card overview must not render as a child tab');
for (const type of ['manual', 'groups', 'auto']) assert(index.includes(`data-ads-type="${type}"`));
assert(ui.includes("params.set('ad_type', 'manual')"), 'single-product ads must use manual Product Campaign source');
assert(ui.includes('/api/shopee-analytics/campaigns?${params}'), 'shop-wide ads must read GMS campaigns');
assert(ui.includes('/api/shopee-analytics/campaigns/${campaignId}/analysis?${params}'), 'shop-wide detail must read GMS campaign/item analysis');
assert(ui.includes('GMV Max · GMS'), 'GMV Max must be shown as the shop-wide optimization algorithm/source, not a tab');
assert(router.includes("campaignTypeNormalized: 'GMS'"), 'GMS campaign API route must stay explicitly GMS-filtered');

console.log('Product Card shop-wide GMS mapping contract: ok');
