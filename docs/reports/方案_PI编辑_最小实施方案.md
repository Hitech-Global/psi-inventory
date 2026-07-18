# 方案_PI编辑_最小实施方案

> 状态：方案确认（只读排查 + 最小方案）
> 范围：仅 PI 本单内闭环（表头 / 明细 / PO vs PI 差异 / 本单金额口径 / PO 级联）
> 边界：不扩到 CI/PL 联动、审批中心、订单预测、停采/失真/多维周转/三页口径/实时回写、SKU 主数据
> 权限：复用现有 `pi_edit` 权限点；本轮仅【超级管理员】可用，不新增 `pi_edit_after_create`

---

## 1. 现状结论

**PI 编辑是“半成品”：后端有一个残缺的 PUT，前端完全没有编辑入口。**

| 层 | 现状 | 代码证据 |
|---|---|---|
| 后端 PUT | 已存在 `PUT /api/proforma-invoices/:id`，但**只改 8 个表头字段**：`payment_terms, need_deposit, deposit_ratio, balance_ratio, pi_status, expected_delivery, attachment, remark` | `server.js:2884`、字段清单 `server.js:2890` |
| 后端 PUT 缺失能力 | **不碰**供应商 / PI No. / PI 日期 / 币种 / `payment_term_id` / `brand` `country` `target_warehouse`；**完全不处理明细行**；`total_amount` 也不重算 | `server.js:2884-2910` |
| 前端 | 只有 `viewPI(id)`（查看详情），**没有 `editPI` 函数** | `app.js:4600` |
| 前端列表 | PI 列表操作仅有 `👁️查看 / 📎附件 / 💰定金 / 作废`，**无编辑按钮**（`pi_edit` 仅用于“作废”按钮显隐） | `app.js:4597` |

结论：后端写了一个“只能改备注/定金/状态”的 PUT，前端未做编辑入口，也未接入。不是“完全没做”，是“后端残缺 + 前端零接入”。

### 权限现状（已确认，无需新增点）
- `pi_edit` **已在权限目录注册**：`allPerms` 数组含 `'pi_edit'`（`db.js:1224`、`db.js:1241`）。
- **超级管理员 `role_admin` 的权限种子 = `allPerms`**（`db.js:1260`），故超管天然已带 `pi_edit`。
- 决策：**复用 `pi_edit`，不新增 `pi_edit_after_create`**。锁定规则（CI/PL 未生成才允许）是后端业务守卫，不用权限点表达。
- 提示：当前前端 `renderRoles`（`app.js:758-768`）只列表展示角色、无可视化勾选权限弹窗；后端 `POST /api/roles`（`server.js:173`）支持改权限。本轮不依赖角色 UI 改造（超管已有权限）。

---

## 2. 锁定规则（核心业务边界）

**主规则**：PI 只有在 **CI/PL 尚未生成** 时才允许编辑；一旦 CI 或 PL 已生成，该 PI 锁定，不再允许编辑。

**锁定判据（任一成立即锁定）**：
1. 存在 `commercial_invoices` 行其 `related_pi_id = 本PI.id`（CI 生成，`db.js:698`）
2. 存在 `packing_lists` 行其 `related_pi_id = 本PI.id`（PL 生成，`db.js:983`）
3. `pi_status = 'cancelled'`（已作废）
4. 定金已付：`deposit_payment_status != 'unpaid'` 或 `paid_deposit > 0`

> 建议“CI/PL 存在即锁定”（含 draft 状态 CI），最稳妥，避免草稿 CI 被改 PI 架空。
> 规则 3、4 是主规则之外的两道保险：已作废单据不应再编辑；定金已付后改总额/比例会使已提交付款申请与 PI 脱节。

**允许编辑的充要条件**（全部满足）：
- `pi_status != 'cancelled'`
- 无 CI/PL 关联（上述判据 1、2 均不成立）
- 定金未付（上述判据 4 不成立）

---

## 3. 本轮可编辑字段

**表头（可编辑）**：
- 供应商（改后会触发付款条件下拉重新按该供应商过滤）
- PI 日期（`pi_date`）
- 币种（`currency`，影响金额展示口径；CI/PL 未生成前安全）
- 是否需要定金（`need_deposit`）
- 定金比例（`deposit_ratio`）
- 预计交期（`expected_delivery`）
- 付款条件（`payment_terms` 文本 + `payment_term_id` 追溯 id，二选一联动）
- 品牌 / 国家 / 仓库（`brand` / `country` / `target_warehouse`）
- 备注（`remark`）

