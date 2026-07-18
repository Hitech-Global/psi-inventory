# 议题 A 执行方案：多维默认值（销量统计周期 + 目标周转）

> 仅方案，未改代码。基于排查报告 `排查报告_多维默认值与判断链.md`。

---

## A1. 目标

| 项 | 现状 | 目标 |
|---|---|---|
| 销量统计周期 | 全局单一 `sales_stats_days=90` | 按 品牌/国家/仓库 设默认 |
| 目标周转（线上/线下） | 全局覆盖品牌（Netac 配2实际用4） | 按 品牌/国家/仓库 设默认，品牌不再被全局覆盖 |
| SKU 单独目标周转 | `inventory.target_turnover_months` 字段在、取用层在但全为0 | 移除取用层，字段保留不删 |
| 行内编辑 | 只接受手动改建议采购数量 | 不变（已支持） |

---

## A2. 配置结构设计

### 新增 1 个 system_config key

```
key:   dim_default_config
value: JSON 数组，每条 = 一个维度规则
```

每条规则结构：
```json
{
  "brand": "Redragon",          // 空="" = 通配
  "country": "印度尼西亚",       // 空="" = 通配
  "warehouse": "Bekasi Warehouse", // 空="" = 通配
  "stats_days": 90,             // 60/90/120
  "online_turnover": 4,         // 线上目标周转月数
  "offline_turnover": 4         // 线下目标周转月数
}
```

- 全空规则（brand/country/warehouse 都=""）= **全局兜底**（等价于现在的 `__default__`）。
- 一条规则同时承载 stats_days + 线上/线下周转，UI 上一行编辑完。
- 不再用 `brand_target_stock_months`（品牌级 JSON）、不再用 `online/offline_target_turnover_default`（全局）、不再用全局 `sales_stats_days`——全部迁入本结构。

### 为什么用扁平数组而非嵌套 JSON

- 嵌套 JSON 强制 `品牌→国家→仓库` 层级，无法表达"脱离品牌的国家级默认"。
- 扁平数组每条独立、可任意组合维度，UI 渲染为可编辑表格最直观。
- 命中用评分法，无歧义（见 A3）。

---

## A3. 命中优先级（评分法，无平局）

对任一库存行（已知 brand+country+warehouse），从规则数组中筛选所有"字段值匹配或为空"的候选，按**评分**取最高分规则：

| 维度命中 | 权重 |
|---|---|
| brand 匹配 | +4 |
| country 匹配 | +2 |
| warehouse 匹配 | +1 |

权重 4/2/1 使 8 种组合得分 0~7 **各不相同，永不平局**。优先级顺序：

```
品牌+国家+仓库(7) > 品牌+国家(6) > 品牌+仓库(5) > 品牌(4)
> 国家+仓库(3) > 国家(2) > 仓库(1) > 全空兜底(0)
```

即品牌驱动（品牌单独 4 分 > 国家+仓库 3 分），国家优先于仓库。

> **待你确认**：这个优先级是否符合业务直觉？是否需要"仓库单独"或"国家单独"权重高于"品牌单独"？（当前设计品牌最高，因为业务是品牌驱动。）

---

## A4. 要改哪些文件 / 函数

### server.js

| 位置 | 改什么 | 原因 |
|---|---|---|
| 新增 `getDimDefaultConfig()` | 读 `dim_default_config` JSON，返回规则数组 | 替代 loadBrandTargetConfig |
| 新增 `getDimConfig(brand, country, warehouse)` | 评分命中，返回 `{stats_days, online_turnover, offline_turnover}` | 核心：每个 SKU 拿自己的参数 |
| `generate` L1894-1901 | 删掉读全局 `sales_stats_days`/`online/offline_target_turnover_default`/`brandTargetCfg`；改为循环内按 SKU 调 `getDimConfig(sku.brand, inv.country, inv.warehouse)` | 每个 SKU 用各自维度参数 |
| `generate` L2030-2033 | 删掉 `onlineDefault>0?onlineDefault:brand_target_months` 全局覆盖逻辑；直接用 `getDimConfig` 返回的 online/offline | 品牌不再被全局覆盖 |
| `getBrandTargetMonths` L1595-1604 | **整函数废弃**，由 getDimConfig 取代；移除第1层 SKU 手动检查 | 不要 SKU 单独目标周转 |
| `generate` L1974-1991 | `salesStatsDays` 从全局常量改为 per-SKU `dimCfg.stats_days`；periodStart 用该值算 | 统计周期按维度 |
| `PUT` 重算 L2245-2336 | 目标周转从 getDimConfig 取（与 generate 一致） | 手动改建议采购后重算一致 |
| `loadBrandTargetConfig` L1585 | 废弃（getDimDefaultConfig 取代） | — |

