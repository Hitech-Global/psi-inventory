-- Shopee Analytics V1 schema (PostgreSQL)
-- Isolated foundation only. This file is NOT wired into inventory startup migrations.

-- ============================================================================================
-- 店铺直播表现（Brand Portal 直播数据）
-- ============================================================================================
-- Brand Portal 的直播表现按店铺按天给出：直播场次、直播时长、观看次数、观看人数、
-- 直播确认的订单与成交额。与销售表现分表存放，因为两者的口径不同：销售表现是
-- 整个店铺的成交，直播表现只是直播带来的那一部分。
--
-- 时长统一存成小时。接口可能以小时或分钟给出，读进来时换算，页面读出来不用再判断。
CREATE TABLE IF NOT EXISTS shopee_shop_livestream_daily (
  shop_id BIGINT NOT NULL,
  event_date DATE NOT NULL,
  live_sessions BIGINT,
  live_hours NUMERIC(20,6),
  live_views BIGINT,
  live_viewers BIGINT,
  confirmed_orders BIGINT,
  confirmed_sales NUMERIC(20,6),
  raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (shop_id, event_date)
);

-- ============================================================================================
-- TikTok Shop (区域：东南亚 ROW；自有店铺；纯 GMV Max 广告)
-- ============================================================================================
-- 与 Shopee 侧的差异决定了表结构：
--   * 标识是 (shop_id, shop_cipher) 二元组。一个 access token 可覆盖卖家名下多个店铺，
--     每店有自己的 cipher。只存 shop_id 会导致 cipher 串店 —— 请求打到 A 店却带着 B 店的
--     cipher，读到别的品牌的数据。因此 cipher 与 shop_id 存在同一行，成对写入成对读取。
--   * Marketing API 的凭据域完全独立（不同的 app 体系、24 小时 token、独立刷新调度）。

-- Shop Open API 凭据：cipher 与 shop_id 成对存储
CREATE TABLE IF NOT EXISTS tiktok_shop_tokens (
  app_key TEXT NOT NULL,
  region_group TEXT NOT NULL,
  shop_id TEXT NOT NULL,
  shop_cipher TEXT NOT NULL,
  token_blob TEXT NOT NULL,
  token_iv TEXT NOT NULL,
  token_tag TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  last_refresh_at TIMESTAMPTZ,
  refresh_error TEXT,
  seller_type TEXT,
  region TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (app_key, region_group, shop_id)
);

-- Marketing API 凭据：与 Shop API 完全分开的存储分区
-- token 仅 24 小时有效，刷新调度按 expires_at 扫描
CREATE TABLE IF NOT EXISTS tiktok_marketing_tokens (
  app_id TEXT NOT NULL,
  advertiser_id TEXT NOT NULL,
  token_blob TEXT NOT NULL,
  token_iv TEXT NOT NULL,
  token_tag TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  last_refresh_at TIMESTAMPTZ,
  refresh_error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (app_id, advertiser_id)
);

