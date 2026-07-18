# SYS-MGMT-APPROVAL-01 · 架构验收补正方案

> 状态：**只读复核完成，方案待确认。本文件不修改任何代码/数据库/页面/文档基线。**
> 日期：2026-07-18
> 已落盘且保留的 M1/M2/M3：**不回滚、不重写**，本方案为其最小增量补正。
> 严守：不新增审批引擎 / 不接 CC / 不接飞书 / 不改付款审批链 / 不改采购链 / 不重构状态模型 / 不重构权限模型。

---

## 0. 复核结论速览（先给结论）

| 项 | 当前实际 | 已确认目标 | 差距 | 是否本轮补正 |
|---|---|---|---|---|
| M2 待我审批过滤 | 按 `req.currentUserRole` 匹配 `approver_role`（**按角色**） | 当前登录用户只看到自己要审的节点（**按人**） | 角色≠人；同角色多人会互相看见 | ✅ 补正（1a 方案） |
| M1 approve 守卫 | 仅 `po_approve` 权限，不校验当前级次 `approver_role` | 配置真正影响执行（非配置角色不能批） | 非节点角色持 `po_approve` 可越权审批（L1 未闭环） | ✅ 补正（PO 入口加节点匹配） |
| L2 配置/权限错配 | `role_operator` 可配为审批人，但无 `po_approve`、无审批中心菜单权限 | 配置看似成功、实际可执行 | 配了也进不去/批不了 | ✅ 推荐 Plan A（后端校验），Plan B 越界不纳入 |
| CC V1 | 未实施 | 保留为后续子阶段 | — | 🔒 仅记录，本阶段不实施（见第四节） |

---

## 一、M2 "按人过滤" 复核（当前是按角色，不是按人）

### 1.1 是否保存了具体 `approver_user_id`？
**结论：目前完全没有。**
- `approval_flows.levels`（db.js:294，TEXT JSON）实际形态（库内核实）：
  `[{"level":1,"name":"一级审批","approver_role":"role_operator"},{"level":2,"name":"二级审批","approver_role":"role_admin"}]`
  → 每级仅 `level / name / approver_role`，**无用户维度**。
- `approval_records.approvers`（提交时写入，server.js:3698-3702，M1 改写后）：
  `[{level, approver_role, approver_name}]`，**无 `approver_user_id`**。
- 无独立 `approval_instances` 表；`approval_records` 即实例，亦无用户字段。

### 1.2 审批流配置页是否能选具体用户？
**结论：配置页是纯只读展示，既不能选角色也不能选用户。**
- `renderApprovalFlows` / `loadApprovalFlows`（app.js:650-660）仅 `JSON.stringify(f.levels)` 打印成表格，**无任何编辑器、无下拉、无保存按钮**。
- 菜单权限 `system_config`（app.js:179），但页面本身无写能力；`levels` 实际靠库直改或 `POST /api/approval-flows`（server.js:1004）upsert。
- 全前端 grep `approver_role`/`roleSelect` 无编辑器代码。

### 1.3 用户表 / 角色表 / 飞书映射如何关联？
- `users`（db.js:93-103 基础 + 105-115 Feishu 扩展）：`id, role_id, feishu_open_id, feishu_union_id, feishu_user_id, status, auth_source`。
- `roles`（db.js:81-88）：`id, permissions(JSON)`。
- 关联链：`users.role_id → roles.id`；"某角色下有哪些人"= `SELECT id,name FROM users WHERE role_id = ? AND status='active'`；飞书通知未来用 `users.feishu_open_id`（已在表，当前零使用）。

### 1.4 不重构引擎、实现"真正按人过滤"的最小方案
**推荐方案 1a（materialize，最小且无引擎改动）：**
1. **提交时把角色解析为具体用户**（server.js:3698-3702 改写处）：每级除保留 `approver_role` 外，新增 `approver_user_ids = [该 role 下 status='active' 的 user.id...]`。
   - 沿用现有 `queryOne` 风格：`SELECT id FROM users WHERE role_id = ? AND status='active'`。
   - `approvers` 形态变为 `{level, approver_role, approver_name, approver_user_ids:[...]}`，**向后兼容**（旧字段保留）。
