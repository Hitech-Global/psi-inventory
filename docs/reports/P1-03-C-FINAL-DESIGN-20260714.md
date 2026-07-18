# P1-03-C WAC Version Integrity 最终实施设计稿

> 任务编号：P1-03-C
> 状态：只读设计定稿阶段（本轮不修改代码、不修改数据库、不新增 trigger、不新增测试数据）
> 前置：P1-03-B 核心实施完成，进入"待完整性补强"状态；P1-03-C 初版设计稿方向已接受
> 本稿性质：对《P1-03-C-DESIGN-20260714.md》的最终修订，等待实施批准

---

## 0. 本稿相对初版的修订清单

| 修订项 | 初版 | 最终版 |
|--------|------|--------|
| A. RAISE 错误消息 | 动态拼接 `'文本'||OLD.id||...` | **固定错误码**，ID/版本/SKU 由应用层日志补充 |
| B. migration 错误处理 | `try{...}catch(e){}` 静默吞错 | **严格**：先 PRAGMA 判断列、CREATE TRIGGER 失败必抛错停机、完成后查 sqlite_master 验证 |
| C. Test 9 执行方式 | genId stub 制造 PK 冲突 | **真实 API 路由**执行（ORDER BY sku_code ASC + 循环内缺失 origInv throw 触发真实事务回滚），非隔离事务样例 |
| D. 触发器验收测试 | 仅 Test 9 | 新增 **Test 10A/10B/10C** 数据库不可变性测试 |
| E. 验收标准 | 7 项 | 扩充为 10 项（含触发器存在性、字段存在性、重启两次、错误不被吞） |

---

## 1. 只读环境核实结果（本轮实测，未改动任何数据）

> 用户此前记录 SQLite 版本为 3.43.2。本轮以**项目实际 better-sqlite3 绑定的引擎**实测，结果如下，作为设计依据（不依据 sqlite3 CLI 推断）。

| 核实项 | 结果 |
|--------|------|
| better-sqlite3 绑定 SQLite 版本 | **3.49.2**（非 3.43.2；实施前须再次以此绑定验证 trigger SQL） |
| 动态 RAISE 表达式 `RAISE(ABORT,'X'||OLD.id)` | 在 3.49.2 下**实测可创建并触发**（返回 `Xa`） |
| 固定错误码 `RAISE(ABORT,'LOCKED_...')` | **实测可创建并触发**（返回原文错误码） |
| 结论 | 尽管当前版本支持动态表达式，仍按用户指令**采用固定错误码**——更稳健、可被应用层字符串精确匹配、不受版本差异影响 |
| genId 可注入性 | genId 定义于 db.js:67，为硬编码普通函数，经 module.exports 导出，**无现成依赖注入接口**；stub 需 monkey-patch require 缓存或改生产代码 → **不采用 genId stub** |
| allocations 迭代顺序 | update-weighted-avg 路由 `SELECT * FROM cost_allocations WHERE ci_id = ?` **无 ORDER BY**，返回顺序不确定 → Test 9 须用稳定业务排序保证确定性（见第 4 节） |

---

## 2. CI 一对多 WAC 关系模型（不变，重申冻结）

```
一个 commercial_invoices（CI）
  └─ N 个 commercial_invoice_items（SKU 行）
       └─ 每个 (SKU + 国家 + 仓库) 维度 → 恰好一条 wac_history 版本
```

- **权威关联**：`wac_history.ci_id`（一对多）。查询整个 CI 全部 WAC 版本的唯一正式路径：
  ```sql
  SELECT * FROM wac_history WHERE ci_id = ? ORDER BY sku_code, country, warehouse, version_no;
  ```
- 禁止以 `commercial_invoices.wac_version_id`（单值遗留指针）表达一对多关系。

### 2.1 wac_confirmed 汇总状态字段（commercial_invoices 新增）

| 字段 | 类型 | 默认 | 语义 |
|------|------|------|------|
| `wac_confirmed` | INTEGER | 0 | 整个 CI 全部应参与 SKU 是否已生成 WAC 版本（0/1） |
| `wac_confirmed_at` | TEXT | '' | 汇总确认时间 |
| `wac_confirmed_by` | TEXT | '' | 汇总确认人 id |

