'use strict';

const assert = require('assert');
const { resolveShopIdForCommand } = require('../scripts/sync-readonly.cjs');
const { resolveShopIdForSyncCycle } = require('../scripts/sync-cycle.cjs');
const { assertFormalGmsPilotScope } = require('../src/deployment-mode');

const pilotEnv = {
  SHOPEE_ANALYTICS_DEPLOYMENT_MODE: 'PILOT_GMV_MAX',
  SHOPEE_PILOT_GMV_MAX_SHOP_ID: '1770037299',
  SHOPEE_PILOT_GMV_MAX_BRAND: 'REDRAGON',
  SHOPEE_PILOT_SHOP_GMV_MAX_CAMPAIGN_IDS: '164499732',
  SHOPEE_PILOT_INDIVIDUAL_AD_CAMPAIGN_IDS: '',
};

// The formal one-shot GMS entry derives its shop solely from pilot identity.
assert.strictEqual(resolveShopIdForCommand('gms', pilotEnv), 1770037299);
assert.strictEqual(resolveShopIdForCommand('gms', {
  ...pilotEnv,
  SHOPEE_SHOP_ID: '1101364305',
}), 1770037299);
assert.strictEqual(resolveShopIdForSyncCycle({
  ...pilotEnv,
  SHOPEE_SHOP_ID: '1101364305',
}), 1770037299);
assert.doesNotThrow(() => assertFormalGmsPilotScope({
  shopId: resolveShopIdForCommand('gms', pilotEnv),
  campaignId: 164499732,
  env: pilotEnv,
}));
assert.throws(() => assertFormalGmsPilotScope({
  shopId: resolveShopIdForCommand('gms', pilotEnv),
  campaignId: 999999999,
  env: pilotEnv,
}), /independent allowlist/);

// A malformed or missing pilot identity remains fail-closed; it cannot fall
// back to the legacy single-shop variable.
for (const env of [
  { ...pilotEnv, SHOPEE_PILOT_GMV_MAX_SHOP_ID: '' },
  { ...pilotEnv, SHOPEE_PILOT_GMV_MAX_SHOP_ID: 'not-a-shop' },
]) {
  assert.throws(() => resolveShopIdForCommand('gms', {
    ...env,
    SHOPEE_SHOP_ID: '1101364305',
  }), /SHOPEE_PILOT_GMV_MAX_SHOP_ID must be a positive safe integer/);
}

// Non-pilot and non-GMS paths retain the legacy explicit shop contract.
assert.strictEqual(resolveShopIdForCommand('gms', {
  SHOPEE_ANALYTICS_DEPLOYMENT_MODE: 'PRODUCTION',
  SHOPEE_SHOP_ID: '1101364305',
}), 1101364305);
assert.strictEqual(resolveShopIdForCommand('campaigns', {
  ...pilotEnv,
  SHOPEE_SHOP_ID: '1101364305',
}), 1101364305);
assert.throws(() => resolveShopIdForCommand('campaigns', pilotEnv), /Missing environment variable: SHOPEE_SHOP_ID/);

console.log('sync readonly pilot identity tests: ok');
