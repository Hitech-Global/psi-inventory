'use strict';

function comparableModel(row) {
  if (!row) return null;
  return {
    modelId: Number(row.model_id ?? row.modelId),
    modelName: row.model_name ?? row.modelName ?? null,
    modelSku: row.model_sku ?? row.modelSku ?? null,
    currentPrice: row.current_price === null || row.current_price === undefined
      ? (row.currentPrice ?? null)
      : Number(row.current_price),
    originalPrice: row.original_price === null || row.original_price === undefined
      ? (row.originalPrice ?? null)
      : Number(row.original_price),
    stock: row.stock === null || row.stock === undefined ? null : Number(row.stock),
  };
}

function priceChanged(before, after) {
  if (!before || !after) return false;
  return (
    String(before.currentPrice ?? null) !== String(after.currentPrice ?? null) ||
    String(before.originalPrice ?? null) !== String(after.originalPrice ?? null)
  );
}

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
       (shop_id, item_id, item_name, item_sku, item_status, category_id, update_time, raw_json, synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,now())
       ON CONFLICT (shop_id, item_id) DO UPDATE SET
        item_name=COALESCE(EXCLUDED.item_name,shopee_products.item_name),
        item_sku=COALESCE(EXCLUDED.item_sku,shopee_products.item_sku),
        item_status=COALESCE(EXCLUDED.item_status,shopee_products.item_status),
        category_id=COALESCE(EXCLUDED.category_id,shopee_products.category_id),
        update_time=COALESCE(EXCLUDED.update_time,shopee_products.update_time),
        raw_json=CASE WHEN EXCLUDED.raw_json='{}'::jsonb THEN shopee_products.raw_json ELSE EXCLUDED.raw_json END,
        synced_at=now()`,
      [
        shopId, item.itemId, item.itemName || null, item.itemSku || null,
        item.itemStatus || null, item.categoryId ?? null, item.updateTime ?? null,
        JSON.stringify(item.raw || {}),
      ],
    );
  }

  async replaceModels({ shopId, itemId, models, observedAt = new Date() }) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const previousResult = await client.query(
        `SELECT model_id,model_name,model_sku,current_price,original_price,stock
         FROM shopee_product_models
         WHERE shop_id=$1 AND item_id=$2`,
        [shopId, itemId],
      );
      const previousById = new Map(
        previousResult.rows.map(row => [String(row.model_id), comparableModel(row)]),
      );

      await client.query(
        'DELETE FROM shopee_product_models WHERE shop_id=$1 AND item_id=$2',
        [shopId, itemId],
      );

      for (const model of models || []) {
        const current = comparableModel(model);
        const before = previousById.get(String(current.modelId)) || null;

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

        if (before && priceChanged(before, current)) {
          await client.query(
            `INSERT INTO shopee_operation_history
             (shop_id,item_id,operation_type,reason,before_json,after_json,effective_from)
             VALUES ($1,$2,'PRICE_CHANGE',$3,$4::jsonb,$5::jsonb,$6)`,
            [
              shopId,
              itemId,
              `Price changed for model ${current.modelSku || current.modelName || current.modelId}`,
              JSON.stringify(before),
              JSON.stringify(current),
              observedAt,
            ],
          );
        }
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

module.exports = {
  comparableModel,
  priceChanged,
  ShopeeProductRepository,
};
