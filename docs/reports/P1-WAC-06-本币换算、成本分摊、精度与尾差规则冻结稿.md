# P1-WAC-06 本币换算、成本分摊、精度与尾差规则冻结稿

> 任务编号：P1-WAC-06
> 任务性质：**只读排查 + 规则冻结**
> 输出日期：2026-07-14
> 边界声明：本轮**零修改**。未改任何代码、数据库、DDL、接口、页面、测试数据、日志、报告或 MEMORY.md。不进入实施，不进入 P1-WAC-07。

---

## 〇、承前修正（来自 P1-WAC-05 关闭裁断，本轮起统一采用）

1. **「6 个直盘对 100% 覆盖」限定为当前业务范围**：仅指当前已确认的 USD/RMB 成本来源与 IDR/MYR/THB 目标本币组合（USD→IDR/MYR/THB、RMB→IDR/MYR/THB）。不得表述为长期或未来所有业务的覆盖承诺；未来新增原币须单独补直盘或重新裁断是否启用受控交叉。
2. **未来启用交叉汇率不得承诺「零返工」**：正确表述为「方案 A 是当前业务最小正式方案；若汇率快照、原始方向、使用方向及组成证据按规范化模型设计，未来启用交叉汇率时无需推翻核心 WAC 模型，但仍可能新增交叉路径关联、组成汇率证据、桥接币种规则、接口与测试，故仅称『可增量扩展，避免核心结构性返工』」。
3. **历史日期汇率来源是正式实施前最高阻断项**（在 P1-WAC-07 输入与实施闸门中单列）：当前 open.er-api.com 仅今日/realtime/CNY→外币倒数，无 CI 出货日、无费用付款完成日历史汇率，无成本专用 rate_type。即便补齐 6 直盘对，仍不满足已冻结锚点；必须先解决历史源、历史直盘覆盖、成本 rate_type、rate_source 留痕、自动失败人工确认、历史缺失阻断/例外，方可进入正式 WAC 实施。

---

## 一、当前代码计算事实（只读核查）

### 1.1 成本分摊路由（server.js:4742-4784，POST /api/cost-allocation/:ci_id）
- 费用归集：`ci_cost_items` 按 `cost_category`（warehouse_arrival / customs_duty / inspection_fee）求和 `payable_amount`。
- 分摊比例：`ratio = item.ci_amount / totalGoodsAmount`（**仅按货值金额**）。
- 分配：`allocatedWarehouse/Duty/Inspection = 对应费用合计 × ratio`；`productCost = ci_amount`；`totalLandingCost = 货值 + 三项费用`。
- 单位成本：`unitLandingCost = totalLandingCost / inboundQty`（无舍入，存全精度浮点）。
- `allocation_basis` **硬编码为 `'amount'`**；`currency = ci.currency`（当前全 USD）。
- **无币种换算**（确认 P1-WAC-01 缺陷仍存续）：分摊结果停留在 CI 原币（USD）。
- **无重量/体积/数量/费用类型分摊维度**；`cost_allocations` **无 warehouse 列**——分摊只到 SKU 级。

### 1.2 WAC 确认路由（server.js:4824-4897，POST /api/cost-allocation/update-weighted-avg/:ci_id）——P1-03 已验收基线
- `originalQty` 取自 `original_inventory_imports.original_qty`（REAL）。
- `unitLandingCost = alloc.unit_landing_cost_with_fees || unit_landing_cost`（CI 原币，未换算本币）。
- `oldAvgCost` 取自 `inventory.weighted_avg_cost`（只读，本路由不回写 inventory）。
- **WAC 公式**：`newAvgCost = (originalQty*oldAvgCost + inboundQty*unitLandingCost) / newQty`。
- **舍入**：`Math.round(newAvgCost * 10000) / 10000` → **固定 4 位小数，与币种无关**（server.js:4848）。
- 写入 `wac_history`（generateWacVersion，server.js:1403）：字段含 original_qty / original_avg_cost / original_inventory_value / inbound_qty / unit_landing_cost / inbound_total_cost / new_avg_cost（**全部 REAL**），**无 currency 列**——WAC 值币种隐含、不可审计。
- 多 SKU 稳定排序 `ORDER BY sku_code ASC`（P1-03-C 冻结）。

