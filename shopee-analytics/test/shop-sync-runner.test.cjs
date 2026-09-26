'use strict';

const assert = require('assert');
const { normalizeShopProfile, runShopSyncCycle } = require('../src/shop-sync-runner');

const normalized = normalizeShopProfile({
  shopId: '123',
  displayName: 'Redragon ID',
  timezone: 'Asia/Jakarta',
  brandPortalTimezone: 'GMT+7',
});
assert.strictEqual(normalized.shopId, 123);
assert.strictEqual(normalized.timezone, 'Asia/Jakarta');
assert.strictEqual(normalized.brandPortalTimezone, 'GMT+7');

assert.throws(
  () => normalizeShopProfile({ shopId: 123 }),
  /timezone is required/,
);

(async () => {
  const saved = [];
  const calls = [];
  const original = {
    mode: process.env.SHOPEE_ANALYTICS_DEPLOYMENT_MODE,
    shop: process.env.SHOPEE_PILOT_GMV_MAX_SHOP_ID,
    brand: process.env.SHOPEE_PILOT_GMV_MAX_BRAND,
    gms: process.env.SHOPEE_PILOT_SHOP_GMV_MAX_CAMPAIGN_IDS,
  };
  Object.assign(process.env, {
    SHOPEE_ANALYTICS_DEPLOYMENT_MODE: 'PILOT_GMV_MAX',
    SHOPEE_PILOT_GMV_MAX_SHOP_ID: '123',
    SHOPEE_PILOT_GMV_MAX_BRAND: 'REDRAGON',
    SHOPEE_PILOT_SHOP_GMV_MAX_CAMPAIGN_IDS: '7',
  });
  try {
    const runtime = {
      queryRepository: { async listKnownGmsCampaignIds() { return []; } },
      rawRepository: { async loadMembershipItemIds() { return []; }, async saveGmsDay(input) { saved.push(input); }, async markSyncSuccess() {}, async markSyncFailure() {} },
      adPromotionRepository: {},
      roleClients: { ADS: { async getAccessToken() { return 'fixture-token'; }, client: { async shopRequest(request) {
        calls.push(request.path);
        if (request.path.includes('get_gms_campaign_performance')) return { response: { campaign_id: 7, report: {} } };
        if (request.path.includes('get_gms_item_performance')) return { response: { has_next_page: false, result_list: [] } };
        throw new Error(`unexpected endpoint ${request.path}`);
      } } } },
      campaignRepository: {}, productRepository: {}, promotionRepository: {}, orderRepository: {}, returnRepository: {}, shopBiRepository: {}, shopRepository: {},
    };
    const summary = await runShopSyncCycle({ runtime, shop: { shopId: 123, timezone: 'Asia/Kuala_Lumpur' }, mode: 'daily', now: new Date('2026-09-18T00:00:00Z'), seededGmsCampaignIds: [7] });
    assert.strictEqual(summary.ok, true);
    assert.strictEqual(saved.length, 7);
    assert(calls.every(path => path.includes('get_gms_')));
    assert(!summary.steps.some(step => ['shop-info', 'campaign-settings', 'orders-recent', 'products'].includes(step.name)));
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[{ mode: 'SHOPEE_ANALYTICS_DEPLOYMENT_MODE', shop: 'SHOPEE_PILOT_GMV_MAX_SHOP_ID', brand: 'SHOPEE_PILOT_GMV_MAX_BRAND', gms: 'SHOPEE_PILOT_SHOP_GMV_MAX_CAMPAIGN_IDS' }[key]];
      else process.env[{ mode: 'SHOPEE_ANALYTICS_DEPLOYMENT_MODE', shop: 'SHOPEE_PILOT_GMV_MAX_SHOP_ID', brand: 'SHOPEE_PILOT_GMV_MAX_BRAND', gms: 'SHOPEE_PILOT_SHOP_GMV_MAX_CAMPAIGN_IDS' }[key]] = value;
    }
  }
  console.log('shopee pilot shop sync isolation tests: ok');
})().catch(error => { console.error(error); process.exitCode = 1; });

console.log('shopee shop sync runner tests: ok');
