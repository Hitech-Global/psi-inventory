'use strict';

class ShopeeReturnRepository {
  constructor({ pool }) {
    if (!pool || typeof pool.query !== 'function' || typeof pool.connect !== 'function') {
      throw new Error('pg Pool with query/connect is required');
    }
    this.pool = pool;
  }

  async upsertReturn({ shopId, returnRecord }) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO shopee_returns
         (shop_id, return_sn, order_sn, status, reason, currency, refund_amount, create_time, update_time, raw_json, synced_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,now())
         ON CONFLICT (shop_id, return_sn) DO UPDATE SET
          order_sn=EXCLUDED.order_sn,
          status=EXCLUDED.status,
          reason=EXCLUDED.reason,
          currency=EXCLUDED.currency,
          refund_amount=EXCLUDED.refund_amount,
          create_time=EXCLUDED.create_time,
          update_time=EXCLUDED.update_time,
          raw_json=EXCLUDED.raw_json,
          synced_at=now()`,
        [
          shopId, returnRecord.returnSn, returnRecord.orderSn, returnRecord.status,
          returnRecord.reason, returnRecord.currency, returnRecord.refundAmount,
          returnRecord.createTime, returnRecord.updateTime,
          JSON.stringify(returnRecord.raw || {}),
        ],
      );
      await client.query('DELETE FROM shopee_return_items WHERE shop_id=$1 AND return_sn=$2', [shopId, returnRecord.returnSn]);
      for (const item of returnRecord.items || []) {
        await client.query(
          `INSERT INTO shopee_return_items
           (shop_id, return_sn, item_id, model_id, quantity, item_price, refund_amount, raw_json)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
           ON CONFLICT (shop_id, return_sn, item_id, model_id) DO UPDATE SET
            quantity=EXCLUDED.quantity,
            item_price=EXCLUDED.item_price,
            refund_amount=EXCLUDED.refund_amount,
            raw_json=EXCLUDED.raw_json`,
          [
            shopId, returnRecord.returnSn, item.itemId, item.modelId || 0,
            item.quantity, item.itemPrice, item.refundAmount,
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

module.exports = { ShopeeReturnRepository };