### 1.3 ERP 投影（server.js:1434-1494，refreshInventoryTotals）——P1-03-B 基线
- 取最新已确认锁定 WAC：`wac = wacRecord.new_avg_cost`（server.js:1455）。
- `inventory_value = available_qty * wac`（server.js:1476），**未对 wac 再次舍入**（直接采用新_avg_cost）。
- 文件导入路径（1316-1317）`parseFloat(item.weighted_avg_cost)` 为遗留值；P1-03-B 以最新确认 WAC 优先，文件 WAC 不主导。

### 1.4 当前去尾/舍入惯例（全代码扫描）
- 成本相关仅两处：`new_avg_cost` 4 位（4848）、已废弃函数 4 位（4170）；汇率展示 6 位（490、552）。其余 `Math.round` 均属销售/预测模块，与 WAC 无关。
- **无分摊级舍入、无总额守恒校验、无尾差吸收**。

---

## 二、当前 REAL 风险（冻结前已识别，非本轮修改）

| 编号 | 风险 | 现状证据 |
|---|---|---|
| R1 | **WAC 未换算本币** | update-weighted-avg 直接以 CI 原币（USD）算 new_avg_cost，IDR/MYR/THB 目标本币缺失 → 金额语义错误（P1-WAC-01 缺陷存续） |
| R2 | **固定 4 位小数跨币种** | IDR 4 位小数无意义、THB/MYR 通常 2 位、USD 4 位尚可；统一 4 位导致 IDR 噪声、本币精度不一致 |
| R3 | **wac_history 无 currency 列** | 锁定 WAC 的币种未知，无法审计、无法选汇率方向、无法 ERP 投影核对 |
| R4 | **分摊仅按金额** | allocation_basis 硬编码 'amount'，无重量/体积/数量/费用类型维度 |
| R5 | **同国多仓无法分摊拆分** | cost_allocations 无 warehouse 列；仓库归属仅在 WAC 写入时按 original_inventory_imports.warehouse 取行，分摊层未拆 |
| R6 | **总额不守恒** | ratio 浮点和可能 ≠ 1，逐行浮点金额求和可能偏离费用合计；无锚定校正 |
| R7 | **original_qty 为 REAL** | 数量应为整数却以浮点存储/作分母，累积浮点误差 |
| R8 | **全程 IEEE754 浮点** | 大额 IDR（千万级）× 汇率（~1e-4）× 除数量，二进制浮点表示误差累积；recompute 漂移 |

> R1–R8 为**实现缺陷/缺口**，本轮只冻结规则，不做修改。

---

## 三、各币种金额 scale（冻结）

定义每币种**金额小数位 S(ccy)**（存储与计算统一口径）：

| 币种 | 建议 S | 说明 |
|---|---|---|
| IDR | **2** | 印尼盾无流通辅币，但单位成本除法会产生小数；取 2 位以保留单位成本精度（可经业务裁断降为 0） |
| MYR | **2** | 林吉特标准 2 位 |
| THB | **2** | 泰铢标准 2 位 |
| USD | **4** | 单位成本精度需求（货值/数量常产生多位小数） |
| RMB | **4** | 与 USD 对齐 |

- **S(ccy) 可不同**（用户问题 3 答案）：IDR/MYR/THB **不强制相同 scale**，按上表各自配置；配置落 `currencies` 主数据（新增 `decimal_places` 列属后续任务，本轮不建）。
- **同一币种**的原币金额、本币金额、WAC、分摊金额、库存金额**统一用同一 S(ccy)**。
- 数量（qty）按**整数**处理，不参与 S 缩放（见 R7 修正于方案 B）。

## 四、汇率 scale（冻结）

