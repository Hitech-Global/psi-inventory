'use strict';

const assert = require('assert');
const express = require('express');
const { createShopeeAnalyticsRouter } = require('../src/http-router');
const { assertFormalGmsPilotScope } = require('../src/deployment-mode');

const header = 'Sequence,Ad / Product Name,Status,Ads Type,Product ID,Bidding Method,Start Date,End Date,Impression,Clicks,CTR,Conversions,Direct Conversions,Conversion Rate,Direct Conversion Rate,Cost per Conversion,Cost per Direct Conversion,Items Sold,Direct Items Sold,GMV,Direct GMV,Expense,ROAS,Direct ROAS,ACOS,Direct ACOS,Voucher Amount,Vouchered Sales';
const csv = `Ad Group - Shopee Indonesia\nShop Name,Scope Fixture Shop\nShop ID,1101364305\nDate Period,11/09/2026 - 11/09/2026\n\n${header}\n1,Same Name,Ongoing,Product Ad,-,GMV Max Custom ROAS,28/08/2026 00:00:00,Unlimited,100,10,10%,2,2,20%,20%,5,5,2,2,1000,900,100,10,9,10%,11%,0,0\n2,Product With Shared ID,-,Product Ad,41529544105,-,-,-,100,10,10%,2,2,20%,20%,5,5,2,2,1000,900,100,10,9,10%,11%,0,0\n`;

async function startApp() {
  const writes = [];
  const scopes = new Map([[1101364305, { shopId: 1101364305, oauthAuthorized: false, dataSourceCapability: 'MANUAL_IMPORT' }]]);
  const adPromotionRepository = {
    async withTransaction(fn) { return fn({ transaction: true }); },
    async saveWithItems(row, items, { queryable } = {}) { writes.push({ row, items, queryable }); return { promotionKey: row.promotionKey }; },
  };
  const shopScopeRepository = {
    async list() { return Array.from(scopes.values()); },
    async find(shopId) { return scopes.get(Number(shopId)) || null; },
    async registerImportOnly({ shopId, importSourceShopName, countryCode, brandCode }) {
      if (!countryCode || !brandCode) throw new Error('country/brand required');
      const scope = { shopId: Number(shopId), oauthAuthorized: false, active: true, dataSourceCapability: 'MANUAL_IMPORT', importSourceShopName, countryCode, brandCode };
      scopes.set(scope.shopId, scope); return scope;
    },
  };
  const app = express();
  app.use('/api', createShopeeAnalyticsRouter({
    repository: {}, strategyRepository: {}, queryRepository: {}, adPromotionRepository, shopScopeRepository,
  }));
  app.use((error, req, res, next) => {
    res.status(error.status || 500).json({ error: error.code || 'INTERNAL_ERROR', message: error.message });
  });
  const server = await new Promise(resolve => {
    const value = app.listen(0, '127.0.0.1', () => resolve(value));
  });
  return { base: `http://127.0.0.1:${server.address().port}/api`, writes, scopes, close: () => new Promise(resolve => server.close(resolve)) };
}

async function post(base, suffix) {
  const response = await fetch(`${base}${suffix}`, {
    method: 'POST', headers: { 'content-type': 'text/csv' }, body: csv,
  });
  return { response, body: await response.json() };
}

(async () => {
  const runtime = await startApp();
  try {
    const noTargetPreview = await post(runtime.base, '/ad-groups/import?filename=fixture.csv');
    assert.strictEqual(noTargetPreview.response.status, 422);
    assert.strictEqual(noTargetPreview.body.error, 'TARGET_SHOP_REQUIRED');
    assert.strictEqual(runtime.writes.length, 0, 'a target-less preview must never write');

    const mismatchPreview = await post(runtime.base, '/ad-groups/import?filename=fixture.csv&target_shop_id=1770037299');
    assert.strictEqual(mismatchPreview.response.status, 409);
    assert.strictEqual(mismatchPreview.body.error, 'SHOP_SCOPE_MISMATCH');
    assert.strictEqual(runtime.writes.length, 0, 'a mismatch preview must never write');

    const preview = await post(runtime.base, '/ad-groups/import?filename=fixture.csv&target_shop_id=1101364305');
    assert.strictEqual(preview.response.status, 200);
    assert.strictEqual(preview.body.persisted, false);
    assert.strictEqual(preview.body.sourceShopId, 1101364305);
    assert.strictEqual(preview.body.sourceShopName, 'Scope Fixture Shop');
    assert.strictEqual(preview.body.reportSource, 'SHOPEE_AD_GROUP_EXPORT');
    assert.strictEqual(preview.body.targetShopId, 1101364305);
    assert.strictEqual(preview.body.shopScope, 'MATCH');
    assert.strictEqual(runtime.writes.length, 0, 'preview must never write');

    const missingTarget = await post(runtime.base, '/ad-groups/import?filename=fixture.csv&confirm=YES');
    assert.strictEqual(missingTarget.response.status, 422);
    assert.strictEqual(missingTarget.body.error, 'TARGET_SHOP_REQUIRED');
    assert.strictEqual(runtime.writes.length, 0, 'no OAuth/default target is permitted');

    const mismatch = await post(runtime.base, '/ad-groups/import?filename=fixture.csv&confirm=YES&target_shop_id=1770037299');
    assert.strictEqual(mismatch.response.status, 409);
    assert.strictEqual(mismatch.body.error, 'SHOP_SCOPE_MISMATCH');
    assert.strictEqual(runtime.writes.length, 0, 'mismatch must have zero parent/item writes');

    const allowed = await post(runtime.base, '/ad-groups/import?filename=fixture.csv&confirm=YES&target_shop_id=1101364305');
    assert.strictEqual(allowed.response.status, 201);
    assert.strictEqual(allowed.body.persisted, true);
    assert.strictEqual(runtime.writes.length, 1, 'matching import-only scope may persist its parent and items');
    assert.strictEqual(runtime.writes[0].row.shopId, 1101364305);
    assert.strictEqual(runtime.writes[0].items[0].itemId, 41529544105);
    assert(runtime.writes[0].queryable.transaction, 'parent/items must use one transaction');

    const secondShop = await fetch(`${runtime.base}/shop-scopes/import-only`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ shopId: 1101364306, importSourceShopName: 'Another CSV Shop', countryCode: 'ID', brandCode: 'REDRAGON' }),
    });
    assert.strictEqual(secondShop.status, 201);
    assert.strictEqual((await secondShop.json()).shopScope.oauthAuthorized, false);

    const discovery = await post(runtime.base, '/ad-groups/import?filename=fixture.csv&target_shop_id=1770037299&preview_only=YES');
    assert.strictEqual(discovery.response.status, 200);
    assert.strictEqual(discovery.body.shopScope, 'MISMATCH');
    assert.strictEqual(discovery.body.persisted, false);
    assert.strictEqual(runtime.writes.length, 1, 'discovery preview must not write');

    assert.throws(() => assertFormalGmsPilotScope({ shopId: 1101364305, campaignId: 1, env: {
      SHOPEE_ANALYTICS_DEPLOYMENT_MODE: 'PILOT_GMV_MAX', SHOPEE_PILOT_GMV_MAX_SHOP_ID: '1770037299',
      SHOPEE_PILOT_GMV_MAX_BRAND: 'REDRAGON', SHOPEE_PILOT_SHOP_GMV_MAX_CAMPAIGN_IDS: '1',
    } }), /refuses shop 1101364305/, 'an import-only shop cannot enter formal API sync');
    console.log('ad group import scope tests: ok');
  } finally { await runtime.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
