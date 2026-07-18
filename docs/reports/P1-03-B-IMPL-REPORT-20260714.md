# P1-03-B 实施与针对性回归报告

**任务编号**: P1-03-B-IMP  
**实施日期**: 2026-07-14  
**实施人**: AI Agent  

---

## 1. 实际修改文件

| 文件 | 修改类型 | 说明 |
|------|----------|------|
| `db.js` | 新增 | wac_history 表定义、索引、CI wac_version_id 迁移列 |
| `server.js` | 修改+新增 | latestConfirmedWac/generateWacVersion 函数、update-weighted-avg 路由重写、refreshInventoryTotals 修改、allocateCosts 废弃、wac-history 查询端点、cost-summary 增返 wac_version_id |
| `app.js` | 修改 | 成本确认文案/按钮/结果列、ERP 导入 warning 展示、导入模板说明 |
| `p103b-test.js` | 新增 | 针对性回归测试脚本（8 用例 49 检查点） |

**未修改**: `index.html`（本轮无结构变更）

---

## 2. 精确 diff 摘要

### db.js（+49 行）
1. **wac_history 表**（新增 ~30 行）: 在 `original_inventory_imports` 表之后、索引区之前插入 `CREATE TABLE IF NOT EXISTS wac_history`，含 26 列（id/version_no/ci_id/ci_no/po_id/po_no/pi_id/pi_no/sku_code/model/brand/country/warehouse/original_qty/original_avg_cost/original_inventory_value/inbound_qty/unit_landing_cost/inbound_total_cost/new_avg_cost/settlement_date/confirmation_status/is_locked/confirmed_by/confirmed_at/created_at）。
2. **CI 迁移列**（+1 行）: `commercial_invoices` 新增 `wac_version_id TEXT DEFAULT ''`（ALTER TABLE 幂等）。
3. **索引**（+3 行）: `uq_wac_history_version`(UNIQUE sku_code+country+warehouse+version_no)、`idx_wac_history_latest`(sku_code+country+warehouse+confirmation_status+is_locked)、`idx_wac_history_ci`(ci_id)。

### server.js（+约 120 行，重写约 80 行）
1. **新增 `latestConfirmedWac(skuCode, country, warehouse)`**: 按 confirmation_status='confirmed' AND is_locked=1, ORDER BY version_no DESC LIMIT 1 查询。
2. **新增 `generateWacVersion(params)`**: 事务内 MAX(version_no)+1 生成版本号，INSERT locked+confirmed wac_history 记录。
3. **重写 `update-weighted-avg` 路由**: 移除所有 inventory/skus 写入；改为生成 wac_history 版本 + 更新 cost_allocations + 写 cost_update_logs + 更新 CI wac_version_id；新增重复确认 409 拒绝。
4. **修改 `refreshInventoryTotals`**: 从 `latestConfirmedWac()` 取 WAC 替代文件列 `imp.weighted_avg_cost`；无已确认 WAC 时保留旧 WAC 或使用 0；返回 `{ warnings }`。
5. **修改 `bulk-import` 路由**: 传递 `wac_warnings` 到响应。
6. **废弃 `allocateCosts`**: 注释掉 `updateWeightedAvgCost(skuCode, inboundQty, unitLandingCost)` 调用。
7. **标记 `updateWeightedAvgCost` deprecated**: 添加 @deprecated 注释，不做物理删除。
8. **新增 `GET /api/wac-history`**: 只读查询端点（按 ci_id / sku_code / country / warehouse 过滤）。
9. **cost-summary 端点**: 返回 `wac_version_id`。

