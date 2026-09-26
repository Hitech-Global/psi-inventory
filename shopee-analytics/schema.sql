-- Shopee Analytics V1 schema (PostgreSQL)
-- Isolated foundation only. This file is NOT wired into inventory startup migrations.

CREATE TABLE IF NOT EXISTS shopee_app_tokens (
  app_role TEXT NOT NULL,
  shop_id BIGINT NOT NULL,
  token_blob TEXT NOT NULL,
  token_iv TEXT NOT NULL,
  token_tag TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  last_refresh_at TIMESTAMPTZ,
  refresh_error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (app_role, shop_id)
);

CREATE TABLE IF NOT EXISTS shopee_raw_api_snapshots (
  id BIGSERIAL PRIMARY KEY,
  app_role TEXT NOT NULL,
  endpoint_key TEXT NOT NULL,
  shop_id BIGINT,
  event_date_from DATE,
  event_date_to DATE,
  request_fingerprint TEXT NOT NULL,
  request_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  response_json JSONB NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_shopee_raw_endpoint_shop_synced
  ON shopee_raw_api_snapshots(endpoint_key, shop_id, synced_at DESC);

CREATE TABLE IF NOT EXISTS shopee_shop_profiles (
  shop_id BIGINT PRIMARY KEY,
  display_name TEXT NOT NULL,
  country_code TEXT NOT NULL,
  country_name TEXT,
  brand_code TEXT NOT NULL,
  brand_name TEXT,
  currency TEXT NOT NULL,
  timezone TEXT NOT NULL,
  brand_portal_timezone TEXT,
  marketplace_region TEXT,
  analytics_start_date DATE,
  gms_campaign_seed_ids BIGINT[] NOT NULL DEFAULT '{}'::bigint[],
  active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A profile is also the canonical shop-scope registry.  Import-only shops may
-- legitimately have no API-reported country, currency, or timezone yet; those
-- facts must remain unavailable rather than being guessed during CSV import.
ALTER TABLE shopee_shop_profiles
  ALTER COLUMN country_code DROP NOT NULL,
  ALTER COLUMN brand_code DROP NOT NULL,
  ALTER COLUMN currency DROP NOT NULL,
  ALTER COLUMN timezone DROP NOT NULL;
ALTER TABLE shopee_shop_profiles
  ADD COLUMN IF NOT EXISTS operator_label TEXT,
  ADD COLUMN IF NOT EXISTS import_source_shop_name TEXT,
  ADD COLUMN IF NOT EXISTS data_source_capability TEXT NOT NULL DEFAULT 'MANUAL_IMPORT';
ALTER TABLE shopee_shop_profiles
  ALTER COLUMN data_source_capability SET DEFAULT 'MANUAL_IMPORT';
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'shopee_shop_profiles_data_source_capability_check'
  ) THEN
    ALTER TABLE shopee_shop_profiles
      ADD CONSTRAINT shopee_shop_profiles_data_source_capability_check
      CHECK (data_source_capability IN ('API_AND_MANUAL', 'MANUAL_IMPORT'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_shopee_shop_profiles_country_brand
  ON shopee_shop_profiles(country_code, brand_code, active, sort_order, shop_id);

CREATE TABLE IF NOT EXISTS shopee_shops (
  shop_id BIGINT PRIMARY KEY,
  shop_name TEXT,
  region TEXT,
  currency TEXT,
  timezone TEXT,
  status TEXT,
  raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS shopee_products (
  shop_id BIGINT NOT NULL,
  item_id BIGINT NOT NULL,
  item_name TEXT,
  item_sku TEXT,
  item_status TEXT,
  category_id BIGINT,
  update_time BIGINT,
  raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (shop_id, item_id)
);

CREATE TABLE IF NOT EXISTS shopee_product_models (
  shop_id BIGINT NOT NULL,
  item_id BIGINT NOT NULL,
  model_id BIGINT NOT NULL,
  model_name TEXT,
  model_sku TEXT,
  current_price NUMERIC(20,6),
  original_price NUMERIC(20,6),
  stock INTEGER,
  raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (shop_id, item_id, model_id)
);

CREATE TABLE IF NOT EXISTS shopee_ad_campaigns (
  shop_id BIGINT NOT NULL,
  campaign_id BIGINT NOT NULL,
  ad_type TEXT,
  campaign_type_raw TEXT,
  campaign_type_normalized TEXT,
  region TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (shop_id, campaign_id)
);

CREATE TABLE IF NOT EXISTS shopee_ad_campaign_setting_history (
  shop_id BIGINT NOT NULL,
  campaign_id BIGINT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  status TEXT,
  bidding_method TEXT,
  campaign_budget NUMERIC(20,6),
  target_roas NUMERIC(20,6),
  raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (shop_id, campaign_id, observed_at)
);

CREATE TABLE IF NOT EXISTS shopee_ad_campaign_membership_daily (
  shop_id BIGINT NOT NULL,
  campaign_id BIGINT NOT NULL,
  event_date DATE NOT NULL,
  item_id BIGINT NOT NULL,
  membership_state TEXT NOT NULL DEFAULT 'ACTIVE',
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (shop_id, campaign_id, event_date, item_id)
);

CREATE TABLE IF NOT EXISTS shopee_ad_campaign_daily (
  shop_id BIGINT NOT NULL,
  campaign_id BIGINT NOT NULL,
  event_date DATE NOT NULL,
  impressions BIGINT NOT NULL DEFAULT 0,
  clicks BIGINT NOT NULL DEFAULT 0,
  expense NUMERIC(20,6) NOT NULL DEFAULT 0,
  broad_gmv NUMERIC(20,6) NOT NULL DEFAULT 0,
  broad_orders BIGINT NOT NULL DEFAULT 0,
  broad_units BIGINT NOT NULL DEFAULT 0,
  direct_gmv NUMERIC(20,6),
  direct_roas NUMERIC(20,6),
  direct_orders BIGINT NOT NULL DEFAULT 0,
  direct_units BIGINT NOT NULL DEFAULT 0,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (shop_id, campaign_id, event_date)
);

CREATE TABLE IF NOT EXISTS shopee_ad_campaign_hourly (
  shop_id BIGINT NOT NULL,
  campaign_id BIGINT NOT NULL,
  event_date DATE NOT NULL,
  hour SMALLINT NOT NULL CHECK (hour BETWEEN 0 AND 23),
  impressions BIGINT NOT NULL DEFAULT 0,
  clicks BIGINT NOT NULL DEFAULT 0,
  expense NUMERIC(20,6) NOT NULL DEFAULT 0,
  broad_gmv NUMERIC(20,6) NOT NULL DEFAULT 0,
  broad_orders BIGINT NOT NULL DEFAULT 0,
  direct_gmv NUMERIC(20,6),
  direct_roas NUMERIC(20,6),
  direct_orders BIGINT NOT NULL DEFAULT 0,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (shop_id, campaign_id, event_date, hour)
);

CREATE TABLE IF NOT EXISTS shopee_ad_item_daily (
  shop_id BIGINT NOT NULL,
  campaign_id BIGINT NOT NULL,
  item_id BIGINT NOT NULL,
  event_date DATE NOT NULL,
  impressions BIGINT NOT NULL DEFAULT 0,
  clicks BIGINT NOT NULL DEFAULT 0,
  expense NUMERIC(20,6) NOT NULL DEFAULT 0,
  broad_gmv NUMERIC(20,6) NOT NULL DEFAULT 0,
  broad_orders BIGINT NOT NULL DEFAULT 0,
  broad_units BIGINT NOT NULL DEFAULT 0,
  direct_gmv NUMERIC(20,6),
  direct_roas NUMERIC(20,6),
  direct_orders BIGINT NOT NULL DEFAULT 0,
  direct_units BIGINT NOT NULL DEFAULT 0,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (shop_id, campaign_id, item_id, event_date)
);

CREATE TABLE IF NOT EXISTS shopee_recommended_roi_history (
  shop_id BIGINT NOT NULL,
  item_id BIGINT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  lower_value NUMERIC(20,6),
  lower_percentile INTEGER,
  exact_value NUMERIC(20,6),
  exact_percentile INTEGER,
  upper_value NUMERIC(20,6),
  upper_percentile INTEGER,
  raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (shop_id, item_id, observed_at)
);

CREATE TABLE IF NOT EXISTS shopee_orders (
  shop_id BIGINT NOT NULL,
  order_sn TEXT NOT NULL,
  order_status TEXT,
  create_time BIGINT,
  update_time BIGINT,
  currency TEXT,
  total_amount NUMERIC(20,6),
  raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (shop_id, order_sn)
);

CREATE TABLE IF NOT EXISTS shopee_order_items (
  shop_id BIGINT NOT NULL,
  order_sn TEXT NOT NULL,
  item_id BIGINT NOT NULL,
  model_id BIGINT NOT NULL DEFAULT 0,
  item_sku TEXT,
  model_sku TEXT,
  quantity INTEGER NOT NULL DEFAULT 0,
  original_price NUMERIC(20,6),
  unit_price NUMERIC(20,6),
  promotion_type TEXT,
  promotion_id BIGINT,
  raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (shop_id, order_sn, item_id, model_id)
);

CREATE TABLE IF NOT EXISTS shopee_vouchers (
  shop_id BIGINT NOT NULL,
  voucher_id BIGINT NOT NULL,
  voucher_code TEXT,
  voucher_name TEXT,
  voucher_type INTEGER,
  reward_type INTEGER,
  start_time BIGINT,
  end_time BIGINT,
  percentage NUMERIC(20,6),
  discount_amount NUMERIC(20,6),
  max_price NUMERIC(20,6),
  min_basket_price NUMERIC(20,6),
  usage_quantity INTEGER,
  current_usage INTEGER,
  is_admin BOOLEAN,
  raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (shop_id, voucher_id)
);

CREATE TABLE IF NOT EXISTS shopee_voucher_items (
  shop_id BIGINT NOT NULL,
  voucher_id BIGINT NOT NULL,
  item_id BIGINT NOT NULL,
  PRIMARY KEY (shop_id, voucher_id, item_id)
);

CREATE TABLE IF NOT EXISTS shopee_discounts (
  shop_id BIGINT NOT NULL,
  discount_id BIGINT NOT NULL,
  discount_name TEXT,
  status TEXT,
  start_time BIGINT,
  end_time BIGINT,
  source INTEGER,
  raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (shop_id, discount_id)
);

CREATE TABLE IF NOT EXISTS shopee_discount_items (
  shop_id BIGINT NOT NULL,
  discount_id BIGINT NOT NULL,
  item_id BIGINT NOT NULL,
  model_id BIGINT NOT NULL DEFAULT 0,
  original_price NUMERIC(20,6),
  promotion_price NUMERIC(20,6),
  promotion_stock INTEGER,
  raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (shop_id, discount_id, item_id, model_id)
);

CREATE TABLE IF NOT EXISTS shopee_returns (
  shop_id BIGINT NOT NULL,
  return_sn TEXT NOT NULL,
  order_sn TEXT,
  status TEXT,
  reason TEXT,
  currency TEXT,
  refund_amount NUMERIC(20,6),
  create_time BIGINT,
  update_time BIGINT,
  raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (shop_id, return_sn)
);

CREATE TABLE IF NOT EXISTS shopee_return_items (
  shop_id BIGINT NOT NULL,
  return_sn TEXT NOT NULL,
  item_id BIGINT NOT NULL,
  model_id BIGINT NOT NULL DEFAULT 0,
  quantity INTEGER NOT NULL DEFAULT 0,
  item_price NUMERIC(20,6),
  refund_amount NUMERIC(20,6),
  raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (shop_id, return_sn, item_id, model_id)
);

CREATE TABLE IF NOT EXISTS shopee_shop_bi_daily (
  shop_id BIGINT NOT NULL,
  event_date DATE NOT NULL,
  sales NUMERIC(20,6),
  orders BIGINT,
  units_sold BIGINT,
  product_clicks BIGINT,
  product_views BIGINT,
  unique_visitors BIGINT,
  item_conversion_rate NUMERIC(20,8),
  order_conversion_rate NUMERIC(20,8),
  voucher_sales NUMERIC(20,6),
  voucher_buyers BIGINT,
  voucher_usage_rate NUMERIC(20,8),
  voucher_cir NUMERIC(20,8),
  voucher_cost NUMERIC(20,6),
  raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (shop_id, event_date)
);

CREATE TABLE IF NOT EXISTS shopee_product_card_period (
  shop_id BIGINT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  item_id BIGINT NOT NULL,
  item_name TEXT,
  parent_sku TEXT,
  item_sku TEXT,
  impressions BIGINT,
  clicks BIGINT,
  ctr NUMERIC(20,8),
  visitors BIGINT,
  page_views BIGINT,
  add_to_cart_visitors BIGINT,
  add_to_cart_units BIGINT,
  add_to_cart_rate NUMERIC(20,8),
  orders BIGINT,
  buyers BIGINT,
  units BIGINT,
  sales NUMERIC(20,6),
  conversion_rate NUMERIC(20,8),
  source_file TEXT,
  raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (shop_id, start_date, end_date, item_id)
);

CREATE TABLE IF NOT EXISTS shopee_product_card_daily (
  shop_id BIGINT NOT NULL,
  item_id BIGINT NOT NULL,
  event_date DATE NOT NULL,
  visitors BIGINT,
  page_views BIGINT,
  add_to_cart_visitors BIGINT,
  add_to_cart_units BIGINT,
  add_to_cart_rate NUMERIC(20,8),
  orders BIGINT,
  units BIGINT,
  sales NUMERIC(20,6),
  conversion_rate NUMERIC(20,8),
  source TEXT NOT NULL DEFAULT 'BI_IMPORT',
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (shop_id, item_id, event_date)
);

CREATE TABLE IF NOT EXISTS shopee_shop_strategy_config (
  shop_id BIGINT PRIMARY KEY,
  ad_spend_ratio_limit NUMERIC(12,8) NOT NULL DEFAULT 0.15,
  weekly_order_reference INTEGER NOT NULL DEFAULT 25,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS shopee_item_strategy_config (
  shop_id BIGINT NOT NULL,
  item_id BIGINT NOT NULL,
  break_even_roas NUMERIC(20,8),
  note TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (shop_id, item_id)
);

CREATE TABLE IF NOT EXISTS shopee_operation_history (
  id BIGSERIAL PRIMARY KEY,
  shop_id BIGINT NOT NULL,
  campaign_id BIGINT,
  item_id BIGINT,
  operation_type TEXT NOT NULL,
  reason TEXT,
  before_json JSONB,
  after_json JSONB,
  effective_from TIMESTAMPTZ NOT NULL,
  effective_to TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS shopee_event_calendar (
  event_date DATE PRIMARY KEY,
  event_type TEXT NOT NULL,
  intensity TEXT NOT NULL,
  note TEXT
);

CREATE TABLE IF NOT EXISTS shopee_analysis_cycles (
  id BIGSERIAL PRIMARY KEY,
  shop_id BIGINT NOT NULL,
  campaign_id BIGINT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  cycle_no INTEGER NOT NULL,
  stage TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN',
  UNIQUE(shop_id, campaign_id, start_date, end_date)
);

CREATE TABLE IF NOT EXISTS shopee_diagnosis_results (
  id BIGSERIAL PRIMARY KEY,
  cycle_id BIGINT REFERENCES shopee_analysis_cycles(id) ON DELETE CASCADE,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  diagnosis_json JSONB NOT NULL
);


CREATE TABLE IF NOT EXISTS shopee_skill_reports (
  id BIGSERIAL PRIMARY KEY,
  shop_id BIGINT NOT NULL,
  campaign_id BIGINT NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  data_cutoff TIMESTAMPTZ NOT NULL,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('DAILY_AUTO','MANUAL','EVENT_REVIEW')),
  trigger_reason TEXT,
  skill_name TEXT NOT NULL,
  skill_version TEXT NOT NULL,
  package_schema_version TEXT NOT NULL,
  input_snapshot_json JSONB NOT NULL,
  report_json JSONB,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','COMPLETED','FAILED')),
  error_text TEXT,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shopee_skill_reports_campaign_time
  ON shopee_skill_reports(shop_id, campaign_id, generated_at DESC);

CREATE TABLE IF NOT EXISTS shopee_sync_state (
  app_role TEXT NOT NULL,
  endpoint_key TEXT NOT NULL,
  shop_id BIGINT NOT NULL,
  cursor_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_success_at TIMESTAMPTZ,
  last_error TEXT,
  PRIMARY KEY (app_role, endpoint_key, shop_id)
);

CREATE TABLE IF NOT EXISTS shopee_oauth_states (
  state_hash TEXT PRIMARY KEY,
  app_role TEXT NOT NULL CHECK (app_role IN ('ADS')),
  expected_shop_id BIGINT NOT NULL,
  redirect_uri TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_shopee_oauth_states_expiry
  ON shopee_oauth_states(expires_at) WHERE consumed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_shopee_ad_item_daily_campaign_date
  ON shopee_ad_item_daily(shop_id, campaign_id, event_date DESC);
CREATE INDEX IF NOT EXISTS idx_shopee_orders_update_time
  ON shopee_orders(shop_id, update_time DESC);
CREATE INDEX IF NOT EXISTS idx_shopee_returns_update_time
  ON shopee_returns(shop_id, update_time DESC);

CREATE INDEX IF NOT EXISTS idx_shopee_operation_item_time
  ON shopee_operation_history(shop_id, item_id, effective_from DESC);
CREATE INDEX IF NOT EXISTS idx_shopee_operation_campaign_time
  ON shopee_operation_history(shop_id, campaign_id, effective_from DESC);

-- Direct GMV is nullable by contract: an absent source field is unknown, not 0.
-- These ALTERs make the change safe for already-initialized desktop databases.
ALTER TABLE shopee_ad_campaign_daily
  ALTER COLUMN direct_gmv DROP NOT NULL,
  ALTER COLUMN direct_gmv DROP DEFAULT;
ALTER TABLE shopee_ad_campaign_hourly
  ALTER COLUMN direct_gmv DROP NOT NULL,
  ALTER COLUMN direct_gmv DROP DEFAULT;
ALTER TABLE shopee_ad_item_daily
  ALTER COLUMN direct_gmv DROP NOT NULL,
  ALTER COLUMN direct_gmv DROP DEFAULT;

ALTER TABLE shopee_ad_campaign_daily
  ADD COLUMN IF NOT EXISTS direct_roas NUMERIC(20,6);
ALTER TABLE shopee_ad_campaign_hourly
  ADD COLUMN IF NOT EXISTS direct_roas NUMERIC(20,6);
ALTER TABLE shopee_ad_item_daily
  ADD COLUMN IF NOT EXISTS direct_roas NUMERIC(20,6);

-- Unified promotion contract. API and manual ad-group data share the same
-- business fields; nullable metrics mean unavailable, never zero-by-default.
CREATE TABLE IF NOT EXISTS shopee_ad_promotion_daily (
  shop_id BIGINT NOT NULL,
  promotion_key TEXT NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  granularity TEXT NOT NULL CHECK (granularity IN ('DAY','RANGE')),
  event_date DATE NOT NULL,
  promotion_type TEXT NOT NULL CHECK (promotion_type IN ('SHOP_GMV_MAX','AD_GROUP','INDIVIDUAL_AD')),
  data_source TEXT NOT NULL CHECK (data_source IN ('SHOPEE_API','MANUAL','MANUAL_IMPORT')),
  campaign_id BIGINT,
  campaign_name TEXT,
  source_ad_type TEXT,
  campaign_status TEXT,
  campaign_budget NUMERIC(20,6),
  target_roas NUMERIC(20,6),
  estimated_roas NUMERIC(20,6),
  impressions BIGINT,
  clicks BIGINT,
  expense NUMERIC(20,6),
  orders BIGINT,
  gmv NUMERIC(20,6),
  source_roas NUMERIC(20,6),
  direct_gmv NUMERIC(20,6),
  direct_roas NUMERIC(20,6),
  ctr NUMERIC(20,8),
  cvr NUMERIC(20,8),
  add_to_cart BIGINT,
  item_count INTEGER,
  data_quality_status TEXT NOT NULL CHECK (data_quality_status IN ('COMPLETE','PARTIAL','DATA_MISMATCH')),
  quality_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
  remark TEXT,
  raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (shop_id,promotion_key,period_start,period_end)
);
CREATE TABLE IF NOT EXISTS shopee_ad_promotion_item_daily (
  shop_id BIGINT NOT NULL,
  promotion_key TEXT NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  event_date DATE NOT NULL,
  item_id BIGINT NOT NULL,
  item_sku TEXT,
  product_name TEXT,
  impressions BIGINT,
  clicks BIGINT,
  expense NUMERIC(20,6),
  orders BIGINT,
  gmv NUMERIC(20,6),
  source_roas NUMERIC(20,6),
  direct_gmv NUMERIC(20,6),
  direct_roas NUMERIC(20,6),
  ctr NUMERIC(20,8),
  cvr NUMERIC(20,8),
  add_to_cart BIGINT,
  weekly_sales NUMERIC(20,6),
  data_quality_status TEXT NOT NULL CHECK (data_quality_status IN ('COMPLETE','PARTIAL','DATA_MISMATCH')),
  quality_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
  remark TEXT,
  raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (shop_id,promotion_key,period_start,period_end,item_id)
);
CREATE INDEX IF NOT EXISTS idx_shopee_ad_promotion_daily_shop_period ON shopee_ad_promotion_daily(shop_id,period_start DESC,period_end DESC,promotion_type);
-- Additive and idempotent for databases created before Direct GMV was modeled
-- as a nullable source metric in the unified promotion contract.
ALTER TABLE shopee_ad_promotion_daily ADD COLUMN IF NOT EXISTS direct_gmv NUMERIC(20,6);
ALTER TABLE shopee_ad_promotion_daily ADD COLUMN IF NOT EXISTS direct_roas NUMERIC(20,6);
ALTER TABLE shopee_ad_promotion_item_daily ADD COLUMN IF NOT EXISTS direct_gmv NUMERIC(20,6);
ALTER TABLE shopee_ad_promotion_item_daily ADD COLUMN IF NOT EXISTS direct_roas NUMERIC(20,6);
