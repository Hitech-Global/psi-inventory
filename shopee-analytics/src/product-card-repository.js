'use strict';

class ShopeeProductCardRepository {
  constructor({ pool }) {
    if (!pool || typeof pool.query !== 'function' || typeof pool.connect !== 'function') {
      throw new Error('pg Pool with query/connect is required');
    }
    this.pool = pool;
  }

  async upsertPeriodRows({ shopId, rows }) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const row of rows || []) {
        await client.query(
          `INSERT INTO shopee_product_card_period
           (shop_id,start_date,end_date,item_id,item_name,parent_sku,item_sku,
            impressions,clicks,ctr,visitors,page_views,add_to_cart_visitors,add_to_cart_units,
            add_to_cart_rate,orders,buyers,units,sales,conversion_rate,source_file,raw_json,imported_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22::jsonb,now())
           ON CONFLICT (shop_id,start_date,end_date,item_id) DO UPDATE SET
            item_name=EXCLUDED.item_name,
            parent_sku=EXCLUDED.parent_sku,
            item_sku=EXCLUDED.item_sku,
            impressions=EXCLUDED.impressions,
            clicks=EXCLUDED.clicks,
            ctr=EXCLUDED.ctr,
            visitors=EXCLUDED.visitors,
            page_views=EXCLUDED.page_views,
            add_to_cart_visitors=EXCLUDED.add_to_cart_visitors,
            add_to_cart_units=EXCLUDED.add_to_cart_units,
            add_to_cart_rate=EXCLUDED.add_to_cart_rate,
            orders=EXCLUDED.orders,
            buyers=EXCLUDED.buyers,
            units=EXCLUDED.units,
            sales=EXCLUDED.sales,
            conversion_rate=EXCLUDED.conversion_rate,
            source_file=EXCLUDED.source_file,
            raw_json=EXCLUDED.raw_json,
            imported_at=now()`,
          [
            shopId,row.startDate,row.endDate,row.itemId,row.itemName,row.parentSku,row.itemSku,
            row.impressions,row.clicks,row.ctr,row.visitors,row.pageViews,row.addToCartVisitors,row.addToCartUnits,
            row.addToCartRate,row.orders,row.buyers,row.units,row.sales,row.conversionRate,row.sourceFile,
            JSON.stringify(row.raw || {}),
          ],
        );
      }
      await client.query('COMMIT');
      return { imported: (rows || []).length };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch {}
      throw error;
    } finally {
      client.release();
    }
  }
}

module.exports = { ShopeeProductCardRepository };
