# TikTok Shop 接入决策清单

> 编制时间：2026-10-31
> 依据：[TikTok Shop 接入评估](./tiktok-shop-integration-assessment.md)（521 行，含官方文档原文提取）
> 本清单只回答「决策什么、推荐什么、依据是什么、决定了之后动什么」，实现细节见评估文档
>
> **本轮新增实证**（2026-10-31 复核官方文档，Partner Center 文档接口 991 节点可正常读取）：
> 结论与评估文档一致，但补齐了 4 项此前未落到原文的证据，见各决策项「证据」栏。

---

## ✅ 已确认的决策（2026-11-01）

用户答复：

| # | 决策 | 确认结果 | 对原推荐的影响 |
|---|---|---|---|
| 1 | 目标区域 | **东南亚（ROW）** | ✅ 与原推荐一致，**已定案** |
| 2 | 是否覆盖付费广告 | **依赖付费广告** | ⚠️ **推翻原推荐** —— M1 必须包含 Marketing API |
| 4 | 跨平台对比口径 | **规模与盈利都要** | ✅ 与原推荐一致（两口径都落库），**已定案** |
| 3 | 映射表粒度 | 待定 | 依赖决策 4（已定）→ 可推进 |

**决策 2 的修订是本轮最重要的结论**，且它引出一个必须正视的技术事实：

> **TikTok 的 GMV Max 报表，其 `gross_revenue` / `orders` / `roi` 全部混合自然流量。**
> 官方原文：*"总收入：归因于推广系列的 TikTok Shop 订单（包括付费流量和自然流量促成的订单）"*
> *"ROI 涵盖自然流量和付费流量促成的订单"*
>
> 且已复核确认：**Open API 订单侧无任何流量来源字段**（见决策 2 的证据），
> 所以「广告直接归因的订单」在 TikTok 侧**不存在可直接取数的等价物**。
>
> → 这不是缺陷，是 TikTok 广告模型（GMV Max 信号协同）与 Shopee（Direct/Broad 拆分）**本质不同**。
> → 方案不是"退而求其次"，而是**换一套正确的算法**：见决策 2 的「双轨口径」方案。

---

## 决策 1：目标区域 —— ROW 单市场，还是 US + ROW 双 app？

### ✅ 已定案：**只做东南亚（ROW）**

### 依据（本轮新证据）

官方 App review requirements 的 `G-DUP-004` 原文：

> **Duplicate apps in the same market** | All App Review submissions, **with each target country or region and seller type (Local or Cross-border) considered separately**.

即 **（目标国家/区域 × 卖家类型）各自算一个独立 app**。US + ROW 双市场意味着双份注册、双份审核、双份 scope 申请、双份凭据维护。

更关键的是 **App review process** 的时间表：

| 审核阶段 | Public app | Custom app | Seller developer custom app |
|---|---|---|---|
| Registration review | 必需 | 更广上线时必需 | 需开发者入驻；**自有店铺通常免 marketplace 审核** |
| App design / ARD review | Partner Center 要求时 | Connector app 或 ≥25 卖家授权时 | 自有店铺通常不需 |
| App development review | 必需 | Connector app / ≥25 授权 / 被标记时 | **自有店铺通常不需** |
| Language listing review | **每个目标市场/语言都要** | 升级 public 时才需 | 自有店铺通常不需 |
| 合规/法务/数据安全审查 | 适用时必需 | 适用时必需 | 视市场与数据访问而定 |

预计耗时：注册 5 工作日 · ARD 3–5 工作日 · 开发审核 7–10 工作日 · 语言上架 **每市场 7–10 工作日**。

> 官方原话：
> *"Seller-developed custom apps that access only the developer's own shop data usually do not need app review, language listing review, or beta testing."*

### 成本对比

| | ROW 单市场 | US + ROW 双市场 |
|---|---|---|
| app 注册 | 1 | 2 |
| 语言上架审核 | 7–10 工作日 | **14–20 工作日**（串行）/ 可并行 |
| 凭据体系 | 1 套 app_key/secret | 2 套（US 走 `partner-us.tiktokshop.com` 独立门户） |
| `shop_cipher` 台账 | 单一 region_group | 需按 region 分组，**cipher 串店风险面翻倍** |
| 运营复杂度 | ×1 | ×2 |

