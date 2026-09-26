'use strict';

const assert = require('assert');
const { ShopeeAnalyticsRepository } = require('../src/repository');
const { assertFormalGmsPilotScope } = require('../src/deployment-mode');

const env = {
  SHOPEE_ANALYTICS_DEPLOYMENT_MODE: 'PILOT_GMV_MAX',
  SHOPEE_PILOT_GMV_MAX_SHOP_ID: '1770037299',
  SHOPEE_PILOT_GMV_MAX_BRAND: 'REDRAGON',
  SHOPEE_PILOT_SHOP_GMV_MAX_CAMPAIGN_IDS: '164499732',
  SHOPEE_PILOT_INDIVIDUAL_AD_CAMPAIGN_IDS: '',
  // This deprecated value must never authorize formal GMS sync.
  SHOPEE_PILOT_GMV_MAX_CAMPAIGN_IDS: '999999999',
};

assert.doesNotThrow(() => assertFormalGmsPilotScope({ shopId: 1770037299, campaignId: 164499732, env }));
assert.throws(() => assertFormalGmsPilotScope({ shopId: 1770037299, campaignId: 999999999, env }), /independent allowlist/);
assert.throws(() => assertFormalGmsPilotScope({ shopId: 1770037299, campaignId: 164499732, env: { ...env, SHOPEE_PILOT_SHOP_GMV_MAX_CAMPAIGN_IDS: '' } }), /independent allowlist/);
assert.throws(() => assertFormalGmsPilotScope({ shopId: 1, campaignId: 164499732, env }), /refuses shop/);

function makePool() {
  const queries = [];
  const client = { query: async sql => { queries.push(sql); return { rows: [] }; }, release() {} };
  return { queries, query: client.query, connect: async () => client };
}

(async () => {
  const pool = makePool();
  const saved = [];
  const unified = {
    async saveWithItems(row, items, { queryable }) {
      saved.push({ row, items, queryable });
    },
  };
  const repository = new ShopeeAnalyticsRepository({ pool });
  await repository.saveGmsDay({
    shopId: 1770037299,
    campaignId: 164499732,
    eventDate: '2026-09-18',
    campaign: { expense: 284.13, broadGmv: 1309, directGmv: null, directRoas: 3.97, directOrders: 17, dataQualityFlags: ['SOURCE_DIRECT_GMV_MISSING'], raw: { report: {} } },
    items: [{ itemId: 11, expense: 1, directGmv: null, directRoas: 3.97, directOrders: 1, dataQualityFlags: ['SOURCE_DIRECT_GMV_MISSING'], raw: {} }],
    rawSnapshots: [],
    adPromotionRepository: unified,
    env,
  });
  assert.strictEqual(saved.length, 1);
  assert.strictEqual(saved[0].row.promotionType, 'SHOP_GMV_MAX');
  assert.strictEqual(saved[0].row.dataSource, 'SHOPEE_API');
  assert.strictEqual(saved[0].row.directGmv, null);
  assert.strictEqual(saved[0].row.directRoas, 3.97);
  assert(saved[0].row.qualityFlags.includes('SOURCE_DIRECT_GMV_MISSING'));
  assert.strictEqual(saved[0].items[0].itemId, 11);
  assert.strictEqual(saved[0].items[0].directGmv, null);
  assert(pool.queries.some(sql => String(sql).startsWith('BEGIN')));
  assert(pool.queries.some(sql => String(sql).startsWith('COMMIT')));

  const failedPool = makePool();
  const failed = new ShopeeAnalyticsRepository({ pool: failedPool });
  await assert.rejects(
    () => failed.saveGmsDay({ shopId: 1770037299, campaignId: 164499732, eventDate: '2026-09-18', campaign: { raw: {} }, items: [], adPromotionRepository: { saveWithItems: async () => { throw new Error('unified failure'); } }, env }),
    /unified failure/,
  );
  assert(failedPool.queries.some(sql => String(sql).startsWith('ROLLBACK')));
  console.log('formal GMS unified contract tests: ok');
})().catch(error => { console.error(error); process.exitCode = 1; });
