# P1-PAY-01 实施方案（仅文档，不实施）

- **任务编号**：P1-PAY-01
- **任务名称**：《重复尾款申请修复》
- **优先级**：P1（业务一致性 / 防止重复付款）
- **文档性质**：实施方案，**本轮仅产出本文件，不修改任何代码、数据库、接口、页面、测试数据、日志或报告**。
- **依据报告**：`P1-PAY-01-重复尾款申请只读排查.md`
- **本轮创建文件**：本文档 `P1-PAY-01-实施方案.md`（唯一允许创建的文件）
- **日期**：2026-07-14

---

## 1. 目标与范围

- **目标**：消除「同一 CI 可重复生成有效尾款申请」的缺陷，防止对供应商就同一笔尾款重复付款；并消除「已付部分仍按全量请款」「CI 状态标志被覆盖」的内部不一致。
- **范围（最小修改）**：
  - **单任务**：本项只修「尾款重复生成 + 金额/状态一致性」这一个缺陷。
  - **改动对象限定**：
    1. `server.js` 的 `POST /api/payment-requests/from-ci-balance` 路由（`server.js:4331-4353`）——加防重校验、事务、取剩余未付。
    2. `server.js` 的 `POST /api/payment-requests/:id/approve`（`server.js:4474-4516`）中 `reject` / `confirm-paid` 分支的状态机补全。
    3. `db.js` 迁移区新增「部分唯一索引」`uq_pr_active_balance`（DDL）。
    4. `app.js` 的 `saveBalPay`（`app.js:5899`）前端防双击与 409 提示（轻量配套，非根因）。
  - **不新增业务规则**：仅做防御性拦截与状态自洽，不改变尾款业务语义、审批流、额度口径。
- **完成即停**：本项完成（防重 + 一致性）即停，进入下一项须经用户批准。
- **本轮不执行**：本方案所有内容均待后续授权实施；本文件产出后不写任何代码。

---

## 2. 当前事实（引报告关键证据与行号）

基于只读排查报告与本轮只读复核（已运行后删除临时 `.js`）：

1. **生成前无重复校验**：`from-ci-balance` 路由 `server.js:4334-4335` 仅 `SELECT * FROM commercial_invoices WHERE id=?` 校验 CI 是否存在，未查询「该 CI 是否已有有效尾款申请」；紧接着 `server.js:4345-4348` 直接 `INSERT payment_requests`，`server.js:4350` 无条件 `UPDATE commercial_invoices SET balance_payment_status='pending_approval'`。
2. **INSERT 与 CI 标志更新未包事务**：`server.js:4345-4350` 两步写操作裸跑，并发下两条 INSERT 均可落库（报告 §4-5）。
3. **金额取全量非剩余**：`const payableAmount = ci.payable_balance || 0;`（`server.js:4337`）。部分付款后若再次生成，会将「已付部分」重复请款，直接导致超额付款（报告 §4-3）。
4. **payment_requests 无唯一约束**：实测 `sqlite_master` 仅 `request_no` 唯一 + `idx_payment_status` 普通索引；**不存在** `(source_type, source_id, payment_subcategory)` 的任何唯一/部分索引。对照 `payable_items.uq_payable_active`（`db.js:954-958`）对该路由无效——尾款申请根本不写入 `payable_items`（报告 §2.4）。
5. **已存在真实重复（已确认）**：按 `source_type='ci' AND payment_subcategory='balance'` 分组，本轮只读复核确认：
   - `source_id = ci_1783996885092_xs7th0`（**CI-2026-885093**）存在 **2 条**尾款申请，且 **2 条均非 rejected/deduction_settled（active_n=2）**。
   - 明细（报告 §2.3）：
     | request_no | payment_status | approval_status | payable_amount | paid_amount | created_at |
     |---|---|---|---|---|---|
     | PAY-BAL-2026-713834 | paid | approved | 21 | 21 | 2026-07-14 02:55:13 |
     | PAY-BAL-2026-263588 | pending_approval | pending | 21 | 0 | 2026-07-14 03:04:23 |
   - CI 现状：`payable_balance=21`、`paid_balance=21`、`unpaid_balance=0`、`ci_status=completed`、`balance_payment_status=pending_approval`。
   - **风险**：首条尾款已全额支付（paid_balance=21, unpaid=0），9 分钟后又生成第二条同额（21）尾款且仍 `pending_approval`；若被审批支付，供应商就同一笔 21 尾款将收到 42，构成**重复付款**；CI 标志 `pending_approval` 与 `paid_balance=21/unpaid=0` 构成**内部状态不一致**。
