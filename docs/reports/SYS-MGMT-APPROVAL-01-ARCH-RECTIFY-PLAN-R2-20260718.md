# SYS-MGMT-APPROVAL-01 · 架构验收补正方案 R2（最终业务决策版）

> 状态：**只读复核 + 方案修订完成，等待确认。本文件不修改任何代码/数据库/页面/文档基线。**
> 日期：2026-07-18
> 取代前一版（1a 角色池方案）已不适用——最终决策：**审批责任主体 = 具体系统用户 User，角色仅管权限**。
> 已落盘 M1/M2/M3 **保留不回滚**，本方案为其最小增量补正。
> 严守：不接 CC / 不接飞书 / 不改付款链 / 不改采购链 / 不重构状态模型 / 不重构权限模型 / 不建通用审批引擎。

---

## 1. 当前 users / roles / 权限 实际结构（含澄清）

> 用户指令提到 `role_permissions`，实测**无此独立表**；权限是 `roles.permissions` 的 JSON 列。

**users 表**（db.js:93-103 基础 + 105-115 Feishu 扩展，幂等迁移）：
```
id TEXT PK, username UNIQUE, name, password, role_id DEFAULT 'role_viewer',
status DEFAULT 'active',  -- active / disabled / pending
email,
-- Feishu 扩展列：
auth_source TEXT DEFAULT 'feishu', feishu_open_id, feishu_union_id, feishu_user_id,
password_hash, last_login_at
```
**roles 表**（db.js:81-88）：
```
id TEXT PK, name, description, permissions TEXT DEFAULT '[]',  -- JSON 数组，如 ["po_approve", ...]
is_system INTEGER DEFAULT 0, created_at
```
**权限载体 = `roles.permissions`**（即用户所称 "role_permissions" 的真实落点，单表 JSON 列，无独立关联表）。

**三者关联**：`users.role_id → roles.id`；"某用户是否可审 PO" = 其 `role_id` 对应 `roles.permissions` 含 `po_approve`。飞书通知未来用 `users.feishu_open_id`（已存，当前零使用）。

---

## 2. `req.currentUserId` 准确来源与可用性

- 注入点：`apiAuth` 中间件（server.js:283-323），经 `app.use('/api', apiAuth)`（server.js:340）应用到**所有 /api 路由**。
- 取值：`req.currentUserId = user.id`（server.js:306 / 318），`user` 来自 `sessions.token_hash → users.id`，每次请求从库实时读（角色变更即时生效）。
- 可用性：在 `pending-approval`（server.js:3467）与 `approve/reject`（server.js:3725）等端点**均已就绪**，无需新增注入。
- `req.currentUserRole`（server.js:320）= `user.role_id`，本轮仅作辅助快照，**不作为审批责任主键**。

---

## 3. `approval_flows.levels` 新数据结构（配置态）

原（角色池，废弃）：
```json
[{"level":1,"name":"一级审批","approver_role":"role_operator"},
 {"level":2,"name":"二级审批","approver_role":"role_admin"}]
```
新（具体用户，每级一名）：
```json
[
  {"level":1,"name":"一级审批","approver_user_id":"user_xxx","approver_name":"Amy","approver_role_id":"role_admin"},
  {"level":2,"name":"二级审批","approver_user_id":"user_yyy","approver_name":"Martin","approver_role_id":"role_admin"},
  {"level":3,"name":"三级审批","approver_user_id":"user_zzz","approver_name":"洪子锋","approver_role_id":"role_admin"}
]
```
- 责任主键 = `approver_user_id`；`approver_role_id` 为提交时快照/辅助展示。
- `is_enabled`（db.js:295，INTEGER DEFAULT 1）保留启用/停用。
- 存于 `approval_flows.levels`（TEXT JSON，db.js:294），**无需改表结构**。

---

## 4. PO 提交时审批节点快照结构（运行态）

