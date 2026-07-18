# P1-03-B 实施补充核验报告

**日期**：2026-07-14 13:05
**性质**：只读核验，不修改任何代码、数据库或测试数据
**核验范围**：多SKU CI关联 / 事务原子性 / locked 版本不可变性

---

## 一、多 SKU CI 与单一 wac_version_id 的关联问题

### 1.1 CI-001 实际数据

```
CI-001: id=ci_1784004229784_lj5j6i, wac_version_id=wac_1784004229784_t483f0

WAC 记录（按 ci_id 查询，共 2 条）:
  [1] id=wac_1784004229784_t483f0  ver=1  sku=P103B-TEST-SKU-001  country=Indonesia  WH=Jakarta-WH  cost=63.6667
  [2] id=wac_1784004229784_lg3ncj  ver=1  sku=P103B-TEST-SKU-002  country=Indonesia  WH=Jakarta-WH  cost=60
```

### 1.2 关联规则

`CI.wac_version_id` = **`logs[0].wac_id`** — 即 `allocations` 数组中**第一个** SKU 的 WAC 记录。

对应代码 `server.js:4891`：
```js
run('UPDATE commercial_invoices SET wac_version_id = ?, ...', [logs[0].wac_id, req.params.ci_id]);
```

由于 `allocations` 来自 `SELECT * FROM cost_allocations WHERE ci_id = ? ORDER BY sku_code`（隐式排序），logs[0] 对应按 sku_code 排序后的第一条（SKU-001），不是 `created_at` 或 `version_no` 的最后一条。

### 1.3 问题分析

| 问题 | 结论 |
|------|------|
| wac_version_id 保存的是哪一条 | **第一条**（logs[0]），即 cost_allocations 中按 sku_code 排序的第一个 SKU |
| 是否最后一条覆盖前一条 | **否**。不存在覆盖，因为只写一次。但仅第一条关联被保存，第二条丢失 CI 头级直接引用 |
| 前端通过 wac_version_id 判断"CI 已确认"是否会遗漏 SKU | **会遗漏**。前端 `app.js:6453` 仅检查 `summary.wac_version_id` 是否为非空，`CI.wac_version_id` 非空时显示"已确认"，但仅表示第一个 SKU 生成了版本，**不能证明第二个 SKU 也已生成版本** |
| 查询 CI 全部 WAC 版本的正式依据 | **正式依据应为 `wac_history.ci_id`**（一对多查询），而非 `commercial_invoices.wac_version_id`（只能查一条） |
| 单一字段能否正确表达多 SKU 关系 | **不能**。一个 CI 可以有 N 个 SKU × M 个国家/仓库组合，单一 `wac_version_id` 字段无法表达 N×M 关系 |

### 1.4 当前重复确认的"保护机制"分析

`server.js:4803` 的重复确认检查：
```js
if (ci.wac_version_id) {
  return res.status(409).json({ error: '该 CI 已生成加权平均成本版本...' });
}
```

此检查在事务外执行。它确实阻止了重复提交整个 CI 确认请求，因为第一次确认后 `wac_version_id` 已非空。**但这只是一种粗粒度的锁机制** — 它只告诉调用方"这个 CI 已经确认过了"，无法知道确认了哪些 SKU。

### 1.5 推荐方案

**方案 A（推荐）**：CI 只保存 `wac_confirmed`（布尔）+ `confirmed_at`（时间）汇总状态，全部 WAC 版本通过 `wac_history.ci_id` 一对多查询。

- 理由：本次实施已经正确生成了 N 条 `wac_history` 记录（全部含 `ci_id`），只需修改 CI 头表状态字段和前端查询逻辑。
- 改动量小：CI.wac_version_id 改为布尔 wac_confirmed（或复用已存在的 cost_confirmed），前端判断和查询路径改为 `GET /api/wac-history?ci_id=xxx`。

**方案 B**：新增 CI ↔ WAC version 关联表。过度设计，不推荐。

**方案 C**：保留 wac_version_id，但明确它仅代表"批次头版本"（如仅记录首次确认时间）。此方案与当前行为一致，但信息不完整，已证实会遗漏 SKU。

### 1.6 当前实现是否影响验收

**影响正式验收**。`CI.wac_version_id` 仅关联第一个 SKU 的 WAC 版本，无法表达多 SKU 关系。前端、后端 wac_version_id 判定"CI 已确认"时，不能确保所有 SKU 的 WAC 版本都被正确记录。**但重复确认的 409 检查作为粗粒度锁不会让数据损坏**，因为所有操作在同一事务内，要么全成功要么全失败（参见第二节）。

---

## 二、CI 整体事务原子性

### 2.1 事务边界

