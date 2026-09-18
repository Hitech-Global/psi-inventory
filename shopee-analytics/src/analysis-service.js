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

async function analyzeCampaignWindow({
  repository,
  shopId,
  campaignId,
  startDate,
  endDate,
  targetRoas,
  breakEvenRoas,
  eventDateSet = new Set(),
}) {
  const [campaignRows, itemRows] = await Promise.all([
    repository.loadCampaignDaily({ shopId, campaignId, startDate, endDate }),
    repository.loadItemDaily({ shopId, campaignId, startDate, endDate }),
  ]);

  const campaign = sumPerformance(campaignRows);
  const itemGroups = groupRowsByItem(itemRows);
  const items = Array.from(itemGroups.values()).map(aggregateItemRows);
  const days = Math.max(1, campaignRows.length);

  const diagnosis = diagnoseCampaign({
    campaign,
    items,
    targetRoas,
    breakEvenRoas,
    days,
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

module.exports = { groupRowsByItem, aggregateItemRows, analyzeCampaignWindow };
