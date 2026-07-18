# 议题 B 执行方案：慢销 / 呆滞 / 高库存 / 高库龄规则配置化

> 仅方案，未改代码。基于排查报告 `排查报告_多维默认值与判断链.md`。本议题与议题 A 独立，但可复用议题 A 的多维命中机制。

---

## B1. 当前真实判断规则清单

> 位置：server.js `classifySkuState` L1694-1756 + `shouldBlockReplenish` L1680-1686。口径：**4m（avg_sales_4m）**，target = brand_target_months。

### B1.1 sales_status（互斥，按顺序先命中先返回）

| # | 状态 | 判断条件 | 阈值来源 |
|---|---|---|---|
| 1 | 清仓 | lifecycle_status = 'clearance' | lifecycle 字段 |
| 2 | 停采/停产 | lifecycle_status = 'stopped' | lifecycle 字段 |
| 3 | 新品/销售数据不足 | 未过新品保护期 | `new_product_protection_days`（skus表，默认90） |
| 4 | 无有效销售 | 已过保护期 且 历史总销量=0 | total_sales_ever |
| 5 | 缺货 | available ≤ 0 | 可用库存 |
| 6 | 缺货风险 | available>0 && avg>0 && 周转 < **0.5月** | **写死 0.5** |
| 7 | 呆滞 | 近**30天**销量=0 && available>0 && 已过保护期 | **写死 30天** |
| 8 | 慢销 | 近90天销量>0 && 周转 > target×**2** && 已过保护期 && 非缺货风险 | **写死 系数2 + 90天** |
| 9 | 正常动销 | 以上都不命中 | — |

### B1.2 risk_tags（并行，非互斥；缺货/缺货风险时抑制高库存/高库龄）

| 标签 | 判断条件 | 阈值来源 | 触发拦截 |
|---|---|---|---|
| 高库存关注 | 周转 > target×**1.5** | **写死 1.5** | ✅ |
| 高库存严重 | 周转 > target×**2** | **写死 2** | ✅ |
| 高库龄风险 | 入库超**180天** && available>0 && 周转>target×**2** | **写死 180天+2** | ✅ |
| 库龄未知 | 无入库日期 | last_inbound_date 缺失 | ❌ |
| 销量失真 | generate 追加：缺货失真检测命中 | detectStockoutDistortion | ❌ |
| 新品无销量 | generate 追加：新品且30天/90天均0销量 | **写死 30/90天** | ✅ |

### B1.3 shouldBlockReplenish（补货拦截 → suggested_qty=0）

```
拦截当且仅当：
  sales_status ∈ {清仓, 停采/停产, 无有效销售, 呆滞, 慢销}
  或 risk_tags 含 {高库存严重, 高库存关注, 高库龄风险, 新品无销量}
```

### B1.4 关键发现（写死 vs system_config）

- classifySkuState 的 **8 个阈值全部写死在代码里**，不读 system_config。
- system_config 里的 `stagnant_dead_days=180 / heavy=90 / medium=60 / light=30` 是**旧 `/api/stagnant-analysis` 接口专用**，classifySkuState **完全不读**。两套数值碰巧相同但无代码关联——在系统配置页改 stagnant 天数，统一判断层不会跟着变。

---

## B2. 哪些阈值适合配置化

### B2.1 适合（业务上不同品牌/市场确实需要不同标准）

| 阈值 | 当前写死值 | 建议可配 | 理由 |
|---|---|---|---|
| 缺货风险周转阈值 | 0.5 月 | ✅ | 交货周期长的市场可调高 |
| 呆滞判断天数 | 30 天 | ✅ | 印尼等物流慢的市场可能需 45/60 天 |
| 慢销判断天数 | 90 天 | ✅ | 同上 |
| 慢销周转系数 | ×2 | ✅ | 不同品牌销售节奏不同 |
| 高库存关注系数 | ×1.5 | ✅ | 同上 |
| 高库存严重系数 | ×2 | ✅ | 同上 |
| 高库龄天数 | 180 天 | ✅ | 海运仓 vs 本地仓差异大 |
| 高库龄周转系数 | ×2 | ✅ | 同上 |
| 新品保护期天数 | 90（skus表） | ✅ 加品牌级默认 | 不同品牌新品策略不同 |

### B2.2 配置维度

复用议题 A 的多维命中机制（品牌/国家/仓库 + 兜底），新增一个 system_config key：

```
key:   dim_threshold_config
value: JSON 数组，每条 = 一个维度的阈值集
```

```json
{
  "brand": "Redragon", "country": "", "warehouse": "",
  "stockout_risk_months": 0.5,
  "stagnant_days": 30,
  "slow_days": 90,
  "slow_turnover_coeff": 2,
  "high_stock_warn_coeff": 1.5,
  "high_stock_severe_coeff": 2,
  "high_age_days": 180,
  "high_age_turnover_coeff": 2,
  "new_product_protection_days": 90
}
```

- 全空规则 = 全局兜底阈值。
- 命中优先级与议题 A 相同（评分法 4/2/1）。
- 缺省字段回退兜底值，避免每条规则必须填全。

---

## B3. 哪些规则顺序 / 拦截逻辑不建议配置化

