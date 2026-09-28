'use strict';

const assert = require('assert');
const { buildCampaignSkillPackage, buildAdGroupSkillPackage } = require('../src/skill-analysis-service');

(async () => {
  const repository = {
    async loadCampaignDaily() { return [{ date:'2026-09-20', clicks:10, expense:100, direct_order:2, direct_gmv:800 }]; },
    async loadItemDaily() { return [{ date:'2026-09-20', item_id:7, clicks:10, expense:100, direct_order:2, direct_gmv:800 }]; },
    async loadCampaignOperations() { return [{ operation_type:'CAMPAIGN_SETTING_CHANGE' }]; },
  };
  const queryRepository = {
    async listShops() { return [{ shopId:1, countryCode:'ID', brandCode:'REDRAGON', timezone:'Asia/Jakarta', currency:'IDR' }]; },
    async getLatestCampaignSetting() { return { targetRoas:7, campaignBudget:300000 }; },
    async getCampaignItemNames() { return new Map([['7', { itemName:'Mouse', itemSku:'M-7' }]]); },
  };
  const strategyRepository = {
    async getShopStrategy() { return { adSpendRatioLimit:0.15 }; },
  };
  const pkg = await buildCampaignSkillPackage({
    repository, queryRepository, strategyRepository,
    shopId:1, campaignId:9, startDate:'2026-09-20', endDate:'2026-09-20',
    dataCutoff:'2026-09-20T23:59:59+07:00', triggerType:'MANUAL',
  });
  assert.strictEqual(pkg.shop.timezone, 'Asia/Jakarta');
  assert.strictEqual(pkg.campaign.targetRoas, 7);
  assert.strictEqual(pkg.campaign.adSpendRatioLimit, 0.15);
  assert.strictEqual(pkg.trigger.type, 'MANUAL');
  assert.strictEqual(pkg.operations.length, 1);
  assert.strictEqual(pkg.items[0].itemName, 'Mouse');
  assert.strictEqual(pkg.items[0].itemSku, 'M-7');
  assert.strictEqual(pkg.deterministicMetrics.campaign.directOrders7d, 2);

  const adPromotionRepository = {
    async list() {
      return [{
        promotion_key: 'MANUAL_IMPORT:group:test', granularity: 'DAY', period_start: '2026-09-20', period_end: '2026-09-20',
        event_date: '2026-09-20', campaign_name: 'Keyboard Group', campaign_budget: 500000,
        impressions: 1000, clicks: 50, expense: 100000, orders: 5, gmv: 800000,
        direct_gmv: 700000, source_roas: 8, direct_roas: 7, directConversions: 4, itemsSold: 6, directItemsSold: 5,
        items: [{ itemId: 77, itemSku: 'K-77', productName: 'Keyboard', impressions: 600, clicks: 30, expense: 60000, orders: 4, gmv: 500000, directGmv: 450000, directConversions: 3, directItemsSold: 4 }],
        quality_flags: [],
      }];
    },
  };
  const groupPkg = await buildAdGroupSkillPackage({
    adPromotionRepository, queryRepository, strategyRepository,
    shopId: 1, promotionKey: 'MANUAL_IMPORT:group:test', startDate: '2026-09-20', endDate: '2026-09-20',
    dataCutoff: '2026-09-20T23:59:59+07:00', triggerType: 'MANUAL',
  });
  assert.strictEqual(groupPkg.campaign.promotionType, 'AD_GROUP');
  assert.strictEqual(groupPkg.campaign.campaignName, 'Keyboard Group');
  assert.strictEqual(groupPkg.dataQuality.source, 'SHOPEE_AD_GROUP_MANUAL_IMPORT');
  assert.strictEqual(groupPkg.deterministicMetrics.campaign.directOrders7d, 4);
  assert.strictEqual(groupPkg.items[0].itemName, 'Keyboard');
  assert.strictEqual(groupPkg.items[0].directOrders, 3);
  console.log('shopee skill analysis service tests: ok');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
