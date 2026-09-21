'use strict';

const { loadAppCredential } = require('./config');
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
const { rolesForDeploymentMode } = require('./deployment-mode');

function createSyncRuntime({
  pool,
  masterKey = loadMasterKey(),
  credentialLoader = role => loadAppCredential(role, { requireToken: false }),
} = {}) {
  if (!pool) throw new Error('pool is required');

  const tokenRepository = new ShopeeTokenRepository({ pool, masterKey });
  const tokenManager = new ShopeeTokenManager({
    tokenRepository,
    credentialLoader,
  });
  const roleClients = createRoleClients(
    rolesForDeploymentMode(),
    {
      ADS: { tokenManager },
      STORE_OPS: { tokenManager },
      ERP: { tokenManager },
      BRAND_PORTAL: { tokenManager },
    },
  );

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
  };
}

module.exports = { createSyncRuntime };