2. **M2 过滤改为按人**（server.js:3493-3502）：当前级次节点命中条件改为 `node.approver_user_ids.includes(req.currentUserId)`；若某级无 `approver_user_ids`（旧数据兜底）则回落 `node.approver_role === req.currentUserRole`。
3. **语义自洽**：同角色多人均在 `approver_user_ids` 内 → 全部可见（这是"角色池"语义）；**任意一人审批后 `current_level` 推进（server.js:3739-3744）→ 其余人因级次不再匹配、M2 过滤自然不再命中 → 他人待办自动消失**。此"消失"由现有级次推进机制免费实现，**无需引入 claim/抢占引擎**。

**为什么 1a 已是"按人"而非"按角色"**：过滤键是 `req.currentUserId`（具体人），而非 `req.currentUserRole`（角色）。即使未来某级只配 1 人，也由 `approver_user_ids` 精确定位。

**边界声明（必须写进实施报告）**：
- 1a 实现的是"**角色池 + 按人可见 + 任一批转推进**"。若业务要的是"**严格单人指派 + 抢占式 claim**（谁先点谁独占、他人永不显示），那需要指派/抢占规则 = 审批引擎改动，**超出本轮禁止项，不纳入**。
- 当前库仅 2 名 `role_admin`，1a 下表现与"按人"一致；但方案必须面向"多 operator 共存"的真实场景设计，不能依赖当前巧合。

### 1.5 若业务实质是"角色池审批"——必须如实说明
若最终决定维持纯角色池（不 materialize 到人），则：
- **M2 必须正名为"按当前用户所属角色过滤"**，严禁在文档/汇报中称"按人过滤"。
- **同角色多人谁审批**：任一持该角色且具 `po_approve` 者可批；审批后级次推进，其余人待办经 M2 级次过滤消失。
- **其他人待办如何消失**：不靠 claim，靠 `current_level` 推进后级次不匹配。
- 此模式要求所有池成员都持有 `po_approve`（否则有人看不见/批不了 → 见 L2）。

---

## 二、M1 "配置真正生效" 复核（approve 守卫未闭环 = L1）

### 2.1 approve/reject 是否校验当前级次 `approver_role`？
**结论：完全不校验。**
- 入口 `server.js:3725`：`requireApiPermission('po_approve')` 是**唯一**守卫。
- `approve`（3738-3748）、`reject`（3749-3752）、`withdraw`（3753-3756）内部仅读取 `approval.current_level/max_level`，**无任何 `approver_role` / `approver_user_id` 匹配判断**。

### 2.2 非当前节点角色、但持 `po_approve` 的用户能否审批？
**结论：能。** 代码上只要 `po_approve` 即可对任意级次执行 approve/reject，与 `approval_flows` 配置的 `approver_role` 无关。当前库内两人皆 `role_admin`（都有 `po_approve`），此越权被巧合掩盖；一旦存在"有 `po_approve` 但非该级配置角色"的用户，即可越级审批。

### 2.3 最小补正方案（闭环 L1，严守禁止项）
**仅在 PO 审批 `approve` / `reject` 入口增加"当前节点匹配校验"：**
- **落点**：`server.js` 的 `approve` 分支（3738 之前）与 `reject` 分支（3749 之前），在 `approval` 加载后、写库前插入守卫。
- **逻辑**：
  ```
  const cur = (JSON.parse(approval.approvers||'[]')).find(a => a.level === approval.current_level);
  const ok = cur && (
    (cur.approver_user_ids && cur.approver_user_ids.includes(req.currentUserId)) ||
    (cur.approver_user_ids == null && cur.approver_role === req.currentUserRole)
  );
  if (!ok) return res.status(403).json({ error: '当前用户不是该审批节点的审批人' });
  ```
- **严守边界**：
  - 不改 `approval_status` / `po_status` 状态模型（只加一个 403 早返）。
  - 不重构审批引擎（仅复用已解析的 `approvers` JSON）。
  - 不影响付款审批链（`requireApiPermission('payment_approve')` 的付款接口完全不动）。
  - 不扩大至其他业务类型（只改 `business_type='po'` 的 `approve` 端点；付款/盘点/入库等走各自状态位，本轮不碰）。
- 与 1a 协同：1a 落地后 `approver_user_ids` 存在 → 守卫优先按人；旧数据无 `approver_user_ids` → 回落按角色（兼容）。

