'use strict';

const { buildAnalysisPackage } = require('./analysis-package');

async function buildCampaignSkillPackage({
  repository,
  queryRepository,
  strategyRepository,
  shopId,
  campaignId,
  startDate,
  endDate,
  dataCutoff,
  triggerType,
  triggerReason = null,
}) {
  const [shops, campaignDaily, itemDaily, latest, operations] = await Promise.all([
    queryRepository.listShops({ activeOnly: false }),
    repository.loadCampaignDaily({ shopId, campaignId, startDate, endDate }),
    repository.loadItemDaily({ shopId, campaignId, startDate, endDate }),
    queryRepository.getLatestCampaignSetting({ shopId, campaignId }),
    typeof repository.loadCampaignOperations === 'function'
      ? repository.loadCampaignOperations({ shopId, campaignId, startDate, endDate })
      : Promise.resolve([]),
  ]);
  const shop = shops.find(row => Number(row.shopId) === Number(shopId));
  if (!shop) throw new Error(`Shop ${shopId} is not configured`);

  const itemIds = Array.from(new Set(itemDaily.map(row => Number(row.itemId ?? row.item_id)).filter(Number.isSafeInteger)));
  const itemMetadata = typeof queryRepository.getCampaignItemNames === 'function'
    ? await queryRepository.getCampaignItemNames({ shopId, itemIds })
    : new Map();

  let strategy = {};
  if (strategyRepository) strategy = await strategyRepository.getShopStrategy(shopId);

  return buildAnalysisPackage({
    shop: {
      shopId,
      country: shop.countryCode,
      brand: shop.brandCode,
      timezone: shop.timezone,
      currency: shop.currency,
    },
    campaign: {
      campaignId,
      targetRoas: Number(latest && latest.targetRoas || 0),
      budget: Number(latest && latest.campaignBudget || 0),
      adSpendRatioLimit: strategy.adSpendRatioLimit == null ? null : Number(strategy.adSpendRatioLimit),
    },
    campaignDaily,
    itemDaily,
    itemMetadata,
    operations,
    startDate,
    endDate,
    dataCutoff,
    triggerType,
    triggerReason,
    dataQuality: {
      source: 'NORMALIZED_SHOPEE_ANALYTICS',
      note: 'Business interpretation is intentionally excluded from the analysis package.',
    },
  });
}

module.exports = { buildCampaignSkillPackage };
