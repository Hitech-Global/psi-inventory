'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const read = rel => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

const ui = read('web/product-card-ui-v2.js');
const index = read('web/index.html');
const repo = read('src/ad-promotion-repository.js');
const server = read('src/standalone-server.js');
const syncRunner = read('src/shop-sync-runner.js');
const channels = read('web/ad-channel-ui-v3.js');

for (const label of ['Product Card', '单品广告', '广告组', '全店推']) assert(ui.includes(label));
for (const type of ['manual', 'groups', 'auto']) assert(index.includes(`data-ads-type="${type}"`));
assert(!index.includes('data-ads-type="gmvmax"'));
assert(!index.includes('data-ads-type="gms"'));
assert(ui.includes('/api/shopee-analytics/product-ads/overview'));
assert(ui.includes('/api/shopee-analytics/product-ads?${params}'));
assert(ui.includes('/api/shopee-analytics/campaigns?${params}'));
assert(ui.includes('/api/shopee-analytics/campaigns/${campaignId}/analysis?${params}'));
for (const key of ['addToCartRate','costPerConversion','directItemsSold','directAcos','voucherAmount','voucheredSales']) assert(ui.includes(key), `missing metric ${key}`);
for (const label of ['展示次数','点击数','点击率','订单量','商品已出售','销售额','花费','广告支出回报率','优惠券金额','优惠券带来的销售额','加购次数','加购率']) assert(ui.includes(label), `overview label missing ${label}`);
for (const token of ['comparisonRange','metric-change','metricTd','previousData']) assert(ui.includes(token), `comparison contract missing ${token}`);
assert(channels.includes("channelTabs.insertAdjacentElement('afterend', overviewPanel)"), 'overview must sit below the top-level ad-channel row');
assert(ui.includes('data-ad-group-detail-index'), 'Ad Group items must expand inline');
assert(ui.includes('data-sort-group'), 'Ad Group parent/detail rows must sort as one block');
assert(!ui.includes('adGroupItemRowsV2'), 'separate Ad Group item panel must be removed');
for (const token of ['directConversions','costPerDirectConversion','voucherAmount','voucheredSales']) assert(repo.includes(token), `read model missing ${token}`);
assert(server.includes('/table-sort-v1.js'), 'global Shopee table sorter must be loaded');
assert(syncRunner.includes("adTypes: ['manual']"));
assert(syncRunner.includes("includeSettings: mode === 'daily'"));
console.log('Product Card metrics, inline Ad Group detail and source mapping contract: ok');
