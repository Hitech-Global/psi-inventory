'use strict';

const { createAnalyticsPool } = require('../src/pg');
const { createSyncRuntime } = require('../src/sync-runtime');
const { ShopeeShopProfileRepository } = require('../src/shop-profile-repository');
const { runShopSyncCycle } = require('../src/shop-sync-runner');
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
  if (process.env.SHOPEE_ANALYTICS_ENABLE_SYNC_ALL_SHOPS !== 'YES') {
    throw new Error('Refusing multi-shop sync. Set SHOPEE_ANALYTICS_ENABLE_SYNC_ALL_SHOPS=YES explicitly.');
  }

  const mode = process.argv[2] || 'hourly';
  if (!['hourly', 'daily'].includes(mode)) throw new Error('mode must be hourly or daily');

  const countryFilter = String(process.env.SHOPEE_SYNC_COUNTRY || '').trim().toUpperCase();
  const brandFilter = String(process.env.SHOPEE_SYNC_BRAND || '').trim().toUpperCase();
  const shopIdFilter = parseIdFilter(process.env.SHOPEE_SYNC_SHOP_IDS);
  const seededGmsCampaignIds = parseCampaignIds(process.env.SHOPEE_GMS_CAMPAIGN_IDS);

  const pool = createAnalyticsPool();
  try {
    const profileRepository = new ShopeeShopProfileRepository({ pool });
    const runtime = createSyncRuntime({ pool });
    let shops = await profileRepository.list({ activeOnly: true });

    if (countryFilter) shops = shops.filter(shop => shop.countryCode === countryFilter);
    if (brandFilter) shops = shops.filter(shop => shop.brandCode === brandFilter);
    if (shopIdFilter.size) shops = shops.filter(shop => shopIdFilter.has(shop.shopId));

    if (!shops.length) throw new Error('No active shops matched the sync filters');

    const summaries = [];
    for (const shop of shops) {
      const summary = await runShopSyncCycle({
        runtime,
        shop,
        mode,
        seededGmsCampaignIds,
      });
      summaries.push(summary);
    }

    const failed = summaries.filter(summary => !summary.ok);
    console.log(JSON.stringify({
      mode,
      shopCount: summaries.length,
      okShopCount: summaries.length - failed.length,
      failedShopCount: failed.length,
      summaries,
    }, null, 2));

    if (failed.length) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
