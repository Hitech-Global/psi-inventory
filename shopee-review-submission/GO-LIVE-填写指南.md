# Shopee 开放平台 Go Live 表单 · 逐字段填写指南

> 适用于三个待上线的应用：**Shopee Marketing (1244910)**、**Store Operations Brain (1241171)**、**Order Analysis (1240406)**
> 应用入口：`App List → 点进应用 → Go Live`

---

## 一、三个应用共用的字段

### 1. Test / Live Redirect URL Domain

**两个框都填同一个值：**

```
https://analytics.hitechanalysis.top/api/shopee-analytics/app/oauth/callback
```

**为什么这样填**
- 提示要求「生成授权链接时的 redirect_url 域名要和这里一致」
- 实测：`analytics.hitechanalysis.top` 这个域名已被 Video / Online / Brand Portal 接受 ✅
- **末尾不要加斜杠** —— 加了会被判为「域名不一致」（实测踩过）
- Test 和 Live 填同一个，因为我们的授权服务不区分环境，回调路径只有一个

**若这行填了仍报「域名不一致」**：说明该应用在控制台里已声明了别的域名（Order Analysis 现在声明的是 `ai-shop-analyzer-frontend.onrender.com`），**先在 Edit 里改成上面这个**。

---

### 2. PII Necessity Declaration（买家 PII 开关）

**三个应用都保持关闭（OFF）。**

- 关闭时，OpenAPI 返回的买家姓名、电话、邮箱、收货地址会被打码
- **我们的系统只读统计类指标**：曝光、点击、订单、GMV、佣金、履约率、评分 —— **不读买家个人信息**
- 关闭不影响任何我们要的数据；真需要买家详情时再开

| 应用 | 开关 | 理由 |
|---|---|---|
| Shopee Marketing | **OFF** | 联盟营销只要曝光/点击/订单/佣金统计 |
| Store Operations Brain | **OFF** | 店铺健康与履约质量是比例指标，无买家个人信息 |
| Order Analysis | **OFF** | 订单分析用的是订单量、金额、履约状态，不含买家身份信息 |

---

### 3. Other IT assets Declaration → Database Servers

**选 `IP address(es) unavailable`**

**为什么**
- 我们的 PostgreSQL 跑在 Docker 网络里（容器 IP `172.18.0.4`，网段 `172.18.0.0/16`）
- **端口没有对外映射**（`5432/tcp` 无 `→`），外部无法访问
- 应用服务也只绑 `127.0.0.1:3090`，对外只经 Cloudflare Tunnel
- 表单提示要求的 CIDR 前缀是 22–32，而我们的 `172.18.0.0/16`（前缀 16）不符合；为迁就这个填一个不准确的网段反而失实
- **数据库确实没有可供外部访问的 IP 地址**，所以选 unavailable 是如实声明

> 若 Shopee 审核要求必须填，改成在 `docker-compose.yml` 里把 PG 网络显式配成 `192.168.0.0/22`，然后填 `192.168.0.0/22`（与表单示例一致）。

---

### 4. live version URL / Test Username / Test Password

| 字段 | 填什么 |
|---|---|
| **live version of your business product's URL** | `https://analytics.hitechanalysis.top/review` |
| **Test Username of Business Product** | `shopee_review` |
| **Test Password of Business Product** | `ShopeeReview942249!Aa` |

**说明**
- `/review` 是我们系统专门为审核准备的入口，用 **HTTP Basic Auth** —— 浏览器打开会弹用户名密码框
- 审核身份在系统内是 **`Shopee Reviewer`，只读**：能看所有指标、导出 CSV，改不了任何配置
- 限定可见店铺：Netac Indonesia Official（shop 1326456001）
- 会话有效期 168 小时

---

### 5. Your client user interface screenshot（最多 3 张）

**四张现成截图在 `shopee-review-submission/` 目录**（按应用挑 3 张）：

