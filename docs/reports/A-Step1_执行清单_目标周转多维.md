# A-Step1 执行清单：目标周转多维默认值

> 仅目标周转多维，不含销量统计周期多维。基于议题 A 方案，未改代码。

---

## 0. 范围边界

| 本步做 | 本步不做 |
|---|---|
| 目标周转（线上/线下）按 品牌/国家/仓库 命中 | 销量统计周期多维（A-Step2） |
| 移除 SKU 单独目标周转取用层 | 改 classifySkuState 口径（P4a） |
| 修复品牌默认被全局覆盖 | 改判断阈值（议题 B） |
| 迁移旧 key 到新结构 | 改 PUT × LIFECYCLE_COEFF |

---

## 1. 要改哪些文件

### server.js（4 处改 + 2 处新增 + 1 处退役）

| # | 位置 | 改什么 | 细节 |
|---|---|---|---|
| 1 | **新增**（L1585 附近） | `getDimTurnoverConfig()` | 读 system_config key=`dim_default_config`，返回 JSON 数组；空则返回 null |
| 2 | **新增**（紧随上） | `getDimTurnover(brand, country, warehouse, cfg)` | 评分命中（brand=4/country=2/warehouse=1），返回 `{online_turnover, offline_turnover}`；无规则时回退 `{3,3}` |
| 3 | `generate` L1894-1901 | 删掉读 `onlineDefault`/`offlineDefault`/`brandTargetCfg` 三行全局读取 | 改为循环顶部读一次 `const dimCfg = getDimTurnoverConfig()` |
| 4 | `generate` L2016 | `getBrandTargetMonths(sku.brand, inv.target_turnover_months, brandTargetCfg)` → `getDimTurnover(sku.brand, inv.country, inv.warehouse, dimCfg)` | 每个 SKU 用各自维度周转 |
| 5 | `generate` L2030-2033 | 删掉 `onlineDefault>0?onlineDefault:brand_target_months` 覆盖逻辑；直接 `online_target_turnover = dim.online_turnover; offline_target_turnover = dim.offline_turnover` | 品牌不再被全局覆盖 |
| 6 | `generate` L2106 | `target_months: brand_target_months` → `target_months: dim.online_turnover` | classifySkuState 用维度 online 周转（见 §3 说明） |
| 7 | `loadBrandTargetConfig` L1585 + `getBrandTargetMonths` L1595 | **退役**：不再被调用即可，函数体可留可删 | 不再参与取用 |

> **PUT 重算（L2245-2336）不改**：手动改"建议采购数量"走的是 `online/offline_target_stock` 路径（用发送来的 stock 值，不读周转），与多维周转无关。

### app.js（2 处改）

| # | 位置 | 改什么 | 细节 |
|---|---|---|---|
| 8 | `openRpParams` L3964-3997 | 线上/线下周转两个全局输入框 → **维度规则表**（见 §5） | sales_stats_days 全局下拉保留不动 |
| 9 | `saveRpParams` L3998-4015 | 保存 `dim_default_config`（周转规则 JSON）+ 仍保存全局 `sales_stats_days` | 两个 key 分开存 |

### app.js（1 处隐藏，可选）

| # | 位置 | 改什么 | 细节 |
|---|---|---|---|
| 10 | L1526 `invBatchAction('set_turnover')` 按钮 | **隐藏**（注释掉或加 style display:none） | 不再支持 SKU 单独目标周转；后端路由 L4338 保留不动（不主动调） |

### db.js

**无变更**。dim_default_config 复用 system_config 的 key-value，不加列。

---

## 2. 要改哪些配置结构

### 新增 1 个 system_config key

```
key:   dim_default_config
value: JSON 数组
```

每条规则（A-Step1 只含周转字段，stats_days 留到 A-Step2 加）：

```json
[
  {"brand":"","country":"","warehouse":"","online_turnover":4,"offline_turnover":4},
  {"brand":"Redragon","country":"","warehouse":"","online_turnover":4,"offline_turnover":4},
  {"brand":"Netac","country":"","warehouse":"","online_turnover":2,"offline_turnover":2}
]
```

- 全空规则（brand/country/warehouse 都=""）= **全局兜底**。
- 空字符串 = 通配（该维度不限制）。

### 迁移（首次启动自动执行一次）

在 server.js 启动时检查：若 `dim_default_config` 不存在，从旧 key 迁移：

| 旧 key | 迁移去向 |
|---|---|
| `online_target_turnover_default`=4 | 全空兜底行 `online_turnover` |
| `offline_target_turnover_default`=4 | 全空兜底行 `offline_turnover` |
| `brand_target_stock_months`={"Redragon":4,"Netac":2,"__default__":3} | 每个品牌 → 一条品牌级规则（online=offline=品牌值）；`__default__` 忽略（兜底已由全局默认 4 覆盖） |

迁移后写入 `dim_default_config`，旧 key 保留不删（兼容，但代码不再读）。

### ⚠️ 迁移后的行为变化（预期）

| SKU | 迁移前 target_stock 周转 | 迁移后 | 说明 |
|---|---|---|---|
| Redragon | 4（全局覆盖品牌4） | 4 | 不变 |
| Netac | **4**（全局4覆盖品牌2） | **2** | ✅ 修复：品牌2不再被覆盖 |
| 其他品牌 | 4（全局兜底） | 4（全空兜底行=4） | 不变 |

