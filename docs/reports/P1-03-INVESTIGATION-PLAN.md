# E2E-P1-03 只读排查与实施方案

> **缺陷**：加权平均成本（WAC）计算不得修改库存总表当前可用库存（`inventory.available_qty`）。
> **本轮性质**：只读排查。未修改任何代码、数据库、接口、文档、测试数据；未进入实施。
> **输出**：仅实施方案，待确认后进入正式修复。
> **依据口径**：`E2E2-REVISION-REPORT-20260714.md` 第 5/6 条（当前可用库存唯一事实来源=ERP 最新库存手动导入；WAC 计算不得修改 inventory.available_qty）。

---

## 1. 所有会修改 `inventory.available_qty` 的代码（server.js）

| 行号 | 函数 / 端点 | 写入语句 | 类别 | 是否合规 |
|---|---|---|---|---|
| 1412 | `refreshInventoryTotals()` ← `POST /api/inventory-imports/bulk-import` | `UPDATE inventory SET available_qty = ? ... [imp.available_qty,...]` | ERP 当前库存导入 | ✅ 合规（唯一允许改 available_qty 的路径） |
| 1532 | `POST /api/outbound-records` | `UPDATE inventory SET available_qty = available_qty - ?` | 其他调整-出库扣减 | ✅ 合规 |
| 1665 | `POST /api/outbound-records/bulk-import` | `UPDATE inventory SET available_qty = available_qty - ?` | 其他调整-出库批量扣减 | ✅ 合规 |
| 4769 | `POST /api/cost-allocation/update-weighted-avg/:ci_id` | `UPDATE inventory SET available_qty = ? ... [newQty,...]` | **WAC 计算** | ❌ **P1-03 违规点** |
| 4772-4773 | 同上（INSERT 分支） | `INSERT INTO inventory (..., available_qty, ...) VALUES (..., newQty, ...)` | **WAC 计算** | ❌ **P1-03 违规点** |
| 4877 | `POST /api/inventory-checks/:id/approve` | `UPDATE inventory SET available_qty = available_qty + ?` | 其他调整-盘点差异 | ✅ 合规 |
| 5462 | `POST /api/outbound-records/batch-void` | `UPDATE inventory SET available_qty = available_qty + ?` | 其他调整-出库作废回滚 | ✅ 合规 |
| 5699 | `POST /api/inventory-adjustments/:id/approve` | `UPDATE inventory SET available_qty = ?` | 其他调整-手动库存调整 | ✅ 合规 |

> **注**：`updateInventoryTransitData()`（1425）只改 `in_transit_qty / pi_confirmed_unshipped_qty / po_unconfirmed_pi_qty`，**不碰 available_qty**。
> **注**：`recalcInventoryForSku()`（5146）只改周转/状态，**不碰 available_qty**。

### 易混淆但**不**修改 `inventory.available_qty` 的点（需在修复时避免误伤）

| 行号 | 说明 | 处置 |
|---|---|---|
| 2796-2797 | `UPDATE replenishment_suggestions SET available_qty=?` —— 这是**补货建议快照表**的独立列，非库存总表 | 不动 |
| 4083-4112 | `updateWeightedAvgCost()` —— 注释明确"不改库存数量"，只写 `inventory.weighted_avg_cost / inventory_value` 与 `skus.weighted_avg_cost` | 保留（其原币未换算问题属 **P1-WAC**，不在本任务范围） |
| 4116-4118 | `updateInventoryAfterInbound()` —— 已 `return;` 死代码，本就不执行 | 保留（设计意图=入库不改数量，与新流程一致） |
| 4756 | `update-weighted-avg` 内 `SELECT ... available_qty` —— 只读取值用于算 WAC 分母 | 保留读取，仅去掉写入 |

---

## 2. 分类结果

- **ERP 当前库存导入（应保留）**：`refreshInventoryTotals`（1412）+ 其 INSERT 分支（1415）。这是唯一被正式口径允许的 available_qty 写入方。
- **WAC 计算（须修复）**：`POST /api/cost-allocation/update-weighted-avg/:ci_id`（4761 计算 newQty，4769/4772 错误写入 available_qty）。**P1-03 唯一修复对象**。
- **入库（当前已正确，无需改）**：`updateInventoryAfterInbound` 为死代码；`POST /api/inbound-records` 只改 CI 明细 `inbound_qty` 与在途，不改 available_qty。符合新流程。
- **库存初始化**：无独立初始化入口；`refreshInventoryTotals` 的 INSERT 分支在 inventory 无对应行时新建含 available_qty 的行，属 ERP 导入副作用，归 ERP 导入类。
- **其他库存调整（应保留）**：出库扣减（1532/1665）、出库作废回滚（5462）、盘点差异（4877）、手动库存调整单审批（5699）。均为真实业务增减，合规。

---

## 3. 完整调用链

