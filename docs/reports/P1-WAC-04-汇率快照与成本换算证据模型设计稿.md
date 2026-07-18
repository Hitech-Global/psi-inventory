# P1-WAC-04 汇率快照与成本换算证据模型设计稿

> **本轮性质**：只读排查 + 数据模型设计 + 方案比较。
> **零修改声明**：本文档为设计稿，**未执行任何 DDL、未修改代码/数据库/接口/页面/测试数据、未编写或执行迁移脚本、未修改日志/原报告/MEMORY.md、未进入实施或下一任务**。所有字段以下以"候选语义"描述，非可执行建表语句。
> **权威输入版本**：以用户提供的 P1-WAC-04 任务书"一、最新权威冻结输入（1–11）"为准，并叠加 P1-WAC-03-R1 及后续三项补充裁断（CI 出货日、同币种 rate=1、分次付款、未全付款阻断）。

---

## 1. 已冻结业务输入（摘要，引用不重释）

1. WAC 国家范围仅 ID/MY/TH；范围外阻断提示"当前国家未纳入 WAC 业务范围"。
2. 单 CI 单国家；费用不跨国家；仓库单国家；本币由目标仓库国家唯一确定；禁用人工选币；国家身份用 `country_id`，`country_name` 仅展示，别名为输入解析。
3. CI 货物成本 = `goods_amount` + `currency`，按 **CI 实际出货日**汇率换本币；定金/尾款仅付款拆分。
4. CI 实际出货日当前无字段（实现缺口），`eta_date` 禁作出货日；`depart_date` 仅当 CI↔物流批次唯一可靠时可用；否则设计独立出货日事实。
5. 其他 WAC 费用：各次实际付款金额分别用该次**付款完成日**汇率。
6. 分次付款：每次付款→付款日→汇率→本币→保存证据→汇总；不超额、不伪造、退款冲销独立、可重放。
7. 未全部付款的费用**阻断 Cost Confirm**（建议提示见冻结输入第 7 条）。
8. 同币种 `rate=1` 仍保留完整审计证据。
9. Cost Confirm 日仅确认/锁定/审计，非汇率锚点。
10. 汇率快照不可变、被引用不可删；完整事实指纹一致可复用，任一不同须新建。
11. P1-03 基线冻结：Cost Confirm 只生成锁定 `wac_history`，不改 inventory 三字段，ERP 导入才投影。

---

## 2. 当前数据库事实（只读证据）

