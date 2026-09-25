'use strict';

const { createAnalyticsPool } = require('../src/pg');
const { createSyncRuntime } = require('../src/sync-runtime');
const { fetchCampaignIds, fetchCampaignSettings, membershipFromSetting } = require('../src/sync-campaigns');
const { isPilotOAuthBootstrap, loadPilotIdentityConfig } = require('../src/deployment-mode');
const { safeError, sanitizeForPersistence } = require('../src/oauth-security');

const PRODUCT_ADS_PILOT_SHOP_ID = 1770037299;

function assertPilotProductAdsDiscoveryAllowed(env = process.env) {
  if (!isPilotOAuthBootstrap(env)) {
    throw new Error('Pilot Product Ads discovery is allowed only during PILOT_GMV_MAX OAuth bootstrap with a blank campaign allowlist.');
  }
  if (env.SHOPEE_PILOT_PRODUCT_ADS_DISCOVERY_ENABLE !== 'YES') {
    throw new Error('Refusing Pilot Product Ads discovery. Set SHOPEE_PILOT_PRODUCT_ADS_DISCOVERY_ENABLE=YES only for the one-shot command.');
  }
  const identity = loadPilotIdentityConfig(env);
  if (identity.shopId !== PRODUCT_ADS_PILOT_SHOP_ID) {
    throw new Error(`Pilot Product Ads discovery is restricted to shop ${PRODUCT_ADS_PILOT_SHOP_ID}.`);
  }
  return identity;
}

function provisionalEvidence(itemCount) {
  if (itemCount === 0) return 'NO_ITEM_MEMBERSHIP';
  if (itemCount === 1) return 'SINGLE_ITEM';
  return 'MULTI_ITEM';
}

function summarizeCampaign({ listed = {}, setting = null } = {}) {
  const raw = setting && setting.raw || {};
  const common = raw.common_info || {};
  const autoProducts = Array.isArray(raw.auto_product_ads_info) ? raw.auto_product_ads_info : [];
  const itemIds = setting ? membershipFromSetting(raw) : [];
  const campaignId = Number((setting && setting.campaignId) ?? listed.campaignId);
  if (!Number.isSafeInteger(campaignId) || campaignId <= 0) throw new Error('Shopee Product Ads discovery returned an invalid campaign ID');
  return {
    campaignId,
    // Preserve Shopee's source value. This is deliberately not a Seller Centre label.
    adType: setting && setting.adType !== null ? setting.adType : (listed.adType || null),
    adName: setting ? setting.adName : null,
    campaignStatus: setting ? setting.campaignStatus : null,
    biddingMethod: setting ? setting.biddingMethod : null,
    campaignPlacement: setting ? setting.campaignPlacement : null,
    campaignBudget: setting ? setting.campaignBudget : null,
    targetRoas: setting ? setting.targetRoas : null,
    itemCount: itemIds.length,
    itemIds,
    commonInfoItemIdListCount: Array.isArray(common.item_id_list) ? common.item_id_list.length : 0,
    autoProductAdsInfoCount: autoProducts.length,
    provisionalEvidence: provisionalEvidence(itemIds.length),
  };
}

async function discoverProductAdsCampaigns({ client, shopId, accessToken }) {
  if (!client || typeof client.shopRequest !== 'function') throw new Error('client.shopRequest is required');
  if (!Number.isSafeInteger(Number(shopId)) || Number(shopId) <= 0) throw new Error('shopId must be a positive safe integer');
  if (!accessToken) throw new Error('accessToken is required');

  const listed = await fetchCampaignIds({ client, shopId: Number(shopId), accessToken, adType: 'all' });
  const byId = new Map();
  for (const row of listed.rows) {
    const campaignId = Number(row.campaignId);
    if (Number.isSafeInteger(campaignId) && campaignId > 0 && !byId.has(campaignId)) byId.set(campaignId, row);
  }
  const settings = await fetchCampaignSettings({
    client,
    shopId: Number(shopId),
    accessToken,
    campaignIds: Array.from(byId.keys()),
  });
  const settingById = new Map(settings.rows.map(row => [Number(row.campaignId), row]));
  const campaigns = Array.from(byId.entries())
    .map(([campaignId, row]) => summarizeCampaign({ listed: row, setting: settingById.get(campaignId) || null }))
    .sort((a, b) => a.campaignId - b.campaignId);
  return {
    campaigns,
    listRequestCount: listed.rawPages.length,
    settingRequestCount: settings.rawPages.length,
  };
}

async function runPilotProductAdsDiscovery({ env = process.env, pool, createRuntime = createSyncRuntime } = {}) {
  if (!pool) throw new Error('pool is required');
  const identity = assertPilotProductAdsDiscoveryAllowed(env);
  const runtime = createRuntime({ pool });
  const ads = runtime && runtime.roleClients && runtime.roleClients.ADS;
  if (!ads || typeof ads.getAccessToken !== 'function' || !ads.client) {
    throw new Error('ADS sync runtime client is unavailable');
  }
  const accessToken = await ads.getAccessToken(identity.shopId);
  if (!accessToken) throw new Error(`No ADS access token available for pilot shop ${identity.shopId}`);
  const result = await discoverProductAdsCampaigns({ client: ads.client, shopId: identity.shopId, accessToken });
  return {
    event: 'pilot-product-ads-discovery-result',
    shopId: identity.shopId,
    brand: identity.brand,
    campaigns: result.campaigns,
    listRequestCount: result.listRequestCount,
    settingRequestCount: result.settingRequestCount,
    persisted: false,
    next: 'Verify API source classifications against Seller Centre before writing SHOPEE_PILOT_GMV_MAX_CAMPAIGN_IDS.',
  };
}

function safeProductAdsDiscoveryError(error) {
  const safe = safeError(error, 'PILOT_PRODUCT_ADS_DISCOVERY_FAILED');
  return { code: safe.code || 'PILOT_PRODUCT_ADS_DISCOVERY_FAILED', message: sanitizeForPersistence(safe) };
}

async function main() {
  const pool = createAnalyticsPool();
  try {
    console.log(JSON.stringify(await runPilotProductAdsDiscovery({ pool }), null, 2));
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(JSON.stringify({ event: 'pilot-product-ads-discovery-failed', ...safeProductAdsDiscoveryError(error) }));
    process.exitCode = 1;
  });
}

module.exports = {
  PRODUCT_ADS_PILOT_SHOP_ID,
  assertPilotProductAdsDiscoveryAllowed,
  provisionalEvidence,
  summarizeCampaign,
  discoverProductAdsCampaigns,
  runPilotProductAdsDiscovery,
  safeProductAdsDiscoveryError,
};
