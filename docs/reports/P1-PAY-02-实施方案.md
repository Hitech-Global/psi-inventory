# P1-PAY-02《定金 paid_deposit 同步》实施方案

- 任务编号：P1-PAY-02
- 关联只读排查报告：`P1-PAY-02-定金paid_deposit同步只读排查.md`
- 方案性质：**仅文档，本轮零代码/零数据修改**（严格遵守只读边界）
- 优先级：P1（业务一致性）
- 工作目录：`/Users/a1-6/Workbuddy/2026-07-04-17-45-01/inventory-app`

---

## 1. 目标与范围

**目标**：消除"定金状态=已付，但 `paid_deposit`=0"的事实矛盾，使 `proforma_invoices.paid_deposit` 成为 PI 层"已付定金"的**唯一事实源（SSOT）**，并补全部分付款状态与作废 reverse 能力。

**范围（最小修改、单任务）**：
- 仅收敛定金回写 PI 的入口、补全 `deposit_payment_status` 的 `partial` 取值、修复 CI 汇总语义错配、补 void reverse 联动。
- **不新增业务规则**（不引入新付款类型、不改动核销/CI 余额逻辑、不引入新闭环表）。
- 本项完成后即停；进入下一项须经用户批准。
- 数据库中现存不一致数据的回填（§7）**不在本轮执行**，须单独批准。

---

## 2. 当前事实（引只读报告关键证据）

**字段定义（db.js:657）**：`paid_deposit REAL DEFAULT 0`，**仅存在于 `proforma_invoices`（PI）表**，不在 CI、不在 payment_requests。业务语义 = 该 PI 已收到的定金金额。

**代码事实（grep 全仓库 `paid_deposit`）**：
- 真正写入点**仅 1 处**：`server.js:4534`（`bulk-import-result` 批量导入付款结果才写 `paid_deposit`）。
- `server.js:4506`（UI 主路径 `confirm-paid`、source_type==='pi' 分支）：**只写 `deposit_payment_status='paid'` 与 `pi_status='deposit_paid'`，完全不写 `paid_deposit`**。
- `server.js:4562`（CI 费用汇总）：把 `ci.actual_deducted_deposit` 赋值给 `paid_deposit` 字段——PI 字段被 CI 的"已抵扣"量填充，**语义错配**。
- `server.js:3319-3320`（PI 状态标签）：同时依赖 `deposit_payment_status` 与 `paid_deposit`。

**双写不一致根因**：两条"标记定金已付"路径行为不同——路径 A（UI `confirm-paid`）永不写 `paid_deposit`；路径 B（批量导入）才写。

**数据库铁证（只读查询，全库 `paid_deposit>0` 记录数 = 0）**：
- 不一致A：`deposit_payment_status='paid'` 但 `paid_deposit=0` 的 PI **共 2 条（100% 命中）**：
  - `PI-2026-551654`：payable_deposit=23.52，paid_deposit=0，status=paid，pi_status=cancelled
  - `PI-2026-613351`：payable_deposit=9，paid_deposit=0，status=paid，pi_status=deposit_paid
- 不一致D：上述 2 笔对应的定金付款申请 `payment_status='paid'`、paid_amount 分别为 23.52 / 9，但关联 PI 的 `paid_deposit` 仍为 0 —— 金额完全脱节。
- 不一致B：`pi_status='deposit_paid'` 但 `paid_deposit=0` 共 1 条（PI-2026-613351）。
- 不一致C（反向矛盾）：0 条 —— 因 `paid_deposit` 从未被正常写入。
- 无 reverse：付款申请无冲销机制；PI 作废（`server.js:3528-3542`）不回滚 `deposit_payment_status`、不写 `paid_deposit`、不反向更新 payment_requests。实证：PI-2026-551654（cancelled）的 deposit 仍为 paid 僵尸态。
- 无 partial：`deposit_payment_status` 取值仅 unpaid / pending_approval / paid，部分付款在 PI 层被"全额化"。