`submit-approval`（server.js:3683-3722，M1 改写段 3690-3713）读取 flow 配置后，写入 `approval_records.approvers`：
```json
[
  {"level":1,"approver_user_id":"user_xxx","approver_name":"Amy","approver_role_id":"role_admin"},
  {"level":2,"approver_user_id":"user_yyy","approver_name":"Martin","approver_role_id":"role_admin"}
]
```
- `max_level = levels.length`；`current_level` 起始 1。
- **直接复制配置中的具体用户，不做"角色→多人 materialize"**（废弃 1a）。
- 无启用配置时兜底：保持原有单级行为（`max_level=2`，`approver_user_id = 提交人/指定人`）以兼容。

---

## 5. `pending-approval` 按 `user_id` 过滤方案（取代 M2 角色过滤）

- 位置：server.js:3492-3503（原 M2 段）。
- 新逻辑（`?mine=1`）：
  ```
  const cur = (JSON.parse(r.approvers||'[]')).find(a => a.level === r.current_level);
  if (cur && cur.approver_user_id === req.currentUserId) filtered.push(r);
  ```
- **仅按 `req.currentUserId` 匹配当前级次节点 `approver_user_id`**；删除原 `approver_role === req.currentUserRole` 的角色匹配（避免"按角色=按人"误导）。
- 兼容兜底（仅防御，生产当前无在途旧实例）：若某 pending 实例的当前节点**缺 `approver_user_id`**（历史残留），**不**回落角色，而是**不进入"待我审批"**（避免静默错误绑定）；其仅出现在"全部待审批"（po_approve 用户可见），且因守卫缺 user_id 无法被正常 approve（见 §6），需重提或管理员处置。
- 普通 "全部/采购类" tab 不变（无 `mine` 参数，返回全部 pending）。

---

## 6. `approve/reject` 双重校验方案（闭环 L1）

- 位置：`POST /api/purchase-orders/:id/approve`（server.js:3724-3760），入口 `requireApiPermission('po_approve')`（3725）保留。
- 在 `approve` 分支（3738 前）与 `reject` 分支（3749 前）、写库前插入守卫：
  ```
  const cur = (JSON.parse(approval.approvers||'[]')).find(a => a.level === approval.current_level);
  const nodeOk = cur && cur.approver_user_id === req.currentUserId;
  if (!nodeOk) return res.status(403).json({ error: '当前用户不是该审批节点的审批人' });
  ```
- 三重条件（任一不满足 → 403，不写库）：
  1. `requireApiPermission('po_approve')`（已有）；
  2. `cur.approver_user_id === req.currentUserId`（新增）；
  3. 实例 `status='pending'` 且 `current_level` 合法（已有逻辑隐含）。
- **仅修改 PO 审批入口**；付款/盘点/入库/报废等各自状态位审批**完全不动**。
- **withdraw（server.js:3753）本轮不改**：保持仅 `po_approve`，以免顺手改规则。其"任意 po_approve 可撤回他人 PO"的历史权限问题**单独记录为已知债务**（见 §12），不在本补正修复。

---

## 7. 审批流最小配置页面方案

- 现状：`renderApprovalFlows`/`loadApprovalFlows`（app.js:650-660）仅 `JSON.stringify(levels)` 只读展示，**无编辑/选择能力**；菜单 perm `system_config`（app.js:179）。
- 最小增量（前端 app.js 新增编辑器，复用现有 `openModal/closeModal/showToast`，零 CSS 改动）：
  1. `loadApprovalFlows` 改为：拉取 `GET /api/approval-flows` + `GET /api/users`（现有接口，app.js:852 已用），渲染**可编辑表格**。
  2. 每行 = 一级：序号(level，自动顺排/可改)、名称、审批人下拉（选项= `active` 且角色含 `po_approve` 的用户，前端预筛；后端权威校验）、删除按钮。
  3. "新增级次"按钮追加一行；顶部"启用/停用"开关绑定 `is_enabled`；"保存"按钮。
  4. 保存 → `POST /api/approval-flows`（server.js:1004）upsert。
- **不做**：金额条件、分支、并行、会签、或签、代理等复杂引擎；不新增账号/通讯录（用户来源 = users 表）。
- 权限合规：配置页 perm 仍为 `system_config`（仅管理员配）；被选中为审批人的 operator 若要进审批中心，须先经角色管理获 `po_approve`（见 §9/L2）。

