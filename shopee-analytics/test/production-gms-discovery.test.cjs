'use strict';

const assert = require('assert');
const { runShopSyncCycle } = require('../src/shop-sync-runner');

(async () => {
  const originalMode = process.env.SHOPEE_ANALYTICS_DEPLOYMENT_MODE;
  process.env.SHOPEE_ANALYTICS_DEPLOYMENT_MODE = 'PRODUCTION';
  const requests = [];
  const savedDays = [];
  const upsertedCampaigns = [];
  const overviewWrites = [];

  const rawRepository = {
    async insertRawSnapshot() {},
    async upsertCampaign(row) { upsertedCampaigns.push(row); },
    async upsertCampaignDaily() {},
    async saveGmsDay(row) { savedDays.push(row); },
    async loadMembershipItemIds() { return []; },
    async markSyncSuccess() {},
    async markSyncFailure() {},
  };

  const adsClient = {
    async shopRequest(request) {
      requests.push(request);
      const p = request.path;
      if (p.includes('get_product_level_campaign_id_list')) {
        return { response: { has_next_page: false, campaign_list: [] } };
      }
      if (p.includes('get_gms_campaign_performance')) {
        const discovery = !Object.prototype.hasOwnProperty.call(request.body || {}, 'campaign_id');
        return { response: { campaign_id: 987654321, report: {
          impression: discovery ? 100 : 10, clicks: discovery ? 20 : 2,
          expense: discovery ? 30 : 3, broad_gmv: discovery ? 210 : 21,
          broad_order: discovery ? 7 : 1,
        } } };
      }
      if (p.includes('get_gms_item_performance')) {
        return { response: { has_next_page: false, result_list: [] } };
      }
      if (p.includes('get_all_cpc_ads_daily_performance')) {
        return { response: [{ date: '28-09-2026', impression: 10, clicks: 1, broad_order: 1, broad_gmv: 50, expense: 5 }] };
      }
      if (p.includes('get_order_list')) {
        return { response: { more: false, order_list: [] } };
      }
      if (p.includes('get_order_detail')) return { response: { order_list: [] } };
      throw new Error(`unexpected endpoint ${p}`);
    },
  };

  const runtime = {
    queryRepository: { async listKnownGmsCampaignIds() { return []; } },
    rawRepository,
    adPromotionRepository: null,
    productAdsShopRepository: {
      async upsertMany(input) { overviewWrites.push(input); return { rowCount: input.rows.length }; },
    },
    campaignRepository: { async saveCampaignSettingsSnapshot() {} },
    roleClients: { ADS: { async getAccessToken() { return 'fixture-token'; }, client: adsClient } },
    productRepository: {}, promotionRepository: {}, orderRepository: { async upsertOrder() {} },
    returnRepository: {}, shopBiRepository: {}, shopRepository: {},
  };

  try {
    const summary = await runShopSyncCycle({
      runtime,
      shop: { shopId: 132645, timezone: 'Asia/Jakarta', syncScope: 'API_AND_MANUAL' },
      mode: 'hourly',
      now: new Date('2026-09-28T06:00:00Z'),
    });
    assert.strictEqual(summary.ok, true);
    const discovery = requests.find(r => r.path.includes('get_gms_campaign_performance') &&
      !Object.prototype.hasOwnProperty.call(r.body || {}, 'campaign_id'));
    assert(discovery, 'Production must discover GMS when no known campaign ID exists');
    assert.deepStrictEqual(discovery.body, { start_date: '22-09-2026', end_date: '28-09-2026' });
    assert(upsertedCampaigns.some(row => row.campaignId === 987654321 && row.campaignTypeNormalized === 'GMS'));
    assert.strictEqual(savedDays.length, 7, 'discovered GMS must immediately sync the recent 7 days');
    assert(savedDays.every(row => row.campaignId === 987654321));
    assert.strictEqual(overviewWrites.length, 1, 'Product Card overview must still refresh');
    assert(summary.steps.some(step => step.name === 'gms-discovery' && step.ok));
    assert(!JSON.stringify(summary).includes('fixture-token'));
  } finally {
    if (originalMode === undefined) delete process.env.SHOPEE_ANALYTICS_DEPLOYMENT_MODE;
    else process.env.SHOPEE_ANALYTICS_DEPLOYMENT_MODE = originalMode;
  }
  console.log('production GMS discovery and immediate 7-day sync tests: ok');
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
