-- Preserve source-level Product Ads daily metrics that Shopee exposes with
-- Seller Centre display precision. These columns are additive/point-in-time
-- companions to the existing canonical counters; raw_json remains the audit source.

ALTER TABLE shopee_ad_campaign_daily
  ADD COLUMN IF NOT EXISTS ctr NUMERIC(20,10),
  ADD COLUMN IF NOT EXISTS broad_cvr NUMERIC(20,10),
  ADD COLUMN IF NOT EXISTS direct_cvr NUMERIC(20,10),
  ADD COLUMN IF NOT EXISTS broad_roas NUMERIC(20,10),
  ADD COLUMN IF NOT EXISTS add_to_cart BIGINT,
  ADD COLUMN IF NOT EXISTS add_to_cart_rate NUMERIC(20,10),
  ADD COLUMN IF NOT EXISTS cost_per_conversion NUMERIC(20,10),
  ADD COLUMN IF NOT EXISTS cost_per_direct_conversion NUMERIC(20,10),
  ADD COLUMN IF NOT EXISTS broad_acos NUMERIC(20,10),
  ADD COLUMN IF NOT EXISTS direct_acos NUMERIC(20,10);
