# P1-PAY-02《定金 paid_deposit 同步只读排查》报告

- 任务编号：P1-PAY-02
- 任务名称：定金 paid_deposit 同步只读排查
- 排查性质：严格只读（全程未执行任何 DDL / 写入型测试 / 文件修改，仅创建本报告）
- 排查日期：2026-07-14
- 工作目录：/Users/a1-6/Workbuddy/2026-07-04-17-45-01/inventory-app
- 技术栈：Node.js + Express + better-sqlite3（WAL）
- 数据库：./data/inventory.db（只读模式 `new Database(path, { readonly: true })` 打开）

---

## 1. 当前代码事实（paid_deposit 定义位置、更新逻辑、行号）

### 1.1 字段定义位置（Schema）
`paid_deposit` **仅定义在 `proforma_invoices`（PI）表**，不在 `commercial_invoices`（CI），也不在 `payment_requests`。
- 定义：`db.js:657` —— `paid_deposit REAL DEFAULT 0,`
- 同表相关定金字段（db.js:653-662）：
  - `need_deposit`（是否需要定金）
  - `deposit_ratio`（定金比例 %）
  - `payable_deposit`（应付定金金额）
  - `paid_deposit`（**已付定金金额**）
  - `deducted_deposit`（已抵扣定金）
  - `available_deduct_deposit`（可抵扣定金余额）
  - `deposit_payment_status`（定金支付状态：unpaid / pending_approval / paid）
  - `goods_payment_status`（货款支付状态）

> 结论：`paid_deposit` 的业务语义 = **该 PI 已收到的定金金额**（已付定金金额）。

### 1.2 全代码库写入点枚举（grep `paid_deposit` 全仓库）
对 `*.js` / `*.html` 全量检索，结果只有 4 处引用，其中**真正的写入只有 1 处**：

| 文件:行号 | 类型 | 说明 |
|---|---|---|
| db.js:657 | 定义 | 字段声明 |
| server.js:3320 | 读取 | `if (n(pi.paid_deposit, 0) > 0) return '已付定金';` 仅用于状态标签判断 |
| server.js:4534 | **写入** | `bulk-import-result` 批量导入付款结果时 `SET deposit_payment_status='paid', paid_deposit = ?` |
| server.js:4562 | 读取 | CI 费用汇总里把 `paid_deposit` 直接映射成 `ci.actual_deducted_deposit`（注意：此处语义错配，见 §4） |

**关键事实：`paid_deposit` 全库只有一处写入（server.js:4534），且位于"批量导入付款结果"接口内。**

### 1.3 两条"标记定金已付"的路径对比（双写不一致根因）

**路径 A — 单笔审批确认付款（UI 主操作）`POST /api/payment-requests/:id/approve` action=`confirm-paid`**
- server.js:4493-4513
- 当 `payment.source_type === 'pi'`（server.js:4505-4506）：
  ```js
  run('UPDATE proforma_invoices SET deposit_payment_status = ?, pi_status = ? WHERE id = ?',
      ['paid', 'deposit_paid', payment.source_id]);
  ```
- **该路径只更新 `deposit_payment_status` 与 `pi_status`，完全不更新 `paid_deposit`。**
- 同时会把 `payment_requests.paid_amount` 写成 `paidAmount`（server.js:4502）。
- 对部分付款：payStatus 可能为 `partial_payment_partial_deduction` / `partial_deduction`，但 PI 的 `deposit_payment_status` 仍被**无差别置为 `'paid'`**（server.js:4506 写死）。

**路径 B — 批量导入付款结果 `POST /api/payment-requests/bulk-import-result`**
- server.js:4519-4546
- 当 `payment.source_type === 'pi'`（server.js:4533-4534）：
  ```js
  run('UPDATE proforma_invoices SET deposit_payment_status = ?, paid_deposit = ? WHERE id = ?',
      ['paid', paidAmount, payment.source_id]);
  ```
- 该路径**会更新 `paid_deposit = paidAmount`**（取自导入行的 paid_amount 或 payable_amount）。
- 同样把 `deposit_payment_status` 无差别写死为 `'paid'`（不考虑部分付款）。

