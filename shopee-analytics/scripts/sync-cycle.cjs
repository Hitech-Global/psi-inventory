'use strict';

const { createAnalyticsPool } = require('../src/pg');
const { loadShopId, loadAppCredential } = require('../src/config');
const { loadMasterKey } = require('../src/token-crypto');
const { ShopeeTokenRepository } = require('../src/token-repository');
const { ShopeeTokenManager } = require('../src/token-manager');
const { createRoleClients } = require('../src/client-factory');
const { ShopeeAnalyticsRepository } = require('../src/repository');
const { ShopeeCampaignRepository } = require('../src/campaign-repository');
const { ShopeeProductRepository } = require('../src/product-repository');
const { ShopeePromotionRepository } = require('../src/promotion-repository');
const { ShopeeOrderRepository } = require('../src/order-repository');
const { ShopeeReturnRepository } = require('../src/return-repository');
const { ShopeeShopBiRepository } = require('../src/shop-bi-repository');
const { ShopeeQueryRepository } = require('../src/query-repository');
const { ShopeeSyncService } = require('../src/sync-service');
const { syncGmsWindow } = require('../src/sync-window');
const {
  localIsoDate,
  addDays,
  parseCampaignIds,
  mergeCampaignIds,
} = require('../src/sync-cycle-utils');

async function main() {
  if (process.env.SHOPEE_ANALYTICS_ENABLE_SYNC_CYCLE !== 'YES') {
    throw new Error('Refusing recurring sync cycle. Set SHOPEE_ANALYTICS_ENABLE_SYNC_CYCLE=YES explicitly.');
  }

  const mode = process.argv[2] || 'hourly';
  if (!['hourly', 'daily'].includes(mode)) throw new Error('sync-cycle mode must be hourly or daily');

  const shopId = loadShopId();
  const timeZone = process.env.SHOPEE_SHOP_TIMEZONE;
  const brandPortalTimezone = process.env.SHOPEE_BI_TIMEZONE;
  if (!timeZone) throw new Error('SHOPEE_SHOP_TIMEZONE is required');
  if (mode === 'daily' && !brandPortalTimezone) throw new Error('SHOPEE_BI_TIMEZONE is required for daily mode');

  const now = new Date();
  const nowEpoch = Math.floor(now.getTime() / 1000);
  const today = localIsoDate(now, timeZone);
  const yesterday = addDays(today, -1);
  const pool = createAnalyticsPool();

  const rawRepository = new ShopeeAnalyticsRepository({ pool });
  const queryRepository = new ShopeeQueryRepository({ pool });
  const tokenRepository = new ShopeeTokenRepository({ pool, masterKey: loadMasterKey() });
  const tokenManager = new ShopeeTokenManager({
    tokenRepository,
    credentialLoader: role => loadAppCredential(role, { requireToken: false }),
  });
  const roleClients = createRoleClients(
    ['ADS', 'STORE_OPS', 'ERP', 'BRAND_PORTAL'],
    {
      ADS: { tokenManager },
      STORE_OPS: { tokenManager },
      ERP: { tokenManager },
      BRAND_PORTAL: { tokenManager },
    },
  );

  const service = new ShopeeSyncService({
    shopId,
    roleClients,
    rawRepository,
    campaignRepository: new ShopeeCampaignRepository({ pool }),
    productRepository: new ShopeeProductRepository({ pool }),
    promotionRepository: new ShopeePromotionRepository({ pool }),
    orderRepository: new ShopeeOrderRepository({ pool }),
    returnRepository: new ShopeeReturnRepository({ pool }),
    shopBiRepository: new ShopeeShopBiRepository({ pool }),
  });

  const summary = { mode, shopId, today, steps: [] };
  const run = async (name, fn) => {
    const startedAt = Date.now();
    try {
      const result = await fn();
      summary.steps.push({ name, ok: true, ms: Date.now() - startedAt, result });
      return result;
    } catch (error) {
      summary.steps.push({ name, ok: false, ms: Date.now() - startedAt, error: error.message });
      throw error;
    }
  };

  try {
    await run('campaign-settings', () => service.syncCampaignSettings({ eventDate: today }));

    const knownGms = await queryRepository.listKnownGmsCampaignIds({ shopId });
    const seededGms = parseCampaignIds(process.env.SHOPEE_GMS_CAMPAIGN_IDS);
    const gmsCampaignIds = mergeCampaignIds(knownGms, seededGms);
    const ads = roleClients.ADS;
    const adsToken = await ads.getAccessToken(shopId);

    for (const campaignId of gmsCampaignIds) {
      await run(`gms-${campaignId}`, () => syncGmsWindow({
        client: ads.client,
        repository: rawRepository,
        shopId,
        accessToken: adsToken,
        campaignId,
        startDate: addDays(today, -6),
        endDate: today,
      }));
    }

    await run('orders-recent', () => service.syncOrders({
      timeFrom: nowEpoch - 3 * 86400,
      timeTo: nowEpoch,
    }));

    if (mode === 'daily') {
      await run('products', () => service.syncProducts({
        updateTimeFrom: nowEpoch - 3 * 86400,
        updateTimeTo: nowEpoch,
      }));
      await run('promotions', () => service.syncPromotions());
      await run('returns', () => service.syncReturns({
        updateTimeFrom: nowEpoch - 14 * 86400,
        updateTimeTo: nowEpoch,
      }));
      await run('shop-bi-yesterday', () => service.syncShopBiDay({
        date: yesterday,
        timezone: brandPortalTimezone,
      }));

      const activeItemIds = await queryRepository.listLatestMembershipItemIds({ shopId });
      if (activeItemIds.length) {
        await run('recommended-roi', () => service.syncRecommendedRoi({ itemIds: activeItemIds }));
      } else {
        summary.steps.push({ name: 'recommended-roi', ok: true, skipped: 'NO_ACTIVE_MEMBERSHIP' });
      }
    }

    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
