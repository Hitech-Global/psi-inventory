'use strict';

const assert = require('assert');
const { ShopeeSyncService, requireRole } = require('../src/sync-service');

assert.throws(() => requireRole({}, 'ADS'), /Missing configured Shopee role client/);

const promotionWrites = [];
const rawWrites = [];
const campaignRequests = [];
const roleClients = {
  STORE_OPS: {
    accessToken: 'token',
    client: {
      async shopRequest(req) {
        if (req.path.includes('get_voucher_list')) {
          return { response: { more: false, voucher_list: [{ voucher_id: 10 }] } };
        }
        if (req.path.endsWith('/get_voucher')) {
          return { response: { voucher_id: 10, voucher_name: 'Test', item_id_list: [101] } };
        }
        if (req.path.includes('get_discount_list')) {
          return { response: { more: false, discount_list: [{ discount_id: 20 }] } };
        }
        if (req.path.endsWith('/get_discount')) {
          return {
            response: {
              discount_id: 20,
              discount_name: 'D',
              status: 'ongoing',
              more: false,
              item_list: [{ item_id: 101, item_promotion_price: 100 }],
            },
          };
        }
        throw new Error(`unexpected path: ${req.path}`);
      },
    },
  },
};

const service = new ShopeeSyncService({
  shopId: 1,
  roleClients,
  rawRepository: {
    async insertRawSnapshot(input) { rawWrites.push(input); },
  },
  promotionRepository: {
    async upsertVoucher(input) { promotionWrites.push({ type: 'voucher', ...input }); },
    async upsertDiscount(input) { promotionWrites.push({ type: 'discount', ...input }); },
  },
});


const productAdWrites = [];
const productAdRequests = [];
const productAdsService = new ShopeeSyncService({
  shopId: 1,
  roleClients: {
    ADS: {
      accessToken: 'token',
      client: {
        async shopRequest(req) {
          productAdRequests.push(req);
          if (req.path.includes('get_product_level_campaign_id_list')) {
            return { response: { has_next_page: false, campaign_list: [{ campaign_id: 3001, ad_type: req.query.ad_type }] } };
          }
          if (req.path.includes('get_product_level_campaign_setting_info')) {
            return { response: { campaign_list: [] } };
          }
          if (req.path.includes('get_product_campaign_daily_performance')) {
            return {
              response: [{
                campaign_list: [{
                  campaign_id: 3001,
                  ad_type: 'manual',
                  metrics_list: [{ date: '09-22-2026', impression: 100, clicks: 10, expense: 5, broad_gmv: 30, broad_order: 2 }],
                }],
              }],
            };
          }
          throw new Error(`unexpected product ads path: ${req.path}`);
        },
      },
    },
  },
  rawRepository: {
    async insertRawSnapshot() {},
    async upsertCampaign(input) { productAdWrites.push({ type: 'campaign', input }); },
    async upsertCampaignDaily(input) { productAdWrites.push({ type: 'daily', input }); },
  },
  campaignRepository: { async saveCampaignSettingsSnapshot() {} },
});

const campaignService = new ShopeeSyncService({
  shopId: 1,
  roleClients: {
    ADS: {
      accessToken: 'token',
      client: {
        async shopRequest(req) {
          campaignRequests.push(req);
          assert(req.path.includes('get_product_level_campaign_setting_info'));
          assert.strictEqual(req.query.campaign_id_list, '2001,2002');
          return { response: { campaign_list: [] } };
        },
      },
    },
  },
  rawRepository: {
    async insertRawSnapshot() {},
  },
  campaignRepository: {
    async saveCampaignSettingsSnapshot() {},
  },
});

(async () => {
  const result = await service.syncPromotions();
  assert.deepStrictEqual(result, { voucherCount: 1, discountCount: 1 });
  assert.strictEqual(promotionWrites.length, 2);
  assert(rawWrites.length >= 4);

  const settings = await campaignService.syncCampaignSettings({ campaignIds: [2001, '2002', 2001] });
  assert.deepStrictEqual(settings, { campaignCount: 2, settingsCount: 0 });
  assert.strictEqual(campaignRequests.length, 1);

  const productAds = await productAdsService.syncProductAdsDaily({
    startDate: '2026-09-22',
    endDate: '2026-09-22',
    adTypes: ['manual'],
  });
  assert.deepStrictEqual(productAds.byType.manual, { campaignCount: 1, settingCount: 0, dailyRowCount: 1 });
  assert(productAdRequests.some(req => req.path.includes('get_product_campaign_daily_performance')));
  assert(productAdWrites.some(row => row.type === 'campaign' && row.input.campaignTypeNormalized === 'MANUAL_PRODUCT_AD'));
  assert(productAdWrites.some(row => row.type === 'daily'));
  console.log('shopee sync service tests: ok');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
