# TikTok Shop 接入评估（MVP 边界与不可复用点）

> 状态：**仅评估，未实现**。本文用于决定"要不要接 TikTok Shop"以及"从哪一层开始接"。
> 调研依据：TikTok Shop Partner Center 官方文档、TikTok for Business 官方 Business API SDK、
> 官方 OpenAPI 端点清单（取数日 2026-10-31：官方 docv2 文档树实测 299 个唯一 path / 312 个操作 / 19 个路径命名空间）。
>
> 关联文档：`../README.md`（Shopee 侧架构与安全边界）、`skill-architecture.md`（数据平台 / Skill 分层）。

---

## 0. 结论先行

**TikTok Shop Open API 没有广告投放（Ads）能力。** 官方 docv2 文档树全量 API 参考页实测
（2026-10-31，365 页）：312 个 (method, path) 操作 / 299 个唯一路径 / **19 个路径命名空间**中，
不存在任何广告投放或广告表现端点 —— 全文检索 `roas` / `ad_spend` / `ad_cost` / `cpc` 均为 0 次。
广告数据必须另接 TikTok for Business 的 Marketing API（`business-api.tiktok.com`，OAuth + `advertiser_id`），
与 Shop 侧凭据体系完全独立。

> **⚠️ 但 Shop 侧并非"完全没有广告相关数据"。** 两处官方字段可作交叉校验（**不可当作广告报表**）：
> - **Finance 结算明细按单分摊的 GMV Max 广告费**：`gmv_max_ad_fee_amount`（每单按比例扣除的
>   GMV Max 广告费）、`gmv_max_coupon_fee`、`cps_shop_ads_commission_tax_amount`、`tap_shop_ads_commission`
>   —— 出现在 `/finance/202501/orders/{order_id}/statement_transactions`、
>   `/finance/202501/statements/{statement_id}/statement_transactions`、`/finance/202507/orders/unsettled`
> - **Analytics 的广告相关指标**：`advertisable`、`attributed_gmv`、`live_attributed_gmv`、
>   `product_card_attributed_gmv`、`click_through_rate`、`paid_order_count` / `paid_user_count`、
>   `paid_ads_age_indicators` / `paid_ads_gender_indicators`
>
> 准确表述：**Shop OpenAPI 无广告投放/广告表现（spend、ROI、曝光、点击）端点**，GMV Max 广告报表必须走
> Marketing API；但上述字段提供了订单与内容维度的间接信号。

此外，Shop 侧存在 `affiliate_partner/**/campaigns*`（12 条）路径 —— 那是 **TAP 达人合作 campaign**
（选品寄样 / 达人佣金），**不是广告投放 campaign**，无 spend / bid / ROI 语义。

但这不等于接不了。TikTok Shop Open API 提供 **Analytics 域**（店铺级漏斗 + GMV + 内容/达人归因）
和 **Affiliate 域**（达人合作表现），加上订单 / 商品 / 结算 / 退货，足以支撑当前诊断链路里
**除"广告组优先"之外**的绝大部分环节。

**建议：先做 M1（Shop Open API 只读经营分析，不碰广告），把广告层留到 M2 且独立立项。**

---

## 1. 三套 API 的边界（最关键的澄清）

| | **TikTok Shop Open API** | **TikTok for Business / Marketing API** | TikTok for Developers |
|---|---|---|---|
| 入口 | `partner.tiktokshop.com/docv2` | `business-api.tiktok.com/portal` | `developers.tiktok.com/doc` |
| Base URL | `https://open-api.tiktokglobalshop.com` | `https://business-api.tiktok.com/open_api/v1.3` | `https://open.tiktokapis.com/v2` |
| 能力 | 商品、订单、履约、售后、结算、促销、**Affiliate（达人）**、**Analytics（店铺表现/SPS 诊断）**、Webhook | 广告系列/组/创意、**报表（campaign/adgroup/ad 粒度）**、**GMV Max 报表**、受众 | 视频发布与研究（与电商无关） |
| 鉴权 | `app_key` + `app_secret` + **HMAC-SHA256 签名** + `x-tts-access-token` header | **OAuth2**，只有 `Access-Token` header，**不签名** | OAuth2 / Bearer |
| 主体 | 卖家店铺（`shop_cipher` 维度） | 广告账户（`advertiser_id` 维度） | 创作者账号 |

三个高频误判，务必避开：

1. **不存在"Shop Ads API"。** TikTok Shop Ads 自 2025-07 起**默认且唯一支持的推广系列类型是 GMV Max**
   （旧的 VSA/PSA/LSA 已不能新建/编辑）。这些广告的数据只在 Marketing API 侧，且 GMV Max 报表的
   `store_ids` 参数是必填。
2. **`business-api.tiktok.com` 不是电商 API 的主机名。** 第三方归档会把 `/order/202309/orders`
   标成 base URL = `business-api.tiktok.com`，那是二次归档产物。官方 `servers` 明确是
   `open-api.tiktokglobalshop.com`。接错主机会 404。
