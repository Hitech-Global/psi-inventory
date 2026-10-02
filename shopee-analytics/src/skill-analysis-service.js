'use strict';

const { buildAnalysisPackage } = require('./analysis-package');

function addIsoDays(value, days) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function daysInclusive(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  return Math.max(1, Math.round((end - start) / 86400000) + 1);
}

function priorComparisonPeriod(startDate, endDate) {
  const days = daysInclusive(startDate, endDate);
  const priorEnd = addIsoDays(startDate, -1);
  return { startDate: addIsoDays(priorEnd, -days + 1), endDate: priorEnd, days };
}

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
  const comparisonPeriod = priorComparisonPeriod(startDate, endDate);
  const historyStartDate = [comparisonPeriod.startDate, addIsoDays(endDate, -41)].sort()[0];
  const [shops, campaignDaily, comparisonCampaignDaily, historyCampaignDaily, itemDaily, comparisonItemDaily, latest, operations] = await Promise.all([
    queryRepository.listShops({ activeOnly: false }),
    repository.loadCampaignDaily({ shopId, campaignId, startDate, endDate }),
    repository.loadCampaignDaily({
      shopId,
      campaignId,
      startDate: comparisonPeriod.startDate,
      endDate: comparisonPeriod.endDate,
    }),
    repository.loadCampaignDaily({ shopId, campaignId, startDate: historyStartDate, endDate }),
    repository.loadItemDaily({ shopId, campaignId, startDate, endDate }),
    repository.loadItemDaily({
      shopId,
      campaignId,
      startDate: comparisonPeriod.startDate,
      endDate: comparisonPeriod.endDate,
    }),
    queryRepository.getLatestCampaignSetting({ shopId, campaignId }),
    typeof queryRepository.loadCampaignOperations === 'function'
      ? queryRepository.loadCampaignOperations({ shopId, campaignId, startDate: historyStartDate, endDate })
      : Promise.resolve([]),
  ]);
  const shop = shops.find(row => Number(row.shopId) === Number(shopId));
  if (!shop) throw new Error(`Shop ${shopId} is not configured`);

  const itemIds = Array.from(new Set(itemDaily.map(row => Number(row.itemId ?? row.item_id)).filter(Number.isSafeInteger)));
  const [itemMetadata, strategy, itemBreakEvenMap, recommendedRoiMap] = await Promise.all([
    typeof queryRepository.getCampaignItemNames === 'function'
      ? queryRepository.getCampaignItemNames({ shopId, itemIds })
      : Promise.resolve(new Map()),
    strategyRepository && typeof strategyRepository.getShopStrategy === 'function'
      ? strategyRepository.getShopStrategy(shopId)
      : Promise.resolve({}),
    strategyRepository && typeof strategyRepository.getItemBreakEvenMap === 'function'
      ? strategyRepository.getItemBreakEvenMap({ shopId, itemIds })
      : Promise.resolve(new Map()),
    typeof queryRepository.getLatestRecommendedRoiMap === 'function'
      ? queryRepository.getLatestRecommendedRoiMap({ shopId, itemIds })
      : Promise.resolve(new Map()),
  ]);

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
      targetRoas: latest && Number(latest.targetRoas) > 0 ? Number(latest.targetRoas) : null,
      budget: latest && latest.campaignBudget != null ? Number(latest.campaignBudget) : null,
      breakEvenRoas: itemIds.length === 1 && Number(itemBreakEvenMap.get(String(itemIds[0]))) > 0
        ? Number(itemBreakEvenMap.get(String(itemIds[0])))
        : null,
      adSpendRatioLimit: strategy.adSpendRatioLimit == null ? null : Number(strategy.adSpendRatioLimit),
    },
    campaignDaily,
    comparisonCampaignDaily,
    historyCampaignDaily,
    comparisonPeriod,
    itemDaily,
    comparisonItemDaily,
    itemMetadata,
    itemBreakEvenMap,
    recommendedRoiMap,
    weeklyOrderReference: strategy.weeklyOrderReference == null ? 25 : Number(strategy.weeklyOrderReference),
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

