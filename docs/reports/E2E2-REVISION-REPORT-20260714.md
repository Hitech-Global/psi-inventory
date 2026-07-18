# SYS-E2E-02 测试结论修订报告

> 修订性质：**只读事实修订**。本轮未修改任何代码，未修复问题，未删除/回滚/恢复数据，未新增测试数据，未进入 T1。
> 修订依据：用户定义的**正式库存与加权平均成本口径**（ERP 手动导入是当前可用库存唯一事实来源；采购链只用于状态/在途/成本/预测，不得永久增加库存总表可用量）。
> 配套原报告：`E2E2-CONTROLLED-WRITE-REPORT-20260714.md`（以下简称"原报告"）。
> 测试前副本：`data/E2E2-SAFETY-COPY/inventory.db`，SHA256 `d59a7bb9025478449af49c670d9f114834ad824e5ba638b5879d269e17deecc1`，大小 29,536,256 字节，时间 2026-07-14T10:31:19（本地）。

---

## 1. 修订后的场景通过 / 失败 / 未覆盖矩阵

| 场景 | 原结论 | 修订结论 | 修订理由 |
|------|--------|----------|----------|
| E2E2-01 补货建议 → 创建 PO | 通过 | **通过** | PO 创建、inventory 在途字段联动正常；rs 快照不随 PO 实时刷新属冻结设计，非缺陷。 |
| E2E2-02 PI 与定金分支（A 有定金 / B 无定金） | 通过 | **通过（附观察）** | PI 创建、定金 PR 创建与审批通过；但定金 PR confirm-paid 后 `paid_deposit` 仍为 0（见 E2E-P2-07），不阻断单据链路。 |
| E2E2-03 CI/PL 与尾款 | 通过 | **通过** | CI 创建尾款公式 NET 口径一致（未重现 P1-02）；尾款 PR 创建成功；`send-to-factory` 受状态机守卫（需 approved，当前不可达，见 E2E-P2-08）。 |
| E2E2-04 付款 / 抵扣 / 应付状态 | 通过 | **通过（附观察）** | 定金/尾款结清、有抵扣+部分付款分支均正确；但定金申请不带抵扣时 `unpaid` 不减仍成立（E2E-P1-01）。 |
| E2E2-05 外部仓入库 | 通过 | **通过（暴露 P1）** | 入库单据创建、CI 状态 completed、在途字段联动正常；但**单条入库允许负数量**（`actual_qty=-1` 被接受，已落入 DB），见 E2E-P1-04。 |
| E2E2-06 原库存数量导入 | 通过 | **通过（暴露 P1）** | 导入成功、CI flag 置位；但采用 **DELETE-first**，校验失败会清空此前正确导入（本轮已复现副作用），见 E2E-P1-05。 |
| E2E2-07 成本确认与加权平均成本 | 通过 | **失败** | 业务调用可执行，但结果违反冻结成本与库存规则，含三处缺陷（E2E-P1-03 / E2E-P1-WAC / E2E-P1-INVVAL）。详见第 3 节。 |
| E2E2-08 库存与预测联动 | 通过 | **未覆盖 / 未完成** | 本轮未执行真正的后续流程（ERP 当前可用库存导入 → 匹配最新已确认 WAC → 重算库存金额 → 预测重读）；以 `available_qty 111→114` 作为通过证据属错误。详见第 3 节。 |
| 整体"完整业务闭环跑通" | 通过 | **失败** | 采购/PI/CI/付款/入库**单据链路基本可达**；**成本与库存闭环失败**。完整 E2E 尚未通过。 |

---

## 2. 新增问题 E2E-P1-03：加权平均成本更新错误修改库存总表当前可用库存

**级别**：P1
**类型**：业务规则违反（成本流程错误承担库存数量更新职责）
**触发接口**：`POST /api/cost-allocation/update-weighted-avg/:ci_id`（server.js:4711）

