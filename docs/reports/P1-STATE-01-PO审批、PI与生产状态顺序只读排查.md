# P1-STATE-01《PO 审批、PI 与生产状态顺序只读排查》

- 排查日期：2026-07-14
- 工作目录：`/Users/a1-6/Workbuddy/2026-07-04-17-45-01/inventory-app`
- 排查方式：纯只读（源码 grep + `better-sqlite3` 以 `{ readonly: true }` 临时脚本查询，运行后即删）
- 边界声明：本报告未对任何代码 / 数据库 / 接口 / 页面 / 测试数据 / 日志做写操作；未执行任何 DDL 或写入型测试；仅创建本报告文件。

---

## 1. 当前代码事实（各状态字段定义、状态更新路由、行号）

### 1.1 表结构（db.js，无 CHECK / 无 ENUM 约束，可接受任意字符串）
- `purchase_orders`：`po_status TEXT DEFAULT 'draft'`（db.js:609）、`approval_status TEXT DEFAULT 'pending'`（db.js:610）。
- `proforma_invoices`：`pi_status TEXT DEFAULT 'pending'`（db.js:664）、`deposit_payment_status TEXT DEFAULT 'unpaid'`（db.js:662）、`goods_payment_status TEXT DEFAULT 'unpaid'`（db.js:663）、`need_deposit INTEGER DEFAULT 1`（db.js:653）、`payable_deposit / paid_deposit / deducted_deposit / available_deduct_deposit`（db.js:656-659）。
- `commercial_invoices`（即 CI）：`ci_status TEXT DEFAULT 'draft'`（db.js:712）、`balance_payment_status TEXT DEFAULT 'unpaid'`（db.js:718）。
- **关键事实：不存在 `production`（生产）表，也不存在独立的 `deposits` 表。** “生产”在系统中未被建模为独立状态机；定金是 `proforma_invoices` 表内的字段集合（非独立实体）。

### 1.2 PO 状态更新路由（server.js）
- `POST /api/purchase-orders`（新建）：po_status 硬编码 `'draft'`、approval_status `'pending'`（server.js:3138）；不接受外部状态 → 安全。
- `DELETE /api/purchase-orders/:id`：守卫 `po_status==='draft'` 或 `transferred_pi/partial_pi 且无活跃PI`（server.js:3187-3194）。
- `POST /api/purchase-orders/:id/void`：守卫 `po_status!=='cancelled'`（server.js:3211），置 `cancelled`。
- `POST /api/purchase-orders/:id/submit-approval`：**守卫 `po_status==='draft'`**（server.js:3226），置 `pending_approval / pending`。
- `POST /api/purchase-orders/:id/approve`：**无 `po_status` 前置守卫**（server.js:3243-3278）；reject→`draft/rejected`；withdraw→`draft/pending`。
- `POST /api/purchase-orders/:id/send-to-factory`：**守卫 `po_status='approved'`**（server.js:3282）。
- `PUT /api/purchase-orders/:id`（编辑）：不修改 po_status（server.js:3155-3180）。

### 1.3 PI 状态更新路由（server.js）
- `POST /api/proforma-invoices`（新建）：**接受请求体 `d.pi_status`（`d.pi_status || 'pending'`）**（server.js:3357）；**不校验关联 PO 的审批状态**；若关联 PO 则按 `transferred_pi_qty` 直接把 PO 翻成 `transferred_pi` / `partial_pi`（server.js:3387-3391）。
- `PUT /api/proforma-invoices/:id`（编辑）：经 `getPILockReason` 守卫（CI/PL 已生成、已付定金、已作废→拒绝）（server.js:3411）。
- `POST /api/proforma-invoices/:id/attachment`（上传附件）：**无 pi_status 前置守卫**，仅按“是否有附件”置 `uploaded` / `pending`（server.js:3522）。
- `POST /api/proforma-invoices/:id/void`：守卫 `pi_status!=='cancelled' && !=='completed'`（server.js:3534-3535）。
- `POST /api/proforma-invoices/batch-import`（批量导入）：**直接 INSERT 外部 `pi_status` 与 `related_po_no`**（server.js:3746），与新建同款无 PO 状态校验、会翻 PO 状态。

