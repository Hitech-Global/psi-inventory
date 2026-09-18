'use strict';

const express = require('express');
const { analyzeCampaignWindow } = require('./analysis-service');
const { buildShopeeSeaEventCalendar, toEventDateSet } = require('./event-calendar');
const { evaluateItemCoverage, buildSystemWarnings } = require('./data-quality');

function positiveInt(value, name) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) throw new Error(`${name} must be a positive integer`);
  return n;
}

function isoDate(value, name) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) throw new Error(`${name} must be YYYY-MM-DD`);
  return String(value);
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

  router.get('/health', (req, res) => {
    res.json({ ok: true, module: 'shopee-analytics', mode: 'read-only' });
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
  eventSetForRange,
  createShopeeAnalyticsRouter,
};
