'use strict';

const PRODUCTION = 'PRODUCTION';
const OFFLINE_BASELINE = 'OFFLINE_BASELINE';
const PILOT_GMV_MAX = 'PILOT_GMV_MAX';
const PRODUCTION_ROLES = Object.freeze(['ADS', 'STORE_OPS', 'ERP', 'BRAND_PORTAL']);

function resolveDeploymentMode(env = process.env) {
  const value = env.SHOPEE_ANALYTICS_DEPLOYMENT_MODE;
  if (value === undefined || value === '') return PRODUCTION;
  if (value === PRODUCTION || value === OFFLINE_BASELINE || value === PILOT_GMV_MAX) return value;
  throw new Error(
    `Unsupported SHOPEE_ANALYTICS_DEPLOYMENT_MODE: ${String(value)}. ` +
    `Use ${PRODUCTION}, ${PILOT_GMV_MAX}, or ${OFFLINE_BASELINE} exactly.`,
  );
}

function isPilotGmvMax(env = process.env) {
  return resolveDeploymentMode(env) === PILOT_GMV_MAX;
}

function rolesForDeploymentMode(env = process.env) {
  const mode = resolveDeploymentMode(env);
  if (mode === PRODUCTION) return PRODUCTION_ROLES;
  if (mode === PILOT_GMV_MAX) return ['ADS'];
  return [];
}

function assertRoleAllowed(role, env = process.env) {
  const mode = resolveDeploymentMode(env);
  if (!rolesForDeploymentMode(env).includes(role)) {
    throw new Error(`Shopee role ${role} is disabled in ${mode} deployment mode.`);
  }
}

function assertOperationAllowed(operation, { allowPilot = true } = {}, env = process.env) {
  const mode = resolveDeploymentMode(env);
  if (mode === OFFLINE_BASELINE || (mode === PILOT_GMV_MAX && !allowPilot)) {
    throw new Error(`${operation} is disabled in ${mode} deployment mode.`);
  }
}

function isOfflineBaseline(env = process.env) {
  return resolveDeploymentMode(env) === OFFLINE_BASELINE;
}

function assertOnlineOperationAllowed(operation, env = process.env) {
  assertOperationAllowed(operation, {}, env);
}

function loadPilotGmvMaxConfig(env = process.env) {
  if (!isPilotGmvMax(env)) return null;
  const shopId = Number(env.SHOPEE_PILOT_GMV_MAX_SHOP_ID);
  if (!Number.isSafeInteger(shopId) || shopId <= 0) {
    throw new Error('SHOPEE_PILOT_GMV_MAX_SHOP_ID must be a positive safe integer in PILOT_GMV_MAX');
  }
  const brand = String(env.SHOPEE_PILOT_GMV_MAX_BRAND || '').trim();
  if (!brand) throw new Error('SHOPEE_PILOT_GMV_MAX_BRAND is required in PILOT_GMV_MAX');
  const campaignIds = Array.from(new Set(String(env.SHOPEE_PILOT_GMV_MAX_CAMPAIGN_IDS || '')
    .split(',').map(value => Number(value.trim())).filter(Number.isSafeInteger)));
  if (!campaignIds.length) {
    throw new Error('SHOPEE_PILOT_GMV_MAX_CAMPAIGN_IDS requires one or more campaign IDs in PILOT_GMV_MAX');
  }
  return { shopId, brand, campaignIds };
}

function assertPilotShopAllowed(shopId, env = process.env) {
  const config = loadPilotGmvMaxConfig(env);
  if (config && Number(shopId) !== config.shopId) {
    throw new Error(`PILOT_GMV_MAX refuses shop ${shopId}; configured pilot shop is ${config.shopId}`);
  }
  return config;
}

function assertPilotCampaignAllowed(campaignId, env = process.env) {
  const config = loadPilotGmvMaxConfig(env);
  const normalizedCampaignId = Number(campaignId);
  if (config && !config.campaignIds.includes(normalizedCampaignId)) {
    throw new Error(`PILOT_GMV_MAX refuses campaign ${campaignId}; it is not in SHOPEE_PILOT_GMV_MAX_CAMPAIGN_IDS`);
  }
  return config;
}

module.exports = {
  PRODUCTION,
  OFFLINE_BASELINE,
  PILOT_GMV_MAX,
  resolveDeploymentMode,
  isOfflineBaseline,
  isPilotGmvMax,
  rolesForDeploymentMode,
  assertRoleAllowed,
  assertOperationAllowed,
  assertOnlineOperationAllowed,
  loadPilotGmvMaxConfig,
  assertPilotShopAllowed,
  assertPilotCampaignAllowed,
};