| # | 对象 | 事实 | 证据 |
|---|---|---|---|
| 1 | `exchange_rates` | 列：`id`(PK)、`from_currency`、`to_currency`、`rate`(REAL)、`rate_date`、`rate_type`(默认`realtime`)、`created_at`；**无 (from,to,date,rate_type) 唯一约束**；仅 1 行 `IDR→RMB/realtime` | db.js:212；DB 实测 count=1 |
| 1b | 汇率刷新 | server.js:411/512/553 均为 `INSERT INTO exchange_rates (...)`（非 upsert），每次刷新追加新 `id` 行，无去重/覆盖保障 | grep 命中 3 处 |
| 2 | `commercial_invoices` | 48 行；有 `goods_amount`/`currency`/`country`(文本)/`target_warehouse`(文本)；**无 `shipment_date`、无 `country_id`**；有 `wac_confirmed_at` | DB 实测 |
| 3 | `logistics_batches` | 4 行；有 `related_ci_id`、`depart_date`、`eta_date`、`actual_arrival_date`、`target_country`(文本)、`target_warehouse`(文本)、`freight_currency`、`international_freight`/`local_charges`/`customs_service_fee`/`delivery_fee`/`customs_duty`/`vat_gst`/`other_fees` | DB 实测 |
| 4 | `ci_cost_items` | 21 行；全部有 `payment_request_id`；`payable_amount`/`paid_amount`/`currency`/`include_in_landing_cost`；类别仅 `warehouse_arrival`/`customs_duty`/`inspection_fee`，**全部 USD**；**14 行未付** (`paid_amount=0` 但 `payable>0`) | DB 实测 |
| 5 | 付款层 | `payment_requests` 48 行（有 `payable_date` 但**实测 0 行有值**、`related_ci_id` 多为空、`include_in_landing_cost`）；`payment_transactions` **0 行**；`payment_allocations` **0 行** | DB 实测 |
| 6 | 费用→付款关联 | `ci_cost_items.payment_request_id` 全部能 JOIN 到 `payment_requests`（21/21）；但**实际付款完成日无数据**（transactions 空、requests.payable_date 空） | DB 实测 |
| 7 | `cost_allocations` | 13 行；有 `product_cost`/`allocated_freight`/`allocated_duty`/`allocated_other`/`total_landing_cost`/`unit_landing_cost`/`currency`/`original_qty`/`original_avg_cost`；**无 source/target 币种分离、无汇率证据、无 rate 快照** | DB 实测 |
| 8 | `wac_history` | 3 行（均 P103B-TEST，`is_locked=1`）；列含 `original_avg_cost`/`unit_landing_cost`/`new_avg_cost`/`settlement_date`；**无 source_currency/local_currency/rate/snapshot 任何列**；`settlement_date` 写 `2026-07-14`（`datetime('now')`） | DB 实测 |
| 9 | `warehouses.country_id` | 3 行；`country_id` **全部为空**；仅 `country_name`（马来西亚/泰国/印度尼西亚） | DB 实测 |
| 10 | 文本 country | `inventory`：Indonesia/Malaysia/Thailand/Vietnam/中国/印度尼西亚（6 种）；`commercial_invoices`：Indonesia/Malaysia/中国/印尼/印度尼西亚（5 种）；`logistics_batches.target_country`：印尼/印度尼西亚；`inventory`/`commercial_invoices` **无 `country_id` 列** | DB 实测 |
| 11 | P1-03 触发器 | `trg_wac_history_block_update` / `trg_wac_history_block_delete` 均存在；`wac_history.is_locked=1` 3 行 | DB 实测 |

---

## 3. 当前实现缺口（分类矩阵）

| 类别 | 缺口 |
|---|---|
| 已有字段可直接用 | `commercial_invoices.goods_amount`/`currency`；`ci_cost_items.payment_request_id`（关联键存在）；`logistics_batches.related_ci_id`/`depart_date`/`各项费用金额`；`cost_allocations` 分摊结构（需扩展）；`wac_history` 主体（需扩展，不可替换） |
| 已有字段但语义不可靠 | `commercial_invoices.country`/`target_warehouse`（自由文本，多表达）；`warehouses.country_name`（文本，无 `country_id`）；`ci_cost_items.currency` 全 USD 与"本地费应为本币"冲突；`exchange_rates.rate_type` 仅 `realtime`，缺 `cost_settlement`/`payment` |
| 当前缺少字段 | `commercial_invoices.shipment_date`（CI 实际出货日）；`warehouses.country_id`（全空）；`inventory`/`commercial_invoices`.`country_id`；费用"实际付款完成日"来源（`payment_transactions.paid_date` 为空）；`wac_history` 全部汇率证据列；`cost_allocations` 本币/汇率列 |
| 当前缺少关系 | 费用→实际付款明细（transactions/allocations 0 行）；费用→多付款分批换算；`wac_history`→多成本源/多快照的规范化关联；`country_id` 全链路一致的锚点 |
| 只能文本/推断关联 | CI 国家、仓库国家、库存国家三处各自文本，需别名映射（方向有误，见 P1-WAC-02）；CI↔物流批次"唯一可靠"无法直接由现有数据保证 |
| 后续必须新增明确事实 | CI 实际出货日事实；费用付款完成日事实；不可变汇率快照；成本来源/付款/换算/分摊证据实体；`wac_history` 多成本源关联表；`country_id` 全链路规范键 |

---

## 4. 汇率主数据与不可变快照边界

