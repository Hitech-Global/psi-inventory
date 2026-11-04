'use strict';

const { ENDPOINTS } = require('./catalog');

/**
 * The traffic a shop brought in on its own, and what became of it.
 *
 * These come from the business insights endpoints, which belong to the
 * permission pool of an ERP System application — an advertising
 * application is refused, and its figures are a different thing
 * altogether: what the ads spent, not what the shop did with the people
 * who came. So the natural traffic and the advertising are kept apart,
 * and this is the natural side.
 *
 * The endpoint reports a day by day series. Each day is kept as it was
 * reported, so that a series of days becomes a trend.
 *
 * The names of the fields are taken as they come, and more than one name
 * is accepted for each figure: the platform has spelled them differently
 * in different places, and a figure that is not recognized is a figure
 * that is missing rather than a figure that is zero.
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
 * The figures the shop's traffic is made of, and where each is kept.
 *
 * Each figure is looked for under several names, because the platform
 * has used more than one for the same figure.
 */
const SHOP_TRAFFIC_FIELDS = Object.freeze({
  sales: ['sales', 'total_sales', 'gmv', 'revenue', 'total_amount'],
  orders: ['orders', 'total_order', 'total_orders', 'total_paid_order'],
  unitsSold: ['units_sold', 'total_units_sold', 'units'],
  buyers: ['buyers', 'total_buyer', 'total_buyers'],
  newBuyers: ['new_buyers', 'new_buyer'],
  productClicks: ['clicks', 'total_click', 'product_clicks', 'click', 'total_product_click'],
  productViews: ['page_views', 'total_page_view', 'product_views', 'views', 'page_view'],
  uniqueVisitors: ['visitors', 'total_visitor', 'unique_visitors', 'uv', 'shop_visitors'],
  carts: ['carts', 'total_cart', 'cart', 'add_to_cart', 'total_add_to_cart'],
  potentialBuyers: ['potential_buyers', 'potential_buyer'],
  itemConversionRate: ['item_conversion_rate', 'cart_conversion_rate', 'add_to_cart_rate', 'carts_conversion_rate'],
  orderConversionRate: ['order_conversion_rate', 'conversion_rate', 'orders_conversion_rate'],
});

/**
 * A rate as this system keeps it.
 *
 * The platform reports a rate as a percentage — a conversion rate of 2.21
 * means 2.21 per cent — while this system's percentages are fractions,
 * because that is how the other sources report them. A figure above one
 * is taken to be a percentage, and one below it a fraction: the two are
 * told apart by their size rather than by a field that does not always
 * say which it is.
 */