3. **TikTok Business API ≠ Marketing API ≠ Shop API。** 电商链路在 Partner Center 的 Shop API 里，
   与 Marketing API 的凭据不互通。

---

## 2. 鉴权与签名（与 Shopee 逐项差异）

### 2.1 三主机模型

| 环节 | 主机 |
|---|---|
| 卖家授权 | `services.tiktokshop.com/open/authorize?service_id=<SERVICE_ID>`（US：`services.us.tiktokshop.com`） |
| Token 交换 | `GET https://auth.tiktok-shops.com/api/v2/token/get` |
| Token 刷新 | `GET https://auth.tiktok-shops.com/api/v2/token/refresh` |
| 业务调用 | `https://open-api.tiktokglobalshop.com/{category}/{version}/{resource}` |

Token 交换是 **GET**（不是 POST），且 **`app_secret` 走 query string** —— 日志 / APM 必须脱敏。

> ⚠️ **`grant_type` 不是标准 OAuth 值**：交换时是 `authorized_code`（**不是** `authorization_code`），
> 刷新时是 `refresh_token`。官方原文强调 *"this value is intentional and correct for the TikTok Shop
> token API — it is not the standard OAuth `authorization_code`. Do not 'fix' it."*
>
> 主机归属：业务调用 `open-api.tiktokglobalshop.com`、授权 `services.tiktokshop.com`
> （US：`services.us.tiktokshop.com`）、Partner Center `partner.tiktokshop.com`、
> Creator `shop.tiktok.com/alliance`；但 **token 端点所有市场统一** `auth.tiktok-shops.com`。

### 2.2 Token 生命周期

| 项 | 值 |
|---|---|
| `access_token` | **默认 7 天**（响应含 `access_token_expire_in` unix 时间戳，实际以该时间戳为准） |
| `refresh_token` | 到卖家授权期结束（`refresh_token_expire_in`），**刷新时会轮换** |
| `auth_code` | **30 分钟有效且只能用一次**（重用/延迟 → `36004004`） |
| `user_type` | 0=Seller、1=Creator、3=Partner(TAP) |
| 成功判定 | **看 body 的 `code == 0`**，不能只看 HTTP 状态 |
| `granted_scopes` | 响应带回卖家实际批准的 scope；`105005` = access denied（多半是 scope 缺失，需重新授权） |

### 2.3 签名算法

```
baseString =
    app_secret
  + path                                    // 含 category/version/resource
  + Σ(sorted(queryParams) 按 key 字典序)     // 拼成 key+value 无分隔符；shop_cipher 也在内
  + body                                    // 非 multipart/form-data 时追加；无 body 追加空串
  + app_secret

sign = HMAC-SHA256(key = app_secret, msg = baseString).hexdigest()   // 小写 hex
```

**官方自测向量**（可直接写单测，已独立复算验证）：
`app_secret=e59af819cc`、`path=/authorization/202309/shops`、`app_key=29a39d`、`timestamp=1623812664`
→ 期望 `sign = b596b73e0cc6de07ac26f036364178ab16b0a907af13d43f0a0cd2345f582dc8`

官方 Step-by-step breakdown 原文：

```
Step 3 → app_key29a39dtimestamp1623812664
Step 4 → /authorization/202309/shopsapp_key29a39dtimestamp1623812664
Step 5 → e59af819cc/authorization/202309/shopsapp_key29a39dtimestamp1623812664e59af819cc
Step 6 → b596b73e0cc6de07ac26f036364178ab16b0a907af13d43f0a0cd2345f582dc8
```

> ⚠️ 网上流传的"带 HTTP_METHOD 和 `\n` 分隔符"版本（部分 CSDN/51CTO 博文）是**错的**，
> 复算不匹配。官方版本**不带 method、不带换行符**。

与 Shopee（`src/shopee-client.js`）逐项对比：

| 维度 | Shopee | TikTok Shop |
|---|---|---|
| baseString | `partnerId + path + timestamp + accessToken + shopId`（单段直拼） | `app_secret + path + sortedParams + body + app_secret`（**双层 secret 包裹，首尾各一次**） |
| token 是否参与签名 | accessToken **在** | accessToken **不在**（走 `x-tts-access-token` header；旧版 API 才在 query，且签名时须排除）；`shop_cipher` **在** |
| 参数排序 | 无 | **按 key 字典序排（区分大小写）**，再按 `{key}{value}` 拼接、**无分隔符** |
| body | 不参与 | **参与**（非 `multipart/form-data` 时；唯一例外是 multipart。必须用**实际发送的字节**，禁止解析后重新序列化） |
| 哈希 | HMAC-SHA256 hex | HMAC-SHA256 hex（**相同**） |
| 密钥 | partner_id + partner_key | app_key + app_secret + service_id（**三个**） |