### app.js（+约 50 行，修改约 20 行）
1. 步骤 5 文案: "更新加权平均成本" → "确认加权平均成本"
2. 按钮: 文案改为 "💰 确认加权平均成本"；CI 已有 wac_version_id 时显示 "✅ 已确认"（禁用）
3. 确认弹窗: "这将修改库存表中的数量和成本" → "这将生成并锁定的 WAC 历史版本，不会修改库存总表"
4. 结果表列: 移除"新库存"列，新增"版本号"列；标题改为"加权平均成本版本已生成"
5. ERP 导入结果: 新增 WAC warnings 区块（高优先级红色 / 普通黄色）
6. 导入弹窗: 新增"加权平均成本说明"提示框
7. 模板列标签: "加权成本" → "加权成本(忽略)"

---

## 3. Migration 结果

| 项目 | 结果 |
|------|------|
| wac_history 表创建 | ✅ 成功（CREATE TABLE IF NOT EXISTS） |
| uq_wac_history_version 唯一索引 | ✅ 成功 |
| idx_wac_history_latest 索引 | ✅ 成功 |
| idx_wac_history_ci 索引 | ✅ 成功 |
| commercial_invoices.wac_version_id 列 | ✅ 成功（ALTER TABLE 幂等） |
| 重启幂等性 | ✅ 二次启动无报错 |
| 历史数据回填 | ❌ 未执行（符合要求） |

---

## 4. wac_history 实际结构

```
表名: wac_history
列数: 26

列定义:
  id                      TEXT PRIMARY KEY
  version_no              INTEGER NOT NULL
  ci_id                   TEXT DEFAULT ''
  ci_no                   TEXT DEFAULT ''
  po_id                   TEXT DEFAULT ''
  po_no                   TEXT DEFAULT ''
  pi_id                   TEXT DEFAULT ''
  pi_no                   TEXT DEFAULT ''
  sku_code                TEXT NOT NULL
  model                   TEXT DEFAULT ''
  brand                   TEXT DEFAULT ''
  country                 TEXT DEFAULT ''
  warehouse               TEXT DEFAULT ''
  original_qty            REAL DEFAULT 0
  original_avg_cost       REAL DEFAULT 0
  original_inventory_value REAL DEFAULT 0
  inbound_qty             REAL DEFAULT 0
  unit_landing_cost       REAL DEFAULT 0
  inbound_total_cost      REAL DEFAULT 0
  new_avg_cost            REAL DEFAULT 0
  settlement_date         TEXT DEFAULT ''
  confirmation_status     TEXT DEFAULT 'confirmed'
  is_locked               INTEGER DEFAULT 1
  confirmed_by            TEXT DEFAULT ''
  confirmed_at            TEXT DEFAULT ''
  created_at              TEXT DEFAULT (datetime('now'))

索引:
  sqlite_autoindex_wac_history_1  (PRIMARY KEY)
  uq_wac_history_version          UNIQUE(sku_code, country, warehouse, version_no)
  idx_wac_history_latest          (sku_code, country, warehouse, confirmation_status, is_locked)
  idx_wac_history_ci              (ci_id)
```

**PO/PI 字段说明**: `po_id`/`po_no`/`pi_id`/`pi_no` 从 CI 的 `related_po_id`/`related_po_no`/`related_pi_id`/`related_pi_no` 可靠取得。如 CI 未关联 PO/PI，对应字段为空字符串（DEFAULT ''），不伪造。

---

## 5. 两套旧 WAC 路径的收敛结果

| 路径 | 原状态 | 修改后状态 |
|------|--------|-----------|
| **路径 A**: `allocateCosts()` → `updateWeightedAvgCost()` | `allocateCosts` 全项目无调用方（死代码）；`updateWeightedAvgCost` 直接写 inventory.weighted_avg_cost/inventory_value + skus.weighted_avg_cost | `allocateCosts` 内对 `updateWeightedAvgCost` 的调用已注释；`updateWeightedAvgCost` 标记 @deprecated，不做物理删除 |
| **路径 B**: `POST /api/cost-allocation/update-weighted-avg/:ci_id` 路由 | 直接写 inventory.available_qty + weighted_avg_cost + inventory_value + skus.weighted_avg_cost | **完全重写**: 只生成 wac_history 版本 + 更新 cost_allocations + 写 cost_update_logs + 更新 CI wac_version_id；不写 inventory 任何字段；不写 skus 任何字段 |
| **ERP 导入**: `refreshInventoryTotals()` | 从文件列 `imp.weighted_avg_cost` 取 WAC | 改为查 `latestConfirmedWac()`；文件 WAC 列被忽略；无已确认 WAC 时保留旧值或使用 0 |

