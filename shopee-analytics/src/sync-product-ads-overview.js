'use strict';

const { ENDPOINTS } = require('./catalog');
const { toShopeeAdsDate, toIsoDate } = require('./sync-product-ads');
const { recordSnapshot } = require('./raw-snapshot');

function optionalNumber(row, names) {
  for (const name of names) {
    if (row && row[name] !== undefined && row[name] !== null && row[name] !== '') {
      const value = Number(row[name]);
      return Number.isFinite(value) ? value : null;
    }
  }
  return null;
}

function countNumber(row, names) {
  return optionalNumber(row, names) ?? 0;
}

function ratioValue(row, names) {
  const value = optionalNumber(row, names);
  if (value === null) return null;
  // Shopee endpoints have historically exposed rate fields in either fraction
  // form (0.028) or percentage-number form (2.8). Normalize for storage while
  // retaining the exact source row in raw_json for reconciliation.
  return value > 1 && value <= 100 ? value / 100 : value;
}

function responseRows(payload) {
  const response = payload && payload.response !== undefined ? payload.response : payload;
  if (Array.isArray(response)) return response;
  if (!response || typeof response !== 'object') return [];
  for (const key of ['performance_list', 'daily_performance', 'daily_performance_list', 'result_list', 'list', 'data_list']) {
    if (Array.isArray(response[key])) return response[key];
  }
  if (Array.isArray(response.data)) return response.data;
  if (response.data && typeof response.data === 'object') return responseRows({ response: response.data });
  return response.date ? [response] : [];
}

function normalizeShopProductAdsRow(row) {
  const rawDate = row.date ?? row.event_date;
  if (!rawDate) throw new Error('Product Ads shop performance row is missing date');
  const eventDate = toIsoDate(String(rawDate));
  const impressions = countNumber(row, ['impression', 'impressions']);
  const clicks = countNumber(row, ['click', 'clicks']);
  const directOrders = countNumber(row, ['direct_order', 'direct_orders', 'direct_conversions_count']);
  const broadOrders = countNumber(row, ['broad_order', 'broad_orders', 'orders', 'conversions']);
  const directGmv = optionalNumber(row, ['direct_gmv']);
  const broadGmv = optionalNumber(row, ['broad_gmv', 'gmv', 'sales']);
  const expense = optionalNumber(row, ['expense', 'spend']);
  const directRoas = optionalNumber(row, ['direct_roas', 'direct_roi']);
  const broadRoas = optionalNumber(row, ['broad_roas', 'broad_roi']);
  const directCvr = ratioValue(row, ['direct_conversions', 'direct_cvr', 'direct_cr']);
  const broadCvr = ratioValue(row, ['broad_conversions', 'broad_cvr', 'cr']);
  const ctr = ratioValue(row, ['ctr']);
  return {
    eventDate,
    impressions,
    clicks,
    ctr: ctr ?? (impressions ? clicks / impressions : 0),
    directOrders,
    broadOrders,
    directUnits: countNumber(row, ['direct_item_sold', 'direct_order_amount', 'direct_units']),
    broadUnits: countNumber(row, ['broad_item_sold', 'broad_order_amount', 'broad_units']),
    directCvr: directCvr ?? (clicks ? directOrders / clicks : 0),
    broadCvr: broadCvr ?? (clicks ? broadOrders / clicks : 0),
    directGmv,
    broadGmv,
    expense,
    cpc: optionalNumber(row, ['cpc']),
    costPerConversion: optionalNumber(row, ['cost_per_conversion']),
    costPerDirectConversion: optionalNumber(row, ['cost_per_direct_conversion', 'cpdc']),
    directRoas: directRoas ?? (expense && directGmv !== null ? directGmv / expense : null),
    broadRoas: broadRoas ?? (expense && broadGmv !== null ? broadGmv / expense : null),
    directAcos: ratioValue(row, ['direct_acos', 'direct_cir']),
    broadAcos: ratioValue(row, ['broad_acos', 'broad_cir']),
    raw: row,
  };
}

function normalizeShopProductAdsPayload(payload) {
  return responseRows(payload).map(normalizeShopProductAdsRow);
}

async function fetchAllCpcAdsDailyPerformance({ client, shopId, accessToken, startDate, endDate }) {
  if (!client || typeof client.shopRequest !== 'function') throw new Error('client.shopRequest is required');
  const query = {
    start_date: toShopeeAdsDate(startDate),
    end_date: toShopeeAdsDate(endDate),
  };
  const endpoint = ENDPOINTS.adsAllCpcDailyPerformance;
  const payload = await client.shopRequest({
    path: endpoint.path,
    shopId,
    accessToken,
    method: endpoint.method,
    query,
  });
  return { query, payload, rows: normalizeShopProductAdsPayload(payload) };
}

async function syncProductAdsOverviewWindow({
  client,
  repository,
  rawRepository,
  shopId,
  accessToken,
  startDate,
  endDate,
}) {
  const result = await fetchAllCpcAdsDailyPerformance({ client, shopId, accessToken, startDate, endDate });
  await recordSnapshot({
    repository: rawRepository,
    appRole: 'ADS',
    endpointKey: 'adsAllCpcDailyPerformance',
    shopId,
    requestJson: result.query,
    responseJson: result.payload,
    eventDateFrom: startDate,
    eventDateTo: endDate,
  });
  await repository.upsertMany({ shopId, rows: result.rows });
  return { rowCount: result.rows.length, startDate, endDate };
}

module.exports = {
  responseRows,
  normalizeShopProductAdsRow,
  normalizeShopProductAdsPayload,
  fetchAllCpcAdsDailyPerformance,
  syncProductAdsOverviewWindow,
};