| 项 | 不建议配置化的理由 |
|---|---|
| **判断顺序**（生命周期→缺货→呆滞→慢销→高库存→正常） | 业务逻辑骨架，顺序错了会导致误判（如缺货时先判呆滞会误报） |
| **缺货/缺货风险时抑制高库存/高库龄** | 失真防护逻辑，去掉会导致缺货 SKU 被误判高库存 |
| **shouldBlockReplenish 拦截状态列表** | 业务安全规则，漏配会导致呆滞/慢销仍下单 |
| **shouldBlockReplenish 拦截标签列表** | 同上 |
| **生命周期系数 LIFECYCLE_COEFF** | 生命周期阶段→补货强度的业务语义映射，跨品牌不应变 |
| **各状态的 action 文案 / ai_business_advice** | 静态模板，配置化无意义 |
| **sales_status 的 9 种状态定义本身** | 状态枚举是系统契约，不应可增删 |

---

## B4. 多维配置会影响哪些函数和字段

### B4.1 server.js

| 函数 / 位置 | 影响 | 说明 |
|---|---|---|
| `classifySkuState` L1694-1756 | **核心改造**：所有写死阈值改为从入参 `thresholds` 取，不再写死 | 函数签名增加 thresholds 参数 |
| `generate` L2092-2107 | 调 classifySkuState 时传入 per-SKU 阈值（`getDimThreshold(sku.brand, inv.country, inv.warehouse)`） | 每个 SKU 用各自维度阈值 |
| `generate` L2001-2004 | sales_30d / sales_90d 的天数改为从阈值取（stagnant_days / slow_days），不再写死 30/90 | 呆滞/慢销窗口按维度 |
| 新增 `getDimThreshold(brand, country, warehouse)` | 评分命中 dim_threshold_config | 复用议题 A 的命中函数 |
| 新增 `getDimDefaultConfig()`（阈值版） | 读 dim_threshold_config JSON | — |
| `shouldBlockReplenish` L1680-1686 | **不改逻辑**，只读 sales_status/risk_tags | 拦截列表不变，但依赖的标签已按维度阈值算出 |
| `buildAiAdvice` L1622 | 不改 | 文案静态 |

### B4.2 app.js

| 位置 | 影响 |
|---|---|
| 新增"阈值配置"弹窗（或并入议题 A 的规则表，每个维度规则同时含周转+阈值） | 用户按维度设阈值 |
| 生命周期说明弹窗 L4724 附近 | 阈值数字从写死改为动态读取显示 |
| 预测参数设置弹窗的"阶段性拆分"说明 | 阈值配置化后需更新文案 |

### B4.3 db.js

| 改什么 | 原因 |
|---|---|
| `replenishment_suggestions` 可选新增 `thresholds_used TEXT`(JSON) | 记录每行 generate 时实际用的阈值快照，便于审计/排错（可选） |
| 其余无 schema 变更 | dim_threshold_config 复用 system_config |

### B4.4 字段影响汇总

| 字段 | 是否受影响 | 说明 |
|---|---|---|
| sales_status | ✅ 值可能变 | 同一 SKU 在不同阈值下可能从"呆滞"变"慢销"等 |
| risk_tags | ✅ 值可能变 | 高库存/高库龄标签的触发边界变 |
| shouldBlockReplenish 结果 | ✅ 间接受影响 | 标签变了→拦截结果可能变 |
| suggested_qty | ✅ 间接受影响 | 拦截结果变→suggested_qty 0/非0 可能翻转 |
| target_stock | ❌ 不受影响 | 由目标周转决定（议题 A） |
| avg_sales_4m / avg_sales_period | ❌ 不受影响 | 由销量统计周期决定（议题 A） |

---

## B5. 与议题 A / P4a 的关系

| 关系 | 说明 |
|---|---|
| **与议题 A** | 可复用同一套多维命中函数（getDimConfig 评分法）。可合并为一个弹窗（每条维度规则同时含 stats_days + 周转 + 阈值），也可分开两个弹窗。**待你确认合并还是分开。** |
| **与 P4a（分类层切 period）** | 议题 B 改 classifySkuState 时会动它的口径变量（avg_sales_4m）。如果 P4a 先做，classifySkuState 已切 period；如果议题 B 先做，classifySkuState 仍 4m。**建议 P4a 先于或同于议题 B 执行**，避免改两次。 |
| **与旧 stagnant_*_days** | 议题 B 落地后，建议把旧 `/api/stagnant-analysis` 也改读 dim_threshold_config，统一两套系统；或明确废弃旧接口。 |

---

## B6. 执行步骤建议（待议题 A 确认后排期）

1. **db.js**：可选加 thresholds_used 列。
2. **server.js**：
   - 新增 dim_threshold_config + getDimThreshold。
   - classifySkuState 改造：8 个阈值从入参取，缺省回退兜底。
   - generate：sales_30d/sales_90d 天数从阈值取；调 classifySkuState 传 thresholds。
   - （建议同步 P4a：classifySkuState 口径 4m→period）
3. **app.js**：阈值配置 UI（并入或独立弹窗）；生命周期说明弹窗阈值动态化。
4. **迁移**：旧 stagnant_*_days → dim_threshold_config 兜底行；或废弃旧 key。
5. **重跑 generate**，对比前后 sales_status/risk_tags 变化清单。
6. **验收**：抽样 SKU 在不同维度阈值下的状态变化是否符合预期。

---

## B7. 不在本议题范围

- 销量统计周期 / 目标周转多维 → **议题 A**
- classifySkuState 口径 4m→period → **P4a**（建议与议题 B 同批）
- PUT × LIFECYCLE_COEFF → 独立后置
- 生命周期系数配置化 → 不做（B3 已说明）
