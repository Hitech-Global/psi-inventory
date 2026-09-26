-- Shop-level Product Ads daily performance from Shopee Ads.
-- Source: /api/v2/ads/get_all_cpc_ads_daily_performance
-- This table is intentionally separate from campaign/GMS tables so the Product Ads
-- overview is sourced from Shopee's shop-level aggregate instead of re-summing
-- partially available campaign families.

CREATE TABLE IF NOT EXISTS shopee_product_ads_shop_daily (
  shop_id BIGINT NOT NULL,
  event_date DATE NOT NULL,
  impressions BIGINT NOT NULL DEFAULT 0,
  clicks BIGINT NOT NULL DEFAULT 0,
  ctr NUMERIC(20,10),
  direct_orders BIGINT NOT NULL DEFAULT 0,
  broad_orders BIGINT NOT NULL DEFAULT 0,
  direct_units BIGINT NOT NULL DEFAULT 0,
  broad_units BIGINT NOT NULL DEFAULT 0,
  direct_cvr NUMERIC(20,10),
  broad_cvr NUMERIC(20,10),
  direct_gmv NUMERIC(24,8),
  broad_gmv NUMERIC(24,8),
  expense NUMERIC(24,8),
  cpc NUMERIC(24,8),
  cost_per_conversion NUMERIC(24,8),
  cost_per_direct_conversion NUMERIC(24,8),
  direct_roas NUMERIC(20,10),
  broad_roas NUMERIC(20,10),
  direct_acos NUMERIC(20,10),
  broad_acos NUMERIC(20,10),
  raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (shop_id, event_date)
);

CREATE INDEX IF NOT EXISTS idx_shopee_product_ads_shop_daily_date
  ON shopee_product_ads_shop_daily (event_date DESC, shop_id);