**结论：签名函数必须 100% 平台特化。** 但可抽象为 `PlatformSigner` 接口 —— 现有
`signShopRequest` / `signPrincipalRequest` 已是这种形态，扩展成本低。

### 2.4 Webhook 验签（与请求签名是两套）

- Header `Authorization`（**无 Bearer 前缀**）= `HMAC-SHA256(app_key + rawBody, key=app_secret)` 小写 hex
- **必须用原始字节验签**，不能对 parse 后的对象重新 stringify
- 3 秒内返回 200 空 body；验签错返回 401
- 至少一次投递 → 必须幂等；重试节奏 2min → 30min → 3h → 12h

---

## 3. 多店铺 / 多区域模型

### 3.1 一个 token → 多个 shop（与 Shopee 最大的模型差异）

`GET /authorization/202309/shops` 返回每个店的 `id` / `cipher` / `region` / `seller_type`（`CROSS_BORDER` / `LOCAL`）。

要点：

- **一个 access_token 可覆盖卖家名下多个店铺**（跨境"一商卖全球"的直接结果），每店有自己的 `cipher`
- 账号单位必须是 **`(access_token, shop_cipher)` 二元组**，而不是 Shopee 的 `shop_id`
  → **cipher 串店 = 静默读到别的品牌数据，这是最高危的坑**
- `cipher` 是**端点级**的，官方 Common errors 页 Parameter errors 段原文：
  - `106013` **Missing identifier.** — *The `shop_cipher` query parameter is required to identify the target shop.*
    → 需从 Get Authorized Shops 端点取该值
  - `36009004` **Unexpected identifier.** — *The `shop_cipher` query parameter is not required for this request.*
    → 去掉后重试
  → **不要猜，逐端点读文档**，建议在 client wrapper 里维护 per-endpoint flag
- ⚠️ **`36009004` 被复用于多种请求校验失败，禁止仅凭数字码分支，必须结合 `message` 关键词。**
  官方为此专门给了 message 关键词索引表，其中与本项目相关的两条：
  `shop_cipher, not required` → 请求带了多余的 shop_cipher；
  `x-tts-access-token header is invalid` → header 无效。
  另有版本号差异：`36009014` / `36009004` 双写（版本无效时新旧网关返回不同码）。
- `cipher` **参与签名**（Common parameters 页：*"If the field is part of the signed request parameters
  for the endpoint, include it when generating `sign`."*）

### 3.2 区域站点

| 事实 | 结论 |
|---|---|
| US 站 Partner Center | `partner-us.tiktokshop.com`（独立门户） |
| 其他市场 | `partner.tiktokshop.com` |
| **凭据是否互通** | **不互通**。US 与非 US 通常需要**两个 app、两套 app_key/app_secret** |
| 业务 API 主机 | **统一** `open-api.tiktokglobalshop.com`，不按区域分域名；区域由 `shop_cipher` 隐含 |
| 一个 app 能否授权多区域店铺 | ROW 侧同一 app 可覆盖同一 seller 名下的多国店铺；US 侧需独立 app |

**建模建议**：抽象出"平台实例"概念 = `(region_group, app_key, app_secret, service_id)`。

---

## 4. 核心只读端点与字段

### 4.1 订单

`POST /order/202309/orders/search`（`page_size` 1–100 默认 20，游标分页 `page_token`/`next_page_token`）
· `GET /order/202507/orders`（详情，一次最多 50 个 id）· `GET /order/202407/orders/{id}/price_detail`

支撑 GMV / 订单量 / 客单价 / SKU 维度所需字段：

```
id, create_time, paid_time, update_time, status, currency, buyer_user_id
payment { sub_total, shipping_fee, total_amount, original_total_amount,
          seller_discount, platform_discount, ... }
line_items[] { id, product_id, product_name, sku_id, sku_name, seller_sku, sku_type,
               quantity, sale_price, original_price, seller_discount, currency, ... }
```

状态枚举：`UNPAID / ON_HOLD / AWAITING_SHIPMENT / PARTIALLY_SHIPPING / AWAITING_COLLECTION /
IN_TRANSIT / DELIVERED / COMPLETED / CANCELLED`

### 4.2 商品 / SKU

`POST /product/202502/products/search`（`page_size` 1–100）· `GET /product/202309/products/{id}`
· `POST /product/202309/inventory/search` · `GET /product/202309/categories`、`/brands`
· `POST /product/202405/products/diagnoses`（**官方给的商品优化诊断**）

### 4.3 优惠（**版本分裂**）

| 端点 | 版本 |
|---|---|
| `POST /promotion/202309/activities/search`（Product Discount / Flash Deal） | 202309 |
| `POST /promotion/202406/coupons/search` | **202406** |

**写死一个版本号会有一半路径是错的。** 且优惠券无法用 OpenAPI 创建，只能在 Seller Center 建，API 仅支持"查"。

### 4.4 退货 / 取消 / 退款

