'use strict';

const { ShopeeSyncService } = require('./sync-service');
const { syncGmsWindow } = require('./sync-window');
const { discoverGmsCampaign } = require('./sync-gms');
const { syncProductAdsOverviewWindow } = require('./sync-product-ads-overview');
const { localIsoDate, addDays, mergeCampaignIds } = require('./sync-cycle-utils');
const {
  daysInclusive,
  chunkDateRange,
  localDateRangeEpoch,
  completedThrough,
} = require('./backfill-utils');
const { isPilotGmvMax } = require('./deployment-mode');

function serviceFor(runtime, shopId) {
  return new ShopeeSyncService({
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
}

async function runChunked({
  runtime,
  shopId,
  appRole,
  endpointKey,
  requestedStartDate,
  requestedEndDate,
  chunkDays,
  runner,
  resume = true,
  onProgress = null,
}) {
  const state = resume && typeof runtime.rawRepository.getSyncState === 'function'
    ? await runtime.rawRepository.getSyncState({ appRole, endpointKey, shopId })
    : null;
  const resumeThrough = completedThrough(state, requestedStartDate, requestedEndDate);
  const effectiveStart = resumeThrough ? addDays(resumeThrough, 1) : requestedStartDate;

  if (effectiveStart > requestedEndDate) {
    return {
      endpointKey,
      resumed: Boolean(resumeThrough),
      completedThrough: requestedEndDate,
      chunks: 0,
      skipped: 'ALREADY_COMPLETE',
    };
  }

  const chunks = chunkDateRange(effectiveStart, requestedEndDate, chunkDays);
  const results = [];
  if (onProgress) onProgress({
    type: 'chunk-start', endpointKey, totalChunks: chunks.length,
    completedChunks: 0, requestedStartDate, requestedEndDate,
  });

  for (const chunk of chunks) {
    try {
      const result = await runner(chunk);
      await runtime.rawRepository.markSyncSuccess({
        appRole,
        endpointKey,
        shopId,
        cursor: {
          requestedStartDate,
          requestedEndDate,
          completedThrough: chunk.endDate,
        },
      });
      results.push({ ...chunk, ok: true, result });
      if (onProgress) onProgress({
        type: 'chunk-complete', endpointKey, totalChunks: chunks.length,
        completedChunks: results.length, chunk,
      });
    } catch (error) {
      await runtime.rawRepository.markSyncFailure({
        appRole,
        endpointKey,
        shopId,
        error,
      });
      error.backfillChunk = chunk;
      error.backfillEndpointKey = endpointKey;
      throw error;
    }
  }

  return {
    endpointKey,
    resumed: Boolean(resumeThrough),
    resumedFrom: resumeThrough,
    completedThrough: requestedEndDate,
    chunks: results.length,
    results,
  };
}

async function runBackfillShop({
  runtime,
  shop,
  startDate,
  endDate,
  sources,
  seededGmsCampaignIds = [],
  now = new Date(),
  refreshCurrentMetadata = true,
  forceRefresh = false,
  onProgress = null,
}) {
  if (!runtime) throw new Error('runtime is required');
  if (!shop || !shop.shopId) throw new Error('shop is required');
  if (!shop.timezone) throw new Error(`Shop ${shop.shopId} timezone is required`);

  const shopId = Number(shop.shopId);
  const sourceSet = new Set(sources || []);
  const service = serviceFor(runtime, shopId);
  const today = localIsoDate(now, shop.timezone);
  const summary = {
    shopId,
    displayName: shop.displayName || null,
    countryCode: shop.countryCode || null,
    brandCode: shop.brandCode || null,
    timezone: shop.timezone,
    startDate,
    endDate,
    days: daysInclusive(startDate, endDate),
    ok: true,
    steps: [],
    warnings: [],
  };

  const emitProgress = event => { if (onProgress) onProgress(event); };
  const runChunk = args => runChunked({ ...args, resume: !forceRefresh, onProgress: emitProgress });
  const run = async (name, fn, { required = true, redactResult = false } = {}) => {
    const startedAt = Date.now();
    emitProgress({ type: 'step-start', name, required });
    try {
      const result = await fn();
      summary.steps.push({
        name, ok: true, required, ms: Date.now() - startedAt,
        result: redactResult ? 'AVAILABLE' : result,
      });
      emitProgress({ type: 'step-complete', name, required, ok: true });
      return result;
    } catch (error) {
      const failedStep = {
        name,
        ok: false,
        required,
        ms: Date.now() - startedAt,
        error: error && error.message ? error.message : String(error),
        chunk: error && error.backfillChunk ? error.backfillChunk : undefined,
      };
      summary.steps.push(failedStep);
      emitProgress({ type: 'step-complete', ...failedStep });
      if (required) summary.ok = false;
      return null;
    }
  };

  if (sourceSet.has('shop-info')) {
    await run('shop-info-current', () => service.syncShopInfo());
  }

  // Campaign settings are current-state metadata. Never backdate today's
  // membership snapshot into a historical date.
  if (refreshCurrentMetadata && (sourceSet.has('campaigns') || sourceSet.has('gms') || sourceSet.has('roi'))) {
    await run('campaign-settings-current', () =>
      service.syncCampaignSettings({ eventDate: today }));
  }

  if (sourceSet.has('products')) {
    await run('products-current', () => service.syncProducts());
    summary.warnings.push({
      code: 'PRODUCT_MASTER_IS_CURRENT_STATE',
      message: 'Product API backfill stores the current product/model state; it does not reconstruct historical product attributes.',
    });
  }

  if (sourceSet.has('promotions')) {
    await run('promotions-retained-history', () => service.syncPromotions({ discountStatus: 'all' }));
    summary.warnings.push({
      code: 'PROMOTION_HISTORY_PLATFORM_RETENTION',
      message: 'Voucher/Discount backfill is limited to records still returned by Shopee; it is not assumed to be a complete immutable history.',
    });
  }

  if (sourceSet.has('product-ads')) {
    const ads = runtime.roleClients.ADS;
    const accessToken = await run('ads-token-for-product-ads-history', () => ads.getAccessToken(shopId), { redactResult: true });
    if (accessToken) {
      await run('product-ads-overview-history', () => runChunk({
        runtime, shopId, appRole: 'ADS', endpointKey: 'BACKFILL_PRODUCT_ADS_OVERVIEW',
        requestedStartDate: startDate, requestedEndDate: endDate, chunkDays: 7,
        runner: chunk => syncProductAdsOverviewWindow({
          client: ads.client, repository: runtime.productAdsShopRepository, rawRepository: runtime.rawRepository,
          shopId, accessToken, startDate: chunk.startDate, endDate: chunk.endDate,
        }),
      }));
      await run('product-ads-campaign-history', () => runChunk({
        runtime, shopId, appRole: 'ADS', endpointKey: 'BACKFILL_PRODUCT_ADS_CAMPAIGNS',
        requestedStartDate: startDate, requestedEndDate: endDate, chunkDays: 7,
        runner: chunk => service.syncProductAdsDaily({
          startDate: chunk.startDate, endDate: chunk.endDate, adTypes: ['manual', 'auto'], includeSettings: false,
        }),
      }));
    }
  }

  let gmsCampaignIds = [];
  if (sourceSet.has('gms')) {
    const known = await run(
      'discover-known-gms',
      () => runtime.queryRepository.listKnownGmsCampaignIds({ shopId }),
    );
    gmsCampaignIds = mergeCampaignIds(
      Array.isArray(known) ? known : [],
      [
        ...(seededGmsCampaignIds || []),
        ...(shop.gmsCampaignSeedIds || []),
      ],
    );

    const ads = runtime.roleClients.ADS;
    const accessToken = await run('ads-token-for-gms', () => ads.getAccessToken(shopId), { redactResult: true });
    if (accessToken && !gmsCampaignIds.length && !isPilotGmvMax()) {
      const discoveryStart = addDays(endDate, -6) < startDate ? startDate : addDays(endDate, -6);
      const discovered = await run('gms-discovery-history-window', async () => {
        const result = await discoverGmsCampaign({
          client: ads.client,
          shopId,
          accessToken,
          startDate: discoveryStart,
          endDate,
        });
        await runtime.rawRepository.upsertCampaign({
          shopId,
          campaignId: result.campaignId,
          campaignTypeRaw: 'GMS',
          campaignTypeNormalized: 'GMS',
        });
        return { campaignId: result.campaignId };
      }, { required: false });
      if (discovered?.campaignId) gmsCampaignIds = [Number(discovered.campaignId)];
    }

    if (!gmsCampaignIds.length) {
      summary.warnings.push({
        code: 'NO_GMS_CAMPAIGN_IDS',
        message: 'No known/seeded/discovered GMS campaign ID is available for the requested period.',
      });
      summary.steps.push({
        name: 'gms-history',
        ok: true,
        required: false,
        skipped: 'NO_GMS_CAMPAIGN_IDS',
      });
    } else if (accessToken) {
      for (const campaignId of gmsCampaignIds) {
        await run(`gms-history-${campaignId}`, () => runChunk({
          runtime,
          shopId,
          appRole: 'ADS',
          endpointKey: `BACKFILL_GMS_${campaignId}`,
          requestedStartDate: startDate,
          requestedEndDate: endDate,
          chunkDays: 7,
          runner: chunk => syncGmsWindow({
            client: ads.client,
            repository: runtime.rawRepository,
            adPromotionRepository: runtime.adPromotionRepository,
            shopId,
            accessToken,
            campaignId,
            startDate: chunk.startDate,
            endDate: chunk.endDate,
          }),
        }));
      }
    }

    summary.warnings.push({
      code: 'HISTORICAL_MEMBERSHIP_NOT_RECONSTRUCTED',
      message: 'Historical GMS item performance is backfilled, but past full campaign membership cannot be reconstructed from item-performance results. Zero-performance membership is only trusted from real membership snapshots.',
    });
  }

  if (sourceSet.has('orders')) {
    await run('orders-history', () => runChunk({
      runtime,
      shopId,
      appRole: 'ADS',
      endpointKey: 'BACKFILL_ORDERS',
      requestedStartDate: startDate,
      requestedEndDate: endDate,
      chunkDays: 14,
      runner: async chunk => {
        const epoch = localDateRangeEpoch(chunk.startDate, chunk.endDate, shop.timezone);
        return service.syncOrders({
          timeFrom: epoch.timeFrom,
          timeTo: epoch.timeTo,
          timeRangeField: 'create_time',
        });
      },
    }));
  }

  if (sourceSet.has('returns')) {
    await run('returns-history', () => runChunk({
      runtime,
      shopId,
      appRole: 'ERP',
      endpointKey: 'BACKFILL_RETURNS',
      requestedStartDate: startDate,
      requestedEndDate: endDate,
      chunkDays: 7,
      runner: async chunk => {
        const epoch = localDateRangeEpoch(chunk.startDate, chunk.endDate, shop.timezone);
        return service.syncReturns({
          createTimeFrom: epoch.timeFrom,
          createTimeTo: epoch.timeTo,
        });
      },
    }));
  }

  if (sourceSet.has('shop-bi')) {
    if (!shop.brandPortalTimezone || !shop.brandPortalPrincipalId) {
      summary.steps.push({
        name: 'shop-bi-history',
        ok: false,
        required: true,
        error: !shop.brandPortalTimezone ? 'brandPortalTimezone is not configured' : 'brandPortalPrincipalId is not configured',
      });
      summary.ok = false;
    } else {
      await run('shop-bi-history', () => runChunk({
        runtime,
        shopId,
        appRole: 'BRAND_PORTAL',
        endpointKey: 'BACKFILL_SHOP_BI',
        requestedStartDate: startDate,
        requestedEndDate: endDate,
        chunkDays: 1,
        runner: chunk => service.syncShopBiDay({
          date: chunk.startDate,
          timezone: shop.brandPortalTimezone,
          principalId: shop.brandPortalPrincipalId,
        }),
      }));
    }
  }

  if (sourceSet.has('roi')) {
    const activeItemIds = await run(
      'active-membership-items',
      () => runtime.queryRepository.listLatestMembershipItemIds({ shopId }),
      { required: false },
    );
    if (activeItemIds && activeItemIds.length) {
      await run(
        'recommended-roi-current',
        () => service.syncRecommendedRoi({ itemIds: activeItemIds }),
        { required: false },
      );
    } else {
      summary.steps.push({
        name: 'recommended-roi-current',
        ok: true,
        required: false,
        skipped: 'NO_ACTIVE_MEMBERSHIP',
      });
    }
    summary.warnings.push({
      code: 'RECOMMENDED_ROI_IS_CURRENT_STATE',
      message: 'Recommended ROI is sampled at sync time; historical recommendation values are not reconstructed.',
    });
  }

  summary.warnings.push({
    code: 'PRODUCT_CARD_REQUIRES_IMPORT',
    message: 'Item-level Business Insights Product Card remains a separate exact-period import when no item-level BI API is available.',
  });

  const coverage = await run(
    'coverage-check',
    () => runtime.queryRepository.getBackfillCoverage({
      shopId,
      startDate,
      endDate,
      timezone: shop.timezone,
    }),
    { required: false },
  );

  if (coverage) {
    const expectedDays = daysInclusive(startDate, endDate);
    summary.coverage = {
      ...coverage,
      expectedDays,
      gmsCampaignIds,
      expectedGmsCampaignDayRows: gmsCampaignIds.length * expectedDays,
      gmsCampaignDayCoverage: gmsCampaignIds.length
        ? Math.min(1, coverage.campaignDayRows / (gmsCampaignIds.length * expectedDays))
        : null,
      shopBiDayCoverage: sourceSet.has('shop-bi')
        ? Math.min(1, coverage.shopBiDays / expectedDays)
        : null,
    };
  }

  summary.failedRequiredSteps = summary.steps
    .filter(step => step.required && step.ok === false)
    .map(step => step.name);

  return summary;
}

module.exports = {
  serviceFor,
  runChunked,
  runBackfillShop,
};