**收敛结论**: 两套旧路径均已停止对 inventory/skus 的写入。唯一活跃的 WAC 写入路径为新的 `update-weighted-avg` 路由（只写 wac_history）。唯一更新 inventory 三字段的路径为 ERP 导入（匹配 latest confirmed WAC）。

---

## 6. 成本确认前后 DB 对比

### 测试 CI: P103B-TEST-CI-001（2 个 SKU）

| 字段 | 确认前 | 确认后 | 变化 |
|------|--------|--------|------|
| inventory.available_qty (SKU1) | 200 | 200 | ❌ 无变化 ✅ |
| inventory.weighted_avg_cost (SKU1) | 60.5 | 60.5 | ❌ 无变化 ✅ |
| inventory.inventory_value (SKU1) | 12100 | 12100 | ❌ 无变化 ✅ |
| inventory.available_qty (SKU2) | 200 | 200 | ❌ 无变化 ✅ |
| inventory.weighted_avg_cost (SKU2) | 55.0 | 55.0 | ❌ 无变化 ✅ |
| inventory.inventory_value (SKU2) | 11000 | 11000 | ❌ 无变化 ✅ |
| skus.weighted_avg_cost (SKU1) | 0 | 0 | ❌ 无变化 ✅ |
| skus.weighted_avg_cost (SKU2) | 0 | 0 | ❌ 无变化 ✅ |
| wac_history 记录数 | 0 | 2 | ✅ 新增 2 条 |
| wac_history.is_locked | - | 1 | ✅ 锁定 |
| wac_history.confirmation_status | - | confirmed | ✅ 已确认 |
| commercial_invoices.wac_version_id | '' | 'wac_xxx' | ✅ 已关联 |

---

## 7. ERP 导入前后 DB 对比

### 测试: SKU1 (P103B-TEST-SKU-001), Indonesia, Jakarta-WH

| 字段 | 导入前 | 导入后 | 预期 | 结果 |
|------|--------|--------|------|------|
| available_qty | 200 | 250 | 250 (ERP文件值) | ✅ |
| weighted_avg_cost | 60.5 (旧) | 65.1813 (已确认WAC) | latestConfirmedWac.new_avg_cost | ✅ |
| inventory_value | 12100 | 16295.33 | 250 × 65.1813 | ✅ |
| 文件 WAC (999.99) | - | - | 被忽略 | ✅ |

### 测试: 无已确认 WAC 但有旧 WAC (SKU4, Thailand)

| 字段 | 导入前 | 导入后 | 预期 | 结果 |
|------|--------|--------|------|------|
| available_qty | 100 | 150 | 150 | ✅ |
| weighted_avg_cost | 45.5 | 45.5 | 保留旧值 | ✅ |
| inventory_value | 4550 | 6825 | 150 × 45.5 | ✅ |
| warning | - | 有 | priority=warning | ✅ |

### 测试: 无任何 WAC (SKU3, Vietnam)

| 字段 | 导入前 | 导入后 | 预期 | 结果 |
|------|--------|--------|------|------|
| available_qty | 不存在 | 80 | 80 | ✅ |
| weighted_avg_cost | - | 0 | 0 | ✅ |
| inventory_value | - | 0 | 0 | ✅ |
| warning | - | 有 | priority=high | ✅ |

---

## 8. 每项测试通过/失败

