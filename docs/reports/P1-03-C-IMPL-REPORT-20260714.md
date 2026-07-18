# P1-03-C 实施与完整性回归报告

**日期**：2026-07-14
**范围**：P1-03-C（WAC 版本完整性 — 汇总确认状态 `wac_confirmed` + locked 版本数据库不可变触发器 + 多 SKU 确认真实事务回滚）
**基线设计**：`P1-03-C-FINAL-DESIGN-20260714.md`（已冻结，仅按用户修订修正 Test 9 / Test 10 执行方式）
**结论**：✅ 实施完成；✅ 验收条件达到（65/65 测试通过）；⚠️ 工作库残留 P103B-TEST 测试数据按 SYS-E2E-02 冻结未清理（P1-03-C 未向工作库写入任何数据）。

---

## 1. 实际修改文件

| 文件 | 是否 P1-03-C 修改 | 说明 |
|------|------------------|------|
| `db.js` | ✅ 是 | 新增 `p1cStrictMigration()` 严格迁移块（3 列 + 2 触发器 + 校验） |
| `server.js` | ✅ 是 | `update-weighted-avg` 路由改造 + `cost-summary` 返回 `wac_confirmed*/wac_version_id` |
| `app.js` | ✅ 是 | 成本确认状态/按钮由 `wac_version_id` 解耦为 `wac_confirmed`（2 处） |
| `p103c-test.js` | ✅ 新增 | P1-03-C 独立测试脚本（Test 9 真实路由回滚 + Test 10 触发器） |
| `p103b-test.js` | ◯ 既有（P1-03-B） | 复用作回归套件 |
| `sanitize-copy.js` | ✅ 新增（测试辅助） | 仅用于准备干净副本，非交付物；运行于 throwaway 副本 |
| `index.html` | ❌ 否 | 本次未改（其 diff 来自 P1-03-B 等既有工作） |

---

## 2. 精确 diff 摘要

### 2.1 db.js — `p1cStrictMigration()`（约 1544–1581 行，新增整个 IIFE）

```js
// ==================== P1-03-C 严格 migration（禁止静默吞错） ====================
(function p1cStrictMigration() {
  const d = getDB();
  // 1. 探测并新增 commercial_invoices 汇总字段（仅"列已存在"才跳过，绝不静默吞错）
  const ciCols = d.prepare("PRAGMA table_info(commercial_invoices)").all().map(c => c.name);
  const p103cCols = [
    { name: 'wac_confirmed', sql: 'INTEGER DEFAULT 0' },
    { name: 'wac_confirmed_at', sql: "TEXT DEFAULT ''" },
    { name: 'wac_confirmed_by', sql: "TEXT DEFAULT ''" }
  ];
  for (const col of p103cCols) {
    if (!ciCols.includes(col.name)) {
      d.exec("ALTER TABLE commercial_invoices ADD COLUMN " + col.name + " " + col.sql);
    }
  }
  // 2. 创建 locked 版本不可变触发器（IF NOT EXISTS；创建失败必须抛错停机）
  d.exec(`CREATE TRIGGER IF NOT EXISTS trg_wac_history_block_update
          BEFORE UPDATE ON wac_history WHEN OLD.is_locked = 1
          BEGIN SELECT RAISE(ABORT, 'LOCKED_WAC_HISTORY_UPDATE_FORBIDDEN'); END;`);
  d.exec(`CREATE TRIGGER IF NOT EXISTS trg_wac_history_block_delete
          BEFORE DELETE ON wac_history WHEN OLD.is_locked = 1
          BEGIN SELECT RAISE(ABORT, 'LOCKED_WAC_HISTORY_DELETE_FORBIDDEN'); END;`);
  // 3. 完成后查 sqlite_master 校验两触发器真实存在，缺失即中止启动
  const triggers = d.prepare("SELECT name FROM sqlite_master WHERE type='trigger'
      AND name IN ('trg_wac_history_block_update','trg_wac_history_block_delete')").all().map(t => t.name);
  if (triggers.length !== 2) {
    throw new Error('P1-03-C migration failed: wac_history triggers missing. Found=' + JSON.stringify(triggers));
  }
})();
```

