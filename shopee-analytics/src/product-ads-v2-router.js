'use strict';

const express = require('express');
const { ShopeeProductAdsShopRepository, summarizeProductAdsRows } = require('./product-ads-shop-repository');
const { normalizeShopProductAdsPayload } = require('./sync-product-ads-overview');

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

function dateOnlyIso(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') {
    const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
    if (match) return match[1];
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  const raw = String(value);
  const match = raw.match(/(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return raw.slice(0, 10);
}

function addIsoDays(value, amount) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function dateCoverage(startDate, endDate, rows = []) {
  const available = new Set(rows.map(row => dateOnlyIso(row.eventDate ?? row.event_date)).filter(Boolean));
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
    eventDate: dateOnlyIso(row.event_date),
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

const RECON_FIELDS = [
  'impressions', 'clicks', 'ctr', 'directOrders', 'broadOrders', 'directUnits', 'broadUnits',
  'directCvr', 'broadCvr', 'directGmv', 'broadGmv', 'expense', 'cpc', 'costPerConversion',
  'costPerDirectConversion', 'directRoas', 'broadRoas', 'directAcos', 'broadAcos',
];

function equivalentNumber(left, right, tolerance = 1e-9) {
  if (left == null && right == null) return true;
  if (left == null || right == null) return false;
  return Math.abs(Number(left) - Number(right)) <= tolerance;
}

function reconcileRows(rawRows, dbRows, startDate, endDate) {
  const rawMap = new Map(rawRows
    .map(row => ({ ...row, eventDate: dateOnlyIso(row.eventDate) }))
    .filter(row => row.eventDate >= startDate && row.eventDate <= endDate)
    .map(row => [row.eventDate, row]));
  const dbMap = new Map(dbRows
    .map(row => ({ ...row, eventDate: dateOnlyIso(row.eventDate) }))
    .map(row => [row.eventDate, row]));
  const dates = Array.from(new Set([...rawMap.keys(), ...dbMap.keys()])).sort();
  const mismatches = [];
  for (const date of dates) {
    const raw = rawMap.get(date);
    const db = dbMap.get(date);
    if (!raw || !db) {
      mismatches.push({ date, field: 'ROW', raw: Boolean(raw), db: Boolean(db) });
      continue;
    }
    for (const field of RECON_FIELDS) {
      if (!equivalentNumber(raw[field], db[field])) {
        mismatches.push({ date, field, raw: raw[field] ?? null, db: db[field] ?? null });
      }
    }
  }
  return {
    rawDays: rawMap.size,
    dbDays: dbMap.size,
    mismatchCount: mismatches.length,
    match: mismatches.length === 0,
    mismatches,
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

  router.get('/product-ads/overview/reconciliation', async (req, res, next) => {
    try {
      const shopId = requirePositiveInt(req.query.shop_id, 'shop_id');
      const startDate = requireIsoDate(req.query.start_date, 'start_date');
      const endDate = requireIsoDate(req.query.end_date, 'end_date');
      if (startDate > endDate) throw new Error('start_date must be <= end_date');

      const [snapshotResult, dbRows] = await Promise.all([
        pool.query(
          `SELECT id,response_json,synced_at,event_date_from::text AS event_date_from,event_date_to::text AS event_date_to
           FROM shopee_raw_api_snapshots
           WHERE endpoint_key='adsAllCpcDailyPerformance'
             AND shop_id=$1
             AND event_date_from <= $2::date
             AND event_date_to >= $3::date
           ORDER BY synced_at DESC
           LIMIT 1`,
          [shopId, startDate, endDate],
        ),
        repository.list({ shopId, startDate, endDate }),
      ]);

      const snapshot = snapshotResult.rows[0] || null;
      if (!snapshot) {
        res.status(404).json({
          error: 'PRODUCT_CARD_RAW_SNAPSHOT_NOT_FOUND',
          shopId,
          startDate,
          endDate,
          message: 'No raw Product Card API snapshot fully covers the requested period.',
        });
        return;
      }

      const rawRows = normalizeShopProductAdsPayload(snapshot.response_json);
      const serializedDbRows = dbRows.map(serializeRow);
      const reconciliation = reconcileRows(rawRows, serializedDbRows, startDate, endDate);
      res.json({
        shopId,
        startDate,
        endDate,
        source: 'SHOPEE_API_ALL_CPC_DAILY',
        snapshot: {
          id: Number(snapshot.id),
          syncedAt: snapshot.synced_at,
          eventDateFrom: dateOnlyIso(snapshot.event_date_from),
          eventDateTo: dateOnlyIso(snapshot.event_date_to),
        },
        reconciliation,
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = {
  createProductAdsV2Router,
  dateOnlyIso,
  serializeRow,
  dateCoverage,
  reconcileRows,
  equivalentNumber,
};
