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
const { ShopeeOAuthStateRepository } = require('../src/oauth-state-repository');
const { ShopeeQueryRepository } = require('../src/query-repository');
const { ShopeeShopProfileRepository } = require('../src/shop-profile-repository');
const { ShopeeShopRepository } = require('../src/shop-repository');
const { ShopeeCampaignRepository } = require('../src/campaign-repository');
const { ShopeeProductRepository } = require('../src/product-repository');
const { ShopeePromotionRepository } = require('../src/promotion-repository');
const { ShopeeStrategyRepository } = require('../src/strategy-repository');
const { ShopeeAdPromotionRepository } = require('../src/ad-promotion-repository');
const { ShopeeShopScopeRepository } = require('../src/shop-scope-repository');

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
      'shopee_oauth_states',
      'shopee_vouchers',
      'shopee_returns',
      'shopee_ad_promotion_daily',
      'shopee_ad_promotion_item_daily',
    ]) {
      assert(names.has(expected), `missing table ${expected}`);
    }
    assert.strictEqual(names.size, 35, 'schema must expose exactly 35 shopee_* tables');

    const repository = new ShopeeAnalyticsRepository({ pool });
    const unifiedPromotionRepository = new ShopeeAdPromotionRepository({ pool });
    await unifiedPromotionRepository.saveWithItems({
      shopId: 1, promotionKey: 'MANUAL_IMPORT:group:example', periodStart: '2026-09-11', periodEnd: '2026-09-17', granularity: 'RANGE', eventDate: '2026-09-11', promotionType: 'AD_GROUP', dataSource: 'MANUAL_IMPORT', campaignName: 'Example group', impressions: 10, clicks: 1, expense: 5, orders: 1, gmv: 20, sourceRoas: 4, ctr: 0.1, cvr: 1, itemCount: 2, dataQualityStatus: 'COMPLETE', qualityFlags: [], raw: {},
    }, [{ itemId: 101, expense: 5, orders: 1, gmv: 20, dataQualityStatus: 'COMPLETE', qualityFlags: [], raw: {} }, { itemId: 102, expense: null, orders: null, gmv: null, dataQualityStatus: 'PARTIAL', qualityFlags: [], raw: {} }]);
    const unifiedRows = await unifiedPromotionRepository.list({ shopId: 1, startDate: '2026-09-01', endDate: '2026-09-30' });
    assert.strictEqual(unifiedRows.length, 1);
    assert.strictEqual(unifiedRows[0].period_start.toISOString().slice(0, 10), '2026-09-11');
    assert.strictEqual(unifiedRows[0].period_end.toISOString().slice(0, 10), '2026-09-17');

    // A complete manual Ad Group report persists parents/items in one outer
    // transaction. Repeating the identical report replaces deterministic rows.
    const adGroupShopId = 990177003;
    const adGroupEntries = [
      { key: 'MANUAL_IMPORT:group:ad-group-1:2026-09-22', name: 'Ad Group 1', impressions: 778, clicks: 33, orders: 1, gmv: 98, expense: 8.10, sourceRoas: 12.10, directGmv: 98, directRoas: 12.10, itemCount: 7 },
      { key: 'MANUAL_IMPORT:group:ad-group-2:2026-09-22', name: 'Ad Group 2', impressions: 442, clicks: 16, orders: 0, gmv: 0, expense: 2.76, sourceRoas: 0, directGmv: 0, directRoas: 0, itemCount: 6 },
    ];
    const persistAdGroupFixture = async () => unifiedPromotionRepository.withTransaction(async queryable => {
      for (let index = 0; index < adGroupEntries.length; index += 1) {
        const entry = adGroupEntries[index];
        const itemCount = entry.itemCount;
        const items = Array.from({ length: itemCount }, (_, itemIndex) => ({
          itemId: 990100000 + (index * 100) + itemIndex, productName: `Fixture ${index}-${itemIndex}`, impressions: 1, clicks: 0,
          expense: 0, orders: 0, gmv: 0, sourceRoas: 0, directGmv: 0, directRoas: 0,
          dataQualityStatus: 'COMPLETE', qualityFlags: [], raw: {},
        }));
        if (index === 0) Object.assign(items[0], { itemId: 50157527763, impressions: 82, clicks: 6, expense: 0.63, orders: 1, gmv: 98, sourceRoas: 155.94, directGmv: 98, directRoas: 155.94 });
        await unifiedPromotionRepository.saveWithItems({
          shopId: adGroupShopId, promotionKey: entry.key, periodStart: '2026-09-22', periodEnd: '2026-09-22', granularity: 'DAY',
          promotionType: 'AD_GROUP', dataSource: 'MANUAL_IMPORT', campaignName: entry.name, impressions: entry.impressions, clicks: entry.clicks,
          expense: entry.expense, orders: entry.orders, gmv: entry.gmv, targetRoas: null, estimatedRoas: null, sourceRoas: entry.sourceRoas,
          directGmv: entry.directGmv, directRoas: entry.directRoas, itemCount, dataQualityStatus: 'COMPLETE', qualityFlags: [], raw: {},
        }, items, { queryable });
      }
    });
    await persistAdGroupFixture();
    await persistAdGroupFixture();
    const adGroupCounts = await pool.query(
      `SELECT
         (SELECT count(*) FROM shopee_ad_promotion_daily WHERE shop_id=$1 AND promotion_type='AD_GROUP') AS daily_count,
         (SELECT count(*) FROM shopee_ad_promotion_item_daily WHERE shop_id=$1) AS item_count`,
      [adGroupShopId],
    );
    assert.deepStrictEqual(adGroupCounts.rows[0], { daily_count: '2', item_count: '13' }, 'repeat import must remain idempotent');
    const mappedAdGroup = await pool.query(
      `SELECT target_roas,estimated_roas,source_roas,direct_gmv,direct_roas
       FROM shopee_ad_promotion_daily WHERE shop_id=$1 AND promotion_key=$2`,
      [adGroupShopId, adGroupEntries[0].key],
    );
    assert.deepStrictEqual(mappedAdGroup.rows[0], { target_roas: null, estimated_roas: null, source_roas: '12.100000', direct_gmv: '98.000000', direct_roas: '12.100000' });
    const mappedItem = await pool.query(
      `SELECT source_roas,direct_gmv,direct_roas FROM shopee_ad_promotion_item_daily
       WHERE shop_id=$1 AND item_id=50157527763`,
      [adGroupShopId],
    );
    assert.deepStrictEqual(mappedItem.rows[0], { source_roas: '155.940000', direct_gmv: '98.000000', direct_roas: '155.940000' });
    await assert.rejects(() => unifiedPromotionRepository.withTransaction(async queryable => {
      await unifiedPromotionRepository.saveWithItems({
        shopId: adGroupShopId, promotionKey: 'MANUAL_IMPORT:group:rollback:2026-09-22', periodStart: '2026-09-22', periodEnd: '2026-09-22', granularity: 'DAY',
        promotionType: 'AD_GROUP', dataSource: 'MANUAL_IMPORT', campaignName: 'Rollback group', dataQualityStatus: 'COMPLETE', qualityFlags: [], raw: {},
      }, [], { queryable });
      throw new Error('fixture item persistence failure');
    }), /fixture item persistence failure/);
    const rollbackCount = await pool.query(`SELECT count(*) FROM shopee_ad_promotion_daily WHERE shop_id=$1 AND promotion_key='MANUAL_IMPORT:group:rollback:2026-09-22'`, [adGroupShopId]);
    assert.strictEqual(rollbackCount.rows[0].count, '0', 'a failed file transaction must roll back its parent row');
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
        // Shopee may provide direct ROI/orders while omitting direct GMV.
        directGmv: null,
        directRoas: 3.97,
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
        directGmv: null,
        directRoas: 3.97,
        directOrders: 3,
        raw: { item_id: 101 },
      }],
      membershipItemIds: [101, 102],
      rawSnapshots: [],
      adPromotionRepository: unifiedPromotionRepository,
    });

    const campaigns = await repository.loadCampaignDaily({
      shopId: 1,
      campaignId: 7,
      startDate: '2026-09-17',
      endDate: '2026-09-17',
    });
    assert.strictEqual(campaigns.length, 1);
    assert.strictEqual(Number(campaigns[0].broad_orders), 4);

    const gmsUnifiedRows = await unifiedPromotionRepository.list({ shopId: 1, startDate: '2026-09-17', endDate: '2026-09-17' });
    const gmsUnified = gmsUnifiedRows.find(row => Number(row.campaign_id) === 7);
    assert(gmsUnified, 'formal GMS must write a unified promotion row');
    assert.strictEqual(gmsUnified.promotion_type, 'SHOP_GMV_MAX');
    assert.strictEqual(gmsUnified.data_source, 'SHOPEE_API');
    assert.strictEqual(gmsUnified.direct_gmv, null);
    assert.strictEqual(Number(gmsUnified.direct_roas), 3.97);
    assert(gmsUnified.quality_flags.includes('SOURCE_DIRECT_GMV_MISSING'));

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

    const oauthStateRepo = new ShopeeOAuthStateRepository({ pool });
    const rawState = `raw-state-must-not-be-stored-${require('crypto').randomBytes(12).toString('hex')}`;
    const stateHash = require('crypto').createHash('sha256').update(rawState).digest('hex');
    const stateExpiresAt = new Date(Date.now() + 60_000);
    await oauthStateRepo.create({
      stateHash,
      appRole: 'ADS',
      expectedShopId: 1,
      redirectUri: 'https://oauth.example.com/oauth/shopee/callback',
      expiresAt: stateExpiresAt,
    });
    const rawStateRow = await pool.query('SELECT state_hash FROM shopee_oauth_states WHERE state_hash=$1', [stateHash]);
    assert.strictEqual(rawStateRow.rows[0].state_hash, stateHash);
    assert.notStrictEqual(rawStateRow.rows[0].state_hash, rawState);
    const consumes = await Promise.all([
      oauthStateRepo.consume({ stateHash, now: new Date() }),
      oauthStateRepo.consume({ stateHash, now: new Date() }),
    ]);
    assert.strictEqual(consumes.filter(Boolean).length, 1, 'OAuth state must be atomically consumed once');

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
        analyticsStartDate: '2026-05-01',
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

    const shopScopeRepository = new ShopeeShopScopeRepository({ pool });
    const importOnlyScope = await shopScopeRepository.registerImportOnly({
      shopId: 1101364305,
      importSourceShopName: 'CSV-only shop',
      countryCode: 'ID',
      brandCode: 'REDRAGON',
    });
    assert.strictEqual(importOnlyScope.shopId, 1101364305);
    assert.strictEqual(importOnlyScope.dataSourceCapability, 'MANUAL_IMPORT');
    assert.strictEqual(importOnlyScope.oauthAuthorized, false);
    assert.strictEqual(importOnlyScope.active, true);
    assert.strictEqual(importOnlyScope.countryCode, 'ID');
    const scopes = await shopScopeRepository.list();
    assert.strictEqual(scopes.find(scope => scope.shopId === 1).oauthAuthorized, true);
    assert.strictEqual(scopes.find(scope => scope.shopId === 1101364305).apiShopName, null);

    await pool.query(
      `INSERT INTO shopee_shop_strategy_config
       (shop_id,ad_spend_ratio_limit,weekly_order_reference)
       VALUES (1,0.15,25),(2,0.20,25)
       ON CONFLICT (shop_id) DO UPDATE SET
        ad_spend_ratio_limit=EXCLUDED.ad_spend_ratio_limit,
        weekly_order_reference=EXCLUDED.weekly_order_reference`
    );
    const strategyRepoForItems = new ShopeeStrategyRepository({ pool });
    await strategyRepoForItems.upsertItemBreakEven({
      shopId: 1,
      itemId: 101,
      breakEvenRoas: 5.7,
      note: 'integration',
    });

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

    const promotionRepository = new ShopeePromotionRepository({ pool });
    await promotionRepository.upsertVoucher({
      shopId: 1,
      observedAt: new Date('2026-09-17T04:00:00Z'),
      voucher: {
        voucherId: 500,
        voucherCode: 'V10',
        voucherName: 'Voucher 10',
        voucherType: 2,
        rewardType: 1,
        startTime: 1758067200,
        endTime: 1758672000,
        percentage: 10,
        discountAmount: null,
        maxPrice: 50000,
        minBasketPrice: 100000,
        usageQuantity: 100,
        currentUsage: 0,
        isAdmin: false,
        itemIds: [101],
        raw: {},
      },
    });
    await promotionRepository.upsertVoucher({
      shopId: 1,
      observedAt: new Date('2026-09-17T05:00:00Z'),
      voucher: {
        voucherId: 500,
        voucherCode: 'V12',
        voucherName: 'Voucher 12',
        voucherType: 2,
        rewardType: 1,
        startTime: 1758067200,
        endTime: 1758672000,
        percentage: 12,
        discountAmount: null,
        maxPrice: 50000,
        minBasketPrice: 100000,
        usageQuantity: 100,
        currentUsage: 1,
        isAdmin: false,
        itemIds: [101, 102],
        raw: {},
      },
    });
    const voucherOps = await pool.query(
      `SELECT operation_type,item_id
       FROM shopee_operation_history
       WHERE shop_id=1 AND operation_type='VOUCHER_CHANGE'
       ORDER BY item_id`,
    );
    assert(voucherOps.rows.some(row => Number(row.item_id) === 101));
    assert(voucherOps.rows.some(row => Number(row.item_id) === 102));

    await promotionRepository.upsertDiscount({
      shopId: 1,
      observedAt: new Date('2026-09-17T06:00:00Z'),
      discount: {
        discountId: 600,
        discountName: 'Payday',
        status: 'ongoing',
        startTime: 1758067200,
        endTime: 1758672000,
        source: 0,
        itemRows: [{
          itemId: 101,
          modelId: 1,
          originalPrice: 399000,
          promotionPrice: 359000,
          promotionStock: 100,
          raw: {},
        }],
        raw: {},
      },
    });
    await promotionRepository.upsertDiscount({
      shopId: 1,
      observedAt: new Date('2026-09-17T07:00:00Z'),
      discount: {
        discountId: 600,
        discountName: 'Payday',
        status: 'ongoing',
        startTime: 1758067200,
        endTime: 1758672000,
        source: 0,
        itemRows: [{
          itemId: 101,
          modelId: 1,
          originalPrice: 399000,
          promotionPrice: 349000,
          promotionStock: 95,
          raw: {},
        }],
        raw: {},
      },
    });
    const discountOps = await pool.query(
      `SELECT operation_type,item_id,before_json,after_json
       FROM shopee_operation_history
       WHERE shop_id=1 AND operation_type='DISCOUNT_CHANGE'
       ORDER BY id`,
    );
    assert.strictEqual(discountOps.rows.length, 1);
    assert.strictEqual(Number(discountOps.rows[0].item_id), 101);
    assert.strictEqual(
      Number(discountOps.rows[0].after_json.itemRows[0].promotionPrice),
      349000,
    );

    const queryRepository = new ShopeeQueryRepository({ pool });
    const shops = await queryRepository.listShops();
    assert.strictEqual(shops.length, 3, 'active import-only shops must remain visible to analytics');
    const idShop = shops.find(shop => shop.shopId === 1);
    const thShop = shops.find(shop => shop.shopId === 2);
    const importOnlyShop = shops.find(shop => shop.shopId === 1101364305);
    assert.strictEqual(idShop.countryCode, 'ID');
    assert.strictEqual(idShop.brandPortalTimezone, 'GMT+7');
    assert.strictEqual(idShop.analyticsStartDate, '2026-05-01');
    assert.strictEqual(idShop.apiShopName, 'API Redragon ID');
    assert.strictEqual(thShop.currency, 'THB');
    assert.strictEqual(importOnlyShop.dataSourceCapability, 'MANUAL_IMPORT');
    assert.strictEqual(importOnlyShop.oauthAuthorized, false);

    const portfolio = await queryRepository.getPortfolioOverview({
      startDate: '2026-09-17',
      endDate: '2026-09-17',
    });
    assert.strictEqual(portfolio.shops.length, 3);
    assert.strictEqual(portfolio.dimensions.multiCurrency, true);
    assert.deepStrictEqual(portfolio.dimensions.currencies, ['IDR', 'THB', null]);
    assert.strictEqual(portfolio.currencyGroups.length, 3);
    assert.strictEqual(portfolio.businessGroups.length, 3);
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
    assert.strictEqual(idOnly.shops.length, 2);
    assert.strictEqual(idOnly.shops.find(shop => shop.shopId === 1).currency, 'IDR');

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
    assert.strictEqual(skuApiOnly[0].breakEvenRoas, 5.7);
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
    assert.strictEqual(backfillCoverage.membershipSnapshotDays, 1);
    assert.strictEqual(backfillCoverage.productCardPeriodRows, 0);

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

    const operationTimeline = await queryRepository.getItemTimeline({
      shopId: 1,
      itemId: 101,
      startDate: '2026-09-17',
      endDate: '2026-09-17',
    });
    assert(operationTimeline.some(row => row.type === 'CAMPAIGN_SETTING_CHANGE'));
    assert(operationTimeline.some(row => row.type === 'VOUCHER_CHANGE'));
    assert(operationTimeline.some(row => row.type === 'DISCOUNT_CHANGE'));

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

    await tokenRepo.save({
      appRole: 'ADS', shopId: 3, accessToken: 'api-authorized-access', refreshToken: 'api-authorized-refresh',
      expiresAt: new Date('2026-09-18T10:00:00Z'),
    });
    const apiAuthorized = await shopProfiles.registerApiAuthorized({
      shopId: 3, operatorLabel: 'Operator-only label',
    });
    assert.strictEqual(apiAuthorized.active, true);
    assert.strictEqual(apiAuthorized.operatorLabel, 'Operator-only label');
    assert.strictEqual(apiAuthorized.apiShopName, null, 'operator label must not become an API source name');
    assert.strictEqual(apiAuthorized.countryCode, null);
    assert.strictEqual(apiAuthorized.currency, null);
    assert.strictEqual(apiAuthorized.timezone, null);
    await shopProfiles.registerApiAuthorized({ shopId: 3, operatorLabel: 'Updated operator label' });
    assert.strictEqual((await shopProfiles.list({ activeOnly: false })).find(shop => shop.shopId === 3).operatorLabel, 'Updated operator label');
    await assert.rejects(
      () => shopProfiles.registerApiAuthorized({ shopId: 4, operatorLabel: 'must fail' }),
      /No matching ADS OAuth token/,
    );

    console.log(`shopee PostgreSQL integration tests: ok (${names.size} analytics tables)`);
  } finally {
    await pool.end();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
