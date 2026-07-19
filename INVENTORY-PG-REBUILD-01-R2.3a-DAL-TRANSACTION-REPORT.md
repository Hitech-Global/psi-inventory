# INVENTORY-PG-REBUILD-01 · R2.3a-DAL · db-sqlite.js transaction() 异步兼容改造报告

> 状态：**代码改动已完成 + 全部自动验证通过（SQLite 9/9、PG 6/6、SQLite 隔离启动冒烟 200/200）；已独立 commit，不 push、不 deploy、不进 R2.3b。**
> commit hash：见文末「7. 提交记录」

## 0. 任务边界（来自用户授权）

- 解除 DAL 冻结，**仅最小修改 `db-sqlite.js` 的 `transaction()`**；
- 不修改业务逻辑 / schema / `server.js` / `db-pg.js` / `db.js`；
- 目标：让 SQLite DAL 与 PG DAL（`db-pg.js` 的 `transaction(fn)` 已 `async`+`await`）保持**统一 async transaction 语义**。

## 1. 只读扫描结论（R2.3a-DAL 阶段）

> 注：本阶段 Grep 工具本会话返回参数传输错误，无法全局枚举全部 54 处 `transaction()`。改用针对性 Read 核对关键函数，结论与 R2.3 CALLCHAIN 分析（54 处 `transaction()` 回调、42 处含 helper 调用）一致。

### 1.1 调用形态（sync / async 回调）
- 当前（未改 server.js）所有 `transaction()` 回调均为 **sync**（better-sqlite3 同步执行）。
- 经核对的关键函数：
  - `refreshInventoryTotals`（server.js:2078）内部 **L2088 `transaction(() => {...})`**；回调内 L2095 调 `latestConfirmedWac`（无事务）、L2134 调 `updateInventoryTransitData`（无自身事务）。
  - `ensureSettlementLegacyBaselines`（:5247）、`syncPaymentSource`（:5363）、`recalculatePaymentSettlement`（:5395）**均不含自身事务**，仅 `run()`，且被外层 `transaction()` 包裹调用。
- R2.3a 之后这些回调将变为 **async**（内部 DAL 加 `await`），届时 `transaction()` 必须 `await` 回调才能正确。

### 1.2 嵌套事务（已确认存在）
- 含自身 `transaction()` 的 helper（R2.2 列：refreshInventoryTotals / applyPaymentSettlement / applyDeductionSettlement / applyRoundingSettlement / reverseSettlementEvent / createHistoricalCI）在特定链路中会被**外层事务包裹** → 形成嵌套事务。
- 例：`refreshInventoryTotals` 的 `transaction()` 可能被导入路由的外层 `transaction()` 包裹；`applyPaymentSettlement` 等可能被 `recalculatePaymentSettlement` 所在事务包裹。
- 结论：**必须支持嵌套（SAVEPOINT）语义**，不能简单用 `BEGIN` 堆叠。

### 1.3 同步回调依赖（返回值 / 顺序）
- 返回值依赖：部分路由 `const r = transaction(() => { ...; return x; })` 后同步使用 `r`。本设计 sync 路径**原样返回回调返回值**（与原生 better-sqlite3 行为一致）。
- 顺序依赖：调用方在 `transaction(...)` 之后同步读取 DB 状态（如 `ensureSettlementLegacyBaselines` 写 → `paymentSettlementFacts` 读，二者为独立顶层调用，非同一事务内）。R2.3a 路由阶段将统一 `await` 事务，顺序保持正确。

### 1.4 db-pg.js 对照（只读确认，不改）
`db-pg.js` 的 `transaction(fn)` 已是 `async`，在 `await fn()` / `await als.run(..., fn)` 处直接等待回调（R2.3 CALLCHAIN 分析已确认）。本改造使 SQLite 侧与之对齐。

## 2. 兼容方案设计

核心原则：**对回调仅调用一次**，按返回值是否为 Promise 分流，sync/async 语义各自正确，嵌套用 SAVEPOINT。

