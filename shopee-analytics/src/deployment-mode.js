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

function loadPilotIdentityConfig(env = process.env) {
  if (!isPilotGmvMax(env)) return null;
  const shopId = Number(env.SHOPEE_PILOT_GMV_MAX_SHOP_ID);
  if (!Number.isSafeInteger(shopId) || shopId <= 0) {
    throw new Error('SHOPEE_PILOT_GMV_MAX_SHOP_ID must be a positive safe integer in PILOT_GMV_MAX');
  }
  const brand = String(env.SHOPEE_PILOT_GMV_MAX_BRAND || '').trim();
  if (!brand) throw new Error('SHOPEE_PILOT_GMV_MAX_BRAND is required in PILOT_GMV_MAX');
  return { shopId, brand };
}

function isPilotOAuthBootstrap(env = process.env) {
  return isPilotGmvMax(env) &&
    env.SHOPEE_OAUTH_ENABLE === 'YES' &&
    !String(env.SHOPEE_PILOT_GMV_MAX_CAMPAIGN_IDS || '').trim();
}

function assertPilotOAuthAllowed(env = process.env) {
  const mode = resolveDeploymentMode(env);
  if (mode !== PILOT_GMV_MAX || env.SHOPEE_OAUTH_ENABLE !== 'YES') {
    throw new Error(`Shopee OAuth is disabled in ${mode} deployment mode.`);
  }
  assertRoleAllowed('ADS', env);
  return loadPilotIdentityConfig(env);
}

function loadPilotGmvMaxConfig(env = process.env) {
  const identity = loadPilotIdentityConfig(env);
  if (!identity) return null;
  const campaignIds = resolvePilotCampaignAllowlist(env);
  return { ...identity, campaignIds };
}

function resolvePilotCampaignAllowlist(env = process.env) {
  const raw = String(env.SHOPEE_PILOT_GMV_MAX_CAMPAIGN_IDS || '');
  const values = raw.split(',').map(value => value.trim());
  if (!raw.trim() || values.some(value => !value)) {
    throw new Error('SHOPEE_PILOT_GMV_MAX_CAMPAIGN_IDS requires one or more comma-separated campaign IDs in PILOT_GMV_MAX');
  }

  const campaignIds = values.map(value => Number(value));
  if (campaignIds.some(value => !Number.isSafeInteger(value) || value <= 0)) {
    throw new Error('SHOPEE_PILOT_GMV_MAX_CAMPAIGN_IDS must contain only positive safe integer campaign IDs');
  }
  return Array.from(new Set(campaignIds));
}

function resolvePilotTypedCampaignAllowlist(type, env = process.env) {
  const names = {
    SHOP_GMV_MAX: 'SHOPEE_PILOT_SHOP_GMV_MAX_CAMPAIGN_IDS',
    INDIVIDUAL_AD: 'SHOPEE_PILOT_INDIVIDUAL_AD_CAMPAIGN_IDS',
  };
  const name = names[type];
  if (!name) throw new Error(`Unsupported pilot promotion type: ${type}`);
  if (!isPilotGmvMax(env)) return [];
  const raw = String(env[name] || '').trim();
  if (!raw) return [];
  const parts = raw.split(',').map(value => value.trim());
  if (parts.some(value => !/^\d+$/.test(value))) throw new Error(`${name} must contain only positive safe integer campaign IDs`);
  const ids = parts.map(Number);
  if (ids.some(value => !Number.isSafeInteger(value) || value <= 0)) throw new Error(`${name} must contain only positive safe integer campaign IDs`);
  return Array.from(new Set(ids));
}

function assertPilotTypedCampaignAllowed(type, campaignId, env = process.env) {
  const ids = resolvePilotTypedCampaignAllowlist(type, env);
  const normalized = Number(campaignId);
  if (isPilotGmvMax(env) && (!ids.length || !ids.includes(normalized))) {
    throw new Error(`PILOT_GMV_MAX refuses ${type} campaign ${campaignId}; it is not in its independent allowlist`);
  }
  return ids;
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

function assertPilotCampaignSetAllowed(campaignIds, env = process.env) {
  const config = loadPilotGmvMaxConfig(env);
  if (!config) return Array.from(new Set((campaignIds || []).map(Number).filter(Number.isSafeInteger)));

  const normalized = Array.from(new Set((campaignIds || []).map(Number)));
  const invalid = normalized.filter(campaignId =>
    !Number.isSafeInteger(campaignId) || campaignId <= 0 || !config.campaignIds.includes(campaignId));
  if (invalid.length) {
    throw new Error(
      `PILOT_GMV_MAX refuses campaign IDs outside SHOPEE_PILOT_GMV_MAX_CAMPAIGN_IDS: ${invalid.join(', ')}`,
    );
  }
  return normalized;
}

function validatePilotProfileCampaignSeeds(profile, pilotConfig = loadPilotGmvMaxConfig()) {
  if (!pilotConfig) return [];
  const rawSeeds = profile && (profile.gmsCampaignSeedIds ?? profile.gms_campaign_seed_ids) || [];
  if (!Array.isArray(rawSeeds)) {
    throw new Error('PILOT_GMV_MAX profile gmsCampaignSeedIds must be an array of campaign IDs');
  }
  const seedIds = Array.from(new Set(rawSeeds.map(Number)));
  const invalid = seedIds.filter(campaignId =>
    !Number.isSafeInteger(campaignId) || campaignId <= 0 || !pilotConfig.campaignIds.includes(campaignId));
  if (invalid.length) {
    throw new Error(
      `PILOT_GMV_MAX profile gmsCampaignSeedIds contains campaign IDs outside SHOPEE_PILOT_GMV_MAX_CAMPAIGN_IDS: ${invalid.join(', ')}`,
    );
  }
  return seedIds;
}

module.exports = {
  PRODUCTION,
  OFFLINE_BASELINE,
  PILOT_GMV_MAX,
  resolveDeploymentMode,
  isOfflineBaseline,
  isPilotGmvMax,
  isPilotOAuthBootstrap,
  rolesForDeploymentMode,
  assertRoleAllowed,
  assertOperationAllowed,
  assertOnlineOperationAllowed,
  assertPilotOAuthAllowed,
  loadPilotIdentityConfig,
  loadPilotGmvMaxConfig,
  resolvePilotCampaignAllowlist,
  resolvePilotTypedCampaignAllowlist,
  assertPilotTypedCampaignAllowed,
  assertPilotShopAllowed,
  assertPilotCampaignAllowed,
  assertPilotCampaignSetAllowed,
  validatePilotProfileCampaignSeeds,
};