### 2.2 "全部 SKU 已成功生成版本"判定（事务内，不变）

- `expectedCount` = 本 CI 的 `cost_allocations` 行数。
- `actualCount` = 本事务内成功插入的 `wac_history` 行数（`logs.length`）。
- 事务末尾、提交前：`IF actualCount === expectedCount AND expectedCount > 0 → wac_confirmed=1`；否则 THROW 触发整体回滚。
- **缺失 origInv 由静默 `return` 改为 `throw`**（完整性补强，也是 Test 9 的真实失败点）：
  ```js
  const origInv = importedSkus.find(s => s.sku_code === alloc.sku_code);
  if (!origInv) {
    throw new Error(`SKU ${alloc.sku_code} 缺少原库存导入记录，WAC 确认已整体回滚`);
  }
  ```
- 禁止以"存在任意一条 wac_history"判定整个 CI 已确认。

### 2.3 wac_version_id 兼容处理（不变）

保留列、停止写入、不主动清空、标记 `@deprecated`；重复确认闸门由 `if (ci.wac_version_id)` 改为 `if (ci.wac_confirmed)`。前端"已确认"判定与版本列表全部改走 `wac_confirmed` / `wac_history.ci_id`。

---

## 3. 修订 A：固定 RAISE 错误码的触发器设计

### 3.1 BEFORE UPDATE 触发器

```sql
CREATE TRIGGER IF NOT EXISTS trg_wac_history_block_update
BEFORE UPDATE ON wac_history
WHEN OLD.is_locked = 1
BEGIN
  SELECT RAISE(ABORT, 'LOCKED_WAC_HISTORY_UPDATE_FORBIDDEN');
END;
```

### 3.2 BEFORE DELETE 触发器

```sql
CREATE TRIGGER IF NOT EXISTS trg_wac_history_block_delete
BEFORE DELETE ON wac_history
WHEN OLD.is_locked = 1
BEGIN
  SELECT RAISE(ABORT, 'LOCKED_WAC_HISTORY_DELETE_FORBIDDEN');
END;
```

### 3.3 设计要点

- 错误消息为**纯固定字符串常量**，不拼接任何列值，规避跨版本表达式兼容风险，且应用层可用 `err.message.includes('LOCKED_WAC_HISTORY_UPDATE_FORBIDDEN')` 精确匹配。
- **记录 ID / version_no / SKU 由应用层在执行 UPDATE/DELETE 前后补充审计日志**（如 cost_update_logs 或专用日志），不进入 trigger RAISE 文本。
- `WHEN OLD.is_locked = 1` 仅拦截锁定记录；未锁定记录（is_locked=0）可正常 UPDATE/DELETE。
- `wac_history` 当前 26 列**全部为核心业务字段**，锁定后一律禁止改/删；当前无纯技术字段，故触发器按"锁定即全禁 UPDATE"实现。若未来新增纯技术字段，再细化 WHEN 条件放行。
- **实施前强制**：以项目 better-sqlite3（当前 3.49.2）实际 `d.exec()` 验证两条 trigger SQL 可成功创建，不得只凭 CLI 推断。

### 3.4 locked 核心不可修改字段清单（26 列全核心）

id / version_no / ci_id / ci_no / po_id / po_no / pi_id / pi_no / sku_code / model / brand / country / warehouse / original_qty / original_avg_cost / original_inventory_value / inbound_qty / unit_landing_cost / inbound_total_cost / new_avg_cost / settlement_date / confirmation_status / is_locked / confirmed_by / confirmed_at / created_at。

纯技术字段：当前不存在。

---

## 4. 修订 B：严格 migration 错误处理（db.js）

### 4.1 禁止的写法

```js
try { d.exec(`ALTER TABLE ...`); } catch(e) {}   // ❌ 静默吞错，禁止
```

### 4.2 正式规则