> 结论：当前库里所有被标记"定金已付"的 PI 其 `paid_deposit` 均为 0，正是"路径 A 不写 paid_deposit"在真实数据上的铁证（这 2 笔均经 UI `confirm-paid` 完成）。

---

## 3. 实施方案（精确修改点 · 最小修改）

> 原则：以 `PI.paid_deposit` 为定金唯一事实源；任何令 `deposit_payment_status` 变为 paid/partial 的代码点，**必须同事务内写 `paid_deposit`**；reverse 必须同事务回滚二者。

### 3.1 新增统一回写函数（收敛双写入口）

在付款处理相关函数附近（如 `server.js:4493` 之前）新增一个小工具函数，供 `confirm-paid` 与 `bulk-import-result` 共用，**杜绝双路径各自为政**：

```js
// 定金回写 PI 的唯一入口：paid_deposit 为 SSOT，deposit_payment_status 与之一致
function syncPiDepositPaid(piId, paidAmount, isPartial) {
  if (isPartial) {
    // 部分付款：状态写 partial，pi_status 不强行改写（沿用现有合法枚举，避免引入未定义值）
    run('UPDATE proforma_invoices SET paid_deposit = ?, deposit_payment_status = ? WHERE id = ?',
        [paidAmount, 'partial', piId]);
  } else {
    // 全额付款：保持原有行为 deposit_payment_status='paid'、pi_status='deposit_paid'
    run('UPDATE proforma_invoices SET paid_deposit = ?, deposit_payment_status = ?, pi_status = ? WHERE id = ?',
        [paidAmount, 'paid', 'deposit_paid', piId]);
  }
}
```

"全额"判定基准：`isPartial = paidAmount < (payment.actual_pay_amount || payment.payable_amount)`（与现有 `unpaid_amount` 计算口径一致）。

### 3.2 修复 confirm-paid 缺失写入（server.js:4505-4506）

原代码：
```js
if (payment.source_type === 'pi') {
  run('UPDATE proforma_invoices SET deposit_payment_status = ?, pi_status = ? WHERE id = ?', ['paid', 'deposit_paid', payment.source_id]);
}
```
改为调用统一入口（在该分支内、pi 处理处）：
```js
if (payment.source_type === 'pi') {
  const paidAmount = req.body.paid_amount || payment.actual_pay_amount || payment.payable_amount;
  const isPartial = paidAmount < (payment.actual_pay_amount || payment.payable_amount);
  syncPiDepositPaid(payment.source_id, paidAmount, isPartial);
}
```
> `paidAmount` 在 confirm-paid 分支开头（server.js:4494）已计算，可直接复用，无需重复声明。

### 3.3 修复 bulk-import-result 状态写死（server.js:4533-4534）

原代码：
```js
if (payment.source_type === 'pi') {
  run('UPDATE proforma_invoices SET deposit_payment_status = ?, paid_deposit = ? WHERE id = ?', ['paid', paidAmount, payment.source_id]);
}
```
改为：
```js
if (payment.source_type === 'pi') {
  const isPartial = paidAmount < (payment.actual_pay_amount || payment.payable_amount);
  syncPiDepositPaid(payment.source_id, paidAmount, isPartial);
}
```
> 该路径已在 `transaction(() => {...})`（server.js:4523）内，`syncPiDepositPaid` 的 `run` 同处事务，满足"同事务内双写"原则。

### 3.4 修复 CI 汇总语义错配（server.js:4562）

原代码（错误：用 CI 的已抵扣量冒充 PI 的已付定金）：
```js
paid_deposit: ci.actual_deducted_deposit || 0,
```
改为取关联 PI 的真实已付定金（落实 SSOT）：
```js
const relatedPi = ci.related_pi_id
  ? queryOne('SELECT paid_deposit FROM proforma_invoices WHERE id = ?', [ci.related_pi_id])
  : null;
// ...
paid_deposit: relatedPi ? (relatedPi.paid_deposit || 0) : 0,
```
- 备选（若担心跨表查询开销/前端约定）：将该字段改名 `actual_deducted_deposit` 以匹配其真实含义，并同步前端调用。因前端两处调用（app.js:5906、6437）**当前均未展示此字段**，改名与改值影响均低；推荐采用"取关联 PI 真实 paid_deposit"以与 SSOT 对齐。

