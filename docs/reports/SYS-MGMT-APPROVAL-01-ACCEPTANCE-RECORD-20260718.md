# SYS-MGMT-APPROVAL-01 · R2 验收记录

> 验收日期：2026-07-18
> 验收对象：R2 实施成果（N1–N5 最小增量补正，基于已落盘的 M1/M2/M3）
> 验收纪律：隔离测试账号 + 隔离数据库副本 + 独立端口；**生产库零改动**；**未 commit / push / deploy**
> 验收结论：**26 项断言全部通过（26/26），R2 实施满足本轮架构与范围要求，建议进入下一阶段**

---

## 一、验收范围与测试方法

按用户确认的 4 个验收点，构建隔离测试账号，在隔离数据库副本（生产库 `data/inventory.db` 复制）上以独立端口启动服务，跑真实端到端 HTTP 调用，断言后端行为。

- 隔离库路径：`/tmp/inv_accept.db`（运行后已清理，生产库未触碰）
- 服务端口：3213（与生产 3001 隔离）
- 会话方式：为隔离测试账号注入真实 session（代表已登录用户），聚焦审批逻辑，绕过密码脚手架
- 未做：生产库写入、前端浏览器点击（页面依赖的后端契约已逐项验证 + 源码 inspected）、服务重启/部署

### 隔离测试账号建模（仅存在于隔离库）

| 账号 | 姓名 | 角色 | po_approve | 在审批流中的职责 |
|---|---|---|---|---|
| `user_admin`（既存） | 超级管理员 | `role_admin` | ✅ | 配置者（system_config）+ 越权拦截被测对象 |
| `u_a`（新增） | 审批人A | `role_test_approver` | ✅ | 一级（L1）指定审批人 |
| `u_b`（新增） | 审批人B | `role_test_approver` | ✅ | 二级（L2）指定审批人（**与 u_a 同一角色**，用于证明"按人非按角色"） |
| `u_v`（新增） | 查看人V | `role_test_viewer` | ❌ | 无审批权限，用于验证权限守卫仍生效 |

> 关键设计：`u_a` 与 `u_b` 绑定**同一角色** `role_test_approver`。若实现是按角色过滤，则 u_b 在 L1 阶段也应看到待办；实测 u_b 看不到 → 证明确为"按具体用户"过滤。

---

## 二、验收点逐项结果

### 验收点 1 · PO 审批配置页面（配置具体审批人）

| 编号 | 验证项 | 结果 |
|---|---|---|
| A1.1 | `GET /api/approval-flows` → 200，含 `flow_po`（旧 `approver_role` 结构 `level1=role_operator / level2=role_admin`） | ✅ |
| A1.2 | `GET /api/approval-candidates` → 返回具备 `po_approve` 的 active 用户（含 u_a/u_b/admin），**不含**无权限的 u_v | ✅ |
| A1.3 | `POST /api/approval-flows` 以具体用户保存（L1=u_a, L2=u_b）→ 200 | ✅ |
| A1.3a | 配置落地为 `approver_user_id` 结构：`[{level:1,approver_user_id:'u_a',approver_name:'审批人A',approver_role_id:'role_test_approver'},{level:2,approver_user_id:'u_b',...}]` | ✅ |
| A1.4 | 选无 `po_approve` 的 u_v 当审批人 → **400**（后端重校验权限，不信任前端） | ✅ |
| A1.5 | 提交重复级次 → **400** | ✅ |
| A1.6 | 提交空审批人 → **400** | ✅ |
| A1.7 | 前端伪造 `approver_name:'黑客X'` / `approver_role_id:'role_admin'` → 后端用真实数据覆盖（落库名仍为"审批人A"/`role_test_approver`） | ✅ |
| A1.8 | 无 `system_config` 的用户（u_a）保存配置 → **403** | ✅ |

**结论**：审批流管理页所需的后端契约全部满足——查看流程、候选用户下拉（仅 po_approve）、保存具体审批人、后端强制重校验（用户存在/active/角色含 po_approve/级次连续/忽略前端伪造）。前端页面（`renderApprovalFlows` 等 7 个函数，见实施报告）即调用上述接口，配置能力已具备。（页面级 UI 交互建议用户在本地 3001 做最终视觉点击验收。）

### 验收点 2 · 配置具体审批人后提交 PO

| 编号 | 验证项 | 结果 |
|---|---|---|
| A2.1 | 管理员配置后提交草稿 PO → `submit-approval` 返回 200 | ✅ |
| A2.2 | 审批实例快照写入具体用户：`max_level=2`，`approvers=[{level:1,approver_user_id:'u_a',...},{level:2,approver_user_id:'u_b',...}]`，含 `approver_name`/`approver_role_id` 快照 | ✅ |
| A2.3 | PO 状态推进为 `po_status='pending_approval'` / `approval_status='pending'` | ✅ |

**结论**：PO 提交时从启用配置生成**具体审批用户快照**，审批责任主体为 User 而非 Role。

### 验收点 3 · 一级 / 二级审批节点流转

| 编号 | 验证项 | 结果 |
|---|---|---|
| A3.1 | L1 指定人 u_a 在「待我审批」可见该 PO（1 条） | ✅ |
| A3.2 | u_a 审批 L1 → 200 | ✅ |
| A3.3 | 级次推进至 `current_level=2`，实例仍 `pending` | ✅ |
| A3.4 | L2 指定人 u_b 在「待我审批」可见该 PO（1 条） | ✅ |
| A3.5 | u_b 审批 L2 → 200 | ✅ |
| A3.6 | 终态：审批实例 `approved`，PO `po_status='approved'` / `approval_status='approved'` | ✅ |

