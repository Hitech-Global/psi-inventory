'use strict';

const { createAnalyticsPool } = require('../src/pg');
const { createSyncRuntime } = require('../src/sync-runtime');
const { ENDPOINTS } = require('../src/catalog');
const { toShopeeDate, extractCampaignPerformance } = require('../src/sync-gms');
const { isPilotOAuthBootstrap, loadPilotIdentityConfig } = require('../src/deployment-mode');
const { safeError, sanitizeForPersistence } = require('../src/oauth-security');

function requiredIsoDate(name, env = process.env) {
  const value = String(env[name] || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${name} must be YYYY-MM-DD`);
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`${name} must be a valid YYYY-MM-DD date`);
  }
  return value;
}

function assertPilotDiscoveryAllowed(env = process.env) {
  if (!isPilotOAuthBootstrap(env)) {
    throw new Error('Pilot GMS discovery is allowed only during PILOT_GMV_MAX OAuth bootstrap with a blank campaign allowlist.');
  }
  if (env.SHOPEE_PILOT_DISCOVERY_ENABLE !== 'YES') {
    throw new Error('Refusing Pilot GMS discovery. Set SHOPEE_PILOT_DISCOVERY_ENABLE=YES only for the one-shot command.');
  }
  return loadPilotIdentityConfig(env);
}

async function discoverGmsCampaign({ client, shopId, accessToken, startDate, endDate }) {
  if (!client || typeof client.shopRequest !== 'function') throw new Error('client.shopRequest is required');
  if (!Number.isSafeInteger(Number(shopId)) || Number(shopId) <= 0) throw new Error('shopId must be a positive safe integer');
  if (!accessToken) throw new Error('accessToken is required');
  if (startDate > endDate) throw new Error('startDate must be <= endDate');

  const requestBody = {
    start_date: toShopeeDate(startDate),
    end_date: toShopeeDate(endDate),
  };
  const payload = await client.shopRequest({
    path: ENDPOINTS.adsGmsCampaignPerformance.path,
    shopId: Number(shopId),
    accessToken,
    method: ENDPOINTS.adsGmsCampaignPerformance.method,
    body: requestBody,
  });
  const performance = extractCampaignPerformance(payload);
  const campaignId = Number(performance.campaignId);
  if (!Number.isSafeInteger(campaignId) || campaignId <= 0) {
    throw new Error('Shopee GMS discovery did not return a valid campaign_id');
  }
  return { campaignId, performance, requestBody };
}

async function runPilotGmsDiscovery({ env = process.env, pool, createRuntime = createSyncRuntime } = {}) {
  if (!pool) throw new Error('pool is required');
  const identity = assertPilotDiscoveryAllowed(env);
  const startDate = requiredIsoDate('SHOPEE_PILOT_DISCOVERY_START_DATE', env);
  const endDate = requiredIsoDate('SHOPEE_PILOT_DISCOVERY_END_DATE', env);
  const runtime = createRuntime({ pool });
  const ads = runtime && runtime.roleClients && runtime.roleClients.ADS;
  if (!ads || typeof ads.getAccessToken !== 'function' || !ads.client) {
    throw new Error('ADS sync runtime client is unavailable');
  }

  // The shared runtime owns encrypted-token load and, if needed, its single refresh.
  // Discovery deliberately has no repository write path.
  const accessToken = await ads.getAccessToken(identity.shopId);
  if (!accessToken) throw new Error(`No ADS access token available for pilot shop ${identity.shopId}`);
  const result = await discoverGmsCampaign({
    client: ads.client,
    shopId: identity.shopId,
    accessToken,
    startDate,
    endDate,
  });
  const expected = Number(env.SHOPEE_PILOT_DISCOVERY_EXPECTED_CAMPAIGN_ID || 0);
  return {
    event: 'pilot-gms-discovery-result',
    shopId: identity.shopId,
    brand: identity.brand,
    startDate,
    endDate,
    campaignId: result.campaignId,
    expectedCampaignId: Number.isSafeInteger(expected) && expected > 0 ? expected : null,
    expectedCampaignMatches: Number.isSafeInteger(expected) && expected > 0 ? expected === result.campaignId : null,
    performance: {
      impressions: result.performance.impressions,
      clicks: result.performance.clicks,
      expense: result.performance.expense,
      broadGmv: result.performance.broadGmv,
      broadOrders: result.performance.broadOrders,
      directGmv: result.performance.directGmv,
      directOrders: result.performance.directOrders,
      broadRoas: result.performance.broadRoas,
      directRoas: result.performance.directRoas,
    },
    persisted: false,
    next: 'Verify this campaign ID and metrics against Seller Centre before writing SHOPEE_PILOT_GMV_MAX_CAMPAIGN_IDS.',
  };
}

function safeDiscoveryError(error) {
  const safe = safeError(error, 'PILOT_GMS_DISCOVERY_FAILED');
  return { code: safe.code || 'PILOT_GMS_DISCOVERY_FAILED', message: sanitizeForPersistence(safe) };
}

async function main() {
  const pool = createAnalyticsPool();
  try {
    const result = await runPilotGmsDiscovery({ pool });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(JSON.stringify({ event: 'pilot-gms-discovery-failed', ...safeDiscoveryError(error) }));
    process.exitCode = 1;
  });
}

module.exports = {
  requiredIsoDate,
  assertPilotDiscoveryAllowed,
  discoverGmsCampaign,
  runPilotGmsDiscovery,
  safeDiscoveryError,
};