`POST /return_refund/202602/returns/search`（`page_size` **10–50** 默认 10）
· `POST /return_refund/202602/cancellations/search` · `POST /return_refund/202602/refunds/calculate`（只读安全）
· `GET /return_refund/202309/returns/{id}/records`

### 4.5 店铺 / 结算

`GET /authorization/202309/shops` · `GET /seller/202309/shops` · `GET /seller/202309/permissions`
· `GET /seller/202601/shop_groups`（跨区店组）· `GET /finance/202309/statements`
· `GET /finance/202501/orders/{id}/statement_transactions`（**订单级 SKU 流水，做净 ROAS 的关键**）

结算流水可支撑净 ROAS 的字段：
`revenue_amount, fee_and_tax_amount, shipping_cost_amount, settlement_amount` +
`revenue_breakdown{...}` + `shipping_cost_breakdown{...}` +
`fee_tax_breakdown{platform_commission_amount, referral_fee_amount, transaction_fee_amount, ...}` +
`affiliate_commission_amount`、**`affiliate_ads_commission_amount`**、**`shop_ads_commission`**、
**`target_ads_commission`**、**`actual_paid_shop_ads_commission`**

→ 这是**全平台唯一能在 Shop 侧间接感知"广告订单"的信号**：给不了广告花费额（spend），
但能给"广告归因订单的佣金结构"与达人佣金成本。

**已验证的广告费用分摊字段**（官方 Finance 响应 schema 中真实存在，比上述佣金字段更直接）：

| 字段 | 官方含义 |
|---|---|
| `gmv_max_ad_fee_amount` | 每单按比例从净销售额中扣除的 **GMV Max（净销售绩效目标）广告费** |
| `gmv_max_coupon_fee` | GMV Max 优惠券成本 |
| `cps_shop_ads_commission_tax_amount` | GMV Max 广告费上征收的销售税 |
| `tap_shop_ads_commission` | 商家支付给 TikTok Shop Affiliate Partner (TAP) 的广告佣金成本 |

出现在 `/finance/202501/orders/{order_id}/statement_transactions`、
`/finance/202501/statements/{statement_id}/statement_transactions`、`/finance/202507/orders/unsettled`、
`/supply_chain/202309/packages/sync`。
→ **可用于按单重建"广告侧成本"，是 M1 阶段最接近广告 ROAS 的可用信号**（仍非 spend 口径）。

数据可用性硬约束：**Finance 域仅 2023-07-01 之后**；**US 跨境卖家 2025-04-30 之前无数据**。

### 4.6 Analytics 域（最接近 Shopee Ads 分析能力的部分）

| 端点 | 关键返回 |
|---|---|
| `GET /analytics/202609/shop/performance` | **店铺级漏斗 + 销售**：`traffic{product_impressions, product_clicks, avg_visitors, avg_conversion_rate}` + `sales{gmv, avg_order_value, customers_count, cancellations_and_returns, creator_live_gmv, creator_video_gmv, ...}` + `breakdowns{content_breakdown[{channel: CREATOR\|SELLER, content_type: LIVE\|VIDEO, gmv, indirect_gmv}], affiliate_product_card_attributed_gmv, ...}`。参数 `start_date_ge`/`end_date_lt`（**店铺注册时区**的 YYYY-MM-DD）、`granularity`、`currency`(USD/LOCAL)，响应含 **`latest_available_date`** |
| `GET /analytics/202509/shop_skus/performance` | **SKU 级**：`gmv` / `sku_orders` / `units_sold` |
| `GET /analytics/202509/shop_products/{id}/performance` | 商品级 |
| `GET /analytics/202409\|202609/shop_videos/performance` | 视频级 |
| `GET /analytics/202502/live_rooms/{id}/core_stats` | 直播间级 |
| `GET /analytics/202606/shop_performances/overview` | **SPS 店铺表现分**（0–5，EXCELLENT/GOOD/POOR/CRITICAL）、`peer_percentile`、`top_issues` |
| `GET /analytics/202606/shop_performances/metrics` | SPS 各维度指标 + 基准阈值 |
| `GET /analytics/202606/shop_performances/metrics/{code}/diagnosis` | **单指标诊断**：`NRR`(净推荐率) `NBFR`(净坏评率) `SFCR`(履约成功率) `OTDR`(及时发货率) `AHT`(响应时长) `IM_DSAT` + 趋势 + 计算明细 |
| `.../metrics/{code}/problem_details` · `.../top_items` | 归因到具体商品 / 物流商 / 售后类型 / 订单 |

> **⚠️ SPS 诊断域仅 US 区域店铺可用**（官方 description 明示）。

**重要正面发现**：TikTok Shop Open API 自带一套**官方诊断引擎**（SPS metric + benchmark threshold +
diagnosis + problem_details + top_items），语义上与现有 `diagnosis.js` + `maturity-engine.js` 高度重合 ——
既可当数据源，也可当"官方基线"校准自有 A/B/C 分级。

### 4.7 Affiliate / 达人域（TikTok 版的"渠道"真源）

