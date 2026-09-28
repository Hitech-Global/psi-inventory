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
for (const key of ['impressions','clicks','ctr','conversions','itemsSold','gmv','expense','roas','voucherAmount','voucheredSales','addToCart','addToCartRate']) assert(ui.includes(`'${key}'`), `overview metric key missing ${key}`);
for (const token of ['comparisonRange','metric-change','metricTd','previousData']) assert(ui.includes(token), `comparison contract missing ${token}`);
for (const token of ['SUMMARY_PRIMARY_METRICS','SUMMARY_EFFICIENCY_METRICS','product-card-summary-divider','repeat(auto-fit,minmax(200px,1fr))','dailyAverage','summaryAov']) {
  assert(ui.includes(token), `summary layout contract missing ${token}`);
}
assert(ui.indexOf("['summaryExpense','expense'") < ui.indexOf("['impressions','impressions'"), 'ad spend must be the first primary summary metric');
for (const key of ['summaryCtr','summaryAddToCart','summaryCvr','summaryRoas','summaryAdSpendRate','summaryAov']) {
  assert(ui.includes(`'${key}'`), `efficiency summary metric missing ${key}`);
}
assert(!ui.includes('`环比 ${changeHtml(current[key]'), 'summary cards must not render 环比 label text');
assert(ui.includes("const toolbar = tabs.closest('.ads-filter-toolbar')"), 'Product Card parent anchor must escape the nested status toolbar');
assert(channels.includes('adsView.insertBefore(overviewPanel, channelTabs.nextSibling)'), 'overview must remain a top-level block below the ad-channel row');
assert(!ui.includes('data-ad-group-detail-index'), 'Ad Group items must no longer expand inline');
assert(ui.includes('product-card-detail-modal-backdrop'), 'shared detail modal shell must exist');
assert(ui.includes("variant: 'group'"), 'Ad Group detail must use the shared modal');
assert(ui.includes("title: '单品广告明细'"), 'single-product ad detail must use the shared modal');
assert(ui.includes("#manualAdDetail{display:none!important}"), 'legacy inline single-product detail must stay hidden');
assert(ui.includes('data-sort-group'), 'Ad Group parent row sort metadata must remain');
assert(!ui.includes('adGroupItemRowsV2'), 'separate Ad Group item panel must be removed');
assert(ui.includes("const GROUP_COLUMNS = [metricCol('adInfo'),metricCol('dailyBudget'),metricCol('targetRoas'),metricCol('diagnosis')"), 'Ad Group parent columns must follow Seller Centre reading order beginning with ad info / budget / target ROAS / diagnosis');
assert(ui.includes("<th>${sl('sequence')}</th><th>${sl('adProductName')}</th><th>${sl('productId')}</th>"), 'Ad Group item detail must begin with Shopee Sequence / Ad Product Name / Product ID');
assert(index.includes('按 Shopee Seller Centre 广告列表字段顺序'), 'Ad Group panel must explain Seller Centre-aligned columns');
for (const token of ['sequence: sourceMetric(parent, \'Sequence\')','sequence: sourceMetric(child, \'Sequence\')','directConversions','costPerDirectConversion','voucherAmount','voucheredSales']) assert(repo.includes(token), `read model missing ${token}`);
assert(server.includes('/table-sort-v1.js'), 'global Shopee table sorter must be loaded');
assert(syncRunner.includes("adTypes: ['manual']"));
assert(syncRunner.includes("includeSettings: mode === 'daily'"));
assert(ui.includes("await loadProductAdDetailV2('auto', firstCampaignId"), 'shop-wide GMS detail must auto-load the first campaign');
assert(!ui.includes('点击一个全店推 Campaign 查看诊断'), 'shop-wide view must not require a manual detail click');
console.log('Product Card metrics, modal detail UX and source mapping contract: ok');
