'use strict';

const { createAnalyticsPool } = require('../src/pg');
const { createSyncRuntime } = require('../src/sync-runtime');
const { ShopeeShopProfileRepository } = require('../src/shop-profile-repository');
const { runBackfillShop } = require('../src/backfill-runner');
const { parseSources, isoDate } = require('../src/backfill-utils');
const { parseCampaignIds } = require('../src/sync-cycle-utils');

function parseIdFilter(value) {
  return new Set(
    String(value || '')
      .split(',')
      .map(part => Number(part.trim()))
      .filter(Number.isSafeInteger),
  );
}

async function main() {
  if (process.env.SHOPEE_ANALYTICS_ENABLE_BACKFILL !== 'YES') {
    throw new Error(
      'Refusing historical backfill. Set SHOPEE_ANALYTICS_ENABLE_BACKFILL=YES explicitly.',
    );
  }

  const globalStartDate = process.env.SHOPEE_BACKFILL_START_DATE
    ? isoDate(process.env.SHOPEE_BACKFILL_START_DATE, 'SHOPEE_BACKFILL_START_DATE')
    : null;
  const endDate = isoDate(process.env.SHOPEE_BACKFILL_END_DATE, 'SHOPEE_BACKFILL_END_DATE');

  const sources = parseSources(process.env.SHOPEE_BACKFILL_SOURCES);
  const countryFilter = String(process.env.SHOPEE_BACKFILL_COUNTRY || '').trim().toUpperCase();
  const brandFilter = String(process.env.SHOPEE_BACKFILL_BRAND || '').trim().toUpperCase();
  const shopIdFilter = parseIdFilter(process.env.SHOPEE_BACKFILL_SHOP_IDS);
  const globalGmsSeeds = parseCampaignIds(process.env.SHOPEE_GMS_CAMPAIGN_IDS);

  const pool = createAnalyticsPool();
  try {
    const profileRepository = new ShopeeShopProfileRepository({ pool });
    const runtime = createSyncRuntime({ pool });
    let shops = await profileRepository.list({ activeOnly: true });

    if (countryFilter) shops = shops.filter(shop => shop.countryCode === countryFilter);
    if (brandFilter) shops = shops.filter(shop => shop.brandCode === brandFilter);
    if (shopIdFilter.size) shops = shops.filter(shop => shopIdFilter.has(shop.shopId));

    if (!shops.length) throw new Error('No active shops matched the backfill filters');

    const summaries = [];
    for (const shop of shops) {
      const startDate = globalStartDate || shop.analyticsStartDate;
      if (!startDate) {
        throw new Error(
          `Shop ${shop.shopId} has no analyticsStartDate and SHOPEE_BACKFILL_START_DATE is not set`,
        );
      }
      if (startDate > endDate) {
        throw new Error(`Shop ${shop.shopId}: backfill start date must be <= end date`);
      }

      const summary = await runBackfillShop({
        runtime,
        shop,
        startDate,
        endDate,
        sources,
        seededGmsCampaignIds: globalGmsSeeds,
      });
      summaries.push(summary);
    }

    const failed = summaries.filter(summary => !summary.ok);
    const output = {
      mode: 'historical-backfill',
      globalStartDate,
      endDate,
      sources,
      shopCount: summaries.length,
      okShopCount: summaries.length - failed.length,
      failedShopCount: failed.length,
      summaries,
      limitations: [
        'Historical campaign membership is not fabricated from item-performance rows.',
        'Recommended ROI is current-state only unless prior snapshots already exist.',
        'Product/model attributes are current-state snapshots, not reconstructed historical values.',
        'Voucher/Discount history is limited by what Shopee still returns.',
        'Product Card remains an exact-period import until an item-level BI API is available.',
      ],
    };

    console.log(JSON.stringify(output, null, 2));
    if (failed.length) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