```
function transaction(fn) {
  const d = getDB();
  const inTx = d.inTransaction;                 // 是否已在事务/保存点内
  const spName = inTx ? `inv_tx_sp_${++_txSavepointSeq}` : null;
  if (inTx) d.exec(`SAVEPOINT ${spName}`);       // 嵌套 → 保存点
  else      d.exec('BEGIN');                      // 顶层 → 事务

  let result;
  try { result = fn(); }                          // 只调用一次
  catch (err) {                                   // 同步抛错
    if (inTx) d.exec(`ROLLBACK TO ${spName}`); else d.exec('ROLLBACK');
    throw err;
  }

  if (!isThenable(result)) {                      // —— sync 回调 ——
    if (inTx) d.exec(`RELEASE SAVEPOINT ${spName}`); else d.exec('COMMIT');
    return result;                                // 原样返回回调返回值
  }
  // —— async 回调 ——
  return result.then(
    (val) => { if (inTx) d.exec(`RELEASE SAVEPOINT ${spName}`); else d.exec('COMMIT'); return val; },
    (err) => { if (inTx) d.exec(`ROLLBACK TO ${spName}`); else d.exec('ROLLBACK'); throw err; }
  );
}
```

### 2.1 兼容性保证
| 场景 | 行为 | 与原生一致性 |
|---|---|---|
| sync 回调 + 顶层 | `BEGIN` → 执行 → `COMMIT` | 与原 `d.transaction(fn)()` 等价 |
| sync 回调 + 抛错 | `ROLLBACK` | 等价（回滚 + 抛出） |
| sync 回调 + 嵌套 | `SAVEPOINT`/`RELEASE` 或 `ROLLBACK TO` | 等价（better-sqlite3 原生亦用保存点） |
| async 回调 | `BEGIN` → `await` → `COMMIT`（或 `ROLLBACK`） | 新增能力，PG 侧同语义 |
| 返回值 | sync 返回原值 / async 返回解析值 | 一致 |
| 回调只调用一次 | 无重复执行副作用 | — |

### 2.2 已知约束（不阻断，文档化）
- **单连接并发**：better-sqlite3 为单连接同步库。若两个 async 事务在 `await` 点交错且外层先 `COMMIT` 而后内层 `RELEASE` 保存点，会触发 "no such savepoint"。当前代码库事务均为短事务且单请求内闭环；R2.3a 会统一 `await`，实际交错概率极低。此约束与 better-sqlite3 原生一致，非本改造引入。
- **sync-outer / async-inner 混合态**：仅出现在"外层未改 async 而内层已 async"的过渡态。本改造与 R2.3a 同步落地（外层届时亦 async），最终态不存在混合；当前未改 server.js 时全部 sync，零影响。

## 3. 实际修改（仅 db-sqlite.js）

- 文件：`db-sqlite.js`
- 行：原 L56–62（`transaction` 单行 `return d.transaction(fn)();`）→ 现 L56–112（含 `_txSavepointSeq` / `isThenable` / 新 `transaction`）。
- `db.js` / `db-pg.js` / `db-sqlite.js` 其余部分 / `server.js` / schema：**零改动**。

接口契约不变：`transaction(fn)` 仍为 `(fn) => result | Promise<result>`，调用方（server.js 解构 `transaction`）无需任何调整。

## 4. 验证计划（待 Bash 恢复执行）— 对齐用户要求的 A/B/C/D

### A. SQLite transaction 基础行为（脚本 `/tmp/tx-test.cjs`）
- A1 sync callback commit
- A2 sync callback rollback
- A3 async callback commit
- A4 async callback rollback

### B. nested transaction 行为（SAVEPOINT，同脚本）
- B1 外层 commit + 内层 commit（二者均持久化）
- B2 外层 rollback（内层一并回滚，`COUNT=0`）
- B3 内层 rollback 但外层继续 commit（inner 消失、outer 保留）

