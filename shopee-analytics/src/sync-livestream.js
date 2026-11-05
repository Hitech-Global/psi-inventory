'use strict';

const { ENDPOINTS } = require('./catalog');

/**
 * The livestreams of a shop, and what came of them.
 *
 * A livestream belongs to the person behind the shop rather than to the
 * shop itself, so it is asked for in that person's name: the request is
 * signed with their number and carries it.
 *
 * The figures are the ones a reader expects of a live session — how many
 * watched, how long they stayed, what they clicked, what they bought.
 * A figure the platform did not report is missing rather than zero: a
 * zero would read as a session nobody watched, which is a different
 * thing entirely.
 */

function unwrap(payload) {
  return payload && payload.response ? payload.response : payload || {};
}

function numberOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

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
 * The figures of a live session, and where each is kept.
 */
const SESSION_FIELDS = Object.freeze({
  views: ['views', 'total_views', 'view_count', 'viewers', 'total_viewers'],
  viewers: ['viewers', 'total_viewers', 'unique_viewers', 'total_viewer'],
  peakViewers: ['peak_viewers', 'max_viewers', 'peak_online_viewers', 'peak_concurrent_viewers'],
  watchDurationSeconds: ['watch_duration', 'total_watch_duration', 'avg_watch_duration', 'duration'],
  clicks: ['clicks', 'total_clicks', 'product_clicks', 'click_count'],
  addToCart: ['add_to_cart', 'total_atc', 'atc', 'add_to_cart_count'],
  orders: ['orders', 'total_orders', 'total_order', 'paid_orders'],
  unitsSold: ['units_sold', 'total_units_sold', 'items_sold'],
  buyers: ['buyers', 'total_buyers', 'unique_buyers'],
  sales: ['sales', 'total_sales', 'gmv', 'revenue', 'total_amount'],
  comments: ['comments', 'total_comments', 'comment_count'],
  shares: ['shares', 'total_shares', 'share_count'],
});

function pickFields(row, spec) {
  const out = {};
  for (const [column, names] of Object.entries(spec)) out[column] = numberOrNull(pick(row, names));
  return out;
}

/**
 * The day a row belongs to.
 *
 * A session is not a day, so the day is taken from when it started and
 * falls back to the day being asked about.
 */
function rowDate(row, fallback) {
  const raw = row && (row.date || row.stat_date || row.event_date);
  if (raw) {
    const text = String(raw).slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  }
  const started = row && (row.start_time || row.startTime || row.live_start_time);
  if (started) {
    const millis = Number(started) * 1000;
    if (Number.isFinite(millis) && millis > 0) return new Date(millis).toISOString().slice(0, 10);
  }
  return fallback;
}

/**
 * The series the endpoint answers with.
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
 * One live session, in the shape the repository keeps.
 */
function normalizeSession(payload, fallbackDate) {
  const response = unwrap(payload);
  const rows = extractRows(response, [
    'session_list', 'sessions', 'livestream_list', 'live_list', 'list', 'data',
  ]);
  const out = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const sessionId = numberOrNull(pick(row, ['session_id', 'sessionId', 'live_session_id']));
    if (!sessionId) continue;
    const title = pick(row, ['title', 'session_title', 'name']);
    const startedAt = pick(row, ['start_time', 'startTime', 'live_start_time']);
    const endedAt = pick(row, ['end_time', 'endTime', 'live_end_time']);
    out.push({
      sessionId,
      eventDate: rowDate(row, fallbackDate),
      title: title === null ? null : String(title),
      startedAt: startedAt === null ? null : String(startedAt),
      endedAt: endedAt === null ? null : String(endedAt),
      detail: pickFields(row, SESSION_FIELDS),
    });
  }
  return { sessions: out, raw: response };
}

/**
 * The live sessions of a shop over a stretch of days.
 */
async function fetchLiveSessions({ client, userId, accessToken, startDate, endDate, pageNo = 1, pageSize = 50 }) {
  const endpoint = ENDPOINTS.liveSessionList;
  const payload = await client.userRequest({
    path: endpoint.path,
    userId,
    accessToken,
    method: endpoint.method,
    query: { start_date: startDate, end_date: endDate, page_no: pageNo, page_size: pageSize },
  });
  return { ...normalizeSession(payload, endDate), payload };
}

/**
 * What came of one live session.
 *
 * The metrics of a session are asked for by the session's own number,
 * so a reader can see one session on its own rather than only as part
 * of the shop's whole.
 */
async function fetchLiveSessionMetric({ client, userId, accessToken, sessionId }) {
  const endpoint = ENDPOINTS.liveSessionMetric;
  const payload = await client.userRequest({
    path: endpoint.path,
    userId,
    accessToken,
    method: endpoint.method,
    query: { session_id: sessionId },
  });
  const response = unwrap(payload);
  const metric = response.session_metric || response.metric || response;
  return { metric: pickFields(metric, SESSION_FIELDS), raw: response };
}

module.exports = {
  unwrap,
  numberOrNull,
  toRate,
  pick,
  rowDate,
  pickFields,
  normalizeSession,
  fetchLiveSessions,
  fetchLiveSessionMetric,
  SESSION_FIELDS,
};
