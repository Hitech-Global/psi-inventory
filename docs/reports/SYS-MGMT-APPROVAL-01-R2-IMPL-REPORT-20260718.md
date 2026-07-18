# SYS-MGMT-APPROVAL-01 · R2 实施报告（N1–N5 最小增量补正）

> 执行日期：2026-07-18
> 范围：在已验收的 M1/M2/M3 基础上，按《SYS-MGMT-APPROVAL-01-ARCH-RECTIFY-PLAN-R2-20260718》实施 N1–N5。
> 纪律：最小修改 → node --check → 隔离数据库测试 → 权限/越权专项 → 采购链回归 → 代码自审 → 本报告。
> 零生产库污染、未 commit/push/deploy。

---

## 1. 实际修改文件与精确位置

| 文件 | 位置 | 改动 |
|---|---|---|
| `server.js` | `POST /api/approval-flows`（约 1004–1046） | N5 后端：不可信前端姓名/角色，按 `approver_user_id` 从 DB 重读并校验（存在/active/已绑角色/po_approve/级次连续/非空），写入真实快照 |
| `server.js` | 新增 `GET /api/approval-candidates`（约 1048–1062） | N5：返回具备 `po_approve` 的 active 系统用户（id/name/username/role_id/role_name），供配置页下拉；`system_config` 守卫 |
| `server.js` | `GET /api/purchase-orders/pending-approval`（约 3492–3503） | N3：「待我审批」由按角色过滤改为按 `req.currentUserId` 匹配当前级次 `approver_user_id`；旧缺 `approver_user_id` 的实例不进入「待我审批」 |
| `server.js` | `POST /api/purchase-orders/:id/submit-approval`（约 3743–3778） | N1/N2：读取启用配置生成「具体审批用户」快照；提交时重校验每级用户仍有效；无有效配置则拒绝提交（不回退角色池兜底） |
| `server.js` | `POST /api/purchase-orders/:id/approve`（约 3790–3820） | N4：仅 PO 入口增加 `approve/reject` 双重校验（实例可审 + 当前级次有效 + 节点 `approver_user_id === req.currentUserId`）；`withdraw` 保持历史现状 |
| `app.js` | `renderApprovalFlows` / `loadApprovalFlows` 及新增 7 个函数（约 650–735） | N5 前端：审批流管理页由只读 JSON 改为最小可编辑界面（级次增删/上下移/用户下拉/启停/保存） |

改前副本：`.backup-approval01-r2/server.js`、`app.js`。

---

## 2. `approval_flows.levels` 最终结构（配置模板）

```json
[
  { "level": 1, "approver_user_id": "u_a", "approver_name": "审批人A", "approver_role_id": "role_test_approver" },
  { "level": 2, "approver_user_id": "u_b", "approver_name": "审批人B", "approver_role_id": "role_test_approver" }
]
```

- `approver_user_id`：审批责任判断**唯一主键**。
- `approver_name` / `approver_role_id`：保存时由后端从 `users`/`roles` 重读的**快照**，仅展示辅助；前端提交的这两个字段被**忽略**。
- 级次必须连续（1,2,3…）、无重复/缺漏；每级一名具体系统用户。
- **表结构未变**（仍是 `levels` TEXT JSON 列），零 schema 变更。

---

## 3. `approval_records.approvers` 最终结构（审批实例快照）

提交时从配置复制，结构同上：

```json
[
  { "level": 1, "approver_user_id": "u_a", "approver_name": "审批人A", "approver_role_id": "role_test_approver" },
  { "level": 2, "approver_user_id": "u_b", "approver_name": "审批人B", "approver_role_id": "role_test_approver" },
  { "level": 3, "approver_user_id": "user_admin", "approver_name": "超级管理员", "approver_role_id": "role_admin" }
]
```

- `max_level` = 配置级次数；`current_level` 从 1 推进。
- 不再使用旧的 `approver_role` / `approver_id` 字段作责任判断。

---

## 4. 后端配置校验（不可信前端）

