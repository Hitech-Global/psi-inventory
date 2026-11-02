'use strict';

const { ENDPOINTS } = require('./catalog');

/**
 * Livestream performance for a shop, from the Brand Portal.
 *
 * The fields are picked by trying a list of names rather than one. The
 * endpoint is young — it went live in July 2026 — and the way Shopee spells
 * a figure has already moved about between the sales report and the
 * livestream one. Reading by a list of names means a rename upstream costs
 * a line here rather than a silent blank column on the page.
 */

const FIELD_CANDIDATES = {
  liveSessions: ['live_sessions', 'lives', 'live_count', 'total_lives', 'session_count', 'session_count_total'],
  liveHours: ['live_hours', 'live_duration', 'live_durations', 'total_live_duration', 'duration', 'live_duration_hours'],
  liveMinutes: ['live_minutes', 'duration_minutes'],
  liveViews: ['live_views', 'views', 'total_views', 'view_count'],
  liveViewers: ['live_viewers', 'viewers', 'unique_viewers', 'total_viewers', 'viewer_count'],
  confirmedOrders: ['confirmed_orders', 'live_orders', 'orders'],
  confirmedSales: ['confirmed_sales', 'live_sales', 'live_gmv', 'sales'],
};

function unwrap(payload) {
  return payload && payload.response ? payload.response : payload || {};
}

function pick(row, names) {
  for (const name of names) {
    const value = row[name];
    if (value === null || value === undefined || value === '') continue;
    return value;
  }
  return null;
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * Live hours, whichever unit the figure arrived in.
 *
 * The report the team keeps counts hours, and the API may report either
 * hours or minutes. A figure in minutes is converted rather than presented
 * as if it were hours, which would be a hundredfold too large.
 */
function normalizeLiveHours(row) {
  const hours = toNumber(pick(row, FIELD_CANDIDATES.liveHours));
  if (hours !== null) return hours;
  const minutes = toNumber(pick(row, FIELD_CANDIDATES.liveMinutes));
  if (minutes !== null) return minutes / 60;
  const seconds = toNumber(row.live_seconds ?? row.duration_seconds);
  if (seconds !== null) return seconds / 3600;
  return null;
}

function normalizeLivestreamDetail(row) {
  return {
    shopId: row.shop_id ?? null,
    shopName: row.shop_name || null,
    region: row.shop_region_code || null,
    currency: row.currency || null,
    liveSessions: toNumber(pick(row, FIELD_CANDIDATES.liveSessions)),
    liveHours: normalizeLiveHours(row),
    liveViews: toNumber(pick(row, FIELD_CANDIDATES.liveViews)),
    liveViewers: toNumber(pick(row, FIELD_CANDIDATES.liveViewers)),
    confirmedOrders: toNumber(pick(row, FIELD_CANDIDATES.confirmedOrders)),
    confirmedSales: toNumber(pick(row, FIELD_CANDIDATES.confirmedSales)),
    raw: row,
  };
}

async function fetchShopLivestreamDay({
  client,
  shopId,
  principalId,
  accessToken,
  date,
  timezone,
  currency = 'LOCAL',
}) {
  if (!timezone) throw new Error('Brand Portal timezone is required');
  if (!Number.isSafeInteger(Number(principalId)) || Number(principalId) <= 0) {
    throw new Error('Brand Portal principalId is required');
  }
  const endpoint = ENDPOINTS.shopLivestreamPerformance;
  const body = {
    start_date: date,
    end_date: date,
    granularity: 'day',
    timezone,
    shop_list: [{ shop_id: shopId, currency }],
  };
  const payload = await client.principalRequest({
    path: endpoint.path,
    principalId,
    accessToken,
    method: endpoint.method,
    body,
  });
  const response = unwrap(payload);
  const rows = Array.isArray(response.details)
    ? response.details
    : Array.isArray(response.shop_list) ? response.shop_list : [];
  const details = rows.map(normalizeLivestreamDetail);
  return { details, body, payload };
}

module.exports = {
  FIELD_CANDIDATES,
  fetchShopLivestreamDay,
  normalizeLiveHours,
  normalizeLivestreamDetail,
  unwrap,
};
