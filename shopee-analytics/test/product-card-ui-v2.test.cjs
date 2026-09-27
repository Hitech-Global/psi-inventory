'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ui = fs.readFileSync(path.join(__dirname, '..', 'web', 'product-card-ui-v2.js'), 'utf8');
const repo = fs.readFileSync(path.join(__dirname, '..', 'src', 'ad-promotion-repository.js'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, '..', 'src', 'standalone-server.js'), 'utf8');

for (const label of ['PRODUCT CARD', 'Product Card', '总览', '单品广告', '全店推', '广告组']) {
  assert(ui.includes(label), `Product Card hierarchy must include ${label}`);
}

assert(ui.includes('/api/shopee-analytics/product-ads/overview'), 'Product Card overview must use shop-level Product Ads API aggregate');
assert(ui.includes('不会使用“全店推”或某个 GMV Max Campaign 冒充总览'), 'empty state must refuse campaign-family substitution');
assert(ui.includes('minimumFractionDigits: 2'), 'ad numeric formatter must preserve two decimal places');
assert(ui.includes('data-ad-group-index'), 'Ad Group rows must be drillable');
assert(ui.includes('adGroupItemRowsV2'), 'Ad Group item table must exist');
for (const token of ["'sourceRoas'", 'i.source_roas', "'directRoas'", 'i.direct_roas', "'expense'", 'i.expense', "'gmv'", 'i.gmv']) {
  assert(repo.includes(token), `Ad Group item query must expose ${token}`);
}
assert(server.includes('/product-card-ui-v2.js'), 'entry HTML must load Product Card v2 UI');

console.log('Product Card hierarchy and Ad Group drilldown contract: ok');
