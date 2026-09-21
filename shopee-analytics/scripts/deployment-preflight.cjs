'use strict';

const fs = require('fs');
const path = require('path');
const { createAnalyticsPool } = require('../src/pg');
const { APP_ENV, loadAppCredential } = require('../src/config');
const { loadMasterKey } = require('../src/token-crypto');
const { ShopeeShopProfileRepository } = require('../src/shop-profile-repository');
const { ShopeeTokenRepository } = require('../src/token-repository');
const { createConfiguredSkillProvider } = require('../src/openai-skill-provider');
const {
  PRODUCTION,
  OFFLINE_BASELINE,
  PILOT_GMV_MAX,
  resolveDeploymentMode,
  loadPilotGmvMaxConfig,
  validatePilotProfileCampaignSeeds,
} = require('../src/deployment-mode');

function result(name, ok, detail, severity = 'error') {
  return { name, ok, severity: ok ? 'info' : severity, detail };
}

function canReadDir(dir) {
  try {
    fs.accessSync(dir, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function offlineBaselineConfigurationErrors(env = process.env) {
  const errors = [];
  for (const role of Object.keys(APP_ENV)) {
    for (const suffix of ['PARTNER_ID', 'PARTNER_KEY']) {
      const name = `SHOPEE_${role}_${suffix}`;
      if (String(env[name] || '').trim()) errors.push(`${name} must be empty`);
    }
  }
  for (const name of ['SHOPEE_SKILL_RUNTIME_PROVIDER', 'SHOPEE_SKILL_OPENAI_API_KEY', 'OPENAI_API_KEY']) {
    if (String(env[name] || '').trim()) errors.push(`${name} must be empty`);
  }
  if (env.SHOPEE_SYNC_RUN_ON_START === 'YES') errors.push('SHOPEE_SYNC_RUN_ON_START must not be YES');
  if (env.SHOPEE_PRODUCT_CARD_INBOX_ENABLE === 'YES') {
    errors.push('SHOPEE_PRODUCT_CARD_INBOX_ENABLE must not be YES');
  }
  return errors;
}

async function main() {
  const checks = [];
  let pool;
  let deploymentMode = PRODUCTION;
  try {
    deploymentMode = resolveDeploymentMode();
    checks.push(result('deployment_mode', true, deploymentMode));
  } catch (error) {
    checks.push(result('deployment_mode', false, error.message));
  }
  const offlineBaseline = deploymentMode === OFFLINE_BASELINE;
  const pilotGmvMax = deploymentMode === PILOT_GMV_MAX;
  let pilotConfig = null;
  if (pilotGmvMax) {
    try {
      pilotConfig = loadPilotGmvMaxConfig();
      checks.push(result('pilot_gmv_max_configuration', true, {
        shopId: pilotConfig.shopId,
        brand: pilotConfig.brand,
        campaignCount: pilotConfig.campaignIds.length,
      }));
    } catch (error) {
      checks.push(result('pilot_gmv_max_configuration', false, error.message));
    }
  }
  if (offlineBaseline) {
    const errors = offlineBaselineConfigurationErrors();
    checks.push(result(
      'offline_baseline_configuration',
      errors.length === 0,
      errors.length ? errors : 'No Partner, OpenAI, scheduler-start, or Product Card configuration enabled',
    ));
  }

  try {
    const key = loadMasterKey();
    checks.push(result('token_master_key', Buffer.isBuffer(key) && key.length === 32, '32-byte token encryption key loaded'));
  } catch (error) {
    checks.push(result('token_master_key', false, error.message));
  }

  if (offlineBaseline) {
    checks.push(result(
      'shopee_sync',
      true,
      'OFFLINE_BASELINE: Shopee sync entry points are disabled',
    ));
  } else if (pilotGmvMax) {
    try {
      const credential = loadAppCredential('ADS', { requireToken: false });
      checks.push(result('partner_ads', Boolean(credential.partnerId && credential.partnerKey), 'Partner ID/key configured'));
    } catch (error) {
      checks.push(result('partner_ads', false, error.message));
    }
    checks.push(result('pilot_role_scope', true, 'PILOT_GMV_MAX initializes ADS only'));
  } else {
    for (const role of Object.keys(APP_ENV)) {
      try {
        const credential = loadAppCredential(role, { requireToken: false });
        checks.push(result(`partner_${role.toLowerCase()}`, Boolean(credential.partnerId && credential.partnerKey), 'Partner ID/key configured'));
      } catch (error) {
        checks.push(result(`partner_${role.toLowerCase()}`, false, error.message));
      }
    }
  }

  if (offlineBaseline) {
    checks.push(result('skill_runtime', true, 'OFFLINE_BASELINE: Skill Runtime is disabled'));
  } else {
    try {
      const provider = createConfiguredSkillProvider();
      if (provider) {
        checks.push(result('skill_runtime', true, {
          provider: String(process.env.SHOPEE_SKILL_RUNTIME_PROVIDER || '').toUpperCase(),
          model: process.env.SHOPEE_SKILL_OPENAI_MODEL || 'gpt-5.6-terra',
          dailyWindowDays: Number(process.env.SHOPEE_SKILL_DAILY_WINDOW_DAYS || 14),
          secret: 'configured',
        }));
      } else {
        checks.push(result(
          'skill_runtime',
          true,
          'Provider not configured; Skill report generation remains fail-closed until explicitly enabled',
        ));
      }
    } catch (error) {
      checks.push(result('skill_runtime', false, error.message));
    }
  }

  try {
    pool = createAnalyticsPool();
    const db = await pool.query('SELECT current_database() AS database, current_user AS user, version() AS version');
    checks.push(result('postgres_connection', true, {
      database: db.rows[0].database,
      user: db.rows[0].user,
      version: String(db.rows[0].version).split(',')[0],
    }));

    const schema = await pool.query(
      `SELECT count(*)::int AS count
       FROM information_schema.tables
       WHERE table_schema='public' AND table_name LIKE 'shopee_%'`,
    );
    const tableCount = Number(schema.rows[0].count);
    checks.push(result('analytics_schema', tableCount >= 33, { tableCount, expectedMinimum: 33 }));

    if (tableCount >= 33 && pilotGmvMax) {
      const profileRepo = new ShopeeShopProfileRepository({ pool });
      const tokenRepo = new ShopeeTokenRepository({ pool, masterKey: loadMasterKey() });
      const shops = await profileRepo.list({ activeOnly: true });
      const shop = pilotConfig && shops.find(row => Number(row.shopId) === pilotConfig.shopId &&
        String(row.countryCode || '').toUpperCase() === 'ID' &&
        String(row.brandCode || '').trim().toUpperCase() === pilotConfig.brand.toUpperCase());
      checks.push(result('pilot_shop_isolation', Boolean(shop), {
        expectedShopId: pilotConfig && pilotConfig.shopId,
        activeShopCount: shops.length,
      }));
      try {
        const seedIds = shop ? validatePilotProfileCampaignSeeds(shop, pilotConfig) : [];
        checks.push(result('pilot_campaign_seed_scope', Boolean(shop), {
          profileSeedIds: seedIds,
          canonicalAllowlist: pilotConfig && pilotConfig.campaignIds,
        }));
      } catch (error) {
        checks.push(result('pilot_campaign_seed_scope', false, error.message));
      }
      let adsToken = null;
      if (shop) adsToken = await tokenRepo.load({ appRole: 'ADS', shopId: shop.shopId });
      checks.push(result('encrypted_ads_token', Boolean(adsToken), {
        shopId: shop && shop.shopId,
        role: 'ADS',
      }));
    } else if (tableCount >= 33 && !offlineBaseline) {
      const profileRepo = new ShopeeShopProfileRepository({ pool });
      const tokenRepo = new ShopeeTokenRepository({
        pool,
        masterKey: loadMasterKey(),
      });
      const shops = await profileRepo.list({ activeOnly: true });
      checks.push(result('active_shops', shops.length > 0, { count: shops.length }, 'warning'));

      const tokenSummary = [];
      for (const shop of shops) {
        const roles = [];
        for (const role of Object.keys(APP_ENV)) {
          try {
            const token = await tokenRepo.load({ appRole: role, shopId: shop.shopId });
            if (token) roles.push(role);
          } catch (error) {
            roles.push(`${role}:ERROR`);
          }
        }
        tokenSummary.push({ shopId: shop.shopId, displayName: shop.displayName, roles });
      }
      const complete = shops.length > 0 && tokenSummary.every(row => row.roles.length === Object.keys(APP_ENV).length);
      checks.push(result('encrypted_shop_tokens', complete, tokenSummary, 'warning'));
    }
  } catch (error) {
    checks.push(result('postgres_connection', false, error.message));
  } finally {
    if (pool) await pool.end().catch(() => {});
  }

  const inboxEnabled = process.env.SHOPEE_PRODUCT_CARD_INBOX_ENABLE === 'YES';
  if (offlineBaseline) {
    checks.push(result('product_card_inbox', !inboxEnabled, 'OFFLINE_BASELINE: Product Card import is disabled'));
  } else if (pilotGmvMax) {
    checks.push(result('product_card_inbox', !inboxEnabled, 'PILOT_GMV_MAX: Product Card import is disabled'));
  } else if (inboxEnabled) {
    const inbox = process.env.SHOPEE_PRODUCT_CARD_INBOX_DIR;
    checks.push(result(
      'product_card_inbox',
      Boolean(inbox && canReadDir(inbox)),
      inbox || 'SHOPEE_PRODUCT_CARD_INBOX_DIR missing',
      'warning',
    ));
  } else {
    checks.push(result('product_card_inbox', true, 'disabled until first deployment acceptance'));
  }

  const backupFile = process.env.SHOPEE_BACKUP_STATUS_FILE;
  if (backupFile) {
    checks.push(result(
      'backup_status_path',
      fs.existsSync(path.dirname(backupFile)),
      backupFile,
      'warning',
    ));
  }

  const blocking = checks.filter(row => !row.ok && row.severity === 'error');
  const warnings = checks.filter(row => !row.ok && row.severity === 'warning');
  const report = {
    generatedAt: new Date().toISOString(),
    deploymentMode,
    readyForPilot: !offlineBaseline && blocking.length === 0 && warnings.length === 0,
    readyForBaseline: offlineBaseline && blocking.length === 0,
    readyForGmvMaxPilot: pilotGmvMax && blocking.length === 0 && warnings.length === 0,
    blockingCount: blocking.length,
    warningCount: warnings.length,
    checks,
    nextGate: blocking.length
      ? 'FIX_BLOCKING_PREFLIGHT'
      : offlineBaseline
        ? 'OFFLINE_BASELINE_READY_NO_SYNC_OR_SKILL_RUNTIME'
      : pilotGmvMax
        ? 'RUN_ONE_GMV_MAX_PILOT_SHOP_SYNC'
      : warnings.length
        ? 'CONFIGURE_SHOPS_AND_TOKENS'
        : 'RUN_ONE_PILOT_SHOP_SYNC_AND_SELLER_CENTRE_RECONCILIATION',
  };

  console.log(JSON.stringify(report, null, 2));
  if (blocking.length) process.exitCode = 2;
  else if (warnings.length) process.exitCode = 1;
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 2;
});

module.exports = { offlineBaselineConfigurationErrors };