`server.js:4828`：
```js
transaction(() => {
  allocations.forEach(alloc => {
    // ... 每个 SKU: generateWacVersion + cost_allocations UPDATE + cost_update_logs INSERT
  });
  // 最后：UPDATE CI.wac_version_id
  run('UPDATE commercial_invoices SET wac_version_id = ? WHERE id = ?', [logs[0].wac_id, req.params.ci_id]);
});
```

`db.js:59`：
```js
function transaction(fn) {
  const d = getDB();
  return d.transaction(fn)();
}
```

这使用的是 **better-sqlite3 原生事务**`db.transaction(fn)()`。整个回调是一个不可分割的原子事务。任一语句失败，整体回滚。

### 2.2 回答五个问题

| 问题 | 答案 |
|------|------|
| 1. 多 SKU CI 是否在一个总事务内 | **是**。遍历 `allocations.forEach` 和 CI 状态更新都在同一个 `transaction(() => { ... })` 内 |
| 2. 每个 SKU 是否单独开启提交 transaction | **否**。所有 SKU 共享一个事务，统一提交或回滚 |
| 3. 第一个 SKU 成功、第二个失败时 | **全部回滚**。wac_history 两条都撤销、cost_allocations 两条都撤销、cost_update_logs 两条都撤销、CI.wac_version_id 撤销 |
| 4. CI 状态更新与版本插入是否同一事务 | **是**。CI.wac_version_id UPDATE 在 `transaction()` 内部，与所有版本 INSERT 同事务 |
| 5. 49 项测试是否覆盖多 SKU 中途失败 | **否。这是验收缺口。** Test 1 验证了双 SKU 正常流程，但没有测试一个 SKU 失败时另一个 SKU 的回滚效果。CI-001 的 2 个 SKU 均成功 |

### 2.3 理论多 SKU 失败场景分析

假设第一个 SKU 正常，第二个 SKU 的 `generateWacVersion` 因 UNIQUE 约束冲突（并发版本号冲突）而失败：

| 操作 | 结果 |
|------|------|
| 第一条 wac_history | 回滚，不残留 |
| cost_allocations (SKU1) | 回滚，original_qty/original_avg_cost 恢复原值 |
| cost_update_logs (SKU1) | 回滚，不残留 |
| 第二条 wac_history | 未写入 |
| cost_allocations (SKU2) | 未修改 |
| cost_update_logs (SKU2) | 未写入 |
| CI.wac_version_id | 回滚，仍为 NULL |
| API 返回 | 500（better-sqlite3 抛出异常） |

**结论**：事务原子性在理论上成立（better-sqlite3 原生事务保证），但未被专门测试覆盖。标记为**验收缺口**。

---

## 三、locked 版本不可变性

### 3.1 现有保护层

| 保护层次 | 状态 |
|----------|------|
| 数据库触发器（BEFORE UPDATE / BEFORE DELETE） | **无**。SQLite 的 wac_history 表无任何触发器 |
| 数据库触发器（阻止 UPDATE 锁定行） | **无** |
| 数据库触发器（阻止 DELETE 锁定行） | **无** |
| UNIQUE 索引 | 仅防止 `(sku_code,country,warehouse,version_no)` 重复写入，**不阻止 UPDATE 或 DELETE** |
| is_locked = 1 字段 | 仅应用层语义标记，无数据库级约束。任何 `UPDATE wac_history SET new_avg_cost=999 WHERE is_locked=1` 在 SQL 层可执行 |
| API 层是否有写入端点 | **无**。仅 `GET /api/wac-history` 读端点；全项目无 UPDATE/DELETE/POST/PUT 到 wac_history |
| 应用层是否有更新/删除代码 | **无**。`generateWacVersion` 只有 INSERT；`update-weighted-avg` 只调用 `generateWacVersion`；其他代码无 wac_history 写入 |
| 攻击面：直接 db.run() 调用 | 任何有 `db` 引用的代码段均可直接执行 `db.run('DELETE FROM wac_history WHERE ...')`，无防护 |

### 3.2 测试覆盖

| 当前测试是否验证 | 状态 |
|-----------------|------|
| 修改 locked 版本被拒绝 | **未测试** |
| 删除 locked 版本被拒绝 | **未测试** |
| 成本确认生成的是 locked=1 | **已测试**（Test 1 第 203 行） |

### 3.3 原实施报告措辞修正

原报告（P1-03-B-IMPL-REPORT-20260714.md）中的表述：

> "wac_history 锁定且不可覆盖"

**应修正为**：

> "当前通过应用流程生成 is_locked=1 的 confirmed 版本；应用层未提供业务修改/删除入口；API 层无 wac_history 写入端点。数据库层（触发器）和调用层（任意代码直接 UPDATE/DELETE wac_history）的不可变保护尚未验证或实施。UNIQUE 版本索引仅防重复插入，不作为防 UPDATE/DELETE 的证据。"

### 3.4 风险评估

