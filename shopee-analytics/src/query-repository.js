'use strict';

const { normalizePerformance } = require('./metrics');

class ShopeeQueryRepository {
  constructor({ pool }) {
    if (!pool || typeof pool.query !== 'function') throw new Error('pg pool/query adapter is required');
    this.pool = pool;
  }

  async listCampaignOverview({ shopId, startDate, endDate }) {
    const result = await this.pool.query(
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
         s.observed_at AS setting_observed_at,
         COALESCE(SUM(d.impressions),0) AS impressions,
         COALESCE(SUM(d.clicks),0) AS clicks,
         COALESCE(SUM(d.expense),0) AS expense,
         COALESCE(SUM(d.broad_gmv),0) AS broad_gmv,
         COALESCE(SUM(d.broad_orders),0) AS broad_orders,
         COALESCE(SUM(d.broad_units),0) AS broad_units,
         COALESCE(SUM(d.direct_gmv),0) AS direct_gmv,
         COALESCE(SUM(d.direct_orders),0) AS direct_orders,
         COALESCE(SUM(d.direct_units),0) AS direct_units,
         MAX(d.event_date) AS latest_performance_date
       FROM shopee_ad_campaigns c
       LEFT JOIN LATERAL (
         SELECT status, bidding_method, campaign_budget, target_roas, observed_at
         FROM shopee_ad_campaign_setting_history s0
         WHERE s0.shop_id=c.shop_id AND s0.campaign_id=c.campaign_id
         ORDER BY observed_at DESC
         LIMIT 1
       ) s ON true
       LEFT JOIN shopee_ad_campaign_daily d
         ON d.shop_id=c.shop_id
        AND d.campaign_id=c.campaign_id
        AND d.event_date BETWEEN $2 AND $3
       WHERE c.shop_id=$1
       GROUP BY
         c.campaign_id,c.ad_type,c.campaign_type_raw,c.campaign_type_normalized,c.region,
         s.status,s.bidding_method,s.campaign_budget,s.target_roas,s.observed_at
       ORDER BY COALESCE(SUM(d.expense),0) DESC, c.campaign_id`,
      [shopId, startDate, endDate],
    );

    return result.rows.map(row => ({
      campaignId: Number(row.campaign_id),
      adType: row.ad_type,
      campaignTypeRaw: row.campaign_type_raw,
      campaignTypeNormalized: row.campaign_type_normalized,
      region: row.region,
      status: row.status,
      biddingMethod: row.bidding_method,
      campaignBudget: row.campaign_budget === null ? null : Number(row.campaign_budget),
      targetRoas: row.target_roas === null ? null : Number(row.target_roas),
      settingObservedAt: row.setting_observed_at,
      latestPerformanceDate: row.latest_performance_date,
      performance: normalizePerformance(row),
    }));
  }

  async getLatestCampaignSetting({ shopId, campaignId }) {
    const result = await this.pool.query(
      `SELECT status,bidding_method,campaign_budget,target_roas,observed_at,raw_json
       FROM shopee_ad_campaign_setting_history
       WHERE shop_id=$1 AND campaign_id=$2
       ORDER BY observed_at DESC
       LIMIT 1`,
      [shopId, campaignId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      status: row.status,
      biddingMethod: row.bidding_method,
      campaignBudget: row.campaign_budget === null ? null : Number(row.campaign_budget),
      targetRoas: row.target_roas === null ? null : Number(row.target_roas),
      observedAt: row.observed_at,
      raw: row.raw_json || {},
    };
  }

  async getLatestRecommendedRoiMap({ shopId, itemIds }) {
    const ids = (itemIds || []).map(Number).filter(Number.isSafeInteger);
    if (!ids.length) return new Map();
    const result = await this.pool.query(
      `SELECT DISTINCT ON (item_id)
         item_id, observed_at, lower_value, lower_percentile,
         exact_value, exact_percentile, upper_value, upper_percentile
       FROM shopee_recommended_roi_history
       WHERE shop_id=$1 AND item_id = ANY($2::bigint[])
       ORDER BY item_id, observed_at DESC`,
      [shopId, ids],
    );
    return new Map(result.rows.map(row => [
      String(row.item_id),
      {
        observedAt: row.observed_at,
        lower: { value: row.lower_value === null ? null : Number(row.lower_value), percentile: row.lower_percentile },
        exact: { value: row.exact_value === null ? null : Number(row.exact_value), percentile: row.exact_percentile },
        upper: { value: row.upper_value === null ? null : Number(row.upper_value), percentile: row.upper_percentile },
      },
    ]));
  }

  async getProductCardPeriodMap({ shopId, startDate, endDate, itemIds }) {
    const ids = (itemIds || []).map(Number).filter(Number.isSafeInteger);
    if (!ids.length) return new Map();
    const result = await this.pool.query(
      `SELECT item_id,item_name,parent_sku,item_sku,impressions,clicks,ctr,visitors,page_views,
              add_to_cart_visitors,add_to_cart_units,add_to_cart_rate,orders,buyers,units,sales,
              conversion_rate,source_file,imported_at
       FROM shopee_product_card_period
       WHERE shop_id=$1 AND start_date=$2 AND end_date=$3
         AND item_id = ANY($4::bigint[])`,
      [shopId, startDate, endDate, ids],
    );
    return new Map(result.rows.map(row => [
      String(row.item_id),
      {
        itemName: row.item_name,
        parentSku: row.parent_sku,
        itemSku: row.item_sku,
        impressions: row.impressions === null ? null : Number(row.impressions),
        clicks: row.clicks === null ? null : Number(row.clicks),
        ctr: row.ctr === null ? null : Number(row.ctr),
        visitors: row.visitors === null ? null : Number(row.visitors),
        pageViews: row.page_views === null ? null : Number(row.page_views),
        addToCartVisitors: row.add_to_cart_visitors === null ? null : Number(row.add_to_cart_visitors),
        addToCartUnits: row.add_to_cart_units === null ? null : Number(row.add_to_cart_units),
        addToCartRate: row.add_to_cart_rate === null ? null : Number(row.add_to_cart_rate),
        orders: row.orders === null ? null : Number(row.orders),
        buyers: row.buyers === null ? null : Number(row.buyers),
        units: row.units === null ? null : Number(row.units),
        sales: row.sales === null ? null : Number(row.sales),
        conversionRate: row.conversion_rate === null ? null : Number(row.conversion_rate),
        sourceFile: row.source_file,
        importedAt: row.imported_at,
      },
    ]));
  }

  async getCampaignItemNames({ shopId, itemIds }) {
    const ids = (itemIds || []).map(Number).filter(Number.isSafeInteger);
    if (!ids.length) return new Map();
    const result = await this.pool.query(
      `SELECT item_id,item_name,item_sku
       FROM shopee_products
       WHERE shop_id=$1 AND item_id = ANY($2::bigint[])`,
      [shopId, ids],
    );
    return new Map(result.rows.map(row => [
      String(row.item_id),
      { itemName: row.item_name, itemSku: row.item_sku },
    ]));
  }
}

module.exports = { ShopeeQueryRepository };
