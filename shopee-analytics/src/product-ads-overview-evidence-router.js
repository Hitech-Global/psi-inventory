'use strict';

const express = require('express');
const {
  parseOverviewSellerCentreFile,
  ShopeeProductAdsOverviewEvidenceRepository,
} = require('./product-ads-overview-evidence');
const { parseGmsSellerCentreFile } = require('./gms-seller-centre-reconciliation');
const { ShopeeAdPromotionRepository } = require('./ad-promotion-repository');
const { ShopeeShopScopeRepository } = require('./shop-scope-repository');

function positiveInt(value, name) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new Error(`${name} must be a positive integer`);
  return number;
}
function scopedError(code, message, status = 422) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}
function isoDate(value, name) {
  const text = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(`${name} must be YYYY-MM-DD`);
  return text;
}
function optionalNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error('evidence metrics must be numeric or null');
  return n;
}
function closeEnough(actual, expected, tolerance = 0) {
  if (actual === null || actual === undefined || expected === null || expected === undefined) return true;
  return Math.abs(Number(actual) - Number(expected)) <= tolerance;
}
async function verifyOverviewCore(pool, shopId, rows) {
  for (const row of rows) {
    const result = await pool.query(
      `SELECT COALESCE(SUM(impressions),0)::numeric AS impressions,
              COALESCE(SUM(clicks),0)::numeric AS clicks,
              COALESCE(SUM(broad_orders),0)::numeric AS broad_orders,
              COALESCE(SUM(broad_units),0)::numeric AS broad_units,
              COALESCE(SUM(broad_gmv),0)::numeric AS broad_gmv,
              COALESCE(SUM(expense),0)::numeric AS expense,
              COUNT(*)::int AS day_count
       FROM shopee_product_ads_shop_daily
       WHERE shop_id=$1 AND event_date BETWEEN $2::date AND $3::date`,
      [shopId, row.periodStart, row.periodEnd],
    );
    const api = result.rows[0];
    if (!api || Number(api.day_count) === 0) throw scopedError('OVERVIEW_API_EVIDENCE_MISSING', `No API overview data covers ${row.periodStart}..${row.periodEnd}`, 409);
    const checks = [
      ['impressions', row.impressions, api.impressions, 0], ['clicks', row.clicks, api.clicks, 0],
      ['orders', row.broadOrders, api.broad_orders, 0], ['itemsSold', row.broadUnits, api.broad_units, 0],
      ['gmv', row.broadGmv, api.broad_gmv, 0.011], ['expense', row.expense, api.expense, 0.011],
    ];
    const failed = checks.filter(([, seller, source, tolerance]) => !closeEnough(seller, source, tolerance));
    if (failed.length) throw scopedError('OVERVIEW_EVIDENCE_MISMATCH', `Seller Centre overview does not reconcile for ${row.periodStart}..${row.periodEnd}: ${failed.map(x => x[0]).join(', ')}`, 409);
  }
}
async function verifyGmsCore(pool, shopId, campaignId, eventDate, seller) {
  const result = await pool.query(
    `SELECT d.impressions,d.clicks,d.expense,d.broad_orders,d.broad_gmv
     FROM shopee_ad_campaign_daily d
     JOIN shopee_ad_campaigns c ON c.shop_id=d.shop_id AND c.campaign_id=d.campaign_id
     WHERE d.shop_id=$1 AND d.campaign_id=$2 AND d.event_date=$3::date
       AND c.campaign_type_normalized='GMS'`,
    [shopId, campaignId, eventDate],
  );
  const api = result.rows[0];
  if (!api) throw scopedError('GMS_API_EVIDENCE_MISSING', `No GMS API row found for campaign ${campaignId} on ${eventDate}`, 409);
  const checks = [
    ['impressions', seller.impressions, api.impressions, 0], ['clicks', seller.clicks, api.clicks, 0],
    ['orders', seller.broadOrders, api.broad_orders, 0], ['gmv', seller.broadGmv, api.broad_gmv, 0.011],
    ['expense', seller.expense, api.expense, 0.011],
  ];
  const failed = checks.filter(([, source, target, tolerance]) => !closeEnough(source, target, tolerance));
  if (failed.length) throw scopedError('GMS_EVIDENCE_MISMATCH', `GMS Seller Centre evidence does not reconcile: ${failed.map(x => x[0]).join(', ')}`, 409);
}
function createProductAdsOverviewEvidenceRouter({ pool }) {
  const router = express.Router();
  const repository = new ShopeeProductAdsOverviewEvidenceRepository({ pool });
  const promotionRepository = new ShopeeAdPromotionRepository({ pool });
  const shopScopeRepository = new ShopeeShopScopeRepository({ pool });

  router.post('/product-ads/overview/seller-centre/import', express.raw({
    type: ['text/csv','application/csv','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    limit: '16mb',
  }), async (req, res, next) => {
    try {
      if (!Buffer.isBuffer(req.body) || !req.body.length) throw new Error('a Seller Centre CSV or XLSX request body is required');
      const targetShopId = positiveInt(req.query.target_shop_id, 'target_shop_id');
      const filename = String(req.query.filename || req.headers['x-filename'] || 'product-ads-overview.csv');
      const parsed = parseOverviewSellerCentreFile({ buffer: req.body, filename });
      if (parsed.shopId && parsed.shopId !== targetShopId) {
        throw scopedError('SHOP_SCOPE_MISMATCH', `Source shop ${parsed.shopId} does not match target shop ${targetShopId}`, 409);
      }
      await verifyOverviewCore(pool, targetShopId, parsed.rows);
      const preview = { ...parsed.preview, targetShopId, sourceFile: parsed.sourceFile, sourceShopId: parsed.shopId, reconciliation: 'PASS' };
      if (req.query.confirm !== 'YES') {
        res.json({ ok: true, persisted: false, ...preview });
        return;
      }
      if (!(await shopScopeRepository.find(targetShopId))) throw scopedError('TARGET_SHOP_NOT_REGISTERED', `Shop ${targetShopId} must be registered before overview evidence import`);
      const saved = await repository.upsertMany({
        shopId: targetShopId,
        sourceFormat: parsed.reportSource,
        sourceRef: parsed.sourceFile,
        rows: parsed.rows,
      });
      res.status(201).json({ ok: true, persisted: true, ...preview, rowCount: saved.rowCount });
    } catch (error) {
      next(error);
    }
  });

  router.post('/product-ads/overview/evidence', express.json({ limit: '256kb' }), async (req, res, next) => {
    try {
      if (req.query.confirm !== 'YES') throw scopedError('CONFIRM_REQUIRED', 'confirm=YES is required for explicit evidence writes');
      const shopId = positiveInt(req.body?.shopId, 'shopId');
      const startDate = isoDate(req.body?.startDate, 'startDate');
      const endDate = isoDate(req.body?.endDate || req.body?.startDate, 'endDate');
      if (startDate > endDate) throw new Error('startDate must be <= endDate');
      if (!(await shopScopeRepository.find(shopId))) throw scopedError('TARGET_SHOP_NOT_REGISTERED', `Shop ${shopId} must be registered before overview evidence import`);
      const metrics = req.body?.metrics || {};
      const sourceFormat = String(req.body?.sourceFormat || 'USER_VERIFIED_SCREENSHOT');
      if (!['USER_VERIFIED_SCREENSHOT','SHOPEE_PRODUCT_ADS_OVERVIEW_EXPORT'].includes(sourceFormat)) throw new Error('unsupported evidence sourceFormat');
      const row = {
        periodStart: startDate, periodEnd: endDate,
        granularity: startDate === endDate ? 'DAY' : 'RANGE',
        impressions: optionalNumber(metrics.impressions), clicks: optionalNumber(metrics.clicks),
        broadOrders: optionalNumber(metrics.broadOrders), broadUnits: optionalNumber(metrics.broadUnits),
        broadGmv: optionalNumber(metrics.broadGmv), expense: optionalNumber(metrics.expense),
        broadRoas: optionalNumber(metrics.broadRoas), addToCart: optionalNumber(metrics.addToCart),
        addToCartRate: optionalNumber(metrics.addToCartRate), voucherAmount: optionalNumber(metrics.voucherAmount),
        voucheredSales: optionalNumber(metrics.voucheredSales),
        raw: { note: req.body?.note || null, evidence: req.body?.evidence || null },
      };
      const saved = await repository.upsertMany({
        shopId, sourceFormat, sourceRef: String(req.body?.sourceRef || '') || null, rows: [row],
      });
      res.status(201).json({ ok: true, persisted: true, rowCount: saved.rowCount, shopId, startDate, endDate, sourceFormat });
    } catch (error) {
      next(error);
    }
  });

  router.post('/gms/seller-centre/import', express.raw({
    type: ['text/csv','application/csv','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    limit: '16mb',
  }), async (req, res, next) => {
    try {
      if (!Buffer.isBuffer(req.body) || !req.body.length) throw new Error('a GMS Seller Centre CSV or XLSX request body is required');
      const targetShopId = positiveInt(req.query.target_shop_id, 'target_shop_id');
      const targetCampaignId = positiveInt(req.query.target_campaign_id, 'target_campaign_id');
      const filename = String(req.query.filename || req.headers['x-filename'] || 'gms-report.csv');
      const parsed = parseGmsSellerCentreFile({ buffer: req.body, filename });
      if (parsed.shopId !== targetShopId) throw scopedError('SHOP_SCOPE_MISMATCH', `Source shop ${parsed.shopId} does not match target shop ${targetShopId}`, 409);
      await verifyGmsCore(pool, targetShopId, targetCampaignId, parsed.eventDate, parsed.summary);
      const preview = { targetShopId, targetCampaignId, eventDate: parsed.eventDate, itemCount: parsed.items.length,
        voucherAmount: parsed.summary.voucherAmount, voucheredSales: parsed.summary.voucheredSales, reconciliation: 'PASS' };
      if (req.query.confirm !== 'YES') { res.json({ ok: true, persisted: false, ...preview }); return; }
      if (!(await shopScopeRepository.find(targetShopId))) throw scopedError('TARGET_SHOP_NOT_REGISTERED', `Shop ${targetShopId} must be registered before GMS evidence import`);
      const s = parsed.summary;
      const promotion = {
        shopId: targetShopId, promotionKey: `MANUAL_IMPORT:gms:${targetCampaignId}`,
        periodStart: parsed.eventDate, periodEnd: parsed.eventDate, granularity: 'DAY', eventDate: parsed.eventDate,
        promotionType: 'SHOP_GMV_MAX', dataSource: 'MANUAL_IMPORT', campaignId: targetCampaignId,
        campaignName: `全店推 #${targetCampaignId}`, sourceAdType: 'GMS_SELLER_CENTRE_EXPORT',
        impressions: s.impressions, clicks: s.clicks, expense: s.expense, orders: s.broadOrders, gmv: s.broadGmv,
        sourceRoas: s.sourceBroadRoas, directGmv: s.directGmv, directRoas: s.sourceDirectRoas,
        ctr: s.sourceCtr, cvr: s.sourceBroadCvr, itemCount: parsed.items.length,
        dataQualityStatus: 'COMPLETE', qualityFlags: [],
        raw: { sourceFormat: parsed.reportSource, sourceFilename: filename, sourceMetrics: s },
      };
      const items = parsed.items.map(item => ({ itemId: item.itemId, productName: item.productName,
        impressions: item.metrics.impressions, clicks: item.metrics.clicks, expense: item.metrics.expense,
        orders: item.metrics.broadOrders, gmv: item.metrics.broadGmv, sourceRoas: item.metrics.sourceBroadRoas,
        directGmv: item.metrics.directGmv, directRoas: item.metrics.sourceDirectRoas, ctr: item.metrics.sourceCtr,
        cvr: item.metrics.sourceBroadCvr, dataQualityStatus: 'COMPLETE', qualityFlags: [],
        raw: { sourceFormat: parsed.reportSource, sourceMetrics: item.metrics } }));
      await promotionRepository.saveWithItems(promotion, items);
      res.status(201).json({ ok: true, persisted: true, ...preview });
    } catch (error) { next(error); }
  });

  return router;
}

module.exports = {
  positiveInt,
  isoDate,
  optionalNumber,
  createProductAdsOverviewEvidenceRouter,
};
