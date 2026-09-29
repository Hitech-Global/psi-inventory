-- Brand Portal is authorized by principal, not shop.
ALTER TABLE shopee_shop_profiles
  ADD COLUMN IF NOT EXISTS brand_portal_principal_id BIGINT;

CREATE INDEX IF NOT EXISTS idx_shopee_shop_profiles_brand_portal_principal
  ON shopee_shop_profiles(brand_portal_principal_id)
  WHERE brand_portal_principal_id IS NOT NULL;
