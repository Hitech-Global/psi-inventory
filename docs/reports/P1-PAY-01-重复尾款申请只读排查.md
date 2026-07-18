# P1-PAY-01 重复尾款申请只读排查报告

- **任务编号**：P1-PAY-01
- **任务名称**：《重复尾款申请只读排查》
- **排查性质**：只读（代码静态分析 + `better-sqlite3` 只读查询，无写入）
- **工作目录**：`/Users/a1-6/Workbuddy/2026-07-04-17-45-01/inventory-app`
- **数据库**：`./data/inventory.db`（WAL，`readonly: true` 打开）
- **报告生成日期**：2026-07-14
- **结论等级**：**已确认存在真实重复**（生产/演示库中存在 1 例真实重复尾款申请）

---

## 1. 当前代码事实（生成尾款路由、判定逻辑、行号）

### 1.1 尾款生成入口
- **路由**：`POST /api/payment-requests/from-ci-balance`
- **位置**：`server.js:4331-4353`
- **权限**：`requireApiPermission('payment_create')`
- **核心逻辑（逐行）**：
  - `server.js:4334` 读取 CI：`const ci = queryOne('SELECT * FROM commercial_invoices WHERE id = ?', [ci_id]);`
  - `server.js:4335` 仅校验 CI 是否存在，**未**校验该 CI 是否已存在有效尾款申请。
  - `server.js:4337` 应付金额取自 CI 全量尾款：`const payableAmount = ci.payable_balance || 0;`（注意：取的是 CI 整笔 `payable_balance`，**不是剩余未付**）。
  - `server.js:4345-4348` 生成 `request_no`（`PAY-BAL-YYYY-...`）并 `INSERT INTO payment_requests`，写入字段 `payment_category='goods'`、`payment_subcategory='balance'`、`source_type='ci'`、`source_id=ci_id`、`payment_status='pending_approval'`、`approval_status='pending'`。
  - `server.js:4350` 无条件更新 CI 标志：`run('UPDATE commercial_invoices SET balance_payment_status = ? WHERE id = ?', ['pending_approval', ci_id]);`
- **关键缺陷**：整段逻辑**没有**任何「该 CI 已有有效尾款申请」的前置查询（无 `SELECT ... WHERE source_type='ci' AND source_id=? AND payment_subcategory='balance'`），INSERT 与 CI 标志更新也**未包在事务中**。

### 1.2 类型判定
- 尾款类型由固定字面量决定：`payment_category='goods'` + `payment_subcategory='balance'` + `source_type='ci'`（`server.js:4347-4348`）。
- 字典定义见 `server.js:947-952`（`ci: ['balance', ...]`、`balance: '尾款'`）。

---

## 2. 当前数据库事实（payment_requests 结构、type/status 取值、样本、同 CI 多尾款现状）

### 2.1 payment_requests 表结构（来自 `db.js:886-916` 实测 pragma）
- 主键：`id`；唯一约束：`request_no`（自增随机号，永不冲突）。
- 与尾款相关的关键列：`payment_category`、`payment_subcategory`、`source_type`、`source_id`、`source_no`、`payable_amount`、`paid_amount`、`unpaid_amount`、`payment_status`、`approval_status`、`related_ci_id`、`related_ci_no`。
- **无任何针对 `(source_type, source_id, payment_subcategory)` 的唯一索引/约束**（实测 `sqlite_master` 仅 `request_no` 唯一、`idx_payment_status` 普通索引）。

### 2.2 取值分布（只读查询实测）
- `payment_subcategory`：`balance=11`、`deposit=14`、`duty=7`、`freight=9`、`inspection=7`。
- `payment_status`：`approved=22`、`paid=11`、`partial_payment_partial_deduction=1`、`pending_approval=13`、`rejected=1`。
- `commercial_invoices.balance_payment_status`：`unpaid=38`、`pending_approval=3`、`paid=7`。

### 2.3 同一 CI 多尾款现状（**已确认重复**）
按 `source_type='ci' AND payment_subcategory='balance'` 分组，`source_id` 出现 >1 次的记录：

| source_id | source_no | balance 申请数 | 其中未拒绝数 |
|---|---|---|---|
| `ci_1783996885092_xs7th0` | CI-2026-885093 | 2 | 2 |