- **可更新汇率主数据** = 现有 `exchange_rates`（承载可刷新行情）。本轮设计须补：① 在 `(from_currency, to_currency, rate_date, rate_type)` 上建立**唯一约束**（防刷新产生重复生效键）；② 增加 `rate_source`、`is_active`、`effective_until` 以明确刷新覆盖边界（新行生效、旧行标记失效，而非物理覆盖历史查询）；③ 增加 `cost_settlement`/`payment` 等 `rate_type` 取值，与原 `realtime` 分离。
- **不可变汇率快照**（NEW `exchange_rate_snapshot`）：成本确认实际采用的完整事实，创建后 `UPDATE/DELETE` 由触发器或 `is_locked=1` 阻止（参照 P1-03 触发器模式），被 `cost_conversion_evidences` 引用后不可删。
- **二者关系**：成本确认时，按生效键从 `exchange_rates` **查询**，命中后**生成** `exchange_rate_snapshot`（拷贝完整事实 + 计算上下文），后续重算/展示一律读快照，主数据刷新不影响已锁定快照。

---

## 5. 五层关系（成本来源 → 付款 → 换算 → 分摊 → WAC）

```
cost_sources (source_type=CI_GOODS | FEE)
   │
   ├─[GOODS]──直接──► cost_conversion_evidences (conversion_type=GOODS)
   │                      └─► exchange_rate_snapshot (出货日锚点)
   │
   └─[FEE]──► cost_payment_links (一笔费用↔多次付款分配)
                 └─► payment_facts (每次付款完成日)
                       └─► cost_conversion_evidences (conversion_type=FEE_PAYMENT, 每次付款一条)
                             └─► exchange_rate_snapshot (付款日锚点)
                                          │
cost_conversion_evidences ──► cost_allocation_evidences (按 SKU/仓库分摊, 同国家内)
                                  └─► wac_history_cost_sources (规范化多对多)
                                        └─► wac_history (is_locked 后不可改)
```

规范化关联（**禁止** `snapshot_ids` JSON / 逗号拼接 / 单字段多 ID / 仅存一个 snapshot_id）。

---

## 6. 候选实体及字段语义

**E1 `exchange_rates`（扩展主数据）**：`id`；`from_currency`；`to_currency`；`rate`；`rate_date`；`rate_type`（`realtime`/`cost_settlement`/`payment`）；`rate_source`；`is_active`；`effective_until`；`created_at`。唯一键 `(from_currency,to_currency,rate_date,rate_type)`。

**E2 `exchange_rate_snapshot`（不可变）**：`id`；`source_currency`；`target_currency`；`rate_date`；`rate_type`；`applied_rate`；`rate_source`；`original_rate_direction`（如 `IDR→USD`）；`applied_direction`（如 `USD→IDR`）；`original_rate`；`is_inverse`；`is_cross_rate`；`bridge_currency`；`calculation_precision`；`rounding_rule`；`manual_confirmation_status`；`confirmed_at`；`confirmed_by`；`is_locked`(=1)；`fact_fingerprint`（完整事实哈希，用于复用判定）；`created_at`。

**E3 `exchange_rate_snapshot_composition`（交叉组成）**：`id`；`parent_snapshot_id`；`leg_order`；`component_snapshot_id`；`component_rate`；`bridge_currency`；`calc_sequence`。仅交叉汇率有行。

**E4 `cost_sources`（成本来源事实）**：`id`；`source_type`（`CI_GOODS`/`FEE`）；`source_id`；`source_line_id`（如 `ci_cost_items.id` 或 `logistics_batches` 费用行）；`ci_id`；`cost_category`；`original_amount`；`source_currency`；`target_country_id`；`target_currency`；`include_in_wac`；`is_cancelled`；`anchor_date_type`（`SHIPMENT_DATE`/`PAYMENT_DATE`）；`anchor_date_value`；`cost_business_key`（防重复）；`dedup_status`。

**E5 `payment_facts`（付款事实）**：`id`（= `payment_transactions.id`）；`payment_request_id`；`paid_amount`；`paid_currency`；`paid_date`；`payment_status`；`is_reversal`/`is_refund`/`is_void`；`reverse_of`/`cancelled_by`（自引用）；`effective_net_amount`；`allocated_total`（冗余校验用）。

**E6 `cost_payment_links`（分次付款分配）**：`id`；`cost_source_id`；`payment_fact_id`；`allocated_original_amount`；`allocated_currency`；`allocation_order`。唯一键 `(cost_source_id, payment_fact_id)` 防重复分配。

