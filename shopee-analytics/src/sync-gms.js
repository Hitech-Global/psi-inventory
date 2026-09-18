'use strict';

const { ENDPOINTS } = require('./catalog');
const { normalizePerformance } = require('./metrics');

function toShopeeDate(input) {
  const d = input instanceof Date ? input : new Date(`${input}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid date: ${input}`);
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${mm}-${dd}-${d.getUTCFullYear()}`;
}

function unwrapResponse(payload) {
  return payload && payload.response ? payload.response : payload || {};
}

function extractCampaignPerformance(payload) {
  const response = unwrapResponse(payload);
  const report = response.report || response.performance || response;
  return {
    campaignId: response.campaign_id ?? report.campaign_id ?? null,
    ...normalizePerformance(report),
    raw: response,
  };
}

function extractItemRows(payload) {
  const response = unwrapResponse(payload);
  const rows = response.result_list || response.item_list || response.list || [];
  return Array.isArray(rows) ? rows : [];
}

function normalizeItemRow(row) {
  const report = row.report || row.performance || row;
  return {
    itemId: row.item_id ?? report.item_id ?? null,
    ...normalizePerformance(report),
    raw: row,
  };
}

async function fetchAllGmsItemPerformance({ client, shopId, accessToken, campaignId, date, limit = 50 }) {
  const endpoint = ENDPOINTS.adsGmsItemPerformance;
  const shopeeDate = toShopeeDate(date);
  const all = [];
  let offset = 0;

  for (;;) {
    const payload = await client.shopRequest({
      path: endpoint.path,
      shopId,
      accessToken,
      method: endpoint.method,
      body: {
        campaign_id: campaignId,
        start_date: shopeeDate,
        end_date: shopeeDate,
        offset,
        limit,
      },
    });
    const response = unwrapResponse(payload);
    const rows = extractItemRows(payload);
    all.push(...rows.map(normalizeItemRow));

    const hasNext = response.has_next_page === true;
    if (!hasNext && rows.length < limit) break;
    if (rows.length === 0) break;
    offset += rows.length;
  }
  return all;
}

async function fetchGmsCampaignPerformance({ client, shopId, accessToken, campaignId, date }) {
  const endpoint = ENDPOINTS.adsGmsCampaignPerformance;
  const shopeeDate = toShopeeDate(date);
  const payload = await client.shopRequest({
    path: endpoint.path,
    shopId,
    accessToken,
    method: endpoint.method,
    body: {
      campaign_id: campaignId,
      start_date: shopeeDate,
      end_date: shopeeDate,
    },
  });
  return extractCampaignPerformance(payload);
}

function leftJoinMembershipPerformance(itemIds, performanceRows) {
  const byId = new Map((performanceRows || []).map(row => [String(row.itemId), row]));
  return (itemIds || []).map(itemId => {
    const found = byId.get(String(itemId));
    if (found) return { ...found, itemId, hasPerformance: true };
    return {
      itemId,
      hasPerformance: false,
      ...normalizePerformance({}),
      raw: null,
    };
  });
}

async function syncGmsDay({ client, shopId, accessToken, campaignId, date, membershipItemIds = [] }) {
  const [campaign, itemPerformance] = await Promise.all([
    fetchGmsCampaignPerformance({ client, shopId, accessToken, campaignId, date }),
    fetchAllGmsItemPerformance({ client, shopId, accessToken, campaignId, date }),
  ]);
  return {
    eventDate: String(date).slice(0, 10),
    campaign,
    items: membershipItemIds.length
      ? leftJoinMembershipPerformance(membershipItemIds, itemPerformance)
      : itemPerformance,
  };
}

module.exports = {
  toShopeeDate,
  extractCampaignPerformance,
  extractItemRows,
  normalizeItemRow,
  leftJoinMembershipPerformance,
  fetchAllGmsItemPerformance,
  fetchGmsCampaignPerformance,
  syncGmsDay,
};
