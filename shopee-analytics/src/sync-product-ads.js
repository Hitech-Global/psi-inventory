'use strict';

const { ENDPOINTS } = require('./catalog');
const { normalizePerformance } = require('./metrics');

function toShopeeAdsDate(value) {
  const raw = String(value || '');
  if (/^\d{2}-\d{2}-\d{4}$/.test(raw)) return raw;
  const d = value instanceof Date ? value : new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid date: ${value}`);
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}-${mm}-${d.getUTCFullYear()}`;
}

function toIsoDate(value) {
  const raw = String(value || '');
  const match = raw.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (match) return `${match[3]}-${match[2]}-${match[1]}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  throw new Error(`Invalid Shopee Ads date: ${value}`);
}

function normalizeProductAdType(value) {
  const type = String(value || '').trim().toLowerCase();
  if (type !== 'manual' && type !== 'auto') {
    throw new Error('Product Ads ad_type must be manual or auto');
  }
  return type;
}

function campaignFamilyForAdType(adType) {
  return normalizeProductAdType(adType) === 'manual'
    ? 'MANUAL_PRODUCT_AD'
    : 'AUTO_PRODUCT_AD';
}

function unwrapResponseList(payload) {
  if (!payload) return [];
  if (Array.isArray(payload.response)) return payload.response;
  if (payload.response && typeof payload.response === 'object') return [payload.response];
  return [];
}

function normalizeProductCampaignDailyPayload(payload) {
  const rows = [];
  for (const response of unwrapResponseList(payload)) {
    for (const campaign of Array.isArray(response.campaign_list) ? response.campaign_list : []) {
      const campaignId = Number(campaign.campaign_id);
      if (!Number.isSafeInteger(campaignId) || campaignId <= 0) continue;
      const adType = normalizeProductAdType(campaign.ad_type);
      for (const metric of Array.isArray(campaign.metrics_list) ? campaign.metrics_list : []) {
        rows.push({
          campaignId,
          adType,
          campaignFamily: campaignFamilyForAdType(adType),
          adName: campaign.ad_name || null,
          campaignPlacement: campaign.campaign_placement || null,
          eventDate: toIsoDate(metric.date),
          performance: normalizePerformance(metric),
          raw: { campaign, metric },
        });
      }
    }
  }
  return rows;
}

async function fetchProductCampaignDailyPerformance({
  client,
  shopId,
  accessToken,
  campaignIds,
  startDate,
  endDate,
  chunkSize = 100,
}) {
  if (!client || typeof client.shopRequest !== 'function') throw new Error('client.shopRequest is required');
  const ids = Array.from(new Set((campaignIds || []).map(Number).filter(id => Number.isSafeInteger(id) && id > 0)));
  if (!ids.length) return { rows: [], rawPages: [] };
  if (!Number.isSafeInteger(chunkSize) || chunkSize < 1 || chunkSize > 100) {
    throw new Error('chunkSize must be 1..100');
  }

  const rows = [];
  const rawPages = [];
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const query = {
      campaign_id_list: chunk.join(','),
      start_date: toShopeeAdsDate(startDate),
      end_date: toShopeeAdsDate(endDate),
    };
    const payload = await client.shopRequest({
      path: ENDPOINTS.adsDailyPerformance.path,
      shopId,
      accessToken,
      method: ENDPOINTS.adsDailyPerformance.method,
      query,
    });
    rawPages.push({ query, payload });
    rows.push(...normalizeProductCampaignDailyPayload(payload));
  }
  return { rows, rawPages };
}

module.exports = {
  toShopeeAdsDate,
  toIsoDate,
  normalizeProductAdType,
  campaignFamilyForAdType,
  normalizeProductCampaignDailyPayload,
  fetchProductCampaignDailyPerformance,
};
