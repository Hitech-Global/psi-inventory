'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const read = rel => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

const ui = read('web/product-card-ui-v2.js');
const index = read('web/index.html');
const repo = read('src/ad-promotion-repository.js');
const server = read('src/standalone-server.js');

for (const label of ['Product Card', '单品广告', '广告组', '全店推']) assert(ui.includes(label));
for (const type of ['manual', 'groups', 'auto']) assert(index.includes(`data-ads-type="${type}"`));
assert(!index.includes('data-ads-type="gmvmax"'), 'GMV Max is an algorithm, not a Product Card child tab');
assert(!index.includes('data-ads-type="gms"'), 'shop overview is fixed context, not a child tab');
assert(ui.includes('/api/shopee-analytics/product-ads/overview'), 'fixed Product Card summary must use shop-level API aggregate');
assert(ui.includes('/api/shopee-analytics/product-ads?${params}'), 'single-product ads must use Product Campaign API');
assert(ui.includes('/api/shopee-analytics/campaigns?${params}'), 'shop-wide ads must use GMS campaign API');
assert(ui.includes('/api/shopee-analytics/campaigns/${campaignId}/analysis?${params}'), 'shop-wide detail must use GMS item analysis');
assert(ui.includes('minimumFractionDigits: 2'));
assert(ui.includes('data-ad-group-index'));
assert(ui.includes('adGroupItemRowsV2'));
for (const token of ["'sourceRoas'", 'i.source_roas', "'directRoas'", 'i.direct_roas', "'expense'", 'i.expense', "'gmv'", 'i.gmv']) assert(repo.includes(token));
assert(server.includes('/product-card-ui-v2.js'));

console.log('Product Card three-child hierarchy and source mapping contract: ok');