### 1.4 定金（deposit）路由（server.js）
- `POST /api/payment-requests/from-pi-deposit`（发起定金付款）：**不校验 PI 当前 pi_status**，仅校验 `need_deposit && payable_deposit>0`，并置 `deposit_payment_status='pending_approval'`（server.js:4303-4325）。
- `POST /api/payment-requests/:id/approve` action=`confirm-paid`：当 `source_type==='pi'` 时**无条件**置 `deposit_payment_status='paid'` 且 `pi_status='deposit_paid'`（server.js:4506），**无 pi_status 前置守卫**。

### 1.5 CI（commercial_invoices）状态更新路由（server.js）
- `POST /api/commercial-invoices`（新建）：**接受请求体 `d.ci_status`（`d.ci_status || 'uploaded'`）**（server.js:3586）；**不校验关联 PI 的状态 / 定金是否已付**；按发货量把 PI 翻成 `shipped_complete` / `partial_shipped`（server.js:3632-3634）。
- `POST /api/commercial-invoices/:id/attachment`：**无 ci_status 前置守卫**，仅按附件置 `uploaded` / `draft`（server.js:3653）。
- `POST /api/commercial-invoices/:id/void`：守卫 `ci_status!=='cancelled' && !=='completed' && !=='partial_inbound'`（server.js:3666）。
- `POST /api/commercial-invoices/batch-import`：直接 INSERT 外部 `ci_status`（server.js:3792）。
- 入库：`ci_status` 置 `completed` / `partial_inbound`（server.js:3965-3967、4060-4062）。

---

## 2. 当前数据库事实（相关表状态字段、枚举取值、样本）

只读查询所得当前分布（仅读，无写）：

### 2.1 purchase_orders
- `po_status`：`transferred_pi`:20、`draft`:3、`cancelled`:2、`confirmed`:1、`partial_pi`:1。
  - 注意：当前**无 `approved` / `pending_approval` / `sent_factory` 取值**（这些为瞬态：PO 一旦转 PI 即被翻成 `transferred_pi/partial_pi`）。
  - `confirmed` 为**非代码路径产生的游离取值**（当前 server.js 任何路由均不写 `po_status='confirmed'`，疑为历史/导入/脚本遗留）。
- `approval_status`：`pending`:15、`approved`:12。

### 2.2 proforma_invoices
- `pi_status`：`shipped_complete`:20、`pending`:12、`uploaded`:9、`cancelled`:1、`confirmed`:1、`deposit_paid`:1。
  - `confirmed` 同样为**非当前代码路径产生的游离取值**（前端过滤器虽有 `confirmed` 选项，但后端无对应转换；批量导入可写入任意值）。
- `deposit_payment_status`：`unpaid`:30、`pending_approval`:12、`paid`:2。
- `need_deposit`：`1`:33、`0`:11。

### 2.3 commercial_invoices
- `ci_status`：`uploaded`:35、`completed`:6、`ci_pl_uploaded`:5、`shipped`:2。
  - `shipped` 为**非当前代码路径产生的游离取值**（当前路由只写 `draft/uploaded/ci_pl_uploaded/completed/partial_inbound/cancelled`）；但前端物流页用 `?status=shipped` 拉取（app.js:6020、6059），依赖该游离值。
- `balance_payment_status`：`unpaid`:38、`paid`:7、`pending_approval`:3。

### 2.4 跨表一致性（关键样本）
- 关联 PO 未审批（draft/pending_approval）却已关联 PI：**当前 0 条**（说明前端下拉过滤暂起了作用，但属 UI 层软约束，非后端硬约束）。
- 需要定金（`need_deposit=1`）却已生成 CI 且定金未付：命中 **10 条**（含 `ci_pl_uploaded`、`completed` 状态）。示例：`CI-2026-009473 ← PI-2026-009464`（need_deposit=1, deposit=unpaid, CI 已 ci_pl_uploaded）；`CI-2026-183834 ← PI-2026-183828`（deposit=unpaid, CI 已 completed）。
  - 结论：**定金不是 CI/生产的前置条件**，系统仅在金额计算时“抵扣”，不阻断流转。

---

## 3. 完整调用链（PO→PI→定金→生产→CI 的状态转换路径，前端按钮→接口→DB）

> “生产”在本系统无独立实体；下文把“生产/发货”映射为 PI 确认/定金 → CI 发货的隐式阶段。