**E7 `cost_conversion_evidences`（换算证据）**：`id`；`conversion_type`（`GOODS`/`FEE_PAYMENT`）；`cost_source_id`（GOODS 用）；`cost_payment_link_id`（FEE 用）；`original_amount`；`original_currency`；`snapshot_id`；`local_amount`；`target_currency`；`calculation_precision`；`rounding_result`；`evidence_status`；`is_confirmed`；`created_at`。

**E8 `cost_allocation_evidences`（分摊证据）**：`id`；`wac_version_id`；`conversion_evidence_id`；`sku_code`；`warehouse`；`country_id`；`allocation_basis`；`basis_qty`（数量/权重）；`pre_alloc_local_total`；`allocated_local_amount`；`rounding_difference`；`target_currency`。总额守恒校验。

**E9 `wac_history`（扩展，不替换）**：保留现有列；新增 `target_country_id`、`target_currency`（冗余索引，来源 `cost_sources.target_country_id`）；`settlement_date` 重定位于"确认操作日"（不再作汇率锚点，或保留仅审计）；新增关联表 `wac_history_cost_sources`（`id`；`wac_history_id`；`cost_source_id`；`conversion_evidence_id`；`role`；`cost_category`）。

---

## 7. 主键、外键、唯一约束和不可变规则

- **PK**：各实体 `id`（TEXT，业务生成）。
- **FK**：`cost_sources.ci_id→commercial_invoices.id`；`cost_payment_links.payment_fact_id→payment_facts.id`；`cost_payment_links.cost_source_id→cost_sources.id`；`cost_conversion_evidences.snapshot_id→exchange_rate_snapshot.id`；`cost_allocation_evidences.conversion_evidence_id→cost_conversion_evidences.id`；`wac_history_cost_sources.*→` 对应父表；`exchange_rate_snapshot_composition.parent/component→exchange_rate_snapshot.id`。
- **唯一约束**：`exchange_rates(from,to,date,rate_type)`；`exchange_rate_snapshot(fact_fingerprint)`（复用而非重复）；`cost_payment_links(cost_source_id,payment_fact_id)`；`cost_sources(cost_business_key)`（防重复成本源）；`wac_history_cost_sources(wac_history_id,cost_source_id,conversion_evidence_id)`。
- **不可变**：`exchange_rate_snapshot.is_locked=1` + 触发器（仿 P1-03）阻止 UPDATE/DELETE；被 `cost_conversion_evidences` 引用后 FK 阻止删除；`wac_history.is_locked=1` 阻止改；**禁止 `ON CONFLICT DO UPDATE` 覆盖历史快照**——冲突时新建带新 `fact_fingerprint` 的快照或复用既有一致快照。

---

## 8. 汇率生效键与快照事实指纹

- **生效键（查询用）**：`source_currency + target_currency + rate_date + rate_type` → 从 `exchange_rates` 取应适用行情。
- **快照事实指纹（复用判定）**：`source_currency + target_currency + rate_date + rate_type + applied_rate + rate_source + original_rate_direction + applied_direction + original_rate + is_inverse + is_cross_rate + bridge_currency + 组成快照 + calculation_precision + rounding_rule + manual_confirmation_status`。**完整一致才复用既有不可变快照**；任一不同 → 新建。

---

## 9. 直接 / 倒数 / 交叉 / 同币种汇率模型

1. **直接**（USD→IDR）：`original_rate_direction=USD→IDR`，`applied_direction=USD→IDR`，`is_inverse=0`；快照存 `applied_rate`、`rate_source`、生效键。
2. **倒数**（主数据仅 IDR→USD，实际使用 USD→IDR）：`original_rate=IDR→USD 值`，`original_rate_direction=IDR→USD`，`applied_direction=USD→IDR`，`is_inverse=1`，`applied_rate=1/original_rate`（按 `calculation_precision` 计算并记 `rounding_rule`）；保留 `original_rate` 与原始快照引用。
3. **交叉**（如 RMB→MYR 无直接）：本轮**只做模型**，不冻结 USD 为唯一桥接。`bridge_currency` 存桥接币；`exchange_rate_snapshot_composition` 存每段组成快照（如 RMB→USD、USD→MYR）；`applied_rate`=各段连乘（记 `calc_sequence`、精度、舍入）；**禁止系统自动搜索任意最短路径**，桥接币须显式指定（建议默认 USD 但可配置）。
4. **同币种**（IDR→IDR）：`applied_rate=1`，`rate_date`=对应成本锚点（出货日或付款日），`rate_type` 保持业务语义，`rate_source` 显式（如 `SAME_CURRENCY_NO_CONVERSION`）；仍生成不可变快照，参与追溯。