function toRate(value) {
  const number = numberOrNull(value);
  if (number === null) return null;
  const rate = number > 1 ? number / 100 : number;
  // Dividing by a hundred does not land on a clean number — 2.21 becomes
  // 0.022099999999999998 — and the noise would be carried into the
  // figures that are shown and compared. It is rounded away here.
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
 * The day a row belongs to.
 */
function rowDate(row, fallback) {
  const raw = row && (row.date || row.event_date || row.eventDate || row.stat_date);
  if (!raw) return fallback;
  const text = String(raw).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : fallback;
}

/**
 * One day of the shop's traffic, in the shape the repository keeps.
 */
function normalizeShopTrafficRow(row, fallbackDate) {
  if (!row || typeof row !== 'object') return null;
  const eventDate = rowDate(row, fallbackDate);
  const detail = {};
  for (const [column, names] of Object.entries(SHOP_TRAFFIC_FIELDS)) {
    if (column.endsWith('ConversionRate')) {
      detail[column] = toRate(pick(row, names));
    } else {
      detail[column] = numberOrNull(pick(row, names));
    }
  }
  if (detail.uniqueVisitors === null && detail.visitors !== undefined) {
    detail.uniqueVisitors = detail.visitors;
  }
  return { eventDate, detail };
}

/**
 * The series the endpoint answers with.
 *
 * The shape of the answer has changed over time — a list under one key,
 * then another — so the rows are looked for wherever they are.
 */
function extractRows(response) {
  const candidates = [
    response.shop_traffic, response.shop_traffic_list, response.traffic,
    response.shop_performance, response.shop_performance_list,
    response.performance, response.list, response.data,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
    if (candidate && typeof candidate === 'object') return [candidate];
  }
  return [];
}

/**
 * The shop's own traffic, day by day.
 */
function normalizeShopTraffic(payload, fallbackDate) {
  const response = unwrap(payload);
  const rows = [];
  for (const row of extractRows(response)) {
    const normalized = normalizeShopTrafficRow(row, fallbackDate);
    if (normalized) rows.push(normalized);
  }
  return { rows, raw: response };
}

/**
 * One item's traffic, day by day.
 */
function normalizeProductTrafficRow(row, fallbackDate) {
  if (!row || typeof row !== 'object') return null;
  const itemId = numberOrNull(pick(row, ['item_id', 'itemId', 'item_model_id', 'model_id']));
  if (!itemId) return null;
  const eventDate = rowDate(row, fallbackDate);
  const detail = {
    impressions: numberOrNull(pick(row, ['impressions', 'product_impression', 'total_impression'])),
    clicks: numberOrNull(pick(row, ['clicks', 'product_clicks', 'click'])),
    visitors: numberOrNull(pick(row, ['visitors', 'product_visitors', 'unique_visitors'])),
    pageViews: numberOrNull(pick(row, ['page_views', 'product_page_views'])),
    carts: numberOrNull(pick(row, ['carts', 'add_to_carts'])),
    orders: numberOrNull(pick(row, ['orders', 'total_order'])),
    sales: numberOrNull(pick(row, ['sales', 'total_sales', 'gmv'])),
    unitsSold: numberOrNull(pick(row, ['units_sold', 'total_units_sold'])),
    buyers: numberOrNull(pick(row, ['buyers'])),
    bounceVisitors: numberOrNull(pick(row, ['bounce_visitors'])),
    bounceRate: toRate(pick(row, ['bounce_rate'])),
    ctr: toRate(pick(row, ['ctr', 'click_through_rate'])),
  };
  const itemName = pick(row, ['item_name', 'itemName', 'name']);
  return { itemId, eventDate, detail, itemName: itemName === null ? null : String(itemName) };
}

function normalizeProductTraffic(payload, fallbackDate) {
  const response = unwrap(payload);
  const candidates = [
    response.item_traffic, response.item_traffic_list, response.product_traffic,
    response.list, response.data,
  ];
  let rows = [];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) { rows = candidate; break; }
  }
  const items = [];
  for (const row of rows) {
    const normalized = normalizeProductTrafficRow(row, fallbackDate);
    if (normalized) items.push(normalized);
  }
  return { items, raw: response };
}

/**
 * The shop's traffic over a stretch of days.
 *
 * The endpoint takes the two dates in its body and answers with the
 * shop's own figures for that stretch: the visitors, the clicks on the
 * products, what was put in the cart, what was ordered and what it came
 * to.
 */
async function fetchShopTraffic({ client, shopId, accessToken, startDate, endDate }) {
  const endpoint = ENDPOINTS.marketingOverview;
  const payload = await client.shopRequest({
    path: endpoint.path,
    shopId,
    accessToken,
    method: endpoint.method,
    query: {},
    body: { date_start: startDate, date_end: endDate },
  });
  return { ...normalizeShopTraffic(payload, endDate), payload };
}

/**
 * The traffic each item brought in over a stretch of days.
 */
async function fetchProductTraffic({ client, shopId, accessToken, startDate, endDate, pageNo = 1, pageSize = 50 }) {
  const endpoint = ENDPOINTS.marketingHotListing;
  const payload = await client.shopRequest({
    path: endpoint.path,
    shopId,
    accessToken,
    method: endpoint.method,
    query: {},
    body: { date_start: startDate, date_end: endDate, page_no: pageNo, page_size: pageSize },
  });
  return { ...normalizeProductTraffic(payload, endDate), payload };
}

module.exports = {
  unwrap,
  numberOrNull,
  toRate,
  pick,
  rowDate,
  normalizeShopTraffic,
  normalizeShopTrafficRow,
  normalizeProductTraffic,
  normalizeProductTrafficRow,
  fetchShopTraffic,
  fetchProductTraffic,
  SHOP_TRAFFIC_FIELDS,
};
