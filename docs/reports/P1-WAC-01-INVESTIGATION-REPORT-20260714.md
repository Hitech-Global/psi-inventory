# P1-WAC-01 加权平均成本币种换算只读排查报告

**任务编号**：P1-WAC-01
**任务名称**：《加权平均成本币种换算与汇率快照只读排查》
**日期**：2026-07-14
**性质**：只读排查 + 设计方案输出（**未修改任何代码 / 数据库 / 接口 / 页面 / 测试数据 / 报告 / 日志 / MEMORY.md**，未进入实施）
**依据**：代码静态阅读（server.js / db.js / app.js / index.html）+ 对 `data/inventory.db` 的只读查询（PRAGMA / SELECT，全部 `readonly:true`）。

---

## 〇、约束声明

- 严格遵守用户冻结口径（报告第十节引述的 1–6 条）与《成本与汇率计算规则 Final V1.0》。
- **不破坏 P1-03 已验收基线**：成本确认只生成并锁定 `wac_history`；不修改 `inventory.available_qty`/`weighted_avg_cost`/`inventory_value`；ERP 导入时才投影库存三字段。
- 本轮**不**顺带处理负数入库、DELETE-first、付款、状态机等其他问题。
- 所有"受影响"结论仅来自只读事实；任何修复方案为建议，不在本轮落地。

---

## 一、当前代码与数据库事实

### 1.1 关键表与字段币种语义（只读 PRAGMA 核实）

| 表 | 字段 | 类型 | 当前币种语义 |
|---|---|---|---|
| `commercial_invoices` | `currency` | TEXT DEFAULT 'USD' | CI 原币 |
| 同上 | `goods_amount` | REAL | CI 原币金额（货款） |
| 同上 | `country` / `target_warehouse` | TEXT | 库存所在国家 / 仓库 |
| 同上 | `wac_confirmed` / `wac_confirmed_at` / `wac_confirmed_by` | — | P1-03-C 汇总确认状态（无汇率列） |
| `ci_cost_items` | `payable_amount` / `currency` | REAL / TEXT | **每笔费用的原币**（per-item，可为 USD/IDR/…）；`include_in_landing_cost` 标记是否计入落地成本 |
| `cost_allocations` | `currency` | TEXT | 写入时取 `ci.currency`（单一标签，但底层金额可能多币种混算） |
| 同上 | `product_cost` | REAL | SKU 货款（CI 原币） |
| 同上 | `allocated_freight` / `allocated_duty` / `allocated_other` | REAL | 按金额分摊的到仓/关税/商检费（各自原币，直接求和） |
| 同上 | `total_landing_cost` / `unit_landing_cost` / `unit_landing_cost_with_fees` | REAL | **CI 原币**（无换算） |
| 同上 | `original_qty` / `original_avg_cost` | REAL | 分摊时写 0；确认时从 `inventory.weighted_avg_cost` 读取 → **本币** |
| `wac_history` | `original_avg_cost` | REAL | 本币（IDR/MYR/THB，取自库存） |
| 同上 | `unit_landing_cost` | REAL | CI 原币 |
| 同上 | `inbound_total_cost` | REAL | `inbound_qty × unit_landing_cost`（CI 原币） |
| 同上 | `new_avg_cost` | REAL | **混合值（币种未定义/错误）** |
| 同上 | `settlement_date` / `confirmed_at` / `confirmed_by` / `is_locked` | — | 确认日期/时间/人/锁定；**无任何汇率列** |
| `inventory` | `weighted_avg_cost` / `inventory_value` | REAL | 应为本币；当前被写入混合 `new_avg_cost` |
| `exchange_rates` | `from_currency`/`to_currency`/`rate`/`rate_date`/`rate_type` | — | 汇率采集表（仅 1 行：IDR→RMB, rate≈0.000377, 2026-07-05, realtime） |
| `countries` | `default_currency` | TEXT | 数据驱动的本币映射（印尼=IDR / 马来=MYR / 泰国=THB） |

### 1.2 国家/仓库 → 本币映射

