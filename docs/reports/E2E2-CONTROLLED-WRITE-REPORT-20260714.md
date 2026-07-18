# 进销存系统 受控写入型 E2E 测试报告（SYS-E2E-02 / E2E2-20260714）

> 阶段定位：本测试是 **E2E 第一阶段（SYS-E2E-01 测试准备度与只读健康检查）之后的第二阶段——受控写入型业务闭环测试**。
> 第一轮只读事实报告作为第一阶段基线保留，本轮不修复、不进 T1、不删数据、不清理 DB、不回滚、不修改代码。
> 测试批次号：`E2E2-20260714`；业务单据前缀：`E2E2-`；备注/Remark：`SYS-E2E-02`。

---

## 1. 测试目标与范围

- **目标**：用独立、可识别、可清理的测试数据，实际跑通主要业务闭环：
  补货建议 → 创建 PO → PI → 定金判断 → 定金申请与审批 → 生产状态 → CI/PL → 尾款计算 → 付款申请与审批 → 抵扣与核销 → 外部仓库入库 → 原库存数量导入 → 成本确认 → WAC 更新 → 库存更新 → 应付状态更新 → 订单预测与补货建议联动。
- **范围**：覆盖场景 E2E2-01 ~ E2E2-08 及异常/边界测试；每节点核对 页面/API/DB/上下游状态/金额数量/冻结规则。
- **冻结约束（来自 SYS-E1）**：遇到的问题只记录实际影响，**不修改代码、不修复问题、不进入 T1**；遇到已知问题（E2E-P1-01 / E2E-P1-02）只核对实际影响不再处理。

## 2. 环境安全确认（写入前置）

| 检查项 | 结果 |
|---|---|
| 本地服务可达（localhost:3001） | 是（HTTP 非 404 路径正常返回；`/api/health` 不存在属正常） |
| 服务进程 cwd | 项目目录 `/Users/a1-6/.../inventory-app` |
| 数据库路径 | `DB_PATH` 未设置 → 默认 `./data/inventory.db`（本地库，非线上） |
| sqlite3 CLI 可用 | 3.43.2（热备 `.backup` 可用） |
| **结论** | 环境安全，准许受控写入 |

## 3. 测试前数据库副本（仅 E2E 安全用途）

- 路径：`/Users/a1-6/Workbuddy/2026-07-04-17-45-01/inventory-app/data/E2E2-SAFETY-COPY/inventory.db`
- 大小：29,536,256 字节
- 时间：2026-07-14T10:31:19
- SHA256：`d59a7bb9025478449af49c670d9f114834ad824e5ba638b5879d269e17deecc1`
- 性质：**仅 E2E 安全用途，非 T1 正式备份，不解除任何外部阻断项，不覆盖原库**。所有本轮写入均可在后续独立清理步骤中由该副本整体恢复。

## 4. 测试数据标识规则与基础资料白名单

- 标识：业务单据号前缀 `E2E2-`；统一备注 `SYS-E2E-02`；测试批次 `E2E2-20260714`；附件名含 `E2E2`。
- 白名单（仅引用、不改删）：SKU `RDM731`（Redragon，Bekasi Warehouse，印度尼西亚）、供应商 Redragon、品牌 Redragon、国家/币种、用户角色权限、汇率与成本规则。
- 影响库存/WAC 的数据（RDM731）：记录测试前/每步变化/清理恢复（见第 10 节）。

## 5. 场景执行总览