1. **PO 草稿 → 提交审批**：前端 `submitPO()`（app.js:5455）→ `POST /api/purchase-orders/:id/submit-approval`（守卫 draft）→ DB `po_status=pending_approval, approval_status=pending`。
2. **审批通过**：前端审批操作 → `POST /api/purchase-orders/:id/approve` action=approve → DB `po_status=approved, approval_status=approved`（无前置守卫）。
3. **发工厂（可选）**：`sendFactory()`（app.js:5456）→ `POST /:id/send-to-factory`（守卫 approved）→ DB `po_status=sent_factory`。
4. **PO → PI（转单）**：前端 `createPI()` **仅拉取 `?status=approved` 的 PO**（app.js:5601，软约束）→ `POST /api/proforma-invoices`；**后端不校验 PO 审批状态**，且可写入任意 `pi_status`，并把 PO 翻成 `transferred_pi/partial_pi`。
5. **PI 上传附件**：`uploadDocAttachment('pi',...)` → `POST /:id/attachment` → DB `pi_status=uploaded`（无守卫）。
6. **定金付款**：`createDepPay()`（按钮仅当 `need_deposit && payable_deposit>0 && deposit_payment_status==='unpaid'` 显示，app.js:5523）→ `POST /api/payment-requests/from-pi-deposit`（不校验 pi_status）→ `deposit_payment_status=pending_approval`；审批 `confirm-paid` → **无条件** `deposit_payment_status=paid, pi_status=deposit_paid`。
7. **PI → CI（发货/“生产”出口）**：前端 `createCI()` **拉取全部 PI，无任何状态过滤**（app.js:5867，无软约束）→ `POST /api/commercial-invoices`；**后端不校验 PI 状态/定金**，可写入任意 `ci_status`，并按发货量把 PI 翻成 `shipped_complete/partial_shipped`。
8. **CI 附件/PL**：`POST /:id/attachment`（无守卫，置 uploaded/draft）→ PL 生成后 `ci_status=ci_pl_uploaded`（server.js:3707、3847）。
9. **入库**：入库记录 → `ci_status=completed/partial_inbound`。

---

## 4. 缺陷或风险（可跳过节点、无后端校验、状态冲突）

**R1（高危）PO 审批可被跳过**：`POST /api/proforma-invoices` 与批量导入不校验关联 PO 是否已审批，转 PI 时直接把 PO 翻成 `transferred_pi/partial_pi`，等于“用转 PI 动作绕过 PO 审批”。前端虽只给 `approved` PO 下拉，但接口层无硬约束，API/导入可构造未审批 PO 的转单。

**R2（高危）任意状态注入**：新建/导入 PI、CI 均接受请求体 `pi_status` / `ci_status`，可凭空写入 `confirmed`、`shipped`、`producing` 等任意值（数据库无 ENUM/CHECK）。现实库中已存在游离值 `po_status='confirmed'(1)`、`pi_status='confirmed'(1)`、`ci_status='shipped'(2)`，与状态机不符。

**R3（高危）无后端状态前置校验**：PI 附件上传、CI 附件上传、定金 `confirm-paid`、CI 新建、PI 新建**均无“当前状态是否允许本次转换”的判断**。后果包括：
- 已 `deposit_paid` 的 PI 可经“改附件”被重置为 `uploaded`/`pending`（server.js:3522）；
- 已 `completed` 的 CI 可经“改附件”被重置为 `uploaded`/`draft`（server.js:3653）；
- 任意 PI 状态均可被定金审批翻成 `deposit_paid`（server.js:4506）。

**R4（中危）定金不是前置条件**：`need_deposit=1` 的 PI 仍可无条件生成 CI，且库内已存在 10 条“需定金但定金未付”的 CI（含 `completed`/`ci_pl_uploaded`）。定金仅参与金额抵扣，不阻断“生产/发货”。

**R5（中危）PI/CI 作废不回滚上游在途**：PI 作废（server.js:3538）仅置 `cancelled`，**不回退 PO 的 `transferred_pi_qty` 与 `po_status`**；CI 作废亦不回退 PI 的 `shipped_qty/amount`。导致：PO 显示 `transferred_pi` 但其 PI 已作废，PO 永远停留在 `transferred_pi`，且 `transferred_pi_qty` 被虚增。属状态/数据冲突。

