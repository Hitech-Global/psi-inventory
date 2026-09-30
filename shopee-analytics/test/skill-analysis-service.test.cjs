'use strict';

const assert = require('assert');
const { buildCampaignSkillPackage, buildAdGroupSkillPackage } = require('../src/skill-analysis-service');

(async () => {
  const repository = {
    async loadCampaignDaily({ startDate }) {
      if (startDate === '2026-09-20') return [{ date:'2026-09-20', impression:100, clicks:10, expense:100, direct_order:2, direct_gmv:800 }];
      if (startDate === '2026-09-19') return [{ date:'2026-09-19', impression:80, clicks:8, expense:80, direct_order:1, direct_gmv:300 }];
      return [
        { date:'2026-09-19', impression:80, clicks:8, expense:80, direct_order:1, direct_gmv:300 },
        { date:'2026-09-20', impression:100, clicks:10, expense:100, direct_order:2, direct_gmv:800 },
      ];
    },
    async loadItemDaily() { return [{ date:'2026-09-20', item_id:7, impression:100, clicks:10, expense:100, direct_order:2, direct_gmv:800 }]; },
  };
  const queryRepository = {
    async listShops() { return [{ shopId:1, countryCode:'ID', brandCode:'REDRAGON', timezone:'Asia/Jakarta', currency:'IDR' }]; },
    async getLatestCampaignSetting() { return { targetRoas:7, campaignBudget:300000 }; },
    async getCampaignItemNames() { return new Map([['7', { itemName:'Mouse', itemSku:'M-7' }]]); },
    async getLatestRecommendedRoiMap() { return new Map([['7', { exact:{ value:6.5, percentile:50 } }], ['77', { exact:{ value:7.2, percentile:50 } }]]); },
    async resolveAdGroupOperationCampaign({ groupStartDate, itemCount }) {
      assert.strictEqual(groupStartDate, '2026-09-18');
      assert.strictEqual(itemCount, 1);
      return { campaignId:555, match:'START_DATE_ITEM_COUNT', candidates:[{ campaignId:555, itemCount:1 }] };
    },
    async loadCampaignOperations({ campaignId }) {
      if (Number(campaignId) === 9) return [{ operationType:'SHOPEE_OPERATION_EVENT', actorType:'UNKNOWN', effectiveFrom:'2026-09-19T00:00:00+07:00' }];
      return [
        { operationType:'CAMPAIGN_CREATED', actorType:'SELLER', effectiveDate:'2026-09-18', effectiveTime:'09:00:00', effectiveFrom:'2026-09-18T09:00:00+07:00', after:{ targetRoas:8, campaignBudget:500000, startTime:'2026-09-18', itemCount:1 } },
        { operationType:'CAMPAIGN_SETTING_CHANGE', actorType:'SELLER', effectiveDate:'2026-09-20', effectiveTime:'10:00:00', effectiveFrom:'2026-09-20T10:00:00+07:00', before:{ targetRoas:8 }, after:{ targetRoas:7.5 } },
      ];
    },
  };
  const strategyRepository = {
    async getShopStrategy() { return { adSpendRatioLimit:0.15, weeklyOrderReference:25 }; },
    async getItemBreakEvenMap({ itemIds }) { return new Map(itemIds.map(id => [String(id), id === 7 ? 3.5 : 4.2])); },
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
  assert.strictEqual(pkg.items[0].breakEvenRoas, 3.5);
  assert.strictEqual(pkg.items[0].recommendedRoas.exact.value, 6.5);
  assert.strictEqual(pkg.deterministicMetrics.campaign.directOrders7d, 3);
  assert.strictEqual(pkg.comparisonPeriod.startDate, '2026-09-19');
  assert.strictEqual(pkg.deterministicMetrics.campaign.previousWindow.directOrders, 1);

  const adPromotionRepository = {
    async list({ startDate }) {
      const row = previous => ({
        promotion_key: 'MANUAL_IMPORT:group:test', granularity: 'DAY',
        period_start: previous ? '2026-09-19' : '2026-09-20', period_end: previous ? '2026-09-19' : '2026-09-20',
        event_date: previous ? '2026-09-19' : '2026-09-20', campaign_name: 'Keyboard Group', campaign_budget: 500000,
        groupStartDate:'2026/09/18', item_count:1,
        impressions: previous ? 800 : 1000, clicks: previous ? 40 : 50, expense: previous ? 80000 : 100000,
        orders: previous ? 3 : 5, gmv: previous ? 500000 : 800000,
        direct_gmv: previous ? 350000 : 700000, source_roas: previous ? 6.25 : 8, direct_roas: previous ? 4.375 : 7,
        directConversions: previous ? 2 : 4, itemsSold: previous ? 4 : 6, directItemsSold: previous ? 3 : 5,
        items: previous ? [] : [{ itemId: 77, itemSku: 'K-77', productName: 'Keyboard', impressions: 600, clicks: 30, expense: 60000, orders: 4, gmv: 500000, directGmv: 450000, directConversions: 3, directItemsSold: 4 }],
        quality_flags: [],
      });
      if (startDate === '2026-09-20') return [row(false)];
      if (startDate === '2026-09-19') return [row(true)];
      return [row(true), row(false)];
    },
  };
  const groupPkg = await buildAdGroupSkillPackage({
    adPromotionRepository, queryRepository, strategyRepository,
    shopId: 1, promotionKey: 'MANUAL_IMPORT:group:test', startDate: '2026-09-20', endDate: '2026-09-20',
    dataCutoff: '2026-09-20T23:59:59+07:00', triggerType: 'MANUAL',
  });
  assert.strictEqual(groupPkg.campaign.promotionType, 'AD_GROUP');
  assert.strictEqual(groupPkg.campaign.campaignName, 'Keyboard Group');
  assert.strictEqual(groupPkg.campaign.sourceCampaignId, 555);
  assert.strictEqual(groupPkg.campaign.targetRoas, 7.5);
  assert.strictEqual(groupPkg.dataQuality.source, 'SHOPEE_AD_GROUP_MANUAL_IMPORT');
  assert.strictEqual(groupPkg.dataQuality.operationHistoryLink, 'START_DATE_ITEM_COUNT');
  assert.strictEqual(groupPkg.dataQuality.operationHistoryRows, 2);
  assert.strictEqual(groupPkg.deterministicMetrics.learningTimeline.latestConfirmedReset.eventType, 'TARGET_ROAS_CHANGE');
  assert.strictEqual(groupPkg.deterministicMetrics.campaign.directOrders7d, 6);
  assert.strictEqual(groupPkg.deterministicMetrics.campaign.previousWindow.directOrders, 2);
  assert.strictEqual(groupPkg.items[0].itemName, 'Keyboard');
  assert.strictEqual(groupPkg.items[0].directOrders, 3);
  assert.strictEqual(groupPkg.items[0].breakEvenRoas, 4.2);
  assert.strictEqual(groupPkg.items[0].recommendedRoas.exact.value, 7.2);
  console.log('shopee skill analysis service tests: ok');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
