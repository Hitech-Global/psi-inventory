'use strict';

const { sumPerformance } = require('./metrics');
const { diagnoseCampaign, splitEventBaseline } = require('./diagnosis');

function groupRowsByItem(rows) {
  const grouped = new Map();
  for (const row of rows || []) {
    const key = String(row.item_id ?? row.itemId);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }
  return grouped;
}

function aggregateItemRows(rows) {
  const itemId = rows[0] && (rows[0].item_id ?? rows[0].itemId);
  return { item_id: itemId, ...sumPerformance(rows) };
}

async function enrichStrategy({ strategyRepository, shopId, items }) {
  if (!strategyRepository) return { items, settings: {} };
  const shopStrategy = await strategyRepository.getShopStrategy(shopId);
  const itemIds = items.map(item => Number(item.item_id)).filter(Number.isSafeInteger);
  const breakEvenMap = await strategyRepository.getItemBreakEvenMap({ shopId, itemIds });
  return {
    items: items.map(item => ({
      ...item,
      breakEvenRoas: breakEvenMap.get(String(item.item_id)) || 0,
    })),
    settings: {
      adSpendRatioLimit: shopStrategy.adSpendRatioLimit,
      weeklyVolumeReference: shopStrategy.weeklyOrderReference,
    },
  };
}

async function analyzeCampaignWindow({
  repository,
  strategyRepository,
  shopId,
  campaignId,
  startDate,
  endDate,
  targetRoas,
  breakEvenRoas,
  recommendedRoi,
  campaignBudget,
  eventDateSet = new Set(),
}) {
  const [campaignRows, itemRows, operations] = await Promise.all([
    repository.loadCampaignDaily({ shopId, campaignId, startDate, endDate }),
    repository.loadItemDaily({ shopId, campaignId, startDate, endDate }),
    typeof repository.loadCampaignOperations === 'function'
      ? repository.loadCampaignOperations({
          shopId,
          campaignId,
          startDate: (() => {
            const d = new Date(`${startDate}T00:00:00Z`);
            d.setUTCDate(d.getUTCDate() - 3);
            return d.toISOString().slice(0, 10);
          })(),
          endDate,
        })
      : Promise.resolve([]),
  ]);

  const campaign = sumPerformance(campaignRows);
  const itemGroups = groupRowsByItem(itemRows);
  const aggregatedItems = Array.from(itemGroups.values()).map(aggregateItemRows);
  const enriched = await enrichStrategy({ strategyRepository, shopId, items: aggregatedItems });
  const days = Math.max(1, campaignRows.length);

  const diagnosis = diagnoseCampaign({
    campaign,
    items: enriched.items,
    targetRoas,
    breakEvenRoas,
    recommendedRoi,
    campaignBudget,
    days,
    settings: enriched.settings,
    dailyRows: campaignRows,
    itemDailyRows: itemRows,
    operations,
    asOfDate: endDate,
  });

  const { eventRows, ordinaryRows } = splitEventBaseline(campaignRows, eventDateSet);
  return {
    shopId,
    campaignId,
    startDate,
    endDate,
    diagnosis,
    baseline: {
      ordinary: sumPerformance(ordinaryRows),
      event: sumPerformance(eventRows),
      ordinaryDays: ordinaryRows.length,
      eventDays: eventRows.length,
    },
  };
}

module.exports = {
  groupRowsByItem,
  aggregateItemRows,
  enrichStrategy,
  analyzeCampaignWindow,
};