`POST /affiliate_seller/202410/orders/search`（含 `campaign_id`、`creator_username`、`content_type`、
`commission_model`、`commission_rate`、`settlement_status`）
· `GET /affiliate_seller/202505/marketplace_creators/{id}`（`gmv`、`units_sold`、`gpm`、`live_gpm`、
`avg_commission_rate`、`follower_count`、`category_gmv_distribution`、`content_gmv_distribution`）
· `GET /affiliate_partner/202501/campaigns/{id}/products/performance`

**数据窗口硬限制**：联盟订单搜索**单次请求最多支持 3 个月数据**。

**结论：TikTok Shop 的"流量结构"主要由达人（Creator）承担，而非 Shopee 式的商品广告位。
`affiliate_seller` + `affiliate_partner` 就是最接近 Shopee "渠道/广告组" 分析的数据源。**

---

## 5. 数据同步的已知坑（按踩坑代价排序）

### 5.1 分页游标 —— 会静默漏数据

| 端点 | `page_size` |
|---|---|
| 订单 / 商品 | 1–100（默认 20 / 必填） |
| 优惠券 | 1–100（默认 50） |
| 退货 | **10–50**（默认 10） |
| 联盟 | 1–50 |
| Analytics SKU | ≤100（默认 10） |

🔴 **已知高频坑**：`POST /order/202309/orders/search` 偶发返回 **0 条或不足 page_size，但仍返回
`next_page_token`**。若沿用 Shopee 的 `hasMore = next_page_token != null` 逻辑，会用坏 token 继续翻页，
**跳过大量订单**。必须做"异常页重试 + 游标一致性校验（`total_count` 累计对比）"。

### 5.2 时间窗口

- **订单**：`create_time_ge`/`create_time_lt` **必须成对填**（只填一端时另一端默认"当前时间"或"开店最早"）
- **增量同步**：官方语义建议用 `update_time_ge`（任何状态变化都算更新）；社区推荐 `last_run - 2h` 重叠窗口防漏。
  ⚠️ 官方明示"**update_time 可能超出所选搜索范围，因为搜索过程中数据持续刷新**" → 必须按 `id` 去重
- **联盟订单**：最多 3 个月
- **Finance**：2023-07-01 起；US 跨境 2025-04-30 起
- **SPS 趋势**：`trend_duration_days` 1–90（默认 30）

### 5.3 限流

官方 Rate limits §4.1「HTTP Status and Business Code Relationship」明确：

| 信号 | 含义 |
|---|---|
| HTTP `429 Too Many Requests` | 传输层限流信号 |
| 业务码 `36009002` | OpenAPI 业务层的限流 / 请求频率控制错误码 |
| HTTP `429` + body `36009002` | 最明确的限流响应（传输层与业务层一致） |

Common errors 页原文：*"The HTTP response should be handled together with the business code:
**HTTP 429 and 36009002 both indicate rate limiting.** Apply retry/backoff logic, respect `Retry-After` if present."*

补充要点（官方明确，容易被忽略）：

1. **没有固定 QPS**。官方：*"The platform does not expose a single fixed QPS query API for all endpoints."*
   配额由授权店铺数、端点分级、实时平台负载动态计算。官方给出的只是**保守起步建议**
   （重写/复杂分析类 0.2–1 req/s、标准读 3–10 req/s 等），并注明 *"these values are **not guaranteed
   platform limits**"*。**若某个端点参考页写了具体限制，以端点页为准。**
2. **429 ≠ 你的配额超了**。可能是端点级或平台级保护性限流；`503` 是服务不可用，**不是**限流，
   两者处理策略不同。最小隔离单元是 **App ID × Authorized Shop**。
3. 社区常引（需实测验证）：每店每 app 50 req/s；每端点每日 ~1000 次
4. ⚠️ **TikTok 返回 429 时 body 里还有业务 code，不能只看 HTTP 状态**
5. 现有 `src/rate-limit-retry.js` 需为 TikTok 单独配置，并区分 429 / `36009002` 两条触发路径

### 5.4 时区与货币

| 维度 | 现状 |
|---|---|
| 订单 / 结算时间 | unix 秒（UTC），与 Shopee 一致 ✅ |
| Analytics 日期参数 | **店铺注册时区的 YYYY-MM-DD**（`end_date_lt` 排他）—— 与订单 UTC 不同坐标系，join 必须按店铺时区归一 |
| Analytics 币种 | 参数 `currency` 仅支持 `USD` / `LOCAL`（默认 LOCAL） |
| 订单 / 结算币种 | **本币 decimal string**（如 `"5000"`），不是 number |
| 汇率 | **平台不提供** → 必须自建汇率表（可复用 PSI 侧 `currency-rates-auto` / `fx-rate-precision.sql`） |

### 5.5 数据延迟与保留