1. **新增列前先探测**：用 `PRAGMA table_info(commercial_invoices)` 判断列是否已存在，仅在明确"列已存在"时跳过；否则执行 ADD COLUMN，失败必须抛错停机。
2. **CREATE TRIGGER** 使用 `IF NOT EXISTS`；执行失败（语法错误、表缺失等）必须抛错并中止启动，不得继续声称成功。
3. **完成后校验**：查询 `sqlite_master` 确认两个触发器真实存在，缺失即抛错。
4. 任何非预期错误 → 明确报错 + 中止本轮实施 + 不启动。

### 4.3 参考实现（db.js migration 段落）

```js
// ---- P1-03-C: commercial_invoices WAC 汇总状态字段（显式探测，失败即抛错） ----
const ciCols = d.prepare(`PRAGMA table_info(commercial_invoices)`).all().map(c => c.name);
const p103cCols = [
  ['wac_confirmed',    'INTEGER DEFAULT 0'],
  ['wac_confirmed_at', "TEXT DEFAULT ''"],
  ['wac_confirmed_by', "TEXT DEFAULT ''"],
];
for (const [name, def] of p103cCols) {
  if (ciCols.includes(name)) continue;            // 明确列已存在才跳过
  d.exec(`ALTER TABLE commercial_invoices ADD COLUMN ${name} ${def}`);  // 失败自然抛出，中止启动
}

// ---- P1-03-C: locked WAC 版本不可变触发器（失败即抛错） ----
d.exec(`CREATE TRIGGER IF NOT EXISTS trg_wac_history_block_update
  BEFORE UPDATE ON wac_history
  WHEN OLD.is_locked = 1
  BEGIN
    SELECT RAISE(ABORT, 'LOCKED_WAC_HISTORY_UPDATE_FORBIDDEN');
  END;`);
d.exec(`CREATE TRIGGER IF NOT EXISTS trg_wac_history_block_delete
  BEFORE DELETE ON wac_history
  WHEN OLD.is_locked = 1
  BEGIN
    SELECT RAISE(ABORT, 'LOCKED_WAC_HISTORY_DELETE_FORBIDDEN');
  END;`);

// ---- P1-03-C: 校验触发器真实存在，缺失即抛错停机 ----
const trg = d.prepare(
  `SELECT name FROM sqlite_master WHERE type='trigger' AND name IN (?,?)`
).all('trg_wac_history_block_update', 'trg_wac_history_block_delete');
if (trg.length !== 2) {
  throw new Error('P1-03-C migration 校验失败：locked WAC 触发器未全部创建，已中止启动');
}
```

- **幂等**：列探测 + `CREATE TRIGGER IF NOT EXISTS` 保证重复执行安全；重启两次均成功且不重复建列/触发器。
- **不回填**：不读写任何历史 wac_history；不改 wac_version_id 既有值。
- **不再吞错**：不使用空 catch；任何异常向上抛出，阻止服务器以"migration 成功"假象启动。

---

## 5. 修订 C：Test 9 —— 真实缺失 origInv 触发整体回滚

### 5.1 原则

- **不使用 genId stub**（已核实 genId 无安全依赖注入接口）。
- **不向生产代码增加任何测试后门**。
- 使用第 2.2 节新增的真实业务校验（缺失 original_inventory_import → throw）作为失败点。

### 5.2 迭代顺序确定性（关键）

当前路由 `SELECT * FROM cost_allocations WHERE ci_id = ?` **无 ORDER BY**，返回顺序由数据库实现决定，不可依赖。

**实施要求**：在路由中为该查询增加**稳定业务排序**，使迭代顺序确定：

```sql
SELECT * FROM cost_allocations WHERE ci_id = ? ORDER BY sku_code ASC
```

- 采用 `sku_code ASC` 作为稳定排序键（字典序确定、与业务无副作用）。
- 这样 `P103C-TEST-SKU-001` 必先于 `P103C-TEST-SKU-002` 执行。
- Test 9 依赖此排序：SKU-001 先成功建版本，SKU-002 后因缺失 origInv 抛错，验证 SKU-001 已建的版本被整体回滚。
- 不得依赖数据库未声明的默认返回顺序。

### 5.3 测试数据（独立 P103C-TEST-）

