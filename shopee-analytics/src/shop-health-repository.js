'use strict';

/**
 * A shop's score and fulfilment, as it stood on a given day.
 */
class ShopeeShopHealthRepository {
  constructor({ pool }) {
    if (!pool || typeof pool.query !== 'function') throw new Error('pg pool/query adapter is required');
    this.pool = pool;
  }

  async upsertDaily({ eventDate, health }) {
    await this.pool.query(
      `INSERT INTO shopee_shop_health_daily
       (shop_id, event_date, shop_rating, csat_rate, response_rate, late_shipment_rate,
        non_fulfillment_rate, preparation_time, cancellation_rate, return_refund_rate,
        pre_order_listing_rate, pre_order_listing_amount, severe_listing_violations,
        other_listing_violations, prohibited_listings, counterfeit_ip_infringement,
        spam_listings, fulfillment_failed, listing_failed, custom_service_failed,
        raw_json, synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21::jsonb,now())
       ON CONFLICT (shop_id, event_date) DO UPDATE SET
        shop_rating=EXCLUDED.shop_rating,
        csat_rate=EXCLUDED.csat_rate,
        response_rate=EXCLUDED.response_rate,
        late_shipment_rate=EXCLUDED.late_shipment_rate,
        non_fulfillment_rate=EXCLUDED.non_fulfillment_rate,
        preparation_time=EXCLUDED.preparation_time,
        cancellation_rate=EXCLUDED.cancellation_rate,
        return_refund_rate=EXCLUDED.return_refund_rate,
        pre_order_listing_rate=EXCLUDED.pre_order_listing_rate,
        pre_order_listing_amount=EXCLUDED.pre_order_listing_amount,
        severe_listing_violations=EXCLUDED.severe_listing_violations,
        other_listing_violations=EXCLUDED.other_listing_violations,
        prohibited_listings=EXCLUDED.prohibited_listings,
        counterfeit_ip_infringement=EXCLUDED.counterfeit_ip_infringement,
        spam_listings=EXCLUDED.spam_listings,
        fulfillment_failed=EXCLUDED.fulfillment_failed,
        listing_failed=EXCLUDED.listing_failed,
        custom_service_failed=EXCLUDED.custom_service_failed,
        raw_json=EXCLUDED.raw_json,
        synced_at=now()`,
      [
        health.shopId,
        eventDate,
        health.shopRating,
        health.csatRate,
        health.responseRate,
        health.lateShipmentRate,
        health.nonFulfillmentRate,
        health.preparationTime,
        health.cancellationRate,
        health.returnRefundRate,
        health.preOrderListingRate,
        health.preOrderListingAmount,
        health.severeListingViolations,
        health.otherListingViolations,
        health.prohibitedListings,
        health.counterfeitIpInfringement,
        health.spamListings,
        health.fulfillmentFailed,
        health.listingFailed,
        health.customServiceFailed,
        JSON.stringify(health.raw || {}),
      ],
    );
  }

  /**
   * The latest reading for each shop, or the reading on a given day.
   */
  async listLatest({ shopIds = null, eventDate = null } = {}) {
    const result = await this.pool.query(
      `SELECT DISTINCT ON (h.shop_id)
         h.shop_id, h.event_date, h.shop_rating, h.csat_rate, h.response_rate,
         h.late_shipment_rate, h.non_fulfillment_rate, h.preparation_time,
         h.cancellation_rate, h.return_refund_rate, h.fulfillment_failed,
         h.listing_failed, h.custom_service_failed, h.synced_at
       FROM shopee_shop_health_daily h
       WHERE ($1::bigint[] IS NULL OR h.shop_id = ANY($1::bigint[]))
         AND ($2::date IS NULL OR h.event_date = $2::date)
       ORDER BY h.shop_id, h.event_date DESC`,
      [shopIds, eventDate],
    );
    return result.rows.map(row => ({
      shopId: Number(row.shop_id),
      eventDate: row.event_date,
      shopRating: row.shop_rating === null ? null : Number(row.shop_rating),
      csatRate: row.csat_rate === null ? null : Number(row.csat_rate),
      responseRate: row.response_rate === null ? null : Number(row.response_rate),
      lateShipmentRate: row.late_shipment_rate === null ? null : Number(row.late_shipment_rate),
      nonFulfillmentRate: row.non_fulfillment_rate === null ? null : Number(row.non_fulfillment_rate),
      preparationTime: row.preparation_time === null ? null : Number(row.preparation_time),
      cancellationRate: row.cancellation_rate === null ? null : Number(row.cancellation_rate),
      returnRefundRate: row.return_refund_rate === null ? null : Number(row.return_refund_rate),
      fulfillmentFailed: row.fulfillment_failed === null ? null : Number(row.fulfillment_failed),
      listingFailed: row.listing_failed === null ? null : Number(row.listing_failed),
      customServiceFailed: row.custom_service_failed === null ? null : Number(row.custom_service_failed),
      syncedAt: row.synced_at,
    }));
  }
}

module.exports = { ShopeeShopHealthRepository };
