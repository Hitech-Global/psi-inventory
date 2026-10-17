'use strict';

const { createAnalyticsPool } = require('../src/pg');
const { createSyncRuntime } = require('../src/sync-runtime');
const { ShopeeShopProfileRepository } = require('../src/shop-profile-repository');
const { runShopSyncCycle } = require('../src/shop-sync-runner');
const { ensureAutomaticHistory } = require('../src/history-repair');
const { parseCampaignIds } = require('../src/sync-cycle-utils');
const {
  assertOnlineOperationAllowed,
  isPilotGmvMax,
  loadPilotShopGmvMaxSyncConfig,
  validatePilotProfileCampaignSeeds,
} = require('../src/deployment-mode');

function parseIdFilter(value) {
  return new Set(
    String(value || '')
      .split(',')
      .map(part => part.trim())
      .filter(Boolean)
      .map(Number)
      .filter(value => Number.isSafeInteger(value) && value > 0),
  );
}

function selectPilotShop(shops, pilotConfig) {
  const matches = (shops || []).filter(shop => Number(shop.shopId) === pilotConfig.shopId &&
    String(shop.brandCode || '').trim().toUpperCase() === pilotConfig.brand.toUpperCase());
  if (matches.length !== 1) throw new Error('PILOT_GMV_MAX requires exactly one matching active shop profile');
  validatePilotProfileCampaignSeeds(matches[0], pilotConfig);
  return matches;
}

function selectProductionApiShops(shops) {
  const skippedShops = [];
  const eligible = [];
  for (const shop of shops || []) {
    if (!shop.oauthAuthorized) skippedShops.push({ shopId: shop.shopId, reason: 'NO_ADS_TOKEN' });
    else if (!shop.timezone) skippedShops.push({ shopId: shop.shopId, reason: 'NO_TIMEZONE' });
    else eligible.push(shop);
  }
  return { shops: eligible, skippedShops };
}
function resolveSeededGmsCampaignIds({ shop, pilot, pilotConfig, globalGmsSeeds }) {
  if (pilot) {
    validatePilotProfileCampaignSeeds(shop, pilotConfig);
    return pilotConfig.campaignIds;
  }
  return Array.from(new Set([
    ...(globalGmsSeeds || []),
    ...(shop.gmsCampaignSeedIds || []),
  ]));
}

async function main() {
  assertOnlineOperationAllowed('Shopee multi-shop sync');
  if (process.env.SHOPEE_ANALYTICS_ENABLE_SYNC_ALL_SHOPS !== 'YES') {
    throw new Error('Refusing multi-shop sync. Set SHOPEE_ANALYTICS_ENABLE_SYNC_ALL_SHOPS=YES explicitly.');
  }

  const mode = process.argv[2] || 'hourly';
  if (!['hourly', 'daily'].includes(mode)) throw new Error('mode must be hourly or daily');

  const countryFilter = String(process.env.SHOPEE_SYNC_COUNTRY || '').trim().toUpperCase();
  const brandFilter = String(process.env.SHOPEE_SYNC_BRAND || '').trim().toUpperCase();
  const shopIdFilter = parseIdFilter(process.env.SHOPEE_SYNC_SHOP_IDS);
  const pilot = isPilotGmvMax();
  const pilotConfig = loadPilotShopGmvMaxSyncConfig();
  const seededGmsCampaignIds = pilot
    ? pilotConfig.campaignIds
    : parseCampaignIds(process.env.SHOPEE_GMS_CAMPAIGN_IDS);

  const pool = createAnalyticsPool();
  try {
    const profileRepository = new ShopeeShopProfileRepository({ pool });
    const runtime = createSyncRuntime({ pool });
    let shops = await profileRepository.list({ activeOnly: true });

    let skippedShops = [];
    if (pilot) {
      shops = selectPilotShop(shops, pilotConfig);
    } else {
      const productionSelection = selectProductionApiShops(shops);
      shops = productionSelection.shops;
      skippedShops = productionSelection.skippedShops;
      if (countryFilter) shops = shops.filter(shop => shop.countryCode === countryFilter);
      if (brandFilter) shops = shops.filter(shop => shop.brandCode === brandFilter);
      if (shopIdFilter.size) shops = shops.filter(shop => shopIdFilter.has(shop.shopId));
    }

    if (!shops.length) {
      console.log(JSON.stringify({ mode, shopCount: 0, okShopCount: 0, failedShopCount: 0, skippedShops }, null, 2));
      return;
    }

    const summaries = [];
    for (const shop of shops) {
      const shopGmsSeeds = resolveSeededGmsCampaignIds({
        shop,
        pilot,
        pilotConfig,
        globalGmsSeeds: seededGmsCampaignIds,
      });
      const summary = await runShopSyncCycle({
        runtime,
        shop,
        mode,
        seededGmsCampaignIds: shopGmsSeeds,
      });
      if (!pilot) {
        try {
          summary.historyRepair = await ensureAutomaticHistory({
            runtime,
            profileRepository,
            shop,
            seededGmsCampaignIds: shopGmsSeeds,
          });
          if (!summary.historyRepair.ok) summary.ok = false;
        } catch (error) {
          summary.historyRepair = {
            ok: false,
            error: error && error.message ? error.message : String(error),
          };
          summary.ok = false;
        }
      }
      summaries.push(summary);
    }

    const failed = summaries.filter(summary => !summary.ok);
    console.log(JSON.stringify({
      mode,
      shopCount: summaries.length,
      okShopCount: summaries.length - failed.length,
      failedShopCount: failed.length,
      skippedShops,
      summaries,
    }, null, 2));

    if (failed.length) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = { parseIdFilter, selectPilotShop, selectProductionApiShops, resolveSeededGmsCampaignIds, main };
