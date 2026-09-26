'use strict';

const { ENDPOINTS } = require('./catalog');

function unwrap(payload) {
  return payload && payload.response ? payload.response : payload || {};
}

function normalizeCampaignIdRow(row) {
  return {
    campaignId: row.campaign_id,
    adType: row.ad_type || null,
    raw: row,
  };
}

function membershipFromSetting(setting) {
  const common = setting.common_info || {};
  const autoProducts = Array.isArray(setting.auto_product_ads_info) ? setting.auto_product_ads_info : [];
  const ids = new Set();
  for (const id of common.item_id_list || []) ids.add(Number(id));
  for (const row of autoProducts) {
    if (row && row.item_id !== undefined && row.item_id !== null) ids.add(Number(row.item_id));
  }
  return Array.from(ids).filter(Number.isSafeInteger);
}

function normalizeCampaignSetting(row) {
  const common = row.common_info || {};
  const auto = row.auto_bidding_info || {};
  return {
    campaignId: row.campaign_id,
    adType: common.ad_type || null,
    adName: common.ad_name || null,
    campaignStatus: common.campaign_status || null,
    biddingMethod: common.bidding_method || null,
    campaignPlacement: common.campaign_placement || null,
    campaignBudget: common.campaign_budget ?? null,
    targetRoas: auto.roas_target ?? null,
    itemIds: membershipFromSetting(row),
    raw: row,
  };
}

async function fetchCampaignIds({
  client,
  shopId,
  accessToken,
  adType = 'all',
  limit = 5000,
}) {
  const endpoint = ENDPOINTS.adsCampaignIds;
  const rows = [];
  const rawPages = [];
  let offset = 0;

  for (;;) {
    const query = { ad_type: adType, offset, limit };
    const payload = await client.shopRequest({
      path: endpoint.path,
      shopId,
      accessToken,
      method: endpoint.method,
      query,
    });
    rawPages.push({ query, payload });
    const response = unwrap(payload);
    const pageRows = Array.isArray(response.campaign_list) ? response.campaign_list : [];
    rows.push(...pageRows.map(normalizeCampaignIdRow));
    if (response.has_next_page !== true || pageRows.length === 0) break;
    offset += pageRows.length;
  }

  return { rows, rawPages };
}

async function fetchCampaignSettings({
  client,
  shopId,
  accessToken,
  campaignIds,
  infoTypeList = '1,2,3,4',
}) {
  const endpoint = ENDPOINTS.adsCampaignSettings;
  const normalized = [];
  const rawPages = [];
  const ids = (campaignIds || []).map(Number).filter(Number.isSafeInteger);

  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const query = {
      campaign_id_list: chunk.join(','),
      info_type_list: infoTypeList,
    };
    const payload = await client.shopRequest({
      path: endpoint.path,
      shopId,
      accessToken,
      method: endpoint.method,
      query,
    });
    rawPages.push({ query, payload });
    const response = unwrap(payload);
    const rows = Array.isArray(response.campaign_list) ? response.campaign_list : [];
    normalized.push(...rows.map(normalizeCampaignSetting));
  }

  return { rows: normalized, rawPages };
}

module.exports = {
  unwrap,
  normalizeCampaignIdRow,
  membershipFromSetting,
  normalizeCampaignSetting,
  fetchCampaignIds,
  fetchCampaignSettings,
};