---

## 10. 分次付款模型

- 一笔费用（`cost_sources` 一行，`source_type=FEE`）→ 多条 `cost_payment_links`（每次付款一行）→ 每条 link 对应一条 `payment_facts`（取自 `payment_transactions`，`paid_date` 为锚点）→ 每条 link 生成一条 `cost_conversion_evidences`（conversion_type=FEE_PAYMENT）。
- 汇总：同费用所有 `cost_conversion_evidences.local_amount` 求和 = 费用最终本币成本。
- 校验（见 §12）：`Σ allocated_original_amount ≤ cost_source.original_amount`；`Σ link.allocated ≤ payment_facts.paid_amount`；退款/冲销以独立 `payment_facts`（负额/`is_reversal`）计入净额，不覆盖原行。

---

## 11. 退款、冲销及反向付款模型

- `payment_facts` 增加 `is_reversal`/`is_refund`/`is_void` 与 `reverse_of`/`cancelled_by` 自引用。
- 处理原则：独立事实，不覆盖原付款；Cost Confirm 前置须按 `effective_net_amount`（原付 + 负向冲销）完成覆盖校验；存在未处理退款/冲销 → 阻断（冻结输入第 7 条）。
- `cost_payment_links` 不引用被冲销的原付款净额为负的部分；冲销自身可生成反向 `cost_conversion_evidences`（本币符号相反）以保留可重放路径。

---

## 12. Cost Confirm 前置校验模型（设计不实施）

1. CI 实际出货日存在且有效（非 ETA/Cost Confirm/定金/尾款日）；
2. CI 国家 = 目标仓库国家 = 库存国家（以 `country_id` 为准，冲突阻断）；
3. 目标国 ∈ {ID,MY,TH}（否则提示"当前国家未纳入 WAC 业务范围"）；
4. 目标本币唯一确定；
5. CI 货物成本汇率快照已生成并锁定（出货日锚点）；
6. 所有计入 WAC 费用有明确应计金额与原币；
7. **所有相关费用已由有效付款 100% 覆盖**（未付余额 → 阻断，提示冻结输入第 7 条）；
8. 所有付款有有效 `paid_date`；
9. 所有付款分配完整且不超额；
10. 退款/冲销/reverse 已完成净额处理；
11. 每次付款有对应不可变汇率快照；
12. 所有成本已换算为同一目标本币；
13. 分摊总额守恒（尾差归属规则）；
14. 无重复成本源（`cost_business_key`）；
15. 无重复付款使用（`cost_payment_links` 唯一键）；
16. 无未处理的范围外国家；
17. 任一失败 → **不生成正式 `wac_history`**。

---

## 13. WAC 多成本来源追溯模型

- `wac_history` 1 行 ↔ `wac_history_cost_sources` N 行 ↔ 每行的 `cost_source_id` + `conversion_evidence_id`。
- 货物成本源 → 其 `cost_conversion_evidences`（GOODS）→ `exchange_rate_snapshot`（出货日）。
- 费用成本源 → 其 `cost_payment_links` → 各 `payment_facts` → 各 `cost_conversion_evidences`（FEE_PAYMENT）→ 各自 `exchange_rate_snapshot`（付款日）。
- 由此从最终 `wac_history` 可回溯到每个成本来源、每笔付款、每次汇率事实；交叉汇率可再经 `exchange_rate_snapshot_composition` 展开组成。

---

## 14. 方案比较