**Netac 的 target_stock / suggested_qty 会变小**（周转 4→2，目标库存减半）。这是你要的修复，但重算后需验收。

---

## 3. 命中优先级怎么落地

### 评分法（brand=4 / country=2 / warehouse=1）

```text
getDimTurnover(brand, country, warehouse, rules):
  候选 = rules 中每条字段"匹配或为空"的规则
  对每条候选评分：brand命中+4, country命中+2, warehouse命中+1
  返回最高分规则的 {online_turnover, offline_turnover}
  若无候选 → 回退 {3, 3}
```

8 种组合得分 0~7 各不相同，**永不平局**。优先级：

```
品牌+国家+仓库(7) > 品牌+国家(6) > 品牌+仓库(5) > 品牌(4)
> 国家+仓库(3) > 国家(2) > 仓库(1) > 全空兜底(0)
```

### classifySkuState 的 target_months 为什么用 online_turnover

当前 classifySkuState 收到的 `target_months` = `getBrandTargetMonths()` 返回值，**已经是品牌值**（Redragon=4、Netac=2），**不是**全局覆盖值 4。所以：

- 迁移后用 `dim.online_turnover`（Redragon=4、Netac=2）喂给 classifySkuState → **与迁移前完全一致**，零分类涟漪。
- 仅当某维度规则设了 online≠offline 时，classify 用 online 值（若需改用其他值，属议题 B 范围）。

---

## 4. 旧的全局 key 怎么处理

| 旧 key | 处理 | 代码是否还读 |
|---|---|---|
| `brand_target_stock_months` | 迁移后**退役**，保留不删 | ❌ 不再读（getBrandTargetMonths 不再被调） |
| `online_target_turnover_default` | 迁移后**退役**，保留不删 | ❌ 不再读 |
| `offline_target_turnover_default` | 迁移后**退役**，保留不删 | ❌ 不再读 |
| `target_stock_months` | 已无用，**退役** | ❌ 早已不读 |
| `sales_stats_days` | **保留**（A-Step1 仍全局） | ✅ generate 仍读 |
| `lead_time_months` | **保留** | ✅ 不动 |
| `dim_default_config` | **新增** | ✅ 新读 |

---

## 5. 当前参数设置弹窗要怎么改

### 弹窗新结构

```
┌ 预测参数设置 ──────────────────────────────────────┐
│                                                    │
│  销量统计周期：[近 90 天 ▾]   ← 保留不动（全局）     │
│                                                    │
│  ────────────────────────────────────────────      │
│  目标周转维度默认值                                  │
│  （命中优先级：品牌+国家+仓库 > 品牌+国家 > … > 兜底） │
│                                                    │
│  ┌品牌──┐ ┌国家──┐ ┌仓库──┐ ┌线上周转┐ ┌线下周转┐ ┌─┐│
│  │(通配)│ │(通配)│ │(通配)│ │   4   │ │   4   │ │锁│ ← 兜底行(不可删)│
│  │Redragon│ │(通配)│ │(通配)│ │   4   │ │   4   │ │×││
│  │Netac │ │(通配)│ │(通配)│ │   2   │ │   2   │ │×││
│  └─────┘ └─────┘ └─────┘ └──────┘ └──────┘ └─┘│
│                                                    │
│              [ + 新增规则 ]                          │
│                                                    │
│  保存后请点击「重新计算」使新参数生效。                │
│                          [取消]  [💾 保存]           │
└────────────────────────────────────────────────────┘
```

- 品牌/国家/仓库 用 `<select>`，选项从 DB DISTINCT 值 + "(通配)"。
- 兜底行（全通配）始终存在、不可删。
- 每行可删（除兜底行）、可新增。
- 销量统计周期下拉原样保留（A-Step1 不动）。

---

## 6. 改完后我在页面上会怎么操作

### 操作流程

1. 打开【销售 > 订单预测】页，点「⚙ 预测参数设置」。
2. 弹窗里看到维度规则表：兜底行（通配/通配/通配/4/4）+ Redragon 行 + Netac 行。
3. **要给"Redragon 印尼尼西亚"设线上周转 5**：
   - 点「+ 新增规则」
   - 品牌=Redragon，国家=印度尼西亚，仓库=(通配)
   - 线上周转=5，线下周转=4
   - 保存
4. 点「重新计算」→ generate 对每个 Redragon+印尼的 SKU 用周转 5（比兜底 4 高），其他国家 Redragon 仍用 4。
5. **要改 Netac 周转从 2→3**：直接改 Netac 那行的线上/线下值，保存，重新计算。
6. **要删某维度规则**：点该行 ×，保存，重新计算 → 该维度回退到更宽的规则或兜底。

### 验收要点

- 重算后 Netac SKU 的 target_stock / suggested_qty 变小（周转 4→2）。
- Redragon SKU 不变（4→4）。
- 新增的维度规则生效（如 Redragon+印尼=5 的 SKU target_stock 变大）。
- sales_status / risk_tags / shouldBlockReplenish **不变**（classify target_months 未变）。

---

## 7. 执行前备份

- 备份 `data/inventory.db`（同 P4 做法）。
- 执行后重跑 generate，产出 suggested_qty 变化清单（重点看 Netac）。

---

## 8. 不在本步范围

- 销量统计周期多维 → A-Step2
- classifySkuState 口径 4m→period → P4a
- 判断阈值配置化 → 议题 B
- PUT × LIFECYCLE_COEFF → 独立后置
