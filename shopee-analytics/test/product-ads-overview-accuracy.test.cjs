'use strict';

const assert = require('assert');
const {
  normalizeShopProductAdsRow,
  normalizeShopProductAdsPayload,
  percentNumberToFraction,
} = require('../src/sync-product-ads-overview');
const { summarizeProductAdsRows } = require('../src/product-ads-shop-repository');

// Production Shopee Ads responses use fractional rate fields.
// Example from 3PF: ctr=0.0462 means 4.62%, so preserve source scale.
assert.strictEqual(percentNumberToFraction({ ctr: 0.0462 }, ['ctr']), 0.0462);
assert.strictEqual(percentNumberToFraction({ cr: 0.0172 }, ['cr']), 0.0172);
assert.strictEqual(percentNumberToFraction({ broad_cir: 0.0817 }, ['broad_cir']), 0.0817);

const row = normalizeShopProductAdsRow({
  date: '25-09-2026',
  impression: 20000,
  clicks: 100,
  ctr: 0.005,
  direct_order: 2,
  broad_order: 5,
  direct_conversions: 0.02,
  broad_conversions: 0.05,
  direct_item_sold: 3,
  broad_item_sold: 7,
  direct_gmv: 98.1,
  broad_gmv: 245.67,
  expense: 20.08,
  cost_per_conversion: 4.016,
  cpdc: 10.04,
  direct_roas: 4.8854581673,
  broad_roas: 12.234561753,
  direct_cir: 0.2047,
  broad_cir: 0.0817,
});

assert.strictEqual(row.eventDate, '2026-09-25');
assert.strictEqual(row.impressions, 20000);
assert.strictEqual(row.clicks, 100);
assert.strictEqual(row.ctr, 0.005);
assert.strictEqual(row.directCvr, 0.02);
assert.strictEqual(row.broadCvr, 0.05);
assert.strictEqual(row.directAcos, 0.2047);
assert.strictEqual(row.broadAcos, 0.0817);
assert.strictEqual(row.directGmv, 98.1);
assert.strictEqual(row.broadGmv, 245.67);
assert.strictEqual(row.expense, 20.08);
assert.strictEqual(row.directRoas, 4.8854581673);
assert.strictEqual(row.broadRoas, 12.234561753);
assert.strictEqual(row.raw.ctr, 0.005, 'raw Shopee source value must remain unchanged for reconciliation');

const payloadRows = normalizeShopProductAdsPayload({ response: [
  { date: '24-09-2026', impression: 100, clicks: 1, ctr: 0.01, broad_order: 1, broad_gmv: 10, expense: 2, broad_roas: 5 },
  { date: '25-09-2026', impression: 200, clicks: 1, ctr: 0.005, broad_order: 0, broad_gmv: 0, expense: 1, broad_roas: 0 },
] });
assert.strictEqual(payloadRows.length, 2);
assert.strictEqual(payloadRows[0].ctr, 0.01);
assert.strictEqual(payloadRows[1].ctr, 0.005);

// Range summaries are recomputed from additive source metrics, not averaged
// daily rates. This matches how aggregate CTR/ROAS should be derived.
const summary = summarizeProductAdsRows(payloadRows.map(item => ({
  impressions: item.impressions,
  clicks: item.clicks,
  direct_orders: item.directOrders,
  broad_orders: item.broadOrders,
  direct_units: item.directUnits,
  broad_units: item.broadUnits,
  direct_gmv: item.directGmv,
  broad_gmv: item.broadGmv,
  expense: item.expense,
})));
assert.strictEqual(summary.impressions, 300);
assert.strictEqual(summary.clicks, 2);
assert(Math.abs(summary.ctr - (2 / 300)) < 1e-12);
assert(Math.abs(summary.broadRoas - (10 / 3)) < 1e-12);

console.log('Product Card source metric accuracy tests: ok');
