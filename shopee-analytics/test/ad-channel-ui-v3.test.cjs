'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ui = fs.readFileSync(path.join(__dirname, '..', 'web', 'ad-channel-ui-v3.js'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, '..', 'src', 'standalone-server.js'), 'utf8');

for (const label of ['Product Card', 'Shop+ Ads', 'Brand Ads', 'Live Ads']) {
  assert(ui.includes(label), `top-level ad channel must include ${label}`);
}

assert(ui.includes('接口状态待确认'), 'unverified Shopee API channels must not pretend to have data');
assert(ui.includes('不伪造数据'), 'placeholder must explicitly preserve data integrity');
assert(ui.includes('product-card'), 'Product Card must remain the active default channel');
assert(ui.includes("$('.ads-filter-toolbar') || $('.ads-type-tabs')"), 'channel switching must treat the Product Card toolbar as one top-level shell');
assert(ui.includes("const anchor = $('#adsGmsPanel') || $('.ads-filter-toolbar') || productCardParent"), 'channel tabs must anchor at the ads-view level, not inside the Product Card toolbar');
assert(ui.includes('adsView.insertBefore(tabs, anchor)'), 'channel tabs must remain a direct ads-view child');
assert(server.includes('/ad-channel-ui-v3.js'), 'entry HTML must load ad channel UI layer');

console.log('top-level Shopee ad channel UI contract: ok');
