'use strict';

class ShopeeShopLivestreamRepository {
  constructor({ pool }) {
    if (!pool || typeof pool.query !== 'function') throw new Error('pg pool/query adapter is required');
    this.pool = pool;
  }

  async upsertDaily({ eventDate, detail }) {
    await this.pool.query(
      `INSERT INTO shopee_shop_livestream_daily
       (shop_id, event_date, live_sessions, live_hours, live_views, live_viewers,
        confirmed_orders, confirmed_sales, raw_json, synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,now())
       ON CONFLICT (shop_id, event_date) DO UPDATE SET
        live_sessions=EXCLUDED.live_sessions,
        live_hours=EXCLUDED.live_hours,
        live_views=EXCLUDED.live_views,
        live_viewers=EXCLUDED.live_viewers,
        confirmed_orders=EXCLUDED.confirmed_orders,
        confirmed_sales=EXCLUDED.confirmed_sales,
        raw_json=EXCLUDED.raw_json,
        synced_at=now()`,
      [
        detail.shopId,
        eventDate,
        detail.liveSessions,
        detail.liveHours,
        detail.liveViews,
        detail.liveViewers,
        detail.confirmedOrders,
        detail.confirmedSales,
        JSON.stringify(detail.raw || {}),
      ],
    );
  }
}

module.exports = { ShopeeShopLivestreamRepository };
