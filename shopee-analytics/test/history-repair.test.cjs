'use strict';

const assert = require('assert');
const { defaultAnalyticsStartDate, ensureAutomaticHistory } = require('../src/history-repair');

assert.strictEqual(defaultAnalyticsStartDate('2026-09-27'), '2026-09-01');

(async () => {
  const writes = [];
  const calls = [];
  const shop = {
    shopId: 1770037299,
    timezone: 'Asia/Kuala_Lumpur',
    analyticsStartDate: null,
    oauthAuthorized: true,
  };
  const result = await ensureAutomaticHistory({
    runtime: {},
    profileRepository: {
      async ensureAnalyticsStartDate(input) {
        writes.push(input);
        return input.startDate;
      },
    },
    shop,
    now: new Date('2026-09-27T08:00:00Z'),
    seededGmsCampaignIds: [164499732],
    async backfillRunner(input) {
      calls.push(input);
      return { ok: true };
    },
  });

  assert.deepStrictEqual(writes, [{ shopId: 1770037299, startDate: '2026-09-01' }]);
  assert.strictEqual(shop.analyticsStartDate, '2026-09-01');
  assert.strictEqual(result.startDate, '2026-09-01');
  assert.strictEqual(result.endDate, '2026-09-26');
  assert.strictEqual(result.initializedStartDate, true);
  assert.deepStrictEqual(calls[0].sources, ['product-ads', 'gms']);
  assert.deepStrictEqual(calls[0].seededGmsCampaignIds, [164499732]);

  const skipped = await ensureAutomaticHistory({
    runtime: {}, profileRepository: {},
    shop: { shopId: 1, oauthAuthorized: false },
    backfillRunner: async () => { throw new Error('must not run'); },
  });
  assert.strictEqual(skipped.skipped, 'NO_ADS_TOKEN');
  console.log('automatic Shopee history repair tests: ok');
})().catch(error => { console.error(error); process.exitCode = 1; });
