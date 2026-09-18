'use strict';

const assert = require('assert');
const {
  toShopeeDate,
  leftJoinMembershipPerformance,
  syncGmsDay,
} = require('../src/sync-gms');
const { buildShopeeSeaEventCalendar } = require('../src/event-calendar');

assert.strictEqual(toShopeeDate('2026-09-18'), '09-18-2026');
const events = buildShopeeSeaEventCalendar(2026);
assert(events.some(x => x.eventDate === '2026-09-09' && x.eventType === 'DOUBLE_DAY' && x.intensity === 'MAX'));
assert(events.some(x => x.eventDate === '2026-09-25' && x.eventType === 'PAYDAY_25'));

const joined = leftJoinMembershipPerformance([11, 22], [
  { itemId: 11, expense: 10, directOrders: 1 },
]);
assert.strictEqual(joined.length, 2);
assert.strictEqual(joined[0].hasPerformance, true);
assert.strictEqual(joined[1].hasPerformance, false);
assert.strictEqual(joined[1].expense, 0);

const calls = [];
const fakeClient = {
  async shopRequest(req) {
    calls.push(req);
    if (req.path.includes('get_gms_campaign_performance')) {
      return { response: { campaign_id: 7, report: { expense: 100, broad_gmv: 700, broad_order: 4, direct_gmv: 600, direct_order: 3 } } };
    }
    if (req.path.includes('get_gms_item_performance')) {
      if (req.body.offset === 0) {
        return { response: { has_next_page: true, result_list: [
          { item_id: 11, report: { expense: 60, direct_gmv: 420, direct_order: 2 } },
        ] } };
      }
      return { response: { has_next_page: false, result_list: [
        { item_id: 22, report: { expense: 40, direct_gmv: 180, direct_order: 1 } },
      ] } };
    }
    throw new Error('unexpected path');
  },
};

(async () => {
  const result = await syncGmsDay({
    client: fakeClient,
    shopId: 1,
    accessToken: 'token',
    campaignId: 7,
    date: '2026-09-18',
    membershipItemIds: [11, 22, 33],
  });
  assert.strictEqual(result.campaign.broadRoas, 7);
  assert.strictEqual(result.items.length, 3);
  assert.strictEqual(result.items[2].hasPerformance, false);
  assert(calls.some(x => x.body && x.body.offset === 1));
  console.log('shopee gms sync tests: ok');
})().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