- Shop 经营数据延迟 **2–4 小时**（促销期可达 6 小时）
- Ads Manager 数据延迟 **12–24 小时**（当天数据可能为空）
- Seller Center 订单展示上限 **90 天**
- Analytics 响应自带 **`latest_available_date`** → **应直接用作同步水位线**，比硬编码日期可靠

### 5.6 版本管理

版本在 **path 里**（`/order/202309/...` vs `/order/202507/...` vs `/return_refund/202602/...`），
且**同一业务域内不同端点版本不同**（promotion: activities=202309 / coupons=202406）。
→ **必须在 catalog 里按端点固定版本字符串，绝不能拼模板。**

---

## 6. 角色抽象：不能照抄 Shopee 的四角色

Shopee 现有 `app_role` = `ADS / STORE_OPS / ERP / BRAND_PORTAL`，每角色独立 partner_id/key/token。
TikTok 侧建议映射：

| 建议角色 | 覆盖能力 | 凭据 |
|---|---|---|
| `TTS_OPS`（对标 STORE_OPS+ERP） | 商品、订单、履约、售后、促销、结算 | app_key/app_secret + seller token + shop_cipher（**一个 app 即可**） |
| `TTS_ANALYTICS`（新增） | `/analytics/*`：店铺漏斗、SKU/商品/视频/直播表现、SPS 诊断 | 同上（同一 token，仅 scope 不同） |
| `TTS_AFFILIATE`（新增，对标"渠道"） | `/affiliate_seller/*`、`/affiliate_partner/*` | 同上 |
| `TTS_ADS`（对标 ADS） | GMV Max 报表、campaign/adgroup 报表 | **完全独立的 app_id/secret + advertiser OAuth token**，与上面三者无交集 |

**关键结论：Shopee 的"ADS = 付费广告"在 TikTok 侧被拆成 `TTS_ADS`（付费）+ `TTS_AFFILIATE`（达人）
+ `TTS_ANALYTICS`（店铺级漏斗）三块。这直接改变了诊断链路的输入形态。**

---

## 7. 诊断链路的逐环节可行性

| 现有链路环节 | 可行性 | 数据来源 | 备注 |
|---|---|---|---|
| 广告组优先 | ⚠️ **部分可行** | `TTS_ADS` GMV Max（campaign 粒度）+ `TTS_AFFILIATE` | GMV Max **无"广告组"概念**（只有 campaign/item_group/item）；item_id 维度须同时传 `campaign_ids` + `item_group_ids` |
| 成熟度 | ✅ 可行 | `TTS_ANALYTICS` 的 `latest_available_date` + 完整天数；SPS `evaluate_duration_days` | 官方 SPS 分级可作外部校准 |
| ROAS vs 盈亏平衡 | ⚠️ **需重构** | `TTS_ADS` 给 cost/roi/gross_revenue；`TTS_OPS` 结算流水给佣金/运费/退款 | ① GMV Max 的 ROI **混合付费+自然+达人订单**（1 天归因），不是纯广告 ROAS ② Ads Manager 7天点击/1天浏览归因 ≠ Seller Center GMV Max 面板的 1 天归因，**两个后台数字永远对不上** |
| 漏斗 | ✅ 可行（形态变了） | `TTS_ANALYTICS`：`product_impressions → product_clicks → avg_conversion_rate`；`TTS_ADS` GMV Max 漏斗字段 | ⚠️ **TikTok 无订单级流量来源字段**（`traffic_source`/`ad_source`/`attribution_source` 全量 OpenAPI 中 0 命中）→ 只能做**聚合归因**（日 × SKU × 渠道），**做不到 Shopee 那种"直接订单 vs 广泛订单"的订单级拆分** |
| SKU 结构 | ✅ 完全可行 | `TTS_ANALYTICS` SKU 级 + 订单 `line_items.seller_sku` | 比 Shopee 还细 |
| A/B/C 分级 | ✅ 可行但需重新定义 | 自有引擎 + GMV Max item 级 + 达人级 | 建议**三级主体**：商品级 / 达人（或活动）级 / 广告活动级，各自独立分级 |
| 动作建议 | ✅ 可行 | 上述 + 官方 SPS `problem_details`/`top_items`/`diagnosis` | 官方 SPS 诊断是白送的规则来源 |

---

## 8. MVP 建议：分三期

### M0 — 平台底座（必做）

1. `TikTokSigner`（HMAC-SHA256 + 双 secret 包裹 + 排序参数 + body），带**官方示例向量**单测
2. 授权链路：授权链接 → `auth_code` → token 交换 → 自动跑 `/authorization/202309/shops`
   建立 `(shop_id, region, cipher, seller_type)` 台账 → refresh 调度（提前 24h 刷）
3. 凭据存储：复用 `token-crypto.js`（AES-GCM + master key）与 `token-repository.js` 模式，
   表结构加 `shop_cipher` 字段；**cipher 与 shop_id 必须成对存，并在所有 shop-scoped 请求强制校验归属**