### 但有个反向约束要先确认 ⚠️

本项目是**自用工具**（Shopee 侧只有自有店铺 + 你自己的品牌），不是给第三方卖家做的 SaaS。
如果 TikTok 侧同样是自用，则**「Seller developer custom app」路径可绕开大部分审核** —— 这会进一步支持「先做 ROW」。

**但如果 TikTok 侧要覆盖别人的店铺**（即做成给多卖家用的工具），那就要走完整审核流程，25 个卖家授权会触发 ARD 审查。

### 决定后要动什么

- **✅ 选 ROW（已定）** → M0 的凭据模型简化为单实例；`platform_instance` 抽象仍要预留 region_group 字段，但可以只实现 ROW 一条路径
- （备选）选双市场 → M0 必须先做「平台实例」抽象（`(region_group, app_key, app_secret, service_id)`），否则 M1 会被凭据逻辑拖住

### 仍待你确认（1 项）

1. **TikTok 侧是只接自有店铺，还是也要接第三方卖家？**
   - **只接自有店铺** → 走「Seller developer custom app」路径，**通常免 app review、免语言上架审核、免 beta**，
     只需完成开发者入驻 → M0 可立即用自有店铺 + Sandbox 联调
   - **接第三方卖家** → 走完整审核流程（注册 5 工作日 + 开发审核 7–10 工作日 + 语言上架每市场 7–10 工作日），
     且达 25 个卖家授权会触发 ARD 审查 → 排期需预留 3 周以上

> 已确认「东南亚市场」，所以「你的店铺主要在哪个市场 / 是否已开 US 店」不再需要回答。

---

## 决策 2：M1 是否接受不覆盖付费广告？

### ✅ 已定案：**不接受 —— M1 必须包含付费广告**

用户明确「依赖付费广告」，因此原推荐（接受缺口、M2 再补）被推翻。
以下是在这个约束下的**修订方案**。

### 修订方案的基石：先认清 TikTok 广告模型与 Shopee 的本质差异

这是整个 TikTok 接入中最容易出错、也最必须先讲清楚的一点。

| | Shopee | TikTok |
|---|---|---|
| 广告产品形态 | 普通广告，广告组为一等概念 | **GMV Max**（信号协同自动投放），无广告组，只有 campaign / item_group / item |
| 归因方式 | **Direct**（广告直接归因）+ **Broad**（全部）双口径 | **单一混合口径**：`gross_revenue` / `orders` / `roi` **全部含自然流量** |
| 归因窗口 | 平台既定 | GMV Max：**实时 + 1 天点击**；VSA/PSA：7 天点击 + 1 天浏览 |
| 归因维度 | 广告组/活动 | GMV Max：**商品维度（Product ID / SPU）**；VSA/PSA：店铺维度 |
| 订单级流量来源 | 有（Direct/Broad 字段） | **无**（见下方实证） |

**TikTok 卖家中心官方原文**（`GMV Max 指标介绍与归因说明`）：

> *GMV Max 是最新的 Shop Ads 广告解决方案。它采用基于信号协同的增强型投放，能同时利用自然流量和付费流量信号来产生增量 GMV。因此，**来自推广产品/推广直播间的所有订单都将被计作 GMV Max 订单，包括来自自然内容的订单**。*
>
> *VSA/PSA/LSA 广告会计算点击广告 7 天内或观看广告 1 天内，所产生的来自**店铺所有商品**的付费订单。*
>
> *GMV Max 广告会计算广告活动进行时，来自于**推广商品/推广直播间**的所有自然和付费订单。*

**Ads 官方帮助中心原文**：

> *总收入：归因于推广系列的 TikTok Shop 订单（**包括付费流量和自然流量促成的订单**）的总收入。*
> *ROI 涵盖自然流量和付费流量促成的订单。*

### 关键实证复核（本轮新增，2026-11-01）

我复核了 `Get Order Detail` 官方文档（document_id `6894134ba28e5204961601a5`，44517 字符）：

| 检索项 | 命中 |
|---|---|
| `traffic_source` | **0** |
| `Traffic Source` | **0** |
| `source_type` | **0** |
| `attribution` | **0** |
| `PAID_AD` / `AFFILIATE` / `ORGANIC` | **0** |
| 全部 27 个字段标识符 | 无任何渠道/广告/归因字段 |

