'use strict';

const IMPORT_ONLY = 'MANUAL_IMPORT';
const API_AND_MANUAL = 'API_AND_MANUAL';

function positiveShopId(value, name = 'shopId') {
  const shopId = Number(value);
  if (!Number.isSafeInteger(shopId) || shopId <= 0) throw new Error(`${name} must be a positive integer`);
  return shopId;
}

function displayFallback(shopId) {
  return `Shop ${shopId}`;
}

class ShopeeShopScopeRepository {
  constructor({ pool }) {
    if (!pool || typeof pool.query !== 'function') throw new Error('pg pool/query adapter is required');
    this.pool = pool;
  }

  async list() {
    const result = await this.pool.query(
      `WITH oauth_shops AS (
         SELECT DISTINCT shop_id FROM shopee_app_tokens WHERE app_role='ADS'
       )
       SELECT p.shop_id,p.display_name,p.operator_label,p.import_source_shop_name,
              p.country_code,p.country_name,p.brand_code,p.brand_name,p.currency,p.timezone,
              p.active,CASE WHEN o.shop_id IS NOT NULL THEN 'API_AND_MANUAL' ELSE p.data_source_capability END AS data_source_capability,
              (o.shop_id IS NOT NULL) AS oauth_authorized,
              s.shop_name AS api_shop_name,s.region AS api_region
       FROM shopee_shop_profiles p
       LEFT JOIN oauth_shops o ON o.shop_id=p.shop_id
       LEFT JOIN shopee_shops s ON s.shop_id=p.shop_id
       UNION ALL
       SELECT o.shop_id,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,
              false,'API_AND_MANUAL',true,NULL,NULL
       FROM oauth_shops o
       WHERE NOT EXISTS (SELECT 1 FROM shopee_shop_profiles p WHERE p.shop_id=o.shop_id)
       ORDER BY shop_id`,
    );
    return result.rows.map(row => ({
      shopId: Number(row.shop_id),
      displayName: row.display_name || row.operator_label || displayFallback(row.shop_id),
      operatorLabel: row.operator_label,
      importSourceShopName: row.import_source_shop_name,
      countryCode: row.country_code,
      countryName: row.country_name,
      brandCode: row.brand_code,
      brandName: row.brand_name,
      currency: row.currency,
      timezone: row.timezone,
      active: row.active,
      dataSourceCapability: row.data_source_capability,
      oauthAuthorized: Boolean(row.oauth_authorized),
      apiShopName: row.api_shop_name,
      apiRegion: row.api_region,
    }));
  }

  async find(shopId) {
    const id = positiveShopId(shopId);
    return (await this.list()).find(scope => scope.shopId === id) || null;
  }

  async registerImportOnly({ shopId, operatorLabel = null, importSourceShopName = null }) {
    const id = positiveShopId(shopId);
    const sourceName = importSourceShopName == null ? null : String(importSourceShopName).trim() || null;
    const label = operatorLabel == null ? null : String(operatorLabel).trim() || null;
    const existing = await this.find(id);
    if (existing && existing.oauthAuthorized) {
      const error = new Error(`Shop ${id} is already OAuth-authorized and cannot be registered as import-only`);
      error.code = 'SHOP_ALREADY_API_AUTHORIZED'; error.status = 409; throw error;
    }
    await this.pool.query(
      `INSERT INTO shopee_shop_profiles
       (shop_id,display_name,operator_label,import_source_shop_name,data_source_capability,active,updated_at)
       VALUES ($1,$2,$3,$4,$5,false,now())
       ON CONFLICT (shop_id) DO UPDATE SET
         display_name=EXCLUDED.display_name,operator_label=EXCLUDED.operator_label,
         import_source_shop_name=EXCLUDED.import_source_shop_name,
         data_source_capability=EXCLUDED.data_source_capability,active=false,updated_at=now()`,
      [id, label || displayFallback(id), label, sourceName, IMPORT_ONLY],
    );
    return this.find(id);
  }
}

module.exports = { IMPORT_ONLY, API_AND_MANUAL, positiveShopId, ShopeeShopScopeRepository };