### 3.5 状态枚举补全（无需 DDL）

`deposit_payment_status` 在 `db.js:662` 为 `TEXT DEFAULT 'unpaid'`、**无 CHECK 约束**，新增 `'partial'` 取值**不需任何 DDL/迁移**。应用层按 3.1 写入即可。

### 3.6 作废(PI void) reverse 联动（server.js:3528-3542）

在 void handler 置 `pi_status='cancelled'` 之后，追加定金 reverse（同函数内、自然同事务）：
```js
// reverse 定金：若已付/部分付，则回滚 PI 与关联定金付款申请
if (pi.deposit_payment_status !== 'unpaid') {
  const depPRs = query("SELECT * FROM payment_requests WHERE source_type='pi' AND source_id=? AND payment_subcategory='deposit' AND payment_status='paid'", [pi.id]).rows;
  depPRs.forEach(pr => {
    run('UPDATE payment_requests SET payment_status=?, paid_amount=0, unpaid_amount=payable_amount, updated_at=datetime(\'now\') WHERE id=?',
        ['reversed', pr.id]);
  });
  run('UPDATE proforma_invoices SET deposit_payment_status=?, paid_deposit=0 WHERE id=?', ['unpaid', pi.id]);
  // 建议：logOperation(...) 记录 reverse 动作（参照同文件 logOperation 用法）
}
```
> 说明：新增 `'reversed'` 作为 payment_requests.payment_status 的回退态——属"reverse 联动"必要项，非新业务规则。若项目约定沿用 `'cancelled'` 词汇，可改为 `'cancelled'`，**以实施时与现有枚举确认为准**（见 §5 回归校验）。

### 3.7 前端可见性（可选、低风险）

`app.js:5523` 定金按钮 `createDepPay` 仅在 `deposit_payment_status==='unpaid'` 时显示；补 `partial` 后该按钮在部分付款时自动隐藏（正确行为，无需改动）。PI 列表/详情当前不展示 `paid_deposit`，如需让事实可见，可在 `loadPI`/`viewPI` 增加"已付定金"列（**建议留作独立小项，不并入本 P1 范围**，避免扩大改动面）。

---

## 4. 验证与单项测试

> 以下用例用于本项落地后的验证，**本轮不运行**（仅文档）。

1. **写入一致性（修复核心 Bug）**
   - 对 `need_deposit=1, payable_deposit=100` 的 PI：`from-pi-deposit` → approve → `confirm-paid(paid_amount=100)`。
   - 断言：`proforma_invoices.paid_deposit=100` 且 `deposit_payment_status='paid'`、`pi_status='deposit_paid'`。
   - **回归当前缺陷**：断言 confirm-paid 后 `paid_deposit` 不为 0（即复现并验证报告铁证已消除）。
2. **部分付款**
   - confirm-paid(paid_amount=60, payable=100)：断言 `paid_deposit=60`、`deposit_payment_status='partial'`、PR 与 PI 状态口径一致。
   - bulk-import 导入 paid_amount=60：断言 `paid_deposit=60` 且状态=`partial`（而非 `paid`）。
3. **一致性对账（只读校验器）**
   - `SELECT COUNT(*) FROM proforma_invoices WHERE deposit_payment_status IN ('paid','partial') AND paid_deposit=0` 必须为 0。
   - `paid_deposit` 不得超过 `payable_deposit`。
   - 跨表：`proforma_invoices.paid_deposit` 应等于 `payment_requests(source_type='pi').SUM(paid_amount)`（扣除已 reversed）。