### 3.1 违规链（P1-03）
```
前端 成本管理页(CI WAC 详情) renderCI / loadWacDetail
  → app.js:6450 updateWeightedAvg(ciId)
  → confirm("这将修改库存表中的数量和成本")            ← UI 文案也需改
  → POST /api/cost-allocation/update-weighted-avg/:ci_id   (server.js:4711)
      → 校验 cost_confirmed / cost_allocated / 原库存已导入 / 有分摊记录
      → 遍历 cost_allocations:
          originalQty = original_inventory_imports.original_qty
          inboundQty  = alloc.inbound_qty
          newQty = originalQty + inboundQty              (server.js:4761)  ← 仅应作 WAC 分母
          newAvgCost = (originalQty*oldAvgCost + inboundQty*unitLandingCost)/newQty
          UPDATE inventory SET available_qty = newQty,   (server.js:4769)  ← ❌ 违规写入
                             weighted_avg_cost = newAvgCost,
                             inventory_value = available_qty * newAvgCost  ← 用错量(newQty)算金额
          [无 inventory 行时 INSERT ... available_qty = newQty] (4772)     ← ❌ 违规写入
          UPDATE skus SET weighted_avg_cost = newAvgCost (4777)
          UPDATE cost_allocations SET original_qty/original_avg_cost (4780)
          INSERT cost_update_logs (4784)  ← 含 new_qty（历史快照，可保留）
```

### 3.2 合规链（ERP 当前库存导入）
```
前端 库存总表页 导入功能
  → app.js:2368 bulk-import
  → POST /api/inventory-imports/bulk-import              (server.js:1306)
      → 写 inventory_imports
      → refreshInventoryTotals(snapshotCutoffDate)        (server.js:1392)
          → 取每 SKU+国家+仓库 最新导入行
          → UPDATE inventory SET available_qty = imp.available_qty,  ← ✅ 唯一合法写入
                             weighted_avg_cost = wac, inventory_value = available_qty*wac
          → updateInventoryTransitData()                 (1420)
```

### 3.3 其他合规调整链（摘要）
- 出库：`POST /api/outbound-records`(1518) / `bulk-import`(1613) / `batch-void`(5439) → available_qty 减/加。
- 盘点：`POST /api/inventory-checks/:id/approve`(4865) → handle_method='adjust' 时 available_qty + diff_qty。
- 手动调整：`POST /api/inventory-adjustments/:id/approve`(5689) → available_qty = 旧+adjust_qty。

---

## 4. 受影响接口

### 4.1 须修改的接口（修复 P1-03）
- `POST /api/cost-allocation/update-weighted-avg/:ci_id`（server.js:4711）—— 去掉对 `available_qty` 的写入；`inventory_value` 改用真实当前 `available_qty` 计算。

### 4.2 关联但本轮不修改的接口（仅说明影响）
- `POST /api/original-inventory/import`（4551）：写 `original_inventory_imports`，**不改** available_qty —— 符合新流程"导入入库前库存数量"步骤。
- `POST /api/inventory-imports/bulk-import`（1306）：ERP 导入，合法写入 available_qty —— **新需求要求其后"自动匹配最新已确认 WAC"**，见第 7 节关联子任务。
- 读取类接口（值将因修复而变得与 ERP 一致，无需改逻辑）：
  - `GET /api/inventory`（1330）
  - `GET /api/replenishment-suggestions`（2486，以 inventory.available_qty 为实时基数）
  - `GET /api/order-forecast`（4914）
  - `GET /api/dashboard`、`GET /api/stagnant`（呆滞分析）

---

## 5. 受影响页面

| 页面 | 模块 | 与 available_qty 关系 | 是否需改动 |
|---|---|---|---|
| 成本管理（CI WAC 详情） | 财务 | 触发 `update-weighted-avg`（违规点）+ 确认文案/结果弹窗误称"修改数量" | ✅ 需改文案（6451/6457） |
| 库存总表 | 库存管理 | 显示 available_qty；含库存导入(合法)与手动调整单审批(合法) | 显示随修复自动正确；无需逻辑改 |
| 库存盘点 | 库存管理 | 审批调整写 available_qty（合规） | 否 |
| 销售数据（出库） | 销售 | 出库扣减/作废回滚写 available_qty（合规） | 否 |
| 入库管理 | 采购链 | 不改 available_qty（合规） | 否 |
| 订单预测 | 销售 | 读 available_qty | 否（值将更准） |
| 首页看板 | 首页 | 读库存总量 | 否 |
| 呆滞分析 | 库存管理 | 读 available_qty | 否 |

---

## 6. 受影响数据库字段

**受保护字段（修复核心）**
- `inventory.available_qty` —— 仅允许被 ERP 导入（`refreshInventoryTotals`）及合规业务调整（出库/盘点/手动调整）修改；WAC 计算禁止写。