---

## 8. 旧审批实例兼容方案（只读核实结论）

- 只读核实生产库：`approval_records` 共 19 条 PO 实例，**0 条 pending**（16 approved / 1 rejected / 2 withdrawn）。**无任何在途待审批实例。**
- 策略（最小、零迁移风险）：
  1. **新提交 PO** 一律用 §4 新 `approver_user_id` 结构。
  2. **历史终态记录（approved/rejected/withdrawn）保持不可变、不回写**——它们是已完成审批，无需变更；其旧 `approvers`（角色形态）仅供"审批历史"展示，不影响运行。
  3. **无在途旧实例 → 无需迁移脚本**，不存在"新数据按人、旧数据任意角色可批"的活缺口。
  4. **防御性兜底**（防未来从备份/导入带入旧的 pending 实例）：§5/§6 已规定——pending 实例缺 `approver_user_id` 时不进"待我审批"且 approve 守卫拒批（403）。这**永久关闭**角色兜底导致的越权缺口，不长期保留。
  5. **未经确认绝不迁移正式数据库**；本补正仅在隔离副本(/tmp)验证，生产库零污染。

---

## 9. 精确代码位置（均为增量，不动 M1/M2/M3 既有结构）

| 编号 | 文件:行 | 改动 | 类型 |
|---|---|---|---|
| N1 | server.js:3690-3713（M1 提交段） | 读取 flow 每级 `approver_user_id/name/role_id` 直接快照写入 `approvers`（去 1a 角色→多人） | 增量改写段 |
| N2 | server.js:3493-3502（M2 段） | 按 `approver_user_id === req.currentUserId` 过滤；删角色匹配；旧缺 user_id 不进"待我审批" | 增量改写段 |
| N3 | server.js:3738 / 3749（approve/reject 入口） | 加当前节点 `approver_user_id` 匹配校验，不符→403 | 增量 |
| N4 | server.js:1004-1011（POST /api/approval-flows） | 保存前校验每级：用户存在/active/其角色含 po_approve/非空/level 正整数且唯一 | 增量 |
| N5 | app.js:650-660（renderApprovalFlows/loadApprovalFlows） | 改为可编辑配置页（用户下拉+增删级次+启停+保存） | 增量新增 |
| — | server.js:1001 GET /api/approval-flows | 已返回解析后 levels，**不改**（编辑器复用） | 保持 |
| — | server.js:3753 withdraw | **不改** | 保持 |
| — | app.js:158 审批中心菜单 perm `po_approve` | **不改**（被选中审批人须具 po_approve 才能进入，与 N4 校验一致） | 保持 |

---

## 10. 最小数据库变更判断

- **无需任何 ALTER / 新增表 / 迁移脚本。**
- `approval_records.approvers` 与 `approval_flows.levels` 均为 **TEXT JSON 列**（db.js:294 / approval_records 同类型），新结构仅是 JSON **内容形态演进**，列类型不变。
- `cc_list` 等 CC 字段**本轮不加**（CC V1 为后续子阶段，见 §11/§12）。
- 结论：**R2 对数据库 schema 零变更**，仅改变 JSON 内容；兼容性由 §8 策略保证。

---

## 11. 隔离测试矩阵（复制生产库到 /tmp 副本 + 独立端口 + break-glass 实测，跑完即删）

> 生产仅 2 名 `role_admin`，无法覆盖"按人"差异。测试须在 /tmp 副本**自建用户**：
> - u_admin（role_admin，po_approve）
> - u_op_approver（role_operator + 显式授予 po_approve，模拟被选中审批人）
> - u_other（role_operator，无 po_approve，模拟池外/无权人）