### app.js

| 位置 | 改什么 | 原因 |
|---|---|---|
| `openRpParams` L3964-3997 | 3 个全局字段 → **维度规则表编辑器**（每行：品牌/国家/仓库下拉 + stats_days + 线上/线下周转 + 删除；底部"新增规则"按钮；首行固定为全空兜底） | 真正按维度保存 |
| `saveRpParams` L3998-4015 | 序列化规则表为 `dim_default_config` JSON，POST 单 key | 替代 3 个全局 key |
| `getSalesStatsDays` L2874-2883 | 全局缓存 rpSalesStatsDays **保留为表头兜底显示**，但周转/月均数值已按 per-SKU 周期算好（存库），不受影响 | 见 A6 显示涟漪 |
| 表头 L2975/2978/2981/3202/2893 | "90天月均销量" → 泛化为"月均销量"（去掉天数）或保留全局天数作近似标签 | 见 A6 |

### db.js

| 改什么 | 原因 |
|---|---|
| `replenishment_suggestions` 新增列 `sales_stats_days_used INT` | 记录每行 generate 时实际用的统计周期，供前端按行显示（见 A6） |
| 其余无 schema 变更 | dim_default_config 复用 system_config 的 key-value |

---

## A5. 预设页面怎么改才能真正保存维度默认值

**核心改动：从"3 个全局输入框"改为"维度规则表"。**

### 弹窗新结构

```
┌ 预测参数设置 ──────────────────────────────────┐
│                                                │
│  维度默认值规则（命中优先级：品牌+国家+仓库 >    │
│  品牌+国家 > 品牌 > 国家+仓库 > 国家 > 仓库 > 兜底）│
│                                                │
│  ┌品牌┐ ┌国家┐ ┌仓库┐ ┌统计周期┐ ┌线上周转┐ ┌线下周转┐ │
│  │(空)│ │(空)│ │(空)│ │  90   │ │   4   │ │   4   │ ← 兜底行(不可删)│
│  │Redragon│ │(空)│ │(空)│ │  90   │ │   4   │ │   4   │ ×  │
│  │Netac │ │(空)│ │(空)│ │  60   │ │   2   │ │   2   │ ×  │
│  │Redragon│ │印尼│ │Bekasi│ │ 120  │ │   5   │ │   3   │ ×  │
│  └────┘ └────┘ └────┘ └──────┘ └──────┘ └──────┘    │
│                                                │
│              [ + 新增规则 ]                      │
│                                                │
│  保存后请点击「重新计算」使新参数生效。            │
│                          [取消]  [💾 保存]       │
└────────────────────────────────────────────────┘
```

- 品牌/国家/仓库 用 `<select>`（选项从各自 DISTINCT 值 + "(空=通配)"），不用手输。
- 兜底行（全空）始终存在、不可删，等价于现在的全局默认。
- 保存时整张表序列化为 `dim_default_config` 一个 key。

### 与预测页筛选的关系

**解耦**：弹窗不依赖预测页当前筛了什么。用户直接在规则表里管理各维度默认值。这样最透明——你看到的就是全部规则，不会"隐式"存成某个维度。

> 备选：如果希望"预测页筛了 Redragon+印尼 后开弹窗自动预填一行该维度"，可在打开弹窗时读预测页筛选值预填新增行。**待你确认是否要这个联动**（推荐先不做，保持解耦）。

---

## A6. 关键设计决策：统计周期多维化的显示涟漪

这是本方案最需要注意的点。当前 `rpSalesStatsDays`（全局）被 **9 处**前端引用（表头、tooltip、KPI 标签），都是"一张表一个天数"。多维化后不同 SKU 可能用不同周期（60/90/120），单一天数标签不再成立。

### 影响