-- 原始 API 快照：对齐 shopee_raw_api_snapshots 的结构，复用查询与回放工具
-- 与 Shopee 版的差异：店铺标识是 (shop_id, shop_cipher) 二元组，
-- 因此 shop_cipher 也进表，且区域组与广告账户 ID 分列存放。
CREATE TABLE IF NOT EXISTS tiktok_raw_api_snapshots (
  id BIGSERIAL PRIMARY KEY,
  region_group TEXT NOT NULL,
  endpoint_key TEXT NOT NULL,
  shop_id TEXT,
  shop_cipher TEXT,
  advertiser_id TEXT,
  event_date_from DATE,
  event_date_to DATE,
  request_fingerprint TEXT NOT NULL,
  request_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  response_json JSONB NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tiktok_raw_endpoint_shop_synced
  ON tiktok_raw_api_snapshots(endpoint_key, shop_id, synced_at DESC);
CREATE INDEX IF NOT EXISTS idx_tiktok_raw_region_advertiser_synced
  ON tiktok_raw_api_snapshots(region_group, advertiser_id, synced_at DESC);

-- 授权 state：保存哈希而非明文，一次性消费（DELETE ... RETURNING 即为消费动作）
CREATE TABLE IF NOT EXISTS tiktok_oauth_states (
  state_hash TEXT PRIMARY KEY,
  region_group TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tiktok_oauth_states_expiry
  ON tiktok_oauth_states(expires_at);

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

-- 店铺的经营数据，按天。
--
-- 卖家中心的报表把同一批数字给了三种口径：已下单、已确认、已付款。三种
-- 口径的访客与点击完全相同（那是店铺级的数），但订单数与销售额不同。
-- 所以口径是一列，而不是三张表。
--
-- 访客与点击在三行里重复，是有意的：查询任何口径都能拿到完整的一行，
-- 不用再回头拼另一张表。
CREATE TABLE IF NOT EXISTS shopee_shop_bi_daily (
  shop_id BIGINT NOT NULL,
  event_date DATE NOT NULL,
  order_status TEXT NOT NULL DEFAULT 'PAID',
  sales NUMERIC(20,6),
  orders BIGINT,
  units_sold BIGINT,
  product_clicks BIGINT,
  product_views BIGINT,
  unique_visitors BIGINT,
  item_conversion_rate NUMERIC(20,8),
  order_conversion_rate NUMERIC(20,8),
  sales_per_order NUMERIC(20,6),
  cancelled_orders BIGINT,
  cancelled_sales NUMERIC(20,6),
  returned_orders BIGINT,
  returned_sales NUMERIC(20,6),
  buyers BIGINT,
  new_buyers BIGINT,
  existing_buyers BIGINT,
  potential_buyers BIGINT,
  repeat_purchase_rate NUMERIC(20,8),
  voucher_sales NUMERIC(20,6),
  voucher_buyers BIGINT,
  voucher_usage_rate NUMERIC(20,8),
  voucher_cir NUMERIC(20,8),
  voucher_cost NUMERIC(20,6),
  raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (shop_id, event_date, order_status)
);

-- 订单口径那一列是后加的，早先的行没有它。
ALTER TABLE shopee_shop_bi_daily
  ADD COLUMN IF NOT EXISTS order_status TEXT NOT NULL DEFAULT 'PAID';

-- 商品级的访客与加购：访客数、浏览量、跳出率、搜索点击、收藏、加购访客与件数。
--
-- 卖家中心的商品明细里有这些数，而开放平台的接口不给 —— 这是唯一能拿到
-- 加购与收藏的地方。
CREATE TABLE IF NOT EXISTS shopee_product_traffic_daily (
  shop_id BIGINT NOT NULL,
  event_date DATE NOT NULL,
  item_id BIGINT NOT NULL,
  order_status TEXT NOT NULL DEFAULT 'PAID',
  parent_sku TEXT,
  -- A key may not be an expression, so the sku is a column of its own
  -- and the empty one is the empty string rather than nothing.
  sku TEXT NOT NULL DEFAULT '',
  variation_id TEXT,
  row_kind TEXT NOT NULL DEFAULT 'PRODUCT',
  item_name TEXT,
  item_status TEXT,
  sales NUMERIC(20,6),
  orders BIGINT,
  units_sold BIGINT,
  buyers BIGINT,
  product_impression BIGINT,
  product_clicks BIGINT,
  ctr NUMERIC(20,8),
  unique_product_impressions BIGINT,
  unique_product_clicks BIGINT,
  product_visitors BIGINT,
  product_page_views BIGINT,
  bounce_visitors BIGINT,
  bounce_rate NUMERIC(20,8),
  search_clicks BIGINT,
  likes BIGINT,
  add_to_cart_visitors BIGINT,
  add_to_cart_units BIGINT,
  add_to_cart_rate NUMERIC(20,8),
  order_conversion_rate NUMERIC(20,8),
  raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (shop_id, event_date, item_id, order_status, row_kind, sku)
);

CREATE INDEX IF NOT EXISTS idx_shopee_product_traffic_parent_sku
  ON shopee_product_traffic_daily (shop_id, parent_sku);

-- 卖家中心导出的广告数据：整个区间的汇总，不是按天的。
--
-- 与按天同步的广告表分开存：粒度不同，放在一起会让"某天的花费"这种
-- 问题有两个答案。
CREATE TABLE IF NOT EXISTS shopee_seller_centre_ads_period (
  shop_id BIGINT NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  ad_sequence BIGINT NOT NULL,
  ad_name TEXT,
  status TEXT,
  ads_type TEXT,
  product_id TEXT,
  bidding_method TEXT,
  placement TEXT,
  ad_start_date TIMESTAMPTZ,
  ad_end_date TIMESTAMPTZ,
  impression BIGINT,
  clicks BIGINT,
  ctr NUMERIC(20,8),
  add_to_cart BIGINT,
  add_to_cart_rate NUMERIC(20,8),
  conversions BIGINT,
  conversion_rate NUMERIC(20,8),
  cost_per_conversion NUMERIC(20,6),
  items_sold BIGINT,
  gmv NUMERIC(20,6),
  expense NUMERIC(20,6),
  roas NUMERIC(20,8),
  acos NUMERIC(20,8),
  product_impressions BIGINT,
  product_clicks BIGINT,
  voucher_amount NUMERIC(20,6),
  vouchered_sales NUMERIC(20,6),
  raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (shop_id, period_start, period_end, ad_sequence)
);

-- 店铺健康与履约：店铺评分、发货时效、取消率、退货退款率等。
--
-- 这些指标来自 account_health 端点，是"本期/上期"两个值而不是逐日序列，
-- 所以每天落一行快照 —— 记的是那天看到的数，天数多了自然成趋势。
-- 违规类指标（严重/其它违规/禁售/假货/垃圾信息）按事件数存。
CREATE TABLE IF NOT EXISTS shopee_shop_health_daily (
  shop_id BIGINT NOT NULL,
  event_date DATE NOT NULL,
  shop_rating NUMERIC(6,2),
  csat_rate NUMERIC(20,8),
  response_rate NUMERIC(20,8),
  late_shipment_rate NUMERIC(20,8),
  non_fulfillment_rate NUMERIC(20,8),
  preparation_time NUMERIC(20,8),
  cancellation_rate NUMERIC(20,8),
  return_refund_rate NUMERIC(20,8),
  pre_order_listing_rate NUMERIC(20,8),
  pre_order_listing_amount NUMERIC(20,8),
  severe_listing_violations NUMERIC(20,8),
  other_listing_violations NUMERIC(20,8),
  prohibited_listings NUMERIC(20,8),
  counterfeit_ip_infringement NUMERIC(20,8),
  spam_listings NUMERIC(20,8),
  fulfillment_failed BIGINT,
  listing_failed BIGINT,
  custom_service_failed BIGINT,
  raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (shop_id, event_date)
);

-- 平台给每个指标定的达标线（如迟发率 < 10%）。存下来，页面按它判
-- 达标与否，而不是自己编一个标准。
--
-- 必须单独 ALTER：表已经存在时，上面的 CREATE TABLE IF NOT EXISTS 会
-- 整个跳过，写在它里面的列也就永远不会出现 —— 而且不会报错。
ALTER TABLE shopee_shop_health_daily
  ADD COLUMN IF NOT EXISTS targets_json JSONB NOT NULL DEFAULT '{}'::jsonb;

-- 店铺健康的事件明细：罚分、有问题的商品、迟发订单，以及每个指标背后
-- 具体是哪些订单、什么原因码。
--
-- 指标本身只说"取消率 0.16%"，明细说的是"哪一单被取消了、为什么" ——
-- 诊断要的是后者。
CREATE TABLE IF NOT EXISTS shopee_shop_health_events (
  shop_id BIGINT NOT NULL,
  event_date DATE NOT NULL,
  event_kind TEXT NOT NULL,
  event_id TEXT,
  metric_key TEXT,
  reason_code TEXT,
  order_sn TEXT,
  item_id BIGINT,
  title TEXT,
  detail TEXT,
  severity TEXT,
  raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (shop_id, event_date, event_kind, event_id)
);

CREATE INDEX IF NOT EXISTS idx_shopee_shop_health_events_kind
  ON shopee_shop_health_events (shop_id, event_kind, event_date DESC);

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
  actor_type TEXT,
  operator_raw TEXT,
  platform_raw TEXT,
  event_type_raw TEXT,
  source_format TEXT,
  source_fingerprint TEXT,
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
  campaign_id BIGINT,
  promotion_key TEXT,
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

-- Skill reports support both numeric Shopee Campaign IDs and manual-import Ad Group promotion keys.
-- Existing desktop databases originally required campaign_id; relax that constraint without rewriting rows.
ALTER TABLE shopee_skill_reports
  ALTER COLUMN campaign_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS promotion_key TEXT;

CREATE INDEX IF NOT EXISTS idx_shopee_skill_reports_promotion_time
  ON shopee_skill_reports(shop_id, promotion_key, generated_at DESC)
  WHERE promotion_key IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='shopee_skill_reports_scope_key_check'
      AND conrelid='shopee_skill_reports'::regclass
  ) THEN
    ALTER TABLE shopee_skill_reports
      ADD CONSTRAINT shopee_skill_reports_scope_key_check
      CHECK (
        (campaign_id IS NOT NULL AND promotion_key IS NULL)
        OR (campaign_id IS NULL AND promotion_key IS NOT NULL)
      );
  END IF;
END $$;

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

-- 新增店铺：授权时顺带登记一家系统还不认识的店铺。
--
-- 一次授权只带得下一个 code，而店铺编号要到换成令牌时才知道，所以
-- 读者在授权前填的国家、品牌与显示名得先存下来，等回调时才知道
-- 该登记到谁名下。
--
-- register_mode 为空表示这是"给已有店铺连接口"，不涉及登记。
-- expected_shop_id 在登记模式下为 0：编号要等授权后才知道。
ALTER TABLE shopee_oauth_states
  ADD COLUMN IF NOT EXISTS register_mode TEXT;
ALTER TABLE shopee_oauth_states
  ADD COLUMN IF NOT EXISTS register_country_code TEXT;
ALTER TABLE shopee_oauth_states
  ADD COLUMN IF NOT EXISTS register_brand_code TEXT;
ALTER TABLE shopee_oauth_states
  ADD COLUMN IF NOT EXISTS register_display_name TEXT;

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

ALTER TABLE shopee_operation_history
  ADD COLUMN IF NOT EXISTS actor_type TEXT,
  ADD COLUMN IF NOT EXISTS operator_raw TEXT,
  ADD COLUMN IF NOT EXISTS platform_raw TEXT,
  ADD COLUMN IF NOT EXISTS event_type_raw TEXT,
  ADD COLUMN IF NOT EXISTS source_format TEXT,
  ADD COLUMN IF NOT EXISTS source_fingerprint TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_shopee_operation_source_fingerprint
  ON shopee_operation_history(source_fingerprint)
  WHERE source_fingerprint IS NOT NULL;

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

-- Feishu login + store-scoped operator authorization.
CREATE TABLE IF NOT EXISTS shopee_users (
  id BIGSERIAL PRIMARY KEY,
  feishu_open_id TEXT UNIQUE,
  feishu_union_id TEXT UNIQUE,
  feishu_user_id TEXT UNIQUE,
  email TEXT,
  name TEXT NOT NULL,
  avatar_url TEXT,
  role TEXT NOT NULL CHECK (role IN ('SUPER_ADMIN','OPERATOR')),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DISABLED')),
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_shopee_users_email_ci
  ON shopee_users(lower(email)) WHERE email IS NOT NULL AND email <> '';

CREATE TABLE IF NOT EXISTS shopee_user_shops (
  user_id BIGINT NOT NULL REFERENCES shopee_users(id) ON DELETE CASCADE,
  shop_id BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, shop_id)
);
CREATE INDEX IF NOT EXISTS idx_shopee_user_shops_shop
  ON shopee_user_shops(shop_id, user_id);

CREATE TABLE IF NOT EXISTS shopee_auth_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES shopee_users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  absolute_expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_shopee_auth_sessions_user
  ON shopee_auth_sessions(user_id, expires_at DESC);

CREATE TABLE IF NOT EXISTS shopee_auth_login_states (
  state_hash TEXT PRIMARY KEY,
  return_path TEXT NOT NULL DEFAULT '/',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_shopee_auth_login_states_expiry
  ON shopee_auth_login_states(expires_at) WHERE consumed_at IS NULL;
