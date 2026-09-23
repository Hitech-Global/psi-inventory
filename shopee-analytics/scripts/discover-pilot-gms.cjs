'use strict';

const { createAnalyticsPool } = require('../src/pg');
const { loadMasterKey } = require('../src/token-crypto');
const { ShopeeTokenRepository } = require('../src/token-repository');
const { createRoleClient } = require('../src/client-factory');
const { ENDPOINTS } = require('../src/catalog');
const { toShopeeDate, extractCampaignPerformance } = require('../src/sync-gms');
const { isPilotOAuthBootstrap, loadPilotIdentityConfig } = require('../src/deployment-mode');

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

async function main() {
  const identity = assertPilotDiscoveryAllowed(process.env);
  const startDate = requiredIsoDate('SHOPEE_PILOT_DISCOVERY_START_DATE');
  const endDate = requiredIsoDate('SHOPEE_PILOT_DISCOVERY_END_DATE');
  const pool = createAnalyticsPool();
  try {
    const tokenRepository = new ShopeeTokenRepository({ pool, masterKey: loadMasterKey() });
    const token = await tokenRepository.load({ appRole: 'ADS', shopId: identity.shopId });
    if (!token || !token.accessToken) {
      throw new Error(`No encrypted ADS token found for pilot shop ${identity.shopId}. Complete OAuth first.`);
    }
    if (!(token.expiresAt instanceof Date) || Number.isNaN(token.expiresAt.getTime()) || token.expiresAt <= new Date()) {
      throw new Error('Pilot ADS access token is expired. Re-authorize before discovery; discovery will not refresh tokens.');
    }

    const ads = createRoleClient('ADS');
    const result = await discoverGmsCampaign({
      client: ads.client,
      shopId: identity.shopId,
      accessToken: token.accessToken,
      startDate,
      endDate,
    });
    const expected = Number(process.env.SHOPEE_PILOT_DISCOVERY_EXPECTED_CAMPAIGN_ID || 0);
    console.log(JSON.stringify({
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
    }, null, 2));
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

module.exports = { requiredIsoDate, assertPilotDiscoveryAllowed, discoverGmsCampaign };
