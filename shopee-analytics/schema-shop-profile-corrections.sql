-- Canonical corrections for known Shopee shop profile metadata.
-- Keep these fixes idempotent and narrowly scoped to confirmed shop identities.

UPDATE shopee_shop_profiles
SET country_code = 'MY',
    country_name = 'Malaysia',
    brand_code = 'REDRAGON',
    brand_name = 'Redragon',
    updated_at = now()
WHERE shop_id = 1770037299
  AND (
    country_code IS DISTINCT FROM 'MY'
    OR country_name IS DISTINCT FROM 'Malaysia'
    OR brand_code IS DISTINCT FROM 'REDRAGON'
    OR brand_name IS DISTINCT FROM 'Redragon'
  );
