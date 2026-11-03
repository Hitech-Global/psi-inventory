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
        targets_json, raw_json, synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21::jsonb,$22::jsonb,now())
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
        targets_json=EXCLUDED.targets_json,
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
        JSON.stringify(health.targets || {}),
        JSON.stringify(health.raw || {}),
      ],
    );
  }

  /**
   * What the shop's products drew.
   *
   * The visits, the pages they looked at, what they put in the basket and
   * what they saved for later — none of which the open platform gives.
   *
   * The product's own row is kept apart from its variations': the product
   * row is the shop's view of it, and the variation rows are the detail.
   */
  async listProductTraffic({ shopIds = null, rowKind = 'PRODUCT', limit = 500 } = {}) {
    const result = await this.pool.query(
      `SELECT shop_id, event_date, item_id, parent_sku, sku, variation_id, row_kind,
              item_name, item_status, sales, orders, units_sold, buyers,
              product_impression, product_clicks, ctr, unique_product_impressions,
              unique_product_clicks, product_visitors, product_page_views,
              bounce_visitors, bounce_rate, search_clicks, likes,
              add_to_cart_visitors, add_to_cart_units, add_to_cart_rate
       FROM shopee_product_traffic_daily
       WHERE ($1::bigint[] IS NULL OR shop_id = ANY($1::bigint[]))
         AND ($2::text IS NULL OR row_kind = $2::text)
       ORDER BY product_visitors DESC NULLS LAST, item_id
       LIMIT $3`,
      [shopIds, rowKind, limit],
    );
    return result.rows.map(row => ({
      shopId: Number(row.shop_id),
      eventDate: row.event_date,
      itemId: Number(row.item_id),
      parentSku: row.parent_sku,
      sku: row.sku,
      variationId: row.variation_id,
      rowKind: row.row_kind,
      itemName: row.item_name,
      itemStatus: row.item_status,
      sales: row.sales === null ? null : Number(row.sales),
      orders: row.orders,
      unitsSold: row.units_sold,
      buyers: row.buyers,
      productImpression: row.product_impression,
      productClicks: row.product_clicks,
      ctr: row.ctr === null ? null : Number(row.ctr),
      uniqueProductImpressions: row.unique_product_impressions,
      uniqueProductClicks: row.unique_product_clicks,
      productVisitors: row.product_visitors,
      productPageViews: row.product_page_views,
      bounceVisitors: row.bounce_visitors,
      bounceRate: row.bounce_rate === null ? null : Number(row.bounce_rate),
      searchClicks: row.search_clicks,
      likes: row.likes,
      addToCartVisitors: row.add_to_cart_visitors,
      addToCartUnits: row.add_to_cart_units,
      addToCartRate: row.add_to_cart_rate === null ? null : Number(row.add_to_cart_rate),
    }));
  }

  /**
   * The events behind the figures.
   */
  async upsertEvents({ eventDate, events }) {
    if (!events.length) return;
    for (const event of events) {
      await this.pool.query(
        `INSERT INTO shopee_shop_health_events
         (shop_id, event_date, event_kind, event_id, metric_key, reason_code,
          order_sn, item_id, title, detail, severity, raw_json, synced_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,now())
         ON CONFLICT (shop_id, event_date, event_kind, event_id) DO UPDATE SET
          metric_key=EXCLUDED.metric_key,
          reason_code=EXCLUDED.reason_code,
          order_sn=EXCLUDED.order_sn,
          item_id=EXCLUDED.item_id,
          title=EXCLUDED.title,
          detail=EXCLUDED.detail,
          severity=EXCLUDED.severity,
          raw_json=EXCLUDED.raw_json,
          synced_at=now()`,
        [
          event.shopId,
          eventDate,
          event.kind,
          event.eventId,
          event.metricKey || null,
          event.reasonCode || null,
          event.orderSn || null,
          event.itemId === undefined || event.itemId === null ? null : Number(event.itemId),
          event.title || null,
          event.detail || null,
          event.severity || null,
          JSON.stringify(event.raw || {}),
        ],
      );
    }
  }

  /**
   * The events behind a shop's figures, most recent first.
   */
  async listEvents({ shopIds = null, limit = 200 } = {}) {
    const result = await this.pool.query(
      `SELECT e.shop_id, e.event_date, e.event_kind, e.event_id, e.metric_key,
              e.reason_code, e.order_sn, e.item_id, e.title, e.detail, e.severity
       FROM shopee_shop_health_events e
       WHERE ($1::bigint[] IS NULL OR e.shop_id = ANY($1::bigint[]))
       ORDER BY e.shop_id, e.event_date DESC, e.event_kind, e.event_id
       LIMIT $2`,
      [shopIds, limit],
    );
    return result.rows.map(row => ({
      shopId: Number(row.shop_id),
      eventDate: row.event_date,
      kind: row.event_kind,
      eventId: row.event_id,
      metricKey: row.metric_key,
      reasonCode: row.reason_code,
      orderSn: row.order_sn,
      itemId: row.item_id === null ? null : Number(row.item_id),
      title: row.title,
      detail: row.detail,
      severity: row.severity,
    }));
  }

  /**
   * The latest reading for each shop, with the shop's own details.
   *
   * A shop with no reading is left out rather than shown as a shop with
   * nothing wrong with it — it has not been looked at, which is different
   * from having looked and found it well.
   */
  async listWithShops({ shopIds = null } = {}) {
    const result = await this.pool.query(
      `SELECT DISTINCT ON (h.shop_id)
         h.shop_id, h.event_date, h.shop_rating, h.csat_rate, h.response_rate,
         h.late_shipment_rate, h.non_fulfillment_rate, h.preparation_time,
         h.cancellation_rate, h.return_refund_rate, h.pre_order_listing_rate,
         h.severe_listing_violations, h.other_listing_violations,
         h.prohibited_listings, h.counterfeit_ip_infringement, h.spam_listings,
         h.fulfillment_failed, h.listing_failed, h.custom_service_failed,
         h.targets_json, h.synced_at,
         p.display_name, p.operator_label, p.country_code, p.brand_code,
         p.brand_name, p.currency, p.timezone, p.import_source_shop_name
       FROM shopee_shop_health_daily h
       LEFT JOIN shopee_shop_profiles p ON p.shop_id = h.shop_id
       WHERE ($1::bigint[] IS NULL OR h.shop_id = ANY($1::bigint[]))
       ORDER BY h.shop_id, h.event_date DESC`,
      [shopIds],
    );
    return result.rows.map(row => ({
      shopId: Number(row.shop_id),
      eventDate: row.event_date,
      displayName: row.operator_label || row.display_name || `Shop ${row.shop_id}`,
      countryCode: row.country_code,
      brandCode: row.brand_code,
      brandName: row.brand_name,
      currency: row.currency,
      timezone: row.timezone,
      importSourceShopName: row.import_source_shop_name,
      shopRating: row.shop_rating === null ? null : Number(row.shop_rating),
      csatRate: row.csat_rate === null ? null : Number(row.csat_rate),
      responseRate: row.response_rate === null ? null : Number(row.response_rate),
      lateShipmentRate: row.late_shipment_rate === null ? null : Number(row.late_shipment_rate),
      nonFulfillmentRate: row.non_fulfillment_rate === null ? null : Number(row.non_fulfillment_rate),
      preparationTime: row.preparation_time === null ? null : Number(row.preparation_time),
      cancellationRate: row.cancellation_rate === null ? null : Number(row.cancellation_rate),
      returnRefundRate: row.return_refund_rate === null ? null : Number(row.return_refund_rate),
      preOrderListingRate: row.pre_order_listing_rate === null ? null : Number(row.pre_order_listing_rate),
      severeListingViolations: row.severe_listing_violations === null ? null : Number(row.severe_listing_violations),
      otherListingViolations: row.other_listing_violations === null ? null : Number(row.other_listing_violations),
      prohibitedListings: row.prohibited_listings === null ? null : Number(row.prohibited_listings),
      counterfeitIpInfringement: row.counterfeit_ip_infringement === null ? null : Number(row.counterfeit_ip_infringement),
      spamListings: row.spam_listings === null ? null : Number(row.spam_listings),
      fulfillmentFailed: row.fulfillment_failed === null ? null : Number(row.fulfillment_failed),
      listingFailed: row.listing_failed === null ? null : Number(row.listing_failed),
      customServiceFailed: row.custom_service_failed === null ? null : Number(row.custom_service_failed),
      targets: row.targets_json || {},
      syncedAt: row.synced_at,
    }));
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