**结论**：多级审批按配置的级次顺序逐级流转，终态正确联动 PO 状态。

### 验收点 4 · 非指定用户无法看到和审批

| 编号 | 验证项 | 结果 |
|---|---|---|
| A4.1 | **同角色**非指定人 u_b（L2）在 L1 阶段「待我审批」**不可见**（0 条） → 证明"按人非按角色" | ✅ |
| A4.2 | 非指定人 u_b 尝试审批 L1 → **403**（"您不是当前审批级次的指定审批人"） | ✅ |
| A4.3 | 有 `po_approve` 但未指定的 admin 尝试审批 L1 → **403** | ✅ |
| A4.4 | 无 `po_approve` 的 u_v 访问待审批列表 → **403**（权限守卫仍生效） | ✅ |
| A4.5 | 「全部待审批」（无 `mine`）admin 可见该 PO → `mine=1` 不影响"全部"页 | ✅ |
| A4.6 | L1 通过后，前审批人 u_a 在「待我审批」不再可见 | ✅ |
| A4.7 | L1 通过后，L2 指定人 u_b 在「待我审批」可见 | ✅ |

**结论**：审批责任严格绑定到当前级次配置的 `approver_user_id`；非指定人（含同角色、含持 po_approve 但未指定者）既不能看到也不能审批；前审批人级次推进后自动出列；"全部待审批"不受 `mine` 过滤影响。

### 回归

| 编号 | 验证项 | 结果 |
|---|---|---|
| A5.1 | `GET /api/purchase-orders`（含历史终态） → 200，29 条 | ✅ |

---

## 三、精确代码位置（R2 实施落点）

| 能力 | 位置 | 守卫/校验 |
|---|---|---|
| 配置读取（候选下拉） | `server.js:1049` `GET /api/approval-candidates` | `requireApiPermission('system_config')` |
| 配置保存（具体用户 + 后端重校验） | `server.js:1004` `POST /api/approval-flows` | `system_config`；用户存在/active/角色含 po_approve/级次连续/忽略前端伪造（1009–1040） |
| 配置读取（页面展示） | `server.js:1001` `GET /api/approval-flows` | `system_config` |
| PO 提交生成具体用户快照 | `server.js:3737` `submit-approval` + 3743–3785 | `po_create`；提交时重校验每级用户仍有效；无有效配置→400 拒绝（不回退角色池） |
| 待我审批按人过滤 | `server.js:3519` `pending-approval` + 3546–3556 | `po_approve`；`?mine=1` 时按 `req.currentUserId` 匹配当前级次 `approver_user_id` |
| PO 审批双重校验 | `server.js:3790` `approve` + 3802–3820 | `po_approve` + 实例可审 + 级次有效 + `curNode.approver_user_id===req.currentUserId`（否则 403）；`withdraw` 不加节点校验 |
| 前端配置页 | `app.js` `renderApprovalFlows` 及编辑器函数（同实施报告 N5） | 调用上述 3 个接口 |

---

## 四、生产数据库零污染证据

验收结束后只读核验生产库 `data/inventory.db`：

- 用户数：**2**（仅 `user_admin` / `user_1784…洪子锋James`，无测试账号残留）
- 测试角色数：**0**（无 `role_test_*` 残留）
- 待审批 PO：**0**
- `flow_po` 配置：仍为旧结构 `[{level:1,approver_role:'role_operator'},{level:2,approver_role:'role_admin'}]`，**未改动**（待管理员上线后用新 UI 重配为具体用户）
- 隔离测试副本 `/tmp/inv_accept.db` 及所有临时脚本已清理；端口 3213 无残留进程

---

## 五、已知局限与未实施项（均按冻结约定，非本轮越界）

1. **CC V1**：已确认作为后续子阶段，本轮未实施（不改写为"已取消"）；范围=提交选抄送人（系统用户）/ 存实例 CC / 详情展示 / 测试可用你的飞书账号；不含飞书通知、自动抄送规则、抄送中心、已读。
2. **飞书审批通知（FEISHU-NOTIFY-01）**：未实施，归独立规划。
3. **PUR-OPS-COLLAB-01（采购运营协同闭环）**：仅需求记录，未实施。
4. **withdraw 历史权限债务**：`withdraw` 本轮保持现状（仅 `po_approve` 守卫），其"任意 po_approve 可撤回他人"为历史债务，已单独记录、不修。
5. **L2 权限决策**：审批配置改为选具体用户后，若需某运营人员成为审批人，应通过角色管理显式授予其 `po_approve`，再在配置中选择——不自动赋权。此为用户后续权限决策，未在本轮自动处理。

---

## 六、上线须知（部署前必做）

1. 部署新代码、**提交任何新 PO 前**，管理员须用新「审批流管理」页为 `flow_po` 各级选择**具体系统用户**并保存启用。
2. 正式库 `flow_po` 当前仍是旧 `approver_role` 结构，新代码提交时会因"无法解析具体 approver_user_id"而**拒绝提交（400）**——此为设计意图（避免静默退回角色池），非缺陷。
3. 验证清单（建议本地 3001 最终视觉验收）：重配 PO 审批流 → 提交 PO → 按人审批 → 越权拦截 → 逐级流转终态。

---

## 七、验收结论

本轮 R2 实施在隔离环境通过 **26/26** 项断言，覆盖用户确认的全部 4 个验收点（配置页面/提交/多级流转/越权拦截）及回归。生产库零污染，未执行 commit/push/deploy。

**建议：R2 实施验收通过，可进入下一阶段**（按既定顺序：CC V1 子阶段 → FEISHU-NOTIFY-01；或用户指定的其他收敛项）。
