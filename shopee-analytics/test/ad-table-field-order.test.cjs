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
ordered(manual, ['adInfo','dailyBudget','targetRoas','diagnosis','expense','gmv','roas','impressions','clicks','ctr','addToCart','addToCartRate','conversions','conversionRate','itemsSold','costPerConversion','acos','directConversions','directConversionRate','directItemsSold','directGmv','directRoas','costPerDirectConversion','directAcos','voucherAmount','voucheredSales','averageRank'], 'single-product Shopee columns');

const gms = ui.slice(ui.indexOf('const GMS_COLUMNS'), ui.indexOf('const GROUP_COLUMNS'));
ordered(gms, ['campaignApi','impressions','clicks','ctr','conversions','directConversions','conversionRate','directConversionRate','costPerConversion','costPerDirectConversion','itemsSold','directItemsSold','gmv','directGmv','expense','roas','directRoas','acos','directAcos','voucherAmount','voucheredSales'], 'Shop GMV Max columns');

const groups = ui.slice(ui.indexOf('const GROUP_COLUMNS'), ui.indexOf('function headerHtml'));
ordered(groups, ['adInfo','dailyBudget','targetRoas','diagnosis','expense','gmv','roas','impressions','clicks','ctr','addToCart','addToCartRate','conversions','conversionRate','itemsSold','costPerConversion','acos','directConversions','directConversionRate','directItemsSold','directGmv','directRoas','costPerDirectConversion','directAcos','voucherAmount','voucheredSales','dataQuality'], 'ad-group Shopee columns');

assert(ui.includes("row.campaignPlacement || '—'"), 'single-product table must keep placement inside advertising information');
assert(ui.includes("localeFromDocument?.() === 'en' ? 'Sequence (System)' : '排序（系统）'"), 'GMS item sequence must be bilingual and system-labelled');
assert(ui.includes('<th>${sl(\'productName\')}</th><th>${sl(\'productId\')}</th>'), 'GMS item identity fields must follow export order');
console.log('single-product and Shop GMV Max field order tests: ok');