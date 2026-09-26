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
        brand_portal_timezone,marketplace_region,analytics_start_date,gms_campaign_seed_ids,
        active,sort_order,note,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,now())
       ON CONFLICT (shop_id) DO UPDATE SET
        display_name=EXCLUDED.display_name,
        country_code=EXCLUDED.country_code,
        country_name=EXCLUDED.country_name,
        brand_code=EXCLUDED.brand_code,
        brand_name=EXCLUDED.brand_name,
        currency=EXCLUDED.currency,
        timezone=EXCLUDED.timezone,
        brand_portal_timezone=EXCLUDED.brand_portal_timezone,
        marketplace_region=EXCLUDED.marketplace_region,
        analytics_start_date=EXCLUDED.analytics_start_date,
        gms_campaign_seed_ids=EXCLUDED.gms_campaign_seed_ids,
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
        profile.brandPortalTimezone ?? profile.brand_portal_timezone ?? null,
        profile.marketplaceRegion ?? profile.marketplace_region ?? null,
        profile.analyticsStartDate ?? profile.analytics_start_date ?? null,
        (profile.gmsCampaignSeedIds ?? profile.gms_campaign_seed_ids ?? [])
          .map(Number).filter(Number.isSafeInteger),
        profile.active === undefined ? true : Boolean(profile.active),
        Number.isFinite(Number(profile.sortOrder ?? profile.sort_order))
          ? Number(profile.sortOrder ?? profile.sort_order)
          : 0,
        profile.note ?? null,
      ],
    );
  }

  async registerApiAuthorized({ shopId, operatorLabel = null }) {
    const id = Number(shopId);
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error('shopId must be a positive integer');
    const label = operatorLabel == null ? null : String(operatorLabel).trim() || null;
    const token = await this.pool.query(
      `SELECT 1 FROM shopee_app_tokens WHERE app_role='ADS' AND shop_id=$1 LIMIT 1`,
      [id],
    );
    if (!token.rows.length) {
      const error = new Error(`No matching ADS OAuth token exists for shop ${id}`);
      error.code = 'ADS_TOKEN_REQUIRED'; error.status = 422; throw error;
    }
    await this.pool.query(
      `INSERT INTO shopee_shop_profiles
       (shop_id,display_name,operator_label,import_source_shop_name,data_source_capability,active,updated_at)
       VALUES ($1,$2,$3,NULL,'API_AND_MANUAL',true,now())
       ON CONFLICT (shop_id) DO UPDATE SET
         display_name=EXCLUDED.display_name,operator_label=EXCLUDED.operator_label,
         import_source_shop_name=NULL,data_source_capability='API_AND_MANUAL',active=true,updated_at=now()`,
      [id, `Shop ${id}`, label],
    );
    return (await this.list({ activeOnly: false })).find(row => row.shopId === id) || null;
  }

  async upsertMany(profiles) {
    for (const profile of profiles || []) await this.upsert(profile);
    return { configured: (profiles || []).length };
  }

  async list({ activeOnly = true } = {}) {
    const result = await this.pool.query(
      `SELECT
         p.shop_id,p.display_name,p.country_code,p.country_name,p.brand_code,p.brand_name,
         p.currency,p.timezone,p.brand_portal_timezone,p.marketplace_region,
         to_char(p.analytics_start_date,'YYYY-MM-DD') AS analytics_start_date,
         p.gms_campaign_seed_ids,p.active,p.sort_order,p.note,p.updated_at,p.operator_label,p.import_source_shop_name,p.data_source_capability,
         s.shop_name AS api_shop_name,s.region AS api_region,s.status AS api_status,s.synced_at AS api_synced_at
       FROM shopee_shop_profiles p
       LEFT JOIN shopee_shops s ON s.shop_id=p.shop_id
       WHERE ($1::boolean=false OR p.active=true)
       ORDER BY p.country_code,p.brand_code,p.sort_order,p.display_name,p.shop_id`,
      [activeOnly],
    );
    return result.rows.map(row => ({
      shopId: Number(row.shop_id),
      displayName: row.operator_label || row.display_name,
      operatorLabel: row.operator_label,
      importSourceShopName: row.import_source_shop_name,
      dataSourceCapability: row.data_source_capability,
      countryCode: row.country_code,
      countryName: row.country_name,
      brandCode: row.brand_code,
      brandName: row.brand_name,
      currency: row.currency,
      timezone: row.timezone,
      brandPortalTimezone: row.brand_portal_timezone,
      marketplaceRegion: row.marketplace_region,
      analyticsStartDate: row.analytics_start_date ? String(row.analytics_start_date).slice(0, 10) : null,
      gmsCampaignSeedIds: (row.gms_campaign_seed_ids || []).map(Number),
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
