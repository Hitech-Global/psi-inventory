# P1-03 实施方案修订说明（只读）

> 性质：只读修订分析。不修改代码、不修改数据库、不创建 WAC 表、不修复、不修改测试数据、不清理/恢复数据库、不顺带处理汇率/负数入库等其他问题。
> 背景：用户已冻结正式库存与 WAC 口径（SYS-E2E-02 修订报告基线 + 新增「加权平均成本历史」需求）。前一轮 `P1-03-INVESTIGATION-PLAN.md` 提出的"移除 available_qty 写入后仍直接改 inventory.weighted_avg_cost / inventory_value"被判定未完全符合冻结流程，需补充本修订说明。
> 代码事实基准：server.js（update-weighted-avg 路由 4711；updateWeightedAvgCost 4083；refreshInventoryTotals 1392；相关写入行 4769/4773/4777/4104/4099/1403/1412/4780/4784）。

---

## 〇、代码复核补充事实（影响方案判定）

1. **两套并行 WAC 写入实现，均在写 `inventory.weighted_avg_cost` + `inventory_value`**：
   - 路径 A：`allocateCosts`（4010）→ `updateWeightedAvgCost`（4083，4079 调用）。写 `skus.weighted_avg_cost`（4099）、`inventory.weighted_avg_cost` 与 `inventory_value=available_qty*?`（4104）。**不改 available_qty**。
   - 路径 B：`POST /api/cost-allocation/update-weighted-avg/:ci_id`（4711，自包含逻辑）。写 `available_qty=newQty`（4769，P1-03 违规点）、`inventory.weighted_avg_cost`（4769）、`inventory_value=available_qty*?`（4769，用旧量，P1-INVVAL）、`skus.weighted_avg_cost`（4777）、`cost_allocations.original_*`（4780）、`cost_update_logs`（4784）。
   - 结论：路径 B 是唯一实际改动 `available_qty` 的点（E2E 实测 RDM731 111→114 由它产生）。但路径 A 与路径 B 都写 `weighted_avg_cost`/`inventory_value`，修复时**两者必须同时收敛到统一的"已确认版本"来源**，否则会出现两处互相覆盖。

2. **入库不更量已正确**：`updateInventoryAfterInbound`（4116）首行 `return;`（4118）为死代码，入库仅做单据跟踪。与冻结口径一致，无需改动。

3. **ERP 导入当前不"匹配最新已确认 WAC"**：`refreshInventoryTotals`（1392）中 `wac = parseFloat(imp.weighted_avg_cost)`（1403）取自**导入文件列**；`invValue = available_qty * wac`（1404）。即 ERP 导入会用文件里的 WAC 覆盖 `inventory.weighted_avg_cost`。冻结需求要求"自动匹配最新已确认加权平均成本"，因此该处是第三步待改点（不能继续信任文件 WAC）。

---

## 一、成本确认时允许写入的对象（逐字段判定 + 时点 + 数据来源）

> 下列判定针对"成本确认（update-weighted-avg 执行）"这一业务时点。

### 1. inventory.available_qty
- **判定：禁止写入。**
- 现状：路径 B 写 `available_qty = newQty`（4769），INSERT 分支用 `newQty`（4773）。`newQty = originalQty + inboundQty`（4761）只应作 WAC 公式分母。
- 时点：成本确认时**不**拥有 ERP 当前真实可用库存，写入即脱离 ERP 实际（P1-03 核心违例）。
- 数据来源：应只来自 ERP 最新库存手动导入（refreshInventoryTotals）。

### 2. inventory.weighted_avg_cost
- **判定：应更新，但只能作为"最新已确认 WAC 版本"的投影，且必须以锁定的 wac_history 版本为准，禁止从 ad-hoc 重算直接覆盖。**
- 现状：路径 A（4104）、路径 B（4769）、ERP 导入（1412）三处都在写，且来源不统一（重算值 / 文件值）。
- 时点：成本确认锁定本批版本时，该版本成为"latest confirmed" → `inventory.weighted_avg_cost` 引用它。
- 数据来源：**本批 CI 的锁定 wac_history 行的 `new_avg_cost`**，而非路径内临时 `roundedAvgCost` 变量。
- 纠偏（相对前一轮方案）：前一轮"直接改 inventory.weighted_avg_cost"不够——必须由 wac_history 版本驱动，否则批次历史（PO/品牌/确认状态/结算日）丢失，违背冻结需求。

