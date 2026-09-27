'use strict';

const express = require('express');
const { hydrateCampaignDailySourceMetrics } = require('./repository');
const { sumPerformance } = require('./metrics');

function requirePositiveInt(value, name) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new Error(`${name} must be a positive integer`);
  return number;
}

function requireIsoDate(value, name) {
  const raw = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new Error(`${name} must be YYYY-MM-DD`);
  return raw;
}

function dateOnly(value) {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return String(value).slice(0, 10);
}

function applyAtcEvidence(hydrated, row) {
  const apiAtc = hydrated && hydrated.add_to_cart != null ? Number(hydrated.add_to_cart) : null;
  if (apiAtc !== null && Number.isFinite(apiAtc)) {
    return {
      ...hydrated,
      __atcSource: 'SHOPEE_API',
      __atcEvidence: null,
    };
  }

  const evidenceAtc = row && row.evidence_add_to_cart != null ? Number(row.evidence_add_to_cart) : null;
  if (evidenceAtc !== null && Number.isFinite(evidenceAtc)) {
    return {
      ...hydrated,
      add_to_cart: evidenceAtc,
      add_to_cart_rate: null,
      __atcSource: 'SELLER_CENTRE_EXPORT',
      __atcEvidence: {
        eventDate: dateOnly(row.event_date),
        promotionKey: row.evidence_promotion_key,
        syncedAt: row.evidence_synced_at,
        sourceFormat: 'SHOPEE_PRODUCT_AD_EXPORT',
      },
    };
  }

  return {
    ...hydrated,
    __atcSource: 'UNAVAILABLE',
    __atcEvidence: null,
  };
}

function summarizeAtcProvenance(daily) {
  if (!daily.length) {
    return { addToCart: 'UNAVAILABLE', addToCartRate: 'UNAVAILABLE', evidence: [] };
  }
  const sources = daily.map(row => row.__atcSource || 'UNAVAILABLE');
  const evidence = daily.map(row => row.__atcEvidence).filter(Boolean);
  let addToCart;
  if (sources.includes('UNAVAILABLE')) addToCart = 'INCOMPLETE';
  else {
    const unique = Array.from(new Set(sources));
    addToCart = unique.length === 1 ? unique[0] : 'MIXED';
  }
  const addToCartRate = addToCart === 'SELLER_CENTRE_EXPORT'
    ? 'DERIVED_FROM_SELLER_CENTRE_EXPORT'
    : addToCart;
  return { addToCart, addToCartRate, evidence };
}