### 2.1 代码事实（server.js:4761、4769）
```
4761: const newQty = originalQty + inboundQty;          // 111 + 3 = 114
4769: run('UPDATE inventory SET available_qty = ?, weighted_avg_cost = ?,
            inventory_value = available_qty * ?, ...
            WHERE id = ?', [newQty, roundedAvgCost, roundedAvgCost, ...]);
```
`update-weighted-avg` 将 `available_qty` 直接写为 `originalQty + inboundQty`（即 114）。
按正式口径，`originalQty + inboundQty` **仅作为本次 CI 加权平均成本公式的计算分母**，绝不代表 ERP 当前真实可用库存，不得写入库存总表 `available_qty`。

### 2.2 实测影响
- RDM731（Bekasi Warehouse）`available_qty` 由测试前 **111 → 114**（已用测试前副本比对确认）。
- 该 +3 并非来自 ERP 最新库存手动导入，而是采购入库数量被错误地永久累加到库存总表。

### 2.3 影响范围（与用户描述一致）
1. 当前库存脱离 ERP 实际库存（数据库比 ERP 多 3 件）；
2. 后续手动导入 ERP 库存时可能重复计算（系统已"自作主张"加了 3，ERP 再导入会再叠加或冲突）；
3. 订单预测可能提前抓取并不存在的当前可用库存（available 虚高 3）；
4. 销售、调拨、退货或其他库存变化无法体现（available 被成本流程锁定为 114，未走 ERP 通道）；
5. 成本流程错误承担了库存数量更新职责，违反职责分离；
6. 与 E2E2-08 缺失的"ERP 当前可用库存手动导入"步骤形成双重口径冲突。

### 2.4 设计修正方向（仅记录，不实施）
- `update-weighted-avg` 不得写 `inventory.available_qty`；WAC 分母使用 `original_inventory_imports.original_qty + inbound_qty`，结果只更新 `weighted_avg_cost`（且须先做汇率换算）。
- 库存总表 `available_qty` 仅由独立的"ERP 当前可用库存手动导入"入口更新，该入口不触碰 WAC 分母。
- 两个口径的物理隔离需在 DB/接口层明确（新增独立 ERP-available 导入表/接口，或 inventory 区分 `wac_calc_qty` 与 `erp_available_qty` 两列）。

---

## 3. E2E2-07 与 E2E2-08 修正结论

### 3.1 E2E2-07 "成本确认与加权平均成本" → 失败
失败原因（至少三处，均违反冻结 V1.0 成本与库存规则）：

1. **CI 原币成本未换算成本国货币即与旧 WAC 混算（E2E-P1-WAC，原 P3→P1）**
   - `unit_landing_cost`（USD，本轮 CI 货值 30/3=10 USD/件）直接混入 `old_avg_cost`（IDR 73563）计算新 WAC。
   - 违反冻结 V1.0 ⑦（货款成本折算汇率在成本确认时快照固化）、⑫（汇率由第三方 API 同步、业务统一读 exchange_rates）。
   - 实测：`new_avg_cost = (111×73563 + 3×10)/114 = 71627.39`，若做 USD→IDR（约 ×16000）则应为 ~160000/件，WAC 被**严重低估**。

2. **inventory_value 使用旧 available_qty（E2E-P1-INVVAL，原 P3→P1）**
   - server.js:4769 `inventory_value = available_qty * roundedAvgCost` 中 `available_qty` 取的是 UPDATE 前的旧值（SQLite 同语句 RHS 读旧行）。
   - 实测：存 `111 × 71627.39 = 7,950,640.81`，正确应为 `114 × 71627.39 = 8,169,523`，**少计约 218,882**。

3. **update-weighted-avg 错误修改 available_qty（E2E-P1-03，新增 P1）**
   - 见第 2 节。库存总表可用量被非法 +3。

**结论**：E2E2-07 原"通过"结论撤销，改为"失败——调用可达，结果违反冻结规则"。