`POST /api/approval-flows` 保存前逐一校验，任一不满足返回 400：
1. 用户存在；2. 状态 `active`；3. 已绑定有效角色；4. 该角色 `permissions` 含 `po_approve`；5. 审批人非空；6. 级次连续无重复/缺漏；7. 级次从 1 开始；8. 丢弃前端伪造的 `approver_name` / `approver_role_id`，由后端写入真实值。

提交时（`submit-approval`）再次校验每个配置用户仍有效，配置失效则拒绝提交并提示先修正配置。

---

## 5. 「待我审批」按人过滤证据（隔离测试 T7）

| 场景 | 结果 |
|---|---|
| `u_a`（L1 指定审批人）`?mine=1` | ✅ 可见 `po_t1` |
| `u_b`（L2，当前为 L1）`?mine=1` | ❌ 不可见 `po_t1` |
| `admin`（L3，当前为 L1）`?mine=1` | ❌ 不可见 `po_t1` |

结论：仅当前级次 `approver_user_id === req.currentUserId` 的用户可见，实现真正的「按人过滤」，不再按角色。

---

## 6. approve/reject 越权拦截证据（隔离测试 T8 / T13b）

| 场景 | 结果 |
|---|---|
| `u_b` 审批 L1（指定人为 `u_a`） | ❌ 403「您不是当前审批级次的指定审批人，无权审批」 |
| `admin` 审批 L1（指定人为 `u_a`） | ❌ 403（即便有 `po_approve`） |
| `u_v`（无 `po_approve`）审批 | ❌ 403（权限门禁） |
| 指定审批人已禁用 → 提交 | ❌ 400「审批用户已停用」 |
| 指定审批人无 `po_approve` → 提交 | ❌ 400「角色不具备 po_approve 权限」 |

结论：拥有 `po_approve` 但非当前节点指定审批人者，无法审批（封闭 L1 越权缺口）。

---

## 7. 审批流管理页面结构说明（无浏览器截图，附结构）

`renderApprovalFlows` 渲染为每张审批流一张卡片：
- **PO 类型（可编辑）**：标题 + 「启用」勾选；每个级次一行（`第 N 级` + 用户下拉（仅 `po_approve` 的 active 用户）+ ↑/↓ 调整顺序 + ✕ 删除）；底部「＋ 添加审批级次」「💾 保存」。
- **非 PO 类型**：只读展示 `levels` JSON。
- 保存调用 `POST /api/approval-flows`，前端预校验级次连续/非空后提交；后端再次全量校验。
- 复用既有 `api` / `esc` / `showToast` / `showFlash` / `btn` 样式，零新增 CSS。

> 说明：本环境无浏览器自动化，页面逻辑经语法检查（`node --check app.js` 通过）与既有 helper 复用验证，未做像素级截图；建议本地页面验收（见第 12 节）。

---

## 8. 隔离测试逐项结果（T1–T15，共 51 断言，51/51 通过）

环境：复制生产库到 `/tmp/inv_r2_test.db` + 独立端口 3212 + 真实会话（测试用户经隔离库直注 session）。**正式库零写入**。

| 编号 | 项目 | 结果 |
|---|---|---|
| T1 | 候选审批人仅含 `po_approve` 用户（含 `admin`/`u_a`/`u_b`，不含 `u_v`） | ✅ |
| T2 | PO 审批流配置新结构（`approver_user_id=u_a`，3 级） | ✅ |
| T3 | 保存：审批人无 `po_approve` → 400 | ✅ |
| T4 | 保存：重复级次 / 非连续 / 空审批人 → 400 | ✅ |
| T5 | 合法保存成功；后端忽略伪造姓名、写入真实角色 | ✅ |
| T6 | 提交生成具体用户快照（`max_level=3`、`current_level=1`、含 `approver_user_id`） | ✅ |
| T7 | 「待我审批」按人过滤（见第 5 节） | ✅ |
| T8 | 非指定审批人 / 无权限 → 403（见第 6 节） | ✅ |
| T9 | 指定人 L1 审批→推进 L2；L1 不再可见、L2 可见 | ✅ |
| T10 | 逐级审批至终态，`po_status=approved` | ✅ |
| T11 | 驳回 → PO 退回 `draft` | ✅ |
| T12 | `withdraw` 行为保持现状（不校验节点） | ✅ |
| T13 | 审批人被禁用 → 提交 400 | ✅ |
| T13b | 指定人无 `po_approve` → 提交 400 | ✅ |
| T14 | 历史终态 PO 可查看；新 PO 进入「全部待审批」 | ✅ |
| T15 | 回归：`/api/skus`、`/api/payment-requests/pending`、`/api/me`、`/api/roles`、`/api/users` 均 200 | ✅ |