### 3. inventory.inventory_value
- **判定（见第二节详述）：成本确认时不写；等 ERP 导入时以「ERP 最新 available_qty × 最新已确认 WAC」重算。**
- 现状：路径 A（4104）、路径 B（4769，用旧 available_qty → P1-INVVAL）、ERP 导入（1404）三处写。
- 时点：仅在 ERP 库存导入完成后才有正确 available_qty。
- 数据来源：ERP 导入的 `available_qty`（用户手动导入） × `wac_history.latest.new_avg_cost`。

### 4. skus.weighted_avg_cost
- **判定：本轮禁止作为正式成本来源；不得继续写；标记为遗留兼容字段（仅展示，不参与任何 WAC 计算/库存金额）。**
- 现状：路径 A（4099）、路径 B（4777）均 `UPDATE skus SET weighted_avg_cost=? WHERE sku_code=?`——SKU 全局单值，无国家/仓库维度。
- 正式成本来源 = `inventory.weighted_avg_cost`（SKU+国家+仓库） + `wac_history` 版本。详见第四节。

### 5. cost_allocations
- **判定：允许写入。**
- 内容：本批分摊明细（`product_cost`/`allocated_*`/`unit_landing_cost`/`inbound_qty` 等）。属成本计算中间结果，不是库存数量。
- 时点：allocate 与 update-weighted-avg 时。数据来源：CI 明细 + 物流批次 + 付款费用（landing cost）。
- 注：路径 B 还 UPDATE `original_qty`/`original_avg_cost`（4780），用于记录"入库前快照"，保留。

### 6. cost_update_logs
- **判定：允许写入（保留为操作流水），但不能替代 wac_history。**
- 内容：当前唯一的"历史"载体，但字段不全（缺版本号/PO/品牌/确认状态/结算日语义，且未独立锁定）。
- 时点：成本确认时。数据来源：本批计算参数（original_qty/old_avg_cost/inbound_qty/unit_landing_cost/new_qty/new_avg_cost 等）。
- 结论：应被 `wac_history` 取代为权威版本存储；cost_update_logs 可降级为操作审计流水。

### 7. 未来的 WAC 历史表 / 当前成本版本表（wac_history）
- **判定：必须新建，作为唯一权威"已确认成本版本"存储。**
- 内容：用户给定 19 字段（成本版本号、CI 编号、PO 编号、SKU/Model、品牌、国家、仓库、入库前库存数量、原加权平均成本、原库存金额、本批实际入库数量、本批单位落地成本、本批总成本、新加权平均成本、成本结算日、确认状态、确认人、确认时间）+ 主键 + 索引（SKU+国家+仓库 + 版本/状态）。
- 锁定：每次成本确认生成新版本并锁定历史；库存总表只引用 latest 已确认版本；历史版本不可覆盖。
- 数据来源：路径 B 计算出的本批参数 + CI/PO/品牌/国家/仓库上下文。

---

## 二、inventory_value 的更新时间（A vs B，含风险结论）

### 选项 A：WAC 确认时立即用库存总表当前（可能旧）数量重算 inventory_value
- 公式：`inventory_value = 当前 available_qty × 新 WAC`
- 现状代码即此（4769 / 4104）。

### 选项 B：WAC 确认时只保存新成本，等下一次 ERP 当前库存导入时再重算 inventory_value
- 公式（仅 ERP 导入时成立）：`inventory_value = ERP 最新 available_qty × 最新已确认 WAC`

### 结论：必须选 B，不得默认 A。理由（结合用户四点风险）
1. **available_qty 可能仍是 ERP 入库前/上一次导入的旧快照**：本例 RDM731 在 WAC 确认时的 available_qty=111，是 ERP 导入前的旧值，不是 ERP 当前真值。用 111 × 新 WAC 得到的是"旧时点金额"。
2. **新 WAC 已包含本批采购成本**：新旧混合的 cost 与旧量相乘，业务语义错配。
3. **旧库存数量与新 WAC 属于不同业务时点**：乘积无真实库存金额含义，会误导成本/利润分析。
4. **用户随后会单独导入 ERP 最新当前库存**：届时才有正确 available_qty；若 A 已写过一次（旧量×新WAC），ERP 导入又要再写一次（新量×新WAC），产生两次不一致写入与中间态误导。
- **因此**：update-weighted-avg 执行时，`inventory_value` **保持原值/不写**（待 ERP 导入刷新）；冻结公式 `inventory_value = ERP 最新 available × 最新已确认 WAC` 仅在 ERP 导入（refreshInventoryTotals）时成立。这同时消除 P1-INVVAL（旧量计算）。

