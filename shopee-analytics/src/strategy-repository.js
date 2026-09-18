'use strict';

class ShopeeStrategyRepository {
  constructor({ pool }) {
    if (!pool || typeof pool.query !== 'function') throw new Error('pg pool/query adapter is required');
    this.pool = pool;
  }

  async getShopStrategy(shopId) {
    const result = await this.pool.query(
      `SELECT ad_spend_ratio_limit, weekly_order_reference
       FROM shopee_shop_strategy_config WHERE shop_id=$1`,
      [shopId],
    );
    const row = result.rows[0] || {};
    return {
      adSpendRatioLimit: row.ad_spend_ratio_limit === undefined ? 0.15 : Number(row.ad_spend_ratio_limit),
      weeklyOrderReference: row.weekly_order_reference === undefined ? 25 : Number(row.weekly_order_reference),
    };
  }

  async upsertShopStrategy({ shopId, adSpendRatioLimit = 0.15, weeklyOrderReference = 25 }) {
    await this.pool.query(
      `INSERT INTO shopee_shop_strategy_config
       (shop_id, ad_spend_ratio_limit, weekly_order_reference, updated_at)
       VALUES ($1,$2,$3,now())
       ON CONFLICT (shop_id) DO UPDATE SET
        ad_spend_ratio_limit=EXCLUDED.ad_spend_ratio_limit,
        weekly_order_reference=EXCLUDED.weekly_order_reference,
        updated_at=now()`,
      [shopId, adSpendRatioLimit, weeklyOrderReference],
    );
  }

  async getItemBreakEvenMap({ shopId, itemIds }) {
    const ids = (itemIds || []).map(Number).filter(Number.isSafeInteger);
    if (!ids.length) return new Map();
    const result = await this.pool.query(
      `SELECT item_id, break_even_roas
       FROM shopee_item_strategy_config
       WHERE shop_id=$1 AND item_id = ANY($2::bigint[])`,
      [shopId, ids],
    );
    return new Map(result.rows.map(row => [String(row.item_id), Number(row.break_even_roas || 0)]));
  }

  async upsertItemBreakEven({ shopId, itemId, breakEvenRoas, note = null }) {
    await this.pool.query(
      `INSERT INTO shopee_item_strategy_config
       (shop_id, item_id, break_even_roas, note, updated_at)
       VALUES ($1,$2,$3,$4,now())
       ON CONFLICT (shop_id, item_id) DO UPDATE SET
        break_even_roas=EXCLUDED.break_even_roas,
        note=EXCLUDED.note,
        updated_at=now()`,
      [shopId, itemId, breakEvenRoas, note],
    );
  }
}

module.exports = { ShopeeStrategyRepository };
