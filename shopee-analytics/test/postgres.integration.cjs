'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const url = process.env.SHOPEE_ANALYTICS_TEST_DATABASE_URL;
if (!url) {
  console.log('shopee PostgreSQL integration tests: skipped (no SHOPEE_ANALYTICS_TEST_DATABASE_URL)');
  process.exit(0);
}

const { Pool } = require('pg');
const { ShopeeAnalyticsRepository } = require('../src/repository');
const { ShopeeProductCardRepository } = require('../src/product-card-repository');
const { ShopeeTokenRepository } = require('../src/token-repository');
const { ShopeeQueryRepository } = require('../src/query-repository');

(async () => {
  const pool = new Pool({ connectionString: url, max: 3 });
  try {
    const schema = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
    await pool.query(schema);

    const tables = await pool.query(
      `SELECT tablename FROM pg_tables
       WHERE schemaname='public' AND tablename LIKE 'shopee_%'`,
    );
    const names = new Set(tables.rows.map(row => row.tablename));
    for (const expected of [
      'shopee_ad_campaign_daily',
      'shopee_ad_item_daily',
      'shopee_product_card_period',
      'shopee_app_tokens',
      'shopee_vouchers',
      'shopee_returns',
    ]) {
      assert(names.has(expected), `missing table ${expected}`);
    }

    const repository = new ShopeeAnalyticsRepository({ pool });
    await repository.saveGmsDay({
      shopId: 1,
      campaignId: 7,
      eventDate: '2026-09-17',
      campaign: {
        impressions: 1000,
        clicks: 25,
        expense: 100000,
        broadGmv: 700000,
        broadOrders: 4,
        broadUnits: 4,
        directGmv: 600000,
        directOrders: 3,
        directUnits: 3,
        raw: { source: 'test' },
      },
      items: [{
        itemId: 101,
        impressions: 700,
        clicks: 20,
        expense: 80000,
        broadGmv: 600000,
        broadOrders: 3,
        directGmv: 550000,
        directOrders: 3,
        raw: { item_id: 101 },
      }],
      membershipItemIds: [101, 102],
      rawSnapshots: [],
    });

    const campaigns = await repository.loadCampaignDaily({
      shopId: 1,
      campaignId: 7,
      startDate: '2026-09-17',
      endDate: '2026-09-17',
    });
    assert.strictEqual(campaigns.length, 1);
    assert.strictEqual(Number(campaigns[0].broad_orders), 4);

    const membership = await repository.loadMembershipItemIds({
      shopId: 1,
      campaignId: 7,
      eventDate: '2026-09-17',
    });
    assert.deepStrictEqual(membership, [101, 102]);

    const productCard = new ShopeeProductCardRepository({ pool });
    await productCard.upsertPeriodRows({
      shopId: 1,
      rows: [{
        startDate: '2026-09-01',
        endDate: '2026-09-07',
        itemId: 101,
        itemName: 'H858',
        itemSku: 'H858',
        impressions: 1000,
        clicks: 50,
        ctr: 0.05,
        visitors: 40,
        orders: 4,
        units: 4,
        sales: 800000,
        conversionRate: 0.1,
        sourceFile: 'test.xlsx',
        raw: { test: true },
      }],
    });
    const pc = await pool.query(
      'SELECT sales,conversion_rate FROM shopee_product_card_period WHERE shop_id=1 AND item_id=101',
    );
    assert.strictEqual(Number(pc.rows[0].sales), 800000);
    assert.strictEqual(Number(pc.rows[0].conversion_rate), 0.1);

    const tokenRepo = new ShopeeTokenRepository({
      pool,
      masterKey: Buffer.alloc(32, 7),
    });
    await tokenRepo.save({
      appRole: 'ADS',
      shopId: 1,
      accessToken: 'access-secret',
      refreshToken: 'refresh-secret',
      expiresAt: new Date('2026-09-18T10:00:00Z'),
    });
    const rawToken = await pool.query(
      'SELECT token_blob FROM shopee_app_tokens WHERE app_role=$1 AND shop_id=$2',
      ['ADS', 1],
    );
    assert(!rawToken.rows[0].token_blob.includes('access-secret'));
    const decrypted = await tokenRepo.load({ appRole: 'ADS', shopId: 1 });
    assert.strictEqual(decrypted.accessToken, 'access-secret');
    assert.strictEqual(decrypted.refreshToken, 'refresh-secret');

    const queryRepository = new ShopeeQueryRepository({ pool });
    const coverage = await queryRepository.getCampaignCoverageContext({
      shopId: 1,
      campaignId: 7,
      startDate: '2026-09-17',
      endDate: '2026-09-17',
    });
    assert.strictEqual(coverage.membershipCount, 2);
    assert.strictEqual(coverage.performanceItemCount, 1);
    assert.strictEqual(coverage.storedItemCount, 1);
    assert.strictEqual(coverage.itemExpense, 80000);

    const status = await queryRepository.getSystemStatus({ shopId: 1 });
    assert(status.sources.some(source => source.source === 'GMS_ADS'));
    assert(status.sources.some(source => source.source === 'PRODUCT_CARD'));
    assert(status.tokens.some(token => token.appRole === 'ADS'));

    console.log(`shopee PostgreSQL integration tests: ok (${names.size} analytics tables)`);
  } finally {
    await pool.end();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