| 用例 | 场景 | 断言 |
|---|---|---|
| T1 | 配置 PO 流为 2 级具体用户（L1=u_op_approver, L2=u_admin），提交 PO | `approvers` 含两级 `approver_user_id`；`max_level=2` |
| T2 | u_op_approver 查"待我审批" | 仅其作为 L1 的 PO 可见；u_admin（L2）此刻不可见 |
| T3 | u_admin 查"待我审批"（current_level=1 时） | 不可见该 PO（非 L1 指定人） |
| T4 | u_admin 审批（current_level=1，非其节点） | N3 守卫→403，PO 状态不变 |
| T5 | u_op_approver 审批 L1 | 成功，current_level→2 |
| T6 | u_admin 审批 L2 | 成功，终态 approved，po_status/approval_status 正确 |
| T7 | u_other（无 po_approve）审批 | 入口 401/403（无 po_approve），即使知道 user_id 也不可批 |
| T8 | N4 保存校验：选 inactive 用户 / 无 po_approve 用户 / 空 / 重复 level | POST 400 拒绝；选合法 active+po_approve 用户 → 200 |
| T9 | 3 级配置驱动（L1/L2/L3 不同用户） | 逐级按 user_id 推进，均按人校验 |
| T10 | 禁用 flow（is_enabled=0）后提交 | 兜底原单级（N1 兜底分支）生效，不回归 |
| T11 | 端到端同 T1-T6 串联 | 状态机正确 |
| T12 | 回归：`/api/me` `/dashboard` `/skus` `/payment-requests` `/approval-flows` `/users` 均 200；付款审批链不受影响 |
| T13 | withdraw 不变（server.js:3753） | po_approve 用户可撤回，无节点校验（确认未顺手改规则） |
| T14 | 历史终态记录（16 approved 等） | 查询/展示正常，未被改写 |

---

## 12. 禁止触碰范围（明确红线）

- 不接 CC（CC V1 见下，仅记录）、不接飞书通知（归 FEISHU-NOTIFY-01）。
- 不进入 PUR-OPS-COLLAB-01 或其他系统管理模块。
- 不改付款审批链、采购链、盘点/入库/报废等其他业务审批。
- 不重构审批状态模型（po_status/approval_status 不动）。
- 不重构权限模型（菜单 perm、requireApiPermission 体系、`roles` 表不动；被选中审批人**不自动赋权**，须先经角色管理获 po_approve）。
- 不新增通用审批引擎（金额/分支/并行/会签/或签/代理）。
- 不改 withdraw 规则（其历史越权问题单独记录，不修）。
- 不回滚、不重写 M1/M2/M3；本补正为其最小增量（N1-N5）。
- 未经确认绝不迁移正式数据库；测试仅用 /tmp 隔离副本，生产零污染。

### 12.1 CC V1 锁定为后续子阶段（不得丢失 / 不得改写为"已取消"）
- 实现范围：提交选抄送人（系统用户）、存实例 CC（建议落点 `approval_records.cc_list`，但**本轮不加**）、详情展示、测试可用你的飞书账号对应系统用户（`user_1784266196210_yqwf3c`，`feishu_open_id=ou_0f234f74ac3954da65bb3ca0592d45d9`）作 CC。
- 不包含：飞书通知 / 自动抄送规则 / 抄送中心 / 已读状态 / 条件抄送。
- 飞书通知统一归 **FEISHU-NOTIFY-01**。
- 顺序：本补正（配置+执行闭环）验收后，再进入 CC V1，最后 FEISHU-NOTIFY-01。

### 12.2 withdraw 历史权限债务（单独记录）
"任意持 po_approve 用户可撤回他人 PO" 为既有行为，本轮刻意不改以避免顺手变更规则；列为独立待办，未来如需"仅提交人可撤回"须单独决策，不在 SYS-MGMT-APPROVAL-01 补正内。

---

## 13. 当前动作边界确认
- ✅ 已完成：只读复核（含 production 0 pending 实例核实、req.currentUserId 来源、users/roles 结构）+ 本 R2 方案输出。
- ⛔ 未做且本阶段不做：修改代码/库/页面/文档基线、重启本地服务、进入 CC/飞书/PUR-OPS-COLLAB-01/付款链/引擎/其他模块。
- ⏭️ 待你确认本 R2 后，再进入最小修改（N1-N5）→ 隔离测试（T1-T14）→ 报告。