- **源汇率存储精度**：`applied_rate` 与候选汇率统一 **8 位小数**（R 精度），以容纳 IDR→RMB ≈ 0.000377 这类极小率及倒数 ~2652 的对称精度。
- **applied_rate 已是最终采用值**（含方向/倒数/交叉，见 P1-WAC-05）：本币换算输入即 applied_rate，不再二次定方向。
- **中间换算**：`本币金额 = 源金额 × applied_rate`，在下一节规定的高精度/整数域计算，最终按 S(ccy) 舍入。

## 五、中间计算精度（冻结）

1. **换算与分摊全程保持高精度中间值，仅在最终单位成本/金额按 S(ccy) 舍入一次**。
2. **推荐整数缩放法（方案 B）**：金额以「最小单位整数」存储计算（值 × 10^S 取整），汇率以「率整数」（值 × 10^R 取整）；本币整数 = 源整数 × 率整数 ÷ 10^R，四舍五入取整。彻底规避浮点表示误差与大额溢出。
3. **禁止早舍入**：不得在分摊中间行、WAC 分子项上提前 `Math.round` 到 S；只允许最终 `new_avg_cost`、最终单位成本、最终本币金额各舍入一次。
4. **四则运算顺序固定**：先换算（源→本币）→ 再分摊 → 再求单位 → 最后 WAC；不允许先舍入再累加。

## 六、分摊顺序（冻结）

1. **币种换算先行**：对每个成本源（CI 货值 + 各费用），按 P1-WAC-05 锁定快照 applied_rate 换算为**目标本币**，得到本币货值合计与各本币费用合计。
2. **SKU 级分摊**：按「分摊依据矩阵（第七节）」将本币费用合计分配到各 SKU，得到每 SKU 本币货物成本与本币各项费用。
3. **仓库归属（同国多仓）**：若一张 CI 同国多仓库，依据 `original_inventory_imports(sku, country, warehouse)` 的仓库—数量归属，将 SKU 级本币单位成本**按仓库数量拆分**到各仓库行（仓库是 WAC 写入与快照维度，非分摊输入维度）。
4. **求单位成本**：`本币单位成本 = 本币合计 / 本币数量`（数量整数）。
5. **唯一舍入**：单位成本按 S(ccy) 舍入（一次）。
6. **总额守恒校正**：按第八、九节锚定吸收尾差。

## 七、分摊依据矩阵（冻结）

费用类型 → 分摊依据，**逐类定义，可配置，不得统一硬编码为金额**：

| 成本类型 | 默认依据 | 说明 |
|---|---|---|
| 货物成本 product_cost | **金额**（ci_amount 比例） | 业务实质为货值占比 |
| 关税 customs_duty | **金额** | 税基通常随货值 |
| 商检费 inspection_fee | **金额**（或整票均摊，由费用类型标记决定） | 若标为整票固定费，则按 SKU 数均摊 |
| 到仓/运费类 warehouse_arrival / freight | **重量优先 → 体积退补 → 金额兜底** | PL 明细已有 net_weight/cbm；优先用重量，缺失则体积，再退金额 |
| 其他费用 allocated_other | **按费用类型各自定义** | 每种费用类型独立配置依据 |

- 依据配置落主数据（费用类型→basis 映射属后续任务，本轮不建）。
- 同一张 CI 内，不同费用类型可使用不同依据（矩阵核心）。

## 八、总额守恒规则（冻结）

1. 对每个成本类型：`Σ(各 SKU 本币分配额) == 该类型本币合计`（在 S(ccy) 精度内，误差 ≤ 1 最小单位）。
2. 对每个 SKU：`本币货值 + Σ本币费用 == 本币落地总成本`。
3. 一张 CI 多 SKU：所有 SKU 落地总成本之和 == CI 本币货值 + 全部本币费用合计。
4. 守恒校验在分摊完成时执行；若不满足，进入尾差归属（第九节）校正，**不得静默丢弃差额**。

## 九、尾差归属规则（冻结）

