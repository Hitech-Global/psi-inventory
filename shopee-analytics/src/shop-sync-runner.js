'use strict';

const { ShopeeSyncService } = require('./sync-service');
const { syncGmsWindow } = require('./sync-window');
const {
  localIsoDate,
  addDays,
  mergeCampaignIds,
} = require('./sync-cycle-utils');
const { isPilotGmvMax, assertPilotTypedCampaignAllowed } = require('./deployment-mode');

function normalizeShopProfile(shop) {
  const shopId = Number(shop.shopId ?? shop.shop_id);
  if (!Number.isSafeInteger(shopId) || shopId <= 0) throw new Error('shop.shopId is required');
  const timezone = String(shop.timezone || '').trim();
  if (!timezone) throw new Error(`Shop ${shopId} timezone is required`);
  return {
    ...shop,
    shopId,
    timezone,
    brandPortalTimezone: shop.brandPortalTimezone ?? shop.brand_portal_timezone ?? null,
  };
}

async function runShopSyncCycle({
  runtime,
  shop,
  mode = 'hourly',
  now = new Date(),
  seededGmsCampaignIds = [],
}) {
  if (!runtime) throw new Error('runtime is required');
  if (!['hourly', 'daily'].includes(mode)) throw new Error('mode must be hourly or daily');

  const profile = normalizeShopProfile(shop);
  const pilot = isPilotGmvMax();
  const shopId = profile.shopId;
  const nowEpoch = Math.floor(now.getTime() / 1000);
  const today = localIsoDate(now, profile.timezone);
  const yesterday = addDays(today, -1);

  const service = new ShopeeSyncService({
    shopId,
    roleClients: runtime.roleClients,
    rawRepository: runtime.rawRepository,
    campaignRepository: runtime.campaignRepository,
    productRepository: runtime.productRepository,
    promotionRepository: runtime.promotionRepository,
    orderRepository: runtime.orderRepository,
    returnRepository: runtime.returnRepository,
    shopBiRepository: runtime.shopBiRepository,
    shopRepository: runtime.shopRepository,
  });

  const summary = {
    mode,
    shopId,
    displayName: profile.displayName || null,
    countryCode: profile.countryCode || null,
    brandCode: profile.brandCode || null,
    timezone: profile.timezone,
    today,
    ok: true,
    steps: [],
  };

  const run = async (name, fn, { required = true } = {}) => {
    const startedAt = Date.now();
    try {
      const result = await fn();
      summary.steps.push({ name, ok: true, required, ms: Date.now() - startedAt, result });
      return result;
    } catch (error) {
      summary.steps.push({
        name,
        ok: false,
        required,
        ms: Date.now() - startedAt,
        error: error && error.message ? error.message : String(error),
      });
      if (required) summary.ok = false;
      return null;
    }
  };

  if (mode === 'daily' && !pilot) {
    await run('shop-info', () => service.syncShopInfo());
  }

  if (!pilot) {
    await run('campaign-settings', () => service.syncCampaignSettings({
      eventDate: today,
      campaignIds: null,
    }));
  }

  const knownGms = await runtime.queryRepository.listKnownGmsCampaignIds({ shopId });
  const gmsCampaignIds = pilot
    ? Array.from(new Set(seededGmsCampaignIds.map(Number))).map(id => {
      assertPilotTypedCampaignAllowed('SHOP_GMV_MAX', id);
      return id;
    })
    : mergeCampaignIds(knownGms, seededGmsCampaignIds);
  const ads = runtime.roleClients.ADS;
  let adsToken = null;

  if (gmsCampaignIds.length) {
    adsToken = await run('ads-token', () => ads.getAccessToken(shopId));
  }

  if (adsToken) {
    for (const campaignId of gmsCampaignIds) {
      await run(`gms-${campaignId}`, () => syncGmsWindow({
        client: ads.client,
        repository: runtime.rawRepository,
        adPromotionRepository: runtime.adPromotionRepository,
        shopId,
        accessToken: adsToken,
        campaignId,
        startDate: addDays(today, -6),
        endDate: today,
      }));
    }
  } else if (!gmsCampaignIds.length) {
    summary.steps.push({
      name: 'gms',
      ok: true,
      required: false,
      skipped: 'NO_KNOWN_GMS_CAMPAIGN',
    });
  }

  if (!pilot) {
    await run('orders-recent', () => service.syncOrders({
      timeFrom: nowEpoch - 3 * 86400,
      timeTo: nowEpoch,
    }));
  }

  if (mode === 'daily' && !pilot) {
    await run('products', () => service.syncProducts({
      updateTimeFrom: nowEpoch - 3 * 86400,
      updateTimeTo: nowEpoch,
    }));

    await run('product-ads-7d', () => service.syncProductAdsDaily({
      startDate: addDays(today, -6),
      endDate: today,
      adTypes: ['manual', 'auto'],
    }), { required: false });

    await run('promotions', () => service.syncPromotions(), { required: false });

    await run('returns', () => service.syncReturns({
      updateTimeFrom: nowEpoch - 14 * 86400,
      updateTimeTo: nowEpoch,
    }), { required: false });

    if (profile.brandPortalTimezone) {
      await run('shop-bi-yesterday', () => service.syncShopBiDay({
        date: yesterday,
        timezone: profile.brandPortalTimezone,
      }), { required: false });
    } else {
      summary.steps.push({
        name: 'shop-bi-yesterday',
        ok: true,
        required: false,
        skipped: 'NO_BRAND_PORTAL_TIMEZONE',
      });
    }

    const activeItemIds = await runtime.queryRepository.listLatestMembershipItemIds({ shopId });
    if (activeItemIds.length) {
      await run(
        'recommended-roi',
        () => service.syncRecommendedRoi({ itemIds: activeItemIds }),
        { required: false },
      );
    } else {
      summary.steps.push({
        name: 'recommended-roi',
        ok: true,
        required: false,
        skipped: 'NO_ACTIVE_MEMBERSHIP',
      });
    }
  }

  summary.failedRequiredSteps = summary.steps
    .filter(step => step.required && step.ok === false)
    .map(step => step.name);
  summary.failedOptionalSteps = summary.steps
    .filter(step => step.required === false && step.ok === false)
    .map(step => step.name);

  return summary;
}

module.exports = { normalizeShopProfile, runShopSyncCycle };