> 结论：两条路径对 `paid_deposit` 的更新行为**不一致**——路径 A 永远不写 `paid_deposit`，路径 B 才写。这是双写不一致的核心。

---

## 2. 当前数据库事实（表结构、paid_deposit 列、样本、与付款表一致性抽查）

> 以下数据均通过只读脚本（better-sqlite3 `{ readonly: true }`）查询，未做任何写入。

### 2.1 表结构关键列
- `proforma_invoices` 定金相关列：deposit_ratio, payable_deposit, **paid_deposit**, deducted_deposit, available_deduct_deposit, deposit_payment_status, goods_payment_status, pi_status, need_deposit
- `payment_requests` 关键列：payment_subcategory, source_type, source_id, source_no, payable_amount, paid_amount, unpaid_amount, payment_status, approval_status, deduction_* , actual_pay_amount
- `commercial_invoices` 定金/尾款列：should_deduct_deposit, actual_deducted_deposit, payable_balance, paid_balance, unpaid_balance, balance_payment_status（CI 无 paid_deposit 列）

### 2.2 总体计数
- `proforma_invoices` 且 `need_deposit=1`：**33 条**
- PI `deposit_payment_status` 分布：paid=2，pending_approval=12，unpaid=30
- PI `pi_status` 分布（含 deposit）：deposit_paid=1（其余为 confirmed/uploaded/pending/shipped_complete/cancelled 等）
- **PI 中 `paid_deposit > 0` 的记录数：0 条**（全库没有任何一条 PI 的 paid_deposit 被写过正值）
- `payment_requests` 总数 48；source_type 分布：ci=32，manual=2，**pi=14（定金付款申请）**
- 定金付款申请 payment_status 分布：approved=8，pending_approval=4，**paid=2**
- 新付款闭环表（payable_items / payment_transactions / payment_allocations）：**均为 0 行**（新架构未接入定金流程，见 §3 / §5）

### 2.3 一致性抽查（硬证据）

**不一致A：PI `deposit_payment_status='paid'` 但 `paid_deposit=0` —— 数量 = 2（100% 命中）**
| pi_no | payable_deposit | paid_deposit | deposit_payment_status | pi_status |
|---|---|---|---|---|
| PI-2026-551654 | 23.52 | **0** | paid | cancelled |
| PI-2026-613351 | 9 | **0** | paid | deposit_paid |

**不一致D：定金付款申请 `payment_status='paid'`（paid_amount>0）但关联 PI `paid_deposit=0` —— 数量 = 2（与 A 完全对应）**
| request_no | pi_no | payable_amount | paid_amount | payment_status | PI.paid_deposit | PI.deposit_payment_status |
|---|---|---|---|---|---|---|
| PAY-DEP-2026-976034 | PI-2026-551654 | 23.52 | 23.52 | paid | **0** | paid |
| PAY-DEP-2026-724347 | PI-2026-613351 | 9 | 9 | paid | **0** | paid |

**不一致B：`pi_status='deposit_paid'` 但 `paid_deposit=0` —— 数量 = 1**（即 PI-2026-613351）。

**不一致C：`paid_deposit>0` 但 `deposit_payment_status<>'paid'` —— 数量 = 0**（因为 paid_deposit 从未被正常写入，无反向矛盾）。

> 直接结论：当前库里**所有**被标记为"定金已付"的 PI（共 2 条），其 `paid_deposit` 都是 0，且与对应已付付款申请（paid_amount 分别为 23.52、9）**金额完全脱节**。这正是"路径 A 不写 paid_deposit"在真实数据上的铁证——这 2 笔均经 UI 审批 `confirm-paid` 完成付款，故 paid_deposit 始终为 0。

---

## 3. 完整调用链（定金申请 → 付款完成 → 核销/reverse → paid_deposit 同步路径）

