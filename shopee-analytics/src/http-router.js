'use strict';

const express = require('express');
const { analyzeCampaignWindow } = require('./analysis-service');
const { buildShopeeSeaEventCalendar, toEventDateSet } = require('./event-calendar');
const { evaluateItemCoverage, buildSystemWarnings } = require('./data-quality');
const { previousPeriod, diagnosePortfolio, diagnoseRow } = require('./portfolio-diagnosis');
const { diagnoseStoreSkus } = require('./store-sku-diagnosis');

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
}) {
  const router = express.Router();

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
      const skuDiagnosis = diagnoseStoreSkus(skus);

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

      const statuses = await Promise.all(shops.map(async shop => {
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
      }));

      res.json({
        filters: { countryCode, brandCode, shopIds: Array.from(shopIds) },
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
      const status = await queryRepository.getSystemStatus({ shopId });
      status.warnings = buildSystemWarnings(status);
      status.ok = !status.warnings.some(warning => warning.severity === 'error');
      res.json({ shopId, ...status });
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
      const campaigns = await queryRepository.listCampaignOverview({ shopId, startDate, endDate });
      res.json({ shopId, startDate, endDate, campaigns });
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