**明细（可编辑，可增删行）**：
- SKU（`sku_code`）
- PI 确认数量（`pi_confirmed_qty`）
- PI 确认单价（`unit_price`）
- PI 折扣（`discount`）

> 明细编辑**复用现有前端能力**：`computePODiff(poRef, piItems)`（`app.js:4639`）预填 `window._piRows` → `renderCmpTable()` 渲染可编辑对比表；`onPISupplierChange()` 负责付款条件下拉联动（已就绪）。

---

## 4. 本轮不可编辑字段

| 字段 | 锁定原因 |
|---|---|
| **PI No.**（`pi_no`） | 业务单号；CI/PL 通过 `pi_no` 关联，改了会让下游找不到，**强锁** |
| **关联 PO**（`related_po_id`） | 改它要重算原 PO 的 `transferred_pi_qty` 再算新 PO，牵连极大，**锁** |
| **shipped_qty / unshipped_qty** | 发货量由 CI 回写，锁 |
| **pi_status** | 编辑不改变状态（不自动推进流程） |
| 定金已付相关：`paid_deposit` / `deducted_deposit` / `deposit_payment_status` 等 | 由付款申请流程写，编辑不触碰（且仅当未付才允许编辑，见 §2） |

---

## 5. 编辑后必须同步更新的数据清单

| 对象 | 动作 | 说明 / 代码参照 |
|---|---|---|
| `proforma_invoices` 表头字段 | UPDATE | 供应商/日期/币种/定金/交期/付款条件/品牌仓/备注 + `updated_at` |
| `proforma_invoices.total_amount` | **重算** | Σ 明细 `pi_amount`；金额口径含折扣：`qty × price × (1 - discount)`（参照 `server.js:2843-2845`），显式 `pi_amount` 优先 |
| `proforma_invoices.payable_deposit` / `available_deduct_deposit` | **重算** | 定金开时 `total_amount × deposit_ratio%`（参照 `server.js:2860`、`:2895-2903`） |
| `proforma_invoices.balance_ratio` | **重算** | `100 - deposit_ratio`（创建时如此，`server.js:2838`；PUT 须补） |
| `proforma_invoice_items` | **全量替换** | 删旧行 + 插新行，`pi_amount` 重算 |
| `purchase_order_items.transferred_pi_qty` | **delta 同步** | 旧量→新量；刷新 PO 状态 `partial_pi` / `transferred_pi`（逻辑参照 `server.js:2851-2872`） |
| `suppliers.last_used_payment_term_id` | **回写（若付款条件变更）** | 复用 `POST /api/suppliers/:id/last-payment-term`（参照 `app.js:4782`） |
| 4 个在途字段 | 调 `updateInventoryTransitData()` | 与创建行为一致（`server.js:2876`），保持库存在途同步 |
| `operation_logs` | 追加一条 | 编辑痕迹（谁/何时/改了什么）；表已存在 `db.js:1068` |
| **不碰** | — | CI/PL、付款申请、审批流、库存可用量、SKU 主数据 |

### PO vs PI 差异重算
- 差异展示由 `computePODiff(poRef, piItems)`（`app.js:4639`）+ `renderCmpReadonly`（`app.js:4640`）完成，编辑保存后 PI 明细变化，**详情/列表的差异展示会自动跟随新数据**（无需单独写差异重算逻辑，只读视图基于最新 PI 明细）。
- 真正的级联重算在 PO 侧（`transferred_pi_qty` 与 PO 状态），见上表。

### 定金 / 尾款口径
- 只要定金未付（锁定规则 §2 已保证），编辑后 `total_amount` 与 `payable_deposit` 重算即保证本单定金/尾款口径自洽；已付场景已被锁定排除。

---

## 6. 明确不动的边界

- 不新增权限点（复用 `pi_edit`）
- 不扩到【审批中心】
- 不动【订单预测】
- 不动【CI / PL 现有逻辑】与已有数据（CI/PL 生成后 PI 锁定，编辑不影响它们）
- 不动【停采 / 失真 / 多维周转 / 三页口径 / 实时回写】
- 不动【SKU 主数据】
- 不改动已调顺的「供应商 → PI 付款条件联动」逻辑（`onPISupplierChange` / `loadPOForPI`）
- 不重构 `createPI` / `saveNewPI`（编辑走新建 `editPI` / `saveEditPI`，复用既有渲染函数 `renderCmpTable` / `computePODiff`）

---

## 7. 最小实施拆解

