'use strict';

class ShopeeShopBiRepository {
  constructor({ pool }) {
    if (!pool || typeof pool.query !== 'function') throw new Error('pg pool/query adapter is required');
    this.pool = pool;
  }

  async upsertDaily({ eventDate, detail }) {
    await this.pool.query(
      `INSERT INTO shopee_shop_bi_daily
       (shop_id, event_date, sales, orders, units_sold, product_clicks, product_views,
        unique_visitors, item_conversion_rate, order_conversion_rate, voucher_sales,
        voucher_buyers, voucher_usage_rate, voucher_cir, voucher_cost, raw_json, synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,now())
       ON CONFLICT (shop_id, event_date) DO UPDATE SET
        sales=EXCLUDED.sales,
        orders=EXCLUDED.orders,
        units_sold=EXCLUDED.units_sold,
        product_clicks=EXCLUDED.product_clicks,
        product_views=EXCLUDED.product_views,
        unique_visitors=EXCLUDED.unique_visitors,
        item_conversion_rate=EXCLUDED.item_conversion_rate,
        order_conversion_rate=EXCLUDED.order_conversion_rate,
        voucher_sales=EXCLUDED.voucher_sales,
        voucher_buyers=EXCLUDED.voucher_buyers,
        voucher_usage_rate=EXCLUDED.voucher_usage_rate,
        voucher_cir=EXCLUDED.voucher_cir,
        voucher_cost=EXCLUDED.voucher_cost,
        raw_json=EXCLUDED.raw_json,
        synced_at=now()`,
      [
        detail.shopId, eventDate, detail.sales, detail.orders, detail.unitsSold,
        detail.productClicks, detail.productViews, detail.uniqueVisitors,
        detail.itemConversionRate, detail.orderConversionRate, detail.voucherSales,
        detail.voucherBuyers, detail.voucherUsageRate, detail.voucherCir,
        detail.voucherCost, JSON.stringify(detail.raw || {}),
      ],
    );
  }
}

module.exports = { ShopeeShopBiRepository };
