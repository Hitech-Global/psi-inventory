'use strict';

class ShopeeShopProfileRepository {
  constructor({ pool }) {
    if (!pool || typeof pool.query !== 'function') throw new Error('pg pool/query adapter is required');
    this.pool = pool;
  }

  async upsert(profile) {
    const shopId = Number(profile.shopId ?? profile.shop_id);
    if (!Number.isSafeInteger(shopId) || shopId <= 0) throw new Error('shopId must be a positive integer');

    const displayName = String(profile.displayName ?? profile.display_name ?? '').trim();
    const countryCode = String(profile.countryCode ?? profile.country_code ?? '').trim().toUpperCase();
    const brandCode = String(profile.brandCode ?? profile.brand_code ?? '').trim().toUpperCase();
    const currency = String(profile.currency ?? '').trim().toUpperCase();
    const timezone = String(profile.timezone ?? '').trim();

    if (!displayName) throw new Error('displayName is required');
    if (!countryCode) throw new Error('countryCode is required');
    if (!brandCode) throw new Error('brandCode is required');
    if (!currency) throw new Error('currency is required');
    if (!timezone) throw new Error('timezone is required');

    await this.pool.query(
      `INSERT INTO shopee_shop_profiles
       (shop_id,display_name,country_code,country_name,brand_code,brand_name,currency,timezone,
        marketplace_region,active,sort_order,note,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now())
       ON CONFLICT (shop_id) DO UPDATE SET
        display_name=EXCLUDED.display_name,
        country_code=EXCLUDED.country_code,
        country_name=EXCLUDED.country_name,
        brand_code=EXCLUDED.brand_code,
        brand_name=EXCLUDED.brand_name,
        currency=EXCLUDED.currency,
        timezone=EXCLUDED.timezone,
        marketplace_region=EXCLUDED.marketplace_region,
        active=EXCLUDED.active,
        sort_order=EXCLUDED.sort_order,
        note=EXCLUDED.note,
        updated_at=now()`,
      [
        shopId,
        displayName,
        countryCode,
        profile.countryName ?? profile.country_name ?? null,
        brandCode,
        profile.brandName ?? profile.brand_name ?? null,
        currency,
        timezone,
        profile.marketplaceRegion ?? profile.marketplace_region ?? null,
        profile.active === undefined ? true : Boolean(profile.active),
        Number.isFinite(Number(profile.sortOrder ?? profile.sort_order))
          ? Number(profile.sortOrder ?? profile.sort_order)
          : 0,
        profile.note ?? null,
      ],
    );
  }

  async upsertMany(profiles) {
    for (const profile of profiles || []) await this.upsert(profile);
    return { configured: (profiles || []).length };
  }

  async list({ activeOnly = true } = {}) {
    const result = await this.pool.query(
      `SELECT
         p.shop_id,p.display_name,p.country_code,p.country_name,p.brand_code,p.brand_name,
         p.currency,p.timezone,p.marketplace_region,p.active,p.sort_order,p.note,p.updated_at,
         s.shop_name AS api_shop_name,s.region AS api_region,s.status AS api_status,s.synced_at AS api_synced_at
       FROM shopee_shop_profiles p
       LEFT JOIN shopee_shops s ON s.shop_id=p.shop_id
       WHERE ($1::boolean=false OR p.active=true)
       ORDER BY p.country_code,p.brand_code,p.sort_order,p.display_name,p.shop_id`,
      [activeOnly],
    );
    return result.rows.map(row => ({
      shopId: Number(row.shop_id),
      displayName: row.display_name,
      countryCode: row.country_code,
      countryName: row.country_name,
      brandCode: row.brand_code,
      brandName: row.brand_name,
      currency: row.currency,
      timezone: row.timezone,
      marketplaceRegion: row.marketplace_region,
      active: row.active,
      sortOrder: row.sort_order,
      note: row.note,
      updatedAt: row.updated_at,
      apiShopName: row.api_shop_name,
      apiRegion: row.api_region,
      apiStatus: row.api_status,
      apiSyncedAt: row.api_synced_at,
    }));
  }
}

module.exports = { ShopeeShopProfileRepository };