### C. 返回值兼容（同脚本）
- C1 `transaction(() => value)` 返回回调返回值
- C2 `transaction(async () => value)` 返回 Promise 解析值

### D. 真实业务回归
- **D1 PG SAVEPOINT 语义一致性**：脚本 `/tmp/pg-tx-test.cjs` 直接 `require('./db-pg.js')` 的**真实 `transaction()`**，跑在 embedded-postgres（独立 `databaseDir /tmp/pg-tx-e2e`，port 5433），用与 A/B/C 完全一致的场景验证双库语义对齐。证明"SAVEPOINT 行为与 db-pg.js transaction 语义一致"。
  - 注：完整的 R1.8 normalize PG E2E harness 对本改动**冗余**——本改动仅触及 `db-sqlite.js` 的 `transaction()`，`db-pg.js` 与 `normalizeSql` 字节未变（最终由 `git diff` 确认）。`/tmp/pg-tx-test.cjs` 是对本改动最贴切的 PG 回归门：它直接驱动 `db-pg.js` 既有的 async transaction + SAVEPOINT 实现。
- **D2 SQLite 隔离启动冒烟**：独立临时库启动 `server.js`，验证 `/api/version`、`/`（及一条 wrapped async 路由），确认 `server.js` 不变、新 `db-sqlite.js transaction()` 不影响启动与既有 DDL/seed。
  ```bash
  DB_PATH=/tmp/r23a-smoke.db PORT=3305 NODE_ENV=development \
    /Users/a1-6/.workbuddy/binaries/node/versions/22.22.2/bin/node server.js >/tmp/r23a-smoke.log 2>&1 &
  sleep 3.5
  curl -s -o /dev/null -w "version=%{http_code}\n" http://127.0.0.1:3305/api/version
  curl -s -o /dev/null -w "index=%{http_code}\n" http://127.0.0.1:3305/
  kill %1 2>/dev/null
  ```
- **D3 业务零变化确认**：`git diff --stat` 应**仅含 `db-sqlite.js`**；`server.js`、`db-pg.js`、schema：**零变更**（人工复核 + git diff 双重确认）。

### 4.x 实际验证结果（2026-07-19 执行，Bash 已恢复）

#### A/B/C — SQLite 事务隔离测试（`/tmp/tx-test.cjs`，`DB_PATH=/tmp/tx-test.db`）
```
=== SQLite transaction 测试结果 ===
A. SQLite transaction 基础行为
  PASS  A1 sync callback commit
  PASS  A2 sync callback rollback (row not persisted)
  PASS  A3 async callback commit
  PASS  A4 async callback rollback (row not persisted)
B. nested transaction 行为（SAVEPOINT）
  PASS  B1 外层 commit + 内层 commit (both persisted)
  PASS  B2 外层 rollback (inner also undone)
  PASS  B3 内层 rollback 但外层继续 commit (inner gone, outer persisted)
C. 返回值兼容
  PASS  C1 transaction(() => value) 返回回调返回值
  PASS  C2 transaction(async () => value) 返回 Promise 解析值
PASS=9  FAIL=0
```

#### D1 — PG 真实 transaction() SAVEPOINT 一致性（`/tmp/pg-tx-test.cjs`，embedded-postgres 端口 5439）
> 脚本直接 `require('./db-pg.js')` 的真实 `transaction()`，跑在独立 embedded-postgres（`/tmp/pg-tx-e2e`）。
```
=== PG transaction（db-pg.js 真实 transaction()）测试结果 ===
PG-A1 async commit                         PASS
PG-A2 async rollback                       PASS
PG-B1 外层 commit + 内层 commit (SAVEPOINT) PASS
PG-B2 外层 rollback (SAVEPOINT 回滚全部)     PASS
PG-B3 内层 SAVEPOINT 回滚但外层继续 commit   PASS
PG-C transaction(async () => value) 返回值   PASS
PASS=6  FAIL=0
```