async function listProductAdsSourceAccurate(pool, { shopId, startDate, endDate, adType }) {
  const family = adType === 'manual' ? 'MANUAL_PRODUCT_AD' : 'AUTO_PRODUCT_AD';
  const result = await pool.query(
    `SELECT
       c.campaign_id,
       c.ad_type,
       c.campaign_type_raw,
       c.campaign_type_normalized,
       c.region,
       s.status,
       s.bidding_method,
       s.campaign_budget,
       s.target_roas,
       s.ad_name,
       s.campaign_placement,
       s.observed_at AS setting_observed_at,
       d.shop_id AS daily_shop_id,
       d.event_date,
       d.impressions,
       d.clicks,
       d.expense,
       d.broad_gmv,
       d.broad_orders,
       d.broad_units,
       d.direct_gmv,
       d.direct_roas,
       d.direct_orders,
       d.direct_units,
       d.ctr,
       d.broad_cvr,
       d.direct_cvr,
       d.broad_roas,
       d.add_to_cart,
       d.add_to_cart_rate,
       d.cost_per_conversion,
       d.cost_per_direct_conversion,
       d.broad_acos,
       d.direct_acos,
       d.raw_json,
       e.evidence_add_to_cart,
       e.evidence_promotion_key,
       e.evidence_synced_at
     FROM shopee_ad_campaigns c
     LEFT JOIN LATERAL (
       SELECT
         s0.status,
         s0.bidding_method,
         s0.campaign_budget,
         s0.target_roas,
         s0.observed_at,
         s0.raw_json->'common_info'->>'ad_name' AS ad_name,
         s0.raw_json->'common_info'->>'campaign_placement' AS campaign_placement
       FROM shopee_ad_campaign_setting_history s0
       WHERE s0.shop_id=c.shop_id AND s0.campaign_id=c.campaign_id
       ORDER BY s0.observed_at DESC
       LIMIT 1
     ) s ON true
     LEFT JOIN shopee_ad_campaign_daily d
       ON d.shop_id=c.shop_id
      AND d.campaign_id=c.campaign_id
      AND d.event_date BETWEEN $2::date AND $3::date
     LEFT JOIN LATERAL (
       SELECT
         e0.add_to_cart AS evidence_add_to_cart,
         e0.promotion_key AS evidence_promotion_key,
         e0.synced_at AS evidence_synced_at
       FROM shopee_ad_promotion_daily e0
       WHERE d.event_date IS NOT NULL
         AND e0.shop_id=c.shop_id
         AND e0.campaign_id=c.campaign_id
         AND e0.promotion_type='INDIVIDUAL_AD'
         AND e0.data_source='MANUAL_IMPORT'
         AND e0.period_start=d.event_date
         AND e0.period_end=d.event_date
         AND e0.add_to_cart IS NOT NULL
         AND COALESCE(e0.raw_json->>'sourceFormat','')='SHOPEE_PRODUCT_AD_EXPORT'
       ORDER BY e0.synced_at DESC
       LIMIT 1
     ) e ON true
     WHERE c.shop_id=$1
       AND c.campaign_type_normalized=$4
     ORDER BY c.campaign_id,d.event_date`,
    [shopId, startDate, endDate, family],
  );

  const campaigns = new Map();
  for (const row of result.rows) {
    const key = String(row.campaign_id);
    if (!campaigns.has(key)) {
      campaigns.set(key, {
        campaignId: Number(row.campaign_id),
        adType: row.ad_type,
        campaignTypeRaw: row.campaign_type_raw,
        campaignTypeNormalized: row.campaign_type_normalized,
        region: row.region,
        status: row.status,
        biddingMethod: row.bidding_method,
        campaignBudget: row.campaign_budget == null ? null : Number(row.campaign_budget),
        targetRoas: row.target_roas == null ? null : Number(row.target_roas),
        adName: row.ad_name,
        campaignPlacement: row.campaign_placement,
        settingObservedAt: row.setting_observed_at,
        latestPerformanceDate: null,
        daily: [],
      });
    }
    if (row.event_date) {
      const campaign = campaigns.get(key);
      const hydrated = hydrateCampaignDailySourceMetrics({
        shop_id: row.daily_shop_id,
        event_date: row.event_date,
        impressions: row.impressions,
        clicks: row.clicks,
        expense: row.expense,
        broad_gmv: row.broad_gmv,
        broad_orders: row.broad_orders,
        broad_units: row.broad_units,
        direct_gmv: row.direct_gmv,
        direct_roas: row.direct_roas,
        direct_orders: row.direct_orders,
        direct_units: row.direct_units,
        ctr: row.ctr,
        broad_cvr: row.broad_cvr,
        direct_cvr: row.direct_cvr,
        broad_roas: row.broad_roas,
        add_to_cart: row.add_to_cart,
        add_to_cart_rate: row.add_to_cart_rate,
        cost_per_conversion: row.cost_per_conversion,
        cost_per_direct_conversion: row.cost_per_direct_conversion,
        broad_acos: row.broad_acos,
        direct_acos: row.direct_acos,
        raw_json: row.raw_json,
      });
      campaign.daily.push(applyAtcEvidence(hydrated, row));
      campaign.latestPerformanceDate = dateOnly(row.event_date);
    }
  }

  return Array.from(campaigns.values()).map(campaign => {
    const performance = sumPerformance(campaign.daily);
    const performanceProvenance = summarizeAtcProvenance(campaign.daily);
    const { daily, ...base } = campaign;
    return { ...base, performance, performanceProvenance };
  }).sort((a, b) => {
    const spendDiff = Number(b.performance.expense || 0) - Number(a.performance.expense || 0);
    return spendDiff || a.campaignId - b.campaignId;
  });
}

function createProductAdsSourceRouter({ pool }) {
  const router = express.Router();
  router.get('/product-ads', async (req, res, next) => {
    try {
      const shopId = requirePositiveInt(req.query.shop_id, 'shop_id');
      const startDate = requireIsoDate(req.query.start_date, 'start_date');
      const endDate = requireIsoDate(req.query.end_date, 'end_date');
      if (startDate > endDate) throw new Error('start_date must be <= end_date');
      const adType = String(req.query.ad_type || '').toLowerCase();
      if (!['manual', 'auto'].includes(adType)) throw new Error('ad_type must be manual or auto');
      const campaigns = await listProductAdsSourceAccurate(pool, { shopId, startDate, endDate, adType });
      res.json({
        shopId,
        startDate,
        endDate,
        adType,
        metricContract: 'SHOPEE_SOURCE_DAILY_WITH_EXACT_DAY_SELLER_CENTRE_ATC_FALLBACK_WHEN_API_ATC_UNAVAILABLE',
        campaigns,
      });
    } catch (error) {
      next(error);
    }
  });
  return router;
}

module.exports = {
  dateOnly,
  applyAtcEvidence,
  summarizeAtcProvenance,
  listProductAdsSourceAccurate,
  createProductAdsSourceRouter,
};
