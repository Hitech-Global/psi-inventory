'use strict';

const crypto = require('crypto');
const { ENDPOINTS } = require('./catalog');
const { normalizePerformance } = require('./metrics');

function toShopeeDate(input) {
  const d = input instanceof Date ? input : new Date(`${input}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid date: ${input}`);
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}-${mm}-${d.getUTCFullYear()}`;
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

function fingerprint(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function resolveGmsMinRequestIntervalMs(env = process.env) {
  const raw = env.SHOPEE_ADS_MIN_REQUEST_INTERVAL_MS;
  if (raw === undefined || raw === '') return 1500;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0 || value > 60_000) {
    throw new Error('SHOPEE_ADS_MIN_REQUEST_INTERVAL_MS must be an integer from 0 to 60000');
  }
  return value;
}

function createGmsRequestPacer({ minIntervalMs = resolveGmsMinRequestIntervalMs(), now = () => Date.now(), sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), audit = [] } = {}) {
  let lastStartedAt = null;
  let sequence = 0;
  return {
    audit,
    async beforeRequest(metadata) {
      const observedAt = now();
      const waitMs = lastStartedAt === null ? 0 : Math.max(0, minIntervalMs - (observedAt - lastStartedAt));
      if (waitMs) await sleep(waitMs);
      const startedAt = now();
      sequence += 1;
      audit.push({
        endpointKey: metadata.endpointKey,
        sequence,
        shopId: Number(metadata.shopId),
        campaignId: Number(metadata.campaignId),
        eventDate: String(metadata.eventDate),
        offset: metadata.offset ?? null,
        waitMs,
        relativeMs: lastStartedAt === null ? 0 : startedAt - lastStartedAt,
      });
      lastStartedAt = startedAt;
    },
  };
}

async function fetchAllGmsItemPerformanceWithRaw({ client, shopId, accessToken, campaignId, date, limit = 50, requestPacer = null }) {
  const endpoint = ENDPOINTS.adsGmsItemPerformance;
  const shopeeDate = toShopeeDate(date);
  const all = [];
  const rawPages = [];
  let offset = 0;

  for (;;) {
    const requestBody = {
      campaign_id: campaignId,
      start_date: shopeeDate,
      end_date: shopeeDate,
      offset,
      limit,
    };
    if (requestPacer) await requestPacer.beforeRequest({ endpointKey: 'adsGmsItemPerformance', shopId, campaignId, eventDate: date, offset });
    const payload = await client.shopRequest({
      path: endpoint.path,
      shopId,
      accessToken,
      method: endpoint.method,
      body: requestBody,
    });
    rawPages.push({ requestBody, payload });
    const response = unwrapResponse(payload);
    const rows = extractItemRows(payload);
    all.push(...rows.map(normalizeItemRow));

    if (rows.length === 0) break;
    if (response.has_next_page === false) break;
    if (response.has_next_page !== true && rows.length < limit) break;
    offset += rows.length;
  }
  return { rows: all, rawPages };
}

async function fetchAllGmsItemPerformance(args) {
  return (await fetchAllGmsItemPerformanceWithRaw(args)).rows;
}

async function fetchGmsCampaignPerformanceWithRaw({ client, shopId, accessToken, campaignId, date, requestPacer = null }) {
  const endpoint = ENDPOINTS.adsGmsCampaignPerformance;
  const shopeeDate = toShopeeDate(date);
  const requestBody = {
    campaign_id: campaignId,
    start_date: shopeeDate,
    end_date: shopeeDate,
  };
  if (requestPacer) await requestPacer.beforeRequest({ endpointKey: 'adsGmsCampaignPerformance', shopId, campaignId, eventDate: date, offset: null });
  const payload = await client.shopRequest({
    path: endpoint.path,
    shopId,
    accessToken,
    method: endpoint.method,
    body: requestBody,
  });
  return {
    performance: extractCampaignPerformance(payload),
    requestBody,
    payload,
  };
}

async function fetchGmsCampaignPerformance(args) {
  return (await fetchGmsCampaignPerformanceWithRaw(args)).performance;
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

async function syncGmsDay({ client, shopId, accessToken, campaignId, date, membershipItemIds = [], requestPacer = null }) {
  const campaignResult = await fetchGmsCampaignPerformanceWithRaw({ client, shopId, accessToken, campaignId, date, requestPacer });
  const itemResult = await fetchAllGmsItemPerformanceWithRaw({ client, shopId, accessToken, campaignId, date, requestPacer });

  const eventDate = String(date).slice(0, 10);
  const rawSnapshots = [
    {
      appRole: 'ADS',
      endpointKey: 'adsGmsCampaignPerformance',
      eventDateFrom: eventDate,
      eventDateTo: eventDate,
      requestFingerprint: fingerprint(campaignResult.requestBody),
      requestJson: campaignResult.requestBody,
      responseJson: campaignResult.payload,
    },
    ...itemResult.rawPages.map(page => ({
      appRole: 'ADS',
      endpointKey: 'adsGmsItemPerformance',
      eventDateFrom: eventDate,
      eventDateTo: eventDate,
      requestFingerprint: fingerprint(page.requestBody),
      requestJson: page.requestBody,
      responseJson: page.payload,
    })),
  ];

  return {
    eventDate,
    campaign: campaignResult.performance,
    items: membershipItemIds.length
      ? leftJoinMembershipPerformance(membershipItemIds, itemResult.rows)
      : itemResult.rows,
    rawSnapshots,
  };
}

module.exports = {
  toShopeeDate,
  unwrapResponse,
  extractCampaignPerformance,
  extractItemRows,
  normalizeItemRow,
  fingerprint,
  resolveGmsMinRequestIntervalMs,
  createGmsRequestPacer,
  leftJoinMembershipPerformance,
  fetchAllGmsItemPerformance,
  fetchAllGmsItemPerformanceWithRaw,
  fetchGmsCampaignPerformance,
  fetchGmsCampaignPerformanceWithRaw,
  syncGmsDay,
};