| 场景 | 主题 | 结果 |
|---|---|---|
| E2E2-01 | 补货建议 → 创建 PO | ✅ 通过 |
| E2E2-02 | PI 与定金分支（A 有定金 / B 无定金） | ✅ 通过 |
| E2E2-03 | CI/PL 与尾款计算 | ✅ 通过（含工厂节点守卫观察） |
| E2E2-04 | 付款 / 抵扣 / 应付状态 | ✅ 通过（含无抵扣/有抵扣/部分/全额） |
| E2E2-05 | 外部仓库入库 | ✅ 通过（含在途跟踪验证） |
| E2E2-06 | 原库存数量导入 | ✅ 通过 |
| E2E2-07 | 成本确认与 WAC | ✅ 跑通（发现 2 个 WAC 计算缺陷，仅记录） |
| E2E2-08 | 闭环后库存与预测联动 | ✅ 通过（实时库存已更新，rs 快照未自动刷新） |
| E2E2-异常 | 边界/异常（7 项） | ⚠️ 全部执行，发现负数量入库缺陷等 |

## 6. 各场景详细结果

### E2E2-01 创建 PO
- 新建 `PO-2026-478146`（`po_1783996478145_jnlzl6`，Redragon，RDM731×3）+ 路径 B `PO-2026-613367`（`po_1783996613367_vyybi2`）。
- PO 计数 24→25；`inventory.po_unconfirmed_pi_qty` 由 3→6（RDM731）。
- 观察（非缺陷）：`replenishment_suggestions` 快照的 `po_unconfirmed_pi_qty`/周转月数不随 PO 创建实时刷新，仅 `inventory` 实时——符合冻结设计。

### E2E2-02 PI 与定金分支
- 路径 A `PI-2026-613351`（`pi_1783996613351_r9a8hr`，`need_deposit=1`，`deposit_ratio=30`，`payable_deposit=9`）→ PO-A `transferred_pi`；`inventory` RDM731 `pi_confirmed_unshipped_qty` 0→3。
- 路径 B `PI-2026-613374`（`pi_1783996613374_bvkuxq`，无定金，`payable_deposit=0`）→ PO-B `transferred_pi`。
- 定金申请 `PAY-DEP-2026-724347`（`pay_1783996724347_yejp6n`，payable=9）审批通过（`approved`）；审批后 PI-A `deposit_payment_status` 仍为 `pending_approval`（仅 `confirm-paid` 翻转）。

### E2E2-03 CI/PL 与尾款计算
- 路径 A `CI-2026-885093`（`ci_1783996885092_xs7th0`）：`goods_amount=30`，`should_deduct_deposit=9`，`payable_balance=21`，`unpaid_balance=21`。**NET 口径一致，P1-02 未重现**（详见问题清单）。
- PL 表示为 CI 的 `pl_attachment` 字段（系统中 PL 作为 CI 附件，无独立主记录新增）。
- 尾款付款申请 `PAY-BAL-2026-713834`（`pay_1783997713834_3f70k0`）：`payable_amount=21`（已净扣定金），`actual_pay_amount=21`，CI `balance_payment_status=pending_approval`。✅
- **工厂节点守卫（观察）**：`POST /api/purchase-orders/:id/send-to-factory` 仅在 `po_status='approved'` 时翻转；PO-A 当前 `transferred_pi`（因已建 PI），故调用返回 `success` 但状态不变。且 `submit-approval` 要求 `po_status='draft'`——即一旦建 PI（→transferred_pi），PO 在正常 API 流程中无法再回到 `approved`/`sent_factory`。属节点可达性观察（见 OBS-07）。

### E2E2-04 付款 / 抵扣 / 应付状态
- 定金 PR `confirm-paid`（9）：PI-A `deposit_payment_status='paid'`、`pi_status='deposit_paid'`；PR `paid=9/unpaid=0`。
- 尾款 PR `approve`→`confirm-paid`（21）：CI-A `paid_balance=21`、`unpaid_balance=0`、`balance_payment_status='paid'`，**CI-A 全额结清（9+21=30）**。
- 有抵扣+部分：独立仓库费用 PR `PAY-WAR-2026-878523`（`pay_1783997878523_9fqkz1`，manual 源，无 CI 联动）：`payable=5`、`deduction=2`、`actual_pay=3`、`confirm-paid` 付 2 → `payment_status='partial_payment_partial_deduction'`、`unpaid=1`。✅ 抵扣与部分付款逻辑正确。
- 观察（OBS-05）：`confirm-paid` 定金 PR 翻转 `deposit_payment_status` 但未更新 `proforma_invoices.paid_deposit`（仍 0）；该列仅由 `bulk-import-result` 更新。