### 3.2 E2E2-08 "库存与预测联动" → 未覆盖 / 未完成
本轮实际只做到：采购入库（inbound 单据）→ 原库存导入（仅用于 WAC 分母）→ 成本确认+分摊+WAC 更新。
**未按正式口径执行真正的后续流程**：

```
加权平均成本确认
→ 手动导入 ERP 最新当前可用库存        ← 本轮未做（且无独立接口，update-weighted-avg 越权做了）
→ 库存总表匹配最新已确认加权平均成本    ← 本轮未做
→ 库存金额更新                          ← 本轮未做（且 inventory_value 计算错误）
→ 订单预测重新读取最新库存              ← 本轮未做
```

原报告将 `available_qty 111→114` 当作"库存与预测联动正确"证据，但该 114 正是 E2E-P1-03 的**错误产物**，预测若重读会读到虚高 3 件的可用量。
另外，补货建议快照（replenishment_suggestions）本就是周期性快照、不随闭环自动刷新（冻结设计），不能用作"联动通过"证据。

**结论**：E2E2-08 原"通过"结论撤销，改为"未覆盖 / 未完成"。

---

## 4. 修订后的问题等级

| 问题 ID | 标题 | 原级别 | 修订级别 | 说明 |
|---------|------|--------|----------|------|
| E2E-P1-01 | 定金申请带 deduction 时 `unpaid` 不减 | P1 | **P1（维持）** | server.js:4249 `unpaid_amount=payable_amount`；本轮未带 deduction 未触发，根因确认。 |
| E2E-P1-02 | 部分 legacy CI 未结清口径不一致 | P1 | **P1（维持，范围已核为 7 行 CI-P3-\*）** | NET 口径重验后真实失败仅 7 行；原报告"18 行"为 GROSS 口径误报。 |
| **E2E-P1-03（新增）** | update-weighted-avg 错误修改 available_qty | — | **P1** | 见第 2 节。 |
| **E2E-P1-WAC（原 E2E-P3a）** | WAC 未做汇率换算（USD 混入 IDR） | P3 | **P1** | 违反 V1.0 ⑦⑫，WAC 严重低估。 |
| **E2E-P1-INVVAL（原 E2E-P3b）** | inventory_value 用旧 available_qty | P3 | **P1** | 少计约 218,882。 |
| **E2E-P1-04（原 E2E-P4）** | 单条入库允许负数量 | P4/低风险 | **P1** | `actual_qty=-1` 被接受并落库，破坏数量完整性；不应视为低风险。批量导入接口有校验，二者不一致。 |
| **E2E-P1-05（原 E2E-P5）** | 原库存导入 DELETE-first，失败清空正确数据 | 未明确 | **P1** | server.js:4561 先 DELETE 再逐条插入；若整批校验失败则此前正确导入被清空。本轮已复现（异常6 致正确导入被清空，后手工恢复）。若涉及已确认成本 CI，影响升级为 P1。 |
| E2E-P2-06 | 重复创建 CI 尾款付款申请（无幂等守卫） | P2 | **P2（维持）** | 第二次 `from-ci-balance` 再次建 PR，无去重。 |
| E2E-P2-07 | 定金 confirm-paid 后 `paid_deposit` 仍为 0 | P2 | **P2（维持）** | 状态位翻转但金额字段未更新（仅 bulk-import 更新）。 |
| E2E-P2-08 | 生产节点在当前状态机不可达 | 观察 | **P2（维持，需确认业务时序）** | `send-to-factory` 要求 `po_status='approved'`；PO 经 PI 转移后为 `transferred_pi`，退回 `submit-approval` 需 `draft`，形成时序死结。需确认正确业务时序（是否允许 PI 后回退审批或生产节点前置）。 |

> 注：本轮**未发现**新的 P2/P3 以外低危问题需下调；原 P3 两项已升 P1，原 P4 升 P1。

---

## 5. 当前真正已跑通的链路

