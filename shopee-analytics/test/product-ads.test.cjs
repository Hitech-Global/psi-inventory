'use strict';

const assert = require('assert');
const {
  toShopeeAdsDate,
  campaignFamilyForAdType,
  normalizeProductCampaignDailyPayload,
  fetchProductCampaignDailyPerformance,
} = require('../src/sync-product-ads');

assert.strictEqual(toShopeeAdsDate('2026-09-22'), '09-22-2026');
assert.strictEqual(campaignFamilyForAdType('manual'), 'MANUAL_PRODUCT_AD');
assert.strictEqual(campaignFamilyForAdType('auto'), 'AUTO_PRODUCT_AD');
assert.throws(() => campaignFamilyForAdType('all'), /manual or auto/);

const sample = {
  response: [{
    shop_id: 1,
    campaign_list: [{
      campaign_id: 2001,
      ad_type: 'manual',
      campaign_placement: 'search',
      ad_name: 'Manual Product',
      metrics_list: [{
        date: '09-22-2026',
        impression: 1000,
        clicks: 50,
        expense: 100,
        broad_gmv: 700,
        broad_order: 10,
        direct_gmv: 500,
        direct_order: 7,
      }],
    }],
  }],
};
const rows = normalizeProductCampaignDailyPayload(sample);
assert.strictEqual(rows.length, 1);
assert.strictEqual(rows[0].campaignId, 2001);
assert.strictEqual(rows[0].campaignFamily, 'MANUAL_PRODUCT_AD');
assert.strictEqual(rows[0].eventDate, '2026-09-22');
assert.strictEqual(rows[0].performance.broadRoas, 7);
assert.strictEqual(rows[0].performance.directOrders, 7);

(async () => {
  const calls = [];
  const client = { async shopRequest(req) { calls.push(req); return sample; } };
  const ids = Array.from({ length: 101 }, (_, i) => 3000 + i);
  const result = await fetchProductCampaignDailyPerformance({
    client, shopId: 1, accessToken: 'fixture-token', campaignIds: ids,
    startDate: '2026-09-16', endDate: '2026-09-22',
  });
  assert.strictEqual(calls.length, 2);
  assert.strictEqual(calls[0].query.campaign_id_list.split(',').length, 100);
  assert.strictEqual(calls[1].query.campaign_id_list.split(',').length, 1);
  assert.strictEqual(calls[0].query.start_date, '09-16-2026');
  assert.strictEqual(calls[0].query.end_date, '09-22-2026');
  assert(calls.every(call => call.path.includes('get_product_campaign_daily_performance')));
  assert.strictEqual(result.rawPages.length, 2);
  console.log('shopee product ads tests: ok');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
