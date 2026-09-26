'use strict';

class ShopeeShopRepository {
  constructor({ pool }) {
    if (!pool || typeof pool.query !== 'function') throw new Error('pg pool/query adapter is required');
    this.pool = pool;
  }

  async upsert({ requestedShopId, shop }) {
    const shopId = Number(shop.shopId || requestedShopId);
    if (!Number.isSafeInteger(shopId) || shopId <= 0) throw new Error('shopId is required');
    if (shop.shopId && Number(shop.shopId) !== Number(requestedShopId)) {
      throw new Error(`Shopee shop identity mismatch: requested ${requestedShopId}, API returned ${shop.shopId}`);
    }

    await this.pool.query(
      `INSERT INTO shopee_shops
       (shop_id,shop_name,region,status,raw_json,synced_at)
       VALUES ($1,$2,$3,$4,$5::jsonb,now())
       ON CONFLICT (shop_id) DO UPDATE SET
        shop_name=EXCLUDED.shop_name,
        region=EXCLUDED.region,
        status=EXCLUDED.status,
        raw_json=EXCLUDED.raw_json,
        synced_at=now()`,
      [
        shopId,
        shop.shopName,
        shop.region,
        shop.status,
        JSON.stringify(shop.raw || {}),
      ],
    );
  }
}

module.exports = { ShopeeShopRepository };
