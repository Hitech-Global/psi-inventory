# SYS-MGMT-APPROVAL-01 审批流管理只读审计报告

- 审计日期：2026-07-17
- 审计性质：**只读排查（零代码改动）**
- 审计范围：`db.js` / `server.js` / `app.js` / `index.html` / `package.json` / `.env` + 全项目关键字检索（排除 `node_modules`）
- 执行纪律：只读排查 → 输出方案 → 架构确认 → 最小实施 → 隔离测试 → 报告

## 0. 禁止项约束（用户明确）
1. 不得直接新增 CC
2. 不得修改审批流程
3. 不得改付款 / 采购审批逻辑

本报告与后续最小方案均不触碰上述禁止项。

---

## 1. 当前审批流数据模型
系统中**只有两张**审批相关表（无 `approval_nodes` / `approval_node_approvers` / `approval_instances` / `approval_logs` 等）。

- **`approval_flows`**（`db.js:290-298`）
  ```sql
  CREATE TABLE IF NOT EXISTS approval_flows (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    business_type TEXT NOT NULL,
    levels TEXT DEFAULT '[]',   -- JSON 数组，内嵌"节点"
    is_enabled INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  )
  ```
  无外键、无约束；审批节点**不是独立表**，以 JSON 数组内嵌在 `levels` 列。

- **`approval_records`**（`db.js:339-353`）
  ```sql
  CREATE TABLE IF NOT EXISTS approval_records (
    id TEXT PRIMARY KEY,
    business_type TEXT NOT NULL,
    business_id TEXT NOT NULL,
    business_code TEXT DEFAULT '',
    submitter_id TEXT DEFAULT '',
    submitter_name TEXT DEFAULT '',
    current_level INTEGER DEFAULT 0,
    max_level INTEGER DEFAULT 1,
    approvers TEXT DEFAULT '[]',        -- JSON：实际审批人
    approval_history TEXT DEFAULT '[]', -- JSON：审批轨迹
    status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )
  ```
  **无 CC / 通知相关列**。

- 种子数据（`db.js:2045-2061`）：插入 10 个审批流，`levels` 形如
  `[{level:1,approver_role:'role_operator'},{level:2,approver_role:'role_admin'}]`，
  business_type 含 `po / payment_deposit / payment_balance / payment_freight / payment_duty / inbound_abnormal / check_diff / scrap / mdf_outbound / transfer`。

---

## 2. 审批节点结构
- **无独立节点表**。节点以 JSON 数组存于 `approval_flows.levels`（`db.js:294`）。
- 单节点元素字段**仅 3 个**：`level`(序号)、`name`(文本)、`approver_role`(角色 id)。
- **不存在** `node_type` / `condition` / `approver_type` / 并行 / 会签 等任何字段（前端与后端对 `levels` 仅做 `JSON.stringify` 原样展示，`app.js:657`）。
- **串行**：靠 `level` 升序表达；**并行 / 会签 / 或签：不支持**。
- 运行时节点结构为 `approval_records.approvers`（元素 `{level, approver_id, approver_name}`，`server.js:3685`），同样无并行概念。

---

## 3. 审批人来源
| 来源类型 | 是否支持 | 证据 |
|---|---|---|
| 角色（role） | 配置层支持 | `approval_flows.levels[].approver_role`（`db.js:2049`） |
| 指定人（user_id） | 运行时支持 | PO 提交 `approver_id = req.body.approver_id \|\| req.currentUserId`（`server.js:3678`），写入 `approvers`（`server.js:3685`） |
| 部门（department） | **不支持** | `users` 表无 `dept_id`（`db.js:93-103`） |
| 上级 / 动态表达式 | **不支持** | `users` 表无 `manager_id` / `parent_id`；无表达式解析逻辑 |
| 角色→运行时解析 | **断裂** | 配置为 `approver_role`，但提交时未解析成具体人（见 §4） |

> `users` 表字段：`id, username, name, password, role_id, status, email, created_at` + 飞书扩展列（`db.js:93-118`），无部门 / 上级 / 职位字段，故"上级审批"在模型层即不可能。

---