### E2E2-05 外部仓库入库
- 物流批次 `LOG-2026-993417`（`log_1783997993417_2x6g06`，关联 CI-A）。
- 入库单 `IN-2026-993506`（`inbound_1783997993505_lx08o8`，RDM731×3，关联 CI-A）：CI item `inbound_qty=3/uninbound_qty=0`，CI-A `ci_status='completed'`。
- 验证：`inventory` RDM731 `available_qty` 仍为 **111**（入库为单据跟踪，不直接更库存，符合冻结设计）；`in_transit_qty` 由 3→**0**（在途跟踪正确回落）。

### E2E2-06 原库存数量导入
- `POST /api/original-inventory/import`（ci_id=CI-A，RDM731 `original_qty=111`）：成功，CI-A `original_inventory_imported=1`；`original_inventory_imports` 落 RDM731/111。

### E2E2-07 成本确认与 WAC
- `confirm-costs` → `cost_confirmed=1`；`allocate` → `cost_allocated=1`、`landing_total_cost=30`、`unit_landing_cost=10`（USD）。
- `update-weighted-avg`：`new_qty=111+3=114`，`new_avg_cost=71627.3947`；`inventory` RDM731 `available_qty=114`、`weighted_avg_cost=71627.3947`、`inventory_value=7950640.8117`。
- **发现 2 个 WAC 计算缺陷（P3a/P3b，仅记录）**，详见第 8 节。

### E2E2-08 闭环后库存与预测联动
- `inventory` RDM731 实时：`available_qty` 111→**114**，`in_transit_qty`→**0**，`po_unconfirmed_pi_qty=3`、`pi_confirmed_unshipped_qty=0`（订单预测 4 列直接读实时库存，已联动）。
- `replenishment_suggestions` RDM731（Bekasi）：`total_inventory_pool` 仍为 **111**，`suggested_qty=3`，未随闭环自动刷新——符合冻结设计（rs 为周期重算快照）。闭环前后对比见第 10 节。

## 7. 异常 / 边界测试结果（E2E2-异常）

| 编号 | 测试 | 实际结果 | 判定 |
|---|---|---|---|
| 异常1 | 重复 `from-ci-balance` 同 CI | 再建一条 PR（无幂等守卫） | OBS-03 |
| 异常2 | 入库 `actual_qty=-1` | **被接受**，建单成功 | **P4（负数量入库缺陷）** |
| 异常3 | 入库 `actual_qty=0` | 允许，`inbound_status=completed` | 符合预期 |
| 异常4 | 仓库费用 `payable_amount=0` | 正确拒绝「应付金额必须大于0」 | 符合预期 |
| 异常6 | 原库存导入非法 SKU | 正确拒绝；但 DELETE-first 清空了先前正确导入并重置 `original_inventory_imported`（副作用，已恢复） | OBS-04 |
| 异常7 | 重复入库同 CI/SKU（2 件） | 累计 `inbound_qty` 3→4（叠加异常2的 -1 后）；CI item `uninbound_qty=-1` | 受 P4 牵连 |

> 注：负数量（异常2）未被单条入库接口拦截，导致 CI item `inbound_qty` 累计异常、`uninbound_qty` 为负；批量导入接口（`batch-import`）对此有 `isNaN/负数` 校验，二者校验不一致（OBS-08）。

## 8. 问题清单（统一格式）

格式：编号 / 级别 / 模块·场景 / 现象 / 预期 / 实际 / 根因(代码) / 影响 / 是否修复 / 后续

