'use strict';

class ShopeeProductRepository {
  constructor({ pool }) {
    if (!pool || typeof pool.query !== 'function' || typeof pool.connect !== 'function') {
      throw new Error('pg Pool with query/connect is required');
    }
    this.pool = pool;
  }

  async upsertItem({ shopId, item }) {
    await this.pool.query(
      `INSERT INTO shopee_products
       (shop_id, item_id, item_status, update_time, raw_json, synced_at)
       VALUES ($1,$2,$3,$4,$5::jsonb,now())
       ON CONFLICT (shop_id, item_id) DO UPDATE SET
        item_status=EXCLUDED.item_status,
        update_time=EXCLUDED.update_time,
        raw_json=EXCLUDED.raw_json,
        synced_at=now()`,
      [shopId, item.itemId, item.itemStatus, item.updateTime, JSON.stringify(item.raw || {})],
    );
  }

  async replaceModels({ shopId, itemId, models }) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM shopee_product_models WHERE shop_id=$1 AND item_id=$2', [shopId, itemId]);
      for (const model of models || []) {
        await client.query(
          `INSERT INTO shopee_product_models
           (shop_id, item_id, model_id, model_name, model_sku, current_price, original_price, stock, raw_json, synced_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,now())
           ON CONFLICT (shop_id, item_id, model_id) DO UPDATE SET
            model_name=EXCLUDED.model_name,
            model_sku=EXCLUDED.model_sku,
            current_price=EXCLUDED.current_price,
            original_price=EXCLUDED.original_price,
            stock=EXCLUDED.stock,
            raw_json=EXCLUDED.raw_json,
            synced_at=now()`,
          [
            shopId, itemId, model.modelId, model.modelName, model.modelSku,
            model.currentPrice, model.originalPrice, model.stock,
            JSON.stringify(model.raw || {}),
          ],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch {}
      throw error;
    } finally {
      client.release();
    }
  }

  async insertRecommendedRoi({ shopId, itemId, observedAt = new Date(), recommendation }) {
    await this.pool.query(
      `INSERT INTO shopee_recommended_roi_history
       (shop_id, item_id, observed_at,
        lower_value, lower_percentile, exact_value, exact_percentile,
        upper_value, upper_percentile, raw_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
       ON CONFLICT (shop_id, item_id, observed_at) DO NOTHING`,
      [
        shopId, itemId, observedAt,
        recommendation.lower.value, recommendation.lower.percentile,
        recommendation.exact.value, recommendation.exact.percentile,
        recommendation.upper.value, recommendation.upper.percentile,
        JSON.stringify(recommendation.raw || {}),
      ],
    );
  }
}

module.exports = { ShopeeProductRepository };