### 3.1 正常链路
1. **生成定金付款申请** `POST /api/payment-requests/from-pi-deposit`（server.js:4303-4328）
   - 校验 `need_deposit=1` 且 `payable_deposit>0`（server.js:4308）
   - 插入 `payment_requests`（source_type='pi'，payment_subcategory='deposit'，payable_amount=payable_deposit，paid_amount=0）
   - 触发 PI：`UPDATE proforma_invoices SET deposit_payment_status='pending_approval'`（server.js:4325）
   - **此时 paid_deposit 不变（仍为 0）**
2. **审批** `POST /api/payment-requests/:id/approve` action=`approve`（server.js:4485-4490）→ payment_status='approved'
3. **确认付款** `POST /api/payment-requests/:id/approve` action=`confirm-paid`（server.js:4493-4513）
   - 写 `payment_requests`：payment_status / paid_amount / unpaid_amount（server.js:4502）
   - 写 PI：`deposit_payment_status='paid'`、`pi_status='deposit_paid'`（server.js:4506）
   - **⚠️ 不写 `paid_deposit` —— 同步缺口**
4. **（替代路径）批量导入付款结果** `POST /api/payment-requests/bulk-import-result`（server.js:4519-4546）
   - 写 `payment_requests`：payment_status='paid'、paid_amount、unpaid_amount（server.js:4530）
   - 写 PI：`deposit_payment_status='paid'`、**`paid_deposit=paidAmount`**（server.js:4534）
   - ⚠️ 部分付款时仍把 deposit_payment_status 写死为 'paid'（server.js:4534 写死），且 paid_deposit=部分金额 → 状态与金额口径不一致

### 3.2 核销（抵扣）链路（与 paid_deposit 无关，但影响 available_deduct_deposit）
- CI 创建/编辑时计算应抵扣定金：`should_deduct_deposit = min(payable_deposit, available_deduct_deposit, goods_amount)`（server.js:3610、3800）
- 写 CI：`should_deduct_deposit` / `actual_deducted_deposit` / `payable_balance` / `unpaid_balance`（server.js:3612、3801）
- 回写 PI：`deducted_deposit += shouldDeduct`、`available_deduct_deposit = payable_deposit - deducted_deposit`（server.js:3616-3620）
- **注意：核销链路操作的是 `deducted_deposit` / `available_deduct_deposit`，完全不触碰 `paid_deposit`。** 因此即使 paid_deposit 长期为 0，只要 payable_deposit 正确，抵扣仍可正常进行——这是当前"未爆雷"的原因，但并非正确设计。

### 3.3 reverse（冲销）链路
- **系统中不存在付款申请的冲销/反写机制。** 全库 grep `reverse|冲销|撤销` 命中均为汇率反向查询、PO/PI/CI 作废(void)、出库批量作废、WAC 提示"冲销版本尚未实现"（server.js:4807）。
- 付款申请被关联的 PI 作废时（`POST /api/proforma-invoices/:id/void`，server.js:3528-3542）：仅把 `pi_status='cancelled'`、追加 remark，**不回滚 `deposit_payment_status`、不写 `paid_deposit`、不反向更新 `payment_requests`**。
- 实证：PI-2026-551654 的 `pi_status='cancelled'` 但 `deposit_payment_status` 仍为 `'paid'`，对应付款申请 PAY-DEP-2026-976034 仍为 `payment_status='paid'` —— 作废后定金状态成为"僵尸已付"，无任何 reverse 兜底。
- 新付款闭环表（payable_items / payment_transactions / payment_allocations）设计上支持 cancel（is_active=0、trans_status='cancelled'、allocation status='cancelled'），但**定金流程根本未写入这些表（0 行）**，故该 refund/reverse 能力对定金不可用。

---

## 4. 缺陷或风险（双写不一致、显示与事实不符）

1. **【严重】双写不一致（paid_deposit 仅在批量导入路径被写）**
   - UI 主路径 `confirm-paid`（server.js:4506）不写 `paid_deposit`；批量导入路径（server.js:4534）才写。导致同一"定金已付"事件在两条路径下 PI 的 `paid_deposit` 结果不同。当前库 2 条"已付"PI 的 paid_deposit 全为 0 即实证。