| 文件 | 内容 | 适合哪个应用 |
|---|---|---|
| `01-overview.png` | 经营总览：GMV Rp 167,076,468、总订单 889、转化、广告占比 7.9%、库存周转 7.61 天、退款 | **三个都能用**（通用） |
| `02-shop-health.png` | 店铺健康：评分 4.87、迟发退款率 1.27%、取消率 1.06%、未履约率 2.34%、客服满意率 70% | **Store Operations Brain** |
| `03-shop-connections.png` | 店铺接口：各应用的授权与连接状态 | **三个都能用**（证明是真实接入） |
| `04-funnel.png` | 每日流量漏斗：访客、浏览、点击、订单、GMV、环比 | **Shopee Marketing** |

**推荐组合**
- **Shopee Marketing** → `04-funnel` + `01-overview` + `03-shop-connections`
- **Store Operations Brain** → `02-shop-health` + `01-overview` + `03-shop-connections`
- **Order Analysis** → `01-overview` + `03-shop-connections` + `04-funnel`

**★ 截图里能看到右上角「Shopee Reviewer」和顶部「只读分析服务正式」** —— 审核团队能明确看出这是只读审核环境 ✅

---

## 二、Brief Introduction（各应用不同，500 字符内）

### Shopee Marketing（1244910）

```
Our Shopee Marketing Dashboard is an internal analytics application used by our
e-commerce operations team to measure the Shopee affiliate marketing channel.
It reports the traffic the affiliates bring — content views, viewers, product
clicks — alongside the orders and GMV that traffic produced, the commission paid
against those orders, and the return that commission represents. Data is read
from the Shopee Open Platform affiliate marketing endpoints; performance
figures are refreshed daily, which is the platform's own cadence for them. The
application is read-only for review purposes: reviewers can inspect every
metric and export it as CSV, but cannot change any shop configuration.
```

### Store Operations Brain（1241171）

```
Our Shopee Store Operations Dashboard is an internal analytics application used
by our e-commerce operations team to monitor the health of our Shopee stores.
It reports each store's rating, its late shipment rate, its cancellation rate,
its non-fulfilment rate and its customer service satisfaction, day by day,
alongside the traffic, orders and GMV those shops produced. Figures are read
from the Shopee Open Platform account health and business insights endpoints,
with access tokens renewed automatically every four hours. The application is
read-only for review purposes: reviewers can inspect every metric and export it
as CSV, but cannot change any shop configuration.
```

### Order Analysis（1240406）

```
Our Shopee Order Analytics application is an internal analytics tool used by our
e-commerce operations team to understand how our orders come about. It reports
order counts, order value and the daily breakdown of paid, cancelled and
returned orders, and the order-level metrics behind them, alongside the
advertising and affiliate marketing figures that brought the orders in. Data is
read from the Shopee Open Platform order endpoints, with access tokens renewed
automatically every four hours. The application is read-only for review
purposes: reviewers can inspect every metric and export it as CSV, but cannot
change any shop configuration.
```

---

## 三、提交之后

**★ 表单顶部写着：「You will receive the partner_id and key of the live environment after go live is successful.」**

也就是说：
- 现在的 `1244910` / `1241171` / `1240406` 是**测试环境**的 Partner
- **审核通过后才会拿到线上环境的 partner_id 和 key**
- 拿到后填进生产的 `runtime/.env`（格式同测试的那几个）：
  ```
  SHOPEE_MARKETING_PARTNER_ID=<新的线上 id>
  SHOPEE_MARKETING_PARTNER_KEY=<新的线上 key>
  ```
- 然后在超管账号下走一遍授权：`/api/shopee-analytics/app/oauth/start?app=MARKETING&shop_id=<店铺ID>`

**★ 优先级建议**：**Shopee Marketing 第一个提交** —— 它的 `get_validation_report` 账单明细里有订单级佣金，能补上流量漏斗里目前空着的 AMS Commission / AMS ROI 两项。
