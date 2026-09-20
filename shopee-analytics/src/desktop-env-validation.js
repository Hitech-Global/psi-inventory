'use strict';

const fs = require('fs');
const path = require('path');

function isRealSecret(value) {
  const text = String(value || '').trim();
  return Boolean(
    text &&
    !/^CHANGE_/i.test(text) &&
    !/^REPLACE_/i.test(text) &&
    !/^EXAMPLE/i.test(text)
  );
}

function validateDesktopEnv(env) {
  const errors = [];
  const warnings = [];

  for (const name of ['POSTGRES_DB', 'POSTGRES_USER', 'POSTGRES_PASSWORD']) {
    if (!isRealSecret(env[name])) errors.push(`${name} is missing or still a placeholder`);
  }

  const port = Number(env.SHOPEE_ANALYTICS_HOST_PORT || 3090);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    errors.push('SHOPEE_ANALYTICS_HOST_PORT must be 1..65535');
  }

  if (!isRealSecret(env.SHOPEE_TOKEN_MASTER_KEY)) {
    errors.push('SHOPEE_TOKEN_MASTER_KEY is missing');
  }

  for (const role of ['ADS', 'STORE_OPS', 'ERP', 'BRAND_PORTAL']) {
    if (!isRealSecret(env[`SHOPEE_${role}_PARTNER_ID`])) {
      errors.push(`SHOPEE_${role}_PARTNER_ID is missing`);
    }
    if (!isRealSecret(env[`SHOPEE_${role}_PARTNER_KEY`])) {
      errors.push(`SHOPEE_${role}_PARTNER_KEY is missing`);
    }
  }

  const skillProvider = String(env.SHOPEE_SKILL_RUNTIME_PROVIDER || '').trim().toUpperCase();
  if (skillProvider && skillProvider !== 'OPENAI') {
    errors.push(`Unsupported SHOPEE_SKILL_RUNTIME_PROVIDER: ${skillProvider}`);
  }
  if (skillProvider === 'OPENAI' && !isRealSecret(env.SHOPEE_SKILL_OPENAI_API_KEY || env.OPENAI_API_KEY)) {
    errors.push('SHOPEE_SKILL_OPENAI_API_KEY is missing');
  }

  const dailyWindow = Number(env.SHOPEE_SKILL_DAILY_WINDOW_DAYS || 14);
  if (!Number.isSafeInteger(dailyWindow) || dailyWindow < 1 || dailyWindow > 90) {
    errors.push('SHOPEE_SKILL_DAILY_WINDOW_DAYS must be an integer from 1 to 90');
  }

  if (!env.SHOPEE_BACKUP_LOCAL_DIR) warnings.push('SHOPEE_BACKUP_LOCAL_DIR not configured');
  if (!env.SHOPEE_NAS_BACKUP_DIR) warnings.push('SHOPEE_NAS_BACKUP_DIR not configured');

  return { ok: errors.length === 0, errors, warnings };
}

module.exports = { isRealSecret, validateDesktopEnv };