- **数据驱动**，非硬编码 JS 字典：`countries.default_currency`（种子见 `db.js` 约 1645–1669：印尼→IDR / 马来→MYR / 泰国→THB）。
- 运行时通过 `GET /api/inventory/currency-rates`（server.js 约 437）读 `countries.default_currency`，辅以 `COUNTRY_ALIAS_MAP`（server.js 约 432，仅国家名别名→标准名）。
- **结论**：本币映射可得，但当前 WAC 计算路径从未用它做换算。

### 1.3 exchange_rates 表现状

- 结构（db.js 约 212–220）：`id, from_currency, to_currency, rate, rate_date, rate_type DEFAULT 'realtime', created_at`。
- 数据量：**仅 1 行**（`IDR→RMB`, rate=0.000376999999985674, rate_date=2026-07-05, rate_type=realtime）。
- 读取逻辑仅在汇率路由区（server.js 约 400–555）：`GET /api/exchange-rates`、`GET /latest`（反向查取 `1/rate`）、`GET /api/inventory/currency-rates`（按 `rate_date=today` 或 `DESC`）、`POST /refresh`（`DELETE … WHERE rate_date=? AND rate_type=?` 再插 `realtime`）。
- **关键事实**：`exchange_rates` 在 WAC/成本计算链路（`allocate` / `update-weighted-avg` / `generateWacVersion` / `refreshInventoryTotals`）中**完全未被读取**。汇率被采集缓存，但**从未用于任何币种换算**。

### 1.4 汇率快照 / 成本确认汇率字段

- **不存在** `exchange_rate_snapshot` 表（`sqlite_master` 中无 `snapshot` 表）。
- `commercial_invoices` 仅有 `wac_confirmed_at`，**无** source/target currency、rate、rate_source 列。
- `wac_history` 有 `settlement_date`/`confirmed_at`，**无**任何汇率快照/来源列。
- `cost_allocations` 仅单一 `currency`（CI 原币），**无**源/目标币种、汇率、汇率日期列。
- `inventory`/`inventory_imports` 的 `snapshot_cutoff_date` 是 ERP 导入截止日，与汇率无关。

### 1.5 成本确认所用日期

- `update-weighted-avg` 路由（server.js 约 4790）内：`const today = new Date().toISOString().split('T')[0];` → `settlement_date = today`（约 4822 / 4873）。
- `generateWacVersion` 写入 `settlement_date`、`confirmed_at = datetime('now')`（约 1423–1429）。
- **使用的日期 = 执行确认路由时的当天（成本确认日期）**，既不是 `ci.ci_date`、也不是付款日、运费付款日。
- 当前链路**不读取**付款日 / 运费付款日 / CI 日期；仅用"确认当日"。

### 1.6 P1-WAC 发生位置（代码/接口/函数）

| 阶段 | 函数 / 路由 | 文件:行 | 问题 |
|---|---|---|---|
| 费用归集求和 | `POST /api/cost-allocation/allocate/:ci_id` | server.js:4728（求和 4742–4745，INSERT 4773–4774） | 各 `ci_cost_items.payable_amount` 按原币直接求和，无换算；`currency` 统标为 `ci.currency` |
| **WAC 公式（核心缺陷）** | `POST /api/cost-allocation/update-weighted-avg/:ci_id` | server.js:**约 4844–4847** | `oldAvgCost`（本币）+ `unitLandingCost`（CI 原币）直接相加平均，无汇率读取、无换算、无币种标注 |
| 写 WAC 版本 | `generateWacVersion(params)` | server.js:约 1403 | 透传 `new_avg_cost`，无币种/汇率列 |
| ERP 库存投影 | `refreshInventoryTotals` → `latestConfirmedWac` | server.js:1435 / 1392 | 直接把混合 `new_avg_cost` 当作本币 WAC 写入 `inventory` |

### 1.7 前端入口

- 成本确认按钮：`app.js:6459`（启用条件 `cost_confirmed && cost_allocated && all_imported`）；Handler `updateWeightedAvg(ciId)`：`app.js:6474` → `POST /api/cost-allocation/update-weighted-avg/:ciId`。
- 汇率展示：无独立汇率页；库存总表头部 `#inv-rate-display` 由 `app.js:2714`(`api('/api/inventory/currency-rates')`) 注入，`app.js:2737–2754` 渲染"1¥=X Rp"，刷新 `refreshInvRates()`（`app.js:2834`→`POST /api/exchange-rates/refresh`）。`index.html` 无汇率业务字面量。
- **前端无币种换算/汇率锁定的任何 UI**。