4. **reverse / 作废**
   - PI void（已付定金态）后，断言 `deposit_payment_status` 回退为 `unpaid`、`paid_deposit` 归零、关联定金 PR 状态为 `reversed`/已回滚。
   - 并发场景：同一 PI 的 confirm-paid 与 bulk-import 串行执行，最终 `paid_deposit` 与最后一次写入一致，无丢失更新（二者均经统一入口，事务内完成）。
5. **显示一致性**
   - CI 费用汇总接口 `cost-summary.paid_deposit` == 关联 PI 真实 `paid_deposit`（不再等于 `actual_deducted_deposit`）。

---

## 5. 回归影响（需回归范围）

| 受影响点 | 位置 | 影响与回归动作 |
|---|---|---|
| PI 状态标签 | server.js:3319-3320 | `deposit_payment_status='partial'` 时首判不命中，但 `paid_deposit>0` 仍返回"已付定金"，标签正常；可选补充 `partial` → "定金部分支付"。 |
| 定金付款按钮可见性 | app.js:5523 | `deposit_payment_status==='unpaid'` 才显示；补 `partial` 后部分付款自动隐藏（正确）。 |
| CI 生成定金前置 | P1-STATE-01 提及 `deposit_payment_status==='paid'` 守卫 | 部分付款态 `partial` 可能不满足"已付"前置，需确认 CI 生成是否应允许 `partial` 放行（建议：允许，因定金已部分到账）。 |
| CI 费用汇总 | server.js:4562 / app.js:5906、6437 | 字段语义修正；前端两处调用未展示该字段，影响低；确认无外部/导出消费此字段。 |
| PI void | server.js:3528-3542 | 新增 reverse 逻辑，需验证作废流程不被破坏、operation_logs 正常。 |
| payment_requests.payment_status 枚举 | 全库 | 新增 `'reversed'`（或 `'cancelled'`）回退态，需确认前端/报表对该状态的处理与展示。 |

---

## 6. 完成即停原则

- 本实施方案为**单任务 P1**：落地 §3.1–§3.6 后，验证 §4 通过即视为本项完成。
- **本项完成即停**，不自动顺延至 PI 编辑、CI 前置、闭环表重构等其它任务。
- 进入下一项（含 §7 数据回填）须经用户明确批准。

---

## 7. 数据清理（须批准 · 不在本轮执行）

现存不一致数据（来自只读报告 §2）：
- 2 条 `deposit_payment_status='paid'` 但 `paid_deposit=0` 的 PI（PI-2026-551654、PI-2026-613351），对应定金 PR paid_amount 分别为 23.52 / 9。
- 1 条 `pi_status='deposit_paid'` 但 `paid_deposit=0`（PI-2026-613351）。
- PI-2026-551654 已作废（cancelled）但 deposit 仍为 paid 僵尸态。

**建议一次性受控回补脚本（须用户批准后单独执行，非本轮）**：
```sql
-- 对 deposit_payment_status IN ('paid','partial') AND paid_deposit=0 的 PI，
-- 按关联定金付款申请 SUM(paid_amount)（扣除已 reversed）回填 paid_deposit
UPDATE proforma_invoices
SET paid_deposit = (
  SELECT COALESCE(SUM(pr.paid_amount),0)
  FROM payment_requests pr
  WHERE pr.source_type='pi' AND pr.source_id=proforma_invoices.id
    AND pr.payment_subcategory='deposit' AND pr.payment_status='paid'
)
WHERE deposit_payment_status IN ('paid','partial') AND paid_deposit=0;
```
- 该脚本为**写入型**，必须用户批准、在备份后、于只读校验通过的受控环境下运行；本轮**不执行**。

---

## 8. 明确本轮零修改

- 本文档**仅实施方案设计**，本轮**不修改**任何代码、数据库、接口、页面、测试数据、日志、报告或 MEMORY.md；**不执行任何 DDL**、不运行写入型测试。
- 唯一创建文件即本文档 `P1-PAY-02-实施方案.md`；未触碰 `server.js` / `db.js` / `app.js` / `.db` / 其它 `.md`。
- §3 的全部改动、§4 的全部测试、§7 的数据回填均**不在本轮落地**，待批准后实施。
