'use strict';

const assert = require('assert');
const {
  assertPilotProductAdsDiscoveryAllowed,
  summarizeCampaign,
  runPilotProductAdsDiscovery,
  safeProductAdsDiscoveryError,
} = require('../scripts/discover-pilot-product-ads.cjs');

const env = {
  SHOPEE_ANALYTICS_DEPLOYMENT_MODE: 'PILOT_GMV_MAX',
  SHOPEE_PILOT_GMV_MAX_SHOP_ID: '1770037299',
  SHOPEE_PILOT_GMV_MAX_BRAND: 'REDRAGON',
  SHOPEE_PILOT_GMV_MAX_CAMPAIGN_IDS: '',
  SHOPEE_PILOT_SHOP_GMV_MAX_CAMPAIGN_IDS: '',
  SHOPEE_OAUTH_ENABLE: 'YES',
  SHOPEE_PILOT_PRODUCT_ADS_DISCOVERY_ENABLE: 'YES',
};

assert.deepStrictEqual(assertPilotProductAdsDiscoveryAllowed(env), { shopId: 1770037299, brand: 'REDRAGON' });
assert.throws(() => assertPilotProductAdsDiscoveryAllowed({ ...env, SHOPEE_PILOT_PRODUCT_ADS_DISCOVERY_ENABLE: 'NO' }), /Refusing Pilot Product Ads discovery/);
assert.throws(() => assertPilotProductAdsDiscoveryAllowed({ ...env, SHOPEE_PILOT_SHOP_GMV_MAX_CAMPAIGN_IDS: '1' }), /blank campaign allowlist/);
assert.throws(() => assertPilotProductAdsDiscoveryAllowed({ ...env, SHOPEE_PILOT_GMV_MAX_SHOP_ID: '1' }), /restricted to shop 1770037299/);

const oneItem = summarizeCampaign({ listed: { campaignId: 1, adType: 'manual' }, setting: {
  campaignId: 1, adType: 'manual', raw: { common_info: { item_id_list: [11] }, auto_product_ads_info: [] },
} });
assert.strictEqual(oneItem.provisionalEvidence, 'SINGLE_ITEM');
assert.strictEqual(oneItem.itemCount, 1);
assert.strictEqual(oneItem.adType, 'manual');
const noItems = summarizeCampaign({ listed: { campaignId: 2, adType: 'auto' }, setting: { campaignId: 2, adType: 'auto', raw: {} } });
assert.strictEqual(noItems.provisionalEvidence, 'NO_ITEM_MEMBERSHIP');
const multipleItems = summarizeCampaign({ listed: { campaignId: 3, adType: 'auto' }, setting: {
  campaignId: 3, adType: 'auto', raw: { common_info: { item_id_list: [31, 32] }, auto_product_ads_info: [{ item_id: 33 }] },
} });
assert.strictEqual(multipleItems.provisionalEvidence, 'MULTI_ITEM');
assert.strictEqual(multipleItems.itemCount, 3);

(async () => {
  const calls = [];
  let tokenCalls = 0;
  const campaignRows = Array.from({ length: 101 }, (_, index) => ({ campaign_id: index + 1, ad_type: index % 2 ? 'auto' : 'manual' }));
  const result = await runPilotProductAdsDiscovery({
    env,
    pool: {},
    createRuntime: () => ({ roleClients: { ADS: {
      async getAccessToken(shopId) { tokenCalls += 1; assert.strictEqual(shopId, 1770037299); return 'encrypted-db-token-fixture'; },
      client: {
        async shopRequest(request) {
          calls.push(request);
          if (request.path.includes('get_product_level_campaign_id_list')) {
            assert.strictEqual(request.method, 'GET');
            assert.strictEqual(request.query.ad_type, 'all');
            return { response: { has_next_page: false, campaign_list: campaignRows } };
          }
          if (request.path.includes('get_product_level_campaign_setting_info')) {
            const ids = request.query.campaign_id_list.split(',').map(Number);
            assert(ids.length <= 100, 'settings request must be chunked to <=100 IDs');
            return { response: { campaign_list: ids.map(id => ({
              campaign_id: id,
              common_info: { ad_type: id % 2 ? 'auto' : 'manual', ad_name: `Campaign ${id}`, item_id_list: id === 1 ? [] : [id] },
              auto_bidding_info: { roas_target: 3.5 },
              auto_product_ads_info: id === 3 ? [{ item_id: 3001 }, { item_id: 3002 }] : [],
            })) } };
          }
          throw new Error(`unexpected endpoint: ${request.path}`);
        },
      },
    } } }),
  });
  assert.strictEqual(tokenCalls, 1);
  assert.strictEqual(result.persisted, false);
  assert.strictEqual(result.campaigns.length, 101);
  assert.strictEqual(result.settingRequestCount, 2);
  assert.strictEqual(result.campaigns.find(row => row.campaignId === 1).provisionalEvidence, 'NO_ITEM_MEMBERSHIP');
  assert.strictEqual(result.campaigns.find(row => row.campaignId === 2).provisionalEvidence, 'SINGLE_ITEM');
  assert.strictEqual(result.campaigns.find(row => row.campaignId === 3).provisionalEvidence, 'MULTI_ITEM');
  assert.strictEqual(result.campaigns.find(row => row.campaignId === 2).adType, 'manual');
  assert.strictEqual(result.campaigns.find(row => row.campaignId === 3).adType, 'auto');
  assert(!Object.hasOwn(env, 'SHOPEE_ADS_ACCESS_TOKEN'));
  assert(!JSON.stringify(result).includes('encrypted-db-token-fixture'));
  assert(calls.every(call => call.path.includes('get_product_level_campaign_id_list') || call.path.includes('get_product_level_campaign_setting_info')));

  let adsCallsAfterMissingToken = 0;
  await assert.rejects(() => runPilotProductAdsDiscovery({
    env,
    pool: {},
    createRuntime: () => ({ roleClients: { ADS: {
      async getAccessToken() { throw new Error('SHOPEE_TOKEN_REFRESH_FAILED'); },
      client: { async shopRequest() { adsCallsAfterMissingToken += 1; } },
    } } }),
  }), /SHOPEE_TOKEN_REFRESH_FAILED/);
  assert.strictEqual(adsCallsAfterMissingToken, 0);

  const safe = safeProductAdsDiscoveryError(new Error('access_token=SUPER_SECRET refresh_token=SUPER_SECRET partner_key=SUPER_SECRET'));
  assert(!JSON.stringify(safe).includes('SUPER_SECRET'));
  console.log('shopee pilot Product Ads discovery tests: ok');
})().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