- 新建独立 CI `P103C-TEST-CI-901`，前置 `cost_confirmed=1`、`cost_allocated=1`、`original_inventory_imported=1`、`wac_confirmed=0`。
- 两个 SKU：
  - `P103C-TEST-SKU-001`：完整 commercial_invoice_items + **有** original_inventory_imports + cost_allocations。
  - `P103C-TEST-SKU-002`：有 commercial_invoice_items + cost_allocations，**故意不建** original_inventory_imports。
- 注意：路由前置校验（4807-4815 行）会检查"所有 ciItems 是否都有 original_inventory_imports"。为让失败发生在**事务内**（而非前置拦截），Test 9 的失败注入须绕过前置校验落到事务内 throw。设计处理见 5.4。

### 5.4 让失败落在事务内（真实 API 路由，非隔离事务样例）

用户明确否决"绕过 HTTP 路由的隔离事务样例"（原 R2）：它只能证明 better-sqlite3 事务本身可回滚，不能证明真实路由的查询 / 循环 / generateWacVersion / cost_allocations 更新 / cost_update_logs / CI 汇总状态全部处于同一真实事务边界，且可能遗漏路由前置校验、错误捕获或返回处理造成的半提交风险。

**正式要求（实施必须实现，本轮最小范围接受）**：

1. 路由 `cost_allocations` 查询增加稳定业务排序：`ORDER BY sku_code ASC`（见 5.2）。
2. "缺少 original_inventory_imports"校验**必须在实际 `transaction` 的 SKU 循环内执行**，而不是在事务外预先扫描全部 SKU 后直接返回 400。
3. 因此路由须移除（或改为不拦截）现 4807-4815 行的 `missingSkus` 前置 400 拦截——缺失 origInv 不再在事务外被挡回，而是落入循环内 `throw`，从而触发**真实路由**事务整体回滚。
4. 路由在 catch 后返回 400 或 500，且 `error` 文案必须明确包含：`SKU <sku> 缺少原库存导入记录，WAC 确认已整体回滚`。

**Test 9 通过真实 API 路由执行（不接受隔离事务替代）**：

- 启动指向独立测试库副本（见 6.4）的服务实例；
- `POST /api/cost-allocation/update-weighted-avg/P103C-TEST-CI-901`；
- SKU-001：cost_allocation 与 original_inventory_import 均存在 → 事务内完成版本插入、allocation 更新、log 写入尝试；
- SKU-002：cost_allocation 存在、original_inventory_import 故意缺失 → 循环内 `throw`；
- 整个真实路由事务回滚。

### 5.5 验证断言（全部须成立）

| # | 断言 | 期望 |
|---|------|------|
| 9.1 | 真实路由返回 400/500，且 `error` 含 `SKU P103C-TEST-SKU-002 缺少原库存导入记录，WAC 确认已整体回滚` | 成立 |
| 9.2 | `wac_history WHERE ci_id='P103C-TEST-CI-901'` 行数 | **0**（SKU-001 版本已回滚） |
| 9.3 | SKU-002 是否产生版本 | 否 |
| 9.4 | `cost_allocations` 该 CI 的 original_qty/original_avg_cost | 与失败前一致（无部分更新） |
| 9.5 | `cost_update_logs WHERE related_ci_no='P103C-TEST-CI-901'` 行数 | **0** |
| 9.6 | `commercial_invoices.wac_confirmed`（该 CI） | **0** |
| 9.7 | `inventory` 两 SKU 的 available_qty/weighted_avg_cost/inventory_value | 不变 |
| 9.8 | `skus.weighted_avg_cost` 两 SKU | 不变 |

---

## 6. 修订 D：触发器不可变性测试 Test 10A/10B/10C

> 全部使用独立 `P103C-TEST-` 数据，**不得触碰 P103B 既有 locked 记录**。Test 10A/10B/10C **全部在独立测试库副本上执行**（见 6.4），不连接工作库，不 DROP 任何触发器。

### 6.1 Test 10A — 锁定记录 UPDATE 被拒

1. 在测试副本插入 `P103C-TEST-WAC-LOCK`（is_locked=1，其余字段合法）。
2. 执行 `UPDATE wac_history SET new_avg_cost=999 WHERE id='P103C-TEST-WAC-LOCK'`。
3. 断言：抛错，且 `err.message` 包含 `LOCKED_WAC_HISTORY_UPDATE_FORBIDDEN`。
4. 复查该记录 new_avg_cost 未变。