| 风险 | 等级 | 说明 |
|------|------|------|
| 通过正常 API 修改/删除 | **无** | 无此类 API |
| 通过正常前端操作修改/删除 | **无** | 无对应页面 |
| 通过未来新增 API 误改 | **中** | 无数据库触发器兜底 |
| 通过直接数据库操作 | **高** | 无任何防护，但属运维风险 |
| 通过未来路由注册误暴露 | **中** | 当前无路由，但无触发器兜底 |

**建议**（本轮不得实施）：添加 BEFORE UPDATE / BEFORE DELETE 触发器，当 is_locked=1 时 RAISE(ABORT)。不在本次 P1-03-B-IMP 范围。

---

## 四、补充核验汇总

### 4.1 当前多 SKU CI 的实际关联结构

```
commercial_invoices.wac_version_id → wac_history.id (仅第一条 SKU 的记录，非全部)
wac_history.ci_id → commercial_invoices.id (一对多，正确表达了全部 SKU)
```

**结构缺陷**：`CI.wac_version_id` 单一字段无法表达多 SKU 关联。前端通过该字段判断"已确认"只能说明第一个 SKU 有版本，不能证明全部 SKU 已确认。

### 4.2 P103B-TEST-CI-001 两条 WAC 记录 ID

| # | id | sku_code |
|---|-----|----------|
| 1 | `wac_1784004229784_t483f0` | P103B-TEST-SKU-001 |
| 2 | `wac_1784004229784_lg3ncj` | P103B-TEST-SKU-002 |

### 4.3 CI.wac_version_id 实际值及其对应记录

- CI.wac_version_id = `wac_1784004229784_t483f0`
- 对应记录：SKU-001, Indonesia, Jakarta-WH, version_no=1, cost=63.6667
- SKU-002 的记录（`wac_1784004229784_lg3ncj`）**未在 CI.wac_version_id 中体现**

### 4.4 真实事务调用层级

```
update-weighted-avg 路由处理器 (req, res)
  └─ transaction(() => {              ← better-sqlite3 原生事务，整体原子
       ├─ forEach allocation:
       │   ├─ generateWacVersion()    ← INSERT wac_history (version_no = MAX+1)
       │   ├─ run(UPDATE cost_allocations)
       │   └─ run(INSERT cost_update_logs)
       └─ run(UPDATE commercial_invoices SET wac_version_id = logs[0].wac_id)
     })
```

### 4.5 多 SKU 中途失败的理论数据库结果

第二条 `generateWacVersion` 因 UNIQUE 冲突失败 → better-sqlite3 抛出异常 → 事务自动回滚 → **所有表不残留任何本次写入**（wac_history 为空、cost_allocations 恢复、cost_update_logs 为空、CI.wac_version_id 恢复 NULL）。

### 4.6 locked 版本现有保护能力

| 保护类型 | 是否存在 | 强度 |
|----------|---------|------|
| API 层禁止写入 | ✅（无端点） | 强 |
| 应用层禁止修改 | ✅（无代码路径） | 强 |
| 数据库触发器 | ❌ | 无 |
| UNIQUE 索引防覆盖 | ❌（只防重复 INSERT，不防 UPDATE） | 无 |

### 4.7 三项是否影响 P1-03-B 正式验收

| 核验项 | 是否影响验收 | 说明 |
|--------|------------|------|
| **一、多SKU wac_version_id** | **是** | 单一字段无法表达多 SKU 关系，前端判断"已确认"语义不完整。但所有 WAC 版本正确通过 `ci_id` 一对多关联，数据本身未丢失。 |
| **二、事务原子性** | **部分** | 事务边界正确（better-sqlite3 原生原子保证），但多 SKU 中途失败回滚**未被测试覆盖**（验收缺口）。 |
| **三、locked 不可变性** | **是** | 无数据库触发器保护。当前依赖应用层纪律（无写入 API/代码），但数据库层仍可被直接 UPDATE/DELETE。原报告"不可覆盖"表述需修正。 |

### 4.8 如需修正，最小修正建议（本轮不得实施）

1. **多 SKU CI 关联**（方案 A）：将 `CI.wac_version_id` 改为布尔 `wac_confirmed`（或复用已有 `cost_confirmed`），前端和后端判断改为 `wac_confirmed`；多 SKU 版本查询统一走 `GET /api/wac-history?ci_id=xxx`。约 5 行 server.js + 5 行 app.js + 1 行 db.js。

2. **事务回滚测试**：新增 P103B-TEST-03B，在事务内制造第二个 SKU 的 UNIQUE 冲突（如预插入一条同维度 WAC），验证第一个 SKU 全部回滚。

3. **数据库触发器**：添加 `wac_history_before_update` 和 `wac_history_before_delete` 两个触发器，当 `OLD.is_locked = 1` 时 RAISE(ABORT, 'Locked WAC version cannot be modified or deleted')。db.js 约 15 行。

---

**核验完成，不修改任何代码、数据库或测试数据。不签发正式验收。**
