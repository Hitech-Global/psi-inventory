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

function loadAppCredential(role, { requireToken = false, env = process.env } = {}) {
  const spec = appSpec(role);
  return {
    role,
    partnerId: readEnv(spec.partnerId, { env }),
    partnerKey: readEnv(spec.partnerKey, { env }),
    accessToken: readEnv(spec.accessToken, { required: requireToken, env }),
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
  readEnv,
  appSpec,
  loadAppCredential,
  loadBootstrapToken,
  loadShopId,
  loadRateLimitRetryOptions,
};