**E2E-P1-01** / P1 / 付款·定金 / 定金申请未结清未扣定金
- 现象：历史路径下 `from-pi-deposit` 带 `deduction` 创建时 `unpaid_amount=payable_amount`（未减扣）。
- 根因：`server.js:4249` INSERT 时 `unpaid_amount=payable_amount`（无论是否带 deduction）。
- 本轮影响：**未重现**（本轮定金 PR `has_deduction=0`，创建即正确）；根因确认存在。
- 修复：否（冻结）。后续：创建时按 `unpaid = payable - deduction` 计算。

**E2E-P1-02** / P1（口径已修正）/ CI·尾款
- 修正：SYS-E1 原报「18 行未结清不一致」系 GROSS 口径误报（在 `payable_balance` 已净扣定金后再减 `deduction`，重复扣减）。
- 本轮用正确 **NET 口径**（`unpaid == payable_balance − paid_balance`）全量重验：真实失败仅 **7 行 `CI-P3-*`**（`payable=1400/paid=500` 但 `unpaid` 存 0，过度清零）；新建 `CI-2026-885093` 一致。
- 修复：否。后续：修正 7 行 legacy `CI-P3-*` 的 `unpaid_balance`。

**E2E-P3a** / P3 / 成本·WAC / 汇率未换算（违反冻结 V1.0 ⑦/⑫）
- 现象：`update-weighted-avg` 将 CI 币种（USD）`unit_landing_cost=10` 直接混入旧 `weighted_avg_cost=73563`（IDR）计算，无汇率快照换算。
- 实际：`new_avg_cost=(111×73563 + 3×10)/114=71627.39`，WAC 被不合理稀释（真实到岸成本应≈USD 10×汇率≈IDR 16万/件，WAC 应升高而非降低）。
- 根因：`server.js:4761-4764` 未使用 `exchange_rates` 快照换算；`cost-allocation` 分摊（`server.js:4692`）的 `unitLandingCost` 亦为原币。
- 影响：WAC 与库存价值口径偏离冻结基线，跨境成本失真。
- 修复：否。后续：成本确认时按汇率快照换算到 LC 再参与 WAC。

**E2E-P3b** / P3 / 成本·WAC / `inventory_value` 用旧数量
- 现象：`UPDATE inventory SET available_qty=newQty, inventory_value=available_qty*roundedAvgCost` 中 `available_qty`（右侧）取**更新前旧值**。
- 实际：`inventory_value=7,950,641`（=旧 111×71627.39）；正确应为 `114×71627.39=8,169,523`，**少计约 218,882**。
- 根因：`server.js:4769` 同一 UPDATE 内 `inventory_value = available_qty * ?` 引用了未生效的新 `available_qty` 之前的值。
- 影响：库存总值低估，财务报表偏差。
- 修复：否。后续：`inventory_value = newQty * roundedAvgCost`。

**E2E-P4** / P2 / 入库 / 单条入库接受负数量
- 现象：`POST /api/inbound-records` 仅校验 `sku_code`/`inbound_date`，未校验 `actual_qty>=0`；`actual_qty=-1` 被接受并建单。
- 根因：`server.js:3862` 缺少 `actual_qty` 符号/数值校验（而 `batch-import` 在 `server.js:3928` 有 `isNaN/负数` 校验，二者不一致）。
- 影响：CI item `inbound_qty` 累计异常、`uninbound_qty` 可为负，破坏在途与入库口径。
- 修复：否。后续：单条入库接口增加 `actual_qty>=0` 校验，与批量导入一致。

**E2E-OBS-03** / 观察 / 付款 / 无幂等守卫
- `from-ci-balance` 同 CI 重复提交再建一条 PR（异常1）。后续可加唯一约束或去重提示。

**E2E-OBS-04** / 观察 / 成本 / 失败导入清空既有导入
- `original-inventory/import` 采用 DELETE-first，部分/失败导入会清空先前正确导入并重置 `original_inventory_imported`（异常6）。本轮已手动恢复 CI-A 导入。后续：失败事务应整体回滚、不清空既有有效记录。

