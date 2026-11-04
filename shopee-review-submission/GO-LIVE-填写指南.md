# Shopee 开放平台 Go Live 表单 · 逐字段填写指南

> 适用于三个待上线的应用：**Shopee Marketing (1244910)**、**Store Operations Brain (1241171)**、**Order Analysis (1240406)**
> 应用入口：`App List → 点进应用 → Go Live`

---

## 速查：可以照抄的值

| 表单字段 | 照抄这个 |
|---|---|
| **Test Redirect URL Domain** | `https://analytics.hitechanalysis.top/` |
| **Live Redirect URL Domain** | `https://analytics.hitechanalysis.top/` |
| **Does this App require buyer PII access?** | **关闭（OFF）** |
| **Database Servers** | 保持 `IP address(es) available`，填 `192.168.100.0/22` |
| **Other Servers** | 同样填 `192.168.100.0/22` |
| **live version of your business product's URL** | `https://analytics.hitechanalysis.top/review` |
| **Test Username of Business Product** | `shopee_review` |
| **Test Password of Business Product** | `ShopeeReview942249!Aa` |
| **Brief Introduction** | 见下方「三、各应用不同的简介」 |
| **Your client user interface screenshot** | 3 张，见下方「四、截图」 |

---

## 一、三个应用共用的字段

### 1. Test / Live Redirect URL Domain

**两个框都填同一个值 —— 只填「域名」，不带回调路径：**

```
https://analytics.hitechanalysis.top/
```

**★ 关键：这个框要的是域名，不是完整的回调地址**
- 提示写的是「The **domain** of the redirect_url … should be consistent with this domain」
- 校验的报错也是「please fill in a **valid domain** starting with https://」
- **填完整回调路径会被判为无效**（实测：`https://analytics.hitechanalysis.top/api/shopee-analytics/app/oauth/callback` → 报 Invalid）

**★ Live 那个框不要填 `/review`**
- `/review` 是给 Shopee 审核团队登录看界面的入口，用 Basic Auth
- **OAuth 回调走的是** `https://analytics.hitechanalysis.top/api/shopee-analytics/app/oauth/callback`
- 两者域名相同，所以声明只写域名就够 —— 路径由我们自己的系统决定

**★ 末尾要带斜杠**：Shopee 自己已上线应用的声明就是这个写法（如 `https://www.hitechasia.top/`）

**★ Order Analysis 现在的声明是 `ai-shop-analyzer-frontend.onrender.com`** → **必须改成上面这个**，否则回调会打到别人的服务上

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

### 3. Other IT assets Declaration → Database Servers / Other Servers

**两个框都保持默认的 `IP address(es) available`，各填同一行：**

```
192.168.100.0/22
```

**为什么这样填**
- 数据库和应用容器都跑在 Docker 网络里，容器 IP 是 `192.168.100.2`
- 这个 IP 是动态的（容器重建就变），所以填**网段**而不是单个 IP
- 表单要求 **CIDR 前缀 /22 到 /32** —— `192.168.100.0/22` 前缀正好是 22 ✅
- **★ 为什么不是 `172.18.0.0/22`**：原来 Docker 用默认的 `172.18.0.0/16`，
  但那个网段**填进去会被判 Invalid**（前缀 16 超出范围，且不是表单示例的段）。
  所以我们**把容器网络真的改成了 `192.168.100.0/22`** —— 这样填的既准确又能通过校验。
  （避开了 `192.168.0.0/22` 那段，因为办公室路由器常用 192.168.0.x，会撞车）
- 数据库**端口没有对外映射**（`5432/tcp` 无 `→`），应用也只绑 `127.0.0.1:3090`，
  对外只经 Cloudflare Tunnel —— 填网段而不是精确 IP，是保守而如实的说法

**★ 一行就够**（每行一个网段/地址，最多 3 个动态网段）

**★ 如果这一行还是被判 Invalid**：换 `192.168.0.0/22`（表单示例值）试一次 —— 那说明它只认示例那个段，
我们就再把容器网络改成 `192.168.0.0/22`（需先确认办公室路由器不是那个段）。

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