## 4. 多级审批能力（配置与执行脱节 —— 重大发现）
- **结构层面**：`approval_flows.levels` 支持多级；`approval_records` 有 `current_level` / `max_level` 计数器。
- **执行层面（PO）**：`submit-approval` **硬编码** `max_level=2`、且 `approvers` 只写入**一个** level-1 审批人（`server.js:3684-3685`），**完全不读取 `approval_flows.levels` 配置**。
- `server.js` 仅 2 处引用 `approval_flows`（`GET 1001` / `POST 1004`），**均为管理端 CRUD，无任何执行逻辑消费配置表** → 配置表是"孤岛"。
- 推进逻辑：`nextLevel = current_level+1`，超过 `max_level` 判通过（`server.js:3707-3708`）。因 `approvers` 仅 level-1，**第 2 级无任何具体审批人对象**，仅靠权限 `po_approve` 放行（`server.js:3693`），任何持有 `po_approve` 的角色成员均可批第 2 级；配置中的 `role_admin` 从未被校验。
- **付款审批**（`server.js:6307-6343`）：**纯单级**，仅翻转 `payment_requests.approval_status`，不建 `approval_records`、不读 `approval_flows`、无 `current_level/max_level`。
- **结论**：可配置多级"结构"存在，但执行引擎未消费；实际仅 PO 硬编码 2 级骨架生效。若以"可配置多级"为标准，当前**不支持**。

> `purchase_orders` 表虽定义 `approver_id / approver_name`（`db.js:659-660`），但全 `server.js` 从未写入（死列）。

---

## 5. 抄送 CC 缺失位置（精确清单）
全代码检索 `抄送 / cc_user / carbon / notify_cc / copied`：**无字段、表、接口、UI 实现**。仅出现在：
- 产品方案文档（未落地）：规划的 `cc_rules` 表。
- `app.js:662 / 671 / 727`：审批中心"抄送我的"占位 tab，落入 `else` 分支显示"后续版本接入"。
- 前序 `SYS-MGMT-AUDIT-01-REPORT-20260717.md` 已确认。

| 位置 | 缺失内容 |
|---|---|
| `db.js:290-298` | `approval_flows` 无 `cc` 字段；`levels` 节点仅 `level/name/approver_role` |
| `db.js:339-353` | `approval_records` 无 `cc_users` / `cc_role` |
| `server.js:3672-3690` | PO 提交审批未处理 / 通知抄送人 |
| `server.js:3693-3728` | PO 审批 / 驳回 / 撤回未通知抄送 |
| `server.js:6307-6343` | 付款审批未处理抄送 |
| `server.js:1004-1011` | 审批流 POST payload 无 `cc` |
| `app.js:650-660` | 审批流管理页只读展示，无 CC 编辑器 |
| `app.js:662-692` | 审批中心"抄送我的"tab 无数据 |
| `index.html` | 无 CC 模板 / 样式 |

---

## 6. 飞书通知未来接入点
**当前通知机制：零。** 无邮件 / 短信 / IM / webhook SDK；`package.json` 仅 `better-sqlite3 / dotenv / express / xlsx`。全项目外发 `fetch` 仅：飞书 OAuth 登录（`server.js:145/159`）与汇率 API（`server.js:917/959`）。审批动作只落库、不通知；前端"通知"仅为本地 toast，待审批靠轮询拉取。

**飞书现状：仅 OAuth 登录**（`server.js:345-388`），`users` 表已存 `feishu_open_id / feishu_union_id / feishu_user_id`（`db.js:105-118`），收件人 open_id 已具备。

**未来接入锚点（本轮仅标注，不实施）**：
- 新建 `sendFeishuNotify(openId, text)` → 调用 `open.feishu.cn/open-apis/im/v1/messages`。
- 新待审批：`server.js:3684-3687` 之后（PO 提交写库后）。
- 结果通知：`server.js:3706 / 3717 / 3721`（approve / reject / withdraw 分支）。
- 付款类：`server.js:6010` 待审查询同源创建分支；`server.js:6317 / 6327` 结果。
- 配置项：放 `system_config` 表（`db.js:329-335`）或 `.env`（`server.js:31-33`）。
- CC 承载：`approval_records` 建议新增 `cc_list TEXT`（当前缺失）。

---