2. **【严重】事实与状态矛盾**
   - `deposit_payment_status='paid'` 表示"定金已付"，但 `paid_deposit=0` 表示"实际收到 0 元"。状态与金额互相打架。任何读取 `paid_deposit` 做"已付定金汇总/对账/财务报表"的逻辑都会得到 0，与真实付款（23.52、9）严重不符。

3. **【中】部分付款无 PI 级表达**
   - PI 的 `deposit_payment_status` 取值只有 unpaid / pending_approval / paid，**没有 partial**。无论全额还是部分付款，confirm-paid 与 bulk-import 都把状态写死为 `'paid'`（server.js:4506、4534）。部分付款在 PI 层被错误地"全额化"；而 payment_requests 层虽有 partial_* 状态，两者口径不统一。

4. **【中】作废(PI void)不 reverse 付款**
   - PI 作废后 `deposit_payment_status` 保持 paid、付款申请保持 paid，无冲销。出现"已取消 PI + 定金已付"的僵尸状态（PI-2026-551654）。

5. **【中】显示层口径错位（server.js:4562）**
   - CI 费用汇总接口把 `paid_deposit` 直接赋值为 `ci.actual_deducted_deposit`（server.js:4562：`paid_deposit: ci.actual_deducted_deposit || 0`）。这里 `paid_deposit` 是 PI 字段，却被 CI 汇总接口用 CI 的已抵扣定金填充，字段语义错配、命名误导，且同样依赖一个 PI 侧未被正确维护的派生量。

6. **【低】前端不直接展示 paid_deposit 金额，掩盖问题但不消除**
   - app.js PI 列表仅展示 `payable_deposit`（应付定金，server.js 列表 / app.js:5790）与 `deposit_payment_status` 徽标（app.js:5523），不展示 `paid_deposit`。因此 UI 上看不到"已付定金金额=0"的破绽，但数据层错误真实存在，会在对账/导出/成本归集时被放大。

---

## 5. 受影响文件、函数、接口、表和字段

### 文件 / 函数 / 接口
- `server.js`
  - `POST /api/payment-requests/:id/approve`（confirm-paid 分支，server.js:4493-4513）—— **应补写 paid_deposit 而未写**
  - `POST /api/payment-requests/bulk-import-result`（server.js:4519-4546）—— 写 paid_deposit，但状态写死 'paid'
  - `POST /api/payment-requests/from-pi-deposit`（server.js:4303-4328）—— 生成时不预设 paid_deposit（可接受，但需明确契约）
  - PI 状态标签函数（server.js:3319-3320）—— 同时依赖 deposit_payment_status 与 paid_deposit
  - CI 费用汇总 `GET /api/commercial-invoices/:id/cost-summary`（server.js:4551-4579，尤其 4562）—— 字段语义错配
  - `POST /api/proforma-invoices/:id/void`（server.js:3528-3542）—— 作废不 reverse 付款
- `db.js`
  - `proforma_invoices` 表定义（db.js:638-671，paid_deposit 在 657）—— 可考虑增加部分付款状态列/约束
- `app.js`
  - `loadPI`（app.js:5519-5524）、`createDepPay`（app.js:5785-5804）、PI 详情 `viewPI`（app.js:5526-5533）—— 建议增加"已付定金"列/展示

### 表 / 字段（受影响）
- `proforma_invoices`：`paid_deposit`（核心）、`deposit_payment_status`、`pi_status`、`payable_deposit`、`deducted_deposit`、`available_deduct_deposit`
- `payment_requests`：`source_type`、`source_id`、`paid_amount`、`payment_status`、`actual_pay_amount`（来源事实）
- `commercial_invoices`：`actual_deducted_deposit`、`should_deduct_deposit`（核销派生，依赖 payable_deposit 而非 paid_deposit，口径需澄清）
- `payable_items` / `payment_transactions` / `payment_allocations`：新闭环表，当前 0 行、未接入定金（规划层面影响）

---

## 6. 最小方案（仅设计，不实施）

**目标**：让 `paid_deposit` 在 UI 主路径（confirm-paid）也被正确写入，消除"状态=paid 但金额=0"的矛盾。

