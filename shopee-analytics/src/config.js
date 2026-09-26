'use strict';

const APP_ENV = Object.freeze({
  ADS: {
    partnerId: 'SHOPEE_ADS_PARTNER_ID',
    partnerKey: 'SHOPEE_ADS_PARTNER_KEY',
    accessToken: 'SHOPEE_ADS_ACCESS_TOKEN',
    refreshToken: 'SHOPEE_ADS_REFRESH_TOKEN',
    tokenExpiresAt: 'SHOPEE_ADS_TOKEN_EXPIRES_AT',
  },
  STORE_OPS: {
    partnerId: 'SHOPEE_STORE_OPS_PARTNER_ID',
    partnerKey: 'SHOPEE_STORE_OPS_PARTNER_KEY',
    accessToken: 'SHOPEE_STORE_OPS_ACCESS_TOKEN',
    refreshToken: 'SHOPEE_STORE_OPS_REFRESH_TOKEN',
    tokenExpiresAt: 'SHOPEE_STORE_OPS_TOKEN_EXPIRES_AT',
  },
  ERP: {
    partnerId: 'SHOPEE_ERP_PARTNER_ID',
    partnerKey: 'SHOPEE_ERP_PARTNER_KEY',
    accessToken: 'SHOPEE_ERP_ACCESS_TOKEN',
    refreshToken: 'SHOPEE_ERP_REFRESH_TOKEN',
    tokenExpiresAt: 'SHOPEE_ERP_TOKEN_EXPIRES_AT',
  },
  BRAND_PORTAL: {
    partnerId: 'SHOPEE_BRAND_PORTAL_PARTNER_ID',
    partnerKey: 'SHOPEE_BRAND_PORTAL_PARTNER_KEY',
    accessToken: 'SHOPEE_BRAND_PORTAL_ACCESS_TOKEN',
    refreshToken: 'SHOPEE_BRAND_PORTAL_REFRESH_TOKEN',
    tokenExpiresAt: 'SHOPEE_BRAND_PORTAL_TOKEN_EXPIRES_AT',
  },
});

function readEnv(name, { required = true, env = process.env } = {}) {
  const value = env[name];
  if (required && !value) throw new Error(`Missing environment variable: ${name}`);
  return value || '';
}

function appSpec(role) {
  const spec = APP_ENV[role];
  if (!spec) throw new Error(`Unknown Shopee app role: ${role}`);
  return spec;
}

function loadAppCredential(role, { requireToken = false } = {}) {
  const spec = appSpec(role);
  return {
    role,
    partnerId: readEnv(spec.partnerId),
    partnerKey: readEnv(spec.partnerKey),
    accessToken: readEnv(spec.accessToken, { required: requireToken }),
  };
}

function loadBootstrapToken(role) {
  const spec = appSpec(role);
  const accessToken = readEnv(spec.accessToken);
  const refreshToken = readEnv(spec.refreshToken);
  const rawExpiresAt = readEnv(spec.tokenExpiresAt);
  const expiresAt = new Date(rawExpiresAt);
  if (Number.isNaN(expiresAt.getTime())) {
    throw new Error(`${spec.tokenExpiresAt} must be an ISO date/time`);
  }
  return { accessToken, refreshToken, expiresAt };
}

function loadShopId(env = process.env) {
  const raw = readEnv('SHOPEE_SHOP_ID', { env });
  const shopId = Number(raw);
  if (!Number.isSafeInteger(shopId) || shopId <= 0) {
    throw new Error('SHOPEE_SHOP_ID must be a positive safe integer');
  }
  return shopId;
}

module.exports = {
  APP_ENV,
  readEnv,
  appSpec,
  loadAppCredential,
  loadBootstrapToken,
  loadShopId,
};
