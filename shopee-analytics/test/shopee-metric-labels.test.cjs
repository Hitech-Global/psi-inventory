'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const labels = fs.readFileSync(path.join(__dirname, '..', 'web', 'shopee-metric-labels.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');
const productCard = fs.readFileSync(path.join(__dirname, '..', 'web', 'product-card-ui-v2.js'), 'utf8');
const exactPairs = [
  ['impressions', '展示次数', 'Impression'], ['clicks', '点击数', 'Clicks'], ['ctr', '点击率', 'CTR'],
  ['addToCart', '加入购物车', 'Add To Cart'], ['addToCartRate', '加入购物车频率', 'Add To Cart Rate'],
  ['conversions', '转化', 'Conversions'], ['directConversions', '直接转化', 'Direct Conversions'],
  ['conversionRate', '转化率', 'Conversion Rate'], ['directConversionRate', '直接转化率', 'Direct Conversion Rate'],
  ['costPerConversion', '每转化成本', 'Cost per Conversion'], ['costPerDirectConversion', '每一直接转化的成本', 'Cost per Direct Conversion'],
  ['itemsSold', '商品已出售', 'Items Sold'], ['directItemsSold', '直接已售商品', 'Direct Items Sold'],
  ['gmv', '销售金额', 'GMV'], ['directGmv', '直接销售金额', 'Direct GMV'], ['expense', '花费', 'Expense'],
  ['roas', '广告支出回报率', 'ROAS'], ['directRoas', '直接广告支出回报率', 'Direct ROAS'],
  ['acos', '广告销售成本', 'ACOS'], ['directAcos', '直接广告销售成本', 'Direct ACOS'],
];
for (const [key, zh, en] of exactPairs) {
  assert(labels.includes(`${key}: { zh: '${zh}', en: '${en}' }`), `missing exact Shopee label ${key}`);
}
assert(html.indexOf('/shopee-metric-labels.js') < html.indexOf('/app.js'), 'metric labels must load before app.js');
for (const legacy of ['Broad订单', 'Broad GMV', 'Broad ROAS', 'Broad CVR', 'Direct订单']) {
  assert(!productCard.includes(legacy), `Product Card UI must not expose legacy label ${legacy}`);
}
console.log('Shopee bilingual metric label contract: ok');
