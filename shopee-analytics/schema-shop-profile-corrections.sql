-- Canonical corrections for known Shopee shop profile metadata.
-- Keep these fixes idempotent and narrowly scoped to confirmed shop identities.

UPDATE shopee_shop_profiles
SET country_code = 'MY',
    country_name = 'Malaysia',
    brand_code = 'REDRAGON',
    brand_name = 'Redragon',
    currency = 'MYR',
    timezone = 'Asia/Kuala_Lumpur',
    marketplace_region = 'MY',
    data_source_capability = 'API_AND_MANUAL',
    updated_at = now()
WHERE shop_id = 1770037299
  AND (
    country_code IS DISTINCT FROM 'MY'
    OR country_name IS DISTINCT FROM 'Malaysia'
    OR brand_code IS DISTINCT FROM 'REDRAGON'
    OR brand_name IS DISTINCT FROM 'Redragon'
    OR currency IS DISTINCT FROM 'MYR'
    OR timezone IS DISTINCT FROM 'Asia/Kuala_Lumpur'
    OR marketplace_region IS DISTINCT FROM 'MY'
    OR data_source_capability IS DISTINCT FROM 'API_AND_MANUAL'
  );