### 6.2 Test 10B — 锁定记录 DELETE 被拒

1. 复用/确保 `P103C-TEST-WAC-LOCK`（is_locked=1）存在。
2. 执行 `DELETE FROM wac_history WHERE id='P103C-TEST-WAC-LOCK'`。
3. 断言：抛错，且 `err.message` 包含 `LOCKED_WAC_HISTORY_DELETE_FORBIDDEN`。
4. 复查该记录仍存在。

### 6.3 Test 10C — 未锁定记录 UPDATE/DELETE 应成功

1. 在测试副本插入 `P103C-TEST-WAC-UNLOCK`（is_locked=0）。
2. `UPDATE wac_history SET new_avg_cost=888 WHERE id='P103C-TEST-WAC-UNLOCK'` → 应成功，复查值=888。
3. `DELETE FROM wac_history WHERE id='P103C-TEST-WAC-UNLOCK'` → 应成功，复查已删除。

### 6.4 测试隔离与清理（独立测试库副本，禁止 DROP 触发器）

用户明确否决"临时 DROP 触发器 → 删除记录 → 重建触发器"的清理方式：它会在测试期间主动关闭不可变保护，若中途异常可能导致触发器未恢复，且让正式库出现一段允许改/删锁定历史的窗口，与本任务目标冲突。

**正式要求**：

1. Test 9 与 Test 10 **必须在独立测试数据库副本上执行**，不得触碰当前工作库（data/inventory.db）。
2. 实施前（migration 已在本库生效后）复制独立测试库：
   `cp data/inventory.db data/P103C-TEST/inventory-test.db`（含 -wal/-shm）。
3. 测试服务 / 测试脚本通过 `DB_PATH` 环境变量**显式连接该测试副本**，禁止连接工作库。
4. Test 10 全部在测试副本上：建独立 `P103C-TEST-` 记录、验证锁定 UPDATE/DELETE 被拒、未锁定可改删。
5. 测试结束后**不删除测试副本内的任何行**（包括 locked 测试记录），仅**整体删除测试副本目录** `data/P103C-TEST/`。
6. 正式工作库中的两个触发器在测试期间**不得被 DROP、禁用或临时替换**。

> 说明：P1-03-B 原 49 项回归测试同样在该测试副本上运行（含 P103B-TEST- 既有数据，由副本携带），工作库始终只读无污染。

---

## 7. 受影响文件（最终）

| 文件 | 修改点 |
|------|--------|
| **db.js** | ① 显式探测式 migration 新增 commercial_invoices 三列（wac_confirmed/_at/_by）；② 创建 2 个固定错误码触发器；③ 完成后查 sqlite_master 校验触发器存在，缺失抛错停机；④ 禁用空 catch。 |
| **server.js** | ① update-weighted-avg：重复闸门改 `wac_confirmed`；cost_allocations 查询加 `ORDER BY sku_code ASC`；缺失 origInv 由 `return` 改 `throw`；事务末尾按 actualCount===expectedCount 置 wac_confirmed；停止写 wac_version_id。② cost-summary 端点返回 wac_confirmed/_at/_by。③ wac-history GET 端点已存在，无需改。 |
| **app.js** | ① "已确认"禁用态改读 wac_confirmed；② CI 状态展示改读汇总字段；③ 版本列表改用 `GET /api/wac-history?ci_id=` 一对多；④ 移除对 wac_version_id 的依赖；⑤ ERP 导入 warning 维持不变。 |
| **p103b-test.js** | 维护 P1-03-B 原 49 项（在独立测试副本上运行）。 |
| **p103c-test.js**（新增独立脚本） | Test 9（真实 API 路由、多 SKU 中途失败整体回滚）、Test 10A/10B/10C（触发器不可变性）；全部经 `DB_PATH` 连接独立测试副本 `data/P103C-TEST/inventory-test.db`，不触碰工作库。 |

---

## 8. 最小实施范围

仅第 7 节所列改动。**明确不做**：汇率 P1-WAC、wac_pending、完整 WAC 历史页面、菜单/页面结构/订单预测优化、其他 P1/P2、放宽路由前置校验、清理 P103B 测试数据。