仅指"单据/状态链路可达、且结果不违反冻结规则"的环节：

1. **补货建议 → 创建 PO**：PO-2026-478146、PO-2026-613367 创建成功；inventory 在途字段（po_unconfirmed_pi_qty 等）按 `updateInventoryTransitData` 联动正确。
2. **PO → PI（双分支）**：PI-2026-613351（需定金 30%，payable_deposit=9）、PI-2026-613374（无定金）创建成功；PO 状态 transferred_pi；inventory pi_confirmed_unshipped_qty 联动正确。
3. **PI → 定金申请与审批**：PAY-DEP-2026-724347 创建并审批通过（payable=9 / unpaid=9 / approved）。
4. **PI → CI（尾款公式 NET 口径）**：CI-2026-885093 创建，should_deduct_deposit=9、payable_balance=21、unpaid_balance=21，与 NET 口径一致（未重现 P1-02）。
5. **CI → 尾款付款申请**：PAY-BAL-2026-713834 创建（payable=21，已净扣定金）。
6. **付款审批与结算（定金/尾款/有抵扣部分）**：
   - 定金 confirm-paid：PAY-DEP-2026-724347 → paid=9/unpaid=0；
   - 尾款 confirm-paid：PAY-BAL-2026-713834 → paid=21/unpaid=0；CI-A 全额结清（9+21=30）；
   - 有抵扣+部分付款：PAY-WAR-2026-878523 → actual_pay=3、partial、unpaid=1，抵扣与部分付款分支正确。
7. **外部仓入库单据**：IN-2026-993506（RDM731×3）创建，CI-A → completed，CI 明细 inbound_qty 联动，在途字段正确归零。
8. **原库存数量导入（作为 WAC 分母）**：original_inventory_imports 写入 RDM731=111，CI flag 置位（功能可达，但 DELETE-first 风险见 P1-05）。

---

## 6. 当前尚未跑通 / 失败的链路

1. **成本确认后的加权平均成本计算（E2E2-07 失败）**：汇率未换算（P1-WAC）、inventory_value 用旧量（P1-INVVAL）。
2. **库存总表可用量保护（E2E-P1-03）**：available_qty 被错误 +3，脱离 ERP 实际库存。
3. **ERP 当前可用库存手动导入步骤（缺失）**：系统无独立入口；该职责被 update-weighted-avg 越权承担，且方式错误。
4. **库存总表匹配最新已确认 WAC → 重算库存金额（缺失）**：未执行，且即便执行，inventory_value 计算逻辑本身有错（P1-INVVAL）。
5. **订单预测在 ERP 导入后的重读联动（缺失）**：未执行；当前若重读会命中 E2E-P1-03 的虚高 available。
6. **生产节点（send-to-factory）可达性（P2-08）**：当前状态机下不可达，需确认业务时序。
7. **异常防护**：负数量入库（P1-04）、重复尾款 PR（P2-06）、DELETE-first 导入（P1-05）未防护。

---

## 7. 完成完整 E2E 还缺少哪些测试

1. **ERP 当前可用库存手动导入的独立测试**：需新增/明确专用接口，验证其只更新 `available_qty`、不触碰 WAC 分母、不与采购入库叠加。
2. **WAC 确认后 → ERP 导入 → 按 SKU+国家+仓库匹配最新已确认 WAC → 重算 inventory_value** 的端到端验证（当前无此链路可执行）。
3. **订单预测在 ERP 导入后的重读验证**：确认预测读取的是 ERP 可用量而非采购虚增量。
4. **汇率换算路径测试**：需 mock/接入 exchange_rates，验证 CI 原币成本按快照汇率折算 LC 后再混算 WAC。
5. **生产节点时序测试**：在正确的业务时序下（PO 审批 → 生产 → PI/CI）验证 send-to-factory 可达，并确认是否需要回退机制。
6. **幂等与校验防护测试**：重复尾款 PR 去重、入库负数量拒绝、原库存导入失败不破坏既有数据。
7. **多 SKU / 多仓库 / 多国家 CI 的 WAC 与可用量隔离测试**：确认各维度口径互不串扰。
8. **充值/恢复类测试**：确认成本确认后可冲销（红字）+ 重生成（冻结 V1.0 ⑩），本轮未涉及。