---

## 三、新 WAC 的正式保存位置 / 最小修复能否在无历史表下安全实施

### 判定：不能。
- 若只移除 available_qty 写入（即前一轮"方案A"），仍把 `new_avg_cost` 直接覆盖到 `inventory.weighted_avg_cost`（甚至 `skus.weighted_avg_cost`），则**批次历史、PO、品牌、确认状态、结算日全部丢失**——正是用户明确禁止的"为追求单点最小修改，继续把新 WAC 只覆盖到 inventory 或 skus 的单值字段而丢失批次历史"。
- 冻结需求已明确：独立历史表 + 锁定版本 + 库存总表只引用 latest 已确认版本。无历史表则无法满足。

### 正确拆分顺序（推荐）
1. **先建立最小 wac_history 版本存储**（建表 + "按 SKU+国家+仓库取 latest 已确认版本"查询函数）。这是权威成本版本源。
2. **再解除 update-weighted-avg 对 available_qty 的写入**：把"生成已确认成本"改为写 `wac_history`（锁定版本），并让 `inventory.weighted_avg_cost` **引用** latest 版本（而非 ad-hoc 重算覆盖）；`inventory_value` 本次不写（见第二节 B）。
3. **再调整 ERP 库存导入**：`refreshInventoryTotals` 不再取文件列 WAC（1403），改为匹配 `wac_history.latest`；`inventory_value = ERP available_qty × matched WAC`（1404/1412/1416）。
4. **最后补完整历史列表页面**（只读查询 + 锁定展示 + 版本对比）。页面可后置，不影响数据正确性与闭环。

> 注：现有 `cost_update_logs` 保留为审计流水，不替代 wac_history（缺版本/状态语义）。

---

## 四、skus.weighted_avg_cost 核对（多国家/多仓库冲突）

### 现状
- 路径 A（4099）、路径 B（4777）：`UPDATE skus SET weighted_avg_cost = ? WHERE sku_code = ?`
- 该字段是 **SKU 全局单值**，无 country/warehouse 维度。

### 冲突判定
- 正式成本维度是 **SKU + 国家 + 仓库**。同一 SKU 在 印度尼西亚(Bekasi) 与 马来西亚/泰国 的已确认 WAC 可能不同。
- 第二批（不同国家）确认时会用 `WHERE sku_code=?` 覆盖整行 → `skus.weighted_avg_cost` 不代表任何确定国家/仓库的真实成本，且若有任何逻辑用它参与 WAC 计算，会跨国家污染。
- 本例 RDM731 仅一国一仓，未暴露冲突，但属设计缺陷，多国部署必现。

### 处理
- **本轮禁止继续写该字段。**
- 明确其为**遗留兼容字段**：仅可用于 SKU 列表页展示"某 SKU 的参考/历史成本"，**绝不作为 WAC 计算或库存金额的输入**。
- 正式成本来源 = `inventory.weighted_avg_cost`（SKU+国家+仓库） + `wac_history` 版本。
- 后续排查（不在本轮）：若任何页面/计算误用 `skus.weighted_avg_cost` 作金额依据，需改为读 `inventory` / `wac_history`。

---

## 五、两个可选实施方案比较

### 方案 A：严格最小修复
- 范围：仅删除路径 B 对 available_qty 的写入（4769 去 `available_qty=?`；4773 INSERT 分支改用真实/原 available_qty 或跳过插入）。路径 A 不动。
- 新 WAC 暂存：仍直接写 `inventory.weighted_avg_cost`（风险：丢批次历史）；或仅内存计算不落库（更糟：下次读取无据）。
- inventory_value：暂不更新（符合第二节 B）。
- 避免历史丢失：**无法避免**——除非同步建最小 wac_history。
- 临时兼容风险：
  - `inventory.weighted_avg_cost` 与本批 CI/PO/品牌脱钩，无版本；
  - `skus.weighted_avg_cost` 仍被写（4099/4777），跨国家污染；
  - ERP 导入仍取文件 WAC（1403）覆盖刚确认的 WAC，造成"确认后被冲掉"；
  - 与冻结需求"独立历史表+锁定版本"不一致，迟早要补，届时 route 需二次改动。

