'use strict';

const APP_ENV = Object.freeze({
  ADS: {
    partnerId: 'SHOPEE_ADS_PARTNER_ID',
    partnerKey: 'SHOPEE_ADS_PARTNER_KEY',
    accessToken: 'SHOPEE_ADS_ACCESS_TOKEN',
  },
  STORE_OPS: {
    partnerId: 'SHOPEE_STORE_OPS_PARTNER_ID',
    partnerKey: 'SHOPEE_STORE_OPS_PARTNER_KEY',
    accessToken: 'SHOPEE_STORE_OPS_ACCESS_TOKEN',
  },
  ERP: {
    partnerId: 'SHOPEE_ERP_PARTNER_ID',
    partnerKey: 'SHOPEE_ERP_PARTNER_KEY',
    accessToken: 'SHOPEE_ERP_ACCESS_TOKEN',
  },
  BRAND_PORTAL: {
    partnerId: 'SHOPEE_BRAND_PORTAL_PARTNER_ID',
    partnerKey: 'SHOPEE_BRAND_PORTAL_PARTNER_KEY',
    accessToken: 'SHOPEE_BRAND_PORTAL_ACCESS_TOKEN',
  },
});

function readEnv(name, { required = true } = {}) {
  const value = process.env[name];
  if (required && !value) throw new Error(`Missing environment variable: ${name}`);
  return value || '';
}

function loadAppCredential(role, { requireToken = true } = {}) {
  const spec = APP_ENV[role];
  if (!spec) throw new Error(`Unknown Shopee app role: ${role}`);
  return {
    role,
    partnerId: readEnv(spec.partnerId),
    partnerKey: readEnv(spec.partnerKey),
    accessToken: readEnv(spec.accessToken, { required: requireToken }),
  };
}

function loadShopId() {
  const raw = readEnv('SHOPEE_SHOP_ID');
  const shopId = Number(raw);
  if (!Number.isSafeInteger(shopId) || shopId <= 0) {
    throw new Error('SHOPEE_SHOP_ID must be a positive safe integer');
  }
  return shopId;
}

module.exports = { APP_ENV, readEnv, loadAppCredential, loadShopId };