6. **状态机不完整 / 标志被覆盖**：
   - `reject`（`server.js:4491-4492`）置 `payment_status='rejected'`，但不把 `ci.balance_payment_status` 回退为 `unpaid`；
   - `confirm-paid`（`server.js:4507-4510`）无论是否付全款都写 `balance_payment_status='paid'` 且 `unpaid_balance=0`，掩盖剩余未付；
   - `from-ci-balance` 的 `UPDATE ... SET balance_payment_status='pending_approval'`（`server.js:4350`）会**覆盖**已被 `confirm-paid` 置为 `paid` 的标志，产生本例「paid_balance=21 但 status=pending_approval」不一致。

---

## 3. 实施方案（精确：文件/函数/行号附近；遵循最小修改）

> 下列行号为当前 `server.js` / `db.js` 位置；实施时以实际内容为准，仅做局部插入/改写，不重构周边。

### 3.1 服务端前置防重校验 + 事务（根因拦截）
**文件/位置**：`server.js` `POST /api/payment-requests/from-ci-balance`（`server.js:4331-4353`）

在 `server.js:4335`（CI 存在性校验）之后、`server.js:4337` 取金额之前，插入重复校验：
```js
// 防重：该 CI 已存在有效尾款申请则拒绝（rejected / deduction_settled 视为已失效）
const existing = queryOne(
  `SELECT 1 FROM payment_requests
   WHERE source_type='ci' AND source_id=? AND payment_subcategory='balance'
     AND payment_status NOT IN ('rejected','deduction_settled')
   LIMIT 1`,
  [ci_id]
);
if (existing) {
  return res.status(409).json({ error: '该 CI 已存在有效的尾款付款申请，请勿重复发起' });
}
```
将 `server.js:4345-4350`（生成 `prId/prNo` → `INSERT payment_requests` → `UPDATE commercial_invoices SET balance_payment_status='pending_approval'`）整体用现有事务助手包裹，保证原子性：
```js
transaction(() => {
  run(`INSERT INTO payment_requests (...) VALUES (...)`, [...]);
  // 仅在当前非 pending_approval/paid 时置 pending_approval，避免覆盖已付标志
  run('UPDATE commercial_invoices SET balance_payment_status = ? WHERE id = ? AND balance_payment_status = ?',
      ['pending_approval', ci_id, 'unpaid']);
});
```
> 说明：`db.js:59` 已提供 `transaction(fn)` 助手，直接复用，不新写事务封装。

### 3.2 金额取「剩余未付」而非全量
**文件/位置**：`server.js:4337`

将
```js
const payableAmount = ci.payable_balance || 0;
```
改为取剩余未付（与 `confirm-paid` 的 `paid_balance/unpaid_balance` 口径一致）：
```js
const payableAmount = (ci.unpaid_balance != null) ? ci.unpaid_balance
                     : Math.max(0, (ci.payable_balance || 0) - (ci.paid_balance || 0));
```
> 不新增业务规则，仅让请款额等于「剩余未付」，消除已付部分被重复请款。

### 3.3 DB 层部分唯一索引（深度防御）
**文件/位置**：`db.js` 迁移区（紧邻 `payable_items.uq_payable_active` 的 `db.js:954-958` 之后新增；**DDL，本轮禁止执行**）