**R6（低危）UI 状态枚举与 DB 不一致**：`renderPI()` 过滤器列出 `confirmed`/`producing`/`pending_deposit`/`pending_ci_pl`（app.js:5516），但 DB 的 `pi_status` 无这些取值（仅 pending/uploaded/deposit_paid/shipped_complete/partial_shipped/completed/cancelled），按这些选项过滤会**永远返回空**。物流页用 `?status=shipped` 拉取（app.js:6020/6059），依赖游离值 `shipped`，健壮性差。

**R7（低危）PO approve 无状态守卫**：`/approve` 不校验 `po_status==='pending_approval'`，若库内残留旧审批记录，可对非待审 PO 执行审批写入。

---

## 5. 受影响文件、函数、接口、表和字段

- 文件：`server.js`、`app.js`、`db.js`（仅列影响，本轮不改）。
- server.js 路由/函数：`POST /api/proforma-invoices`(3345)、`POST /api/proforma-invoices/batch-import`(3722)、`POST /api/proforma-invoices/:id/attachment`(3520)、`POST /api/payment-requests/from-pi-deposit`(4303)、`POST /api/payment-requests/:id/approve`(4493/4506)、`POST /api/commercial-invoices`(3572)、`POST /api/commercial-invoices/batch-import`(3769)、`POST /api/commercial-invoices/:id/attachment`(3650)、`POST /api/purchase-orders/:id/approve`(3243)、`getPILockReason`(3312)。
- app.js：`renderPI`(5516)、`createPI`(5600)、`createCI`(5866)、`loadPIForCI`(5872)、物流 `?status=shipped`(6020/6059)。
- 表/字段：`purchase_orders.po_status/approval_status`；`proforma_invoices.pi_status/deposit_payment_status/need_deposit/payable_deposit/transferred 关联`；`commercial_invoices.ci_status/balance_payment_status`；`purchase_order_items.transferred_pi_qty`。

---

## 6. 最小方案（仅设计，不实施）

仅对**最高危 R1、R2** 做最小闭环：
- 在 `POST /api/proforma-invoices` 与批量导入中，若 `related_po_id` 非空，校验关联 PO 的 `po_status IN ('approved','sent_factory','transferred_pi','partial_pi')`，否则拒绝（返回 400）。
- 在 PI/CI 新建与导入中，将 `pi_status`/`ci_status` 收敛为**白名单**，拒绝白名单外取值（消除 `confirmed`/`shipped` 注射）。
- 不改变任何现有合法流转，不动前端。

---

## 7. 完整方案（同上，仅设计）

在最小方案基础上补齐状态机治理：
1. **统一状态枚举**：在应用层（或 db.js 迁移加 CHECK）明确定义 `po_status`、`pi_status`、`ci_status` 合法集合，并在所有写入点做白名单校验。
2. **后端状态前置校验**：为每条状态转换增加“当前状态 → 目标状态”合法性校验（PI 附件上传、CI 附件上传、定金 confirm-paid、CI 新建均加守卫），拒绝非法回退/跳跃。
3. **PO→PI 强约束**：PI/CI 创建前强制校验关联 PO 已 `approved`（或 `sent_factory`），否则拒绝；杜绝“转 PI 绕过审批”。
4. **定金前置（可配置）**：新增配置项 `require_deposit_before_ci`；为 `need_deposit=1` 的 PI，在生成 CI 前强制 `deposit_payment_status='paid'`（默认关闭，避免破坏现有无定金流程）。
5. **作废回滚**：PI 作废时回退 PO 的 `transferred_pi_qty` 并重算 `po_status`；CI 作废时回退 PI 的 `shipped_qty/amount`，保证上游在途一致。
6. **清理游离值**：将数据中的 `po_status='confirmed'`、`pi_status='confirmed'`、`ci_status='shipped'` 归一到合法枚举（需业务确认语义）。
7. **前端枚举对齐**：`renderPI` 过滤器与物流页 `?status=shipped` 改为合法枚举值。

---

## 8. 推荐方案（同上，仅设计）

采用**完整方案第 1–5 项 + 第 7 项**作为推荐落地（第 6 项游离值清理需业务确认语义，建议先行统计影响再执行）。理由：
- R1/R2/R3 属数据完整性与审计合规红线，必须修；
- 定金前置（第 4 项）默认关闭，兼容现有“无定金也可发货”的实际业务，待业务确认后再开；
- 作废回滚（第 5 项）修复在途虚增，避免后续库存/预测误算；
- 前端枚举对齐成本低、收益明确。

