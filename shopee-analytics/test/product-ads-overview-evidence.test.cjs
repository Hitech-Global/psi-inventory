'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  parseOverviewSellerCentreReport,
} = require('../src/product-ads-overview-evidence');
const {
  applyOverviewEvidence,
  evidenceCoverage,
  maskIncompleteSupplementalSummary,
} = require('../src/product-ads-v2-router');
const { aggregateGmsSellerEvidence } = require('../src/http-router');

const report = parseOverviewSellerCentreReport([
  ['商店ID', '1770037299'],
  ['时间', '21/09/2026 - 22/09/2026'],
  ['日期','展示次数','点击数','订单量','商品已出售','销售额','花费','广告支出回报率','优惠券金额','优惠券带来的销售额','加购次数','加购率'],
  ['2026-09-21','4766','230','9','9','863','144.61','5.97','24.90','227','10','4.35%'],
  ['2026-09-22','5911','274','2','2','220','48.46','4.54','0','0','9','3.28%'],
], { filename: 'product-ads-overview-2026_09_21-2026_09_22.csv' });

assert.strictEqual(report.shopId, 1770037299);
assert.strictEqual(report.rows.length, 2);
assert.strictEqual(report.rows[0].periodStart, '2026-09-21');
assert.strictEqual(report.rows[0].addToCart, 10);
assert(Math.abs(report.rows[0].addToCartRate - 0.0435) < 1e-12);
assert.strictEqual(report.rows[0].voucherAmount, 24.9);
assert.strictEqual(report.rows[0].voucheredSales, 227);

const merged = applyOverviewEvidence({
  eventDate: '2026-09-21', clicks: 230,
  addToCart: null, addToCartRate: null,
  voucherAmount: null, voucheredSales: null,
}, {
  add_to_cart: '10', add_to_cart_rate: '0.0435',
  voucher_amount: '24.9', vouchered_sales: '227',
  source_format: 'SHOPEE_PRODUCT_ADS_OVERVIEW_EXPORT', source_ref: 'test.csv',
});
assert.strictEqual(merged.addToCart, 10);
assert.strictEqual(merged.voucherAmount, 24.9);
assert.strictEqual(merged.supplementalSource, 'SHOPEE_PRODUCT_ADS_OVERVIEW_EXPORT');

const coverage = evidenceCoverage([merged, {
  eventDate: '2026-09-22', addToCart: 9, addToCartRate: 0.0328,
  voucherAmount: 0, voucheredSales: 0,
}], 2, null);
assert.strictEqual(coverage.addToCart.complete, true);
assert.strictEqual(coverage.voucherAmount.availableDays, 2);
assert.strictEqual(coverage.voucheredSales.complete, true);

const partialCoverage = evidenceCoverage([
  { eventDate: '2026-09-21', addToCart: 10, addToCartRate: 0.0435, voucherAmount: 24.9, voucheredSales: 227 },
  { eventDate: '2026-09-22', addToCart: null, addToCartRate: null, voucherAmount: null, voucheredSales: null },
], 2, null);
const masked = maskIncompleteSupplementalSummary({ addToCart: 10, addToCartRate: 0.0435, voucherAmount: 24.9, voucheredSales: 227, clicks: 504 }, partialCoverage);
assert.strictEqual(masked.addToCart, null, 'partial evidence must not masquerade as a full-period ATC total');
assert.strictEqual(masked.voucherAmount, null, 'partial evidence must not masquerade as a full-period Voucher total');
assert.strictEqual(masked.clicks, 504, 'API core metrics must remain visible');

const gmsEvidence = aggregateGmsSellerEvidence([
  {
    campaign_id: 164499732, period_start: '2026-09-21', period_end: '2026-09-21',
    raw_json: { sourceFormat: 'SHOPEE_GMS_SELLER_CENTRE_EXPORT', sourceMetrics: { voucherAmount: 24.9, voucheredSales: 227 } },
    items: [{ itemId: 101, voucherAmount: 10, voucheredSales: 100 }, { itemId: 102, voucherAmount: 14.9, voucheredSales: 127 }],
  },
], '2026-09-21', '2026-09-21').get(164499732);
assert.strictEqual(gmsEvidence.voucherAmount, 24.9);
assert.strictEqual(gmsEvidence.voucheredSales, 227);
assert.strictEqual(gmsEvidence.items['101'].voucherAmount, 10);
assert.strictEqual(gmsEvidence.coverage, 'EXACT_RANGE');

const incompleteGms = aggregateGmsSellerEvidence([
  { campaign_id: 7, period_start: '2026-09-21', period_end: '2026-09-21', raw_json: { sourceFormat: 'SHOPEE_GMS_SELLER_CENTRE_EXPORT', sourceMetrics: { voucherAmount: 1 } }, items: [] },
], '2026-09-21', '2026-09-22');
assert.strictEqual(incompleteGms.has(7), false, 'partial daily GMS evidence must not masquerade as a complete range');

const schema = fs.readFileSync(path.join(__dirname, '..', 'schema-product-ads-overview.sql'), 'utf8');
assert(schema.includes('shopee_product_ads_overview_evidence'));
const server = fs.readFileSync(path.join(__dirname, '..', 'src', 'standalone-server.js'), 'utf8');
assert(server.includes('createProductAdsOverviewEvidenceRouter'));

console.log('Product Card overview Seller Centre evidence tests: ok');
