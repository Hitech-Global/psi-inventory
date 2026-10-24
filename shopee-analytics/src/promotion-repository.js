'use strict';

function normalizeNumber(value) {
  return value === null || value === undefined ? null : Number(value);
}

function comparableVoucher(row, itemIds = []) {
  if (!row) return null;
  return {
    voucherId: Number(row.voucher_id ?? row.voucherId),
    voucherType: row.voucher_type ?? row.voucherType ?? null,
    rewardType: row.reward_type ?? row.rewardType ?? null,
    startTime: row.start_time ?? row.startTime ?? null,
    endTime: row.end_time ?? row.endTime ?? null,
    percentage: normalizeNumber(row.percentage),
    discountAmount: normalizeNumber(row.discount_amount ?? row.discountAmount),
    maxPrice: normalizeNumber(row.max_price ?? row.maxPrice),
    minBasketPrice: normalizeNumber(row.min_basket_price ?? row.minBasketPrice),
    itemIds: Array.from(new Set((itemIds || []).map(Number).filter(Number.isSafeInteger)))
      .sort((a, b) => a - b),
  };
}

function voucherChangedFields(before, after) {
  if (!before || !after) return [];
  const fields = [
    'voucherType', 'rewardType', 'startTime', 'endTime',
    'percentage', 'discountAmount', 'maxPrice', 'minBasketPrice',
  ];
  const changed = fields.filter(key =>
    String(before[key] ?? null) !== String(after[key] ?? null)
  );
  if (JSON.stringify(before.itemIds || []) !== JSON.stringify(after.itemIds || [])) {
    changed.push('itemIds');
  }
  return changed;
}

function comparableDiscountHeader(row) {
  if (!row) return null;
  return {
    discountId: Number(row.discount_id ?? row.discountId),
    discountName: row.discount_name ?? row.discountName ?? null,
    startTime: row.start_time ?? row.startTime ?? null,
    endTime: row.end_time ?? row.endTime ?? null,
    source: row.source ?? null,
  };
}

function normalizeDiscountRows(rows) {
  return (rows || [])
    .map(row => ({
      itemId: Number(row.item_id ?? row.itemId),
      modelId: Number(row.model_id ?? row.modelId ?? 0),
      originalPrice: normalizeNumber(row.original_price ?? row.originalPrice),
      promotionPrice: normalizeNumber(row.promotion_price ?? row.promotionPrice),
    }))
    .filter(row => Number.isSafeInteger(row.itemId))
    .sort((a, b) => a.itemId - b.itemId || a.modelId - b.modelId);
}