---

## 9. 回滚方案

1. **触发器**：`DROP TRIGGER IF EXISTS trg_wac_history_block_update; DROP TRIGGER IF EXISTS trg_wac_history_block_delete;`
2. **字段**（二选一）：SQLite 3.49.2 支持 `ALTER TABLE commercial_invoices DROP COLUMN wac_confirmed`（及 _at/_by）；或保留列（默认 0，不影响逻辑）。
3. **代码**：`git revert` 或手工还原 server.js/app.js 第 7 节改动。
4. **wac_version_id**：全程未动，无需回滚。
5. 回滚不影响 P1-03-B 已生成的 wac_history 数据。

---

## 10. 最终验收标准（10 项，全部满足方可签发正式验收）

| # | 验收项 | 标准 |
|---|--------|------|
| 10.1 | P1-03-B 回归 | 原 **49 项全部通过** |
| 10.2 | Test 9 | 多 SKU 中途失败整体回滚通过（5.5 全部断言成立） |
| 10.3 | Test 10A/10B/10C | 触发器不可变性测试全部通过（含固定错误码匹配） |
| 10.4 | 触发器存在 | sqlite_master 可查到 `trg_wac_history_block_update` 与 `trg_wac_history_block_delete` |
| 10.5 | 汇总字段存在 | commercial_invoices 三个字段 wac_confirmed/_at/_by 真实存在 |
| 10.6 | 停止写 wac_version_id | 新 CI 确认后 wac_version_id 不再被写入 |
| 10.7 | 前端解耦 | 前端不再依赖 wac_version_id 判定或查询 |
| 10.8 | 一对多查询 | CI 所有版本均通过 wac_history.ci_id 查询 |
| 10.9 | migration 重启 | 重启两次均成功，不重复建列/触发器 |
| 10.10 | 错误不被吞 | migration 遇非预期错误能明确失败并中止启动，不以"成功"假象继续 |

---

## 附录 A：修订与用户指令对应

| 用户指令 | 本稿落实 |
|----------|----------|
| 一、固定 RAISE 错误码 | 第 3 节，两条触发器改纯字符串常量；实测 3.49.2 可创建 |
| 一、以实际 better-sqlite3 版本验证 | 第 1 节实测 3.49.2（更正 3.43.2）；实施前须再验 |
| 二、migration 禁止静默吞错 | 第 4 节，PRAGMA 探测列 + 失败抛错 + sqlite_master 校验 |
| 三、Test 9 走真实 API 路由 | 第 5 节，放弃 genId stub 与隔离事务样例，改为真实路由执行（ORDER BY sku_code ASC + 循环内缺失 origInv throw 触发真实事务回滚）；路由移除缺失 origInv 前置 400 拦截 |
| 三、迭代顺序确定性 | 第 5.2 节，cost_allocations 加 `ORDER BY sku_code ASC` |
| 四、Test 10A/B/C | 第 6 节，锁定 UPDATE/DELETE 被拒 + 未锁定可改删 |
| 五、验收标准调整 | 第 10 节，扩至 10 项 |

## 附录 B：现状快照（只读，未修改）

- SQLite（better-sqlite3 绑定）：**3.49.2**。
- wac_history：26 列全业务字段；索引 uq_wac_history_version(UNIQUE 4 列) + idx_wac_history_latest + idx_wac_history_ci；**当前无触发器**。
- commercial_invoices：现有 wac_version_id 列（default ''）；CI-001 = wac_1784004229784_t483f0（首 SKU 版本）。
- update-weighted-avg 路由：单一 transaction() 包裹全部 SKU；4818 行 allocations 查询无 ORDER BY；4830-4831 行缺失 origInv 时静默 return；4891 行写 wac_version_id=logs[0].wac_id；4803 行以 wac_version_id 作重复闸门。
- cost_allocations：按 sku_code 存储，无 country/warehouse 列。
- genId：db.js:67 硬编码函数，无依赖注入接口。

> 本稿为只读最终设计稿，所有实测仅用于设计依据，未对任何代码/数据库/测试数据做修改。完成后停止，等待实施批准。
