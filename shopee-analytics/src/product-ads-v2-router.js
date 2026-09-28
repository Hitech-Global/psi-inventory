'use strict';

const express = require('express');
const { ShopeeProductAdsShopRepository, summarizeProductAdsRows } = require('./product-ads-shop-repository');
const { ShopeeProductAdsOverviewEvidenceRepository } = require('./product-ads-overview-evidence');
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

function rawOptional(raw, names) {
  for (const name of names) {
    const value = raw && raw[name];
    if (value !== null && value !== undefined && value !== '') {
      const n = Number(value);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

function serializeRow(row) {
  const impressions = Number(row.impressions || 0);
  const clicks = Number(row.clicks || 0);
  const directOrders = Number(row.direct_orders || 0);
  const broadOrders = Number(row.broad_orders || 0);
  const directGmv = row.direct_gmv == null ? null : Number(row.direct_gmv);
  const broadGmv = row.broad_gmv == null ? null : Number(row.broad_gmv);
  const expense = row.expense == null ? null : Number(row.expense);
  const raw = row.raw_json && typeof row.raw_json === 'object' ? row.raw_json : {};
  const addToCart = rawOptional(raw, ['add_to_cart','add_to_cart_count']);
  const voucherAmount = rawOptional(raw, ['voucher_amount']);
  const voucheredSales = rawOptional(raw, ['vouchered_sales']);
  return {
    shopId:Number(row.shop_id), eventDate:dateOnlyIso(row.event_date), impressions, clicks,
    ctr: impressions ? clicks / impressions : 0,
    directOrders, broadOrders, directUnits:Number(row.direct_units || 0), broadUnits:Number(row.broad_units || 0),
    directCvr: clicks ? directOrders / clicks : 0, broadCvr: clicks ? broadOrders / clicks : 0,
    directGmv, broadGmv, expense, cpc: clicks && expense != null ? expense / clicks : null,
    costPerConversion: row.cost_per_conversion == null ? (broadOrders && expense != null ? expense / broadOrders : null) : Number(row.cost_per_conversion),
    costPerDirectConversion: row.cost_per_direct_conversion == null ? (directOrders && expense != null ? expense / directOrders : null) : Number(row.cost_per_direct_conversion),
    directRoas: row.direct_roas == null ? (expense && directGmv != null ? directGmv / expense : null) : Number(row.direct_roas),
    broadRoas: row.broad_roas == null ? (expense && broadGmv != null ? broadGmv / expense : null) : Number(row.broad_roas),
    directAcos: expense != null && directGmv ? expense / directGmv : null, broadAcos: expense != null && broadGmv ? expense / broadGmv : null,
    addToCart, addToCartRate: addToCart == null ? null : (clicks ? addToCart / clicks : 0),
    voucherAmount, voucheredSales, syncedAt:row.synced_at || null,
  };
}

function evidenceNumber(row, key) {
  const value = row && row[key];
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function applyOverviewEvidence(row, evidence) {
  if (!evidence) return row;
  const addToCart = evidenceNumber(evidence, 'add_to_cart');
  const addToCartRate = evidenceNumber(evidence, 'add_to_cart_rate');
  const voucherAmount = evidenceNumber(evidence, 'voucher_amount');
  const voucheredSales = evidenceNumber(evidence, 'vouchered_sales');
  return {
    ...row,
    addToCart: addToCart ?? row.addToCart,
    addToCartRate: addToCartRate ?? (addToCart != null && row.clicks ? addToCart / row.clicks : row.addToCartRate),
    voucherAmount: voucherAmount ?? row.voucherAmount,
    voucheredSales: voucheredSales ?? row.voucheredSales,
    supplementalSource: evidence.source_format || null,
    supplementalSourceRef: evidence.source_ref || null,
  };
}

function evidenceCoverage(rows, expectedDays, exactEvidence = null) {
  const config = {
    addToCart: 'addToCart', addToCartRate: 'addToCartRate',
    voucherAmount: 'voucherAmount', voucheredSales: 'voucheredSales',
  };
  return Object.fromEntries(Object.entries(config).map(([name, field]) => {
    const exactKey = name.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
    const exactValue = evidenceNumber(exactEvidence, exactKey);
    const availableDays = rows.filter(row => row[field] !== null && row[field] !== undefined).length;
    return [name, {
      expectedDays,
      availableDays,
      complete: exactValue !== null || (expectedDays > 0 && availableDays === expectedDays),
      exactRange: exactValue !== null,
      source: exactValue !== null ? exactEvidence.source_format : (availableDays ? 'DAILY_EVIDENCE' : 'UNAVAILABLE'),
    }];
  }));
}

function maskIncompleteSupplementalSummary(summary, supplementalCoverage) {
  const result = { ...summary };
  for (const key of ['addToCart','addToCartRate','voucherAmount','voucheredSales']) {
    if (!supplementalCoverage?.[key]?.complete) result[key] = null;
  }
  return result;
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
  const evidenceRepository = new ShopeeProductAdsOverviewEvidenceRepository({ pool });

  router.get('/product-ads/overview', async (req, res, next) => {
    try {
      const shopId = requirePositiveInt(req.query.shop_id, 'shop_id');
      const startDate = requireIsoDate(req.query.start_date, 'start_date');
      const endDate = requireIsoDate(req.query.end_date, 'end_date');
      if (startDate > endDate) throw new Error('start_date must be <= end_date');
      const [dbRows, evidenceRows, exactEvidence] = await Promise.all([
        repository.list({ shopId, startDate, endDate }),
        evidenceRepository.list({ shopId, startDate, endDate }),
        evidenceRepository.findExact({ shopId, startDate, endDate }),
      ]);
      const priority = { SHOPEE_PRODUCT_ADS_OVERVIEW_EXPORT: 1, USER_VERIFIED_SCREENSHOT: 2 };
      const dailyEvidence = new Map();
      evidenceRows
        .filter(row => row.granularity === 'DAY' && row.period_start === row.period_end)
        .sort((a, b) => (priority[a.source_format] || 9) - (priority[b.source_format] || 9) || new Date(b.imported_at) - new Date(a.imported_at))
        .forEach(row => { if (!dailyEvidence.has(row.period_start)) dailyEvidence.set(row.period_start, row); });
      const rows = dbRows.map(serializeRow).map(row => applyOverviewEvidence(row, dailyEvidence.get(row.eventDate)));
      const coverage = dateCoverage(startDate, endDate, rows);
      const baseSummary = summarizeProductAdsRows(rows);
      const supplementalCoverage = evidenceCoverage(rows, coverage.expectedDays, exactEvidence);
      const evidenceSummary = exactEvidence ? applyOverviewEvidence(baseSummary, exactEvidence) : baseSummary;
      const summary = maskIncompleteSupplementalSummary(evidenceSummary, supplementalCoverage);
      res.json({
        shopId,
        startDate,
        endDate,
        source: 'SHOPEE_API_ALL_CPC_DAILY',
        sourceEndpoint: '/api/v2/ads/get_all_cpc_ads_daily_performance',
        sourceScope: 'SHOP_LEVEL_CPC_ADS',
        supplementalSource: 'SELLER_CENTRE_EVIDENCE_WHEN_AVAILABLE',
        dataAvailable: rows.length > 0,
        coverage,
        supplementalCoverage,
        exactEvidence: exactEvidence ? { sourceFormat: exactEvidence.source_format, sourceRef: exactEvidence.source_ref, importedAt: exactEvidence.imported_at } : null,
        daily: rows,
        summary,
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
  applyOverviewEvidence,
  evidenceCoverage,
  maskIncompleteSupplementalSummary,
  dateCoverage,
  reconcileRows,
  equivalentNumber,
};