1. 每次分摊/单位化产生的舍入尾差（≤ 1 最小单位）**集中吸收到锚定行**，不丢弃、不随机分配。
2. **锚定行选择**：同一 CI 内按稳定排序取 `sku_code` 最大（或金额最大）的 SKU 为锚（与 P1-03-C `ORDER BY sku_code ASC` 排序习惯一致，锚取末位以便可复算）。
3. 同国多仓时，仓库级尾差吸收到该 SKU 的锚定仓库（数量最大者）。
4. 尾差金额与吸收位置记入分摊证据（P1-WAC-04 的 `cost_allocation_evidence`），保证可回溯。
5. 负向（退款/冲销）尾差同样按此规则反向吸收。

## 十、WAC 公式精度（冻结）

- **公式**（在目标本币域，缩放整数实现）：
  `new_avg_cost_int = round( (original_qty × old_avg_cost_int + inbound_qty × unit_landing_cost_int) / new_qty )`
  其中各项金额均为「本币最小单位整数」（×10^S），qty 为整数。
- `old_avg_cost` 与 `unit_landing_cost` **必须均为目标本币**（R1 修正由后续实施落实，本轮只冻结语义）。
- **仅在 new_avg_cost 处按 S(ccy) 舍入一次**；分子求和保持整数全精度，禁止先舍入分子项。
- `original_inventory_value = original_qty × old_avg_cost`（本币整数）；`inbound_total_cost = inbound_qty × unit_landing_cost`（本币整数）。
- 数量 qty 以整数参与（R7 修正：后续将 original_qty 等改为整数语义，本轮不改动）。

## 十一、ERP 投影精度（冻结）

1. ERP 投影（refreshInventoryTotals）**直接采用锁定 WAC 的 `new_avg_cost` 原值**，作为目标本币值，**不允许再次舍入或再次换算**（用户问题 16 答案：不允许）。
2. `inventory_value = available_qty（整数） × new_avg_cost（本币整数）`，按 S(ccy) 计算，与 WAC 同源同精度。
3. 文件导入遗留 WAC（parseFloat）**不主导**：P1-03-B 以最新确认 WAC 优先；投影不得对文件值另做舍入后覆盖锁定值。
4. 投影只读 WAC、不改 WAC（P1-03 冻结语义延续）。

## 十二、退款、冲销后的负向金额精度（冻结）

1. 退款/冲销产生**负向本币金额**，与正向使用**同一 S(ccy)**，对称精度。
2. 冲销生成**反向相等金额**记录（金额 = −原金额，精度一致），不新建近似值。
3. 负向金额参与 WAC 时，`inbound_qty` 取负值或调整版本（版本机制属 P1-WAC-07），公式不变，精度不变。
4. 负向尾差吸收规则同第九节（反向吸收到锚定行）。

## 十三、REAL 与未来缩放整数衔接（冻结）

1. 由 REAL 迁移到缩放整数时：对每币种 `整数值 = round(REAL值 × 10^S(ccy))`，四舍五入；原 REAL 值保留于审计（不删）。
2. 汇率：`率整数 = round(REAL率 × 10^R)`。
3. 迁移为**单向投影**：旧 REAL 不变，新增整数存储列/表（属 P1-WAC-07 与实施任务，本轮不建）。
4. 迁移后计算全部走整数域；REAL 列仅作历史留存，不再参与 WAC。

## 十四、大额 IDR 溢出与浮点误差（冻结）

1. IDR 单笔可达数十亿，仍在 JS 安全整数（<2^53）内；风险来自**二进制浮点表示误差**与**连续乘除漂移**，非整数溢出。
2. 用**缩放整数**（金额×10^S、率×10^R、整数四则）彻底消除浮点误差；这是方案 B 的核心收益。
3. 即便暂用 REAL（方案 A），也须：换算后尽快按 S 舍入、WAC 仅末次舍入、避免大 IDR 与极小率反复浮点运算。

---

## 十五、方案 A / B 比较

### 方案 A —— 沿用 REAL + 固定 4 位小数（最小改动）
维持 REAL；在 WAC 阶段补币种换算；`new_avg_cost` 仍 `Math.round(x*10000)/10000`；分摊维持金额比例、无矩阵、无仓库拆分、无守恒校验。

