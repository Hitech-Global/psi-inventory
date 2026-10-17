'use strict';

const assert = require('assert');
const {
  PILOT_GMV_MAX,
  isPilotOAuthBootstrap,
  assertPilotOAuthAllowed,
  loadPilotGmvMaxConfig,
} = require('../src/deployment-mode');
const { validateDesktopEnv } = require('../src/desktop-env-validation');
const { runPilotOAuthBootstrapWorker } = require('../scripts/sync-scheduler.cjs');

const bootstrapEnv = {
  POSTGRES_DB: 'shopee_analytics',
  POSTGRES_USER: 'shopee',
  POSTGRES_PASSWORD: 'long-random',
  SHOPEE_TOKEN_MASTER_KEY: 'base64-key',
  SHOPEE_BACKUP_LOCAL_DIR: './runtime/backup-local',
  SHOPEE_NAS_BACKUP_DIR: './runtime/nas',
  SHOPEE_PRODUCT_CARD_INBOX_ENABLE: 'NO',
  SHOPEE_ANALYTICS_DEPLOYMENT_MODE: PILOT_GMV_MAX,
  SHOPEE_ADS_PARTNER_ID: 'ads-id',
  SHOPEE_ADS_PARTNER_KEY: 'ads-key',
  SHOPEE_PILOT_GMV_MAX_SHOP_ID: '1101364305',
  SHOPEE_PILOT_GMV_MAX_BRAND: 'REDRAGON',
  SHOPEE_PILOT_GMV_MAX_CAMPAIGN_IDS: '',
  SHOPEE_PILOT_SHOP_GMV_MAX_CAMPAIGN_IDS: '',
  SHOPEE_OAUTH_ENABLE: 'YES',
  SHOPEE_OAUTH_LIVE_REDIRECT_URL: 'https://auth.hitechanalysis.top/oauth/shopee/callback',
  SHOPEE_OAUTH_STATE_TTL_SECONDS: '600',
  SHOPEE_SYNC_RUN_ON_START: 'YES',
};

assert.strictEqual(isPilotOAuthBootstrap(bootstrapEnv), true);
assert.deepStrictEqual(assertPilotOAuthAllowed(bootstrapEnv), {
  shopId: 1101364305,
  brand: 'REDRAGON',
});
assert.throws(
  () => loadPilotGmvMaxConfig(bootstrapEnv),
  /SHOPEE_PILOT_GMV_MAX_CAMPAIGN_IDS requires one or more/,
);
assert.strictEqual(validateDesktopEnv(bootstrapEnv).ok, true);

const oauthDisabled = validateDesktopEnv({ ...bootstrapEnv, SHOPEE_OAUTH_ENABLE: 'NO' });
assert.strictEqual(oauthDisabled.ok, false);
assert(oauthDisabled.errors.some(error => error.includes('SHOPEE_PILOT_SHOP_GMV_MAX_CAMPAIGN_IDS')));

const malformedAllowlist = validateDesktopEnv({
  ...bootstrapEnv,
  SHOPEE_PILOT_SHOP_GMV_MAX_CAMPAIGN_IDS: '2001,not-a-campaign',
});
assert.strictEqual(malformedAllowlist.ok, false);
assert(malformedAllowlist.errors.some(error => error.includes('must contain only positive safe integer campaign IDs')));
assert.strictEqual(isPilotOAuthBootstrap({
  ...bootstrapEnv,
  SHOPEE_PILOT_SHOP_GMV_MAX_CAMPAIGN_IDS: '2001',
}), false);

(async () => {
  const queries = [];
  let ended = false;
  await runPilotOAuthBootstrapWorker({
    keepAlive: false,
    poolFactory: () => ({
      async query(sql) { queries.push(sql); },
      async end() { ended = true; },
    }),
  });
  assert.deepStrictEqual(queries, ['SELECT 1']);
  assert.strictEqual(ended, true);
  console.log('shopee pilot OAuth bootstrap tests: ok');
})().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
