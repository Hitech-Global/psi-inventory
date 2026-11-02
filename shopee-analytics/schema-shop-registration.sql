-- 新增店铺：授权时顺带登记一家系统还不认识的店铺。
--
-- 一次授权只带得下一个 code，而店铺编号要到换成令牌时才知道，所以
-- 读者在授权前填的国家、品牌与显示名得先存下来，等回调时才知道
-- 该登记到谁名下。
--
-- register_mode 为空表示这是"给已有店铺连接口"，不涉及登记。

ALTER TABLE shopee_oauth_states
  ADD COLUMN IF NOT EXISTS register_mode TEXT;
ALTER TABLE shopee_oauth_states
  ADD COLUMN IF NOT EXISTS register_country_code TEXT;
ALTER TABLE shopee_oauth_states
  ADD COLUMN IF NOT EXISTS register_brand_code TEXT;
ALTER TABLE shopee_oauth_states
  ADD COLUMN IF NOT EXISTS register_display_name TEXT;

-- 登记模式下还没有店铺编号，用 0 占位；连接模式下这个字段是真实编号。
ALTER TABLE shopee_oauth_states
  DROP CONSTRAINT IF EXISTS shopee_oauth_states_expected_shop_id_positive;

COMMENT ON COLUMN shopee_oauth_states.register_mode IS
  'CONNECT = 给已有店铺连接口；REGISTER = 授权后登记一家新店铺';
COMMENT ON COLUMN shopee_oauth_states.expected_shop_id IS
  '连接模式下的店铺编号；登记模式下为 0，因为编号要等授权后才知道';
