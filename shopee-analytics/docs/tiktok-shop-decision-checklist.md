# TikTok Shop 接入决策清单

> 编制时间：2026-10-31
> 依据：[TikTok Shop 接入评估](./tiktok-shop-integration-assessment.md)（521 行，含官方文档原文提取）
> 本清单只回答「决策什么、推荐什么、依据是什么、决定了之后动什么」，实现细节见评估文档
>
> **本轮新增实证**（2026-10-31 复核官方文档，Partner Center 文档接口 991 节点可正常读取）：
> 结论与评估文档一致，但补齐了 4 项此前未落到原文的证据，见各决策项「证据」栏。

---

## 决策 1：目标区域 —— ROW 单市场，还是 US + ROW 双 app？

### 推荐 ✅ **先只做 ROW（东南亚），US 延后到 M2 之后**

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

- **选 ROW** → M0 的凭据模型简化为单实例；`platform_instance` 抽象仍要预留 region_group 字段，但可以只实现 ROW 一条路径
- **选双市场** → M0 必须先做「平台实例」抽象（`(region_group, app_key, app_secret, service_id)`），否则 M1 会被凭据逻辑拖住

### 待你确认

1. TikTok 侧是**只接自有店铺**，还是也要**接第三方卖家**？
   （前者 → 自用路径，审核成本骤降；后者 → 完整审核流程）
2. 你的 TikTok 店铺主要在**哪个市场**？已开 US 店铺吗？
3. 如果两边都有，是否接受**先用 ROW 跑通链路、US 在 M2 阶段并行申请**？

---

## 决策 2：M1 是否接受不覆盖付费广告？

### 推荐 ✅ **接受，但把「净 ROAS 自建」写进 M1 验收标准**

### 依据

评估文档第 7 节已确认（官方端点枚举结论）：

- **TikTok Shop Open API 无广告投放/广告效果端点** —— 365 个 API 页里没有 spend / ROAS / impression / click 端点
- GMV Max 报表在**独立的 Marketing API**（`api.tiktok.com`），需要**独立的 app_id/secret + advertiser OAuth token**（`Access-Token` header，不签名），与 Shop API 凭据**完全无交集**
- GMV Max ROI 是 **付费 + 自然 + 达人混合归因，1 天窗口** —— 与 Shopee 的 Direct/Broad 语义不同
- Ads Manager 的 7 天点击/1 天浏览归因 ≠ Seller Center GMV Max 面板的 1 天归因 → **两个后台数字永远对不上**

Shop API 侧唯一沾边的：`/finance/*` 结算流水里有 **GMV Max 广告费字段**（`gmv_max_ad_fee_amount` 等，订单级），Analytics 有 advertised 相关指标 —— 可用于**交叉校验**，但不是广告报表。

### 「接受」的代价，必须诚实说清

| 链路环节 | M1 能做吗 | 缺口 |
|---|---|---|
| 成熟度 / 漏斗 / SKU 结构 / A/B/C 分级 / 动作建议 | ✅ | — |
| 达人渠道结构 | ✅（`/affiliate_seller/*`） | — |
| **ROAS vs 盈亏平衡** | ❌ | 缺 spend 侧的**归因口径正确的**花费 |
| **广告组优先诊断** | ❌ | GMV Max 无「广告组」概念，只有 campaign/item_group/item |

### 推荐的具体做法

**不要**在 M1 用「结算流水里的 GMV Max 广告费」反推 ROAS 然后标成 `directRoas` —— 那会把「混合归因下的花费」和「Shopee 语义的 direct 归因 GMV」混为一谈，诊断结论会误导。

**改为**：
1. M1 产出「**净收益**」而不是 ROAS：
   ```
   净收益 = 结算收入 − 平台佣金 − 达人佣金 − 物流 − 退款 − GMV Max 广告费
   ```
   这是**真实到手**，比 ROAS 更有经营意义，且完全可从 Shop API 拿到
2. 若要投喂已有的盈亏平衡计算，用**净收益 / 广告费**这个明确标注口径的「自建净 ROAS」，并在 UI 上写明：
   > 净 ROAS（自建口径）= 结算净收益 ÷ GMV Max 广告费
   > ⚠️ 广告费为混合归因下的分摊值，与平台 ROI 面板不可直接对比
3. 在分析包里给每个指标打 `attribution_basis` 标签（`platform_attributed` / `derived_net` / `order_level`），
   **从数据结构上防止两种口径被混用**

### 决定后要动什么

- **接受** → M1 范围锁定，验收标准改为「漏斗 + SKU 结构 + 达人结构 + 结算净收益」四项；M2 单独立项做 Marketing API
- **不接受** → M1 必须包含 Marketing API，M1 工期至少翻倍，且要额外申请 advertiser 侧凭据

### 待你确认