### 方案 B：最小完整闭环
- 范围：
  1. 建最小 `wac_history` 表（19 字段 + 版本/状态/锁定）；
  2. WAC 计算只生成已确认版本：写 wac_history + `inventory.weighted_avg_cost` 引用 latest；
  3. ERP 导入 `refreshInventoryTotals` 匹配 latest WAC（改 1403/1412/1416，不再用文件列）；
  4. `inventory_value` 在 ERP 导入 = ERP available × matched WAC；
  5. 停止写 `skus.weighted_avg_cost`（4099/4777）；
  6. 暂不做完整历史页面（仅数据结构 + 查询 API）。
- 比较维度：

| 维度 | 方案 A | 方案 B |
|---|---|---|
| 改动范围 | 1 函数 2 行 | 建表 + 改 route(4711) + 改 refreshInventoryTotals(1392) + 收敛 allocateCosts/updateWeightedAvgCost(4083) + 停写 skus(4099/4777) + 前端(成本页确认文案、库存导入页 WAC 来源说明) |
| 数据迁移风险 | 无结构变更，但历史缺失 | 需为历史 CI 生成初始 wac_history 版本（可从 cost_update_logs / cost_allocations 回溯，风险可控） |
| 是否需 DB 结构变更 | 否 | 是（DDL 建表） |
| 对现有页面/API 影响 | 页面基本不变（文案需改"修改数量"误述） | 成本页/库存导入页行为变化（导入不再接受/信任文件 WAC，改匹配） |
| 回滚难度 | 易（删两行） | 需回退 DDL + 数据（有 migration 脚本则可控） |
| 是否二次返工 | **必然**（冻结需求要求历史表，迟早补齐，route 二次改动） | **无**（一次到位） |

- 结论：**方案 B 更符合冻结需求、避免二次返工**，但含 DDL 与多函数改动，范围大于"严格最小"。若用户坚持"严格最小且不建表"，只能接受方案 A 的临时兼容风险，并书面记录"历史表待补，届时 route 二次改动"。

---

## 六、当前禁止事项（重申，本轮不执行）
- 修改代码；
- 修改数据库；
- 创建 WAC 表；
- 修复 P1-03；
- 修改测试数据；
- 清理或恢复数据库；
- 顺带处理汇率换算（P1-WAC）、负数入库（P1/P2）、原库存导入 DELETE-first（P1/P2）、重复尾款 PR（P2）、定金 paid_deposit 未更新（P2）、生产节点不可达（P2）等其他问题。

---

## 附：待确认后进入实施的最小动作清单（仅记录，不执行）
1. 建 `wac_history` 表（19 字段 + 版本/状态/锁定 + 索引）。
2. 新增 `getLatestConfirmedWac(sku, country, warehouse)` 查询函数。
3. `POST /api/cost-allocation/update-weighted-avg/:ci_id`：删除 `available_qty` 写入（4769/4773）；改写 wac_history（锁定版本）；`inventory.weighted_avg_cost` 引用 latest；`inventory_value` 本次不写。
4. `allocateCosts`→`updateWeightedAvgCost`（4083）：收敛为只写 cost_allocations；移除对 `inventory.weighted_avg_cost`/`inventory_value`/`skus.weighted_avg_cost` 的写入（避免与 route 双写冲突）。
5. `refreshInventoryTotals`（1392）：WAC 改取 `getLatestConfirmedWac`（不再用文件列 1403）；`inventory_value=available_qty×matched_wac`。
6. 前端：成本页确认文案/结果列（"新库存"→"WAC 计算分母/最新已确认版本"）；库存导入页说明 WAC 来自匹配而非文件。
7. 回归：重跑 RDM731——update-weighted-avg 后 available_qty 保持 ERP 值、WAC 更新并写入 wac_history、inventory_value 待 ERP 导入刷新；出库/盘点/手动调整与 ERP 导入回归正常。
