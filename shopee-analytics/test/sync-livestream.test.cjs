'use strict';

/**
 * The livestreams of a shop.
 *
 * A livestream belongs to the person behind the shop rather than to the
 * shop itself, so it is asked for in that person's name.
 */

const assert = require('assert');
const {
  toRate,
  pick,
  rowDate,
  pickFields,
  normalizeSession,
  SESSION_FIELDS,
} = require('../src/sync-livestream');

const test = () => {
  // ── 一场直播 ──────────────────────────────────────────────────
  const result = normalizeSession({
    response: {
      session_list: [
        {
          session_id: 7001,
          start_time: 1791000000,
          title: '晚间直播',
          views: 5200,
          viewers: 1800,
          peak_viewers: 640,
          watch_duration: 3600,
          clicks: 430,
          add_to_cart: 210,
          orders: 96,
          units_sold: 150,
          buyers: 88,
          sales: 9800000,
          comments: 320,
          shares: 45,
        },
        { views: 10 },
      ],
    },
  }, '2026-11-05');

  assert.strictEqual(result.sessions.length, 1, '没有 session_id 的行不算数');
  const session = result.sessions[0];
  assert.strictEqual(session.sessionId, 7001);
  assert.strictEqual(session.title, '晚间直播');
  assert.strictEqual(session.detail.views, 5200);
  assert.strictEqual(session.detail.viewers, 1800);
  assert.strictEqual(session.detail.peakViewers, 640);
  assert.strictEqual(session.detail.watchDurationSeconds, 3600);
  assert.strictEqual(session.detail.clicks, 430);
  assert.strictEqual(session.detail.addToCart, 210);
  assert.strictEqual(session.detail.orders, 96);
  assert.strictEqual(session.detail.buyers, 88);
  assert.strictEqual(session.detail.sales, 9800000);
  assert.strictEqual(session.detail.comments, 320);

  // ── 另一个平台的叫法 ──────────────────────────────────────────
  const other = normalizeSession({
    response: {
      sessions: [
        { session_id: 7002, date: '2026-11-04', total_views: 100, total_viewers: 40, total_atc: 12, total_orders: 3 },
      ],
    },
  }, '2026-11-05');
  assert.strictEqual(other.sessions[0].eventDate, '2026-11-04');
  assert.strictEqual(other.sessions[0].detail.views, 100);
  assert.strictEqual(other.sessions[0].detail.viewers, 40);
  assert.strictEqual(other.sessions[0].detail.addToCart, 12);
  assert.strictEqual(other.sessions[0].detail.orders, 3);

  // ── 缺失就是缺失，不是零 ──────────────────────────────────────
  const sparse = normalizeSession({
    response: { session_list: [{ session_id: 7003, views: 5 }] },
  }, '2026-11-05');
  assert.strictEqual(sparse.sessions[0].detail.orders, null, '没报的字段应该是缺失，不是 0');
  assert.strictEqual(sparse.sessions[0].detail.sales, null);

  // ── 场次按它开始的那天记 ──────────────────────────────────────
  const byStart = normalizeSession({
    response: { list: [{ session_id: 7004, start_time: 1791000000 }] },
  }, '2026-11-05');
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(byStart.sessions[0].eventDate), '场次要落到某一天');

  // ── 边角 ──────────────────────────────────────────────────────
  assert.strictEqual(rowDate({}, '2026-11-09'), '2026-11-09');
  assert.strictEqual(pick({ a: 1 }, ['b', 'a']), 1);
  assert.strictEqual(pick({ a: '' }, ['a']), null, '空值不算有值');
  assert.strictEqual(toRate(2.21), 0.0221);
  assert.ok(Object.keys(SESSION_FIELDS).includes('peakViewers'));

  console.log('Livestream sync tests: ok');
};

test();
