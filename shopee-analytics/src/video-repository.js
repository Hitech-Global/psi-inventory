'use strict';

/**
 * The videos of a shop, kept day by day.
 *
 * Two things are kept: how the shop's videos did as a whole on each day,
 * and how each video did on each day. The first is what a reader asks
 * for when they want to know how the shop is doing; the second is what
 * they ask for when they want to know which video to make more of.
 */
class ShopeeVideoRepository {
  constructor({ pool }) {
    if (!pool || typeof pool.query !== 'function') throw new Error('pg pool/query adapter is required');
    this.pool = pool;
  }

  /**
   * A day of the shop's videos, as a whole.
   */
  async upsertDaily({ shopId, eventDate, detail }) {
    await this.pool.query(
      `INSERT INTO shopee_video_daily
       (shop_id, event_date, videos, views, effective_views, viewers,
        watch_duration_seconds, likes, shares, comments, new_followers,
        buyers, add_to_cart, orders, units_sold, sales, raw_json, synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,now())
       ON CONFLICT (shop_id, event_date) DO UPDATE SET
        videos=EXCLUDED.videos,
        views=EXCLUDED.views,
        effective_views=EXCLUDED.effective_views,
        viewers=EXCLUDED.viewers,
        watch_duration_seconds=EXCLUDED.watch_duration_seconds,
        likes=EXCLUDED.likes,
        shares=EXCLUDED.shares,
        comments=EXCLUDED.comments,
        new_followers=EXCLUDED.new_followers,
        buyers=EXCLUDED.buyers,
        add_to_cart=EXCLUDED.add_to_cart,
        orders=EXCLUDED.orders,
        units_sold=EXCLUDED.units_sold,
        sales=EXCLUDED.sales,
        raw_json=EXCLUDED.raw_json,
        synced_at=now()`,
      [
        shopId, eventDate,
        detail.videos, detail.views, detail.effectiveViews, detail.viewers,
        detail.watchDurationSeconds, detail.likes, detail.shares, detail.comments,
        detail.newFollowers, detail.buyers, detail.addToCart, detail.orders,
        detail.unitsSold, detail.sales,
        JSON.stringify(detail.raw || {}),
      ],
    );
  }

  /**
   * One video, on one day.
   */
  async upsertItem({ shopId, videoId, eventDate, title, status, publishedAt, detail }) {
    await this.pool.query(
      `INSERT INTO shopee_video_item
       (shop_id, video_id, event_date, title, status, published_at,
        views, effective_views, viewers, watch_duration_seconds,
        likes, shares, comments, buyers, add_to_cart, orders, sales, raw_json, synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,now())
       ON CONFLICT (shop_id, video_id, event_date) DO UPDATE SET
        title=EXCLUDED.title,
        status=EXCLUDED.status,
        published_at=EXCLUDED.published_at,
        views=EXCLUDED.views,
        effective_views=EXCLUDED.effective_views,
        viewers=EXCLUDED.viewers,
        watch_duration_seconds=EXCLUDED.watch_duration_seconds,
        likes=EXCLUDED.likes,
        shares=EXCLUDED.shares,
        comments=EXCLUDED.comments,
        buyers=EXCLUDED.buyers,
        add_to_cart=EXCLUDED.add_to_cart,
        orders=EXCLUDED.orders,
        sales=EXCLUDED.sales,
        raw_json=EXCLUDED.raw_json,
        synced_at=now()`,
      [
        shopId, videoId, eventDate, title, status, publishedAt,
        detail.views, detail.effectiveViews, detail.viewers,
        detail.watchDurationSeconds, detail.likes, detail.shares,
        detail.comments, detail.buyers, detail.addToCart, detail.orders,
        detail.sales,
        JSON.stringify(detail.raw || {}),
      ],
    );
  }
}

module.exports = { ShopeeVideoRepository };