- 在 `POST /api/payment-requests/:id/approve` 的 confirm-paid 分支、且 `source_type==='pi'` 时，**仿照 bulk-import-result**，额外执行：
  ```js
  UPDATE proforma_invoices SET paid_deposit = ? WHERE id = ?
  ```
  写入值取 `paidAmount`（与 payment_requests.paid_amount 一致）。
- 不改任何表结构、不加新字段、不动核销与 CI 逻辑。
- 同时补一个"历史修复"一次性脚本（只读校验 + 受控写，不属本轮）：对 `deposit_payment_status='paid' 且 paid_deposit=0` 的 PI，用关联 payment_requests 的 SUM(paid_amount) 回填 paid_deposit。
- 风险：部分付款仍会写死 deposit_payment_status='paid'（仅修金额，不修状态枚举，属下一档方案）。

---

## 7. 完整方案（仅设计，不实施）

在最小方案基础上，补齐口径与 reverse 能力：

1. **统一写入入口**：将"定金已付 → 回写 PI"收敛为单一函数 `syncPiDepositPaid(piId, paidAmount, isPartial)`，confirm-paid 与 bulk-import 均调用，杜绝双写分支差异。
2. **引入 PI 级部分付款状态**：`deposit_payment_status` 增加 `'partial'` 取值；confirm-paid / bulk-import 根据 `paidAmount < payable_deposit - deduction` 判定写 `'partial'` 或 `'paid'`，与 payment_requests 的 partial_* 状态对齐。
3. **reverse / 冲销**：新增 `POST /api/payment-requests/:id/reverse`（或作废 PI 时联动）：将 payment_requests 置为 reversed、`proforma_invoices.deposit_payment_status` 回退（paid→unpaid/partial）、`paid_deposit` 减回 0 或按净额回滚，并写 operation_logs。
4. **语义澄清 `paid_deposit` vs `deducted_deposit` vs `actual_deducted_deposit`**：明确"已付定金"以 `paid_deposit` 为准；`deducted_deposit` 仅表示"已抵扣（用于冲尾款）"；CI 汇总接口 server.js:4562 的 `paid_deposit` 字段改名/修正为 CI 自身的已抵扣量，消除命名误导。
5. **唯一事实源收敛**（见 §8）。

---

## 8. 推荐方案（仅设计，不实施）

**推荐采用"paid_deposit 作为 PI 层定金唯一事实源（Single Source of Truth）+ 写入入口单点收敛 + 状态枚举补全 + reverse 联动"的组合，并优先落地最小方案止血。**

- **唯一事实源**：定金"已付金额"的唯一事实源应为 `proforma_invoices.paid_deposit`（PI 层，贴近业务单据）；`payment_requests.paid_amount` 为付款单层的执行记录，二者通过单一同步函数保持一致，禁止双路径各自为政。当前"数据库事实"显示二者已脱节，必须先以最小方案回填对齐。
- **避免双写不一致的原则**：任何会令 `deposit_payment_status` 变为 paid/partial 的代码点，必须同事务内写 `paid_deposit`；反之 reverse 必须同事务回滚二者。
- **短期**：立即实施最小方案（§6），消除当前 2 条已付 PI 的 paid_deposit=0 事实错误；并修订 server.js:4562 的字段语义。
- **中期**：实施完整方案（§7）的 1/2/3，补全部分付款状态与 reverse。
- **长期（可选）**：若启用新付款闭环表（payable_items 等），应把定金也纳入该表并以其为跨模块事实源，替换 legacy payment_requests 的定金双写；但当前 0 行、未接线，属重大重构，不在本轮范围。

---

## 9. 实施修改范围（列出需改文件/表/字段，但本轮不做）

- **server.js**
  - `:4506` 附近（confirm-paid，source_type==='pi' 分支）：新增 `paid_deposit` 更新，调用统一同步函数
  - `:4533-4534`（bulk-import-result）：补充部分付款状态判定（deposit_payment_status 不再写死 'paid'）
  - `:4562`（CI 费用汇总）：修正 `paid_deposit` 字段语义/改名
  - 新增可选 `:id/reverse` 接口或在 `:3528` PI void 中联动回滚定金状态
