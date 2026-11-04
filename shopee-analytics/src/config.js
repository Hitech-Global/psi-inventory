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
  // The affiliate marketing solutions: the campaigns, the performance
  // and the bills. Only an application of this kind may call them.
  MARKETING: {
    partnerId: 'SHOPEE_MARKETING_PARTNER_ID',
    partnerKey: 'SHOPEE_MARKETING_PARTNER_KEY',
    accessToken: 'SHOPEE_MARKETING_ACCESS_TOKEN',
    refreshToken: 'SHOPEE_MARKETING_REFRESH_TOKEN',
    tokenExpiresAt: 'SHOPEE_MARKETING_TOKEN_EXPIRES_AT',
  },
  // The videos and the livestreams.
  VIDEO: {
    partnerId: 'SHOPEE_VIDEO_PARTNER_ID',
    partnerKey: 'SHOPEE_VIDEO_PARTNER_KEY',
    accessToken: 'SHOPEE_VIDEO_ACCESS_TOKEN',
    refreshToken: 'SHOPEE_VIDEO_REFRESH_TOKEN',
    tokenExpiresAt: 'SHOPEE_VIDEO_TOKEN_EXPIRES_AT',
  },
  // The shops that trade online rather than through a marketplace.
  ONLINE: {
    partnerId: 'SHOPEE_ONLINE_PARTNER_ID',
    partnerKey: 'SHOPEE_ONLINE_PARTNER_KEY',
    accessToken: 'SHOPEE_ONLINE_ACCESS_TOKEN',
    refreshToken: 'SHOPEE_ONLINE_REFRESH_TOKEN',
    tokenExpiresAt: 'SHOPEE_ONLINE_TOKEN_EXPIRES_AT',
  },
  // The operations brain: what the shop is doing, in the platform's own
  // reckoning of it.
  STORE_OPS_BRAIN: {
    partnerId: 'SHOPEE_STORE_OPS_BRAIN_PARTNER_ID',
    partnerKey: 'SHOPEE_STORE_OPS_BRAIN_PARTNER_KEY',
    accessToken: 'SHOPEE_STORE_OPS_BRAIN_ACCESS_TOKEN',
    refreshToken: 'SHOPEE_STORE_OPS_BRAIN_REFRESH_TOKEN',
    tokenExpiresAt: 'SHOPEE_STORE_OPS_BRAIN_TOKEN_EXPIRES_AT',
  },
  // The orders as the platform reads them, apart from the orders of a shop.
  ORDER_ANALYSIS: {
    partnerId: 'SHOPEE_ORDER_ANALYSIS_PARTNER_ID',
    partnerKey: 'SHOPEE_ORDER_ANALYSIS_PARTNER_KEY',
    accessToken: 'SHOPEE_ORDER_ANALYSIS_ACCESS_TOKEN',
    refreshToken: 'SHOPEE_ORDER_ANALYSIS_REFRESH_TOKEN',
    tokenExpiresAt: 'SHOPEE_ORDER_ANALYSIS_TOKEN_EXPIRES_AT',
  },
});

/**
 * The applications the system knows how to be.
 *
 * A shop may hold several applications for the same purpose under
 * different partners — the advertising under one partner and under
 * another — so the credentials of a role are a list, and the first one
 * that works is the one used.
 */
const APP_ROLES = Object.freeze(Object.keys(APP_ENV));

/**
 * A list written as one string.
 *
 * The credentials of a role are written as commas in one line, so that a
 * second partner can be added without a second variable to remember:
 * SHOPEE_ADS_PARTNER_ID=2045578,1244903
 */
function splitList(value) {
  return String(value || '')
    .split(',')
    .map(part => part.trim())
    .filter(Boolean);
}

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

function loadAppCredential(role, { requireToken = false, env = process.env } = {}) {
  const spec = appSpec(role);
  return {
    role,
    partnerId: readEnv(spec.partnerId, { env }),
    partnerKey: readEnv(spec.partnerKey, { env }),
    accessToken: readEnv(spec.accessToken, { required: requireToken, env }),
  };
}

/**
 * Every credential a role holds, in the order they should be tried.
 *
 * The first one that works is the one used; the others are there for the
 * day the first one's permission is not enough for what is being asked.
 */
function loadAppCredentials(role, { requireToken = false, env = process.env } = {}) {
  const spec = appSpec(role);
  const ids = splitList(readEnv(spec.partnerId, { required: false, env }));
  const keys = splitList(readEnv(spec.partnerKey, { required: false, env }));
  const tokens = splitList(readEnv(spec.accessToken, { required: false, env }));
  const refreshes = splitList(readEnv(spec.refreshToken, { required: false, env }));
  const expiries = splitList(readEnv(spec.tokenExpiresAt, { required: false, env }));
  if (!ids.length) {
    if (requireToken) readEnv(spec.partnerId, { env });
    return [];
  }
  return ids.map((partnerId, index) => ({
    role,
    partnerId,
    partnerKey: keys[index] || '',
    accessToken: tokens[index] || '',
    refreshToken: refreshes[index] || '',
    tokenExpiresAt: expiries[index] || '',
  }));
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

/**
 * 读取 Shopee 限流退避参数。
 *
 * 全部可选，未设置时返回 undefined，由 rate-limit-retry 使用默认值。
 * 提供环境变量是为了让高 QPS 多店铺场景可以在不重新构建镜像的情况下收紧或放宽退避。
 */
function loadRateLimitRetryOptions(env = process.env) {
  const readOptionalNumber = (name) => {
    const raw = String(env[name] || '').trim();
    if (!raw) return undefined;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`${name} must be a non-negative number`);
    }
    return value;
  };

  const options = {};
  const maxAttempts = readOptionalNumber('SHOPEE_RATE_LIMIT_MAX_ATTEMPTS');
  const baseDelayMs = readOptionalNumber('SHOPEE_RATE_LIMIT_BASE_DELAY_MS');
  const maxDelayMs = readOptionalNumber('SHOPEE_RATE_LIMIT_MAX_DELAY_MS');
  if (maxAttempts !== undefined) options.maxAttempts = maxAttempts;
  if (baseDelayMs !== undefined) options.baseDelayMs = baseDelayMs;
  if (maxDelayMs !== undefined) options.maxDelayMs = maxDelayMs;
  return options;
}

module.exports = {
  APP_ENV,
  APP_ROLES,
  readEnv,
  appSpec,
  splitList,
  loadAppCredential,
  loadAppCredentials,
  loadBootstrapToken,
  loadShopId,
  loadRateLimitRetryOptions,
};