### 2.2 server.js — `update-weighted-avg` 路由（约 4790–4898 行）

关键改造点（对照原实现）：
- **重复确认闸门**：`if (ci.wac_version_id)` → `if (ci.wac_confirmed)` 返回 `409`。
- **移除原 `missingSkus` 前置 400 拦截**；改为取 `importedSkus` 供循环内匹配。
- **稳定排序**：`SELECT * FROM cost_allocations WHERE ci_id = ? ORDER BY sku_code ASC`。
- **事务内 throw（整体回滚）**：循环内 `if (!origInv) throw new Error(\`SKU ${alloc.sku_code} 缺少原库存导入记录，WAC 确认已整体回滚\`);`
- **末尾一致性闸门**：`if (logs.length !== allocations.length) throw new Error('WAC 确认 SKU 数量不一致，已整体回滚');`
- **写汇总状态（不再写 `wac_version_id`）**：`UPDATE commercial_invoices SET wac_confirmed = 1, wac_confirmed_at = datetime('now'), wac_confirmed_by = ? WHERE id = ?`（参数 `[req.currentUserId || userName, ci.id]`，确认人存 **id**）。
- **成功响应**增加 `wac_confirmed: true`。

### 2.3 server.js — `cost-summary` 端点（约 4575–4578 行）

```js
wac_version_id: ci.wac_version_id || '',
wac_confirmed: ci.wac_confirmed || 0,
wac_confirmed_at: ci.wac_confirmed_at || '',
wac_confirmed_by: ci.wac_confirmed_by || ''
```

### 2.4 app.js（2 处，约 6453 / 6459 行）

```js
// 状态指示
+(summary.wac_confirmed ? '✅ 已确认（版本已锁定）' : '⏳ 待执行')+
// 按钮禁用判定
(summary.wac_confirmed ? '<button ... disabled>✅ 已确认</button>'
                       : '<button ... onclick="updateWeightedAvg(\''+ciId+'\')" ...>💰 确认加权平均成本</button>')
```

---

## 3. migration 结果

- `commercial_invoices` 新增 3 列：`wac_confirmed`(INTEGER DEFAULT 0)、`wac_confirmed_at`(TEXT DEFAULT '')、`wac_confirmed_by`(TEXT DEFAULT '')。
- 严格规则已落地：**仅"列已存在"才跳过**；`CREATE TRIGGER IF NOT EXISTS` 失败必抛错；完成后查 `sqlite_master` 校验两触发器存在，缺失即 `throw` 中止启动；**无静默空 catch**。
- **幂等验证**：对迁移后 DB 二次调用 `initDatabase()`，三列已存在故跳过，两触发器 `IF NOT EXISTS` 不重建，无报错、无重复列——幂等通过。
- 运行环境 SQLite 实测绑定版本 **3.49.2**（better-sqlite3），支持 `DROP COLUMN`、动态 `RAISE`；本报告固定使用预定义错误码，不依赖动态 RAISE。

---

## 4. 触发器验证

两个 `BEFORE` 触发器，作用域 `wac_history` 且仅当 `OLD.is_locked = 1`：

| 触发器 | 动作 | 固定错误码 |
|--------|------|-----------|
| `trg_wac_history_block_update` | 拦截 UPDATE | `LOCKED_WAC_HISTORY_UPDATE_FORBIDDEN` |
| `trg_wac_history_block_delete` | 拦截 DELETE | `LOCKED_WAC_HISTORY_DELETE_FORBIDDEN` |

验证（副本实测）：
- `is_locked = 1` 记录 → UPDATE 被拒（返回固定错误码），记录值不变 ✅
- `is_locked = 1` 记录 → DELETE 被拒（返回固定错误码），记录仍存在 ✅
- `is_locked = 0` 记录 → UPDATE 成功 ✅
- `is_locked = 0` 记录 → DELETE 成功 ✅

**工作库（生产库）两触发器未被 DROP / 禁用 / 临时替换**，始终 intact（回归后复查确认）。

---

## 5. wac_history 结构

