'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { normalizeCampaignMetric } = require('../src/sync-product-ads');
const { hydrateCampaignDailySourceMetrics } = require('../src/repository');
const { sumPerformance } = require('../src/metrics');

const metric = {
  date: '21-09-2026',
  impression: 697,
  click: 36,
  ctr: 5.16,
  cr: 2.78,
  direct_cr: 2.78,
  broad_order: 1,
  direct_order: 1,
  broad_item_sold: 1,
  direct_item_sold: 1,
  broad_gmv: 98,
  direct_gmv: 98,
  expense: 21.89,
  broad_roi: 4.48,
  direct_roi: 4.48,
  add_to_cart: 2,
  cpc: 21.89,
  cpdc: 21.89,
  broad_cir: 0.22,
  direct_cir: 0.22,
};

const normalized = normalizeCampaignMetric(metric);
assert.strictEqual(normalized.impressions, 697);
assert.strictEqual(normalized.clicks, 36);
assert.strictEqual(normalized.ctr, 0.0516);
assert.strictEqual(normalized.broadCvr, 0.0278);
assert.strictEqual(normalized.directCvr, 0.0278);
assert.strictEqual(normalized.broadRoas, 4.48);
assert.strictEqual(normalized.directRoas, 4.48);
assert.strictEqual(normalized.addToCart, 2);
assert.strictEqual(normalized.costPerConversion, 21.89);
assert.strictEqual(normalized.costPerDirectConversion, 21.89);
assert(Math.abs(normalized.addToCartRate - (2 / 36)) < 1e-12);
assert(Math.abs(normalized.broadAcos - (21.89 / 98)) < 1e-12);
assert(Math.abs(normalized.directAcos - (21.89 / 98)) < 1e-12);
assert.strictEqual(normalized.cpc, 21.89 / 36, 'read-model CPC remains true cost per click');

// Existing production rows were written before source-metric columns existed.
// raw_json must make those rows accurate without requiring another Shopee API call.
const hydrated = hydrateCampaignDailySourceMetrics({
  shop_id: 1770037299,
  campaign_id: 165010976,
  event_date: '2026-09-21',
  impressions: 697,
  clicks: 36,
  expense: 21.89,
  broad_gmv: 98,
  broad_orders: 1,
  broad_units: 1,
  direct_gmv: 98,
  direct_roas: 4.4769301051,
  direct_orders: 1,
  direct_units: 1,
  ctr: null,
  broad_cvr: null,
  direct_cvr: null,
  broad_roas: null,
  add_to_cart: null,
  add_to_cart_rate: null,
  cost_per_conversion: null,
  cost_per_direct_conversion: null,
  broad_acos: null,
  direct_acos: null,
  raw_json: { campaign: { campaign_id: 165010976, ad_type: 'manual' }, metric },
});

const single = sumPerformance([hydrated]);
assert.strictEqual(single.ctr, 0.0516);
assert.strictEqual(single.broadCvr, 0.0278);
assert.strictEqual(single.directCvr, 0.0278);
assert.strictEqual(single.broadRoas, 4.48);
assert.strictEqual(single.directRoas, 4.48, 'raw Shopee source must override legacy derived direct ROAS');
assert.strictEqual(single.addToCart, 2);
assert.strictEqual(single.costPerConversion, 21.89);
assert.strictEqual(single.costPerDirectConversion, 21.89);
assert(Math.abs(single.broadAcos - (21.89 / 98)) < 1e-12);

const migration = fs.readFileSync(path.join(__dirname, '..', 'schema-product-ad-source-metrics.sql'), 'utf8');
for (const column of ['ctr', 'broad_cvr', 'direct_cvr', 'broad_roas', 'add_to_cart', 'cost_per_conversion', 'cost_per_direct_conversion', 'broad_acos', 'direct_acos']) {
  assert(migration.includes(column), `source metric migration must include ${column}`);
}

const server = fs.readFileSync(path.join(__dirname, '..', 'src', 'standalone-server.js'), 'utf8');
assert(server.includes('createProductAdsSourceRouter'), 'source-accurate Product Ads route must be mounted before legacy router');

console.log('M612 Product Ad source precision contract: ok');
