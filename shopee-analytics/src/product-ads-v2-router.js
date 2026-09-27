'use strict';

const express = require('express');
const { ShopeeProductAdsShopRepository, summarizeProductAdsRows } = require('./product-ads-shop-repository');

function requirePositiveInt(value, name) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) throw new Error(`${name} must be a positive integer`);
  return n;
}

function requireIsoDate(value, name) {
  const raw = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new Error(`${name} must be YYYY-MM-DD`);
  return raw;
}

function addIsoDays(value, amount) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function dateCoverage(startDate, endDate, rows = []) {
  const available = new Set(rows.map(row => String(row.eventDate || row.event_date).slice(0, 10)));
  const expectedDates = [];
  for (let date = startDate; date <= endDate; date = addIsoDays(date, 1)) expectedDates.push(date);
  const missingDates = expectedDates.filter(date => !available.has(date));
  return {
    expectedDays: expectedDates.length,
    availableDays: expectedDates.length - missingDates.length,
    missingDays: missingDates.length,
    missingDates,
    complete: missingDates.length === 0,
  };
}

function serializeRow(row) {
  return {
    shopId: Number(row.shop_id),
    eventDate: String(row.event_date).slice(0, 10),
    impressions: Number(row.impressions || 0),
    clicks: Number(row.clicks || 0),
    ctr: row.ctr == null ? null : Number(row.ctr),
    directOrders: Number(row.direct_orders || 0),
    broadOrders: Number(row.broad_orders || 0),
    directUnits: Number(row.direct_units || 0),
    broadUnits: Number(row.broad_units || 0),
    directCvr: row.direct_cvr == null ? null : Number(row.direct_cvr),
    broadCvr: row.broad_cvr == null ? null : Number(row.broad_cvr),
    directGmv: row.direct_gmv == null ? null : Number(row.direct_gmv),
    broadGmv: row.broad_gmv == null ? null : Number(row.broad_gmv),
    expense: row.expense == null ? null : Number(row.expense),
    cpc: row.cpc == null ? null : Number(row.cpc),
    costPerConversion: row.cost_per_conversion == null ? null : Number(row.cost_per_conversion),
    costPerDirectConversion: row.cost_per_direct_conversion == null ? null : Number(row.cost_per_direct_conversion),
    directRoas: row.direct_roas == null ? null : Number(row.direct_roas),
    broadRoas: row.broad_roas == null ? null : Number(row.broad_roas),
    directAcos: row.direct_acos == null ? null : Number(row.direct_acos),
    broadAcos: row.broad_acos == null ? null : Number(row.broad_acos),
    syncedAt: row.synced_at || null,
  };
}

function createProductAdsV2Router({ pool }) {
  const router = express.Router();
  const repository = new ShopeeProductAdsShopRepository({ pool });

  router.get('/product-ads/overview', async (req, res, next) => {
    try {
      const shopId = requirePositiveInt(req.query.shop_id, 'shop_id');
      const startDate = requireIsoDate(req.query.start_date, 'start_date');
      const endDate = requireIsoDate(req.query.end_date, 'end_date');
      if (startDate > endDate) throw new Error('start_date must be <= end_date');
      const dbRows = await repository.list({ shopId, startDate, endDate });
      const rows = dbRows.map(serializeRow);
      const coverage = dateCoverage(startDate, endDate, rows);
      res.json({
        shopId,
        startDate,
        endDate,
        source: 'SHOPEE_API_ALL_CPC_DAILY',
        sourceEndpoint: '/api/v2/ads/get_all_cpc_ads_daily_performance',
        sourceScope: 'SHOP_LEVEL_CPC_ADS',
        dataAvailable: rows.length > 0,
        coverage,
        daily: rows,
        summary: summarizeProductAdsRows(rows),
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { createProductAdsV2Router, serializeRow, dateCoverage };