**该 CI 的两条尾款申请明细**：
| request_no | payment_status | approval_status | payable_amount | paid_amount | created_at |
|---|---|---|---|---|---|
| PAY-BAL-2026-713834 | paid | approved | 21 | 21 | 2026-07-14 02:55:13 |
| PAY-BAL-2026-263588 | pending_approval | pending | 21 | 0 | 2026-07-14 03:04:23 |

**CI 当前状态**：`goods_amount=30`、`payable_balance=21`、`paid_balance=21`、`unpaid_balance=0`、`ci_status=completed`、`balance_payment_status=pending_approval`。

> 解读：第一条尾款（21）已**全额支付**（paid_balance=21, unpaid=0）。约 9 分钟后又生成了第二条完全相同金额（21）的尾款申请，且仍处于 `pending_approval`。CI 的 `balance_payment_status` 被第二条的 INSERT 回写为 `pending_approval`，与 `paid_balance=21 / unpaid_balance=0` 构成**内部状态不一致**。若第二条被审批并支付，供应商将就同一笔 21 尾款收到 42，**构成重复付款风险**。

### 2.4 对照系统：payable_items 唯一约束被该路由绕过
- `payable_items` 表存在部分唯一索引 `uq_payable_active ON (source_type, source_id, fee_type) WHERE is_active=1`（`db.js:954-958`），本可防止同一来源重复费用单。
- 但实测该重复 CI 在 `payable_items` 中**无任何行**（`SELECT ... WHERE source_id='ci_1783996885092_xs7th0'` 返回 0 行）。即 `from-ci-balance` 路由**根本不写入 payable_items**，该唯一约束对尾款申请**完全不生效**。

---

## 3. 完整调用链（前端点击 → 接口 → DB 插入，重复如何产生）

1. **前端**：`loadCI()`（`app.js:5855`）仅在 `c.payable_balance>0 && c.balance_payment_status==='unpaid' && hasPermission('payment_create')` 时渲染「💰 尾款付款」按钮，点击调用 `createBalPay(id)`（`app.js:5879`）。
2. **前端弹窗/提交**：`saveBalPay(id)`（`app.js:5899-5901`）直接 `POST /api/payment-requests/from-ci-balance`，body 仅含 `ci_id` 与抵扣信息，**无客户端重复校验**；按钮在请求返回成功后才 `closeModal()`，点击与成功返回之间存在可重发窗口。
3. **接口**：`server.js:4331` 路由收到请求 → 仅校验 CI 存在 → 取 `ci.payable_balance` → `INSERT payment_requests` → `UPDATE commercial_invoices SET balance_payment_status='pending_approval'`。
4. **重复产生路径**：
   - **路径 A（绕过 UI）**：直接调用 API（脚本/Postman/其他前端）可无视 `balance_payment_status` 按钮门禁，反复 `POST` 即生成多条同 CI 尾款。
   - **路径 B（状态回归后重提）**：尾款被 `reject` 或 `partial_payment` 后，CI 标志停留为 `pending_approval`/`paid`，按钮隐藏；但 API 无校验，再次 `POST` 仍成功，且金额按 CI 全量 `payable_balance` 重算（见 §4）。
   - **路径 C（并发点击）**：两个并发 `POST` 都通过「无前置校验」，DB 无唯一索引，两条均 INSERT 成功。
   - 本例 CI-2026-885093 即路径 A/B 的真实复现（首条已付，9 分钟后又生成第二条）。

---

## 4. 缺陷或风险

1. **无服务端重复校验**：`from-ci-balance` 路由在生成前不查询「该 CI 是否已有有效尾款申请」，任何调用方均可重复生成。
2. **数据库无唯一约束**：`payment_requests` 仅在 `request_no` 上唯一；`(source_type, source_id, payment_subcategory)` 无唯一/部分索引，无法在 DB 层兜底。
3. **金额按 CI 全量尾款计算，非剩余未付**：`payableAmount = ci.payable_balance`（`server.js:4337`）。部分付款后若再次生成，会就「已付部分」重复请款，直接导致超额付款。
4. **状态机不完整 / 标志被覆盖**：
   - `approve`（`server.js:4485-4490`）只改 `payment_status`，不动 `ci.balance_payment_status`；
   - `reject`（`server.js:4491-4492`）置 `payment_status='rejected'`，但**不把 CI 标志回退为 `unpaid`**，CI 标志仍 `pending_approval`；
   - `confirm-paid`（部分付款）`server.js:4507-4510` 无论是否付全款都写 `balance_payment_status='paid'`，并可能将 `unpaid_balance` 直接置 0，掩盖剩余未付；
   - `from-ci-balance` 的 `UPDATE ... SET balance_payment_status='pending_approval'`（`server.js:4350`）会**覆盖**已被 `confirm-paid` 置为 `paid` 的标志 → 产生本例的「paid_balance=21 但 status=pending_approval」内部不一致。
