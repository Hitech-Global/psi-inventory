'use strict';

const assert = require('assert');
const { resolvePilotTypedCampaignAllowlist, assertPilotTypedCampaignAllowed } = require('../src/deployment-mode');
const { gmsPromotionRow, individualPromotionRow, persistPilotGmsDay, persistPilotIndividualAdDay } = require('../src/unified-promotion-writers');

const env = { SHOPEE_ANALYTICS_DEPLOYMENT_MODE: 'PILOT_GMV_MAX', SHOPEE_PILOT_GMV_MAX_SHOP_ID: '1', SHOPEE_PILOT_GMV_MAX_BRAND: 'REDRAGON', SHOPEE_PILOT_SHOP_GMV_MAX_CAMPAIGN_IDS: '11', SHOPEE_PILOT_INDIVIDUAL_AD_CAMPAIGN_IDS: '22' };
assert.deepStrictEqual(resolvePilotTypedCampaignAllowlist('SHOP_GMV_MAX', env), [11]);
assert.deepStrictEqual(resolvePilotTypedCampaignAllowlist('INDIVIDUAL_AD', env), [22]);
assert.throws(() => assertPilotTypedCampaignAllowed('SHOP_GMV_MAX', 22, env), /independent allowlist/);
assert.throws(() => assertPilotTypedCampaignAllowed('INDIVIDUAL_AD', 11, env), /independent allowlist/);

const gms = gmsPromotionRow({ shopId: 1, campaignId: 11, eventDate: '2026-09-18', performance: { expense: 2, direct_roi: 3.97, direct_order: 1, broad_gmv: 8 } });
assert.strictEqual(gms.promotionType, 'SHOP_GMV_MAX'); assert.strictEqual(gms.raw.directGmv, null); assert(gms.qualityFlags.includes('SOURCE_DIRECT_GMV_MISSING'));
const individual = individualPromotionRow({ shopId: 1, campaign: { campaignId: 22, adType: 'manual', adName: 'one' }, eventDate: '2026-09-18', performance: { expense: 2, broad_gmv: 8 } });
assert.strictEqual(individual.promotionType, 'INDIVIDUAL_AD'); assert.strictEqual(individual.itemCount, 1);

(async () => {
  const saved = []; const repository = { saveWithItems: async (...args) => { saved.push(args); return { ok: true }; } };
  await persistPilotGmsDay({ repository, shopId: 1, campaignId: 11, eventDate: '2026-09-18', performance: { expense: 1 }, env });
  assert.strictEqual(saved.length, 1);
  await assert.rejects(() => persistPilotGmsDay({ repository, shopId: 1, campaignId: 22, eventDate: '2026-09-18', performance: {}, env }), /independent allowlist/);
  await persistPilotIndividualAdDay({ repository, shopId: 1, campaign: { campaignId: 22 }, eventDate: '2026-09-18', performance: {}, item: { itemId: 9 }, env });
  await assert.rejects(() => persistPilotIndividualAdDay({ repository, shopId: 1, campaign: { campaignId: 22 }, eventDate: '2026-09-18', performance: {}, item: { itemId: null }, env }), /exactly one valid item/);
  console.log('shopee unified promotion tests: ok');
})().catch(error => { console.error(error); process.exitCode = 1; });
