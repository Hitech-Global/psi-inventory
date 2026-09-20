'use strict';

const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  PRODUCTION,
  OFFLINE_BASELINE,
  resolveDeploymentMode,
  assertOnlineOperationAllowed,
} = require('../src/deployment-mode');
const { validateDesktopEnv } = require('../src/desktop-env-validation');
const { createSkillRuntime } = require('../src/skill-runtime');
const { runOfflineBaselineWorker } = require('../scripts/sync-scheduler.cjs');

const root = path.join(__dirname, '..', '..');
const baseEnv = {
  POSTGRES_DB: 'shopee_analytics',
  POSTGRES_USER: 'shopee',
  POSTGRES_PASSWORD: 'long-random',
  SHOPEE_TOKEN_MASTER_KEY: 'base64-key',
  SHOPEE_BACKUP_LOCAL_DIR: './runtime/backup-local',
  SHOPEE_NAS_BACKUP_DIR: './runtime/nas',
  SHOPEE_SYNC_RUN_ON_START: 'NO',
  SHOPEE_PRODUCT_CARD_INBOX_ENABLE: 'NO',
};

assert.strictEqual(resolveDeploymentMode({}), PRODUCTION);
assert.strictEqual(resolveDeploymentMode({ SHOPEE_ANALYTICS_DEPLOYMENT_MODE: '' }), PRODUCTION);
assert.strictEqual(
  resolveDeploymentMode({ SHOPEE_ANALYTICS_DEPLOYMENT_MODE: OFFLINE_BASELINE }),
  OFFLINE_BASELINE,
);
for (const invalid of ['offline_baseline', ' OFFLINE_BASELINE', 'OFFLINE_BASELINE ']) {
  assert.throws(
    () => resolveDeploymentMode({ SHOPEE_ANALYTICS_DEPLOYMENT_MODE: invalid }),
    /Unsupported SHOPEE_ANALYTICS_DEPLOYMENT_MODE/,
  );
}

const offline = validateDesktopEnv({
  ...baseEnv,
  SHOPEE_ANALYTICS_DEPLOYMENT_MODE: OFFLINE_BASELINE,
});
assert.strictEqual(offline.ok, true);

const offlineWithPartner = validateDesktopEnv({
  ...baseEnv,
  SHOPEE_ANALYTICS_DEPLOYMENT_MODE: OFFLINE_BASELINE,
  SHOPEE_ADS_PARTNER_KEY: 'must-not-be-present',
});
assert.strictEqual(offlineWithPartner.ok, false);
assert(offlineWithPartner.errors.some(row => row.includes('SHOPEE_ADS_PARTNER_ID and SHOPEE_ADS_PARTNER_KEY')));

const productionMissingPartner = validateDesktopEnv({ ...baseEnv });
assert.strictEqual(productionMissingPartner.ok, false);
assert(productionMissingPartner.errors.includes('SHOPEE_ADS_PARTNER_ID is missing'));
assert(productionMissingPartner.errors.includes('SHOPEE_BRAND_PORTAL_PARTNER_KEY is missing'));

assert.throws(
  () => assertOnlineOperationAllowed('test', { SHOPEE_ANALYTICS_DEPLOYMENT_MODE: OFFLINE_BASELINE }),
  /test is disabled in OFFLINE_BASELINE deployment mode/,
);

for (const script of [
  'shopee-analytics/scripts/sync-all-shops.cjs',
  'shopee-analytics/scripts/sync-readonly.cjs',
  'shopee-analytics/scripts/process-product-card-inbox.cjs',
  'shopee-analytics/scripts/import-product-card.cjs',
  'shopee-analytics/scripts/run-daily-skill-reports.cjs',
]) {
  const run = spawnSync(process.execPath, [path.join(root, script)], {
    env: {
      ...process.env,
      SHOPEE_ANALYTICS_DEPLOYMENT_MODE: OFFLINE_BASELINE,
      SHOPEE_ANALYTICS_ENABLE_SYNC_ALL_SHOPS: 'YES',
      SHOPEE_ANALYTICS_ENABLE_SYNC: 'YES',
      SHOPEE_PRODUCT_CARD_INBOX_ENABLE: 'YES',
      SHOPEE_ANALYTICS_IMPORT_PRODUCT_CARD: 'YES',
    },
    encoding: 'utf8',
  });
  assert.notStrictEqual(run.status, 0, `${script} must reject OFFLINE_BASELINE`);
  assert.match(`${run.stdout}\n${run.stderr}`, /disabled in OFFLINE_BASELINE deployment mode/);
}

(async () => {
  let queried = false;
  let ended = false;
  await runOfflineBaselineWorker({
    keepAlive: false,
    poolFactory: () => ({
      async query(sql) {
        queried = sql === 'SELECT 1';
      },
      async end() {
        ended = true;
      },
    }),
  });
  assert.strictEqual(queried, true);
  assert.strictEqual(ended, true);

  const originalMode = process.env.SHOPEE_ANALYTICS_DEPLOYMENT_MODE;
  process.env.SHOPEE_ANALYTICS_DEPLOYMENT_MODE = OFFLINE_BASELINE;
  try {
    const runtime = createSkillRuntime({ pool: { async query() { return { rows: [] }; } } });
    await assert.rejects(
      () => runtime.runSkillAnalysis({}),
      /Skill Runtime analysis is disabled in OFFLINE_BASELINE deployment mode/,
    );
  } finally {
    if (originalMode === undefined) delete process.env.SHOPEE_ANALYTICS_DEPLOYMENT_MODE;
    else process.env.SHOPEE_ANALYTICS_DEPLOYMENT_MODE = originalMode;
  }

  console.log('shopee offline baseline tests: ok');
})().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
