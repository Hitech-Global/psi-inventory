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

  async getItemTimeline({ shopId, itemId, startDate, endDate }) {
    const startEpoch = Math.floor(new Date(`${startDate}T00:00:00Z`).getTime() / 1000);
    const endEpoch = Math.floor(new Date(`${endDate}T23:59:59Z`).getTime() / 1000);

    const [voucherRows, discountRows, returnRows, roiRows, operationRows] = await Promise.all([
      this.pool.query(
        `SELECT v.voucher_id,v.voucher_name,v.percentage,v.discount_amount,v.min_basket_price,
                v.start_time,v.end_time,v.current_usage,v.usage_quantity
         FROM shopee_vouchers v
         JOIN shopee_voucher_items i
           ON i.shop_id=v.shop_id AND i.voucher_id=v.voucher_id
         WHERE v.shop_id=$1 AND i.item_id=$2
           AND COALESCE(v.end_time,0) >= $3 AND COALESCE(v.start_time,0) <= $4
         ORDER BY v.start_time`,
        [shopId, itemId, startEpoch, endEpoch],
      ),
      this.pool.query(
        `SELECT d.discount_id,d.discount_name,d.status,d.start_time,d.end_time,
                i.model_id,i.original_price,i.promotion_price
         FROM shopee_discounts d
         JOIN shopee_discount_items i
           ON i.shop_id=d.shop_id AND i.discount_id=d.discount_id
         WHERE d.shop_id=$1 AND i.item_id=$2
           AND COALESCE(d.end_time,0) >= $3 AND COALESCE(d.start_time,0) <= $4
         ORDER BY d.start_time,i.model_id`,
        [shopId, itemId, startEpoch, endEpoch],
      ),
      this.pool.query(
        `SELECT r.return_sn,r.order_sn,r.status,r.reason,r.refund_amount,r.currency,r.create_time,
                i.model_id,i.quantity,i.item_price,i.refund_amount AS item_refund_amount
         FROM shopee_returns r
         JOIN shopee_return_items i
           ON i.shop_id=r.shop_id AND i.return_sn=r.return_sn
         WHERE r.shop_id=$1 AND i.item_id=$2
           AND r.create_time BETWEEN $3 AND $4
         ORDER BY r.create_time`,
        [shopId, itemId, startEpoch, endEpoch],
      ),
      this.pool.query(
        `SELECT observed_at,lower_value,exact_value,upper_value
         FROM shopee_recommended_roi_history
         WHERE shop_id=$1 AND item_id=$2
           AND observed_at >= $3::date AND observed_at < ($4::date + interval '1 day')
         ORDER BY observed_at`,
        [shopId, itemId, startDate, endDate],
      ),
      this.pool.query(
        `SELECT operation_type,reason,before_json,after_json,effective_from,effective_to
         FROM shopee_operation_history
         WHERE shop_id=$1 AND item_id=$2
           AND effective_from >= $3::date AND effective_from < ($4::date + interval '1 day')
         ORDER BY effective_from`,
        [shopId, itemId, startDate, endDate],
      ),
    ]);

    const events = [];
    const epochIso = value => value ? new Date(Number(value) * 1000).toISOString() : null;
    for (const row of voucherRows.rows) {
      events.push({
        at: epochIso(row.start_time),
        type: 'VOUCHER_START',
        title: row.voucher_name || `Voucher #${row.voucher_id}`,
        detail: {
          voucherId: Number(row.voucher_id),
          percentage: row.percentage === null ? null : Number(row.percentage),
          discountAmount: row.discount_amount === null ? null : Number(row.discount_amount),
          minBasketPrice: row.min_basket_price === null ? null : Number(row.min_basket_price),
          currentUsage: row.current_usage,
          usageQuantity: row.usage_quantity,
          endAt: epochIso(row.end_time),
        },
      });
    }
    for (const row of discountRows.rows) {
      events.push({
        at: epochIso(row.start_time),
        type: 'DISCOUNT_START',
        title: row.discount_name || `Discount #${row.discount_id}`,
        detail: {
          discountId: Number(row.discount_id),
          status: row.status,
          modelId: Number(row.model_id || 0),
          originalPrice: row.original_price === null ? null : Number(row.original_price),
          promotionPrice: row.promotion_price === null ? null : Number(row.promotion_price),
          endAt: epochIso(row.end_time),
        },
      });
    }
    for (const row of returnRows.rows) {
      events.push({
        at: epochIso(row.create_time),
        type: 'RETURN',
        title: row.reason || 'Return / Refund',
        detail: {
          returnSn: row.return_sn,
          orderSn: row.order_sn,
          status: row.status,
          quantity: row.quantity,
          refundAmount: row.item_refund_amount === null
            ? (row.refund_amount === null ? null : Number(row.refund_amount))
            : Number(row.item_refund_amount),
          currency: row.currency,
        },
      });
    }
    for (const row of roiRows.rows) {
      events.push({
        at: new Date(row.observed_at).toISOString(),
        type: 'RECOMMENDED_ROAS',
        title: '平台预估 ROAS 更新',
        detail: {
          lower: row.lower_value === null ? null : Number(row.lower_value),
          exact: row.exact_value === null ? null : Number(row.exact_value),
          upper: row.upper_value === null ? null : Number(row.upper_value),
        },
      });
    }
    for (const row of operationRows.rows) {
      events.push({
        at: new Date(row.effective_from).toISOString(),
        type: row.operation_type,
        title: row.reason || row.operation_type,
        detail: {
          before: row.before_json,
          after: row.after_json,
          effectiveTo: row.effective_to,
        },
      });
    }

    return events.filter(event => event.at).sort((a, b) => a.at.localeCompare(b.at));
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