---

## 二、当前完整金额与币种流（调用链 + 每步币种）

```
CI (commercial_invoices.currency=USD, goods_amount=USD)
  │  ci_cost_items(warehouse_arrival/customs_duty/inspection_fee, 各自 currency, include_in_landing_cost=1)
  ▼  [allocate 路由 server.js:4728]
cost_allocations:
  product_cost        = goods_amount            (CI 原币)
  allocated_freight   = Σ warehouse_arrival      (各自原币, 直接求和)
  allocated_duty      = Σ customs_duty           (各自原币, 直接求和)
  allocated_other     = Σ inspection_fee         (各自原币, 直接求和; 变量 allocated_other=0)
  total_landing_cost  = 上述求和                  (混合原币, 无换算)
  unit_landing_cost   = total_landing_cost/qty   (CI 原币标签, 实际可能多币混合)
  currency            = ci.currency              (单一标签, 掩盖混合)
  original_qty/original_avg_cost = 0             (此时未取库存)
  │
  ▼  [update-weighted-avg 路由 server.js:4790]
  读取 inventory.weighted_avg_cost → original_avg_cost  (本币 IDR/MYR/THB)
  读取 cost_allocations.unit_landing_cost(_with_fees)   (CI 原币)
  公式(约4844-4847):
     newAvgCost = (originalQty*original_avg_cost[本币] + inboundQty*unit_landing_cost[CI原币]) / newQty
  ▼  [generateWacVersion server.js:1403]
wac_history.new_avg_cost = 上式结果             (混合币种, 无标注)
  ▼  [refreshInventoryTotals server.js:1435 → latestConfirmedWac 1392]
inventory.weighted_avg_cost = wac_history.new_avg_cost   (被当作本币写入)
```

**实例证据（只读 wac_history 取样）**：
- `P103B-TEST-CI-001 / SKU-001 / Indonesia`：`original_avg_cost=60.5`（IDR 量级）、`unit_landing_cost=70`（USD 量级）、`new_avg_cost=63.6667` → 60.5(IDR) 与 70(USD) 直接平均，结果既非 IDR 也非 USD，为**币种错误值**。
- `P103B-TEST-CI-002 / Malaysia`：`original_avg_cost=65`、`unit_landing_cost=70`、`new_avg_cost=68.0769` → 同上。

---

## 三、当前错误点（汇总）

1. **核心缺陷（server.js 约 4844–4847）**：WAC 公式将库存本币历史成本与 CI 原币单位落地成本直接相加平均，**不读取 `exchange_rates`、不做任何币种换算、无货币标注**。
2. **费用归集无换算（server.js:4742–4774）**：`ci_cost_items` 各费用项按各自原币直接求和后标签为 `ci.currency`，若某费用非 CI 原币则被错误混入并误标。
3. **汇率体系孤立**：`exchange_rates` 仅被汇率路由读写，成本链路从不引用 → 汇率数据"采而不用"。
4. **无汇率锁定/快照**：成本确认时不记录、不锁定当时汇率，无法审计与历史重放。
5. **确认日期错配**：用"确认当日"而非冻结规则规定的结算锚点日期；付款日/运费付款日/CI 日期均未被区分使用。
6. **本币映射未串联**：`countries.default_currency` 已存在但 WAC 路径未消费。
7. **`new_avg_cost` 币种语义缺失**：`wac_history`/`inventory` 无 currency 列，混合值被下游当作本币使用，污染 `inventory.weighted_avg_cost`/`inventory_value`。

---

## 四、冻结规则差异矩阵

| 冻结规则要求 | 当前系统状态 | 差异 |
|---|---|---|
| WAC 统一按本国货币计算 | `new_avg_cost` 为原币与本币混合值 | ❌ 违反 |
| 人民币仅派生展示，不写库存 WAC | 合规（人民币未写入 WAC） | ✅ |
| 参与计算的金额须先换算到 SKU+国+仓本币 | 未换算，直接混算 | ❌ 违反 |
| 禁止 USD 单位成本 + IDR 原 WAC 等混算 | server.js:4844–4847 正是此混算 | ❌ 违反 |
| 汇率口径遵守 Final V1.0（结算锚点 + rate_type 锁定） | 确认用"今日"，无 rate_type 锁定，无快照 | ❌ 违反 |
| 不得把付款日/成本确认日/运费付款日混同一日 | 统一用确认当日，未区分 | ❌ 违反 |
| 汇率唯一生效键须含 rate_type | `exchange_rates.rate_type` 存在但 WAC 不传不用 | ❌ 未落实 |
| 成本确认只生成锁定 wac_history，不改性库存三字段 | 合规（P1-03-B/C 已落地） | ✅ |
| ERP 导入才投影库存三字段 | 合规 | ✅ |