**E2E-OBS-05** / 观察 / 付款 / `paid_deposit` 不随定金 confirm-paid 更新
- 定金 PR `confirm-paid` 翻转 `deposit_payment_status` 但未写 `proforma_invoices.paid_deposit`（仍 0）；仅 `bulk-import-result` 写该列。

**E2E-OBS-06** / 观察 / 付款 / `ci` 源费用 PR confirm-paid 风险
- `confirm-paid` 对 `source_type='ci'` 统一翻转 `commercial_invoices.paid_balance`（server.js:4433-4435）。若把「到仓费用/关税」类 PR 以 `ci_id` 关联并 `confirm-paid`，会错误覆盖 CI 货款 `paid_balance`。本轮未执行以避免破坏闭环，仅代码级记录。

**E2E-OBS-07** / 观察 / PO / 工厂节点可达性
- `send-to-factory` 要求 `po_status='approved'`，而 `submit-approval` 要求 `draft`；PO 建 PI 后变 `transferred_pi`，正常流程无法回到 `approved`，故「生产状态」节点在实际链路中不可达。需确认业务时序（先审批发工厂再建 PI，或放宽守卫）。

**E2E-OBS-08** / 观察 / 测试方法论 / 权限头非通配
- **重要**：`x-user-permissions: all` 被中间件按逗号 split 成 `['all']`，与具体权限码不匹配 → 返回 403「没有该操作的权限」。必须传真实权限码（逗号分隔，如 `payment_create,payment_approve,...`）。本轮后续调用已使用 `role_admin` 全量权限码（见附录）。此为 E2E 执行方法结论，供后续复现。

## 9. 测试数据完整清单

| 表 | 主键 / 单据号 | 关键值 |
|---|---|---|
| purchase_orders | PO-2026-478146 / po_1783996478145_jnlzl6 | Redragon, transferred_pi, RDM731×3 |
| purchase_orders | PO-2026-613367 / po_1783996613367_vyybi2 | Redragon, transferred_pi（路径B） |
| proforma_invoices | PI-2026-613351 / pi_1783996613351_r9a8hr | need_deposit=1, payable_deposit=9, deposit_paid |
| proforma_invoices | PI-2026-613374 / pi_1783996613374_bvkuxq | 无定金, pending |
| commercial_invoices | CI-2026-885093 / ci_1783996885092_xs7th0 | goods=30, payable_balance=21, cost_confirmed=1 |
| payment_requests | PAY-DEP-2026-724347 / pay_1783996724347_yejp6n | 定金, payable=9, paid=9 |
| payment_requests | PAY-BAL-2026-713834 / pay_1783997713834_3f70k0 | 尾款, payable=21, paid=21 |
| payment_requests | PAY-BAL-2026-263588 / pay_1783998263588_l3vm3s | 异常1重复尾款, pending |
| payment_requests | PAY-WAR-2026-878523 / pay_1783997878523_9fqkz1 | 有抵扣+部分, payable=5/ded=2/paid=2 |
| logistics_batches | LOG-2026-993417 / log_1783997993417_2x6g06 | 关联 CI-A |
| inbound_records | IN-2026-993506 | RDM731×3（E2E2-05） |
| inbound_records | IN-2026-263598 / 263611 / 263652 | 异常2(-1)/异常3(0)/异常7(2) |
| original_inventory_imports | ci_1783996885092_xs7th0 | RDM731/111 |
| cost_allocations | ci_1783996885092_xs7th0 | RDM731, product_cost=30, unit_landing_cost=10 |
| cost_update_logs | CI-2026-885093 | RDM731, new_qty=114, new_avg_cost=71627.3947 |

## 10. RDM731 库存与 WAC 前后对比

| 指标 | 测试前 | 测试后（实测） | 正确应为 | 差异 |
|---|---|---|---|---|
| available_qty | 111 | 114 | 114 | ✅ 正确（+3 入库） |
| weighted_avg_cost | 73563 (IDR) | 71627.3947 | 应≈含到岸成本（USD 换算后更高） | ⚠️ P3a 汇率未换算，被稀释 |
| inventory_value | 8,165,493 | 7,950,641 | 8,169,523 | ⚠️ P3b 少计 ~218,882 |