| 测试编号 | 测试名称 | 检查点数 | 通过 | 失败 | 结果 |
|----------|----------|----------|------|------|------|
| 1 | 成本确认后不变性 | 13 | 13 | 0 | ✅ PASS |
| 2 | 同一 CI 重复确认 | 2 | 2 | 0 | ✅ PASS |
| 3 | ERP 导入（有已确认 WAC） | 6 | 6 | 0 | ✅ PASS |
| 4 | 无最新 WAC、存在旧 WAC | 6 | 6 | 0 | ✅ PASS |
| 5 | 无最新 WAC、无旧 WAC | 6 | 6 | 0 | ✅ PASS |
| 6 | 文件中存在错误 WAC | 4 | 4 | 0 | ✅ PASS |
| 7 | 两个国家或仓库使用同一 SKU | 5 | 5 | 0 | ✅ PASS |
| 8 | 出库、盘点、手工调整 | 7 | 7 | 0 | ✅ PASS |
| **总计** | | **49** | **49** | **0** | **✅ ALL PASS** |

---

## 9. 新增测试数据清单

### SKUs (4)
| SKU Code | Product Name |
|----------|-------------|
| P103B-TEST-SKU-001 | P103B Test Product 1 |
| P103B-TEST-SKU-002 | P103B Test Product 2 |
| P103B-TEST-SKU-003 | P103B Test Product 3 (No WAC) |
| P103B-TEST-SKU-004 | P103B Test Product 4 (Legacy WAC only) |

### POs (1)
| PO No | Country | Warehouse |
|-------|---------|-----------|
| P103B-TEST-PO-001 | Indonesia | Jakarta-WH |

### PIs (1)
| PI No | Related PO |
|-------|-----------|
| P103B-TEST-PI-001 | P103B-TEST-PO-001 |

### CIs (2)
| CI No | Country | Warehouse | SKU |
|-------|---------|-----------|-----|
| P103B-TEST-CI-001 | Indonesia | Jakarta-WH | SKU-001, SKU-002 |
| P103B-TEST-CI-002 | Malaysia | Kuala-Lumpur-WH | SKU-001 |

### WAC History (3)
| CI No | SKU | Country | Warehouse | Version |
|-------|-----|---------|-----------|---------|
| P103B-TEST-CI-001 | P103B-TEST-SKU-001 | Indonesia | Jakarta-WH | v1 |
| P103B-TEST-CI-001 | P103B-TEST-SKU-002 | Indonesia | Jakarta-WH | v1 |
| P103B-TEST-CI-002 | P103B-TEST-SKU-001 | Malaysia | Kuala-Lumpur-WH | v1 |

### Inventory (测试修改的行)
| SKU | Country | Warehouse | 最终 available_qty | 最终 WAC |
|-----|---------|-----------|-------------------|----------|
| P103B-TEST-SKU-001 | Indonesia | Jakarta-WH | 240 (250-10出库) | 65.1813 (已确认WAC) |
| P103B-TEST-SKU-002 | Indonesia | Jakarta-WH | 200 | 55.0 (未导入ERP) |
| P103B-TEST-SKU-003 | Vietnam | Hanoi-WH | 80 | 0 (无WAC) |
| P103B-TEST-SKU-004 | Thailand | Bangkok-WH | 150 | 45.5 (旧WAC保留) |
| P103B-TEST-SKU-001 | Malaysia | Kuala-Lumpur-WH | 50 | 65.0 (未导入ERP) |

---

## 10. 未修复问题清单

| 编号 | 问题 | 说明 |
|------|------|------|
| P1-WAC | 汇率换算 | **本轮未修复**。WAC 版本存储与库存解耦已完成，但币种换算结果仍属于独立 P1-WAC，当前新版本的金额正确性尚未最终验收。 |
| P1-01 | 定金 unpaid 不减 | 本轮不在范围 |
| P1-02 | 7 行 legacy CI-P3-* 未结清 | 本轮不在范围 |
| P1-04 | 负数入库 | 本轮不在范围 |
| P1-05 | 原库存导入 DELETE-first | 本轮不在范围 |
| P2-06~08 | 重复尾款/定金/状态机 | 本轮不在范围 |
| - | wac_pending 持久化 | 是否持久化 wac_pending 状态另立独立任务 |
| - | WAC 历史/调整/冲销版本 | 调整/冲销机制不在本轮实现 |
| - | 完整 WAC 历史列表页面 | 不新增（设计稿排除） |
| - | 历史数据回填 | 禁止为历史 CI 自动生成 WAC 版本 |