### 第 1 层 · 后端加固 PUT（server.js:2884）
- 入参扩展：接收表头字段 + `items` 数组 + `payment_term_id`
- **锁定守卫**（不满足返回 409）：
  - 查 `commercial_invoices` / `packing_lists` 是否 `related_pi_id = 本PI` → 已生成 CI/PL 则拒绝
  - `pi_status = 'cancelled'` → 拒绝
  - 定金已付（`deposit_payment_status != 'unpaid'` 或 `paid_deposit > 0`）→ 拒绝
- 全量替换 `proforma_invoice_items`（删旧 + 插新），重算 `pi_amount`
- 重算 `total_amount`、`payable_deposit`、`available_deduct_deposit`、`balance_ratio`
- delta 同步 PO `transferred_pi_qty` + 刷新 PO 状态 `partial_pi` / `transferred_pi`
- 付款条件变更则回写 `suppliers.last_used_payment_term_id`
- 调 `updateInventoryTransitData()` 保持在途同步
- 写 `operation_logs` 一条编辑记录
- `GET /api/proforma-invoices`（列表）与 `GET /api/proforma-invoices/:id`（详情）增加 `locked` 标志位（前端置灰/提示用）

### 第 2 层 · 前端编辑弹窗 `editPI(id)`（app.js，新建函数）
- 复用 `createPI` 表单结构；用 `computePODiff(poRef, pi.items)` 预填 `window._piRows` → `renderCmpTable()` 可编辑
- 预填所有可编辑表头；付款条件下拉联动 `onPISupplierChange()`（已就绪）
- 拉到 `locked=true` 时打开即提示“已锁定，不可编辑”并禁用保存

### 第 3 层 · 前端保存 `saveEditPI()`（app.js，新建函数）
- 组装 `d`（字段同 `saveNewPI` 但改用 `PUT /api/proforma-invoices/:id`）
- 付款条件变更时回写 `last_used_payment_term_id`（复用 `app.js:4782` 写法）
- 成功后 `closeModal()` + `loadPI()` 刷新列表

### 第 4 层 · 列表加“✏️编辑”按钮（app.js:4597）
- `hasPermission('pi_edit')` 且 `!locked` 才显示可点按钮
- `locked` 时显示置灰按钮 + 悬停提示“已生成CI/PL / 已付定金 / 已作废，锁定”

---

## 8. 每层做完后验收什么

### 第 1 层（后端）验收
- 用带 `pi_edit` 权限的请求：
  - 改表头 + 明细 → PUT 成功，DB 中 `total_amount` / `payable_deposit` / `balance_ratio` 正确重算
  - 改明细数量 → 对应 PO 的 `transferred_pi_qty` 与 PO 状态同步正确
  - 改付款条件 → `suppliers.last_used_payment_term_id` 更新
  - 对**已有 CI/PL** 的 PI 调 PUT → 返回 409 被拒
  - 对**定金已付** 的 PI 调 PUT → 返回 409 被拒
  - 对 **cancelled** 的 PI 调 PUT → 返回 409 被拒
  - `GET` 列表/详情返回 `locked` 标志正确

### 第 2 层（前端弹窗）验收
- 硬刷新 → PI 列表 → 点某张 PI 的“✏️编辑” → 弹窗预填正确（表头 + 明细 + PO vs PI 对比表可编辑）
- 选供应商后付款条件下拉按该供应商过滤（联动正常）
- `locked` 的 PI 点编辑 → 提示锁定且保存禁用

### 第 3 层（前端保存）验收
- 在弹窗改数量/单价/付款条件 → 保存 → 提示成功、弹窗关闭、列表刷新
- 详情页 `viewPI` 看到新值；PO vs PI 差异随新明细更新
- 改了付款条件的 PI → 该供应商 `last_used` 在下一次新建 PI 时优先预选

### 第 4 层（列表按钮）验收
- 有 `pi_edit` 权限才看到编辑按钮
- 已有 CI/PL、已付定金、已作废的 PI → 编辑按钮置灰 + 悬停说明锁定原因
- 无 `pi_edit` 权限角色（如普通用户）→ 看不到编辑按钮

---

## 附：关键代码锚点速查
- 后端 PUT（残缺）：`server.js:2884`
- 后端创建（金额/PO 级联参照）：`server.js:2826-2882`
- CI 关联 PI：`server.js:2977`、`:3184`
- PL 关联 PI：`server.js:3078`、`:3226`
- 权限点注册：`db.js:1224`、`:1241`；超管种子 `db.js:1260`
- 前端查看：`app.js:4600`；列表操作 `app.js:4597`；创建 `app.js:4607`；保存 `app.js:4774`
- 差异/对比复用：`computePODiff` `app.js:4639`、`renderCmpReadonly` `app.js:4640`、`renderCmpTable` `app.js:4632`
- 操作日志表：`db.js:1068`