- 26 列表（P1-03-B 已建）：关键列 `id / ci_id / ci_no / sku_code / country / warehouse / version_no / is_locked / confirmed_by / settlement_date / new_avg_cost / original_qty / inbound_qty / original_avg_cost / inbound_total_cost` 等。
- **权威关联**：`wac_history.ci_id`（P1-03-C 仍由 `generateWacVersion` 写入 `ci_id`）。`commercial_invoices.wac_version_id` 已废弃（停止写入，前端不再依赖；`cost-summary` 仍返回该字段但仅作兼容占位）。
- **唯一约束**：`UNIQUE(sku_code, country, warehouse, version_no)`。
- **一对多关系已验证**：1 CI → N SKU → 每 (SKU+国家+仓库) 1 条 `wac_history`。正向确认 P103B-TEST-CI-001 后，按 `ci_id`/`ci_no` 查得 2 条（两 SKU），均为 `is_locked=1`。

---

## 6. 成本确认前后 DB 对比（确认路由不写库存总表）

以 P103B-TEST-CI-001 真实路由确认为例（`available_qty` 原 200，旧 WAC 60.5 / 55.0）：

| 对象 | 字段 | 确认前 | 确认后 | 变化 |
|------|------|--------|--------|------|
| `inventory`(SKU1) | available_qty / weighted_avg_cost / inventory_value | 200 / 60.5 / 12100 | 200 / 60.5 / 12100 | 不变 ✅ |
| `inventory`(SKU2) | 同上 | 200 / 55.0 / 11000 | 200 / 55.0 / 11000 | 不变 ✅ |
| `skus`(SKU1/2) | weighted_avg_cost | 0 | 0 | 不变 ✅ |
| `wac_history` | 该 CI 行 | 0 | 2（is_locked=1） | 新增 ✅ |
| `commercial_invoices` | wac_confirmed / wac_confirmed_at / wac_confirmed_by | 0 / '' / '' | 1 / 时间戳 / 'admin'(id) | 置位 ✅ |
| `cost_allocations` | original_qty / original_avg_cost | 改写（仅回填原库存信息，不改库存总表） | — | 正常 ✅ |

**结论**：成本确认只写 `wac_history` / `cost_allocations` / `cost_update_logs` / CI 汇总状态；**绝不修改 `inventory.available_qty` / `weighted_avg_cost` / `inventory_value` / `skus.weighted_avg_cost`**（落实 SYS-E2E-02 冻结口径）。

---

## 7. ERP 当前可用库存导入前后 DB 对比

以 P103B Test 3/4/5/6 为据（导入只更新数量、匹配最新已确认 WAC、忽略文件 WAC）：

| 场景 | available_qty | weighted_avg_cost | inventory_value | 文件 WAC |
|------|--------------|-------------------|----------------|----------|
| Test 3（有已确认 WAC，导入 250） | 200→250 | 匹配最新已确认版本 | 250 × WAC | 999.99 被忽略 ✅ |
| Test 4（无最新有旧 WAC，导入 150） | →150 | 保留旧 WAC 45.5 | 150 × 45.5 = 6825 | —（warning） |
| Test 5（无最新无旧 WAC，导入 80） | →80 | 0 | 0 | —（高优先级 warning） |
| Test 6（文件 WAC 888.88 ≠ 已确认） | 更新 | 使用已确认 WAC | — | 888.88 被忽略 ✅ |

**结论**：ERP 导入只更新库存**数量**，自动匹配最新已确认 WAC 重算金额，**不重算/不覆盖历史成本版本**（落实 P1-03-B-IMP 规则）。

---

## 8. 每项测试通过 / 失败

### P1-03-B 回归套件（49 项，副本实测）— 全部 PASS

| 测试 | 子项 | 结果 |
|------|------|------|
| Test 1 成本确认后不变性 | 9（API + inventory×6 + skus×2） | ✅ 9/9 |
| Test 2 同一 CI 重复确认 | 2（409 拒绝 + 无重复版本） | ✅ 2/2 |
| Test 3 ERP 导入（有已确认 WAC） | 6 | ✅ 6/6 |
| Test 4 无最新有旧 WAC | 6 | ✅ 6/6 |
| Test 5 无最新无旧 WAC | 6 | ✅ 6/6 |
| Test 6 文件错误 WAC | 4 | ✅ 4/4 |
| Test 7 同 SKU 两国/仓互不覆盖 | 5 | ✅ 5/5 |
| Test 8 出库/盘点/手工调整不受影响 | 8 | ✅ 8/8 |
| **合计** | **49** | **✅ 49/49** |

