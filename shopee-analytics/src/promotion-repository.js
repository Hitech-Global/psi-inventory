'use strict';

class ShopeePromotionRepository {
  constructor({ pool }) {
    if (!pool || typeof pool.query !== 'function' || typeof pool.connect !== 'function') {
      throw new Error('pg Pool with query/connect is required');
    }
    this.pool = pool;
  }

  async withTransaction(fn) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch {}
      throw error;
    } finally {
      client.release();
    }
  }

  async upsertVoucher({ shopId, voucher }) {
    return this.withTransaction(async client => {
      await client.query(
        `INSERT INTO shopee_vouchers
         (shop_id, voucher_id, voucher_code, voucher_name, voucher_type, reward_type,
          start_time, end_time, percentage, discount_amount, max_price, min_basket_price,
          usage_quantity, current_usage, is_admin, raw_json, synced_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,now())
         ON CONFLICT (shop_id, voucher_id) DO UPDATE SET
          voucher_code=EXCLUDED.voucher_code,
          voucher_name=EXCLUDED.voucher_name,
          voucher_type=EXCLUDED.voucher_type,
          reward_type=EXCLUDED.reward_type,
          start_time=EXCLUDED.start_time,
          end_time=EXCLUDED.end_time,
          percentage=EXCLUDED.percentage,
          discount_amount=EXCLUDED.discount_amount,
          max_price=EXCLUDED.max_price,
          min_basket_price=EXCLUDED.min_basket_price,
          usage_quantity=EXCLUDED.usage_quantity,
          current_usage=EXCLUDED.current_usage,
          is_admin=EXCLUDED.is_admin,
          raw_json=EXCLUDED.raw_json,
          synced_at=now()`,
        [
          shopId, voucher.voucherId, voucher.voucherCode, voucher.voucherName,
          voucher.voucherType, voucher.rewardType, voucher.startTime, voucher.endTime,
          voucher.percentage, voucher.discountAmount, voucher.maxPrice, voucher.minBasketPrice,
          voucher.usageQuantity, voucher.currentUsage, voucher.isAdmin,
          JSON.stringify(voucher.raw || {}),
        ],
      );
      await client.query('DELETE FROM shopee_voucher_items WHERE shop_id=$1 AND voucher_id=$2', [shopId, voucher.voucherId]);
      for (const itemId of voucher.itemIds || []) {
        await client.query(
          `INSERT INTO shopee_voucher_items (shop_id, voucher_id, item_id)
           VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
          [shopId, voucher.voucherId, itemId],
        );
      }
    });
  }

  async upsertDiscount({ shopId, discount }) {
    return this.withTransaction(async client => {
      await client.query(
        `INSERT INTO shopee_discounts
         (shop_id, discount_id, discount_name, status, start_time, end_time, source, raw_json, synced_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,now())
         ON CONFLICT (shop_id, discount_id) DO UPDATE SET
          discount_name=EXCLUDED.discount_name,
          status=EXCLUDED.status,
          start_time=EXCLUDED.start_time,
          end_time=EXCLUDED.end_time,
          source=EXCLUDED.source,
          raw_json=EXCLUDED.raw_json,
          synced_at=now()`,
        [
          shopId, discount.discountId, discount.discountName, discount.status,
          discount.startTime, discount.endTime, discount.source,
          JSON.stringify(discount.raw || {}),
        ],
      );
      await client.query('DELETE FROM shopee_discount_items WHERE shop_id=$1 AND discount_id=$2', [shopId, discount.discountId]);
      for (const row of discount.itemRows || []) {
        await client.query(
          `INSERT INTO shopee_discount_items
           (shop_id, discount_id, item_id, model_id, original_price, promotion_price, promotion_stock, raw_json)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
           ON CONFLICT (shop_id, discount_id, item_id, model_id) DO UPDATE SET
            original_price=EXCLUDED.original_price,
            promotion_price=EXCLUDED.promotion_price,
            promotion_stock=EXCLUDED.promotion_stock,
            raw_json=EXCLUDED.raw_json`,
          [
            shopId, discount.discountId, row.itemId, row.modelId || 0,
            row.originalPrice, row.promotionPrice, row.promotionStock,
            JSON.stringify(row.raw || {}),
          ],
        );
      }
    });
  }
}

module.exports = { ShopeePromotionRepository };