1. 你的 TikTok 业务**是否依赖付费广告**？如果广告占 GMV 比例高，不覆盖广告的分析价值会大打折扣
2. 你能接受第一版**没有 ROAS**吗？还是必须要有？
3. 是否愿意在 M1 就把「自建净 ROAS」的口径说明写进 UI（而不是等 M2 补上）？

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
  attributionBasis,      // 'platform_attributed' | 'derived_net' | 'order_level'
  channel,               // 'direct' | 'broad' | 'affiliate' | 'organic' | 'unknown'
  impressions, clicks, spend, orders, units,
  gmv, aov, refunds, cancellations,
  commission, shipping,
  contentType,           // 'video' | 'live' | 'product' | null
}
```

**第 2 层：字段映射表（一张表，两个方向）**

| 中间模型字段 | Shopee 来源 | TikTok 来源 |
|---|---|---|
| `gmv` | `order_amount` | `payment.total_amount`（注意与 Analytics `gmv` 的口径差异，见决策 4） |
| `orders` | 订单数 | 订单数 |
| `spend` | 广告花费 | GMV Max `cost`（**M2 才有**） |
| `channel` | direct / broad 字段 | 聚合归因（无订单级） |
| `commission` | 结算流水 | `finance/202501/.../statement_transactions` |
| `refunds` | 退货 | `/return_refund/202602/returns/search` |

**第 3 层：改造点清单（不是逐文件，而是按「改什么/加什么/不动什么」分组）**

| 动作 | 对象 | 说明 |
|---|---|---|
| **原样复用** | `diagnosis.js` / `maturity-engine.js` / `action-engine.js` 的算法主体 | 只要输入契约统一，算法不用改 |
| **加一层** | 新建 `src/platforms/tiktok/` adapter | 负责 TikTok 原始数据 → 中间模型 |
| **改签名** | `analysis-package.js` | 加 `platform` + `attributionBasis` 字段（**向后兼容**：Shopee 侧传默认值） |
| **不动** | `web/` UI | 只加一个 platform 维度筛选 |
| **不动** | `token-crypto.js` / `token-repository.js` | 复用加密与存储，只加 `shop_cipher` 字段 |

### 为什么不做逐文件映射

Shopee 侧有 106 个 src 模块。若按「每个文件 × 每个平台」列映射表，会产出一张没人维护的巨表，
而且**真正的耦合点只有两个**：字段名映射（`metrics.js` 的 `pickMetric` 列表）和归因语义（direct/broad）。

证据支撑：本次复核中 `grep -rn "directRoas\|broadRoas" src/ web/` 结果为 **0 处** ——
说明这两个语义**没有渗漏到别处**，它们集中在 `metrics.js` 一处（195 行）。
→ **改造面比想象中小得多**，逐文件映射表是过度设计。

### 决定后要动什么

- **需要（分层版）** → 先写「平台无关中间模型」的 TS/JS 类型定义 + 字段映射表，作为 M0 的交付物
- **不需要** → 意味着 TikTok 侧要另起一套分析引擎，M0 工期翻倍，且 Shopee 侧的修复无法惠及 TikTok

### 待你确认

1. 中间模型的字段集是否够用？特别是 `attributionBasis` 与 `channel` 两个枚举的取值
2. 是否同意 `analysis-package.js` 加字段时**保持向后兼容**（Shopee 侧不传 platform，走默认值）？
3. `channel` 枚举要不要加 `unknown` 兜底？（TikTok 无订单级来源时必须能表达「不可知」）

---

## 决策 4：GMV 口径对齐表

### 推荐 ✅ **必须在 M1 动工前定稿，且必须「三口径分别落库 + 显式标注」，禁止互相换算**

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

**（2）跨平台对比只用一个「可比口径」，并明确标注**

| 用途 | 用哪个 | 理由 |
|---|---|---|
| 跨平台店铺规模对比 | `gmv_subtotal` | 最接近 Shopee 的 `order_amount` 语义（不含运费） |
| 单店真实到手能力 | `gmv_settled` | 唯一反映真实获利的口径 |
| 广告效果评估 | GMV Max `gross_revenue` | 只能与同平台 ROI 面板比，不可跨平台 |
| 客单价计算 | `gmv_subtotal / orders` | 分子分母同源，比例才成立 |

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

1. 跨平台对比你主要想看**哪个口径**？（规模对比 → `gmv_subtotal`；盈利 → `gmv_settled`）
2. 是否同意**三个口径全部落库**（表变宽、成本增加，但避免后续改表回填）？
3. Shopee 侧 `order_amount` 是否含运费，能否实测确认？（影响跨平台可比性的前提）

---

## 决策依赖关系

```
决策 1（区域）
   └─→ 决定 M0 凭据模型复杂度（单实例 vs 平台实例抽象）
          └─→ 影响 M0 工期与 M1 能否按期

决策 4（GMV 口径）  ←─ 必须在 M0 建表前定，否则要回填
   └─→ 决定表结构
          └─→ 影响决策 3 的中间模型字段集

决策 2（是否覆盖广告）
   └─→ 决定 M1 范围与验收标准
          └─→ 依赖决策 1 的市场（US 才有 SPS 官方诊断可交叉校验）

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

> 沙箱可先跑通链路，不必等审核通过 —— 但正式联调需要真实 app 凭据。
> 官方提醒：Seller developer 自用 app 通常免审核，可先用自有店铺 + Sandbox 验证签名与分页。
