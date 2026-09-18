'use strict';

class ShopeeOrderRepository {
  constructor({ pool }) {
    if (!pool || typeof pool.query !== 'function' || typeof pool.connect !== 'function') {
      throw new Error('pg Pool with query/connect is required');
    }
    this.pool = pool;
  }

  async upsertOrder({ shopId, order }) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO shopee_orders
         (shop_id, order_sn, order_status, create_time, update_time, currency, total_amount, raw_json, synced_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,now())
         ON CONFLICT (shop_id, order_sn) DO UPDATE SET
          order_status=EXCLUDED.order_status,
          create_time=EXCLUDED.create_time,
          update_time=EXCLUDED.update_time,
          currency=EXCLUDED.currency,
          total_amount=EXCLUDED.total_amount,
          raw_json=EXCLUDED.raw_json,
          synced_at=now()`,
        [
          shopId, order.orderSn, order.orderStatus, order.createTime, order.updateTime,
          order.currency, order.totalAmount, JSON.stringify(order.raw || {}),
        ],
      );
      await client.query('DELETE FROM shopee_order_items WHERE shop_id=$1 AND order_sn=$2', [shopId, order.orderSn]);
      for (const item of order.items || []) {
        await client.query(
          `INSERT INTO shopee_order_items
           (shop_id, order_sn, item_id, model_id, item_sku, model_sku, quantity, unit_price, raw_json)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
           ON CONFLICT (shop_id, order_sn, item_id, model_id) DO UPDATE SET
            item_sku=EXCLUDED.item_sku,
            model_sku=EXCLUDED.model_sku,
            quantity=EXCLUDED.quantity,
            unit_price=EXCLUDED.unit_price,
            raw_json=EXCLUDED.raw_json`,
          [
            shopId, order.orderSn, item.itemId, item.modelId || 0,
            item.itemSku, item.modelSku, item.quantity, item.discountedPrice,
            JSON.stringify(item.raw || {}),
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
}

module.exports = { ShopeeOrderRepository };