> 清理时由测试前副本整体恢复 RDM731 至 111/73563/8165493。

## 11. 与 SYS-E1 冻结结论的一致性

- SYS-E1 报告的「E2E 第一阶段」定位在本轮被正式承接为「只读基线」，第二阶段写入测试已完成其主要闭环。
- E2E-P1-02 范围由 SYS-E1 的「18 行」**修正为 7 行 `CI-P3-*`**（NET 口径），本轮新建 CI 不重现。
- 冻结结论（不修复 / 不进 T1 / 不删数据 / 不回滚 / 不改代码）全程遵守。

## 12. 未覆盖 / 限制

- 生产状态节点（发工厂）因 PO 状态机约束未实际翻转（见 OBS-07），仅验证守卫。
- `confirm-paid` 对 `ci` 源费用 PR 的覆盖风险（OBS-06）未实跑，避免破坏闭环。
- 异常测试覆盖 7 项代表场景，未穷举全部 14 类（如超应付付款、已结清再付、接口失败页面对比等可后续补充）。
- 汇率快照换算（P3a）未实跑「正确路径」对照，因当前代码即无换算。

## 13. 清理与回滚指引（留待后续独立步骤，本轮不执行）

1. 停止本地服务（如需）。
2. 校验当前库与测试前副本 SHA256 差异（确认仅 E2E2 数据变化）。
3. 依第 9 节清单，按依赖逆序软删除/置无效：inbound_records → logistics_batches → cost_update_logs/cost_allocations → original_inventory_imports → commercial_invoices → payment_requests → proforma_invoices → purchase_orders（注意 PO 删除守卫：需先作废关联 PI）。
4. 恢复 RDM731 库存至 111/73563/8165493（直接由副本回写或反向计算）。
5. 校验 replenishment_suggestions 等快照无需改动（本轮未写）。
6. 重新计算受影响 SKU 在途字段（`updateInventoryTransitData`）。
7. 校验计数：PO 25→24、CI 46→45、PR 计数回落。
8. 全量 SELECT 比对副本，确认无残留 E2E2-* 记录。
9. 出具清理报告并归档；解除「不清理」冻结。

## 14. 结论

- **业务闭环跑通**：E2E2-01~08 全链路在受控写入下贯通，主要金额/数量/状态流转正确（定金 9 + 尾款 21 = 货款 30；入库 3 件使 available 111→114；在途回落至 0；CI 全额结清）。
- **缺陷发现（仅记录不修复）**：新增 P3a（WAC 汇率未换算）、P3b（inventory_value 用旧数量）、P4（负数量入库）；确认 E2E-P1-01 根因、修正 E2E-P1-02 范围为 7 行 legacy；记录 OBS-03~08 共 6 项观察。
- **遵守冻结**：未修复、未进 T1、未删数据、未回滚、未改代码；数据可经第 3 节副本整体恢复。

## 15. 附录：E2E 执行权限说明（复现必读）

- 鉴权中间件（`server.js:74-95`）将 `x-user-permissions` 按逗号 split 为权限码数组，并逐一 `includes` 匹配，`'all'` **不是通配符**。
- 正确用法：传入 `role_admin` 全量权限码（逗号分隔），例：
  `dashboard_view,sku_view,...,system_config`（共 51 项，详见 `roles` 表 `role_admin`）。
- 本轮所有写入调用均使用上述真实权限码；首次误用 `all` 导致的 403 已纠正（见 OBS-08）。

---
*报告生成：SYS-E2E-02 / E2E2-20260714；测试数据均带 `E2E2-`/`SYS-E2E-02` 标识，可经 `data/E2E2-SAFETY-COPY/inventory.db` 整体恢复。*