### P1-03-C 套件（16 项，副本实测）— 全部 PASS

**Test 9：多 SKU CI 中途失败整体回滚（真实 API 路由）**

| 断言 | 结果 |
|------|------|
| 9.1 路由返回 400/500 且含指定回滚文案 `SKU xxx 缺少原库存导入记录，WAC 确认已整体回滚` | ✅ PASS |
| 9.2 该 CI 的 `wac_history` 行数 = 0 | ✅ PASS |
| 9.3 SKU-002 不产生版本 | ✅ PASS |
| 9.4 `cost_allocations` 无部分更新 | ✅ PASS |
| 9.5 `cost_update_logs` 无残留 | ✅ PASS |
| 9.6 `wac_confirmed=0` 且 at/by 为空 | ✅ PASS |
| 9.7 `inventory`(SKU1/SKU2) 三字段不变 | ✅ PASS ×2 |
| 9.8 `skus.weighted_avg_cost`(SKU1/SKU2) 不变 | ✅ PASS ×2 |
| **Test 9 小计** | **✅ 10/10** |

**Test 10：locked 版本不可变触发器**

| 断言 | 结果 |
|------|------|
| 10A 锁定记录 UPDATE 被拒 | ✅ PASS |
| 10A 锁定记录值未变 | ✅ PASS |
| 10B 锁定记录 DELETE 被拒 | ✅ PASS |
| 10B 锁定记录仍存在 | ✅ PASS |
| 10C 未锁定记录 UPDATE 成功 | ✅ PASS |
| 10C 未锁定记录 DELETE 成功 | ✅ PASS |
| **Test 10 小计** | **✅ 6/6** |

**合计：✅ 49 + 16 = 65/65 全绿。**

> 执行说明：Test 9 / Test 10 均在**独立测试数据库副本**（`data/P103C-TEST/inventory-test.db`）上经**真实 API 路由**执行；副本通过 `process.env.DB_PATH` 隔离，工作库零污染。首轮曾因副本内残留上轮 Test 10 的 `is_locked=1` 记录触发 UNIQUE 冲突，已通过"重建干净副本 + 仅对 throwaway 副本做 sanitize（DROP 触发器→删测试行→重建相同触发器）"解决；工作库触发器从未被 DROP。

---

## 9. 新增测试数据清单

### 测试脚本
- `p103c-test.js`（新增）：Test 9 建 `P103C-TEST-CI-901`（两 SKU，SKU-002 故意缺 `original_inventory_imports`）；Test 10 建 `is_locked=1` 与 `is_locked=0` 对照记录。
- `sanitize-copy.js`（新增，测试辅助）：仅对 throwaway 副本做基线清理。

### 测试运行期产生的数据（位于副本，运行后整目录删除）
- P103B-TEST-CI-001 / -CI-002 及其 SKU、PO、PI、CI Items、cost_allocations、original_inventory_imports、inventory、wac_history（version_no=1, is_locked=1）、cost_update_logs。
- P103C-TEST-CI-901 及其 SKU、cost_allocations、original_inventory_imports；Test 10 的 locked/unlocked 对照 `wac_history` 记录。
- **清理方式**：依用户规则"测试结束不删副本内任何行，仅删除整个副本目录"——运行结束后 `rm -rf data/P103C-TEST/` 已执行，副本目录已移除。

---

## 10. 未修复问题清单

### 10.1 P1 系列（来自既有冻结基线，本次未触及）
- **P1-WAC 汇率换算仍独立未修**：原币未换算 LC 混算 WAC 的问题未在本任务范围（本任务仅做版本完整性，禁混入汇率修复）。
- **wac_pending 持久化**：另立任务。
- **调整 / 冲销版本机制**：未实现（路由 409 文案已预留"如需调整请使用冲销版本（尚未实现）"）。
- **历史数据回填**：未执行。