```sql
CREATE UNIQUE INDEX IF NOT EXISTS uq_pr_active_balance
  ON payment_requests(source_type, source_id, payment_subcategory)
  WHERE payment_status NOT IN ('rejected','deduction_settled');
```
- 镜像 `payable_items.uq_payable_active` 的设计规范，使任何代码路径生成的「有效尾款」均无法重复落库。
- 注意：索引含 `WHERE` 过滤，与现存真实重复数据（两条均非 rejected）**会冲突**——迁移前须先执行 §7 数据清理（须批准），否则 `CREATE UNIQUE INDEX` 会因现有 2 行冲突而失败。

### 3.4 状态机补全（消除标志不一致）
**文件/位置**：`server.js` `approve` 路由 `server.js:4474-4516`

- **reject 分支**（`server.js:4491-4492`）：`reject` 后，若该 CI 无其他有效尾款申请，将 `ci.balance_payment_status` 回退为 `unpaid`：
  ```js
  const other = queryOne(
    `SELECT 1 FROM payment_requests
     WHERE source_type='ci' AND source_id=? AND payment_subcategory='balance'
       AND payment_status NOT IN ('rejected','deduction_settled') AND id != ? LIMIT 1`,
    [payment.source_id, payment.id]);
  if (!other) run('UPDATE commercial_invoices SET balance_payment_status=? WHERE id=?', ['unpaid', payment.source_id]);
  ```
- **confirm-paid 分支（ci）**（`server.js:4507-4510`）：改为「仅当 `unpaid_balance<=0` 才置 `paid`，否则置 `partial`」，并据实写 `paid_balance/unpaid_balance` 而非强制 `unpaid_balance=0`：
  ```js
  const remaining = Math.max(0, (ci.payable_balance||0) - (ci.paid_balance||0) - paidAmount);
  const ciStatus = remaining <= 0 ? 'paid' : 'partial';
  run('UPDATE commercial_invoices SET balance_payment_status=?, paid_balance=?, unpaid_balance=? WHERE id=?',
      [ciStatus, ci.paid_balance + paidAmount, remaining, payment.source_id]);
  ```
  > 不新增业务规则，仅让 CI 标志与实际收付自洽。

### 3.5 前端防双击与 409 提示（轻量配套）
**文件/位置**：`app.js` `saveBalPay`（`app.js:5899`附近）
- 提交后立即 `disable` 提交按钮，请求返回（成功或 409）后再恢复/关闭。
- 捕获 409 响应，弹明确提示「该 CI 已存在有效尾款申请，请勿重复发起」。
- 此为体验增强，非根因（根因在服务端校验 + 唯一索引）。

### 3.6 不改动项（明确边界）
- 不新增 `cancel/void/delete` 路由（报告 §4-6 提及，但属更大范围改造，超出本单任务，不在此项）。
- 不改动 `payable_items`、不改变尾款审批流、不改变 `request_no` 生成规则。
- 不在本轮执行任何 DDL / 写库。

---

## 4. 验证与单项测试

> 以下用例为设计，需在授权实施后用只读/受控测试环境执行；本轮不运行任何写入型测试。

1. **并发防重（核心）**：对同一 `ci_id` 并发发起 10 个 `POST /api/payment-requests/from-ci-balance`，断言「恰好 1 条成功（200），其余返回 409」，且 `payment_requests` 中该 CI 的有效尾款行数 = 1。加 `uq_pr_active_balance` 后，验证第 2 条 INSERT 被唯一索引拒绝。
2. **拒绝后重提**：生成尾款 → `reject` → 再次生成；断言返回 409，且 CI `balance_payment_status` 已回退为 `unpaid`（无其他有效申请时）。
3. **部分付款后重提**：生成尾款 → `confirm-paid` 部分金额 → 再次生成；断言被拦截，且 `payable_amount` 取「剩余未付」而非 CI 全量 `payable_balance`。
4. **双击 UI 防重**：`saveBalPay` 弹窗快速连点两次提交，断言 `payment_requests` 仅新增 1 行（按钮禁用 + 服务端校验双保险）。
5. **唯一索引迁移测试**：直接构造两条相同 `(source_type, source_id, payment_subcategory)` 且 status 非 rejected 的 INSERT，断言第二条被 `uq_pr_active_balance` 拒绝。
6. **存量对账测试**：运行查询「同一 CI 存在 >1 条有效尾款申请」，本例须检出 CI-2026-885093（作为回归基线）；数据清理（§7）后该查询须返回 0 行。
7. **状态一致性测试**：任意尾款生命周期结束后，断言 `commercial_invoices` 的 `balance_payment_status / paid_balance / unpaid_balance` 三字段自洽，不再出现「paid_balance=21 但 status=pending_approval」。

