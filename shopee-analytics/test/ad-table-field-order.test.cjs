'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const read = rel => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const ui = read('web/product-card-ui-v2.js');

function ordered(section, tokens, label) {
  let cursor = -1;
  for (const token of tokens) {
    const next = section.indexOf(token, cursor + 1);
    assert(next > cursor, `${label}: ${token} must appear in export order`);
    cursor = next;
  }
}

const manual = ui.slice(ui.indexOf('const MANUAL_COLUMNS'), ui.indexOf('const GMS_COLUMNS'));
ordered(manual, ['campaignApi','status','budgetApi','targetRoas','biddingMethod','placement','impressions','clicks','ctr','addToCart','addToCartRate','conversions','directConversions','conversionRate','directConversionRate','costPerConversion','costPerDirectConversion','itemsSold','directItemsSold','gmv','directGmv','expense','averageRank','roas','directRoas','acos','directAcos','voucherAmount','voucheredSales'], 'single-product columns');

const gms = ui.slice(ui.indexOf('const GMS_COLUMNS'), ui.indexOf('const GROUP_COLUMNS'));
ordered(gms, ['campaignApi','impressions','clicks','ctr','conversions','directConversions','conversionRate','directConversionRate','costPerConversion','costPerDirectConversion','itemsSold','directItemsSold','gmv','directGmv','expense','roas','directRoas','acos','directAcos','voucherAmount','voucheredSales'], 'Shop GMV Max columns');

assert(ui.includes("row.campaignPlacement || '—'"), 'single-product table must include Shopee placement before performance metrics');
assert(ui.includes("localeFromDocument?.() === 'en' ? 'Sequence (System)' : '排序（系统）'"), 'GMS item sequence must be bilingual and system-labelled');
assert(ui.includes('<th>${sl(\'productName\')}</th><th>${sl(\'productId\')}</th>'), 'GMS item identity fields must follow export order');
console.log('single-product and Shop GMV Max field order tests: ok');