5. **接口非幂等 / 无事务**：INSERT 与 CI 标志更新未包事务，并发下两条 INSERT 均可落库。
6. **付款申请无取消/作废/删除路由**：全库仅存在 GET/生成/抵扣/审批/导入结果路由（见 `server.js:4225-4546`），`payment_requests` 不存在 `cancel/void/delete`，重复数据无法在业务层撤销（只能靠 `reject`）。

---

## 5. 受影响文件、函数、接口、表和字段

- **文件/函数**：
  - `server.js`：`POST /api/payment-requests/from-ci-balance`（4331-4353，根因）
  - `server.js`：`POST /api/payment-requests/:id/approve`（4474-4516，状态机未维护 CI 标志）
  - `server.js`：CI 标志相关更新（4350、4507-4510、4536）
  - `app.js`：`loadCI()`（5855，按钮门禁）、`createBalPay()`（5879）、`saveBalPay()`（5899，无客户端校验、无防重发锁）
- **接口**：`POST /api/payment-requests/from-ci-balance`（非幂等、无重复校验）
- **表**：`payment_requests`、`commercial_invoices`
- **字段**：
  - `payment_requests.payment_category / payment_subcategory / source_type / source_id / payment_status / approval_status`
  - `commercial_invoices.balance_payment_status / payable_balance / paid_balance / unpaid_balance`

---

## 6. 最小方案（仅设计，不实施）

**仅改 `server.js` 一处，行为层拦截，不触碰表结构**：
在 `from-ci-balance` 路由 `INSERT` 之前，新增查询：
```sql
SELECT 1 FROM payment_requests
WHERE source_type='ci' AND source_id=? AND payment_subcategory='balance'
  AND payment_status NOT IN ('rejected','deduction_settled')
LIMIT 1
```
若存在则返回 `409 { error: '该 CI 已存在有效的尾款付款申请，请勿重复发起' }`。
并将 `INSERT payment_requests` 与 `UPDATE commercial_invoices SET balance_payment_status='pending_approval'` 用 `db.transaction(...)` 包裹，保证原子性。

> 说明：最小方案不改变 schema，仅做「读后写」校验，可挡住绝大多数重复（含绕过 UI 的直调），但依赖代码路径全部经过该路由；若未来有其他入口生成尾款则不兜底。

---

## 7. 完整方案（仅设计，不实施）

在最小方案基础上补齐状态机与 DB 层防御：

1. **DB 层部分唯一索引**（DDL，`db.js` 迁移，本轮禁止执行）：
   ```sql
   CREATE UNIQUE INDEX IF NOT EXISTS uq_pr_active_balance
     ON payment_requests(source_type, source_id, payment_subcategory)
     WHERE payment_status NOT IN ('rejected','deduction_settled');
   ```
   镜像 `payable_items.uq_payable_active`，任何代码路径生成的「有效尾款」均无法重复落库（深度防御）。
2. **服务端前置校验 + 事务**（同最小方案）。
3. **状态机补全**：
   - `reject`：若该 CI 无其他有效尾款申请，将 `ci.balance_payment_status` 回退为 `unpaid`；
   - `confirm-paid`：仅当 `ci.unpaid_balance<=0` 时置 `balance_payment_status='paid'`，否则置为「partial」状态；
   - `from-ci-balance` 不再无条件覆盖标志，改为「仅在当前为 `unpaid` 时置 `pending_approval`」。
4. **金额取剩余未付**：`payableAmount = ci.unpaid_balance`（或 `payable_balance - paid_balance`），避免就已付部分重复请款。
5. **历史数据修复脚本**（只读检测 + 人工确认后合并/作废重复）：识别 `source_id` 出现 >1 次的 CI（如本例 CI-2026-885093），将多余待审申请 `reject`/`void`。

---

## 8. 推荐方案（仅设计，不实施）