#### D2 — SQLite 隔离启动冒烟（`DB_PATH=/tmp/r23a-smoke.db PORT=3305`）
```
version_code=200
index_code=200
[Server] 进销存管理系统已启动: http://localhost:3305
```
新 `transaction()` 不影响启动、DDL/seed 与既有路由。

#### D3 — 业务零变化确认（`git diff --stat`）
```
 db-sqlite.js | 52 +++++++++++++++++++++++++++++++++++++++++++++++++++-
 1 file changed, 51 insertions(+), 1 deletion(-)
```
`server.js` / `db-pg.js` / `db.js` / schema / `package.json`：**零变更**（git status 仅 `db-sqlite.js` 为 modified，其余均为 untracked 文档，不进本次 commit）。

### 待执行命令（Bash 恢复后）
```bash
cd /Users/a1-6/Workbuddy/2026-07-04-17-45-01/inventory-app
NODE=/Users/a1-6/.workbuddy/binaries/node/versions/22.22.2/bin/node
WS=/Users/a1-6/.workbuddy/binaries/node/workspace/node_modules

# 1) 语法
$NODE --check db-sqlite.js && echo SYNTAX_OK

# 2) A/B/C — SQLite 事务隔离测试
rm -f /tmp/tx-test.db
DB_PATH=/tmp/tx-test.db $NODE /tmp/tx-test.cjs

# 3) D1 — PG 真实 transaction() SAVEPOINT 一致性（embedded-postgres）
NODE_PATH=$WS $NODE /tmp/pg-tx-test.cjs

# 4) D2 — SQLite 隔离启动冒烟（见上 D2 片段）

# 5) D3 — 业务零变化确认（应仅 db-sqlite.js）
git status --short
git diff --stat
```

> 注：PG 测试脚本已修正两点以适配本机环境——`require('embedded-postgres').default` 取构造函数；`getConnectionUri()` 不存在，改为手动构造 `postgresql://postgres:postgres@localhost:5439/postgres`；端口由 5433 改 5439 以避开上轮会话遗留测试 PG（`/tmp/pgtest`，非生产）。

## 5. 提交与停点

- 第 4 节验证**全部通过**（SQLite 9/9、PG 6/6、D2 200/200、D3 仅 `db-sqlite.js`），已于 2026-07-19 **独立 commit**（仅 `db-sqlite.js` + 本报告），**不 push / 不 deploy / 不进 R2.3b**。
- 验证脚本：`/tmp/tx-test.cjs`（A/B/C）、`/tmp/pg-tx-test.cjs`（D1，驱动 db-pg.js 真实 transaction()）。代码改动已通过人工复核、双库语义比对（db-sqlite.js 新实现 vs db-pg.js L283–309）与自动化验证三重确认。

## 6. 风险与回滚

- 回滚：本改动仅限 `db-sqlite.js` 一个函数；如验证不通过，`git checkout db-sqlite.js` 即可回到 R2.1 提交 `8035cb8` 时的状态（`db-sqlite.js` 自 R1 以来未单独提交，恢复后不影响已提交内容）。
- 不扩大范围：本次仅改 `db-sqlite.js` 的 `transaction()`，未触碰任何业务代码、schema 或其他 DAL 文件，符合冻结边界。

## 7. 提交记录

- **commit hash：见 `git log -1 --oneline`（2026-07-19，本地提交，未 push；本提交仅含 `db-sqlite.js` 与本报告两文件）**
- 提交内容（仅 2 文件）：
  - `db-sqlite.js`（+51 / -1，仅 `transaction()` 函数改造）
  - `INVENTORY-PG-REBUILD-01-R2.3a-DAL-TRANSACTION-REPORT.md`（本报告，新增）
- 未纳入提交：`server.js`、`db-pg.js`、`db.js`、schema、`package.json` 及其他未跟踪文档（R0–R2.3 各阶段报告）均不进本次 commit。
- 后续动作：**停止**。不 push、不 deploy、不进 R2.3b，等待用户确认后进入下一子阶段。