### 2.4 withdraw 是否需要相同校验？
**结论：不加，保持现状（仅 `po_approve`），以避免改变既有规则。**
- 现有语义：撤回（`withdraw`）由 `po_approve` 守卫（server.js:3753），内部不校验提交人/节点角色。
- 用户指令"不得顺手改变规则"：撤回本质是**提交人取回**，但当前代码从未校验"必须是提交人"。若补正阶段新增"仅提交人可撤回"，属规则变更，越界。
- **处置**：`withdraw` 维持仅 `po_approve`，**不**加节点角色校验、也**不**加提交人校验。若未来要明确"仅提交人可撤回"，列为独立规则变更，不在本补正范围。
- 既知局限（写入报告）：任意 `po_approve` 用户可撤回他人 PO，与 M1 守卫补正形成不对称——属历史债务，本轮不修。

---

## 三、L2：配置角色与权限错配（最小处理对比）

**现象**：`approval_flows` 可把 `role_operator` 配为审批人，但 `role_operator` **无 `po_approve`**（roles 权限 JSON 核实），且审批中心菜单 perm = `po_approve`（app.js:158）→ 运营人员既看不到审批中心、也调不动 `approve` 接口。配置"成功"但不可执行。

### 方案 A：配置页只允许选"具备 PO 审批权限的角色" + 后端保存校验
- **落点（后端，最小）**：`POST /api/approval-flows`（server.js:1004-1011）在 upsert 前，遍历 `d.levels`，对每个 `approver_role` 校验其角色 `permissions` 含 `po_approve`；不含则 `400` 拒绝。前端编辑器（若后续建）同理只列出含 `po_approve` 的角色。
- **现有权限架构角度**：纯增量校验，不新增权限键、不改菜单门槛、不动 `requireApiPermission` 体系。✅ 兼容。
- **最小改动角度**：仅 ~6 行后端校验；前端无需改（当前只读页本来就不能选）。
- **上线风险角度**：低。仅阻止无效配置，不改动运行时。⚠️ 副作用：若业务希望"运营人员审一级"，A 会**禁止**该配置——因为 operator 无 `po_approve`。这实质把"operator 能否审 PO"的决策交还给权限模型。
- **结论**：A 是**本轮唯一在禁止项内可落地的 L2 处理**。

### 方案 B：被配置节点的用户/角色，即使无通用审批中心权限，也获该节点最小查看+审批能力
- **实现必然触碰**：要么把菜单 perm `po_approve`（app.js:158）改为更宽权限（改权限模型，禁止）；要么新增节点级细粒度权限键（如 `po_approve_node`）并改造 `requireApiPermission` 与菜单渲染（= 权限模型重构，禁止）；要么在 `approve` 入口对"配置节点角色"做免 `po_approve` 放行（与 2.3 守卫方向冲突、且放大越权面）。
- **上线风险**：高（动权限模型/菜单/守卫，回归面大）。
- **结论**：B 在当前禁止项（不重构权限模型）下**不可纳入本轮**。若业务确需 operator 审一级，正确路径是**显式决策"给 role_operator 授予 po_approve"**（一次性权限调整，非引擎重构），由你单独拍板，不混入本补正。

### 三的推荐
**采用方案 A（后端保存校验）作为 L2 本轮最小处理**；B 所需的权限模型调整列为独立待办，需你明确授权后方可进行，不在 SYS-MGMT-APPROVAL-01 补正内实施。

---

## 四、CC V1 范围保留（不得丢失 / 不得改写为"已取消"）

> 本节为**记录与锁定**，本阶段**不实施**。CC V1 是 SYS-MGMT-APPROVAL-01 的**后续子阶段**，状态 = 待实施（非取消、非永久暂缓）。

**CC V1 实现范围（锁定）**：
- 提交审批时选择抄送人（从系统管理现有用户中选择，不新增账号体系）；
- 保存审批实例 CC（建议落点：`approval_records` 新增 `cc_list TEXT DEFAULT '[]'`，存 `user_id` 数组；不建独立表）；
- 审批详情展示 CC（`openApprovalDetail`，app.js:800）；
- 测试阶段可用你的飞书账号（`user_1784266196210_yqwf3c`，`feishu_open_id=ou_0f234f74ac3954da65bb3ca0592d45d9`）作为 CC 用户。