附加约束验证（用户指定）：同角色 A/B 仅指定人 A 可见可审、B 403；admin 非指定亦 403；一级完成后二级才可见；全部列表无回归；withdraw 不变；历史记录可查；普通采购/付款/认证/权限接口无回归——全部满足。

---

## 9. 回归测试结果

- 采购链：`submit-approval` → `approve`（逐级）→ 终态流程正常；`reject`/`withdraw` 不变。
- 付款审批链：未触碰（仅 PO 审批入口加校验），`/api/payment-requests/pending` 回归 200。
- 认证/权限：`/api/me`、`/api/roles`、`/api/users`、登录均 200；`withdraw` 历史权限问题未改。
- 状态模型：`po_status` / `approval_status` / `approval_records.status` 三态口径未重构。

---

## 10. 正式数据库零污染证据

只读核验结果：
- 正式库用户数 = 2（无 `u_a`/`u_b`/`u_v` 等测试用户）；
- 正式库 `pending` PO 审批实例 = 0（无需迁移）；
- 正式 `flow_po` 配置保持旧结构未动（待管理员用新 UI 重配，见第 11 节）；
- 测试进程（端口 3212）已退出，无残留监听；
- 测试脚本与副本（`/tmp/inv_r2_test.*`）已删除。

---

## 11. 未实施项与已知风险

**未实施（按冻结约定，本轮不做）：**
- **CC V1**：提交选抄送人、存实例 CC、详情展示——锁定为后续子阶段，不改写为「已取消」。
- **飞书通知（FEISHU-NOTIFY-01）**：不在本任务。
- **PUR-OPS-COLLAB-01**（采购运营协同闭环）：仅需求记录，未实施。
- **付款审批链 / 其他业务审批 / 通用审批引擎 / 正式角色权限 / 用户账号体系 / 飞书登录逻辑 / DB schema / 历史终态实例**：均未触碰。

**已知风险 / 上线须知：**
1. **⚠️ 部署后必须先用新 UI 重配 PO 审批流**：正式 `flow_po` 目前仍是旧 `approver_role` 结构。新代码要求 `approver_user_id`，因此**部署后、提交任何新 PO 前**，管理员须进入「系统管理 → 审批流管理」为 PO 审批流每一级选择具体系统用户并保存（启用）。在此之前提交 PO 会被拒绝（提示先完成配置）——这是设计意图（配置必须落到具体用户），非缺陷。
2. **withdraw 历史越权问题单独记录、本轮未修**：`withdraw` 仍仅校验 `po_approve`，任意具权用户可撤回他人审批（历史债务，按冻结约定不顺手改）。
3. **L2 角色/权限错配**：运营人员要成为审批人，应通过角色管理显式授予 `po_approve` 后再在配置中选择；本补正已用保存校验拦截「无 po_approve 用户被选为审批人」，不会自动赋权。

---

## 12. 是否建议进入本地页面验收

**建议进入本地页面验收。** 代码改动、`node --check`、隔离测试（51/51）均通过，后端行为已用真实会话验证。前端配置页逻辑经语法检查与既有 helper 复用验证，建议按以下路径做页面验收：

1. 启动 `node server.js`（3001）；
2. 系统管理 → 审批流管理 → 为 PO 审批流各级选择具体用户、启用、保存；
3. 提交一张 PO → 审批中心「待我审批」：仅被指定人可见；逐级审批至终态；
4. 用非指定人账号尝试审批 → 应被拒（403）；
5. 验证「全部待审批」不受 `mine` 影响、历史 PO 可查看。

> 注：CC V1 / 飞书通知 / PUR-OPS-COLLAB-01 按约定留待后续独立阶段。
