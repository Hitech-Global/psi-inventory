'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  fetchShopLivestreamDay,
  normalizeLiveHours,
  normalizeLivestreamDetail,
} = require('../src/sync-shop-livestream');

test('live hours are read whichever unit the figure arrived in', () => {
  assert.equal(normalizeLiveHours({ live_hours: 2.5 }), 2.5);
  assert.equal(normalizeLiveHours({ live_duration: 2.5 }), 2.5);
  assert.equal(normalizeLiveHours({ live_minutes: 150 }), 2.5);
  assert.equal(normalizeLiveHours({ live_seconds: 5400 }), 1.5);
  assert.equal(normalizeLiveHours({}), null);
});

test('a figure named in one of several ways is still found', () => {
  const detail = normalizeLivestreamDetail({
    shop_id: 1326456001,
    views: 1200,
    viewers: 340,
    confirmed_sales: 56000,
    confirmed_orders: 21,
    lives: 3,
  });
  assert.equal(detail.liveViews, 1200);
  assert.equal(detail.liveViewers, 340);
  assert.equal(detail.confirmedSales, 56000);
  assert.equal(detail.confirmedOrders, 21);
  assert.equal(detail.liveSessions, 3);
  assert.equal(detail.shopId, 1326456001);
});

test('a figure that is not there stays missing rather than becoming zero', () => {
  const detail = normalizeLivestreamDetail({ shop_id: 1 });
  assert.equal(detail.liveViews, null);
  assert.equal(detail.liveViewers, null);
  assert.equal(detail.confirmedSales, null);
  assert.equal(detail.liveHours, null);
});

test('the day is fetched for one shop with the principal in the request', async () => {
  const calls = [];
  const client = {
    async principalRequest(payload) {
      calls.push(payload);
      return { response: { details: [{ shop_id: 1326456001, viewers: 10 }] } };
    },
  };
  const result = await fetchShopLivestreamDay({
    client,
    shopId: 1326456001,
    principalId: 998877,
    accessToken: 'token',
    date: '2026-11-01',
    timezone: 'Asia/Jakarta',
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/api/v2/principal/get_shop_livestream_performance');
  assert.equal(calls[0].principalId, 998877);
  assert.equal(calls[0].body.start_date, '2026-11-01');
  assert.equal(calls[0].body.end_date, '2026-11-01');
  assert.equal(calls[0].body.granularity, 'day');
  assert.equal(calls[0].body.timezone, 'Asia/Jakarta');
  assert.deepEqual(calls[0].body.shop_list, [{ shop_id: 1326456001, currency: 'LOCAL' }]);
  assert.equal(result.details.length, 1);
  assert.equal(result.details[0].liveViewers, 10);
});

test('the day is not fetched without a timezone or a principal', async () => {
  const client = { async principalRequest() { throw new Error('should not be called'); } };
  await assert.rejects(
    () => fetchShopLivestreamDay({ client, shopId: 1, principalId: 2, accessToken: 't', date: '2026-11-01', timezone: '' }),
    /timezone is required/,
  );
  await assert.rejects(
    () => fetchShopLivestreamDay({ client, shopId: 1, principalId: 0, accessToken: 't', date: '2026-11-01', timezone: 'Asia/Jakarta' }),
    /principalId is required/,
  );
});
