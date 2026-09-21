'use strict';

const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  PILOT_GMV_MAX,
  PRODUCTION,
  rolesForDeploymentMode,
  assertRoleAllowed,
  loadPilotGmvMaxConfig,
  assertPilotShopAllowed,
  assertPilotCampaignAllowed,
} = require('../src/deployment-mode');
const { validateDesktopEnv } = require('../src/desktop-env-validation');
const { selectPilotShop } = require('../scripts/sync-all-shops.cjs');

const root = path.join(__dirname, '..', '..');
const pilotEnv = {
  POSTGRES_DB: 'shopee_analytics', POSTGRES_USER: 'shopee', POSTGRES_PASSWORD: 'long-random',
  SHOPEE_TOKEN_MASTER_KEY: 'base64-key', SHOPEE_BACKUP_LOCAL_DIR: './runtime/backup-local',
  SHOPEE_NAS_BACKUP_DIR: './runtime/nas', SHOPEE_PRODUCT_CARD_INBOX_ENABLE: 'NO',
  SHOPEE_ANALYTICS_DEPLOYMENT_MODE: PILOT_GMV_MAX,
  SHOPEE_ADS_PARTNER_ID: 'ads-id', SHOPEE_ADS_PARTNER_KEY: 'ads-key',
  SHOPEE_PILOT_GMV_MAX_SHOP_ID: '1101', SHOPEE_PILOT_GMV_MAX_BRAND: 'REDRAGON',
  SHOPEE_PILOT_GMV_MAX_CAMPAIGN_IDS: '2001,2002',
};

assert.strictEqual(validateDesktopEnv(pilotEnv).ok, true);
assert.deepStrictEqual(rolesForDeploymentMode({}), ['ADS', 'STORE_OPS', 'ERP', 'BRAND_PORTAL']);
assert.doesNotThrow(() => assertRoleAllowed('BRAND_PORTAL', { SHOPEE_ANALYTICS_DEPLOYMENT_MODE: PRODUCTION }));
assert.deepStrictEqual(rolesForDeploymentMode(pilotEnv), ['ADS']);
assert.throws(() => assertRoleAllowed('ERP', pilotEnv), /Shopee role ERP is disabled/);
const config = loadPilotGmvMaxConfig(pilotEnv);
assert.doesNotThrow(() => assertPilotShopAllowed(1101, pilotEnv));
assert.throws(() => assertPilotShopAllowed(1102, pilotEnv), /refuses shop 1102/);
assert.doesNotThrow(() => assertPilotCampaignAllowed(2001, pilotEnv));
assert.throws(() => assertPilotCampaignAllowed(2003, pilotEnv), /refuses campaign 2003/);
assert.deepStrictEqual(selectPilotShop([
  { shopId: 1101, countryCode: 'ID', brandCode: 'REDRAGON' },
  { shopId: 1102, countryCode: 'ID', brandCode: 'REDRAGON' },
], config), [{ shopId: 1101, countryCode: 'ID', brandCode: 'REDRAGON' }]);
assert.throws(() => selectPilotShop([{ shopId: 1102, countryCode: 'ID', brandCode: 'REDRAGON' }], config), /exactly one matching/);

for (const script of [
  ['shopee-analytics/scripts/sync-readonly.cjs', 'promotions'],
  ['shopee-analytics/scripts/process-product-card-inbox.cjs'],
  ['shopee-analytics/scripts/import-product-card.cjs'],
  ['shopee-analytics/scripts/backfill-all-shops.cjs'],
]) {
  const run = spawnSync(process.execPath, [path.join(root, script[0]), ...(script.slice(1))], {
    env: { ...process.env, ...pilotEnv, SHOPEE_ANALYTICS_ENABLE_SYNC: 'YES' }, encoding: 'utf8',
  });
  assert.notStrictEqual(run.status, 0, `${script[0]} must reject PILOT_GMV_MAX`);
  assert.match(`${run.stdout}\n${run.stderr}`, /disabled in PILOT_GMV_MAX deployment mode/);
}

const wrongShopCycle = spawnSync(process.execPath, [path.join(root, 'shopee-analytics/scripts/sync-cycle.cjs'), 'hourly'], {
  env: {
    ...process.env,
    ...pilotEnv,
    SHOPEE_ANALYTICS_ENABLE_SYNC_CYCLE: 'YES',
    SHOPEE_SHOP_ID: '1102',
  },
  encoding: 'utf8',
});
assert.notStrictEqual(wrongShopCycle.status, 0);
assert.match(`${wrongShopCycle.stdout}\n${wrongShopCycle.stderr}`, /refuses shop 1102/);

const outsideAllowlistGms = spawnSync(process.execPath, [path.join(root, 'shopee-analytics/scripts/sync-readonly.cjs'), 'gms'], {
  env: {
    ...process.env,
    ...pilotEnv,
    SHOPEE_ANALYTICS_ENABLE_SYNC: 'YES',
    SHOPEE_SHOP_ID: '1101',
    SHOPEE_GMS_CAMPAIGN_ID: '2003',
  },
  encoding: 'utf8',
});
assert.notStrictEqual(outsideAllowlistGms.status, 0);
assert.match(`${outsideAllowlistGms.stdout}\n${outsideAllowlistGms.stderr}`, /refuses campaign 2003/);

console.log('shopee GMV Max pilot tests: ok');