**结论**：Seller Center 的订单详情页**确实有** Traffic Source 字段（`PAID_AD` / `AFFILIATE` / `ORGANIC_SEARCH` / `DIRECT` / `LIVE`），
但 **Open API 不暴露它** —— 只能通过 Seller Center 的 CSV 导出获取。
→ 「广告直接归因的订单」在 TikTok 侧**没有 API 等价物**。

> 这也解释了一个常见困惑：TikTok 的「直/间 conversion 拆分」在 Shop API 侧根本拿不到，
> 不是漏做，而是平台不提供。

### 可用的两条数据轨道

| 轨道 | 来源 | 口径 | 覆盖 |
|---|---|---|---|
| **轨道 A：广告效果（付费侧纯数据）** | Marketing API `report/integrated/get/` | `spend` / `impressions` / `clicks` / `conversions` / `ctr` / `cpc` —— **纯付费广告数据，不含自然流量** | 漏斗前半段（曝光→点击→转化）+ 花费 |
| **轨道 B：GMV Max 归因（含自然）** | Marketing API `gmv_max/report/get/` | `cost` / `orders` / `gross_revenue` / `roi` / `net_cost` —— **混合归因** | 花费 + 归因 GMV + ROI |

> 轨道 A 的关键价值：它提供**纯付费**的 impressions/clicks/conversions。
> 与轨道 B 的混合 GMV 放在一起，才能构造出 TikTok 侧有意义的口径（见下）。

### 推荐方案：**双轨口径 + 增量 GMV 估算**

因为业务依赖付费广告，而平台不给订单级归因，唯一正确的做法是
**不要假装能算出 `directRoas`**，而是定义 TikTok 侧自己的、可解释的口径。

#### ① 平台归因 ROI（原样保留，但明确标注）

```
roi_platform = gross_revenue / cost        // 混合自然+付费，1 天点击窗口
```
UI 上必须显示为 **「GMV Max 平台 ROI（混合归因）」**，并附口径说明。
**禁止**标成 `directRoas` 或与 Shopee 的 Direct ROAS 并排比较。

#### ② 付费侧漏斗（轨道 A，可直接对比 Shopee 的漏斗前半段）

```
ctr        = clicks / impressions
cvr        = conversions / clicks
cpc        = spend / clicks
cpa        = spend / conversions
```
这一组是**纯付费**的，与 Shopee 的付费侧指标**语义一致，可横向对比**。

#### ③ 增量 GMV 估算（TikTok 侧真正的「广告贡献」）

这是 TikTok 官方推荐的方法论，官方东南亚指南原文：

> *由于所推广商品产生的所有订单，包括来自自然内容和联盟的订单，都将计入 GMV Max。
> 基于商品 GMV Max 这种独特的 GMV 归因方式，我们建议商家**比较商品 GMV Max 使用前后的总非直播 GMV**，以确定增量 GMV。
> 然而，请勿将商品 GMV Max 的 GMV 与 VSA/PSA 的广告 GMV 进行比较，因为这两个指标的归因方式不同。*

**推荐算法（按推广商品维度）**：

```
基线非直播GMV(item, 日)  = 商品在无该广告期间的自然 GMV（可从 Analytics 商品级取）
归因GMV(item, 日)        = GMV Max gross_revenue（已含货补，需扣除货补对齐）
增量GMV(item, 日)        = 归因GMV − 基线非直播GMV      // 可能为负，表示广告挤占了自然量
增量ROAS(item, 日)       = 增量GMV / spend
```

⚠️ 这个算法有两个已知缺陷，必须在实现时处理：
1. **自然 GMV 本身会波动**（促销期后自然量下跌），所以单日增量不可靠 → **必须用 7/14 日移动基线**
2. **广告挤占自然量**时增量可能为负 → 这正是要暴露的信息，不该被抹平

#### ④ 净收益（把"盈利"和"广告"扣起来）

```
净收益 = 结算收入
       − 平台佣金
       − 达人佣金
       − 物流成本
       − 退款
       − GMV Max 广告费（= cost）
```
这一项**完全可从 Shop API 拿到**（`/finance/*` 结算流水含 GMV Max 广告费字段），
且直接回答"这一单/这个 SKU 到底赚不赚钱"。