function groupDiscountRows(rows) {
  const groups = new Map();
  for (const row of normalizeDiscountRows(rows)) {
    const key = String(row.itemId);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return groups;
}

function discountHeaderChanged(before, after) {
  if (!before || !after) return false;
  return ['discountName', 'startTime', 'endTime', 'source'].some(key =>
    String(before[key] ?? null) !== String(after[key] ?? null)
  );
}

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

  async upsertVoucher({ shopId, voucher, observedAt = new Date() }) {
    return this.withTransaction(async client => {
      const [previousVoucherResult, previousItemsResult] = await Promise.all([
        client.query(
          `SELECT voucher_id,voucher_type,reward_type,start_time,end_time,percentage,
                  discount_amount,max_price,min_basket_price
           FROM shopee_vouchers
           WHERE shop_id=$1 AND voucher_id=$2`,
          [shopId, voucher.voucherId],
        ),
        client.query(
          `SELECT item_id
           FROM shopee_voucher_items
           WHERE shop_id=$1 AND voucher_id=$2
           ORDER BY item_id`,
          [shopId, voucher.voucherId],
        ),
      ]);

      const previous = comparableVoucher(
        previousVoucherResult.rows[0],
        previousItemsResult.rows.map(row => Number(row.item_id)),
      );
      const next = comparableVoucher(voucher, voucher.itemIds || []);
      const changedFields = voucherChangedFields(previous, next);

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

      await client.query(
        'DELETE FROM shopee_voucher_items WHERE shop_id=$1 AND voucher_id=$2',
        [shopId, voucher.voucherId],
      );
      for (const itemId of voucher.itemIds || []) {
        await client.query(
          `INSERT INTO shopee_voucher_items (shop_id, voucher_id, item_id)
           VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
          [shopId, voucher.voucherId, itemId],
        );
      }

      if (previous && changedFields.length) {
        const affected = Array.from(new Set([
          ...(previous.itemIds || []),
          ...(next.itemIds || []),
        ]));
        const targetItems = affected.length ? affected : [null];
        for (const itemId of targetItems) {
          await client.query(
            `INSERT INTO shopee_operation_history
             (shop_id,item_id,operation_type,reason,before_json,after_json,effective_from)
             VALUES ($1,$2,'VOUCHER_CHANGE',$3,$4::jsonb,$5::jsonb,$6)`,
            [
              shopId,
              itemId,
              `Voucher #${voucher.voucherId} changed: ${changedFields.join(', ')}`,
              JSON.stringify(previous),
              JSON.stringify(next),
              observedAt,
            ],
          );
        }
      }
    });
  }

  async upsertDiscount({ shopId, discount, observedAt = new Date() }) {
    return this.withTransaction(async client => {
      const [previousHeaderResult, previousItemsResult] = await Promise.all([
        client.query(
          `SELECT discount_id,discount_name,start_time,end_time,source
           FROM shopee_discounts
           WHERE shop_id=$1 AND discount_id=$2`,
          [shopId, discount.discountId],
        ),
        client.query(
          `SELECT item_id,model_id,original_price,promotion_price
           FROM shopee_discount_items
           WHERE shop_id=$1 AND discount_id=$2
           ORDER BY item_id,model_id`,
          [shopId, discount.discountId],
        ),
      ]);

      const previousHeader = comparableDiscountHeader(previousHeaderResult.rows[0]);
      const nextHeader = comparableDiscountHeader(discount);
      const previousGroups = groupDiscountRows(previousItemsResult.rows);
      const nextGroups = groupDiscountRows(discount.itemRows || []);

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

      await client.query(
        'DELETE FROM shopee_discount_items WHERE shop_id=$1 AND discount_id=$2',
        [shopId, discount.discountId],
      );
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

      if (previousHeader) {
        const headerChanged = discountHeaderChanged(previousHeader, nextHeader);
        const itemIds = Array.from(new Set([
          ...Array.from(previousGroups.keys()),
          ...Array.from(nextGroups.keys()),
        ]))
          .map(Number)
          .sort((a, b) => a - b);

        for (const itemId of itemIds) {
          const beforeRows = previousGroups.get(String(itemId)) || [];
          const afterRows = nextGroups.get(String(itemId)) || [];
          const itemChanged = JSON.stringify(beforeRows) !== JSON.stringify(afterRows);
          if (!headerChanged && !itemChanged) continue;

          await client.query(
            `INSERT INTO shopee_operation_history
             (shop_id,item_id,operation_type,reason,before_json,after_json,effective_from)
             VALUES ($1,$2,'DISCOUNT_CHANGE',$3,$4::jsonb,$5::jsonb,$6)`,
            [
              shopId,
              itemId,
              `Discount #${discount.discountId} changed`,
              JSON.stringify({ ...previousHeader, itemRows: beforeRows }),
              JSON.stringify({ ...nextHeader, itemRows: afterRows }),
              observedAt,
            ],
          );
        }
      }
    });
  }
}

module.exports = {
  comparableVoucher,
  voucherChangedFields,
  comparableDiscountHeader,
  normalizeDiscountRows,
  groupDiscountRows,
  discountHeaderChanged,
  ShopeePromotionRepository,
};
