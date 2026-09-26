'use strict';

const assert = require('assert');
const { dateRangeInclusive, trailingWindow, syncGmsWindow } = require('../src/sync-window');
const { createGmsRequestPacer } = require('../src/sync-gms');

assert.deepStrictEqual(
  dateRangeInclusive('2026-09-16', '2026-09-18'),
  ['2026-09-16', '2026-09-17', '2026-09-18'],
);
assert.deepStrictEqual(
  trailingWindow('2026-09-18', 7),
  { startDate: '2026-09-12', endDate: '2026-09-18' },
);

const saved = [];
const syncMarks = [];
const fakeRepository = {
  async loadMembershipItemIds({ eventDate }) {
    return eventDate === '2026-09-18' ? [11, 22, 33] : [11, 22];
  },
  async saveGmsDay(input) { saved.push(input); },
  async markSyncSuccess(input) { syncMarks.push({ type: 'ok', ...input }); },
  async markSyncFailure(input) { syncMarks.push({ type: 'fail', ...input }); },
};

const fakeClient = {
  async shopRequest(req) {
    if (req.path.includes('get_gms_campaign_performance')) {
      return {
        response: {
          campaign_id: req.body.campaign_id,
          report: {
            expense: 100,
            broad_gmv: 700,
            broad_order: 4,
            direct_gmv: 600,
            direct_order: 3,
          },
        },
      };
    }
    if (req.path.includes('get_gms_item_performance')) {
      return {
        response: {
          has_next_page: false,
          result_list: [
            { item_id: 11, report: { expense: 60, direct_gmv: 420, direct_order: 2 } },
            { item_id: 22, report: { expense: 40, direct_gmv: 180, direct_order: 1 } },
          ],
        },
      };
    }
    throw new Error(`unexpected path ${req.path}`);
  },
};

(async () => {
  const result = await syncGmsWindow({
    client: fakeClient,
    repository: fakeRepository,
    shopId: 1,
    accessToken: 'token',
    campaignId: 7,
    startDate: '2026-09-17',
    endDate: '2026-09-18',
    requestPacer: createGmsRequestPacer({ minIntervalMs: 0 }),
  });
  assert.strictEqual(result.length, 2);
  assert.strictEqual(saved.length, 2);
  assert.strictEqual(saved[1].items.length, 3);
  assert.strictEqual(saved[1].items[2].hasPerformance, false);
  assert(saved[0].rawSnapshots.length >= 2);
  assert.strictEqual(syncMarks[syncMarks.length - 1].type, 'ok');
  assert.strictEqual(result.requestAudit.length, 4);

  const savedBeforeFailure = [];
  const failureMarks = [];
  let itemCalls = 0;
  const failureRepository = {
    async loadMembershipItemIds() { return []; },
    async saveGmsDay(input) { savedBeforeFailure.push(input); },
    async markSyncSuccess(input) { failureMarks.push({ type: 'ok', ...input }); },
    async markSyncFailure(input) { failureMarks.push({ type: 'fail', ...input }); },
  };
  const rateLimitedClient = {
    async shopRequest(req) {
      if (req.path.includes('get_gms_campaign_performance')) {
        return { response: { campaign_id: 7, report: {} } };
      }
      itemCalls += 1;
      if (itemCalls === 2) {
        const error = new Error('ads_rate_limit_shop_api');
        error.code = 'ads_rate_limit_shop_api';
        error.kind = 'RATE_LIMIT';
        throw error;
      }
      return { response: { has_next_page: false, result_list: [] } };
    },
  };
  await assert.rejects(() => syncGmsWindow({
    client: rateLimitedClient, repository: failureRepository, shopId: 1, accessToken: 'token', campaignId: 7,
    startDate: '2026-09-17', endDate: '2026-09-18', requestPacer: createGmsRequestPacer({ minIntervalMs: 0 }),
  }), /ads_rate_limit_shop_api/);
  assert.strictEqual(savedBeforeFailure.length, 1, 'only the completed first day may persist');
  assert.strictEqual(failureMarks.length, 1);
  assert.strictEqual(failureMarks[0].type, 'fail');
  console.log('shopee sync window tests: ok');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
