'use strict';

const { createAnalyticsPool } = require('../src/pg');
const { loadShopId, loadAppCredential } = require('../src/config');
const { createRoleClient } = require('../src/client-factory');
const { loadMasterKey } = require('../src/token-crypto');
const { ShopeeTokenRepository } = require('../src/token-repository');
const { ShopeeTokenManager } = require('../src/token-manager');
const { ShopeeAnalyticsRepository } = require('../src/repository');
const { ShopeeCampaignRepository } = require('../src/campaign-repository');
const { ShopeeProductRepository } = require('../src/product-repository');
const { ShopeePromotionRepository } = require('../src/promotion-repository');
const { ShopeeOrderRepository } = require('../src/order-repository');
const { ShopeeReturnRepository } = require('../src/return-repository');
const { ShopeeShopBiRepository } = require('../src/shop-bi-repository');
const { createSyncRuntime } = require('../src/sync-runtime');
const { ShopeeSyncService } = require('../src/sync-service');
const { syncGmsWindow } = require('../src/sync-window');
const {
  assertOnlineOperationAllowed,
  isPilotGmvMax,
  assertFormalGmsPilotScope,
} = require('../src/deployment-mode');

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function roleMap(role, tokenManager) {
  return { [role]: createRoleClient(role, { tokenManager }) };
}

async function main() {
  assertOnlineOperationAllowed('Shopee read-only sync');
  if (process.env.SHOPEE_ANALYTICS_ENABLE_SYNC !== 'YES') {
    throw new Error('Refusing analytics DB sync. Set SHOPEE_ANALYTICS_ENABLE_SYNC=YES explicitly.');
  }

  const command = process.argv[2];
  if (!command) throw new Error('Usage: node sync-readonly.cjs <campaigns|products|promotions|orders|returns|shop-bi|roi|gms>');
  if (isPilotGmvMax() && command !== 'gms') {
    throw new Error(`sync-readonly command ${command} is disabled in PILOT_GMV_MAX deployment mode.`);
  }

  const shopId = loadShopId();
  const gmsCampaignId = command === 'gms' ? Number(required('SHOPEE_GMS_CAMPAIGN_ID')) : null;
  if (command === 'gms') assertFormalGmsPilotScope({ shopId, campaignId: gmsCampaignId });
  const pool = createAnalyticsPool();
  const rawRepository = new ShopeeAnalyticsRepository({ pool });
  const tokenRepository = new ShopeeTokenRepository({ pool, masterKey: loadMasterKey() });
  const tokenManager = new ShopeeTokenManager({
    tokenRepository,
    credentialLoader: role => loadAppCredential(role, { requireToken: false }),
  });

  try {
    if (command === 'gms') {
      const runtime = createSyncRuntime({ pool });
      const ads = runtime.roleClients.ADS;
      const accessToken = await ads.getAccessToken(shopId);
      const result = await syncGmsWindow({
        client: ads.client,
        repository: runtime.rawRepository,
        adPromotionRepository: runtime.adPromotionRepository,
        shopId,
        accessToken,
        campaignId: gmsCampaignId,
        startDate: required('SHOPEE_GMS_START_DATE'),
        endDate: required('SHOPEE_GMS_END_DATE'),
      });
      console.log(JSON.stringify({ command, days: result.length, result }, null, 2));
      return;
    }

    const serviceArgs = {
      shopId,
      rawRepository,
      roleClients: {},
    };

    if (command === 'campaigns') {
      serviceArgs.roleClients = roleMap('ADS', tokenManager);
      serviceArgs.campaignRepository = new ShopeeCampaignRepository({ pool });
    } else if (command === 'products' || command === 'roi') {
      serviceArgs.roleClients = roleMap('ADS', tokenManager);
      serviceArgs.productRepository = new ShopeeProductRepository({ pool });
    } else if (command === 'promotions') {
      serviceArgs.roleClients = roleMap('STORE_OPS', tokenManager);
      serviceArgs.promotionRepository = new ShopeePromotionRepository({ pool });
    } else if (command === 'orders') {
      serviceArgs.roleClients = roleMap('ADS', tokenManager);
      serviceArgs.orderRepository = new ShopeeOrderRepository({ pool });
    } else if (command === 'returns') {
      serviceArgs.roleClients = roleMap('ERP', tokenManager);
      serviceArgs.returnRepository = new ShopeeReturnRepository({ pool });
    } else if (command === 'shop-bi') {
      serviceArgs.roleClients = roleMap('BRAND_PORTAL', tokenManager);
      serviceArgs.shopBiRepository = new ShopeeShopBiRepository({ pool });
    } else {
      throw new Error(`Unknown command: ${command}`);
    }

    const service = new ShopeeSyncService(serviceArgs);
    let result;

    if (command === 'campaigns') {
      result = await service.syncCampaignSettings({
        campaignIds: null,
      });
    } else if (command === 'products') {
      result = await service.syncProducts();
    } else if (command === 'promotions') {
      result = await service.syncPromotions();
    } else if (command === 'orders') {
      result = await service.syncOrders({
        timeFrom: Number(required('SHOPEE_SYNC_TIME_FROM')),
        timeTo: Number(required('SHOPEE_SYNC_TIME_TO')),
      });
    } else if (command === 'returns') {
      result = await service.syncReturns({
        updateTimeFrom: Number(required('SHOPEE_SYNC_TIME_FROM')),
        updateTimeTo: Number(required('SHOPEE_SYNC_TIME_TO')),
      });
    } else if (command === 'shop-bi') {
      result = await service.syncShopBiDay({
        date: required('SHOPEE_BI_DATE'),
        timezone: required('SHOPEE_BI_TIMEZONE'),
      });
    } else if (command === 'roi') {
      const itemIds = required('SHOPEE_ROI_ITEM_IDS')
        .split(',')
        .map(x => Number(x.trim()))
        .filter(Number.isSafeInteger);
      result = await service.syncRecommendedRoi({ itemIds });
    }

    console.log(JSON.stringify({ command, result }, null, 2));
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = { main };