**WAC 计算仍应写（非 available_qty）**
- `inventory.weighted_avg_cost` —— 写最新已确认 WAC（4769/4777 继续写）。
- `inventory.inventory_value` —— 改为 `available_qty(真实) * new_avg_cost`（4769 修正计算基数）。
- `inventory.last_inbound_date` —— 时间戳，可保留。
- `skus.weighted_avg_cost` —— 继续写（SKU 级当前成本）。
- `cost_allocations.original_qty / original_avg_cost` —— 继续写（4780）。
- `cost_update_logs` —— 现有字段已含 `original_qty/old_avg_cost/inbound_qty/new_qty/new_avg_cost`（4784）；**作为"加权平均成本历史"的雏形，需扩展为独立表**（见第 7 节新需求）。

**新增需求相关字段（独立设计任务，不在 P1-03 代码改动内，但需一并规划）**
- 新表 `wac_history`（建议）：`version_no, ci_no, po_no, sku_code/model, brand, country, warehouse, original_qty, original_avg_cost, original_inventory_amount, inbound_qty, unit_landing_cost, total_landing_cost, new_avg_cost, settle_date, confirm_status, confirmed_by, confirmed_at`。
- `inventory` 增加"当前最新已确认 WAC 版本号"外键或冗余列（可选，用于匹配）。

---

## 7. 修改后应保持的新业务流程 + 实施方案（仅方案，待确认）

### 7.1 目标新流程（用户给定）
```
CI
 ↓
导入入库前库存数量（original-inventory/import，仅存 original_inventory_imports）
 ↓
计算并保存 WAC（update-weighted-avg：仅算成本，不碰 available_qty）
 ↓
生成 WAC History（cost_update_logs → 扩展为 wac_history，锁定历史版本）
 ↓
等待 ERP 当前库存导入（inventory-imports/bulk-import）
 ↓
更新库存总表 current available（refreshInventoryTotals 写 available_qty）
 ↓
自动匹配最新 WAC（ERP 导入时匹配 inventory.weighted_avg_cost / wac_history 最新版）
 ↓
重新计算库存金额（inventory_value = available_qty * 最新已确认 WAC）
```

### 7.2 P1-03 修复步骤（最小改动，仅动违规点）
1. **server.js:4761** 保留 `newQty = originalQty + inboundQty`（仅作 WAC 公式分母，语义不变）。
2. **server.js:4769** 改为：
   `UPDATE inventory SET weighted_avg_cost = ?, inventory_value = available_qty * ?, last_inbound_date = ?, updated_at = datetime('now') WHERE id = ?`
   即**删除 `available_qty = ?` 这一项**，且 `inventory_value` 用真实 `available_qty`（不再用 newQty）。参数去掉 `newQty`。
3. **server.js:4772-4773** INSERT 分支：去掉 `available_qty`（改为默认 0 或不写入，让 ERP 导入负责数量），即不再以 newQty 初始化库存行数量。
4. **app.js:6451** 确认框文案：`"确认更新加权平均成本？这将修改库存表中的数量和成本。"` → `"确认更新加权平均成本？此操作仅更新成本，不修改库存当前可用数量。"`
5. **app.js:6457** 结果弹窗列名 `"新库存"`（=new_qty）→ 改为 `"WAC计算分母(原+入库)"`，避免误导为"当前库存"。

### 7.3 关联子任务（属新增冻结需求，单独排期，不混入 P1-03 最小修复）
- **A. WAC History 独立表**：建 `wac_history`（字段见第 6 节），`update-weighted-avg` 成功后在其中插入锁定版本（版本号规则：同 SKU+国家+仓库 自增）。
- **B. ERP 导入匹配最新 WAC**：在 `refreshInventoryTotals`（1404）将 `wac = imp.weighted_avg_cost` 改为取 `inventory.weighted_avg_cost`（最新已确认）或 `wac_history` 最新版；`inventory_value = available_qty * wac`。确保"ERP 导入只改数量、自动匹配 WAC、不重算历史版本"。
- **C. 库存总表只引用最新已确认版本**：`inventory.weighted_avg_cost` 即"当前最新已确认 WAC"；`original_inventory_imports` 与 `wac_history` 仅作历史。

### 7.4 验证口径（修复后）
- 用 E2E2 同款 RDM731 重跑：执行 `update-weighted-avg` 后 `inventory.available_qty` 应保持 ERP 值（不受 111→114 影响）；`weighted_avg_cost` 更新；`inventory_value = 真实available_qty * 新WAC`。
- 回归：出库/盘点/手动调整仍正确加减 available_qty；ERP 导入仍正确刷新 available_qty。
- 注意：本轮修复**不**解决 P1-WAC（原币未换算）、P1-INVVAL（旧量计算，部分随本修复缓解但旧量问题根因仍在 inventory_value 计算时机，需单独确认）等并行缺陷。

---

## 8. 本轮未做事项（冻结/约束）
- 未修改任何 `.js` / `.html` / `.md` 现有文件内容（本报告为新文件，非修改既有文档）。
- 未改动数据库、未跑任何写入、未清理 E2E2 测试数据、未整体恢复、未进入实施。
- 等待用户确认后，再按第 7.2 / 7.3 进入正式修复（建议先 7.2 最小修复 + 回归，再排 7.3 关联子任务）。