#### ⑤ 结算净 ROAS（最保守口径）

```
结算净ROAS = 净收益 / 广告费
```
**这是唯一口径正确的"广告真回报"**，因为分子分母都来自结算流水，不受归因窗口影响。

### 修订后的 M1 范围

| 模块 | 内容 | 来源 |
|---|---|---|
| **M1-A 店铺经营** | 订单/商品/退货/优惠/结算/漏斗/SKU 结构/达人结构 | Shop Open API |
| **M1-B 广告效果** | 付费侧漏斗（spend/impressions/clicks/conversions）+ GMV Max 报表 | **Marketing API**（新增依赖） |
| **M1-C 交叉分析** | 增量 GMV 估算 + 净收益 + 结算净 ROAS | A + B 联合 |

### 新增的技术依赖与成本

| 项 | 说明 |
|---|---|
| **独立 app 凭据** | Marketing API 需**独立**的 app_id/secret，与 Shop API 凭据**完全不交集** |
| **advertiser OAuth** | `Access-Token` header，**无签名**；token **24 小时过期**，需自动刷新任务 |
| **app 审核** | Marketing API 需 TikTok for Business 账号 + app review（沙箱数小时，生产数天到数周） |
| **限流** | Reporting 类约 1 req/s per advertiser、600 req/h per app |
| **时间窗** | 带 `stat_time_day` 维度时跨度 ≤ 30 天（超限报 `max time span is 30 days`） |
| **`store_ids` 必填** | GMV Max 端点必须传 `store_ids`；`item_id` 维度须同时传 `campaign_ids` + `item_group_ids` |

### 修订后的验收标准（M1）

1. 店铺漏斗、SKU 结构、达人结构、结算净收益 → 来自 A
2. 付费侧漏斗与花费 → 来自 B（纯付费，可与 Shopee 横向对比）
3. **增量 GMV + 结算净 ROAS + 明确口径标注** → 来自 C
4. **所有涉及 GMV/ROI 的 UI 元素必须显示口径标签**（`平台混合归因` / `增量估算` / `结算自建`）

### 仍需你确认的两点

1. **是否接受 TikTok 侧用「增量 GMV 估算」代替 Shopee 的 Direct 归因？**
   （这是平台限制，没有更准的 API 路径；官方也推荐这个方法）
2. **你的 TikTok 广告是纯 GMV Max，还是同时跑 VSA/PSA？**
   → 两者**不能对同一商品同时开**（官方：GMV Max 会自动暂停 PSA），
   且**归因口径完全不同**（店铺维度 vs 商品维度），若混用必须分表存储并分别计算。

---

## 决策 3：是否需要逐文件级适配映射表？

### 推荐 ✅ **需要，但只做「分析层 + 接入层」两张表，不做逐文件全量映射**

### 依据

实测改造规模（本次复核）：

| 文件 | 行数 | 性质 |
|---|---|---|
| `src/analysis-package.js` | 531 | 平台归一化核心 |
| `src/diagnosis.js` | 270 | 诊断引擎 |
| `src/metrics.js` | 195 | 指标计算 |
| `src/source-aware-metrics.js` | 90 | 指标校验 |

分析层四件套合计 **1086 行**。`metrics.js` 导出的 10 个函数里，`normalizePerformance` / `sumPerformance` / `deriveItemShares` / `targetCpa` 是**平台无关的算法**，而字段映射（`broad_gmv` / `direct_gmv` / `direct_order` / `broad_roi` 等）是 **Shopee 专有的字段名**。

### 推荐的三层映射，而不是逐文件

**第 1 层：平台无关中间模型（先定这个，其余都依赖它）**

```js
{
  platform,              // 'shopee' | 'tiktok'
  attributionBasis,      // 见下方枚举（2026-11-01 修订）
  channel,               // 'direct' | 'broad' | 'affiliate' | 'organic' | 'unknown'
  impressions, clicks, spend, orders, units,
  gmv, aov, refunds, cancellations,
  commission, shipping,
  contentType,           // 'video' | 'live' | 'product' | null
  baselineNaturalGmv,    // TikTok 增量估算用：无该广告期间的自然 GMV 基线
  incrementalGmv,        // TikTok 增量估算用：归因 GMV − 基线 GMV
}
```