---

## 8. 当前测试数据造成的全部数据库影响

### 8.1 对"既有（非测试）记录"的修改（最关键）
- **inventory RDM731（Bekasi Warehouse，既有 ERP 导入行）被 mutate**：
  - `available_qty`：111 → **114**（+3，错误，E2E-P1-03）
  - `weighted_avg_cost`：73563.0 → **71627.3947**（−1935.61，汇率未换算，P1-WAC）
  - `inventory_value`：8165493.0 → **7950640.8117**（−214852.19，P1-INVVAL + WAC 双重作用）
  - `updated_at`：2026-07-14 03:02:31（由 update-weighted-avg 写入）
- **commercial_invoice_items（CI-A 明细，RDM731）inbound 状态被异常测试污染**：
  - `inbound_qty`：应为 3（主入库）→ 实测 **4**（叠加异常2 −1、异常3 0、异常7 +2）
  - `uninbound_qty`：3 − 4 = **−1**（负数，数据不一致，源于 P1-04 负数量入库）
- **RDM731 在途字段**：`po_unconfirmed_pi_qty`/`pi_confirmed_unshipped_qty`/`in_transit_qty` 经 `updateInventoryTransitData` 自校验后**已回到测试前基线（3/0/0）**，无永久畸变（清理时无需特别处理，但建议核对）。

### 8.2 新增（可整体删除的）E2E2 记录
| 表 | 数量 | 标识 / 主键 | 备注 |
|----|------|------------|------|
| purchase_orders | 2 | PO-2026-478146 (`po_1783996478145_jnlzl6`)、PO-2026-613367 | remark 含 E2E2-20260714 |
| proforma_invoices | 2 | PI-2026-613351 (`pi_1783996613351_r9a8hr`)、PI-2026-613374 (`pi_1783996613374_bvkuxq`) | remark 含 E2E2-20260714 |
| commercial_invoices | 1 | CI-2026-885093 (`ci_1783996885092_xs7th0`) | remark 含 E2E2-20260714 |
| payment_requests | **4** | 见下 | **注意：其中 2 条尾款 PR 无 E2E2 文本标签** |
| └ PAY-DEP-2026-724347 | | pi 源，PI-2026-613351，payable=9/paid=9 | remark 含 E2E2（定金审批）|
| └ PAY-BAL-2026-713834 | | ci 源，CI-2026-885093，payable=21/paid=21 | remark="CI尾款 CI-2026-885093"，**无 E2E2 标签** |
| └ PAY-BAL-2026-263588 | | ci 源，CI-2026-885093，payable=21/unpaid=21（重复） | remark="CI尾款 CI-2026-885093"，**无 E2E2 标签** |
| └ PAY-WAR-2026-878523 | | manual，payable=5/paid=2/partial | remark 含"有抵扣部分付款测试" |
| logistics_batches | 1 | LOG-2026-993417 | related_ci_no=CI-2026-885093 |
| inbound_records | 4 | IN-2026-993506（主，+3）、IN-2026-263598（异常2，−1）、IN-2026-263611（异常3，0）、IN-2026-263652（异常7，+2） | remark 含 E2E2 / 异常 |
| original_inventory_imports | 1 | RDM731=111，ci_id=CI-A | 无 created_at 列 |
| cost_allocations | 1 | ci_id=CI-A | created_at 存在 |
| cost_update_logs | 1 | related_ci_no=CI-2026-885093 | created_at 存在 |

