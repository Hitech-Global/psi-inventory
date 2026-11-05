# TikTok Shop 接入配置指引

> 状态：**代码已就绪，缺服务端凭据**。
> 现象：平台接入页 TikTok 卡片显示「未配置凭据」，点「连接」返回
> `{"error":"TIKTOK_CREDENTIALS_NOT_CONFIGURED"}`。

---

## 一、根因

生产环境的 `runtime/.env` 里**一个 TikTok 变量都没有**。代码本身是完整的
（授权、换 token、刷新、同步、台账都在），缺的是三个凭据。

| 变量 | 是什么 | 在哪拿 |
|---|---|---|
| `TIKTOK_APP_KEY` | 应用密钥 | TikTok Shop Partner Center → 应用后台 |
| `TIKTOK_APP_SECRET` | 应用密钥 | 同上 |
| `TIKTOK_SERVICE_ID` | 应用的服务 ID | 同上 |

**★ 区域组不用配** —— 代码默认 `ROW`（Rest of World），东南亚与印尼都在这一组 ✅
**★ 回调地址不用配** —— 代码会用 `FEISHU_EXTERNAL_BASE_URL` 自动拼出
`https://analytics.hitechanalysis.top/api/shopee-analytics/tiktok/oauth/callback` ✅
（要单独配也可以：`TIKTOK_REDIRECT_URL`）

---

## 二、步骤

### 1. 在 TikTok Shop Partner Center 申请应用

入口：`https://partner.tiktokshop.com/` → 登录 → **App & Authorization** → 创建应用

- 应用类型：**Shop App / 私有应用**
- 授权范围：店铺、订单、商品、达人（Affiliate）、Analytics —— 按需要勾
- 拿到 **App Key / App Secret / Service ID**

### 2. 把回调地址填到应用后台

```
https://analytics.hitechanalysis.top/api/shopee-analytics/tiktok/oauth/callback
```

### 3. 填进服务端环境变量

在那台 Windows 机器上：
`D:\电商数据分析系统\psi-inventory-feishu-auth\shopee-analytics\deploy\desktop\runtime\.env`

```bash
TIKTOK_APP_KEY=<Partner Center 给的 App Key>
TIKTOK_APP_SECRET=<Partner Center 给的 App Secret>
TIKTOK_SERVICE_ID=<Partner Center 给的 Service ID>
TIKTOK_REGION_GROUP=ROW
```

### 4. 重启 app 容器

```bash
cd D:\电商数据分析系统\psi-inventory-feishu-auth\shopee-analytics\deploy\desktop
docker compose --env-file runtime/.env up -d --force-recreate app
```

### 5. 回平台接入页点「连接」

`https://analytics.hitechanalysis.top/connections.html` → TikTok Shop Open API 卡片 → 连接
→ 在 TikTok 授权页勾选店铺 → 回到系统，店铺台账与令牌状态就记上了 ✅

---

## 三、这次一并改掉的

**★ 之前只有一句「未配置凭据」，读者无从下手** —— 现在：

| 位置 | 改成了什么 |
|---|---|
| `GET /tiktok/status` | 多返回一个 `missingCredentials` 数组，**点名缺哪几个** ✅ |
| 平台接入页的 TikTok 卡片 | 应用凭据那行显示「未配置：TIKTOK_APP_KEY、TIKTOK_APP_SECRET、TIKTOK_SERVICE_ID」✅ |
| 卡片下方新增一行 | 「需要先在 TikTok Shop Partner Center 申请一个应用，然后在服务端配置 … 配置好之后回到这里点「连接」」✅ |
| 「连接」按钮 | 缺凭据时**禁用并变淡**，鼠标悬停说明原因 ✅ |
| 授权开始时的报错 | `TIKTOK_APP_KEY_MISSING` + 中文说明，不再是笼统的 `TIKTOK_CREDENTIALS_NOT_CONFIGURED` ✅ |

---

## 四、另一个坑（重要）

**★ TikTok Shop Open API 没有广告投放能力。**

官方 docv2 全量文档（2026-10-31 实测 299 个唯一 path / 312 个操作）里**不存在**任何
广告投放或广告表现端点 —— `roas` / `ad_spend` / `ad_cost` / `cpc` 全文检索 0 次。

广告数据必须另接 **TikTok for Business Marketing API**（`business-api.tiktok.com`，
OAuth + `advertiser_id`），与 Shop 侧凭据**完全独立**：

| | 变量 |
|---|---|
| Shop 侧 | `TIKTOK_APP_KEY` / `TIKTOK_APP_SECRET` / `TIKTOK_SERVICE_ID` |
| Marketing 侧 | `TIKTOK_MARKETING_APP_ID` / `TIKTOK_MARKETING_APP_SECRET` |

**★ 两套都要单独申请、单独授权** ✅

**★ Shop 侧能拿到的「类广告」字段**（可交叉校验，但**不是**广告报表）：
`gmv_max_ad_fee_amount`（单均分摊的 GMV Max 广告费）、`gmv_max_coupon_fee`、
`cps_shop_ads_commission_tax_amount`、`tap_shop_ads_commission`、
以及 Analytics 里的 `advertisable` / `attributed_gmv` / `live_attributed_gmv` /
`product_card_attributed_gmv` / `click_through_rate` / `paid_order_count`。

详细评估见 `docs/tiktok-shop-integration-assessment.md`。

---

## 五、鉴权方式（实现细节，排错时用）

**★ 与 Shopee 完全不同**：

| | Shopee | TikTok Shop |
|---|---|---|
| 密钥 | partner_id + partner_key | app_key + app_secret |
| 签名 | `partnerId + path + timestamp + accessToken + shopId` | **`app_secret + path + sortedParams + body + app_secret`**（双层 secret，首尾各一次）|
| 公共参数 | shop_id | **shop_cipher** |
| Token | `/api/v2/auth/token/get`（POST） | `https://auth.tiktok-shops.com/api/v2/token/get`（**GET**，`app_secret` 走 query）|

**★ 授权主机**（按区域组选）：
- `seller:ROW` → `https://services.tiktokshop.com/open/authorize`（东南亚）
- `seller:US` → `https://services.us.tiktokshop.com/open/authorize`
- `partner:ROW` → `https://partner.tiktokshop.com/open/authorize`

**★ 日志脱敏**：`app_secret` 会出现在 query string 里，日志与 APM 必须脱敏 ⚠️
