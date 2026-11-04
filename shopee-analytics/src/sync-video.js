'use strict';

const { ENDPOINTS } = require('./catalog');

/**
 * The videos a shop published, and what came of them.
 *
 * These belong to the person behind the shop rather than to the shop
 * itself, so they are asked for in that person's name: the request is
 * signed with their number and carries it.
 *
 * The figures are the ones the seller centre shows — how many watched,
 * how many of them watched long enough to count, how many liked and
 * shared, and what came of it in carts and orders. A figure the platform
 * did not report is missing rather than zero: a zero would read as a day
 * with nobody watching, which is a different thing entirely.
 */

function unwrap(payload) {
  return payload && payload.response ? payload.response : payload || {};
}

function numberOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * A rate as this system keeps it.
 *
 * The platform reports a rate as a percentage while this system's
 * percentages are fractions, and a figure above one is taken to be a
 * percentage and one below it a fraction.
 */
function toRate(value) {
  const number = numberOrNull(value);
  if (number === null) return null;
  const rate = number > 1 ? number / 100 : number;
  return Math.round(rate * 1e8) / 1e8;
}

function pick(row, names) {
  for (const name of names) {
    const value = row ? row[name] : undefined;
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return null;
}

/**
 * The figures of a day's videos, and where each is kept.
 *
 * The names come as the platform gives them, and more than one name is
 * accepted for each figure — the platform has spelled them differently
 * in different places.
 */
const OVERVIEW_FIELDS = Object.freeze({
  videos: ['videos', 'video_count', 'total_videos', 'total_video'],
  views: ['views', 'total_views', 'view_count'],
  effectiveViews: ['effective_views', 'effective_view', 'total_effective_views'],
  viewers: ['viewers', 'total_viewers', 'total_viewer', 'unique_viewers'],
  watchDurationSeconds: ['watch_duration', 'avg_watch_duration', 'average_watch_duration', 'total_watch_duration'],
  likes: ['likes', 'total_likes', 'like_count'],
  shares: ['shares', 'total_shares', 'share_count'],
  comments: ['comments', 'total_comments', 'comment_count'],
  newFollowers: ['new_followers', 'total_new_followers', 'new_follower_count'],
  buyers: ['buyers', 'total_buyers', 'unique_buyers'],
  addToCart: ['add_to_cart', 'total_atc', 'atc', 'add_to_cart_count', 'total_add_to_cart'],
  orders: ['orders', 'total_orders', 'total_order'],
  unitsSold: ['units_sold', 'total_units_sold'],
  sales: ['sales', 'total_sales', 'gmv', 'revenue'],
});

const ITEM_FIELDS = Object.freeze({
  views: ['views', 'total_views', 'view_count'],
  effectiveViews: ['effective_views', 'effective_view', 'total_effective_views'],
  viewers: ['viewers', 'total_viewers', 'total_viewer', 'unique_viewers'],
  watchDurationSeconds: ['watch_duration', 'avg_watch_duration', 'average_watch_duration'],
  likes: ['likes', 'total_likes', 'like_count'],
  shares: ['shares', 'total_shares', 'share_count'],
  comments: ['comments', 'total_comments', 'comment_count'],
  buyers: ['buyers', 'total_buyers', 'unique_buyers'],
  addToCart: ['add_to_cart', 'total_atc', 'atc', 'add_to_cart_count'],
  orders: ['orders', 'total_orders', 'total_order'],
  sales: ['sales', 'total_sales', 'gmv', 'revenue'],
});

function pickFields(row, spec) {
  const out = {};
  for (const [column, names] of Object.entries(spec)) out[column] = numberOrNull(pick(row, names));
  return out;
}

/**
 * The day a row belongs to.
 */
function rowDate(row, fallback) {
  const raw = row && (row.date || row.stat_date || row.event_date || row.day);
  if (!raw) return fallback;
  const text = String(raw).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : fallback;
}

/**
 * The series the endpoint answers with.
 *
 * The shape of the answer has changed over time — a list under one key,
 * then another — so the rows are looked for wherever they are.
 */
function extractRows(response, keys) {
  for (const key of keys) {
    const candidate = response ? response[key] : undefined;
    if (Array.isArray(candidate)) return candidate;
  }
  for (const value of Object.values(response || {})) {
    if (Array.isArray(value) && value.length && typeof value[0] === 'object') return value;
  }
  return [];
}

/**
 * A day of the shop's videos, in the shape the repository keeps.
 */
function normalizeOverview(payload, fallbackDate) {
  const response = unwrap(payload);
  const rows = extractRows(response, ['overview', 'overview_performance', 'metric_list', 'list', 'data']);
  const out = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const eventDate = rowDate(row, fallbackDate);
    out.push({ eventDate, detail: pickFields(row, OVERVIEW_FIELDS) });
  }
  return { rows: out, raw: response };
}

/**
 * One video, in the shape the repository keeps.
 */
function normalizeVideoItem(payload, fallbackDate) {
  const response = unwrap(payload);
  const rows = extractRows(response, ['video_list', 'item_list', 'videos', 'list', 'data']);
  const out = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const videoId = numberOrNull(pick(row, ['video_id', 'videoId', 'item_id']));
    if (!videoId) continue;
    const title = pick(row, ['title', 'video_title', 'name']);
    const status = pick(row, ['status', 'video_status']);
    const publishedAt = pick(row, ['publish_time', 'published_at', 'create_time']);
    out.push({
      videoId,
      eventDate: rowDate(row, fallbackDate),
      title: title === null ? null : String(title),
      status: status === null ? null : String(status),
      publishedAt: publishedAt === null ? null : String(publishedAt),
      detail: pickFields(row, ITEM_FIELDS),
    });
  }
  return { items: out, raw: response };
}

/**
 * The videos of a shop over a stretch of days.
 *
 * The endpoint takes the two dates and answers with the shop's own
 * figures for that stretch.
 */
async function fetchVideoOverview({ client, userId, accessToken, startDate, endDate }) {
  const endpoint = ENDPOINTS.videoOverviewPerformance;
  const payload = await client.userRequest({
    path: endpoint.path,
    userId,
    accessToken,
    method: endpoint.method,
    query: { start_date: startDate, end_date: endDate },
  });
  return { ...normalizeOverview(payload, endDate), payload };
}

/**
 * The videos themselves, and what each of them did.
 */
async function fetchVideoList({ client, userId, accessToken, startDate, endDate, pageNo = 1, pageSize = 50 }) {
  const endpoint = ENDPOINTS.videoPerformanceList;
  const payload = await client.userRequest({
    path: endpoint.path,
    userId,
    accessToken,
    method: endpoint.method,
    query: { start_date: startDate, end_date: endDate, page_no: pageNo, page_size: pageSize },
  });
  return { ...normalizeVideoItem(payload, endDate), payload };
}

module.exports = {
  unwrap,
  numberOrNull,
  toRate,
  pick,
  rowDate,
  pickFields,
  normalizeOverview,
  normalizeVideoItem,
  fetchVideoOverview,
  fetchVideoList,
  OVERVIEW_FIELDS,
  ITEM_FIELDS,
};
