'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { resolvePilotTypedCampaignAllowlist, assertFormalGmsPilotScope } = require('../src/deployment-mode');

const configure = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'configure-shops.cjs'), 'utf8');
const profiles = fs.readFileSync(path.join(__dirname, '..', 'src', 'shop-profile-repository.js'), 'utf8');
const preflight = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'deployment-preflight.cjs'), 'utf8');

assert(configure.includes("process.argv.includes('--api-authorized')"), 'configure-shops must expose explicit API-authorized mode');
assert(configure.includes('registerApiAuthorized'), 'explicit mode must use token-gated registration');
assert(profiles.includes("app_role='ADS' AND shop_id=$1"), 'registration must require a matching ADS token');
assert(profiles.includes("import_source_shop_name=NULL"), 'operator registration must clear any claimed source name');
assert(profiles.includes("'API_AND_MANUAL'"), 'API registration must record API-capable scope');
assert(!preflight.includes('String(row.brandCode || \'\').trim().toUpperCase() === pilotConfig.brand.toUpperCase()'), 'preflight must not block source-metadata-null API profiles by brand');

const env = {
  SHOPEE_ANALYTICS_DEPLOYMENT_MODE: 'PILOT_GMV_MAX',
  SHOPEE_PILOT_GMV_MAX_SHOP_ID: '1770037299',
  SHOPEE_PILOT_GMV_MAX_BRAND: 'REDRAGON',
  SHOPEE_PILOT_SHOP_GMV_MAX_CAMPAIGN_IDS: '164499732',
  SHOPEE_PILOT_INDIVIDUAL_AD_CAMPAIGN_IDS: '',
};
assert.deepStrictEqual(resolvePilotTypedCampaignAllowlist('SHOP_GMV_MAX', env), [164499732]);
assert.deepStrictEqual(resolvePilotTypedCampaignAllowlist('INDIVIDUAL_AD', env), []);
assert.throws(
  () => assertFormalGmsPilotScope({ shopId: 1101364305, campaignId: 164499732, env }),
  /refuses shop 1101364305/,
  'an import-only shop cannot enter the API pilot scope',
);
console.log('shopee API-authorized shop registration tests: ok');
