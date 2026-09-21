'use strict';

const fs = require('fs');
const path = require('path');
const {
  PRODUCTION,
  OFFLINE_BASELINE,
  PILOT_GMV_MAX,
  resolveDeploymentMode,
  resolvePilotCampaignAllowlist,
} = require('./deployment-mode');

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
  let deploymentMode = PRODUCTION;
  try {
    deploymentMode = resolveDeploymentMode(env);
  } catch (error) {
    errors.push(error.message);
  }

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
    const idName = `SHOPEE_${role}_PARTNER_ID`;
    const keyName = `SHOPEE_${role}_PARTNER_KEY`;
    if (deploymentMode === OFFLINE_BASELINE) {
      if (String(env[idName] || '').trim() || String(env[keyName] || '').trim()) {
        errors.push(`${idName} and ${keyName} must be empty in OFFLINE_BASELINE`);
      }
    } else if (deploymentMode === PILOT_GMV_MAX) {
      if (role === 'ADS') {
        if (!isRealSecret(env[idName])) errors.push(`${idName} is missing`);
        if (!isRealSecret(env[keyName])) errors.push(`${keyName} is missing`);
      } else if (String(env[idName] || '').trim() || String(env[keyName] || '').trim()) {
        errors.push(`${idName} and ${keyName} must be empty in PILOT_GMV_MAX`);
      }
    } else {
      if (!isRealSecret(env[idName])) errors.push(`${idName} is missing`);
      if (!isRealSecret(env[keyName])) errors.push(`${keyName} is missing`);
    }
  }

  const skillProvider = String(env.SHOPEE_SKILL_RUNTIME_PROVIDER || '').trim().toUpperCase();
  if (deploymentMode === OFFLINE_BASELINE && skillProvider) {
    errors.push('SHOPEE_SKILL_RUNTIME_PROVIDER must be empty in OFFLINE_BASELINE');
  } else if (skillProvider && skillProvider !== 'OPENAI') {
    errors.push(`Unsupported SHOPEE_SKILL_RUNTIME_PROVIDER: ${skillProvider}`);
  }
  if (deploymentMode === OFFLINE_BASELINE &&
      (String(env.SHOPEE_SKILL_OPENAI_API_KEY || '').trim() || String(env.OPENAI_API_KEY || '').trim())) {
    errors.push('OpenAI API key must be empty in OFFLINE_BASELINE');
  } else if (skillProvider === 'OPENAI' && !isRealSecret(env.SHOPEE_SKILL_OPENAI_API_KEY || env.OPENAI_API_KEY)) {
    errors.push('SHOPEE_SKILL_OPENAI_API_KEY is missing');
  }

  const dailyWindow = Number(env.SHOPEE_SKILL_DAILY_WINDOW_DAYS || 14);
  if (!Number.isSafeInteger(dailyWindow) || dailyWindow < 1 || dailyWindow > 90) {
    errors.push('SHOPEE_SKILL_DAILY_WINDOW_DAYS must be an integer from 1 to 90');
  }

  if (deploymentMode === OFFLINE_BASELINE) {
    if (env.SHOPEE_SYNC_RUN_ON_START === 'YES') {
      errors.push('SHOPEE_SYNC_RUN_ON_START must not be YES in OFFLINE_BASELINE');
    }
    if (env.SHOPEE_PRODUCT_CARD_INBOX_ENABLE === 'YES') {
      errors.push('SHOPEE_PRODUCT_CARD_INBOX_ENABLE must not be YES in OFFLINE_BASELINE');
    }
  }

  if (deploymentMode === PILOT_GMV_MAX) {
    const shopId = Number(env.SHOPEE_PILOT_GMV_MAX_SHOP_ID);
    if (!Number.isSafeInteger(shopId) || shopId <= 0) {
      errors.push('SHOPEE_PILOT_GMV_MAX_SHOP_ID must be a positive safe integer');
    }
    if (!String(env.SHOPEE_PILOT_GMV_MAX_BRAND || '').trim()) {
      errors.push('SHOPEE_PILOT_GMV_MAX_BRAND is missing');
    }
    try {
      resolvePilotCampaignAllowlist(env);
    } catch (error) {
      errors.push(error.message);
    }
    if (env.SHOPEE_PRODUCT_CARD_INBOX_ENABLE === 'YES') {
      errors.push('SHOPEE_PRODUCT_CARD_INBOX_ENABLE must not be YES in PILOT_GMV_MAX');
    }
  }

  if (!env.SHOPEE_BACKUP_LOCAL_DIR) warnings.push('SHOPEE_BACKUP_LOCAL_DIR not configured');
  if (!env.SHOPEE_NAS_BACKUP_DIR) warnings.push('SHOPEE_NAS_BACKUP_DIR not configured');

  return { ok: errors.length === 0, errors, warnings };
}

module.exports = { isRealSecret, validateDesktopEnv };
