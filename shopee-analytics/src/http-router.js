'use strict';

const express = require('express');
const { analyzeCampaignWindow } = require('./analysis-service');
const { buildShopeeSeaEventCalendar, toEventDateSet } = require('./event-calendar');
const { evaluateItemCoverage, buildSystemWarnings } = require('./data-quality');
const { previousPeriod, diagnosePortfolio, diagnoseRow } = require('./portfolio-diagnosis');
const { diagnoseStoreSkus } = require('./store-sku-diagnosis');
const { localIsoDate, addDays } = require('./sync-cycle-utils');
const { daysInclusive } = require('./backfill-utils');
const { sumPerformance } = require('./metrics');
const { productAdDiagnosis } = require('./product-ads-diagnosis');
const { normalizeManualPromotion, normalizeManualItem } = require('./manual-ad-group');
const { parseShopeeAdGroupFile } = require('./shopee-ad-group-import');

function positiveInt(value, name) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) throw new Error(`${name} must be a positive integer`);
  return n;
}

function isoDate(value, name) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) throw new Error(`${name} must be YYYY-MM-DD`);
  return String(value);
}

function optionalCode(value, name) {
  if (value === undefined || value === null || value === '') return null;
  const normalized = String(value).trim().toUpperCase();
  if (!/^[A-Z0-9_-]{1,32}$/.test(normalized)) throw new Error(`${name} contains invalid characters`);
  return normalized;
}

function parseShopIds(value) {
  if (value === undefined || value === null || value === '') return [];
  const ids = String(value)
    .split(',')
    .map(part => Number(part.trim()))
    .filter(Number.isSafeInteger);
  return Array.from(new Set(ids));
}

function eventMixForRange(startDate, endDate) {
  const startYear = Number(startDate.slice(0, 4));
  const endYear = Number(endDate.slice(0, 4));
  const events = [];
  for (let year = startYear; year <= endYear; year += 1) {
    for (const row of buildShopeeSeaEventCalendar(year)) {
      if (row.eventDate >= startDate && row.eventDate <= endDate) events.push(row);
    }
  }
  return {
    totalEventDays: events.length,
    doubleDayCount: events.filter(row => row.eventType === 'DOUBLE_DAY').length,
    payday25Count: events.filter(row => row.eventType === 'PAYDAY_25').length,
    dates: events.map(row => row.eventDate),
  };
}

function comparisonContext(startDate, endDate, previousStartDate, previousEndDate) {
  const currentEventMix = eventMixForRange(startDate, endDate);
  const previousEventMix = eventMixForRange(previousStartDate, previousEndDate);
  const eventMixMismatch =
    currentEventMix.doubleDayCount !== previousEventMix.doubleDayCount ||
    currentEventMix.payday25Count !== previousEventMix.payday25Count;
  return {
    currentEventMix,
    previousEventMix,
    eventMixMismatch,
    warning: eventMixMismatch
      ? '当前周期与上一周期的大促日构成不同，环比只作为经营信号；请结合普通日与活动日明细验证。'
      : null,
  };
}

function eventSetForRange(startDate, endDate) {
  const startYear = Number(startDate.slice(0, 4));
  const endYear = Number(endDate.slice(0, 4));
  const rows = [];
  for (let year = startYear; year <= endYear; year += 1) rows.push(...buildShopeeSeaEventCalendar(year));
  return toEventDateSet(rows.filter(row => row.eventDate >= startDate && row.eventDate <= endDate));
}