- **db.js**
  - `proforma_invoices`：`deposit_payment_status` 取值约束补充 `'partial'`（可选，应用层校验亦可）
- **app.js**
  - `loadPI`（列表）与 `viewPI`（详情）：新增"已付定金(paid_deposit)"展示列/字段，使事实可见
- **数据回填（一次性受控脚本，非本轮）**
  - 对 `deposit_payment_status IN ('paid','partial') AND paid_deposit=0` 的 PI，按关联 payment_requests 的 `SUM(paid_amount)` 回填 `paid_deposit`
- **本轮不做任何上述修改**（本报告严格遵守只读边界）。

---

## 10. 针对性测试建议（仅建议，本轮不运行）

1. **单元测试 — 写入一致性**
   - 用例：对一条 `need_deposit=1, payable_deposit=100` 的 PI，经 `from-pi-deposit` 生成申请 → approve → confirm-paid(paid_amount=100)，断言 `proforma_invoices.paid_deposit=100` 且 `deposit_payment_status='paid'`。
   - 用例（回归当前 Bug）：断言 confirm-paid 后 `paid_deposit` 不为 0（即复现并验证本报告的缺陷已修复）。
2. **单元测试 — 部分付款**
   - confirm-paid(paid_amount=60, payable=100)，断言 `paid_deposit=60`，`deposit_payment_status='partial'`，`payment_requests.payment_status` 与 PI 状态一致。
3. **集成测试 — 批量导入路径**
   - bulk-import-result 部分付款：导入 paid_amount=60，断言 paid_deposit=60 且状态=partial（而非 paid）。
4. **一致性对账测试（数据校验器）**
   - 只读断言：`SELECT COUNT(*) FROM proforma_invoices WHERE deposit_payment_status IN ('paid','partial') AND paid_deposit=0` 必须为 0；以及 `paid_deposit` 不得超过 `payable_deposit`。
   - 跨表对账：`proforma_invoices.paid_deposit` 应等于其关联 `payment_requests(source_type='pi').SUM(paid_amount)`（扣除已 reverse）。
5. **reverse/作废测试**
   - PI void 或付款 reverse 后，断言 `deposit_payment_status` 回退、paid_deposit 归零/按净额回滚、payment_requests 状态一致。
6. **显示一致性测试**
   - 前端列表/详情"已付定金"列显示值 == 后端 `paid_deposit`；CI 费用汇总接口不再用 `actual_deducted_deposit` 冒充 `paid_deposit`。

---

## 11. 明确本轮零修改

- 本报告为**严格只读排查**：未执行任何 DDL、未运行任何写入型测试、未修改任何代码/数据库/接口/页面/测试数据/日志/报告/MEMORY.md。
- 数据库查询一律通过临时脚本以 `new Database('./data/inventory.db', { readonly: true })` 打开，查询后已删除该临时脚本（`__ro_probe.js`）。
- 除本报告文件 `P1-PAY-02-定金paid_deposit同步只读排查.md` 外，未创建/编辑任何文件；未触碰任何 `.md`、`db.js`、`server.js`、`app.js`、`.db`、`.workbuddy` 目录。
- 上述所有"最小/完整/推荐方案"与"实施修改范围"均为**设计建议**，不在本轮落地。

---

### 附：关键证据速查
- 写入点唯一：`server.js:4534`（bulk-import-result 才写 paid_deposit）
- 缺失写入：`server.js:4506`（confirm-paid 不写 paid_deposit）
- 状态写死：`server.js:4506` / `server.js:4534`（`deposit_payment_status='paid'` 不考虑部分付款）
- 语义错配：`server.js:4562`（CI 汇总用 `actual_deducted_deposit` 填充 `paid_deposit`）
- 无 reverse：付款申请无冲销；PI void（server.js:3528）不回滚定金
- 数据铁证：2 条 `deposit_payment_status='paid'` 的 PI 其 `paid_deposit` 均为 0（PI-2026-551654、PI-2026-613351），且对应已付付款申请 paid_amount 分别为 23.52 / 9；全库 `paid_deposit>0` 记录数 = 0。