| 位置 | 现状 | 多维后 |
|---|---|---|
| 月均销量数值 | 用全局周期算 | ✅ 不受影响（generate 已按 per-SKU 周期算好存库） |
| 表头"90天月均销量" | 全局天数 | 需泛化为"月均销量" |
| tooltip"近90天有效销量÷90×30" | 全局天数 | 需泛化或按行 |
| 周转数值 | 用存库 avg_sales_period | ✅ 不受影响 |
| KPI"预计周转月数" | 全局 | ✅ 不受影响（用存库值） |

### 推荐处理

1. 表头"90天月均销量" → 改为"**月均销量**"（去掉天数，因为已按各自维度周期算）。
2. 新增一列"**统计周期**"显示每行实际用的天数（从新字段 `sales_stats_days_used` 读），让用户知道这行是 60/90/120。
3. tooltip 改为"按该 SKU 维度配置的统计周期（见'统计周期'列）计算"。

### 分阶段建议

为降低风险，建议议题 A 拆两步执行：

- **A-Step1（目标周转多维）**：只把目标周转切多维（含移除 SKU 取用层、修品牌被覆盖）。统计周期暂保持全局。这一步**无显示涟漪**，改动集中在 server.js + 弹窗（周转部分）。
- **A-Step2（统计周期多维）**：再把统计周期切多维，处理表头泛化 + 新增"统计周期"列 + db 加列。

> **待你确认**：是否接受分两步？还是一步到位？

---

## A7. 旧全局 key 去留

| 旧 key | 去留 | 说明 |
|---|---|---|
| `brand_target_stock_months` | **退役**（迁移后弃用） | 迁移为 dim_default_config 的品牌级规则 |
| `online_target_turnover_default` | **退役** | 迁入全空兜底行的 online_turnover |
| `offline_target_turnover_default` | **退役** | 迁入全空兜底行的 offline_turnover |
| `sales_stats_days` | **退役**（A-Step2） | 迁入全空兜底行的 stats_days |
| `target_stock_months` | **退役**（已无用） | generate 早就不直接用 |
| `lead_time_months` | **保留** | 与本议题无关，不动 |
| `dim_default_config` | **新增** | 唯一新 key |

### 迁移脚本逻辑（首次部署时自动跑一次）

1. 读旧 `brand_target_stock_months` JSON → 生成品牌级规则（brand=品牌名，country/warehouse=空，online=offline=品牌值）。
2. 读旧 `online/offline_target_turnover_default` → 写入全空兜底行的 online/offline（若旧值为 0/空，兜底用 3）。
3. 读旧 `sales_stats_days` → 写入全空兜底行的 stats_days（默认 90）。
4. 若 dim_default_config 已存在则跳过迁移。

### ⚠️ 迁移后的行为变化（预期，非 bug）

- **Netac 目标周转从 4 → 2**（修复品牌被覆盖）：Netac 的 target_stock / suggested_qty 会变小。这是你想要的修复。
- 其余品牌（Redragon）不变（本来就是 4）。

---

## A8. 执行步骤建议

### A-Step1：目标周转多维（无显示涟漪）

1. db.js：无变更。
2. server.js：新增 getDimDefaultConfig + getDimConfig；改 generate 取周转逻辑；改 PUT 重算；废弃 getBrandTargetMonths/loadBrandTargetConfig 的取用层；移除 inventory.target_turnover_months 取用。
3. app.js：openRpParams 弹窗改为维度规则表（仅 online/offline 字段，stats_days 暂留全局下拉）；saveRpParams 存 dim_default_config。
4. 迁移脚本：旧 key → dim_default_config。
5. 重跑 generate，验证 Netac 周转变 2、Redragon 仍 4。
6. 移除/隐藏库存表的"批量设置目标周转"功能（L4338-4353 set_turnover），因为不再支持 SKU 单独目标周转。

### A-Step2：统计周期多维（有显示涟漪）

1. db.js：replenishment_suggestions 加列 sales_stats_days_used。
2. server.js：generate 按 per-SKU stats_days 算 avg_sales_period，存 sales_stats_days_used。
3. app.js：表头泛化；新增"统计周期"列；tooltip 泛化；getSalesStatsDays 降级为兜底。
4. 重跑 generate。

---

## A9. 不在本议题范围

- 慢销/呆滞/高库存/高库龄阈值配置化 → **议题 B**
- classifySkuState 口径 4m→period → **P4a**（独立）
- PUT × LIFECYCLE_COEFF 历史不一致 → 独立后置