---

## 五、所有受影响表 / 字段 / 接口 / 页面

**表 / 字段（读取或写入受币种问题影响）**
- `commercial_invoices`：`currency`, `goods_amount`, `country`, `target_warehouse`, `wac_confirmed*`
- `ci_cost_items`：`payable_amount`, `currency`, `include_in_landing_cost`, `cost_category`
- `cost_allocations`：全部金额字段 + `currency`（需要增加源/目标币种与汇率证据列）
- `wac_history`：`original_avg_cost`, `unit_landing_cost`, `new_avg_cost`, `inbound_total_cost`（需要增加币种与汇率快照列）
- `inventory`：`weighted_avg_cost`, `inventory_value`（被混合值污染）
- `exchange_rates`：现有表，需被 WAC 链路消费（并补充多币种/rate_type 数据）
- `countries`：`default_currency`（本币映射源，需串联）
- `logistics_batches`：`international_freight`/`customs_duty`/`vat_gst`/`other_fees`/`local_charges`/`freight_currency`（当前未被 `allocate` 读取 → 物流费用可能未进入成本，见第六节）

**接口（路由）**
- `POST /api/cost-allocation/allocate/:ci_id`（server.js:4728）— 需加换算
- `POST /api/cost-allocation/update-weighted-avg/:ci_id`（server.js:4790）— 核心修复点
- `GET /api/inventory/currency-rates`（server.js:437）— 现有，提供本币映射
- `GET/POST /api/exchange-rates*`(server.js:400–555）— 现有，需被 WAC 链路调用
- `POST /api/inventory-imports/bulk-import` → `refreshInventoryTotals`（server.js:1306/1435）— 投影已确认本币 WAC（逻辑不变，但输入须先正确）

**页面 / 前端**
- 成本确认按钮与结果（`app.js:6459` / `6474`）— 建议增加汇率锁定信息展示
- 汇率展示条（`app.js:2714` / `2737` / `2834`）— 现有，仅展示

---

## 六、重点核对：成本组成

按真实代码（`allocate` 路由 server.js:4742–4774）确认本批单位落地成本组成：

| 成本项 | 数据来源 | 当前币种 | 是否进入落地成本 | 状态 |
|---|---|---|---|---|
| CI 货款 | `commercial_invoices.goods_amount` | CI 原币 | 是（product_cost） | 原币 |
| 到仓费用 | `ci_cost_items`(warehouse_arrival) | 各自原币 | 是（allocated_freight） | 原币，**未换算** |
| 关税 | `ci_cost_items`(customs_duty) | 各自原币 | 是（allocated_duty） | 原币，**未换算** |
| 商检费 | `ci_cost_items`(inspection_fee) | 各自原币 | 是（allocated_other） | 原币，**未换算** |
| 其他本地费用 | 变量 `allocated_other=0`（server.js:4763） | — | **否**（硬编码 0） | 未计入 |
| 运费 / 清关费 / 港杂费 / 派送费 / 商检费（logistics_batches 字段） | `logistics_batches` | 各自原币 | **否**（`allocate` 不读该表） | 未进入成本分摊 |
| 抵扣（定金/尾款差异） | `should_deduct_deposit`/`actual_deducted_deposit`/`amount_difference` | — | **否** | 未在落地成本减除 |
| 定金 / 尾款 | 付款相关字段 | — | 否 | 未进入成本 |

**区分结论**：
- **原币**：`goods_amount` 与每个 `ci_cost_items.payable_amount`（各自 currency）。
- **本币**：`original_avg_cost`（取自库存）；但被直接混入公式。
- **人民币**：仅派生展示，未写入 WAC（当前合规）。
- **已换算**：**无**。
- **未换算**：`unit_landing_cost`（CI 原币→应换算未换算）。
- **可能重复计入**：若同一费用既录入 `logistics_batches` 又录入 `ci_cost_items` 且都计入 → 重复（当前 `allocate` 只读 `ci_cost_items`，暂无重复，但数据录入侧无防重）。
- **当前根本未进入成本分摊**：`logistics_batches` 全部费用项、抵扣/定金/尾款差异、`allocated_other`（硬编码 0）。

---

## 七、重点核对：汇率规则具备性（对照 Final V1.0）

| 要求字段 | 当前是否具备 | 缺在哪 |
|---|---|---|
| source_currency | ❌ | `wac_history`/`cost_allocations` 无；`exchange_rates` 有 from_currency 但确认时不记录 |
| target_currency | ❌ | 同上 |
| rate_type | ⚠️ 部分 | `exchange_rates.rate_type` 存在（默认 realtime），但 WAC 确认不传、不锁定 |
| rate_date | ⚠️ 部分 | `exchange_rates.rate_date` 存在，但 WAC 用"今日"而非查 rate_date |
| exchange_rate | ❌ | `wac_history` 无汇率值列 |
| rate_source | ❌ | 无 |
| snapshot_id | ❌ | 无 `exchange_rate_snapshot` 表 |
| confirmed_at | ⚠️ | `wac_history.confirmed_at` 存在（是确认时间，非汇率锁定） |
| confirmed_by | ⚠️ | `wac_history.confirmed_by` 存在 |
| 是否锁定 | ⚠️ | `wac_history.is_locked` 锁定 WAC 版本本身；汇率维度无锁定 |
| 是否允许后续覆盖 | ❌ | 汇率根本未存，无覆盖控制；`exchange_rates` 可被 `/refresh` 覆盖 |
| 历史重放与审计 | ❌ | 无快照，无法按当时汇率重放/审计 |

---

## 八、必须回答的业务问题

1. **CI 为 USD、库存在印尼（IDR）**：当前直接把 USD 单位成本加进 IDR 历史成本（错误）。正确做法：用冻结规则结算锚点日期的 `USD→IDR` 汇率（从 `exchange_rates`，`rate_type` 如 `settlement`）换算货款与费用为本币，再算 WAC；汇率在确认时锁定入 `wac_history`。当前系统**无此能力**。
2. **CI 为 RMB、库存在马来（MYR）**：当前无换算。推荐：**优先直接 `RMB→MYR`**（若 `exchange_rates` 有该直盘）；否则交叉 `RMB→USD→MYR`。当前两者都不支持（完全无换算）。需新增直盘/交叉汇率解析与对应 `rate_type`。
3. **运费 USD + 本地费用 IDR**：两者都须→IDR 落地成本；应**各自按自身冻结日期换算**（运费→运费付款日，本地费→费用确认日），每笔费用独立汇率快照。当前直接相加（USD+IDR 混算）。
4. **一张 CI 含多 SKU / 多仓库 / 多国**：当前 `original_inventory_imports` 按 SKU 带 `country`，WAC 按 `sku+country+warehouse` 计算 → **CI 可跨国家**。换算必须**按目标国家本币分别换算**，不能按 CI 统一。当前不换算。是否允许跨国家：当前**允许且无校验**；若业务要求单 CI 单国，应在 `original_inventory_imports`/CI 层加校验（可选，不影响换算本身须 per-target-country）。
5. **wac_history 是否增加汇率证据列**：**建议增加** `source_currency`、`local_currency`、`source_unit_cost`、`local_unit_cost`、`exchange_rate`、`rate_type`、`rate_date`、`rate_source`、`exchange_rate_snapshot_id`。**必要性**：防止混合值被误读、支持审计与历史重放、隔离"当时汇率"与"当前汇率"。**最小方案**：仅新增这些列（NULL 兼容旧行），确认时填充，**不回填历史行**、不改既有 `new_avg_cost` 数值。本轮**不直接决定新增**，先说明必要性与最小方案供用户裁断。

---

## 九、历史数据处理边界

- **新确认的 CI**：使用新汇率快照（确认时锁定汇率），按目标本币换算后生成 `wac_history`。
- **已有 `wac_history`**：**保持原样**，不重算、不覆盖；可仅在展示层标注"汇率口径未确认"（不改值）。
- **历史 CI**：**禁止**本轮自动回填 / 自动重算 / 覆盖既有 WAC。
- **P103B / P103C 测试数据**：不修改、不清理、不作为正式业务正确金额的验收证据（其 `new_avg_cost` 为已知混合值，仅证明缺陷存在）。

---

## 十、两个可选实施方案

### 方案 A：严格最小修复

- **范围**：仅在 `update-weighted-avg` 公式（server.js:4844–4847）加入最小换算——读 `cost_allocations.currency`（源）与 `countries.default_currency(country)`（目标），按确认日（或 CI 日期）从 `exchange_rates` 取 `rate_type` 汇率换算 `unit_landing_cost` 为本币后再代入公式。
- **不新增**复杂汇率快照体系；`wac_history` 可加极少列（`exchange_rate`, `rate_type`, `rate_date`）留痕，或完全不加（纯函数内换算）。
- **新 WAC 记录汇率事实**：若加 3 列则留痕；若不加则无审计痕迹。
- **审计与历史追踪风险**：汇率**未锁定**，若 `exchange_rates` 被 `/refresh` 覆盖，重算会不一致；无 per-fee 快照；无法历史重放。
- **后续是否必然返工**：**是**——当需 per-fee 汇率、交叉汇率、审计时必升到方案 B。

### 方案 B：最小完整闭环

- **新增** `exchange_rate_snapshot`（id, source_currency, target_currency, rate, rate_date, rate_type, rate_source, confirmed_at, confirmed_by, is_locked）或等价列。
- **每次成本确认**为 CI 各费用项（或整体）在确认时锁定汇率快照（按 Final V1.0 结算锚点 + `rate_type`），写入 `wac_history` 汇率证据列（第八节 5 所列）。
- **每笔费用按自身冻结日期换算**（运费→运费付款日等）。
- **WAC 统一本币**；`wac_history.new_avg_cost` 明确为本币。
- **ERP 导入只读已确认本币 WAC**（现有 `refreshInventoryTotals` 逻辑不变，输入已正确）。
- **历史版本不可覆盖**（`is_locked` + P1-03-C 触发器）。

### 比较矩阵

| 维度 | 方案 A | 方案 B |
|---|---|---|
| DB 变更 | 极小（最多 wac_history +3 列） | 中（新增快照表 + wac_history 汇率列） |
| 代码改动范围 | 小（仅公式 + 取汇率） | 中（快照生成/锁定 + 每费换算 + 前端展示） |
| 数据迁移风险 | 低（无历史改写） | 低（新列 NULL 兼容，不回填） |
| 对 P1-03 影响 | 无（仍只写 wac_history） | 无（仍只写 wac_history，仅增列） |
| 对成本/汇率页影响 | 几乎无 | 中（汇率锁定信息展示） |
| 回滚难度 | 易 | 易（新增结构可 DROP） |
| 审计能力 | 弱（汇率未锁定） | 强（快照+证据列） |
| 是否二次返工 | **必然** | **否** |

### 推荐方案

**推荐方案 B（最小完整闭环）**。理由：P1-WAC 本质是汇率口径治理问题；方案 A 的"汇率未锁定"与《成本汇率 Final V1.0》"汇率快照确认时锁定"及 SYS-E2E-02 直接冲突，且必然二次返工。若坚持最小止血，方案 A 仅可作临时过渡，但须明确标注"汇率未锁定、审计缺口"。

### 实施任务拆分（方案 B 草案，待批准）

1. 设计 `exchange_rate_snapshot` 表与 `wac_history` 汇率证据列（DDL + 迁移，严格幂等）。
2. 实现汇率解析服务：支持直盘 + 交叉（RMB→USD→MYR），按 `rate_type` + `rate_date` 取率，缺失/为 0/币种错抛错。
3. `allocate` 路由：按每笔 `ci_cost_items` 原币→目标本币换算后分摊（替换当前直接求和）。
4. `update-weighted-avg` 公式：源币→目标本币换算后计算；确认时锁定汇率快照并写入 `wac_history` 证据列。
5. 确认日期策略：按 Final V1.0 结算锚点（非"今日"），区分 CI/付款/运费付款日。
6. 前端：成本确认展示锁定的汇率与快照 ID；汇率页补充 `rate_type` 维度。
7. 回归 + 针对性测试（见下）。

### 针对性测试建议

- 多币种 CI：USD 货款 + IDR 库存 → 验证 new_avg_cost 为本币且数值合理。
- RMB→MYR 交叉：验证直盘优先、无直盘走交叉，结果一致。
- 运费 USD + 本地费 IDR：分别按各自冻结日期换算，不串币。
- 跨国家 CI：每目标国分别换算，不按 CI 统一。
- 汇率缺失 / 汇率为 0 / 错误币种 / 错误日期 / `rate_type` 错误：均抛错而非静默误算。
- 汇率被后续 `/refresh` 覆盖：已锁定快照不受影响（历史重放一致）。
- 费用重复换算 / 同一费用多次进入成本：防重校验。
- 不同国家成本串仓：按 `sku+country+warehouse` 隔离。
- 历史版本不被重算：既有 `wac_history` 原样保留。
- 浮点误差：大额金额用整数分位或定点，避免 REAL 累积误差。
- P103B/P103C 测试数据：不修改、不清理、不作为正确金额证据。

---

## 十一、风险与优先级

| # | 风险 | 当前状态 | 优先级 |
|---|---|---|---|
| 1 | 汇率缺失 | `exchange_rates` 仅 1 行，绝大多数币种对无数据 | 高 |
| 2 | 汇率为 0 | 无防护，0 率会导致成本归零 | 高 |
| 3 | 错误币种 | `cost_allocations.currency` 单一标签掩盖混合 | 高 |
| 4 | 错误日期 | 用"今日"而非结算锚点 | 高 |
| 5 | rate_type 错误 | WAC 不传 rate_type，默认 realtime 不适用成本 | 高 |
| 6 | 汇率被后续覆盖 | `/refresh` 可覆盖，无锁定 | 高 |
| 7 | 费用重复换算 | 录入侧无防重 | 中 |
| 8 | 同一费用多次进入成本 | `allocate` 清旧重算，但录入可重复 | 中 |
| 9 | 不同国家成本串仓 | 当前按 sku+国+仓隔离（OK），但换算缺失致值错 | 高 |
| 10 | 历史版本被重算 | `is_locked`+触发器已防护（OK） | 低 |
| 11 | 大额浮点误差 | REAL 类型，大额累计误差 | 中 |
| 12 | REAL 与未来缩放整数冲突 | 未来若改整数分位，当前 REAL 值需迁移 | 中 |

---

## 十二、本轮输出清单（对应要求 1–11）

1. **当前代码与数据库事实** — 见第一、五节（表结构、币种语义、exchange_rates、无快照、确认日期）。
2. **当前完整金额与币种流** — 见第二节（调用链 + 每步币种 + wac_history 实证）。
3. **当前错误点** — 见第三节（7 项，核心 server.js:4844–4847）。
4. **冻结规则差异矩阵** — 见第四节。
5. **所有受影响表/字段/接口/页面** — 见第五节。
6. **汇率日期与 rate_type 现状** — 见 1.3 / 1.5 / 第七节（有列但 WAC 不用；确认用"今日"）。
7. **两个可选实施方案** — 见第十节（方案 A / B + 比较矩阵）。
8. **推荐方案** — 见第十节（推荐 B；A 仅作临时过渡）。
9. **实施任务拆分** — 见第十节（7 步草案）。
10. **针对性测试建议** — 见第十节（12 类测试）。
11. **明确本轮未修改任何内容** — 见下文。

### 明确声明

**本轮为只读排查**：未修改任何代码（`server.js`/`db.js`/`app.js`/`index.html` 零改动）、未修改数据库（含 `exchange_rates`/`wac_history`/`cost_allocations`/`inventory` 零写入）、未修改接口、未修改页面、未修改测试数据（P103B/P103C 零改动零清理）、未清理或恢复数据库、未修改报告/日志/MEMORY.md、未进入正式实施、未顺带处理其他问题。所有结论基于静态代码阅读与对 `data/inventory.db` 的只读查询。下一步待用户裁断方案 A/B 并下发实施指令。

---

*报告完。P1-WAC-01 只读排查结束，停止。*
