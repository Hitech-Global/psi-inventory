'use strict';

/**
 * The videos of a shop.
 *
 * These belong to the person behind the shop rather than to the shop
 * itself, so they are asked for in that person's name.
 */

const assert = require('assert');
const {
  toRate,
  pick,
  rowDate,
  pickFields,
  normalizeOverview,
  normalizeVideoItem,
  OVERVIEW_FIELDS,
} = require('../src/sync-video');

const test = () => {
  // ── 一天的整体表现 ────────────────────────────────────────────
  const overview = normalizeOverview({
    response: {
      overview: [
        {
          date: '2026-10-05',
          videos: 12,
          views: 3400,
          effective_views: 2800,
          viewers: 900,
          watch_duration: 42.5,
          likes: 130,
          shares: 21,
          comments: 17,
          new_followers: 45,
          buyers: 22,
          add_to_cart: 88,
          orders: 19,
          units_sold: 31,
          sales: 4560000,
        },
      ],
    },
  }, '2026-10-06');

  assert.strictEqual(overview.rows.length, 1);
  const day = overview.rows[0];
  assert.strictEqual(day.eventDate, '2026-10-05');
  assert.strictEqual(day.detail.videos, 12);
  assert.strictEqual(day.detail.views, 3400);
  assert.strictEqual(day.detail.effectiveViews, 2800);
  assert.strictEqual(day.detail.viewers, 900);
  assert.strictEqual(day.detail.likes, 130);
  assert.strictEqual(day.detail.shares, 21);
  assert.strictEqual(day.detail.comments, 17);
  assert.strictEqual(day.detail.newFollowers, 45);
  assert.strictEqual(day.detail.buyers, 22);
  assert.strictEqual(day.detail.addToCart, 88);
  assert.strictEqual(day.detail.orders, 19);
  assert.strictEqual(day.detail.sales, 4560000);

  // ── 另一个平台的叫法 ──────────────────────────────────────────
  const other = normalizeOverview({
    response: {
      list: [
        { stat_date: '2026-10-06', total_views: 800, total_viewers: 200, total_atc: 30, total_orders: 5 },
      ],
    },
  }, '2026-10-07');
  assert.strictEqual(other.rows[0].eventDate, '2026-10-06');
  assert.strictEqual(other.rows[0].detail.views, 800);
  assert.strictEqual(other.rows[0].detail.viewers, 200);
  assert.strictEqual(other.rows[0].detail.addToCart, 30);
  assert.strictEqual(other.rows[0].detail.orders, 5);

  // ── 缺失就是缺失，不是零 ──────────────────────────────────────
  const sparse = normalizeOverview({
    response: { overview: [{ date: '2026-10-07', views: 5 }] },
  }, '2026-10-07');
  assert.strictEqual(sparse.rows[0].detail.orders, null, '没报的字段应该是缺失，不是 0');
  assert.strictEqual(sparse.rows[0].detail.sales, null);

  // ── 每个视频一条 ──────────────────────────────────────────────
  const items = normalizeVideoItem({
    response: {
      video_list: [
        {
          video_id: 9001,
          date: '2026-10-05',
          title: '产品开箱',
          status: 'PUBLISHED',
          publish_time: 1790000000,
          views: 1200,
          viewers: 300,
          likes: 40,
          add_to_cart: 25,
          orders: 6,
          sales: 1500000,
        },
        { date: '2026-10-05', views: 10 },
      ],
    },
  }, '2026-10-05');

  assert.strictEqual(items.items.length, 1, '没有 video_id 的行不算数');
  assert.strictEqual(items.items[0].videoId, 9001);
  assert.strictEqual(items.items[0].title, '产品开箱');
  assert.strictEqual(items.items[0].status, 'PUBLISHED');
  assert.strictEqual(items.items[0].detail.views, 1200);
  assert.strictEqual(items.items[0].detail.addToCart, 25);
  assert.strictEqual(items.items[0].detail.orders, 6);

  // ── 边角 ──────────────────────────────────────────────────────
  assert.strictEqual(rowDate({}, '2026-10-09'), '2026-10-09');
  assert.strictEqual(rowDate({ date: '2026-10-09T00:00:00' }, 'x'), '2026-10-09');
  assert.strictEqual(pick({ a: 1 }, ['b', 'a']), 1);
  assert.strictEqual(pick({ a: '' }, ['a']), null, '空值不算有值');
  assert.strictEqual(toRate(2.21), 0.0221);
  assert.ok(Object.keys(OVERVIEW_FIELDS).includes('addToCart'));

  console.log('Video sync tests: ok');
};

test();
