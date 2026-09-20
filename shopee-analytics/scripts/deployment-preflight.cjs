'use strict';

const fs = require('fs');
const path = require('path');
const { createAnalyticsPool } = require('../src/pg');
const { APP_ENV, loadAppCredential } = require('../src/config');
const { loadMasterKey } = require('../src/token-crypto');
const { ShopeeShopProfileRepository } = require('../src/shop-profile-repository');
const { ShopeeTokenRepository } = require('../src/token-repository');
const { createConfiguredSkillProvider } = require('../src/openai-skill-provider');

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

async function main() {
  const checks = [];
  let pool;

  try {
    const key = loadMasterKey();
    checks.push(result('token_master_key', Buffer.isBuffer(key) && key.length === 32, '32-byte token encryption key loaded'));
  } catch (error) {
    checks.push(result('token_master_key', false, error.message));
  }

  for (const role of Object.keys(APP_ENV)) {
    try {
      const credential = loadAppCredential(role, { requireToken: false });
      checks.push(result(`partner_${role.toLowerCase()}`, Boolean(credential.partnerId && credential.partnerKey), 'Partner ID/key configured'));
    } catch (error) {
      checks.push(result(`partner_${role.toLowerCase()}`, false, error.message));
    }
  }

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
    checks.push(result('analytics_schema', tableCount >= 32, { tableCount, expectedMinimum: 32 }));

    if (tableCount >= 32) {
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
  if (inboxEnabled) {
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
    readyForPilot: blocking.length === 0 && warnings.length === 0,
    blockingCount: blocking.length,
    warningCount: warnings.length,
    checks,
    nextGate: blocking.length
      ? 'FIX_BLOCKING_PREFLIGHT'
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
