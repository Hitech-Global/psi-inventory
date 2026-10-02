'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const read = rel => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

const index = read('web/index.html');
const i18n = read('web/i18n-v1.js');
const labels = read('web/shopee-metric-labels.js');
const ui = read('web/product-card-ui-v2.js');
const app = read('web/app.js');
const adGroup = require('../src/shopee-ad-group-import');
const productAd = require('../src/product-ad-seller-centre-import');
const gms = require('../src/gms-seller-centre-reconciliation');

assert(index.includes('id="languageSwitch"'), 'top-right language switch is required');
assert(index.includes('data-locale="zh"') && index.includes('data-locale="en"'));
assert(index.includes('/i18n-v1.js'));
for (const token of ['localStorage.setItem', 'MutationObserver', 'ShopeeI18n']) assert(i18n.includes(token));
assert(!i18n.includes('window.location.reload()'), 'locale switch must not reload the page');
assert(i18n.includes('const originalText = new WeakMap()'), 'in-place locale switch must retain original DOM text');
assert(i18n.includes("new CustomEvent('shopee:localechange'"), 'locale switch must publish an in-place change event');
assert(app.includes('function restoreLocaleUiState()'), 'legacy reload recovery remains available for normal page reloads');

const exactShopeeHeaders = new Set([
  ...adGroup.REQUIRED_HEADERS,
  ...productAd.REQUIRED_HEADERS,
  ...gms.REQUIRED_HEADERS,
  'Keyword / Placement', 'Match Type', 'Search Volume', 'Bidding Method', 'Placement', 'Average Rank',
]);
for (const header of exactShopeeHeaders) assert(labels.includes(`en: '${header}'`) || labels.includes(`en: "${header}"`), `missing Shopee English label: ${header}`);
for (const key of ['dataDateSystem','productCountSystem']) assert(labels.includes(`${key}:`), `system-only label must remain explicit: ${key}`);
assert(ui.includes("metricCol('dataQuality')"), 'Ad Group data-quality field must remain explicit');
console.log('Shopee English UI and export-field mapping contract: ok');