function createShopeeAnalyticsRouter({
  repository,
  strategyRepository,
  queryRepository,
  adPromotionRepository = null,
  shopScopeRepository = null,
  backupStatusProvider = async () => null,
  skillReportRepository = null,
  runSkillAnalysis = null,
}) {
  const router = express.Router();

  function scopeError(code, message, status = 422) {
    const error = new Error(message);
    error.code = code;
    error.status = status;
    return error;
  }

  router.get('/shop-scopes', async (req, res, next) => {
    try {
      if (!shopScopeRepository) throw new Error('Shop scope registry is unavailable');
      res.json({ shopScopes: await shopScopeRepository.list() });
    } catch (error) { next(error); }
  });

  router.post('/shop-scopes/import-only', express.json({ limit: '32kb' }), async (req, res, next) => {
    try {
      if (!shopScopeRepository) throw new Error('Shop scope registry is unavailable');
      const shopId = positiveInt(req.body && req.body.shopId, 'shopId');
      const scope = await shopScopeRepository.registerImportOnly({
        shopId,
        operatorLabel: req.body && req.body.operatorLabel,
        importSourceShopName: req.body && req.body.importSourceShopName,
      });
      res.status(201).json({ ok: true, shopScope: scope });
    } catch (error) { next(error); }
  });

  router.get('/shops', async (req, res, next) => {
    try {
      const shops = await queryRepository.listShops({ activeOnly: req.query.include_inactive !== '1' });
      const countries = Array.from(new Map(shops.map(shop => [
        shop.countryCode,
        { code: shop.countryCode, name: shop.countryName || shop.countryCode },
      ])).values()).sort((a, b) => a.code.localeCompare(b.code));
      const brands = Array.from(new Map(shops.map(shop => [
        shop.brandCode,
        { code: shop.brandCode, name: shop.brandName || shop.brandCode },
      ])).values()).sort((a, b) => a.code.localeCompare(b.code));
      res.json({ shops, countries, brands });
    } catch (error) {
      next(error);
    }
  });

  router.get('/shops/:shopId/detail', async (req, res, next) => {
    try {
      const shopId = positiveInt(req.params.shopId, 'shopId');
      const startDate = isoDate(req.query.start_date, 'start_date');
      const endDate = isoDate(req.query.end_date, 'end_date');
      if (startDate > endDate) throw new Error('start_date must be <= end_date');

      const shops = await queryRepository.listShops({ activeOnly: false });
      const shop = shops.find(row => row.shopId === shopId);
      if (!shop) {
        res.status(404).json({ error: 'SHOP_NOT_CONFIGURED', message: `Shop ${shopId} is not configured` });
        return;
      }

      const previous = previousPeriod(startDate, endDate);
      const [currentOverview, previousOverview, daily, skus] = await Promise.all([
        queryRepository.getPortfolioOverview({
          startDate,
          endDate,
          shopIds: [shopId],
        }),
        queryRepository.getPortfolioOverview({
          startDate: previous.startDate,
          endDate: previous.endDate,
          shopIds: [shopId],
        }),
        queryRepository.getShopDailyTrend({ shopId, startDate, endDate }),
        queryRepository.getShopSkuOverview({ shopId, startDate, endDate, limit: 200 }),
      ]);

      const current = currentOverview.shops[0] || null;
      const prior = previousOverview.shops[0] || null;
      const diagnosis = current ? diagnoseRow(current, prior) : null;
      const skuDiagnosis = diagnoseStoreSkus(skus, {
        adSpendRatioLimit: current && current.adSpendRatioLimit != null
          ? current.adSpendRatioLimit
          : 0.15,
      });

      const startYear = Number(startDate.slice(0, 4));
      const endYear = Number(endDate.slice(0, 4));
      const eventMap = new Map();
      for (let year = startYear; year <= endYear; year += 1) {
        for (const row of buildShopeeSeaEventCalendar(year)) {
          if (row.eventDate >= startDate && row.eventDate <= endDate) {
            eventMap.set(row.eventDate, {
              eventType: row.eventType,
              intensity: row.intensity,
              note: row.note,
            });
          }
        }
      }

      res.json({
        shop,
        startDate,
        endDate,
        previousStartDate: previous.startDate,
        previousEndDate: previous.endDate,
        comparisonContext: comparisonContext(
          startDate,
          endDate,
          previous.startDate,
          previous.endDate,
        ),
        current,
        previous: prior,
        diagnosis,
        daily: daily.map(row => ({
          ...row,
          event: eventMap.get(row.eventDate) || null,
        })),
        skus: skuDiagnosis.items,
        skuDiagnosis: {
          cvrMedian: skuDiagnosis.cvrMedian,
          attentionCount: skuDiagnosis.attentionCount,
        },
        productCardExactPeriod: skus.some(row => row.hasProductCard),
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/overview', async (req, res, next) => {
    try {
      const startDate = isoDate(req.query.start_date, 'start_date');
      const endDate = isoDate(req.query.end_date, 'end_date');
      if (startDate > endDate) throw new Error('start_date must be <= end_date');
      const countryCode = optionalCode(req.query.country, 'country');
      const brandCode = optionalCode(req.query.brand, 'brand');
      const shopIds = parseShopIds(req.query.shop_ids);

      const previous = previousPeriod(startDate, endDate);
      const [overview, previousOverview] = await Promise.all([
        queryRepository.getPortfolioOverview({
          startDate,
          endDate,
          countryCode,
          brandCode,
          shopIds,
        }),
        queryRepository.getPortfolioOverview({
          startDate: previous.startDate,
          endDate: previous.endDate,
          countryCode,
          brandCode,
          shopIds,
        }),
      ]);
      const comparison = diagnosePortfolio(overview, previousOverview);

      res.json({
        startDate,
        endDate,
        previousStartDate: previous.startDate,
        previousEndDate: previous.endDate,
        comparisonContext: comparisonContext(
          startDate,
          endDate,
          previous.startDate,
          previous.endDate,
        ),
        filters: { countryCode, brandCode, shopIds },
        ...overview,
        comparison,
        currencyPolicy: overview.dimensions.multiCurrency
          ? 'MONETARY_TOTALS_SPLIT_BY_CURRENCY'
          : 'SINGLE_CURRENCY',
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/health', (req, res) => {
    res.json({ ok: true, module: 'shopee-analytics', mode: 'read-only' });
  });

  router.get('/status/portfolio', async (req, res, next) => {
    try {
      const countryCode = optionalCode(req.query.country, 'country');
      const brandCode = optionalCode(req.query.brand, 'brand');
      const shopIds = new Set(parseShopIds(req.query.shop_ids));

      let shops = await queryRepository.listShops({ activeOnly: true });
      if (countryCode) shops = shops.filter(shop => shop.countryCode === countryCode);
      if (brandCode) shops = shops.filter(shop => shop.brandCode === brandCode);
      if (shopIds.size) shops = shops.filter(shop => shopIds.has(shop.shopId));

      const [statuses, backupStatus] = await Promise.all([
        Promise.all(shops.map(async shop => {
        const status = await queryRepository.getSystemStatus({ shopId: shop.shopId });
        const warnings = buildSystemWarnings(status);
        const errorCount = warnings.filter(warning => warning.severity === 'error').length;
        const warningCount = warnings.filter(warning => warning.severity !== 'error').length;
        const sourceDates = status.sources
          .map(source => source.lastSyncedAt)
          .filter(Boolean)
          .map(value => new Date(value))
          .filter(value => !Number.isNaN(value.getTime()));
        const lastAnySyncAt = sourceDates.length
          ? new Date(Math.max(...sourceDates.map(value => value.getTime()))).toISOString()
          : null;
        return {
          shop,
          ok: errorCount === 0,
          errorCount,
          warningCount,
          lastAnySyncAt,
          sources: status.sources,
          tokens: status.tokens,
          warnings,
        };
        })),
        backupStatusProvider(),
      ]);

      res.json({
        filters: { countryCode, brandCode, shopIds: Array.from(shopIds) },
        backup: backupStatus,
        shopCount: statuses.length,
        okShopCount: statuses.filter(status => status.ok).length,
        errorShopCount: statuses.filter(status => !status.ok).length,
        statuses,
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/status', async (req, res, next) => {
    try {
      const shopId = positiveInt(req.query.shop_id, 'shop_id');
      const [status, shops, backupStatus] = await Promise.all([
        queryRepository.getSystemStatus({ shopId }),
        queryRepository.listShops({ activeOnly: false }),
        backupStatusProvider(),
      ]);
      const shop = shops.find(row => row.shopId === shopId) || null;

      status.warnings = buildSystemWarnings(status);
      status.ok = !status.warnings.some(warning => warning.severity === 'error');

      let historyCoverage = null;
      if (shop && shop.analyticsStartDate) {
        const requestedEndDate = req.query.history_end_date
          ? isoDate(req.query.history_end_date, 'history_end_date')
          : addDays(localIsoDate(new Date(), shop.timezone), -1);

        if (shop.analyticsStartDate <= requestedEndDate) {
          const coverage = await queryRepository.getBackfillCoverage({
            shopId,
            startDate: shop.analyticsStartDate,
            endDate: requestedEndDate,
            timezone: shop.timezone,
          });
          const expectedDays = daysInclusive(shop.analyticsStartDate, requestedEndDate);
          const expectedGmsRows = coverage.campaignCount * expectedDays;
          const backfillStates = (status.syncStates || []).filter(row =>
            String(row.endpointKey || '').startsWith('BACKFILL_')
          );

          historyCoverage = {
            startDate: shop.analyticsStartDate,
            endDate: requestedEndDate,
            expectedDays,
            ...coverage,
            expectedGmsCampaignDayRows: expectedGmsRows,
            gmsCampaignDayCoverage: expectedGmsRows > 0
              ? Math.min(1, coverage.campaignDayRows / expectedGmsRows)
              : null,
            shopBiDayCoverage: Math.min(1, coverage.shopBiDays / expectedDays),
            backfillStateCount: backfillStates.length,
            backfillErrorCount: backfillStates.filter(row => row.lastError).length,
            backfillStates,
            limitations: [
              'Historical campaign membership is only trusted where a real membership snapshot exists.',
              'Orders/returns are event records, so record counts do not have an expected daily coverage percentage.',
              'Product Card exact-period coverage is separate from API backfill.',
            ],
          };
        }
      }

      res.json({
        shopId,
        shop,
        historyCoverage,
        backup: backupStatus,
        ...status,
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/campaigns', async (req, res, next) => {
    try {
      const shopId = positiveInt(req.query.shop_id, 'shop_id');
      const startDate = isoDate(req.query.start_date, 'start_date');
      const endDate = isoDate(req.query.end_date, 'end_date');
      if (startDate > endDate) throw new Error('start_date must be <= end_date');
      const campaigns = await queryRepository.listCampaignOverview({ shopId, startDate, endDate, campaignTypeNormalized: 'GMS' });
      res.json({ shopId, startDate, endDate, campaigns });
    } catch (error) {
      next(error);
    }
  });

  router.get('/ad-promotions', async (req, res, next) => {
    try {
      if (!adPromotionRepository) throw new Error('Unified ad promotions are unavailable');
      const shopId = positiveInt(req.query.shop_id, 'shop_id');
      const startDate = isoDate(req.query.start_date, 'start_date');
      const endDate = isoDate(req.query.end_date, 'end_date');
      const promotionType = req.query.promotion_type || null;
      const dataSource = req.query.data_source || null;
      const campaignStatus = req.query.campaign_status || null;
      const productId = req.query.product_id === undefined ? null : positiveInt(req.query.product_id, 'product_id');
      res.json({ shopId, startDate, endDate, promotions: await adPromotionRepository.list({ shopId, startDate, endDate, promotionType, dataSource, campaignStatus, productId }) });
    } catch (error) { next(error); }
  });

  router.post('/ad-groups/manual', express.json({ limit: '256kb' }), async (req, res, next) => {
    try {
      if (!adPromotionRepository) throw new Error('Unified ad promotions are unavailable');
      const row = normalizeManualPromotion(req.body, { source: 'MANUAL' });
      if (row.promotionType !== 'AD_GROUP') throw new Error('manual endpoint accepts AD_GROUP only');
      if (!shopScopeRepository) throw new Error('Shop scope registry is unavailable');
      if (!await shopScopeRepository.find(row.shopId)) {
        throw scopeError('TARGET_SHOP_NOT_REGISTERED', `Shop ${row.shopId} must be registered before manual import`);
      }
      const items = Array.isArray(req.body && req.body.items) ? req.body.items.map(normalizeManualItem) : [];
      row.itemCount = items.length;
      const saved = await adPromotionRepository.saveWithItems(row, items);
      res.status(201).json({ ok: true, ...saved, itemCount: items.length, dataQualityStatus: row.dataQualityStatus, qualityFlags: row.qualityFlags });
    } catch (error) { next(error); }
  });

  router.post('/ad-groups/import', express.raw({ type: ['text/csv', 'application/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'], limit: '16mb' }), async (req, res, next) => {
    try {
      if (!adPromotionRepository) throw new Error('Unified ad promotions are unavailable');
      if (!req.body || !Buffer.isBuffer(req.body) || !req.body.length) throw new Error('a CSV or XLSX request body is required');
      if (req.query.target_shop_id === undefined || req.query.target_shop_id === '') {
        throw scopeError('TARGET_SHOP_REQUIRED', 'target_shop_id is required for an Ad Group preview or import');
      }
      const targetShopId = positiveInt(req.query.target_shop_id, 'target_shop_id');
      const filename = String(req.query.filename || req.headers['x-filename'] || 'report.csv');
      const { report, preview } = parseShopeeAdGroupFile({ buffer: req.body, filename });
      if (report.metadata.shopId !== targetShopId) {
        throw scopeError(
          'SHOP_SCOPE_MISMATCH',
          `Source shop ${report.metadata.shopId} does not match target shop ${targetShopId}`,
          409,
        );
      }
      const scopedPreview = { ...preview, targetShopId, shopScope: 'MATCH' };
      const persist = req.query.confirm === 'YES';
      if (!persist) { res.json({ ok: true, persisted: false, ...scopedPreview }); return; }
      if (!shopScopeRepository) throw new Error('Shop scope registry is unavailable');
      const targetScope = await shopScopeRepository.find(targetShopId);
      if (!targetScope) {
        throw scopeError('TARGET_SHOP_NOT_REGISTERED', `Shop ${targetShopId} must be explicitly registered before import`);
      }
      await adPromotionRepository.withTransaction(async queryable => {
        for (const entry of report.groups) {
          await adPromotionRepository.saveWithItems(entry.group, entry.items, { queryable });
        }
      });
      res.status(201).json({ ok: true, persisted: true, ...scopedPreview });
    } catch (error) { next(error); }
  });

  router.get('/product-ads', async (req, res, next) => {
    try {
      const shopId = positiveInt(req.query.shop_id, 'shop_id');
      const startDate = isoDate(req.query.start_date, 'start_date');
      const endDate = isoDate(req.query.end_date, 'end_date');
      if (startDate > endDate) throw new Error('start_date must be <= end_date');
      const adType = String(req.query.ad_type || '').toLowerCase();
      if (!['manual', 'auto'].includes(adType)) throw new Error('ad_type must be manual or auto');
      const campaigns = await queryRepository.listProductAdsOverview({ shopId, startDate, endDate, adType });
      res.json({ shopId, startDate, endDate, adType, campaigns });
    } catch (error) {
      next(error);
    }
  });

  router.get('/product-ads/:campaignId/items', async (req, res, next) => {
    try {
      const shopId = positiveInt(req.query.shop_id, 'shop_id');
      const campaignId = positiveInt(req.params.campaignId, 'campaignId');
      const endDate = isoDate(req.query.end_date, 'end_date');
      const items = await queryRepository.listProductAdItems({ shopId, campaignId, endDate });
      res.json({ shopId, campaignId, endDate, items });
    } catch (error) {
      next(error);
    }
  });

  router.get('/product-ads/:campaignId/detail', async (req, res, next) => {
    try {
      const shopId = positiveInt(req.query.shop_id, 'shop_id');
      const campaignId = positiveInt(req.params.campaignId, 'campaignId');
      const startDate = isoDate(req.query.start_date, 'start_date');
      const endDate = isoDate(req.query.end_date, 'end_date');
      if (startDate > endDate) throw new Error('start_date must be <= end_date');
      const adType = String(req.query.ad_type || '').toLowerCase();
      if (!['manual', 'auto'].includes(adType)) throw new Error('ad_type must be manual or auto');

      const campaigns = await queryRepository.listProductAdsOverview({ shopId, startDate, endDate, adType });
      const campaign = campaigns.find(row => row.campaignId === campaignId);
      if (!campaign) {
        res.status(404).json({ error: 'PRODUCT_AD_NOT_FOUND', message: `Campaign ${campaignId} is not a ${adType} Product Ad` });
        return;
      }

      const [latestSetting, items, daily, shopStrategy] = await Promise.all([
        queryRepository.getLatestCampaignSetting({ shopId, campaignId }),
        queryRepository.listProductAdItems({ shopId, campaignId, endDate }),
        repository.loadCampaignDaily({ shopId, campaignId, startDate, endDate }),
        strategyRepository && typeof strategyRepository.getShopStrategy === 'function'
          ? strategyRepository.getShopStrategy(shopId)
          : Promise.resolve({ weeklyOrderReference: 25 }),
      ]);

      let breakEvenRoas = 0;
      let breakEvenByItem = {};
      if (strategyRepository && typeof strategyRepository.getItemBreakEvenMap === 'function' && items.length) {
        const map = await strategyRepository.getItemBreakEvenMap({
          shopId,
          itemIds: items.map(item => item.itemId),
        });
        breakEvenByItem = Object.fromEntries(
          items.map(item => [String(item.itemId), Number(map.get(String(item.itemId)) || 0)]),
        );
        if (adType === 'manual' && items.length === 1) {
          breakEvenRoas = breakEvenByItem[String(items[0].itemId)] || 0;
        }
      }

      const raw = latestSetting && latestSetting.raw || {};
      const autoInfo = Array.isArray(raw.auto_product_ads_info) ? raw.auto_product_ads_info : [];
      const autoStatusMap = new Map(autoInfo.map(row => [String(row.item_id), row.status || null]));
      const detailedItems = items.map(item => ({
        ...item,
        autoProductStatus: autoStatusMap.get(String(item.itemId)) || null,
        breakEvenRoas: breakEvenByItem[String(item.itemId)] || 0,
      }));

      const performance = sumPerformance(daily);
      const diagnosis = productAdDiagnosis({
        performance,
        days: daysInclusive(startDate, endDate),
        targetRoas: latestSetting && latestSetting.targetRoas || campaign.targetRoas || 0,
        breakEvenRoas,
        weeklyOrderReference: Number(shopStrategy.weeklyOrderReference || 25),
        adType,
        itemCount: detailedItems.length,
      });

      res.json({
        shopId,
        campaignId,
        adType,
        startDate,
        endDate,
        campaign,
        latestSetting: latestSetting ? {
          status: latestSetting.status,
          biddingMethod: latestSetting.biddingMethod,
          campaignBudget: latestSetting.campaignBudget,
          targetRoas: latestSetting.targetRoas,
          observedAt: latestSetting.observedAt,
          adName: raw.common_info && raw.common_info.ad_name || campaign.adName || null,
          campaignPlacement: raw.common_info && raw.common_info.campaign_placement || campaign.campaignPlacement || null,
          enhancedCpc: raw.manual_bidding_info && raw.manual_bidding_info.enhanced_cpc,
          selectedKeywordCount: Array.isArray(raw.manual_bidding_info && raw.manual_bidding_info.selected_keywords)
            ? raw.manual_bidding_info.selected_keywords.length
            : 0,
        } : null,
        diagnosis,
        items: detailedItems,
        daily: daily.map(row => ({
          eventDate: String(row.event_date).slice(0, 10),
          performance: sumPerformance([row]),
        })),
        itemPerformanceAvailable: false,
        itemPerformanceNote: adType === 'auto'
          ? '当前接入的 Product Ads 日表现接口提供 Campaign 级数据；自动选品只展示真实 Membership/状态，不伪造 SKU 贡献。'
          : null,
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/campaigns/:campaignId/analysis', async (req, res, next) => {
    try {
      const shopId = positiveInt(req.query.shop_id, 'shop_id');
      const campaignId = positiveInt(req.params.campaignId, 'campaignId');
      const startDate = isoDate(req.query.start_date, 'start_date');
      const endDate = isoDate(req.query.end_date, 'end_date');
      if (startDate > endDate) throw new Error('start_date must be <= end_date');

      const latest = await queryRepository.getLatestCampaignSetting({ shopId, campaignId });
      const targetRoas = req.query.target_roas === undefined
        ? Number(latest && latest.targetRoas || 0)
        : Number(req.query.target_roas);
      const breakEvenRoas = Number(req.query.break_even_roas || 0);

      const analysis = await analyzeCampaignWindow({
        repository,
        strategyRepository,
        shopId,
        campaignId,
        startDate,
        endDate,
        targetRoas,
        breakEvenRoas,
        campaignBudget: latest && latest.campaignBudget,
        eventDateSet: eventSetForRange(startDate, endDate),
      });

      const ids = analysis.diagnosis.items.map(item => item.itemId).filter(Boolean);
      const [names, recommended, productCard, coverageContext] = await Promise.all([
        queryRepository.getCampaignItemNames({ shopId, itemIds: ids }),
        queryRepository.getLatestRecommendedRoiMap({ shopId, itemIds: ids }),
        queryRepository.getProductCardPeriodMap({ shopId, startDate, endDate, itemIds: ids }),
        queryRepository.getCampaignCoverageContext({ shopId, campaignId, startDate, endDate }),
      ]);
      analysis.diagnosis.items = analysis.diagnosis.items.map(item => ({
        ...item,
        ...(names.get(String(item.itemId)) || {}),
        recommendedRoi: recommended.get(String(item.itemId)) || null,
        productCard: productCard.get(String(item.itemId)) || null,
      }));
      analysis.latestSetting = latest;
      analysis.dataQuality = evaluateItemCoverage({
        campaignExpense: analysis.diagnosis.campaign.expense,
        itemExpense: coverageContext.itemExpense,
        membershipCount: coverageContext.membershipCount,
        performanceItemCount: coverageContext.performanceItemCount,
      });
      analysis.dataQuality.storedItemCount = coverageContext.storedItemCount;
      res.json(analysis);
    } catch (error) {
      next(error);
    }
  });

  router.get('/campaigns/:campaignId/skill-report', async (req, res, next) => {
    try {
      if (!skillReportRepository) throw new Error('Skill report repository is not configured');
      const shopId = positiveInt(req.query.shop_id, 'shop_id');
      const campaignId = positiveInt(req.params.campaignId, 'campaignId');
      const report = await skillReportRepository.latest({ shopId, campaignId });
      if (!report) {
        res.status(404).json({ error: 'SKILL_REPORT_NOT_FOUND' });
        return;
      }
      res.json(report);
    } catch (error) {
      next(error);
    }
  });

  router.post('/campaigns/:campaignId/skill-report', express.json({ limit: '32kb' }), async (req, res, next) => {
    try {
      if (typeof runSkillAnalysis !== 'function') throw new Error('Skill execution is not configured');
      const shopId = positiveInt(req.query.shop_id, 'shop_id');
      const campaignId = positiveInt(req.params.campaignId, 'campaignId');
      const startDate = isoDate(req.body && req.body.start_date, 'start_date');
      const endDate = isoDate(req.body && req.body.end_date, 'end_date');
      if (startDate > endDate) throw new Error('start_date must be <= end_date');
      const result = await runSkillAnalysis({
        shopId,
        campaignId,
        startDate,
        endDate,
        triggerType: 'MANUAL',
        triggerReason: req.body && req.body.reason ? String(req.body.reason).slice(0, 500) : null,
      });
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  });

  router.get('/items/:itemId/timeline', async (req, res, next) => {
    try {
      const shopId = positiveInt(req.query.shop_id, 'shop_id');
      const itemId = positiveInt(req.params.itemId, 'itemId');
      const startDate = isoDate(req.query.start_date, 'start_date');
      const endDate = isoDate(req.query.end_date, 'end_date');
      if (startDate > endDate) throw new Error('start_date must be <= end_date');
      const events = await queryRepository.getItemTimeline({
        shopId, itemId, startDate, endDate,
      });
      res.json({ shopId, itemId, startDate, endDate, events });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = {
  positiveInt,
  isoDate,
  optionalCode,
  parseShopIds,
  eventMixForRange,
  comparisonContext,
  eventSetForRange,
  createShopeeAnalyticsRouter,
};
