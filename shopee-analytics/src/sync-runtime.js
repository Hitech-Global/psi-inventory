'use strict';

const { APP_ENV, loadAppCredential } = require('./config');
const { loadMasterKey } = require('./token-crypto');
const { ShopeeTokenRepository } = require('./token-repository');
const { ShopeeTokenManager } = require('./token-manager');
const { createRoleClients } = require('./client-factory');
const { ShopeeAnalyticsRepository } = require('./repository');
const { ShopeeCampaignRepository } = require('./campaign-repository');
const { ShopeeProductRepository } = require('./product-repository');
const { ShopeePromotionRepository } = require('./promotion-repository');
const { ShopeeOrderRepository } = require('./order-repository');
const { ShopeeReturnRepository } = require('./return-repository');
const { ShopeeShopBiRepository } = require('./shop-bi-repository');
const { ShopeeShopRepository } = require('./shop-repository');
const { ShopeeQueryRepository } = require('./query-repository');
const { ShopeeAdPromotionRepository } = require('./ad-promotion-repository');
const { ShopeeProductAdsShopRepository } = require('./product-ads-shop-repository');
const { rolesForDeploymentMode } = require('./deployment-mode');

function selectConfiguredRuntimeRoles({ env = process.env, allowedRoles = rolesForDeploymentMode(env) } = {}) {
  const selected = [];
  for (const role of allowedRoles) {
    const spec = APP_ENV[role];
    const hasId = Boolean(String(env[spec.partnerId] || '').trim());
    const hasKey = Boolean(String(env[spec.partnerKey] || '').trim());
    if (hasId !== hasKey) {
      throw new Error(`Incomplete Shopee app credential for ${role}: partner ID/key must be configured together`);
    }
    if (!hasId) {
      if (role === 'ADS') throw new Error('ADS partner credential is required for online Shopee sync');
      continue;
    }
    selected.push(role);
  }
  return selected;
}

function createSyncRuntime({
  pool,
  masterKey = loadMasterKey(),
  env = process.env,
  credentialLoader = role => loadAppCredential(role, { requireToken: false, env }),
} = {}) {
  if (!pool) throw new Error('pool is required');

  const tokenRepository = new ShopeeTokenRepository({ pool, masterKey });
  const tokenManager = new ShopeeTokenManager({
    tokenRepository,
    credentialLoader,
  });
  const configuredRoles = selectConfiguredRuntimeRoles({ env });
  const optionsByRole = {};
  for (const role of configuredRoles) {
    optionsByRole[role] = { tokenManager, credential: credentialLoader(role) };
  }
  const roleClients = createRoleClients(configuredRoles, optionsByRole);

  return {
    pool,
    tokenRepository,
    tokenManager,
    roleClients,
    rawRepository: new ShopeeAnalyticsRepository({ pool }),
    campaignRepository: new ShopeeCampaignRepository({ pool }),
    productRepository: new ShopeeProductRepository({ pool }),
    promotionRepository: new ShopeePromotionRepository({ pool }),
    orderRepository: new ShopeeOrderRepository({ pool }),
    returnRepository: new ShopeeReturnRepository({ pool }),
    shopBiRepository: new ShopeeShopBiRepository({ pool }),
    shopRepository: new ShopeeShopRepository({ pool }),
    queryRepository: new ShopeeQueryRepository({ pool }),
    adPromotionRepository: new ShopeeAdPromotionRepository({ pool }),
    productAdsShopRepository: new ShopeeProductAdsShopRepository({ pool }),
  };
}

module.exports = { createSyncRuntime, selectConfiguredRuntimeRoles };
