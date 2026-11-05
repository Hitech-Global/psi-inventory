'use strict';

/**
 * The livestreams of a shop, kept one session at a time.
 *
 * A session is not a day, so each one is kept against the day it
 * started on. The day's total is worked out from these when a reader
 * wants to see how the shop's live hours add up.
 */
class ShopeeLivestreamRepository {
  constructor({ pool }) {
    if (!pool || typeof pool.query !== 'function') throw new Error('pg pool/query adapter is required');
    this.pool = pool;
  }

  async upsertSession({ shopId, sessionId, eventDate, title, startedAt, endedAt, detail }) {
    await this.pool.query(
      `INSERT INTO shopee_livestream_session
       (shop_id, session_id, event_date, title, started_at, ended_at,
        views, viewers, peak_viewers, watch_duration_seconds, clicks,
        add_to_cart, orders, units_sold, buyers, sales, comments, shares,
        raw_json, synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb,now())
       ON CONFLICT (shop_id, session_id) DO UPDATE SET
        event_date=EXCLUDED.event_date,
        title=EXCLUDED.title,
        started_at=EXCLUDED.started_at,
        ended_at=EXCLUDED.ended_at,
        views=EXCLUDED.views,
        viewers=EXCLUDED.viewers,
        peak_viewers=EXCLUDED.peak_viewers,
        watch_duration_seconds=EXCLUDED.watch_duration_seconds,
        clicks=EXCLUDED.clicks,
        add_to_cart=EXCLUDED.add_to_cart,
        orders=EXCLUDED.orders,
        units_sold=EXCLUDED.units_sold,
        buyers=EXCLUDED.buyers,
        sales=EXCLUDED.sales,
        comments=EXCLUDED.comments,
        shares=EXCLUDED.shares,
        raw_json=EXCLUDED.raw_json,
        synced_at=now()`,
      [
        shopId, sessionId, eventDate, title, startedAt, endedAt,
        detail.views, detail.viewers, detail.peakViewers, detail.watchDurationSeconds,
        detail.clicks, detail.addToCart, detail.orders, detail.unitsSold,
        detail.buyers, detail.sales, detail.comments, detail.shares,
        JSON.stringify(detail.raw || {}),
      ],
    );
  }

  /**
   * The day's total, written from the sessions that make it up.
   */
  async upsertDaily({ shopId, eventDate, detail }) {
    await this.pool.query(
      `INSERT INTO shopee_livestream_daily
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
        shopId, eventDate,
        detail.liveSessions, detail.liveHours, detail.liveViews, detail.liveViewers,
        detail.confirmedOrders, detail.confirmedSales,
        JSON.stringify(detail.raw || {}),
      ],
    );
  }
}

module.exports = { ShopeeLivestreamRepository };