### 方案 A：最小关联模型
- 实体：保留 `exchange_rates`（补唯一键）；新增 `exchange_rate_snapshot`；复用 `cost_allocations`；新增 `wac_history_snapshot_map`(`wac_history_id`,`snapshot_id`,`source_type`,`source_ref`) 作为规范化关联（非 JSON）。
- 关系少（约 3 新增实体/关联）。
- 支持：CI 出货日换算、基本汇率快照、WAC↔快照追溯。
- 不足：**难支持分次付款**（无付款明细级换算）、**难支持退款/冲销独立事实**、**防重复付款弱**、审计缺口（费用↔付款链路缺失）、历史重放仅到快照级不到付款级；后续必返工。

### 方案 B：规范化完整闭环
- 实体：E1–E9（见 §6），含 `cost_sources`/`payment_facts`/`cost_payment_links`/`cost_conversion_evidences`/`cost_allocation_evidences`/`wac_history_cost_sources` + 快照组成表。
- 比较：

| 维度 | A | B |
|---|---|---|
| 表数量 | ~3 新增 | ~9 新增/扩展 |
| 字段数量 | 少 | 多 |
| 查询复杂度 | 低 | 中（JOIN 链明确） |
| 实施复杂度 | 低 | 中高 |
| 审计能力 | 弱 | 强（到付款级） |
| 历史重放 | 快照级 | 付款+快照级 |
| 分次付款 | 不支持 | 支持 |
| 退款冲销 | 弱 | 支持（独立事实） |
| 对 P1-03 影响 | 小（扩展列） | 小（扩展列+新增关联表，不改 `wac_history` 锁定语义） |
| 历史迁移风险 | 低 | 中（需处理 P103B/P103C 旧行 NULL 兼容） |
| 回滚难度 | 易 | 中（新增表可独立 drop） |
| 二次返工 | 高 | 低 |

---

## 15. 推荐方案

**推荐方案 B（规范化完整闭环）**。理由：冻结输入已强制要求分次付款、退款/冲销独立事实、每成本源独立不可变快照、未全付款阻断、同币种审计——这些能力在方案 A 下无法规范承载，必然二次返工。方案 B 的规范化关联（§5/§13）同时满足"禁止 JSON/单字段多 ID"的硬性约束，并保留 P1-03 `wac_history` 锁定语义不变。

---

## 16. 历史数据兼容边界

- 不自动回填历史汇率快照；不自动推断 CI 出货日/费用付款日；不自动重算历史 `wac_history`；不覆盖既有 WAC；不修改 P103B/P103C。
- 旧 `wac_history` 缺汇率证据列 → 保持 NULL，标记"汇率口径未确认"；推断值不得作为正式审计事实。
- 新模型上线不因历史数据自动污染/重写库存（ERP 投影仍仅在最新导入时按已确认本币 WAC 进行）。

---

## 17. 对下一任务的输入

- **P1-WAC-05（汇率规则）**：直接/倒数/交叉/同币种计算精度与舍入规则细化；桥接币默认与可配置策略；`rate_type` 枚举最终命名；交叉路径禁止自动最短路径的实现约束。
- **P1-WAC-06（换算分摊顺序/精度）**：先换本币再分摊的尾差归属与缩放整数（参考 `paid_amount_minor` 整数设计）落库方案。
- **P1-WAC-07（wac_history 汇率证据/历史版本）**：E9 扩展列与 `wac_history_cost_sources` 关联表落地；旧行 NULL 兼容脚本（仅标记不回填）。
- **P1-WAC-08（实施与迁移只读审查）**：DDL 顺序、`country_id` 回填（warehouses/inventory/CI）、`exchange_rates` 唯一键加建、付款层 `paid_date` 数据补录机制设计（当前 transactions 空，是实施最大前置风险）。
- **关键前置风险**：当前 `payment_transactions`/`payment_allocations` 为 0 行且 `payment_requests.payable_date` 空 → "实际付款完成日"无数据源，须在进入正式实施前明确付款数据从何而来（录入流程/三方对账），否则费用换汇锚点无法落地。

---

## 18. 本轮零修改声明

未修改代码、数据库、接口、页面、测试数据；未执行 DDL、未编写/执行迁移脚本；未修改日志、原报告或 MEMORY.md；未进入正式实施或下一任务。所有内容为设计候选，待批准后由 P1-WAC-08 审查、P1-WAC-05/06/07 细化后实施。
