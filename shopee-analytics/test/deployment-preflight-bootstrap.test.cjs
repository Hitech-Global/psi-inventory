'use strict';

const assert = require('assert');
const { evaluatePilotPreflightStage } = require('../scripts/deployment-preflight.cjs');

const base = {
  SHOPEE_ANALYTICS_DEPLOYMENT_MODE: 'PILOT_GMV_MAX',
  SHOPEE_PILOT_GMV_MAX_SHOP_ID: '1101364305',
  SHOPEE_PILOT_GMV_MAX_BRAND: 'REDRAGON',
  SHOPEE_PILOT_GMV_MAX_CAMPAIGN_IDS: '',
  SHOPEE_PILOT_SHOP_GMV_MAX_CAMPAIGN_IDS: '',
  SHOPEE_PILOT_INDIVIDUAL_AD_CAMPAIGN_IDS: '',
  SHOPEE_OAUTH_ENABLE: 'YES',
  SHOPEE_OAUTH_LIVE_REDIRECT_URL: 'https://auth.hitechanalysis.top/oauth/shopee/callback',
  SHOPEE_OAUTH_STATE_TTL_SECONDS: '600',
  SHOPEE_SYNC_RUN_ON_START: 'NO',
  SHOPEE_PRODUCT_CARD_INBOX_ENABLE: 'NO',
};

const configuredAds = () => ({ partnerId: 'configured-id', partnerKey: 'configured-key' });

const bootstrap = evaluatePilotPreflightStage(base, { adsCredentialProvider: configuredAds });
assert.strictEqual(bootstrap.stage, 'OAUTH_BOOTSTRAP');
assert.strictEqual(bootstrap.requiresProfileAndToken, false);
assert.deepStrictEqual(bootstrap.detail, {
  shopId: 1101364305,
  brand: 'REDRAGON',
  shopGmvMaxCampaignAllowlistBlank: true,
  individualAdCampaignAllowlistBlank: true,
  oauthEnabled: true,
  recurringSyncDisabled: true,
});

assert.throws(
  () => evaluatePilotPreflightStage({ ...base, SHOPEE_OAUTH_ENABLE: 'NO' }, { adsCredentialProvider: configuredAds }),
  /SHOPEE_PILOT_SHOP_GMV_MAX_CAMPAIGN_IDS requires one or more/,
);
assert.throws(
  () => evaluatePilotPreflightStage(base, { adsCredentialProvider: () => ({ partnerId: '', partnerKey: '' }) }),
  /SHOPEE_ADS_PARTNER_ID and SHOPEE_ADS_PARTNER_KEY are required/,
);
assert.throws(
  () => evaluatePilotPreflightStage({ ...base, SHOPEE_OAUTH_LIVE_REDIRECT_URL: '' }, { adsCredentialProvider: configuredAds }),
  /SHOPEE_OAUTH_LIVE_REDIRECT_URL is required/,
);
assert.throws(
  () => evaluatePilotPreflightStage({ ...base, SHOPEE_SYNC_RUN_ON_START: 'YES' }, { adsCredentialProvider: configuredAds }),
  /SHOPEE_SYNC_RUN_ON_START must not be YES/,
);

const fullPilot = evaluatePilotPreflightStage({ ...base, SHOPEE_PILOT_SHOP_GMV_MAX_CAMPAIGN_IDS: '2001' });
assert.strictEqual(fullPilot.stage, 'GMV_MAX_READY');
assert.strictEqual(fullPilot.requiresProfileAndToken, true);
assert.deepStrictEqual(fullPilot.pilotConfig.campaignIds, [2001]);

console.log('shopee deployment preflight OAuth bootstrap tests: ok');
