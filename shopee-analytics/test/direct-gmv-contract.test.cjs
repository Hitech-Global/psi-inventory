'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { normalizePerformance, sumPerformance } = require('../src/metrics');
const { ShopeeAnalyticsRepository } = require('../src/repository');
const { ShopeeQueryRepository } = require('../src/query-repository');

const missing = normalizePerformance({ expense: 284.13, direct_order: 17, direct_roi: 3.97 });
assert.strictEqual(missing.directGmv, null);
assert.strictEqual(missing.directRoas, 3.97);
assert.strictEqual(missing.sourceDirectGmvPresent, false);
assert.deepStrictEqual(missing.dataQualityFlags, ['SOURCE_DIRECT_GMV_MISSING']);

const explicitZero = normalizePerformance({ expense: 10, direct_gmv: 0, direct_roi: 0 });
assert.strictEqual(explicitZero.directGmv, 0);
assert.strictEqual(explicitZero.sourceDirectGmvPresent, true);
assert.deepStrictEqual(explicitZero.dataQualityFlags, []);

const partial = sumPerformance([{ direct_gmv: 100, expense: 10 }, { direct_order: 1, direct_roi: 3.97, expense: 20 }]);
assert.strictEqual(partial.directGmv, null);
assert.strictEqual(partial.directMetricComplete, false);
assert.strictEqual(partial.directRoas, null);

(async () => {
  const repositoryCalls = [];
  const repository = new ShopeeAnalyticsRepository({
    pool: { query: async (...args) => { repositoryCalls.push(args); return { rows: [] }; } },
  });
  await repository.upsertCampaignDaily({
    shopId: 1,
    campaignId: 2,
    eventDate: '2026-09-18',
    performance: missing,
  });
  const saved = repositoryCalls[0][1];
  assert.strictEqual(saved[9], null, 'missing Direct GMV must persist as NULL');
  assert.strictEqual(saved[10], 3.97, 'source Direct ROI must persist unchanged');

  const queries = [];
  const queryRepository = new ShopeeQueryRepository({
    pool: {
      query: async sql => {
        queries.push(sql);
        return { rows: [{
          campaign_id: 2, ad_type: 'gms', campaign_type_raw: 'GMS', campaign_type_normalized: 'GMS',
          region: null, status: null, bidding_method: null, campaign_budget: null, target_roas: null,
          ad_name: null, campaign_placement: null, setting_observed_at: null, latest_performance_date: '2026-09-18',
          impressions: 1, clicks: 1, expense: 284.13, broad_gmv: 1309, broad_orders: 19, broad_units: 19,
          direct_gmv: null, direct_metric_complete: false, direct_orders: 17, direct_units: 17,
        }] };
      },
    },
  });
  const campaigns = await queryRepository.listCampaignOverview({ shopId: 1, startDate: '2026-09-18', endDate: '2026-09-24' });
  assert.strictEqual(campaigns[0].performance.directGmv, null);
  assert.strictEqual(campaigns[0].performance.directMetricComplete, false);
  assert.deepStrictEqual(campaigns[0].performance.dataQualityFlags, ['SOURCE_DIRECT_GMV_MISSING']);
  assert(!queries[0].includes('COALESCE(SUM(d.direct_gmv),0)'), 'query must not coerce missing Direct GMV to 0');
  assert(queries[0].includes('BOOL_AND(d.direct_gmv IS NOT NULL)'), 'query must expose Direct GMV completeness');

  const schema = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
  for (const table of ['shopee_ad_campaign_daily', 'shopee_ad_campaign_hourly', 'shopee_ad_item_daily']) {
    assert(schema.includes(`ALTER TABLE ${table}\n  ALTER COLUMN direct_gmv DROP NOT NULL`));
    assert(schema.includes(`ALTER TABLE ${table}\n  ADD COLUMN IF NOT EXISTS direct_roas`));
  }
  console.log('shopee direct GMV contract tests: ok');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