### 8.3 关键清理追踪缺口（务必注意）
- **两条尾款 PR（PAY-BAL-2026-713834 / PAY-BAL-2026-263588）没有任何 E2E2 文本标签**，仅能通过 `related_ci_no='CI-2026-885093'` 或 `source_id='ci_1783996885092_xs7th0'` 关联识别。任何"按 E2E2-20260714 文本标签删除"的清理脚本都会**漏删**这两条，导致测试残留孤儿记录。
- 原报告第 9 节"数据清单"中 payment_requests 计数为 2，实为 **4**（漏计两条未标签尾款 PR）。本修订以 4 为准。

---

## 9. 整体恢复数据库的风险判断

**结论：当前不得整体恢复；须先经用户确认。**

### 9.1 已排查结果（只读）
- 以测试前副本时间 2026-07-14T10:31:19（本地）= 02:31:19 UTC 为 cutoff，查询各表 `created_at > 02:31:19` 且**非 E2E2 标签**的记录：
  - 仅命中 `PAY-BAL-2026-713834`、`PAY-BAL-2026-263588` 两条——但二者均为 E2E2 测试数据（关联 CI-2026-885093），**非真实业务数据**。
  - **未发现任何其他非 E2E2 的复制后新增记录**。
- 限制：部分表**无 created_at 列**（`original_inventory_imports`、以及 inbound/PO/PI/CI/PR 的 remark 之外维度），无法对全部表做时间戳穷举；且 `inventory`/`skus` 等主数据表的时间列不能区分"E2E2 修改"与"其他修改"。

### 9.2 仍须用户确认后方可恢复
存在以下不确定性，整体恢复前必须由用户明确：
1. 复制时间（10:31:19）之后，用户是否**手工创建但需要保留**的数据；
2. 是否存在**非 E2E2 批次的有效业务数据**；
3. 是否存在**后续真实导入数据**（如 ERP 库存导入、CI/PI 真实单据）；
4. 是否存在**其他并行测试需要保留的数据**。
若上述任一存在，整体恢复将造成**不可逆数据丢失**。因此整体恢复当前被禁止，仅允许"按清单逐条清理 + 定点恢复 RDM731 字段 + 重算在途 + 比对副本"的外科式清理（见第 10 节，本轮不执行）。

---

## 10. 后续清理可选方案（仅列方案，本轮不执行）

> 前提：须先完成第 9.2 的用户确认。以下方案均**不修改代码、不修复、不整体恢复**。

**方案 A：整体恢复（高风险，当前禁止）**
- 用 `data/E2E2-SAFETY-COPY/inventory.db` 覆盖现库。
- 优点：一键回到测试前。
- 风险：若 9.2 任一成立则丢数据；且会同时丢弃两条"合法视作测试"的尾款 PR（属预期）。
- 结论：**仅当 9.2 全部确认无保留数据后方可考虑**。

**方案 B：按文本标签删除（不充分，禁止单独使用）**
- 删除 remark 含 `E2E2-20260714`/`SYS-E2E-02`/`异常`/`恢复`/`有抵扣部分付款` 的记录。
- 缺陷：
  (a) **漏删两条无标签尾款 PR**（PAY-BAL-2026-713834/263588）→ 残留孤儿；
  (b) **不 revert 既有 inventory RDM731 行的 mutate**（available/WAC/inv_value 仍错误）；
  (c) **不 revert CI 明细 inbound_qty/uninbound_qty**（仍为 4/−1）。
- 结论：不可单独使用。