**采用「DB 部分唯一索引（§7-1）+ 服务端前置校验与事务（§6）+ 状态机补全与剩余金额计算（§7-3/4）」组合**，理由：
- 唯一索引提供不依赖代码的绝对兜底，与既有 `payable_items` 设计规范一致；
- 服务端校验给出友好 409 提示，改善体验；
- 状态机与剩余金额修正消除「已付后重复请全额」的超额付款根因；
- 三者互补，单点失败不影响整体防重。

前端配套（§5 已列）：`saveBalPay` 点击后立即禁用按钮防双击，并对 409 给出明确提示。

---

## 9. 实施修改范围（列出需改文件/表/字段/索引，本轮不做）

| 类别 | 对象 | 改动内容 |
|---|---|---|
| 路由逻辑 | `server.js` `from-ci-balance` (4331-4353) | 新增前置重复校验（返回 409）；用事务包裹 INSERT + CI 标志更新；金额改取 `unpaid_balance` |
| 路由逻辑 | `server.js` `approve` (4474-4516) | `reject` 分支回退 `ci.balance_payment_status='unpaid'`（无其他有效尾款时）；`confirm-paid` 按 `unpaid_balance` 决定 `paid`/`partial` |
| 表结构(DDL) | `db.js` 迁移区 | 新增 `uq_pr_active_balance` 部分唯一索引（`payment_requests(source_type, source_id, payment_subcategory) WHERE payment_status NOT IN ('rejected','deduction_settled')`） |
| 前端 | `app.js` `saveBalPay` (5899) | 提交后禁用按钮防双击；处理 409 友好提示 |
| 数据修复 | 一次性脚本（非本次） | 检测并合并/作废重复尾款（CI-2026-885093 等） |

> **本轮禁止执行以上任何改动**（违反只读边界即失败）。以上仅作为设计交付。

---

## 10. 针对性测试建议（含并发）

1. **并发防重（核心）**：对同一个 `ci_id` 并发发起 10 个 `POST /api/payment-requests/from-ci-balance`，断言「恰好 1 条成功、其余返回 409」，且 `payment_requests` 中该 CI 的有效尾款行数 = 1。在加了 `uq_pr_active_balance` 后，应验证 DB 层对第 2 条 INSERT 返回唯一约束冲突。
2. **拒绝后重提**：生成尾款 → `reject` → 再次生成；断言返回 409，且 CI `balance_payment_status` 已回退为 `unpaid`（若无其他有效申请）。
3. **部分付款后重提**：生成尾款 → `confirm-paid` 部分金额 → 再次生成；断言被拦截，且 `payable_amount` 不得取 CI 全量（应为剩余未付）。
4. **双击 UI 防重**：在 `saveBalPay` 弹窗连续快速点击两次提交，断言 `payment_requests` 仅新增 1 行（按钮禁用 + 服务端校验双保险）。
5. **幂等/唯一索引迁移测试**：直接构造两条相同 `(source_type, source_id, payment_subcategory)` 且 status 非 rejected 的 INSERT，断言第二条被唯一索引拒绝。
6. **存量数据对账测试**：运行查询「同一 CI 存在 >1 条有效尾款申请」，应检出本例 CI-2026-885093，作为回归基线；修复后该查询须返回 0 行。
7. **状态一致性测试**：任意尾款生命周期结束后，断言 `commercial_invoices` 的 `balance_payment_status / paid_balance / unpaid_balance` 三字段自洽（不再出现本例「paid_balance=21 但 status=pending_approval」）。

---

## 11. 明确本轮零修改

- **数据库**：仅以 `new Database('./data/inventory.db', { readonly: true })` 执行 `SELECT`/pragma，未执行任何 `INSERT/UPDATE/DELETE/DDL`。
- **代码/页面/测试/日志/报告**：未使用 Edit/Write 修改 `server.js`、`db.js`、`app.js`、`index.html`、任何 `.db`、`.md`（除本报告）或 `.workbuddy` 目录。
- **临时脚本**：排查用的两个临时 `.js`（`_tmp_p1pay01_readonly.js`、`_tmp_p1pay01_dup.js`）已运行后删除，工作区无残留。
- **唯一创建文件**：本报告 `P1-PAY-01-重复尾款申请只读排查.md`。
- **未运行任何写入型测试**。

> 综上，本轮为纯只读排查，未对系统做任何写入或结构变更；所有修复方案（§6/§7/§8/§9）均为设计描述，待后续授权实施。