**`attributionBasis` 枚举（2026-11-01 修订，因 TikTok 广告模型而扩充）**：

| 取值 | 含义 | 用在哪 |
|---|---|---|
| `platform_attributed` | 平台归因口径（Shopee Direct/Broad；TikTok GMV Max 混合） | 平台原始指标 |
| `paid_only` | **纯付费广告数据**（TikTok `report/integrated/get/`） | TikTok 付费侧漏斗 |
| `derived_incremental` | **增量估算**（TikTok 归因 GMV − 自然基线 GMV） | TikTok 广告贡献 |
| `derived_net` | 结算自建（净收益、结算净 ROAS） | 两平台通用 |
| `order_level` | 订单级（Shopee 有 direct/broad 订单拆分） | Shopee 订单归因 |
| `unknown` | 不可知（TikTok 订单级来源） | 兜底 |

> ⚠️ 这个枚举是**防止口径混用的数据结构级保障** —— 不同 basis 的指标不允许在同一公式里相除。
> 建议在 `analysis-package.js` 的构造处加断言：basis 不同则拒绝计算。

**第 2 层：字段映射表（一张表，两个方向）**

| 中间模型字段 | Shopee 来源 | TikTok 来源 |
|---|---|---|
| `gmv` | `order_amount` | `payment.total_amount`（与 Analytics `gmv` 口径有别，见决策 4） |
| `orders` | 订单数 | 订单数；GMV Max `orders`（**混合归因**） |
| `spend` | 广告花费 | GMV Max `cost`；`report/integrated` 的 `spend`（**纯付费**） |
| `impressions` / `clicks` | 广告表现 | `report/integrated/get/` 的 `impressions` / `clicks`（**纯付费**） |
| `channel` | direct / broad 字段 | 聚合归因（**无订单级**） |
| `commission` | 结算流水 | `finance/202501/.../statement_transactions` |
| `refunds` | 退货 | `/return_refund/202602/returns/search` |
| `baselineNaturalGmv` | 不需要 | Analytics 商品级非直播 GMV（滚动 7/14 日基线） |
| `incrementalGmv` | 不需要 | 归因 GMV − `baselineNaturalGmv`（**仅 TikTok**） |

**第 3 层：改造点清单（不是逐文件，而是按「改什么/加什么/不动什么」分组）**

| 动作 | 对象 | 说明 |
|---|---|---|
| **原样复用** | `diagnosis.js` / `maturity-engine.js` / `action-engine.js` 的算法主体 | 只要输入契约统一，算法不用改 |
| **加一层** | 新建 `src/platforms/tiktok/` adapter | 负责 TikTok 原始数据 → 中间模型 |
| **加一层** | 新建 `src/platforms/tiktok/incremental-gmv.js` | 增量 GMV 估算（滚动基线 + 归因扣减） |
| **改签名** | `analysis-package.js` | 加 `platform` + `attributionBasis` + 增量字段（**向后兼容**：Shopee 侧传默认值） |
| **加约束** | `analysis-package.js` 构造处 | basis 不同则拒绝跨口径计算 |
| **不动** | `web/` UI | 只加 platform 维度筛选 + 口径标签 |
| **不动** | `token-crypto.js` / `token-repository.js` | 复用加密与存储，只加 `shop_cipher` 字段 |
| **新增独立凭据域** | `token-repository.js` | Marketing API 的 advertiser token **24h 过期**，需独立刷新调度，与 Shop API token 分开存放 |

### 为什么不做逐文件映射

Shopee 侧有 106 个 src 模块。若按「每个文件 × 每个平台」列映射表，会产出一张没人维护的巨表，
而且**真正的耦合点只有两个**：字段名映射（`metrics.js` 的 `pickMetric` 列表）和归因语义（direct/broad）。

证据支撑：本次复核中 `grep -rn "directRoas\|broadRoas" src/ web/` 结果为 **0 处** ——
说明这两个语义**没有渗漏到别处**，它们集中在 `metrics.js` 一处（195 行）。
→ **改造面比想象中小得多**，逐文件映射表是过度设计。