---

## 5. 回归影响（需回归范围）

- **受影响功能**：
  - 尾款生成主流程：`POST /api/payment-requests/from-ci-balance`（POST 行为、响应码新增 409、事务原子性）。
  - 尾款审批：`POST /api/payment-requests/:id/approve` 的 `reject` / `confirm-paid` 分支（`server.js:4491-4512`）——CI 标志回退/部分付款语义变化。
  - 前端 `app.js` 尾款弹窗 `saveBalPay`（按钮禁用、409 提示）。
  - DB 启动迁移：新增唯一索引影响 `db.js` 初始化（须先清理 §7 数据，否则启动失败）。
- **需回归项**：
  - 正常尾款生成（无重复时仍 200、金额正确）。
  - 尾款审批全状态：`approve / reject / confirm-paid` 后 CI 标志与金额字段自洽。
  - 部分付款（partial）后 CI `balance_payment_status='partial'`、`unpaid_balance>0`。
  - 历史/存量 CI（已 paid）重新打开尾款流程不报错。
  - 应用启动迁移脚本在含存量重复数据时的处理顺序（先清后建索引）。

---

## 6. 完成即停原则

- 本项只交付「尾款防重 + 金额/状态一致性」修复，完成后**即停**，不自动扩展至 `cancel/void/delete` 路由、付款闭环 L1A 等更大改造。
- 进入下一项（如历史重复数据清理、付款申请撤销能力等）**须经用户明确批准**。
- 任何偏离 §3 范围的改动都需先回到本方案并获授权。

---

## 7. 数据清理（须批准，本轮不执行）

- **问题数据**：CI-2026-885093（`ci_1783996885092_xs7th0`）存在 2 条有效尾款申请：
  - `PAY-BAL-2026-713834`（paid / approved，金额 21，已付）— **应保留**，对应真实已付款。
  - `PAY-BAL-2026-263588`（pending_approval / pending，金额 21，未付）— **应作废/拒绝**，属重复生成。
- **处理方式（待批准后执行，非本轮）**：
  1. 将 `PAY-BAL-2026-263588` 通过 `reject` 或新增 `void` 置为失效（`payment_status='rejected'`，使其退出 `uq_pr_active_balance` 的 WHERE 过滤）。
  2. 将 CI-2026-885093 的 `balance_payment_status` 修正为与 `paid_balance=21 / unpaid_balance=0` 一致的 `paid`。
  3. 全库扫描「同一 CI 存在 >1 条有效尾款申请」的其它 CI，逐一人工确认后同样处理。
  4. 确认无其它有效重复后，再执行 `CREATE UNIQUE INDEX uq_pr_active_balance`（§3.3），否则会因现存 2 行冲突失败。
- **前置依赖**：§3.3 的 DDL 必须在 §7 清理完成之后执行；清理与建索引均须用户批准，本轮**不做**。

---

## 8. 明确本轮零修改

- **数据库**：仅以 `new Database('./data/inventory.db', { readonly: true })` 执行 `SELECT`/pragma 复核（验证重复与索引现状），未执行任何 `INSERT/UPDATE/DELETE/DDL`；临时脚本 `_tmp_confirm_dup.js` 已运行后删除，工作区无残留。
- **代码/页面/测试/日志/报告**：未使用 Edit/Write 修改 `server.js`、`db.js`、`app.js`、`index.html`、任何 `.db`、`.md`（除本文档）或 `.workbuddy` 目录。
- **唯一创建文件**：本文档 `P1-PAY-01-实施方案.md`。
- **未运行任何写入型测试**。
- **本方案所有改动均为设计描述，待后续授权实施；本轮仅产出文档。**