### 方案 B —— 按币种缩放整数 + 汇率快照锁定（规范化）
金额/汇率转整数最小单位；本币换算→分摊矩阵→仓库归属→唯一舍入→总额守恒锚定；每币种独立 S；WAC 整数公式；ERP 直接采用锁定值；尾差吸收可审计。

| 维度 | 方案 A | 方案 B |
|---|---|---|
| 精度正确性 | 跨币种 4 位不合理（IDR 噪声/THB 不足） | 每币种 S 正确 |
| 浮点/溢出风险 | 高（R8） | 低（整数域） |
| 总额守恒 | 不保证（R6） | 锚定保证（八、九节） |
| 分摊维度 | 仅金额（R4） | 矩阵（七节） |
| 同国多仓 | 不支持（R5） | 仓库归属拆分（六-3） |
| 币种审计 | wac_history 无 currency（R3） | 须补 currency（实施任务） |
| 实施复杂度 | 低 | 中（需整数列/迁移，但属后续任务） |
| 与 P1-WAC-04/05 衔接 | 弱 | 强（快照/组成证据/方向一致） |
| 是否二次返工 | 未来扩币种/补审计仍要大改 | 可增量扩展，避免核心结构性返工（零头修正二） |

## 十六、推荐方案

**推荐方案 B（按币种缩放整数 + 汇率快照锁定）**，但明确：**本轮不实施**。

- 方案 B 在精度、守恒、审计、多仓、跨币种一致性上全面优于 A，且唯一能落实 R1–R8 修正与 P1-WAC-04/05 已冻结模型。
- 方案 B 所需新增列（`currencies.decimal_places`、`wac_history.currency`、整数金额列/表、费用类型→basis 映射）均属**后续实施任务**，本轮仅冻结规则、不建表不写码。
- 方案 A 仅作为过渡期最小修补参考；即便采用 A，也须先满足 P1-WAC-05 的币种换算与 P1-WAC-05 关闭裁断三的历史日期阻断。

---

## 十七、对 P1-WAC-07 的输入

1. **wac_history 证据补全**：新增 `currency` 列（记录 new_avg_cost 币种）、`rate_snapshot_id`（关联 P1-WAC-04 快照）、`applied_rate`、`rate_direction`、`is_reciprocal/is_cross`、各组成段证据；当前 wac_history 无这些列（R3）。
2. **历史版本与调整/冲销版本机制**：当前仅「确认版本」，冲销/调整版本未实现（server.js:4807 文案已承认）；P1-WAC-07 须设计 version 链（confirmed → adjustment → reversal），每版本带 S(ccy) 与快照引用，沿用不可变（A6）。
3. **精度与版本耦合**：每个 WAC 版本须固化其 S(ccy) 与换算证据，保证历史版本按当时精度可复算、不受未来 S 调整影响。
4. **历史日期汇率阻断（最高实施闸门，承前修正三）**：P1-WAC-07 设计须假设「出货日/付款日历史汇率」可能缺失，配套 P1-WAC-05 关闭裁断三的 7 项前置；在汇率源解决前，WAC 确认必须阻断，不得用 realtime/最新汇率替代历史锚点。
5. **仓库维度版本**：同国多仓时，WAC 版本须按 (sku, country, warehouse) 细分（已索引 uq_wac_history_version），分摊层补 warehouse 列后落地。
6. **缩放整数存储落地**：与第十三节衔接，定义整数列迁移与 REAL 留存策略。

---

## 十八、本轮零修改声明

- 未修改 server.js / db.js / app.js / index.html 等任何代码文件。
- 未修改数据库结构或数据；未执行任何 DDL、索引、唯一约束、列变更。
- 未修改接口、页面、测试数据、日志、报告或 MEMORY.md。
- 仅进行只读查询（`readonly:true` 连接）与临时脚本（项目目录内、运行后删除），工作库零写入。
- 未进入实施，未进入 P1-WAC-07。

**本轮到此停止。**