### 决定后要动什么

- **需要（分层版）** → 先写「平台无关中间模型」的 JS 类型定义 + 字段映射表，作为 M0 的交付物
- **不需要** → 意味着 TikTok 侧要另起一套分析引擎，M0 工期翻倍，且 Shopee 侧的修复无法惠及 TikTok

### 待你确认

1. 中间模型的字段集是否够用？特别是 `attributionBasis` 的 6 个取值（2026-11-01 新增 `paid_only` 与 `derived_incremental`）
2. 是否同意 `analysis-package.js` 加字段时**保持向后兼容**（Shopee 侧不传 platform，走默认值）？
3. 是否同意加**跨口径计算的构造期断言**？（防止 `platform_attributed` 与 `derived_net` 混用）

---

## 决策 4：GMV 口径对齐表

### ✅ 已定案：**规模与盈利都要 → 三口径分别落库 + 显式标注，禁止互相换算**

### 依据

TikTok 侧四个 GMV 概念**语义各不相同**：

| 口径 | 来源 | 含义 | 陷阱 |
|---|---|---|---|
| **订单实付** | `payment.total_amount` | 买家实付（含运费） | 含运费，与商品 GMV 不同 |
| **商品小计** | `payment.sub_total` | 货款小计 | 扣掉了运费 |
| **店铺 GMV** | Analytics `sales.gmv` | 平台统计口径 | 与订单字段**可能不等** |
| **结算收入** | Finance `revenue_amount` | 实际结算到手 | **已扣佣金/退款** |
| **GMV Max 毛利** | GMV Max `gross_revenue` | 广告归因下的口径 | **混合付费+自然+达人，1 天归因** |

> ⚠️ 评估文档原文已强调：
> *「字段映射 —— **GMV 三个口径不同，必须分别落库并标注**」*

### 推荐的定稿方案

**（1）三个口径全部落库，各自独立字段，绝不互相推导**

```sql
-- 每个事实表都带这三个字段，绝不用其中一个覆盖另一个
gmv_order_total   -- 订单实付（含运费）
gmv_subtotal      -- 货款小计（不含运费）
gmv_settled       -- 结算收入（已扣佣金与退款）
-- Analytics gmv 落在独立的 analytics 表，因其粒度是日×店铺×维度
```

**（2）跨平台对比用哪个口径（用户答复：规模与盈利都要）**

既然两个都要，就**两个都用，但各自锁定用途，绝不混用**：

| 用途 | 用哪个 | 理由 |
|---|---|---|
| **规模对比**（跨平台） | `gmv_subtotal` | 最接近 Shopee 的 `order_amount` 语义（不含运费） |
| **盈利对比**（跨平台） | `gmv_settled` | 唯一反映真实获利的口径；需同口径换算汇率后比较 |
| 广告效果评估 | GMV Max `gross_revenue` | **只能与同平台 ROI 面板比，不可跨平台** |
| 广告真实回报 | 结算净 ROAS（自建） | 分子分母同源于结算流水，不受归因窗口影响 |
| 客单价计算 | `gmv_subtotal / orders` | 分子分母同源，比例才成立 |

> ⚠️ **规模与盈利是两个数，不能合成一个"综合 GMV"。**
> 建议 UI 上**并排展示**而不是相乘/平均 —— 例如：
> ```
> 规模（商品GMV）  $12,345   跨平台可比
> 盈利（结算到手）  $ 8,930   跨平台可比（按结算日汇率折算）
> ```
> 若要算"利润率"，必须明确用 `gmv_settled / gmv_subtotal`（**同源同币种**才成立）。

**（3）Shopee 侧的对齐关系要一并确认**

Shopee 侧现有 `order_amount` 对应 TikTok 的哪个？评估文档建议 `payment.total_amount`，
但 Shopee 的 `order_amount` 是否含运费需实测确认 —— 这决定跨平台口径是否真正可比。
**建议 M1 用同一批店铺实测比对，而不是照文档假设。**

**（4）UI 上必须显示口径标签**

```
店铺 GMV        ¥12,345   (订单实付含运费)
商品 GMV        ¥11,200   (货款小计)
结算到手         ¥ 8,930   (已扣佣金/退款/物流)
```

