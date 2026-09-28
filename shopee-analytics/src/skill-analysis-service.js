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

function isoDay(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const match = String(value || '').match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : '';
}

function adGroupPerformance(row = {}, date = null) {
  return {
    eventDate: date || isoDay(row.event_date ?? row.period_start ?? row.periodStart),
    impressions: row.impressions,
    clicks: row.clicks,
    expense: row.expense,
    broad_gmv: row.gmv,
    broad_order: row.orders,
    broad_order_amount: row.itemsSold ?? row.items_sold ?? 0,
    direct_gmv: row.direct_gmv ?? row.directGmv,
    direct_order: row.directConversions ?? row.direct_conversions ?? 0,
    direct_order_amount: row.directItemsSold ?? row.direct_items_sold ?? 0,
    add_to_cart: row.add_to_cart ?? row.addToCart,
    ctr: row.ctr,
    broad_cvr: row.cvr,
    direct_cvr: row.directCvr ?? row.direct_cvr,
    broad_roas: row.source_roas ?? row.sourceRoas,
    direct_roas: row.direct_roas ?? row.directRoas,
    cost_per_conversion: row.costPerConversion ?? row.cost_per_conversion,
    cost_per_direct_conversion: row.costPerDirectConversion ?? row.cost_per_direct_conversion,
    broad_acos: row.acos ?? row.broadAcos,
    direct_acos: row.directAcos ?? row.direct_acos,
  };
}

async function buildAdGroupSkillPackage({
  adPromotionRepository,
  queryRepository,
  strategyRepository,
  shopId,
  promotionKey,
  startDate,
  endDate,
  dataCutoff,
  triggerType,
  triggerReason = null,
}) {
  const [shops, rows] = await Promise.all([
    queryRepository.listShops({ activeOnly: false }),
    adPromotionRepository.list({ shopId, startDate, endDate, promotionType: 'AD_GROUP', dataSource: 'MANUAL_IMPORT' }),
  ]);
  const shop = shops.find(row => Number(row.shopId) === Number(shopId));
  if (!shop) throw new Error(`Shop ${shopId} is not configured`);
  const matches = rows.filter(row => String(row.promotion_key || row.promotionKey) === String(promotionKey));
  if (!matches.length) throw new Error('Selected ad group has no data in this date range');

  const daily = matches.filter(row => {
    const s = isoDay(row.period_start ?? row.periodStart);
    const e = isoDay(row.period_end ?? row.periodEnd);
    return row.granularity === 'DAY' || (s && s === e);
  });
  const exactRange = matches.find(row =>
    isoDay(row.period_start ?? row.periodStart) === startDate && isoDay(row.period_end ?? row.periodEnd) === endDate);
  const selectedRows = daily.length ? daily : [exactRange || matches[0]];
  const representative = selectedRows[selectedRows.length - 1];
  const campaignDaily = selectedRows.map(row => adGroupPerformance(row));
  const itemMetadata = new Map();
  const itemDaily = [];
  for (const row of selectedRows) {
    const date = isoDay(row.event_date ?? row.period_start ?? row.periodStart);
    for (const item of row.items || []) {
      const id = String(item.itemId ?? item.item_id ?? '');
      if (!id) continue;
      itemMetadata.set(id, { itemName: item.productName || null, itemSku: item.itemSku || null });
      itemDaily.push({ item_id: id, ...adGroupPerformance(item, date) });
    }
  }

  let strategy = {};
  if (strategyRepository) strategy = await strategyRepository.getShopStrategy(shopId);
  const flags = Array.from(new Set(selectedRows.flatMap(row => Array.isArray(row.quality_flags) ? row.quality_flags : [])));
  return buildAnalysisPackage({
    shop: {
      shopId,
      country: shop.countryCode,
      brand: shop.brandCode,
      timezone: shop.timezone,
      currency: shop.currency,
    },
    campaign: {
      campaignId: `AD_GROUP:${promotionKey}`,
      promotionKey,
      campaignName: representative.campaign_name || representative.campaignName || null,
      promotionType: 'AD_GROUP',
      targetRoas: representative.target_roas == null ? null : Number(representative.target_roas),
      budget: representative.campaign_budget == null ? null : Number(representative.campaign_budget),
      adSpendRatioLimit: strategy.adSpendRatioLimit == null ? null : Number(strategy.adSpendRatioLimit),
    },
    campaignDaily,
    itemDaily,
    itemMetadata,
    operations: [],
    startDate,
    endDate,
    dataCutoff,
    triggerType,
    triggerReason,
    dataQuality: {
      source: 'SHOPEE_AD_GROUP_MANUAL_IMPORT',
      granularity: daily.length ? 'DAILY' : 'RANGE',
      sourceRows: selectedRows.length,
      qualityFlags: flags,
      note: daily.length
        ? 'Ad Group skill input uses Seller Centre daily group and item rows for the selected period.'
        : 'Only an aggregate Ad Group range row is available; multi-day stability evidence is limited.',
    },
  });
}

module.exports = { buildCampaignSkillPackage, buildAdGroupSkillPackage, adGroupPerformance };