function sourceDateToIso(value) {
  const text = String(value || '').trim();
  const ymd = text.match(/^(\d{4})[\/-](\d{2})[\/-](\d{2})/);
  if (ymd) return `${ymd[1]}-${ymd[2]}-${ymd[3]}`;
  const dmy = text.match(/^(\d{2})[\/-](\d{2})[\/-](\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  return '';
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
  const comparisonPeriod = priorComparisonPeriod(startDate, endDate);
  const historyStartDate = [comparisonPeriod.startDate, addIsoDays(endDate, -41)].sort()[0];
  const [shops, rows, comparisonRows, historyRows] = await Promise.all([
    queryRepository.listShops({ activeOnly: false }),
    adPromotionRepository.list({ shopId, startDate, endDate, promotionType: 'AD_GROUP', dataSource: 'MANUAL_IMPORT' }),
    adPromotionRepository.list({
      shopId,
      startDate: comparisonPeriod.startDate,
      endDate: comparisonPeriod.endDate,
      promotionType: 'AD_GROUP',
      dataSource: 'MANUAL_IMPORT',
    }),
    adPromotionRepository.list({
      shopId,
      startDate: historyStartDate,
      endDate,
      promotionType: 'AD_GROUP',
      dataSource: 'MANUAL_IMPORT',
    }),
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
  const comparisonMatches = comparisonRows.filter(row => String(row.promotion_key || row.promotionKey) === String(promotionKey));
  const comparisonDailyRows = comparisonMatches.filter(row => {
    const s = isoDay(row.period_start ?? row.periodStart);
    const e = isoDay(row.period_end ?? row.periodEnd);
    return row.granularity === 'DAY' || (s && s === e);
  });
  const comparisonExactRange = comparisonMatches.find(row =>
    isoDay(row.period_start ?? row.periodStart) === comparisonPeriod.startDate &&
    isoDay(row.period_end ?? row.periodEnd) === comparisonPeriod.endDate);
  const comparisonSelectedRows = comparisonDailyRows.length
    ? comparisonDailyRows
    : (comparisonExactRange ? [comparisonExactRange] : []);
  const historyMatches = historyRows.filter(row => String(row.promotion_key || row.promotionKey) === String(promotionKey));
  const historyDailyRows = historyMatches.filter(row => {
    const s = isoDay(row.period_start ?? row.periodStart);
    const e = isoDay(row.period_end ?? row.periodEnd);
    return row.granularity === 'DAY' || (s && s === e);
  });
  const representative = selectedRows[selectedRows.length - 1];
  const campaignDaily = selectedRows.map(row => adGroupPerformance(row));
  const comparisonCampaignDaily = comparisonSelectedRows.map(row => adGroupPerformance(row));
  const historyCampaignDaily = historyDailyRows.map(row => adGroupPerformance(row));
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
  const comparisonItemDaily = [];
  for (const row of comparisonSelectedRows) {
    const date = isoDay(row.event_date ?? row.period_start ?? row.periodStart);
    for (const item of row.items || []) {
      const id = String(item.itemId ?? item.item_id ?? '');
      if (!id) continue;
      if (!itemMetadata.has(id)) {
        itemMetadata.set(id, { itemName: item.productName || null, itemSku: item.itemSku || null });
      }
      comparisonItemDaily.push({ item_id: id, ...adGroupPerformance(item, date) });
    }
  }

  const itemIds = Array.from(new Set(itemDaily.map(row => Number(row.item_id)).filter(Number.isSafeInteger)));
  const groupStartDate = sourceDateToIso(representative.groupStartDate || representative.raw_json?.parent?.['Start Date'] || representative.rawJson?.parent?.['Start Date']);
  const operationLink = typeof queryRepository.resolveAdGroupOperationCampaign === 'function'
    ? await queryRepository.resolveAdGroupOperationCampaign({
        shopId,
        groupStartDate,
        itemCount: representative.item_count ?? representative.itemCount ?? itemIds.length,
      })
    : { campaignId: null, match: 'UNAVAILABLE', candidates: [] };
  const operations = operationLink.campaignId && typeof queryRepository.loadCampaignOperations === 'function'
    ? await queryRepository.loadCampaignOperations({
        shopId,
        campaignId: operationLink.campaignId,
        startDate: groupStartDate || comparisonPeriod.startDate,
        endDate,
      })
    : [];
  const latestOperationSetting = operations.reduce((state, row) => ({ ...state, ...(row.after || {}) }), {});
  const [strategy, itemBreakEvenMap, recommendedRoiMap] = await Promise.all([
    strategyRepository && typeof strategyRepository.getShopStrategy === 'function'
      ? strategyRepository.getShopStrategy(shopId)
      : Promise.resolve({}),
    strategyRepository && typeof strategyRepository.getItemBreakEvenMap === 'function'
      ? strategyRepository.getItemBreakEvenMap({ shopId, itemIds })
      : Promise.resolve(new Map()),
    typeof queryRepository.getLatestRecommendedRoiMap === 'function'
      ? queryRepository.getLatestRecommendedRoiMap({ shopId, itemIds })
      : Promise.resolve(new Map()),
  ]);
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
      sourceCampaignId: operationLink.campaignId || null,
      promotionKey,
      campaignName: representative.campaign_name || representative.campaignName || null,
      promotionType: 'AD_GROUP',
      targetRoas: Number(latestOperationSetting.targetRoas) > 0
        ? Number(latestOperationSetting.targetRoas)
        : (Number(representative.target_roas) > 0 ? Number(representative.target_roas) : null),
      budget: latestOperationSetting.campaignBudget == null
        ? (representative.campaign_budget == null ? null : Number(representative.campaign_budget))
        : Number(latestOperationSetting.campaignBudget),
      breakEvenRoas: itemIds.length === 1 && Number(itemBreakEvenMap.get(String(itemIds[0]))) > 0
        ? Number(itemBreakEvenMap.get(String(itemIds[0])))
        : null,
      adSpendRatioLimit: strategy.adSpendRatioLimit == null ? null : Number(strategy.adSpendRatioLimit),
    },
    campaignDaily,
    comparisonCampaignDaily,
    historyCampaignDaily,
    comparisonPeriod,
    itemDaily,
    comparisonItemDaily,
    itemMetadata,
    itemBreakEvenMap,
    recommendedRoiMap,
    weeklyOrderReference: strategy.weeklyOrderReference == null ? 25 : Number(strategy.weeklyOrderReference),
    operations,
    startDate,
    endDate,
    dataCutoff,
    triggerType,
    triggerReason,
    dataQuality: {
      source: 'SHOPEE_AD_GROUP_MANUAL_IMPORT',
      granularity: daily.length ? 'DAILY' : 'RANGE',
      sourceRows: selectedRows.length,
      operationHistoryLink: operationLink.match,
      operationCampaignId: operationLink.campaignId || null,
      operationHistoryRows: operations.length,
      qualityFlags: flags,
      note: daily.length
        ? 'Ad Group skill input uses Seller Centre daily group and item rows for the selected period.'
        : 'Only an aggregate Ad Group range row is available; multi-day stability evidence is limited.',
    },
  });
}

module.exports = { buildCampaignSkillPackage, buildAdGroupSkillPackage, adGroupPerformance };