**方案 C（推荐）：外科式逐条清理 + 定点恢复（保留真实数据）**
1. 删除 4 条 inbound_records（`source_ci_id='ci_1783996885092_xs7th0'`）；
2. 重置 CI-A 明细 `commercial_invoice_items.inbound_qty=0, uninbound_qty=shipped_qty(3)`；
3. 删除 4 条 payment_requests：deposit（tag）、deduction（tag）、**2 条尾款 PR（按 `related_ci_no='CI-2026-885093'` 或 `source_id`）**；
4. 删除 cost_update_logs（`related_ci_no='CI-2026-885093'`）、cost_allocations（`ci_id=CI-A`）、original_inventory_imports（`ci_id=CI-A`）；
5. 删除新建单据链：CI-A → PI-A/PI-B → PO-A/PO-B → logistics（均按 id/remark，均为 E2E2 新建记录，删除无真实数据损失）；
6. **定点恢复 inventory RDM731（Bekasi Warehouse）至测试前字段**：`available_qty=111, weighted_avg_cost=73563.0, inventory_value=8165493.0`（取自测试前副本）；
7. 重算/核对 RDM731 在途字段（预期已为基线 3/0/0，核对即可）；
8. 比对测试前副本，确认无测试残留（含两条尾款 PR 已删、RDM731 字段已还原）。
- 优点：保留任何真实业务数据；精确 revert 被 mutate 的既有行；覆盖无标签尾款 PR。
- 结论：推荐方案，但须由用户授权后另一步执行。

---

## 11. 对原《SYS-E2E-02 报告》需修改的章节与原句清单

| 原章节 | 原表述（需修改） | 修订为 |
|--------|----------------|--------|
| 标题/摘要 | "E2E2-01～08 全部通过" | "E2E2-01~06 单据链路基本通过（附观察）；E2E2-07 失败；E2E2-08 未覆盖" |
| 摘要结论 | "完整业务闭环跑通" | "采购/PI/CI/付款/入库单据链路基本可达；成本与库存闭环失败；完整 E2E 尚未通过" |
| E2E2-07 小节 | "成本确认与加权平均成本：通过" | "失败——调用可达，结果违反冻结成本与库存规则（三处缺陷）" |
| E2E2-07 小节 | （WAC 计算描述为正常） | 增加：原币未换算 LC（P1-WAC）、inventory_value 用旧量（P1-INVVAL）、update-weighted-avg 改 available_qty（P1-03） |
| E2E2-08 小节 | "库存与预测联动：通过（available_qty 111→114 为证据）" | "未覆盖/未完成——未执行 ERP 导入→匹配 WAC→重算金额→预测重读；111→114 系 P1-03 错误产物，不得作为通过证据" |
| 问题清单 | "E2E-P3a WAC 汇率未换算：P3" | "E2E-P1-WAC：P1" |
| 问题清单 | "E2E-P3b inventory_value 旧量：P3" | "E2E-P1-INVVAL：P1" |
| 问题清单 | "E2E-P4 负数量入库：低风险" | "E2E-P1-04：P1" |
| 问题清单 | （原库存导入 DELETE-first 未单列或低级别） | 新增 "E2E-P1-05：P1" |
| 问题清单 | （无 update-weighted-avg 改可用量条目） | 新增 "E2E-P1-03：P1" |
| 数据清单（第 9 节） | "payment_requests 计数 2" | 更正为 **4**（补充两条无标签尾款 PR，并注明其仅能经 CI 关联识别） |
| 数据清单 | 未标注"既有 inventory 行被 mutate" | 新增"8.1 对既有记录的修改"：RDM731 available 111→114、WAC 73563→71627.39、inv_value 8165493→7950640.81 |
| 清理指引（原第 10/清理 9 步） | 隐含"整体恢复"或"按标签删除"可用 | 明确：整体恢复当前禁止（须 9.2 确认）；按标签删除不充分（漏两条尾款 PR + 不 revert inventory）；改列方案 C 外科式清理 |
| 结论 | "全部场景通过、闭环跑通" | 按第 1 节矩阵与第 3 节结论改写 |

---

### 修订完成声明
本轮为**只读事实修订**：未修改代码、未修复问题、未删除/回滚/恢复数据、未新增测试数据、未修改库存或成本、未进入 T1。所有结论均基于 DB 实测比对（测试前副本 vs 当前）与 server.js 代码核对。修订报告即止，等待用户就第 9.2 项确认及后续清理授权。
