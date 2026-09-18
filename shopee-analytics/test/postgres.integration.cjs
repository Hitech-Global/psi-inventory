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
const { ShopeeShopProfileRepository } = require('../src/shop-profile-repository');
const { ShopeeShopRepository } = require('../src/shop-repository');
const { ShopeeCampaignRepository } = require('../src/campaign-repository');
const { ShopeeProductRepository } = require('../src/product-repository');

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

    await repository.saveGmsDay({
      shopId: 1,
      campaignId: 99,
      eventDate: '2026-08-01',
      campaign: {
        impressions: 10,
        clicks: 1,
        expense: 1000,
        broadGmv: 0,
        broadOrders: 0,
        directGmv: 0,
        directOrders: 0,
        raw: { source: 'historical-test' },
      },
      items: [{
        itemId: 999,
        impressions: 10,
        clicks: 1,
        expense: 1000,
        broadGmv: 0,
        broadOrders: 0,
        directGmv: 0,
        directOrders: 0,
        raw: { item_id: 999 },
      }],
      rawSnapshots: [],
    });
    const unknownHistoricalMembership = await repository.loadMembershipItemIds({
      shopId: 1,
      campaignId: 99,
      eventDate: '2026-08-01',
    });
    assert.deepStrictEqual(
      unknownHistoricalMembership,
      [],
      'item-performance rows must not be promoted to full historical membership',
    );

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

    const shopRepository = new ShopeeShopRepository({ pool });
    await shopRepository.upsert({
      requestedShopId: 1,
      shop: {
        shopId: 1,
        shopName: 'API Redragon ID',
        region: 'ID',
        status: 'NORMAL',
        raw: { shop_id: 1, shop_name: 'API Redragon ID' },
      },
    });

    const shopProfiles = new ShopeeShopProfileRepository({ pool });
    await shopProfiles.upsertMany([
      {
        shopId: 1,
        displayName: 'Redragon Indonesia',
        countryCode: 'ID',
        countryName: 'Indonesia',
        brandCode: 'REDRAGON',
        brandName: 'Redragon',
        currency: 'IDR',
        timezone: 'Asia/Jakarta',
        marketplaceRegion: 'ID',
        brandPortalTimezone: 'GMT+7',
        gmsCampaignSeedIds: [7001, 7002],
      },
      {
        shopId: 2,
        displayName: 'Redragon Thailand',
        countryCode: 'TH',
        countryName: 'Thailand',
        brandCode: 'REDRAGON',
        brandName: 'Redragon',
        currency: 'THB',
        timezone: 'Asia/Bangkok',
        marketplaceRegion: 'TH',
      },
    ]);

    await pool.query(
      `INSERT INTO shopee_shop_strategy_config
       (shop_id,ad_spend_ratio_limit,weekly_order_reference)
       VALUES (1,0.15,25),(2,0.20,25)
       ON CONFLICT (shop_id) DO UPDATE SET
        ad_spend_ratio_limit=EXCLUDED.ad_spend_ratio_limit,
        weekly_order_reference=EXCLUDED.weekly_order_reference`
    );

    await pool.query(
      `INSERT INTO shopee_shop_bi_daily
       (shop_id,event_date,sales,orders,units_sold,product_clicks,product_views,unique_visitors,
        item_conversion_rate,order_conversion_rate,voucher_sales,voucher_buyers,voucher_usage_rate,
        voucher_cir,voucher_cost)
       VALUES
       (1,'2026-09-17',1000000,10,11,200,500,150,0.05,0.04,200000,2,0.1,0.02,20000),
       (2,'2026-09-17',5000,5,6,100,250,80,0.05,0.04,1000,1,0.1,0.02,100)`
    );
    await pool.query(
      `INSERT INTO shopee_ad_campaign_daily
       (shop_id,campaign_id,event_date,impressions,clicks,expense,broad_gmv,broad_orders,broad_units,
        direct_gmv,direct_orders,direct_units)
       VALUES
       (2,8,'2026-09-17',500,15,500,3000,3,3,2500,2,2)
       ON CONFLICT DO NOTHING`
    );

    const campaignRepository = new ShopeeCampaignRepository({ pool });
    await campaignRepository.saveCampaignSettingsSnapshot({
      shopId: 1,
      observedAt: new Date('2026-09-17T00:00:00Z'),
      eventDate: '2026-09-17',
      settings: [{
        campaignId: 123,
        adType: 'auto',
        campaignStatus: 'ONGOING',
        biddingMethod: 'GMV_MAX',
        campaignBudget: 100000,
        targetRoas: 8.3,
        itemIds: [101, 102],
        raw: { v: 1 },
      }],
    });
    await campaignRepository.saveCampaignSettingsSnapshot({
      shopId: 1,
      observedAt: new Date('2026-09-17T01:00:00Z'),
      eventDate: '2026-09-17',
      settings: [{
        campaignId: 123,
        adType: 'auto',
        campaignStatus: 'ONGOING',
        biddingMethod: 'GMV_MAX',
        campaignBudget: 120000,
        targetRoas: 7.2,
        itemIds: [101, 103],
        raw: { v: 2 },
      }],
    });
    const campaignOps = await pool.query(
      `SELECT operation_type,item_id
       FROM shopee_operation_history
       WHERE shop_id=1 AND campaign_id=123
       ORDER BY id`,
    );
    assert(campaignOps.rows.some(row =>
      row.operation_type === 'CAMPAIGN_SETTING_CHANGE' && Number(row.item_id) === 101
    ));
    assert(campaignOps.rows.some(row =>
      row.operation_type === 'SKU_ADDED_TO_CAMPAIGN' && Number(row.item_id) === 103
    ));
    assert(campaignOps.rows.some(row =>
      row.operation_type === 'SKU_REMOVED_FROM_CAMPAIGN' && Number(row.item_id) === 102
    ));

    const productRepository = new ShopeeProductRepository({ pool });
    await productRepository.replaceModels({
      shopId: 1,
      itemId: 888,
      observedAt: new Date('2026-09-17T02:00:00Z'),
      models: [{
        modelId: 1,
        modelName: 'Black',
        modelSku: 'H888-BLK',
        currentPrice: 399000,
        originalPrice: 499000,
        stock: 10,
        raw: {},
      }],
    });
    await productRepository.replaceModels({
      shopId: 1,
      itemId: 888,
      observedAt: new Date('2026-09-17T03:00:00Z'),
      models: [{
        modelId: 1,
        modelName: 'Black',
        modelSku: 'H888-BLK',
        currentPrice: 379000,
        originalPrice: 499000,
        stock: 8,
        raw: {},
      }],
    });
    const priceOps = await pool.query(
      `SELECT operation_type,before_json,after_json
       FROM shopee_operation_history
       WHERE shop_id=1 AND item_id=888
       ORDER BY id`,
    );
    assert.strictEqual(priceOps.rows.length, 1);
    assert.strictEqual(priceOps.rows[0].operation_type, 'PRICE_CHANGE');
    assert.strictEqual(Number(priceOps.rows[0].before_json.currentPrice), 399000);
    assert.strictEqual(Number(priceOps.rows[0].after_json.currentPrice), 379000);

    const queryRepository = new ShopeeQueryRepository({ pool });
    const shops = await queryRepository.listShops();
    assert.strictEqual(shops.length, 2);
    assert.strictEqual(shops[0].countryCode, 'ID');
    assert.strictEqual(shops[0].brandPortalTimezone, 'GMT+7');
    assert.strictEqual(shops[0].apiShopName, 'API Redragon ID');
    assert.strictEqual(shops[1].currency, 'THB');

    const portfolio = await queryRepository.getPortfolioOverview({
      startDate: '2026-09-17',
      endDate: '2026-09-17',
    });
    assert.strictEqual(portfolio.shops.length, 2);
    assert.strictEqual(portfolio.dimensions.multiCurrency, true);
    assert.deepStrictEqual(portfolio.dimensions.currencies, ['IDR', 'THB']);
    assert.strictEqual(portfolio.currencyGroups.length, 2);
    assert.strictEqual(portfolio.businessGroups.length, 2);
    assert(portfolio.businessGroups.some(group =>
      group.countryCode === 'ID' && group.brandCode === 'REDRAGON' && group.currency === 'IDR'
    ));
    assert.strictEqual(portfolio.totals.orders, 15);
    assert(!Object.prototype.hasOwnProperty.call(portfolio.totals, 'sales'));
    const idPortfolioShop = portfolio.shops.find(shop => shop.shopId === 1);
    assert.strictEqual(idPortfolioShop.estimatedNaturalSales, 300000);
    assert.strictEqual(idPortfolioShop.adSpendRatioLimit, 0.15);
    assert(Math.abs(idPortfolioShop.adGmvShareOfBiSales - 0.7) < 1e-12);
    const thPortfolioShop = portfolio.shops.find(shop => shop.shopId === 2);
    assert.strictEqual(thPortfolioShop.adSpendRatioLimit, 0.20);

    const idOnly = await queryRepository.getPortfolioOverview({
      startDate: '2026-09-17',
      endDate: '2026-09-17',
      countryCode: 'ID',
    });
    assert.strictEqual(idOnly.shops.length, 1);
    assert.strictEqual(idOnly.shops[0].currency, 'IDR');

    const trend = await queryRepository.getShopDailyTrend({
      shopId: 1,
      startDate: '2026-09-17',
      endDate: '2026-09-17',
    });
    assert.strictEqual(trend.length, 1);
    assert.strictEqual(trend[0].sales, 1000000);
    assert.strictEqual(trend[0].adExpense, 100000);
    assert.strictEqual(trend[0].estimatedNaturalSales, 300000);
    assert(Math.abs(trend[0].clickToOrder - 0.05) < 1e-12);

    const skuApiOnly = await queryRepository.getShopSkuOverview({
      shopId: 1,
      startDate: '2026-09-17',
      endDate: '2026-09-17',
    });
    assert.strictEqual(skuApiOnly.length, 1);
    assert.strictEqual(skuApiOnly[0].itemId, 101);
    assert.strictEqual(skuApiOnly[0].adExpense, 80000);
    assert.strictEqual(skuApiOnly[0].hasProductCard, false);

    const skuWithProductCard = await queryRepository.getShopSkuOverview({
      shopId: 1,
      startDate: '2026-09-01',
      endDate: '2026-09-07',
    });
    assert.strictEqual(skuWithProductCard.length, 1);
    assert.strictEqual(skuWithProductCard[0].totalSales, 800000);
    assert.strictEqual(skuWithProductCard[0].hasProductCard, true);

    const backfillCoverage = await queryRepository.getBackfillCoverage({
      shopId: 1,
      startDate: '2026-09-17',
      endDate: '2026-09-17',
      timezone: 'Asia/Jakarta',
    });
    assert.strictEqual(backfillCoverage.campaignDayRows, 1);
    assert.strictEqual(backfillCoverage.campaignCount, 1);
    assert.strictEqual(backfillCoverage.gmsDistinctDays, 1);
    assert.strictEqual(backfillCoverage.shopBiDays, 1);

    await repository.markSyncSuccess({
      appRole: 'ADS',
      endpointKey: 'BACKFILL_ORDERS_TEST',
      shopId: 1,
      cursor: {
        requestedStartDate: '2026-09-01',
        requestedEndDate: '2026-09-17',
        completedThrough: '2026-09-14',
      },
    });
    const backfillState = await repository.getSyncState({
      appRole: 'ADS',
      endpointKey: 'BACKFILL_ORDERS_TEST',
      shopId: 1,
    });
    assert.strictEqual(backfillState.cursor.completedThrough, '2026-09-14');

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
