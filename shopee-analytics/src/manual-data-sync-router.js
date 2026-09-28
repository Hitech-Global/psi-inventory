'use strict';

const express = require('express');
const { createSyncRuntime } = require('./sync-runtime');
const { ShopeeShopProfileRepository } = require('./shop-profile-repository');
const { runBackfillShop } = require('./backfill-runner');
const { daysInclusive } = require('./backfill-utils');
const { assertOnlineOperationAllowed } = require('./deployment-mode');

const ALLOWED_SOURCES = new Set(['product-ads', 'gms']);

function positiveInt(value, name) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new Error(`${name} must be a positive integer`);
  return number;
}

function isoDate(value, name) {
  const text = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(`${name} must be YYYY-MM-DD`);
  return text;
}

function requestSources(value) {
  const raw = Array.isArray(value) && value.length ? value : ['product-ads', 'gms'];
  const sources = Array.from(new Set(raw.map(item => String(item).trim().toLowerCase()).filter(Boolean)));
  const invalid = sources.filter(source => !ALLOWED_SOURCES.has(source));
  if (invalid.length) throw new Error(`Unsupported manual sync source: ${invalid.join(', ')}`);
  return sources;
}

function createManualDataSyncRouter({ pool, runtimeFactory = () => createSyncRuntime({ pool }) } = {}) {
  if (!pool) throw new Error('pool is required');
  const router = express.Router();
  const profileRepository = new ShopeeShopProfileRepository({ pool });

  router.post('/data/sync-range', express.json({ limit: '16kb' }), async (req, res, next) => {
    try {
      assertOnlineOperationAllowed('Manual Shopee data sync');
      const shopId = positiveInt(req.body?.shop_id ?? req.body?.shopId, 'shop_id');
      const startDate = isoDate(req.body?.start_date ?? req.body?.startDate, 'start_date');
      const endDate = isoDate(req.body?.end_date ?? req.body?.endDate, 'end_date');
      if (startDate > endDate) throw new Error('start_date must be <= end_date');
      const days = daysInclusive(startDate, endDate);
      if (days > 366) throw new Error('Manual data sync range cannot exceed 366 days');

      const sources = requestSources(req.body?.sources);
      const shops = await profileRepository.list({ activeOnly: false });
      const shop = shops.find(row => row.shopId === shopId);
      if (!shop) {
        const error = new Error(`Shop ${shopId} is not configured`);
        error.code = 'SHOP_NOT_CONFIGURED'; error.status = 404; throw error;
      }
      if (!shop.oauthAuthorized || shop.dataSourceCapability === 'MANUAL_IMPORT_ONLY') {
        const error = new Error(`Shop ${shopId} does not have an authorized Shopee ADS API connection`);
        error.code = 'ADS_TOKEN_REQUIRED'; error.status = 422; throw error;
      }

      const runtime = runtimeFactory();
      const summary = await runBackfillShop({
        runtime,
        shop,
        startDate,
        endDate,
        sources,
        seededGmsCampaignIds: shop.gmsCampaignSeedIds || [],
        refreshCurrentMetadata: true,
        forceRefresh: true,
      });
      res.json({ ok: summary.ok, shopId, startDate, endDate, sources, summary });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { createManualDataSyncRouter, requestSources };
