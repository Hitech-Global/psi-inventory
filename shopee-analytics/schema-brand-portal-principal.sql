-- Brand Portal is authorized by principal, not shop.
ALTER TABLE shopee_shop_profiles
  ADD COLUMN IF NOT EXISTS brand_portal_principal_id BIGINT;

CREATE INDEX IF NOT EXISTS idx_shopee_shop_profiles_brand_portal_principal
  ON shopee_shop_profiles(brand_portal_principal_id)
  WHERE brand_portal_principal_id IS NOT NULL;

-- ★ 这个约束必须与 schema.sql 里的定义一致。
--
-- 本文件最初写的是只允许三个应用（ADS / ERP / BRAND_PORTAL）——
-- 那时应用只有这几个。后来新增了 MARKETING、STORE_OPS_BRAIN、ORDER_ANALYSIS、
-- VIDEO、ONLINE 等应用，schema.sql 那边已经把约束放宽了，这里却没跟着改。
--
-- 后果：生产库里已有 VIDEO、ONLINE 的授权行，本文件最后执行，
-- 把约束收紧到三个值 → 既存数据违反约束 → schema 应用整体失败，
-- 整个部署卡住（表现为「schema 应用失败」，看起来像 schema 本身有问题，
-- 实际是两个文件对同一个约束给了不同的定义）。
--
-- 所以这里用与 schema.sql 相同的完整清单。两处定义一致，约束就不会互相打架。
ALTER TABLE shopee_oauth_states
  DROP CONSTRAINT IF EXISTS shopee_oauth_states_app_role_check;
ALTER TABLE shopee_oauth_states
  ADD CONSTRAINT shopee_oauth_states_app_role_check
  CHECK (app_role IN (
    'ADS', 'ERP', 'BRAND_PORTAL', 'MARKETING', 'STORE_OPS_BRAIN',
    'ORDER_ANALYSIS', 'VIDEO', 'ONLINE'));
