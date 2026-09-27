'use strict';

const assert = require('assert');
const {
  GMS_COST_FIXED_POINT_SCALE,
  toShopeeDate,
  decodeGmsFixedPointCost,
  normalizeGmsPerformance,
  leftJoinMembershipPerformance,
  syncGmsDay,
  createGmsRequestPacer,
  resolveGmsMinRequestIntervalMs,
} = require('../src/sync-gms');
const { buildShopeeSeaEventCalendar } = require('../src/event-calendar');

assert.strictEqual(toShopeeDate('2026-09-18'), '18-09-2026');
assert.strictEqual(GMS_COST_FIXED_POINT_SCALE, 100000);
assert.strictEqual(decodeGmsFixedPointCost(79664), 0.79664);
const k521 = normalizeGmsPerformance({
  impression: 167,
  clicks: 6,
  expense: 0.8,
  broad_gmv: 61,
  broad_order: 1,
  broad_order_amount: 1,
  direct_order: 1,
  direct_order_amount: 1,
  broad_roi: 76.57,
  direct_roi: 76.57,
  cpc: 79664,
  cpdc: 79664,
});
assert.strictEqual(k521.costPerConversion, 0.79664);
assert.strictEqual(k521.costPerDirectConversion, 0.79664);
assert(Math.abs(k521.broadAcos - (0.79664 / 61)) < 1e-12);
assert.strictEqual(k521.broadRoas, 76.57);
assert.strictEqual(k521.directGmv, null);
assert.strictEqual(k521.directAcos, null);

const meteor = normalizeGmsPerformance({
  impression: 628,
  clicks: 34,
  expense: 8.7,
  broad_gmv: 46,
  broad_order: 2,
  broad_order_amount: 2,
  direct_order: 2,
  direct_order_amount: 2,
  broad_roi: 5.28,
  direct_roi: 5.28,
  cpc: 435212,
  cpdc: 435212,
});
assert.strictEqual(meteor.costPerConversion, 4.35212);
assert(Math.abs(meteor.broadAcos - (8.70424 / 46)) < 1e-12);

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
let clock = 0;
const requestAudit = [];
const pacer = createGmsRequestPacer({
  minIntervalMs: 1500,
  now: () => clock,
  sleep: async ms => { clock += ms; },
  audit: requestAudit,
});
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
    requestPacer: pacer,
  });
  assert.strictEqual(result.campaign.broadRoas, 7);
  assert.strictEqual(result.items.length, 3);
  assert.strictEqual(result.items[2].hasPerformance, false);
  assert(calls.some(x => x.body && x.body.offset === 1));
  assert.deepStrictEqual(requestAudit.map(row => row.endpointKey), [
    'adsGmsCampaignPerformance', 'adsGmsItemPerformance', 'adsGmsItemPerformance',
  ]);
  assert.deepStrictEqual(requestAudit.map(row => row.waitMs), [0, 1500, 1500]);
  assert.deepStrictEqual(requestAudit.map(row => row.offset), [null, 0, 1]);
  assert.strictEqual(resolveGmsMinRequestIntervalMs({}), 1500);
  assert.throws(() => resolveGmsMinRequestIntervalMs({ SHOPEE_ADS_MIN_REQUEST_INTERVAL_MS: '-1' }));
  console.log('shopee gms sync tests: ok');
})().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