4. TikTok 版 `catalog.js`：含 per-endpoint `requiresShopCipher` flag + **固定版本号**
5. 通用 client：429 / `36009002` 退避、`request_id` 落日志、**cursor 分页器（含异常页检测）**
6. 原始快照层 `tiktok_raw_api_snapshots`（对齐 `shopee_raw_api_snapshots` 结构，复用查询与回放工具）

### M1 — 真正的 MVP：Shop Open API 只读经营分析（不碰广告）

范围：`/order/*` + `/product/*` + `/return_refund/202602/returns/search`
+ `/promotion/202406/coupons/search` + `/promotion/202309/activities/search`
+ `/finance/202309/statements` + `/finance/202501/orders/{id}/statement_transactions`
+ `/analytics/202609/shop/performance` + `/analytics/202509/shop_skus/performance`
+ `/affiliate_seller/202410/orders/search` + `/affiliate_seller/202505/marketplace_creators/{id}`

- 产出：**店铺漏斗 + SKU 结构 + 达人渠道结构 + 结算净收益**
- 覆盖链路：成熟度 ✅、漏斗 ✅（聚合形态）、SKU 结构 ✅、A/B/C（商品/达人两维）✅、动作建议 ✅
- **不覆盖**：付费广告表现、ROAS vs 盈亏平衡（缺 spend 侧）
- **必须同步申请 scope**：`Order Information`、`FS Order&Fulfillment Management`、`Product Basic`、
  `Return & Refund Basic`、`Finance Information`、`Promotion Information`、`TikTok Shop Analytics`、
  `Read Seller Affiliate Collaboration`、`Global Shop Information`、`Shop Authorized Information`

### M2 — Marketing API 接入（GMV Max 广告层）

- 新增**独立的** app_id/secret + advertiser OAuth（`Access-Token` header，**无签名**），
  广告账户与店铺通过 `store_ids` 关联
- 拉 `GET /open_api/v1.3/gmv_max/report/get/`（`store_ids` 必填）与
  `GET /open_api/v1.3/report/integrated/get/`（data_level: AD / ADGROUP / ADVERTISER / CAMPAIGN）
- **归因口径必须在 UI 上明确标注**：GMV Max ROI = 付费+自然+达人混合归因，1 天窗口
  → 与 Shopee 的 Direct/Broad 语义完全不同，**不能直接套 `metrics.js` 的 `direct_gmv`/`broad_gmv` 映射**
- **日期窗口**：带 `stat_time_day` 维度时跨度 **≤ 30 天**（否则报 `max time span is 30 days`）

---

## 9. 复用 vs 特化清单

### 可抽象复用（平台无关）

- 诊断引擎算法层 `diagnosis.js` / `maturity-engine.js` / `action-engine.js` / `metrics.js`
  —— **前提是输入契约统一**：定义平台无关中间模型
  `{ impressions, clicks, spend, orders, gmv, units, aov, refunds, cancellations, commission, shipping, content_type }`，
  各平台 adapter 负责映射
- 三层数据流（原始快照 → 归一化事实 → 诊断分析）与 `sync-cycle.js` / `sync-scheduler.js` 调度骨架
- token 加密存储（`token-crypto.js`）+ 32 字节 master key 方案
- 汇率/成本/WAC/盈亏平衡计算 —— TikTok 结算流水费率结构与 Shopee 相似
- UI / 看板 / 报告导出（只需多一个 platform 维度）
- `data-quality.js` / `source-aware-metrics.js` 的校验思路（可加"币种缺失""cursor 跳页""时间窗重叠"）
- Webhook 接收骨架（TikTok 验签规则不同，但"原始字节 + 时间戳窗口 + 常量时间比较 + 幂等"通用）

### 必须平台特化

- 签名器 · 授权 URL / token 交换（GET + query 传 secret）/ 刷新（refresh token **会轮换**）
- `shop_cipher` 生命周期与端点级必需性判定
- 多区域双 app（US / ROW 独立凭据）与店铺台账
- 分页器（cursor + 异常页检测）
- 限流退避（429 + `36009002`）
- 字段映射 —— **GMV 三个口径不同，必须分别落库并标注**：
  Shopee `order_amount` ↔ TikTok `payment.total_amount` / Analytics `gmv` / 结算 `revenue_amount` /
  GMV Max `gross_revenue`
- 时区（Analytics 店铺时区 vs 订单 UTC）
- 归因语义（TikTok 无订单级来源 → 直/间 conversion 拆分不可得）

---

## 10. 风险与待决策

