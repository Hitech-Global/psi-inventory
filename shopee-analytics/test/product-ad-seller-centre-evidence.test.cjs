'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  parseCampaignIdFromFilename,
  parseProductAdSellerCentreFile,
} = require('../src/product-ad-seller-centre-import');
const {
  applyAtcEvidence,
  summarizeAtcProvenance,
} = require('../src/product-ads-source-router');

const filename = '商品-广告-报告-165010976-2026_09_21-2026_09_21.csv';
const csv = `\uFEFF商品广告报告 - Shopee 马来西亚
用户名称,redragonos3pf.my
商店名称,Redragon Malaysia OS
商店ID,1770037299
广告名称,Redragon M612 RGB PRO Gaming Mouse
商品编号,55107532325
,
报告创建时间,2026/09/27 09:35
时间,2026/09/21 - 2026/09/21


自动竞价
排序,关键字/位置,匹配类型,搜寻次数,竞价方式,版位,展示次数,点击数,点击率,加入购物车,加入购物车频率,转化,直接转化,转化率,直接转化率,每转化成本,每一直接转化的成本,商品已出售,直接已售商品,销售金额,直接销售金额,花费,平均排名,广告支出回报率,直接广告支出回报率,广告销售成本,直接广告销售成本,Voucher Amount,Vouchered Sales
1,自动选择,-,-,全站推广自定义ROAS,全部,697,36,5.16%,2,5.56%,1,1,2.78%,2.78%,21.89,21.89,1,1,98.00,98.00,21.89,35,4.48,4.48,22.34%,22.34%,0.00,0.00
`;

assert.strictEqual(parseCampaignIdFromFilename(filename), 165010976);

const parsed = parseProductAdSellerCentreFile({
  buffer: Buffer.from(csv, 'utf8'),
  filename,
});

assert.strictEqual(parsed.preview.reportSource, 'SHOPEE_PRODUCT_AD_EXPORT');
assert.strictEqual(parsed.preview.shopId, 1770037299);
assert.strictEqual(parsed.preview.campaignId, 165010976);
assert.strictEqual(parsed.preview.productId, 55107532325);
assert.strictEqual(parsed.preview.periodStart, '2026-09-21');
assert.strictEqual(parsed.preview.periodEnd, '2026-09-21');
assert.strictEqual(parsed.preview.fallbackEligible, true);
assert.strictEqual(parsed.preview.metrics.impressions, 697);
assert.strictEqual(parsed.preview.metrics.clicks, 36);
assert.strictEqual(parsed.preview.metrics.addToCart, 2);
assert(Math.abs(parsed.preview.metrics.addToCartRate - (2 / 36)) < 1e-12);
assert.strictEqual(parsed.preview.metrics.broadOrders, 1);
assert.strictEqual(parsed.preview.metrics.directOrders, 1);
assert.strictEqual(parsed.preview.metrics.broadGmv, 98);
assert.strictEqual(parsed.preview.metrics.directGmv, 98);
assert.strictEqual(parsed.preview.metrics.expense, 21.89);
assert.strictEqual(parsed.preview.metrics.voucherAmount, 0);
assert.strictEqual(parsed.preview.metrics.voucheredSales, 0);
assert(Math.abs(parsed.preview.metrics.ctr - (36 / 697)) < 1e-12);
assert(Math.abs(parsed.preview.metrics.broadRoas - (98 / 21.89)) < 1e-12);

assert.strictEqual(parsed.promotion.promotionType, 'INDIVIDUAL_AD');
assert.strictEqual(parsed.promotion.dataSource, 'MANUAL_IMPORT');
assert.strictEqual(parsed.promotion.promotionKey, 'MANUAL_IMPORT:product-ad:165010976');
assert.strictEqual(parsed.promotion.addToCart, 2);
assert.strictEqual(parsed.promotion.raw.sourceFormat, 'SHOPEE_PRODUCT_AD_EXPORT');
assert.strictEqual(parsed.item.itemId, 55107532325);
assert.strictEqual(parsed.item.addToCart, 2);

const hydratedMissingAtc = {
  event_date: '2026-09-21',
  clicks: 36,
  add_to_cart: null,
  add_to_cart_rate: null,
};
const evidenceRow = {
  event_date: '2026-09-21',
  evidence_add_to_cart: 2,
  evidence_promotion_key: 'MANUAL_IMPORT:product-ad:165010976',
  evidence_synced_at: '2026-09-27T03:50:00.000Z',
};
const fallback = applyAtcEvidence(hydratedMissingAtc, evidenceRow);
assert.strictEqual(fallback.add_to_cart, 2);
assert.strictEqual(fallback.__atcSource, 'SELLER_CENTRE_EXPORT');
assert.strictEqual(fallback.__atcEvidence.promotionKey, 'MANUAL_IMPORT:product-ad:165010976');

const apiWins = applyAtcEvidence({
  ...hydratedMissingAtc,
  add_to_cart: 3,
  add_to_cart_rate: 3 / 36,
}, evidenceRow);
assert.strictEqual(apiWins.add_to_cart, 3, 'Seller Centre evidence must never override Shopee API ATC');
assert.strictEqual(apiWins.__atcSource, 'SHOPEE_API');
assert.strictEqual(apiWins.__atcEvidence, null);

const provenance = summarizeAtcProvenance([fallback]);
assert.strictEqual(provenance.addToCart, 'SELLER_CENTRE_EXPORT');
assert.strictEqual(provenance.addToCartRate, 'DERIVED_FROM_SELLER_CENTRE_EXPORT');
assert.strictEqual(provenance.evidence.length, 1);

const incomplete = summarizeAtcProvenance([{ __atcSource: 'UNAVAILABLE' }]);
assert.strictEqual(incomplete.addToCart, 'INCOMPLETE');
assert.strictEqual(incomplete.addToCartRate, 'INCOMPLETE');

const rangeCsv = csv.replace('2026/09/21 - 2026/09/21', '2026/09/21 - 2026/09/26');
const range = parseProductAdSellerCentreFile({
  buffer: Buffer.from(rangeCsv, 'utf8'),
  filename: '商品-广告-报告-165010976-2026_09_21-2026_09_26.csv',
});
assert.strictEqual(range.preview.granularity, 'RANGE');
assert.strictEqual(range.preview.fallbackEligible, false, 'range evidence cannot be allocated to a daily API row');

const server = fs.readFileSync(path.join(__dirname, '..', 'src', 'standalone-server.js'), 'utf8');
assert(server.includes('createProductAdSellerCentreRouter'), 'Seller Centre evidence router must be mounted');

console.log('M612 Seller Centre Product Ad evidence contract: ok');