**CC V1 明确不包含（锁定）**：
- CC 规则模板 / 自动条件抄送 / 抄送中心 / 已读状态 / 飞书消息通知。
- 飞书通知统一归 **FEISHU-NOTIFY-01** 单列规划，不在本任务。

**与补正方案的关系**：本补正（一/二/三）不触碰 CC；CC V1 作为独立子阶段，将在本补正验收后、且 FEISHU-NOTIFY-01 规划前/后按既定顺序推进。任何文档/汇报不得将 CC V1 表述为"已取消"或"永久暂缓"。

---

## 五、补正方案精确落点 · 最小修改范围 · 测试矩阵 · 禁止触碰

### 5.1 精确代码落点（均为增量，不动 M1/M2/M3 既有结构）
| 编号 | 文件:行 | 改动 | 类型 |
|---|---|---|---|
| R1 | server.js:3698-3702（M1 提交段） | 每级解析 `approver_user_ids`（role→active users）；写入 `approvers` | 增量 |
| R2 | server.js:3493-3502（M2 过滤段） | 命中条件改为 `approver_user_ids.includes(req.currentUserId)`，旧数据回落角色 | 增量 |
| R3 | server.js:3738 / 3749（approve/reject 入口） | 增加当前节点匹配校验，不匹配→403 | 增量 |
| R4 | server.js:1004-1011（POST /api/approval-flows） | 保存前校验每级 `approver_role` 具 `po_approve`，否则 400 | 增量 |
| — | server.js:3753（withdraw） | **不改** | 保持 |

### 5.2 禁止触碰（明确红线）
- 不新增审批引擎 / 动态条件 / 金额规则；
- 不接 CC（见第四节，仅记录）/ 不接飞书；
- 不改 `approval_status` / `po_status` 状态模型；
- 不重构权限模型（菜单 perm、requireApiPermission 体系不动；B 方案不纳入）；
- 不改动付款审批链、采购链、盘点/入库/报废等其他业务审批；
- 不回滚、不重写 M1/M2/M3。

### 5.3 隔离测试矩阵（复制生产库到 /tmp 副本 + 独立端口 + break-glass 实测，跑完即删）
| 用例 | 场景 | 断言 |
|---|---|---|
| T1 | 2 级配置 + 提交 PO | `approvers` 含两级 `approver_user_ids`；`max_level=2` |
| T2 | 同角色多用户（造 1 个 `role_admin` 测试用户）提交 PO | "待我审批"：仅 `approver_user_ids` 内用户可见；池外用户不可见 |
| T3 | 节点角色用户审批 | 当前级次 `approver_user_id` 命中 → approve 成功、级次推进 |
| T4 | 非节点角色但持 `po_approve` 用户审批 | R3 守卫 → 403，PO 状态不变 |
| T5 | 节点角色但无 `po_approve`（模拟 operator 配一级）审批 | 入口 `po_approve` 即拦（证实 L2 需 A 或权限决策） |
| T6 | 后端保存校验 R4 | 配 `role_operator`（无 po_approve）为审批人 → POST 400；配 `role_admin` → 200 |
| T7 | 旧数据兼容 | 无 `approver_user_ids` 的 `approvers` → M2 回落角色、R3 回落角色 |
| T8 | end-to-end | 逐级审批至 `approved`，`po_status/approval_status` 正确 |
| T9 | 回归 | `/api/me` `/dashboard` `/skus` `/payment-requests` `/approval-flows` 均 200；付款审批链不受影响 |
| T10 | withdraw 不变 | `po_approve` 用户可撤回，无节点校验（确认未顺手改规则） |

### 5.4 文档更新
- 既有 `SYS-MGMT-APPROVAL-01-IMPL-REPORT-20260717.md` 的"L1 未闭环"改为"已由 R3 闭环"；M2 描述由"按角色过滤"更正为"按人（角色池 materialize）过滤"。
- 新增本文件 `SYS-MGMT-APPROVAL-01-ARCH-RECTIFY-PLAN-20260718.md` 为补正基线。

---

## 六、当前动作边界确认
- ✅ 已完成：只读复核三缺口 + 库内数据核实 + 本方案输出。
- ⛔ 未做且本阶段不做：修改代码/库/页面/文档基线、重启本地服务、进入 PUR-OPS-COLLAB-01 或其他新任务。
- ⏭️ 待你确认本方案后，再进入最小修改（R1-R4）→ 隔离测试（T1-T10）→ 报告。