### 决定后要动什么

- **定稿三口径** → M0 建表时就要把这三个字段加进所有事实表；事后加列需要回填，成本高
- **不先定** → M1 动工后必然要改表 + 重跑回填

### 待你确认

1. ✅ 已确认：**规模与盈利都要** → 两个口径都落库、都展示，但用途各自锁定
2. 是否同意**三个口径全部落库**（表变宽、成本增加，但避免后续改表回填）？
3. Shopee 侧 `order_amount` 是否含运费，能否实测确认？（影响跨平台可比性的前提）

---

## 决策依赖关系（2026-11-01 更新）

```
决策 1（区域）✅ 已定：只做东南亚 ROW
   └─→ M0 凭据模型简化为单实例，但保留 region_group 字段以便未来扩展

决策 4（GMV 口径）✅ 已定：规模与盈利都要 → 三口径分别落库
   └─→ 决定表结构（M0 建表前必须定稿，否则要回填）
          └─→ 决定决策 3 的中间模型字段集

决策 3（映射表）⏳ 待最终确认（推荐已给：三层，不做逐文件）
   └─→ 依赖决策 4 的字段集（已定）→ 现在可以推进

决策 2（广告边界）✅ 已定：必须覆盖付费广告 → M1 含 Marketing API
   └─→ M1 范围 = M1-A(店铺经营) + M1-B(广告效果) + M1-C(增量与净收益)
          └─→ 新增独立凭据域（advertiser token，24h 过期）
```

**当前状态**：4 项决策中 **3 项已定案**（区域、GMV 口径、广告边界），
**决策 3（映射表粒度）只剩形式确认**，可按推荐直接推进。

**M0 立即可动**（不依赖任何决策的部分见文末）。

决策 3（映射表）
   └─→ 依赖决策 4 的字段集
          └─→ 建议与决策 4 一起定，作为 M0 的两个交付物
```

**建议的定稿顺序**：决策 1 → 决策 4 → 决策 3 → 决策 2
（先定范围，再定表结构，再定映射，最后定功能边界）

---

## 附：M0 立即可动的部分（不依赖任何决策）

以下工作在上述 4 项决策之外，**现在就能开工**，且无论怎么决策都不会白做：

1. `TikTokSigner` —— HMAC-SHA256 + 双 secret 包裹 + 参数排序 + body，带官方示例向量单测
2. 通用 client 骨架 —— 429 / `36009002` 退避、`request_id` 落日志、**cursor 分页器（含异常页检测）**
3. `tiktok_raw_api_snapshots` 表 —— 对齐 `shopee_raw_api_snapshots` 结构，复用查询与回放工具
4. 凭据存储 —— 复用 `token-crypto.js`（AES-GCM + master key）与 `token-repository.js` 模式；
   **cipher 与 shop_id 必须成对存**，并在所有 shop-scoped 请求强制校验归属（防最高危的串店坑）
5. TikTok 版 `catalog.js` —— 含 per-endpoint `requiresShopCipher` flag + **固定版本号**
   （促销端点已确认版本分裂：`promotion/202309/activities` vs `promotion/202406/coupons`）

### 因决策 2 修订而新增的 M0 项

6. **平台无关中间模型定义** —— 字段集与 `attributionBasis` 六值枚举（决策 3 的第 1 层），
   这是后续所有工作的契约基础
7. **Marketing API 凭据域** —— advertiser token **24 小时过期**，需独立的刷新调度与独立的
   token 存储分区（不能与 Shop API 的 refresh token 混在一起）
8. **Marketing API client 骨架** —— 与 Shop API client 分开（`Access-Token` header、**无签名**），
   但可复用分页器、退避与原始快照落库逻辑

> 沙箱可先跑通链路，不必等审核通过 —— 但正式联调需要真实 app 凭据。
> 官方提醒：Seller developer 自用 app 通常免审核，可先用自有店铺 + Sandbox 验证签名与分页。
>
> ⚠️ **Marketing API 需 TikTok for Business 账号 + app review**（沙箱数小时，生产数天到数周），
> 且与 Shop API 凭据**完全不交集** —— 这条链路应在 M0 期间就并行启动申请，
> 不要等到 M1 动工才发现凭据没到位。