## 7. 审批流与业务挂钩现状
| 实体 | 挂钩 | 证据 |
|---|---|---|
| **PO** | ✅ 真实闭环 | `approval_records` + `po_status/approval_status` 守卫下游（`server.js:3811/4242/5252/5330`） |
| **付款** | ⚠️ 仅状态位 | `approval_status` 翻转，无 `approval_records`，不读配置 |
| **PI / CI / 入库** | ❌ | 无审批流引用 |
| **`approval_flows` 配置** | ❌ 孤岛 | 仅 CRUD，执行未读 |

---

## 8. 当前能力清单
**支持**：审批流配置增 / 查（`GET/POST /api/approval-flows`）；PO 提交→硬编码 2 级审批→通过 / 驳回 / 撤回 + 轨迹；付款 / 盘点差异 / 库存调整单级状态位审批；配置层按角色建模、运行时按指定人；飞书登录 + open_id 落库。

**缺失 / 不支持**：配置表不被执行引擎消费；可配置多级（仅硬编码）；并行 / 会签；部门 / 上级审批人；CC；任何通知通道；前端审批流编辑 UI（仅只读 JSON 展示）；PI/CI/入库审批挂钩。

---

## 9. 关键风险与不一致
- **R1（高）**：`approval_flows` 配置孤岛——管理页看到的"多级 / 审批角色"对实际审批无影响，易误导。
- **R2（中）**：PO 第 2 级无具体审批人约束，仅权限放行，存在越权批审风险（任何 `po_approve` 角色成员可批第 2 级）。
- **R3（中）**："待我审批"tab 与"全部待审批"共用同一接口同一数据（`server.js:3467` 全量返回），无真实个人收件箱语义。
- **R4（低）**：前端审批流管理纯只读，无法增删改，配置管理能力名存实亡。

---

## 10. 最小方案建议（待架构确认，本轮尚未实施）
遵守禁止项：**不新增 CC、不改审批流程、不改付款 / 采购审批逻辑**。

### 方案 A（推荐核心）：补齐前端"审批流管理"编辑能力
- **目标**：让"审批流管理"页（`app.js:650-660`）真正可管理配置，而非只读 JSON。
- **后端**：新增 `DELETE /api/approval-flows/:id`（`requireApiPermission('system_config')`），与现有 `POST` upsert（`server.js:1004`）配合实现增 / 改 / 删。
- **前端**：`renderApprovalFlows` 增加 新增 / 编辑 / 删除 按钮 + 弹窗（`openModal`），结构化编辑 `name / business_type / levels`（每行：级次、名称、审批角色下拉）/ `is_enabled`；保存调 `POST /api/approval-flows`，删除调压 `DELETE`。
- **边界**：仅操作 `approval_flows` 配置表；不读取 / 消费配置进引擎；不触碰 `submit-approval` / `approve`；不新增 CC；不改付款 / 采购审批逻辑。
- **已知局限（明确告知）**：因禁止"修改审批流程"，本轮**不**把配置接入执行引擎，配置表仍不驱动实际审批（R1 留待后续独立 Phase，需单独架构确认）。

### 方案 B（推荐次级，待确认）：审批中心"待我审批"真实按人过滤
- **后端**：`GET /api/purchase-orders/pending-approval`（`server.js:3467`）支持可选 `?mine=1`，按当前用户过滤 `approval_records.approvers` JSON 中 level-1 `approver_id = currentUserId`。
- **前端**："待我审批"tab 调 `?mine=1`；"全部待审批"维持全量。
- **性质**：查询层改进，不改变审批状态机 / 流程，属展示准确性修复。
- **边界**：不改审批逻辑、不新增 CC、不接飞书。

### 明确不在本轮范围（禁止项 / 后续 Phase）
- 新增 CC 字段 / UI / 通知（禁止项①）
- 将 `approval_flows` 配置接入审批引擎、支持可配置多级（= 修改审批流程，禁止项②）
- 改动 `submit-approval` / `approve` / 付款审批逻辑（禁止项③）
- 飞书通知实际接入（仅标注接入点）
- PI / CI / 入库审批挂钩

### 隔离测试策略（实施时）
沿用 `DB_PATH` 副本 + 独立端口 + 真实 break-glass 登录取 cookie；覆盖：增 / 改 / 删 审批流配置持久化、`DELETE` 后 `GET` 列表反映、`?mine=1` 过滤正确性、普通接口无回归。