### 10.2 工作库残留测试数据（偏差披露，按冻结规则不擅自清理）
- 工作库 `data/inventory.db` 现有 **P103B-TEST 残留**（来自 P1-03-B 工作，非本次）：
  - `commercial_invoices`：2 行（P103B-TEST-CI-001 / -CI-002，均 `wac_confirmed=0`）
  - `wac_history`：3 行（均 `is_locked=1`，对应上述 CI）
  - `cost_allocations`：3 行
- **P1-03-C 未向工作库写入任何 P103C-TEST 数据**（已通过 `LIKE 'P103C-TEST-%'` 全表核查确认：0 行）。
- 上述 P103B-TEST 残留按 **SYS-E2E-02 冻结指令**（"暂不执行测试数据清理，须待用户确认 9.2 四项后走外科式方案 C"）保留，**未 DROP 工作库触发器、未改生产数据**。
- 建议：将 P103B-TEST + 可能新增的 P103C-TEST 残留一并纳入用户批准的外科式方案 C 清理清单（届时如需移除 `is_locked=1` 行，须在受控备份下临时禁用触发器——此操作仅限方案 C，不在本任务内）。

---

## 11. 是否达到验收条件

| 验收项（来自最终冻结设计） | 状态 |
|---------------------------|------|
| `wac_confirmed` 汇总状态落地（仅全 SKU 同事务成功才置 1） | ✅ |
| 多 SKU 确认经**真实 API 路由**执行，中途失败整体回滚 | ✅ Test 9 |
| 缺 `original_inventory_imports` 在事务内 throw、回滚文案精确 | ✅ Test 9.1 |
| `cost_allocations` 查询稳定排序 `ORDER BY sku_code ASC` | ✅ |
| locked 版本数据库层不可变（UPDATE/DELETE 被拒，固定错误码） | ✅ Test 10 |
| Test 9/10 在独立副本执行，工作库零污染（P103C 数据） | ✅ |
| 禁止 DROP 工作库触发器 / 测试期关闭不可变保护 | ✅ 工作库触发器 intact |
| 前端状态/按钮由 `wac_confirmed` 驱动，解耦 `wac_version_id` | ✅ |
| 测试全绿（P1-03-B 49 + P1-03-C 16） | ✅ 65/65 |
| migration 严格、幂等、启动校验 | ✅ |

**结论：✅ 达到全部验收条件，可交付。**

---

## 12. 回滚方式

P1-03-C 改动为**纯增量**（新增列 + 新增触发器 + 路由/前端逻辑），不影响既有数据完整性，回滚简单且安全：

1. **代码回滚**（首选）：
   ```bash
   git checkout db.js server.js app.js        # 回到 P1-03-C 前
   # 删除新增测试/辅助脚本（可选）：p103c-test.js / sanitize-copy.js
   ```
   回滚后既有已锁定 `wac_history` 版本数据保留不变（仅失去"汇总确认状态"展示与"重复确认 409"闸门，不影响历史版本）。

2. **数据库回滚**（如需彻底移除 P1-03-C 痕迹，可选）：
   ```sql
   -- SQLite 3.49 支持 DROP COLUMN
   ALTER TABLE commercial_invoices DROP COLUMN wac_confirmed;
   ALTER TABLE commercial_invoices DROP COLUMN wac_confirmed_at;
   ALTER TABLE commercial_invoices DROP COLUMN wac_confirmed_by;
   DROP TRIGGER trg_wac_history_block_update;
   DROP TRIGGER trg_wac_history_block_delete;
   ```
   ⚠️ 此操作仅应在确认不再需要 WAC 版本锁定时执行；对**已确认（is_locked=1）的 wac_history 数据无影响**。

3. **隔离保障回滚**：测试副本 `data/P103C-TEST/` 已整体删除；若需重新验证，按 `DB_PATH=.../inventory-test.db node p103c-test.js`（先以工作库复制生成干净副本）即可，无需改动工作库。

---

*报告完。本任务按要求于实施后输出本报告并停止，不进入 P1-WAC 汇率修复等后续任务。*