**重要声明**: WAC 版本存储与库存解耦已经完成；币种换算结果仍属于独立 P1-WAC，当前新版本的金额正确性尚未最终验收。不得宣称完整 WAC 计算已正确。

---

## 11. 是否达到 P1-03-B 验收条件

### 验收条件逐项核对

| 验收条件 | 达成 | 证据 |
|----------|------|------|
| 成本确认只生成 WAC 版本，不写 inventory/skus | ✅ | Test 1: 8 项不变性检查全部通过 |
| 重复确认被拒绝 | ✅ | Test 2: 409 + 无重复版本 |
| ERP 导入匹配 latest confirmed WAC | ✅ | Test 3: weighted_avg_cost = latestConfirmedWac.new_avg_cost |
| ERP 导入三字段同事务一致 | ✅ | Test 3: available_qty × WAC = inventory_value |
| 无 WAC 时保留旧 WAC + warning | ✅ | Test 4: 旧 WAC 保留 + warning 返回 |
| 无 WAC 无旧 WAC 时为 0 + 高优先级 warning | ✅ | Test 5: WAC=0 + priority=high |
| 文件 WAC 被忽略 | ✅ | Test 6: 999.99/888.88 被忽略 |
| 多国家/仓库版本互不覆盖 | ✅ | Test 7: Indonesia v1 ≠ Malaysia v1 |
| skus.weighted_avg_cost 不被写入 | ✅ | Test 7: skus.weighted_avg_cost 始终为 0 |
| 出库/盘点/调整不受影响 | ✅ | Test 8: WAC 全程不变 |
| wac_history 锁定且不可覆盖 | ✅ | is_locked=1, UNIQUE 约束 |
| 版本号事务内生成 | ✅ | generateWacVersion 在 transaction() 内 |
| migration 幂等 | ✅ | 二次启动无报错 |
| 不回填历史数据 | ✅ | 仅 P103B-TEST-* 有 wac_history 记录 |
| allocateCosts 废弃不物理删除 | ✅ | 注释调用 + @deprecated 标记 |

**结论**: ✅ 达到 P1-03-B 验收条件。49/49 检查点全部通过。

---

## 12. 回滚方式

### 方式 1：数据库安全副本恢复
```bash
# 停止服务器
# 恢复数据库安全副本
cp data/inventory.db.bak-p103b-imp-20260714-122800 data/inventory.db
# 重启服务器
node server.js
```

### 方式 2：代码回滚（git）
```bash
# 查看当前未提交修改
git diff -- db.js server.js app.js
# 如需回滚到实施前状态，使用 git stash 或 git checkout（注意会丢失所有未提交修改）
git stash  # 暂存所有修改
```

### 方式 3：仅回滚 wac_history 表（保留其他修改）
```sql
-- 删除 wac_history 表和索引
DROP TABLE IF EXISTS wac_history;
-- CI wac_version_id 列无法删除（SQLite 不支持 DROP COLUMN），但可置空
UPDATE commercial_invoices SET wac_version_id = '' WHERE wac_version_id != '';
```

### 注意事项
- 安全副本位置: `data/inventory.db.bak-p103b-imp-20260714-122800`
- 安全副本不视为 T1 正式备份
- 测试数据（P103B-TEST-* 前缀）未清理，如需清理请另发指令
- 回滚后需重启服务器以重新初始化数据库

---

*报告结束。实施完成后立即停止，不清理测试数据，不继续处理下一个 P1，不进入完整历史页面，不进入汇率修复。*
