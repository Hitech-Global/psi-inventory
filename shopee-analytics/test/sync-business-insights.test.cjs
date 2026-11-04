'use strict';

/**
 * The shop's own traffic: the visitors who came, what they looked at,
 * what they clicked, what they bought.
 *
 * These figures come from the business insights endpoints, and the names
 * of the fields are taken as they come — the platform has spelled them
 * differently in different places, so more than one name is accepted for
 * each figure.
 */

const assert = require('assert');
const {
  toRate,
  pick,
  rowDate,
  normalizeShopTraffic,
  normalizeShopTrafficRow,
  normalizeProductTraffic,
} = require('../src/sync-business-insights');

const test = () => {
  // ── 一条日流量 ──────────────────────────────────────────────────
  const row = normalizeShopTrafficRow({
    date: '2026-10-05',
    visitors: 2282,
    page_views: 4170,
    clicks: 3174,
    carts: 171,
    orders: 70,
    sales: 14622499,
    units_sold: 96,
    buyers: 66,
    order_conversion_rate: 0.0221,
    item_conversion_rate: 0.075,
  }, '2026-10-06');

  assert.strictEqual(row.eventDate, '2026-10-05');
  assert.strictEqual(row.detail.uniqueVisitors, 2282);
  assert.strictEqual(row.detail.productViews, 4170);
  assert.strictEqual(row.detail.productClicks, 3174);
  assert.strictEqual(row.detail.orders, 70);
  assert.strictEqual(row.detail.sales, 14622499);
  assert.strictEqual(row.detail.uniqueVisitors, 2282);
  assert.strictEqual(row.detail.itemConversionRate, 0.075);
  assert.strictEqual(row.detail.orderConversionRate, 0.0221);

  // ── 另一个平台的叫法 ────────────────────────────────────────────
  const other = normalizeShopTrafficRow({
    date: '2026-10-06',
    total_visitor: 900,
    total_click: 120,
    total_order: 9,
    total_sales: 5000,
    total_page_view: 2000,
  }, '2026-10-06');
  assert.strictEqual(other.detail.uniqueVisitors, 900);
  assert.strictEqual(other.detail.productClicks, 120);
  assert.strictEqual(other.detail.orders, 9);
  assert.strictEqual(other.detail.sales, 5000);
  assert.strictEqual(other.detail.productViews, 2000);

  // ── 缺失就是缺失，不是零 ────────────────────────────────────────
  const sparse = normalizeShopTrafficRow({ date: '2026-10-07', visitors: 5 }, '2026-10-07');
  assert.strictEqual(sparse.detail.orders, null, '没报的字段应该是缺失，不是 0');
  assert.strictEqual(sparse.detail.sales, null);

  // ── 百分比与分数 ────────────────────────────────────────────────
  assert.strictEqual(toRate(2.21), 0.0221, '百分比要换算成分数');
  assert.strictEqual(toRate(0.0221), 0.0221, '分数原样保留');
  assert.strictEqual(toRate(null), null);
  assert.strictEqual(toRate(''), null);

  // ── 整个序列 ────────────────────────────────────────────────────
  const series = normalizeShopTraffic({
    response: {
      shop_traffic: [
        { date: '2026-10-05', visitors: 10, orders: 1 },
        { date: '2026-10-06', visitors: 20, orders: 2 },
      ],
    },
  }, '2026-10-07');
  assert.strictEqual(series.rows.length, 2);
  assert.strictEqual(series.rows[0].eventDate, '2026-10-05');
  assert.strictEqual(series.rows[1].detail.orders, 2);

  // ── 换个形状的答案 ──────────────────────────────────────────────
  const single = normalizeShopTraffic({
    response: { shop_performance: { date: '2026-10-08', visitors: 33, orders: 3 } },
  }, '2026-10-09');
  assert.strictEqual(single.rows.length, 1);
  assert.strictEqual(single.rows[0].detail.uniqueVisitors, 33);

  // ── 商品级流量 ──────────────────────────────────────────────────
  const items = normalizeProductTraffic({
    response: {
      item_traffic: [
        { item_id: 111, date: '2026-10-05', impressions: 900, clicks: 45, visitors: 60, bounce_rate: 0.12 },
        { date: '2026-10-05', impressions: 10 },
      ],
    },
  }, '2026-10-05');
  assert.strictEqual(items.items.length, 1, '没有 item_id 的行不算数');
  assert.strictEqual(items.items[0].itemId, 111);
  assert.strictEqual(items.items[0].detail.impressions, 900);
  assert.strictEqual(items.items[0].detail.clicks, 45);
  assert.strictEqual(items.items[0].detail.bounceRate, 0.12);

  // ── 日期与取值的边角 ────────────────────────────────────────────
  assert.strictEqual(rowDate({}, '2026-10-09'), '2026-10-09');
  assert.strictEqual(rowDate({ date: '2026-10-09T00:00:00' }, 'x'), '2026-10-09');
  assert.strictEqual(pick({ a: 1 }, ['b', 'a']), 1);
  assert.strictEqual(pick({ a: '' }, ['a']), null, '空值不算有值');

  console.log('Business insights sync tests: ok');
};

test();