---

## 9. 实施修改范围（列出需改文件/表/字段/校验，本轮不做）

- **server.js**
  - `POST /api/proforma-invoices`：增加关联 PO 审批状态校验 + `pi_status` 白名单。
  - `POST /api/proforma-invoices/batch-import`：同上。
  - `POST /api/proforma-invoices/:id/attachment`：增加 `pi_status` 前置守卫，禁止从 `deposit_paid/shipped_*` 回退。
  - `POST /api/payment-requests/:id/approve`(confirm-paid)：增加 PI 当前状态守卫。
  - `POST /api/commercial-invoices` 及 `batch-import`：增加关联 PI 状态校验（建议 `deposit_paid` 或至少非 `pending`/`cancelled`）+ `ci_status` 白名单；按配置校验定金已付。
  - `POST /api/commercial-invoices/:id/attachment`：增加 `ci_status` 前置守卫，禁止从 `completed/partial_inbound` 回退。
  - `POST /api/purchase-orders/:id/approve`：增加 `po_status==='pending_approval'` 守卫。
  - `POST /api/proforma-invoices/:id/void` 与 `POST /api/commercial-invoices/:id/void`：增加上游在途回滚（PO `transferred_pi_qty` / `po_status`；PI `shipped_qty/amount`）。
- **app.js**
  - `renderPI` 过滤器：枚举改为真实 `pi_status` 值。
  - 物流页 `?status=shipped`：改为合法枚举（或后端补齐 `shipped` 语义）。
- **db.js（如采用 CHECK）**
  - 为 `purchase_orders.po_status`、`proforma_invoices.pi_status`、`commercial_invoices.ci_status` 增加 CHECK 约束（需迁移，注意 WAL/备份）。
- **数据修复（待业务确认）**
  - 归一 `po_status='confirmed'`、`pi_status='confirmed'`、`ci_status='shipped'` 游离值；复核 10 条“需定金未付却已 CI”的记录。

---

## 10. 针对性测试建议（状态机覆盖）

> 仅建议，本轮不执行任何测试。

1. **PO 审批守卫**：draft→submit 成功；非 draft 提交被拒；approve 前校验 `pending_approval`；reject→draft(可重提)；withdraw→draft(可重提)。
2. **R1 回归（绕过审批）**：对 `draft`/`pending_approval` 的 PO 直接 `POST /api/proforma-invoices`，断言 400 且 PO 不被翻 `transferred_pi`（API 与 batch-import 两条路径）。
3. **R2 状态注入**：新建 PI/CI 时传 `pi_status='producing'`、`ci_status='shipped'`，断言被拒或归一到合法值。
4. **R3 非法回退**：`deposit_paid` 的 PI 调 attachment 接口，断言不回退为 `uploaded`；`completed` 的 CI 调 attachment 接口，断言不回退为 `uploaded/draft`。
5. **R4 定金前置**：`need_deposit=1` 且 `deposit_payment_status!='paid'` 的 PI 生成 CI，在 `require_deposit_before_ci=false` 时允许、在 `=true` 时拒绝。
6. **CI 前置（PI 状态）**：对 `pi_status='pending'` 的 PI 生成 CI，断言被拒（建议新增守卫）。
7. **R5 作废回滚**：PI 作废后断言 PO `transferred_pi_qty` 减少且 `po_status` 正确重算；CI 作废后断言 PI `shipped_qty/amount` 回退。
8. **枚举一致性**：`GET /api/proforma-invoices?status=confirmed` 等返回与过滤器一致；不存在的枚举返回空而非报错。
9. **端到端happy path**：draft→approved→（sent_factory）→PI(pending→uploaded→deposit_paid)→CI(uploaded→ci_pl_uploaded→completed) 全链路断言每步状态与上游联动正确。

---

## 11. 明确本轮零修改

- 本报告为**纯只读排查**：仅使用 `better-sqlite3({ readonly: true })` 临时脚本读取数据库，脚本运行后已删除；未执行任何 DDL、未运行任何写入/变更型测试、未修改 server.js / db.js / app.js / .db / 任何 .md / .workbuddy 目录。
- 唯一新增文件为本报告：`P1-STATE-01-PO审批、PI与生产状态顺序只读排查.md`。
- 上述第 6–9 节均为“设计/建议”，**未实施**；若需落地请另开实施任务。
