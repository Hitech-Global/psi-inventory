'use strict';

const { createAnalyticsPool } = require('../src/pg');
const { loadShopId } = require('../src/config');
const { createRoleClient } = require('../src/client-factory');
const { ShopeeAnalyticsRepository } = require('../src/repository');
const { ShopeeCampaignRepository } = require('../src/campaign-repository');
const { ShopeeProductRepository } = require('../src/product-repository');
const { ShopeePromotionRepository } = require('../src/promotion-repository');
const { ShopeeOrderRepository } = require('../src/order-repository');
const { ShopeeReturnRepository } = require('../src/return-repository');
const { ShopeeShopBiRepository } = require('../src/shop-bi-repository');
const { ShopeeSyncService } = require('../src/sync-service');
const { syncGmsWindow } = require('../src/sync-window');

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function roleMap(role) {
  return { [role]: createRoleClient(role) };
}

async function main() {
  if (process.env.SHOPEE_ANALYTICS_ENABLE_SYNC !== 'YES') {
    throw new Error('Refusing analytics DB sync. Set SHOPEE_ANALYTICS_ENABLE_SYNC=YES explicitly.');
  }

  const command = process.argv[2];
  if (!command) throw new Error('Usage: node sync-readonly.cjs <campaigns|products|promotions|orders|returns|shop-bi|roi|gms>');

  const shopId = loadShopId();
  const pool = createAnalyticsPool();
  const rawRepository = new ShopeeAnalyticsRepository({ pool });

  try {
    if (command === 'gms') {
      const ads = createRoleClient('ADS');
      const result = await syncGmsWindow({
        client: ads.client,
        repository: rawRepository,
        shopId,
        accessToken: ads.accessToken,
        campaignId: Number(required('SHOPEE_GMS_CAMPAIGN_ID')),
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
      serviceArgs.roleClients = roleMap('ADS');
      serviceArgs.campaignRepository = new ShopeeCampaignRepository({ pool });
    } else if (command === 'products' || command === 'roi') {
      serviceArgs.roleClients = roleMap('ADS');
      serviceArgs.productRepository = new ShopeeProductRepository({ pool });
    } else if (command === 'promotions') {
      serviceArgs.roleClients = roleMap('STORE_OPS');
      serviceArgs.promotionRepository = new ShopeePromotionRepository({ pool });
    } else if (command === 'orders') {
      serviceArgs.roleClients = roleMap('ADS');
      serviceArgs.orderRepository = new ShopeeOrderRepository({ pool });
    } else if (command === 'returns') {
      serviceArgs.roleClients = roleMap('ERP');
      serviceArgs.returnRepository = new ShopeeReturnRepository({ pool });
    } else if (command === 'shop-bi') {
      serviceArgs.roleClients = roleMap('BRAND_PORTAL');
      serviceArgs.shopBiRepository = new ShopeeShopBiRepository({ pool });
    } else {
      throw new Error(`Unknown command: ${command}`);
    }

    const service = new ShopeeSyncService(serviceArgs);
    let result;

    if (command === 'campaigns') {
      result = await service.syncCampaignSettings();
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

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
