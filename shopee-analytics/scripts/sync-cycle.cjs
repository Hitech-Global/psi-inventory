'use strict';

const { createAnalyticsPool } = require('../src/pg');
const { loadShopId } = require('../src/config');
const { ShopeeShopProfileRepository } = require('../src/shop-profile-repository');
const { createSyncRuntime } = require('../src/sync-runtime');
const { runShopSyncCycle } = require('../src/shop-sync-runner');
const { parseCampaignIds } = require('../src/sync-cycle-utils');
const { isPilotGmvMax, assertPilotShopAllowed } = require('../src/deployment-mode');

async function main() {
  if (process.env.SHOPEE_ANALYTICS_ENABLE_SYNC_CYCLE !== 'YES') {
    throw new Error('Refusing recurring sync cycle. Set SHOPEE_ANALYTICS_ENABLE_SYNC_CYCLE=YES explicitly.');
  }

  const mode = process.argv[2] || 'hourly';
  if (!['hourly', 'daily'].includes(mode)) throw new Error('sync-cycle mode must be hourly or daily');

  const shopId = loadShopId();
  const pilot = isPilotGmvMax();
  const pilotConfig = assertPilotShopAllowed(shopId);
  const pool = createAnalyticsPool();
  try {
    const profileRepository = new ShopeeShopProfileRepository({ pool });
    const profiles = await profileRepository.list({ activeOnly: false });
    let shop = profiles.find(profile => profile.shopId === shopId);

    if (!shop) {
      const timezone = process.env.SHOPEE_SHOP_TIMEZONE;
      if (!timezone) {
        throw new Error(
          `Shop ${shopId} has no configured profile and SHOPEE_SHOP_TIMEZONE is missing`,
        );
      }
      shop = {
        shopId,
        displayName: process.env.SHOPEE_SHOP_DISPLAY_NAME || `Shop ${shopId}`,
        countryCode: process.env.SHOPEE_SHOP_COUNTRY || null,
        brandCode: process.env.SHOPEE_SHOP_BRAND || null,
        timezone,
        brandPortalTimezone: process.env.SHOPEE_BI_TIMEZONE || null,
      };
    }

    if (pilot && (!shop || String(shop.countryCode || '').toUpperCase() !== 'ID' ||
      String(shop.brandCode || '').trim().toUpperCase() !== pilotConfig.brand.toUpperCase())) {
      throw new Error('PILOT_GMV_MAX requires a matching configured Indonesia shop profile');
    }
    const runtime = createSyncRuntime({ pool });
    const summary = await runShopSyncCycle({
      runtime,
      shop,
      mode,
      seededGmsCampaignIds: pilot
        ? pilotConfig.campaignIds
        : Array.from(new Set([
          ...parseCampaignIds(process.env.SHOPEE_GMS_CAMPAIGN_IDS),
          ...(shop.gmsCampaignSeedIds || []),
        ])),
    });

    console.log(JSON.stringify(summary, null, 2));
    if (!summary.ok) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