| 风险 | 影响 | 建议 |
|---|---|---|
| **应用审核周期**：US/UK 等市场需合规+法务审查，官方提示预留 3 周以上 | MVP 时间线 | 立即并行启动 Partner Center 入驻（US 与 ROW 分别申请），用 Sandbox + 开发店先跑通链路 |
| **scope 申请过宽** → 审核变慢 + 卖家授权转化率下降 | 排期 | 只申请 M1 所需 scope；后续加 scope 需请所有已连卖家**重新授权** |
| GMV Max 归因含自然+达人流量 | ROAS 结论可能误导 | UI 必须标注口径；净 ROAS 用结算流水自建（扣退款/达人佣金/平台佣金/物流）而非直接用平台 ROI |
| 无订单级流量来源字段 | 无法做 Direct/Broad 订单拆分 → `metrics.js` 的 direct/broad 逻辑失效 | 退化为"渠道聚合归因"（日 × SKU × 渠道），诊断文案明确"归因口径为平台聚合" |
| US / ROW 双 app 双凭据 | 运营复杂度 ×2 | 抽象"平台实例"概念 = `(region_group, app_key, app_secret, service_id)` |
| SPS 诊断仅 US | 诊断规则覆盖不全 | 非 US 用自有规则，US 引入官方 SPS 做交叉校验 |
| `partner.tiktokshop.com` 文档为 SPA，抓不到正文 | 文档检索困难 | 用官方 OpenAPI 镜像 + `x-tts-docs-url` 扩展做主索引 |

### 待决策

1. **目标区域**：是否需要 US + ROW 双 app？这直接决定 M0 的凭据模型（复杂度 ×2）
2. **是否接受 M1 不覆盖付费广告**：缺口用结算流水自建净 ROAS 补（spend 侧仍缺）
3. **是否需要逐文件级适配映射表**：现有 `catalog.js` / `sync-*.js` / `analysis-service.js` 哪些新增、哪些改、哪些原样复用
4. **GMV 口径对齐表**：跨平台对比分析正确性的前提，建议在 M1 动工前先定稿

---

## 参考来源

**官方**
- [Partner Center 开发者指南](https://partner.tiktokshop.com/docv2/page/656559fcf4488c02dfe8ce82)
- [API 概念与端点总览](https://partner.tiktokshop.com/docv2/page/tts-api-concepts-overview)
- [**签名指南（Sign your API request，含官方自测向量）**](https://partner.tiktokshop.com/docv2/page/sign-your-api-request)
- [通用参数（Common parameters，shop_cipher / access_token 排除规则）](https://partner.tiktokshop.com/docv2/page/common-parameters)
- [通用错误码（Common errors，106013 / 36009004 / 36009002）](https://partner.tiktokshop.com/docv2/page/common-errors)
- [授权概览（Authorization overview，token 生命周期 / grant_type）](https://partner.tiktokshop.com/docv2/page/authorization-overview-202407)
- [限流](https://partner.tiktokshop.com/docv2/page/rate-limits) · [版本机制](https://partner.tiktokshop.com/docv2/page/api-versioning)
- [Get Authorized Shops](https://partner.tiktokshop.com/docv2/page/get-authorized-shops)
- [Promotion API overview](https://partner.tiktokshop.com/docv2/page/promotion-api-overview)
- [TikTok Business API SDK](https://github.com/tiktok/tiktok-business-api-sdk) · [ReportingApi](https://github.com/tiktok/tiktok-business-api-sdk/blob/main/java_sdk/docs/ReportingApi.md)
- [TikTok Ads：店铺广告 / GMV Max](https://ads.tiktok.com/help/article/set-up-tiktok-shopping)

> **取数方法备注**：Partner Center 文档站是 SPA，`WebFetch` 抓不到正文。可直接调用其官方只读 JSON 接口：
> `GET https://partner.tiktokshop.com/api/v1/document/tree?workspace_id=3` 与
> `GET https://partner.tiktokshop.com/api/v1/document/detail?document_id={id}&workspace_id=3`
> （`workspace_id=3` 对应 docv2）。本文的签名/参数/错误码/限流/授权结论均据此原文提取，
> 端点清单由 365 个 API 页的 `# Path:` / `# Method:` 字段解析得出，签名向量已独立复算验证。

**社区与聚合（交叉验证）**
- [TikTok Shop API 集成指南（签名自测向量、token 主机、webhook、错误码）](https://netalith.com/blogs/social-commerce/tiktok-shop-api-integration)
- [对接 TikTok API 的 5 个难题（分页/签名/Scope）](https://blog.51cto.com/u_16213574/14758151)
- [完整 OpenAPI 镜像（字段级 schema 交叉验证）](https://github.com/isaackogan/TikTok-Shop-Api-SDKs)
- [API2Cart 接入（US/ROW 双门户）](http://d3g4zhtkdvou35.cloudfront.net/how-to-connect-tiktok-shop-to-api2cart)
- [Unified.to 接入（凭据不互通）](https://docs.unified.to/guides/how_to_setup_a_tiktok_shop_application)
- [Phyllo 限流综述](https://www.getphyllo.com/post/tiktok-api-rate-limits-in-2026-quotas-errors-workarounds)
- [Supermetrics GMV Max 字段与 30 天限制](https://docs.supermetrics.com/docs/tiktok-ads-smart-ads-and-gmv-max-campaign-reporting-august-10-2026)
