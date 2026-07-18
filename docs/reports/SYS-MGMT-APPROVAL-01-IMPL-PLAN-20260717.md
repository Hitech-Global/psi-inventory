# SYS-MGMT-APPROVAL-01 最小实施方案（待确认）

> 阶段：只读确认修改点已完成 → **本文件为实施方案，等待用户确认后**才进入最小修改 + 隔离测试 + 报告。
> 严守禁止项：不新增 CC / 不修改审批流程 / 不改付款采购审批链 / 不改审批状态机 / 不新增复杂审批引擎 / 不重构状态模型。

---

## 一、目标与范围（来自用户最新指令，已收敛）

### 修复①：审批流配置 → 执行脱钩
- 让现有 `approval_flows` 配置**真正影响 PO 审批执行**。
- PO 提交时读取 `approval_flows`（`business_type='po'` 且 `is_enabled=1`）的 `levels` / `approver_role`。
- 管理员在审批流管理页修改「级次数量 / 审批角色」后，**新提交的 PO 立即按新配置生效**。
- 保留 `approval_flows` 现有表结构，不增删列。

### 修复②：待我审批按当前用户过滤
- 修复当前「待我审批 = 全部待审批」问题。
- 当前登录用户仅看到**自己负责审批的当前级次**节点。
- 不修改任何审批状态流转。

### 暂缓（明确不做）
- CC 抄送（等飞书通知体系统一设计）
- 飞书审批通知（单列 FEISHU-NOTIFY）
- `approval_status` / `po_status` / `approval_records` 三态模型重构

---

## 二、现状事实（已用 /tmp 只读副本核实）

| 项 | 事实 | 来源 |
|---|---|---|
| 配置匹配键 | `approval_flows.business_type='po'` → `flow_po`（已启用） | 只读查询 |
| 配置 levels 形态 | `[{level:1,approver_role:'role_operator'},{level:2,approver_role:'role_admin'}]` | 只读查询 |
| approver_role 含义 | 存的是**角色 id**（非具体人、非权限） | 只读查询 |
| 当前 submit 硬编码 | `max_level=2` 写死；`approvers=[{level:1,approver_id,approver_name}]` 仅 1 个审批人，**从不读配置** | server.js:3684-3685 |
| 状态机已支持 N 级 | approve 逻辑用 `current_level`+`max_level` 推进，本就支持任意级数 | server.js:3706-3725 |
| 当前用户角色上下文 | `req.currentUserRole = user.role_id`（apiAuth 已设） | server.js:308/320 |
| 前端提交 | `submitPO` 只传 `{submitter_name}`，不传 approver_id | app.js:5411 |
| 前端列表 | `loadApprovalCenterList` 调 `pending-approval` **不带任何参数**，mine/all 同数据 | app.js:730 |
| 前端详情 | `approvePO` 读 `approvers[].approver_name` 展示「当前/下一审批人」 | app.js:757-770 |

---

## 三、修改点清单（精确位置 + 拟改内容）

### 修改点 M1 — PO 提交读取审批流配置（核心修复①）
**文件**：`server.js`
**位置**：`app.post('/api/purchase-orders/:id/submit-approval', ...)` 内，替换 3678–3687 的 `approverId/approverName` 推导与 INSERT。

**拟改逻辑（伪代码）**：
```
flow = queryOne("SELECT * FROM approval_flows WHERE business_type='po' AND is_enabled=1 ORDER BY created_at LIMIT 1")
let maxLevel, approvers
if flow 且 levels 解析出 ≥1 级:
    maxLevel   = levels.length
    approvers  = levels.map(l => ({
        level: l.level,
        approver_role: l.approver_role,
        approver_name: (roles 表查 l.approver_role 的 name) || l.approver_role
    }))
else:
    // 兜底：无配置时保持原有单级行为，避免提交失败（不回归）
    approverId = req.body.approver_id || req.currentUserId
    maxLevel   = 2
    approvers  = [{ level:1, approver_id, approver_name }]
INSERT approval_records (... current_level=1, max_level=maxLevel, approvers=JSON.stringify(approvers) ...)
```
- **保留**：`current_level=1`、`po_status='pending_approval'`、`approval_status='pending'`、提交轨迹 history（原样）。
- **不动**：`approve/reject/withdraw`（server.js:3693–3728）逻辑原封不动 → 状态机零改动。
- **前端零回归**：`approvers` 仍含 `approver_name`（=角色名，如「运营人员/超级管理员」），`approvePO` 详情照常渲染。

### 修改点 M2 — 待我审批按人过滤（修复②）
**文件**：`server.js`
**位置**：`app.get('/api/purchase-orders/pending-approval', ...)`（3467–3494）。

**拟改**：在现有 SQL 查询后、返回前，增加 `?mine=1` 分支（JS 层过滤，不改 SQL、不改表）：
```
const mine = req.query.mine === '1'
let out = rows
if (mine) {
  out = rows.filter(r => {
    const approvers = safeParse(r.approvers) || []
    const cur = approvers.find(a => a.level === r.current_level)
    return cur && cur.approver_role === (req.currentUserRole || '')
  })
}
res.json(out)
```
- 仅按**当前待审级次**（current_level）的 `approver_role` 匹配当前用户角色。语义 = 「等我现在处理的节点」。
- 不改 `po_approve` 端点权限、不改任何写入、不改状态机。

### 修改点 M3 — 前端「待我审批」tab 传参（修复②前端侧）
**文件**：`app.js`
**位置**：`loadApprovalCenterList`（约 730 行）。

**拟改（单行级）**：
```
const q = _approvalTab === 'mine' ? '?mine=1' : ''
const data = await api('/api/purchase-orders/pending-approval' + q)
```
- 「全部待审批 / 采购类」仍不带参（看全部）。
- 其余 tab（财务类 / 确认任务 / 抄送我的 / 已处理）为占位，逻辑不变。

---

## 四、明确不动的部分（边界守护）

- ❌ 不新增审批引擎 / 审批节点表 / CC 表 / 通知表。
- ❌ 不改 `approval_flows` / `approval_records` 表结构（含不新增 `cc_list` 列）。
- ❌ 不改 `approve/reject/withdraw` 状态流转与权限判定（`po_approve` 仍放行所有级次）。
- ❌ 不碰付款审批链（`payment_deposit/balance/freight/duty` 等 flow 与付款建单逻辑）。
- ❌ 不重构 `approval_status`/`po_status` 三态模型。
- ❌ 不接飞书 / 不发任何通知。
- ❌ 不动前端「审批流管理」配置编辑（那属于之前 A 方案的另项，本轮不做；本轮只让**已存在的配置**生效 + 待我审批过滤）。

---

## 五、已知局限（需你知情，非本轮越界修复）

- **L1 每级「角色强制」不在本轮**：审批动作仍由 `po_approve` 权限放行全部级次（即持 `po_approve` 者可批任意级）。本轮仅让配置驱动「级次数量 + 记录的角色元数据 + 待我审批可见性」，不强制「仅 role_x 可批第 x 级」（那等于改审批权限模型，属禁止项）。
- **L2 角色与权限错配**：配置把 `role_operator` 设为一级审批人，但 `role_operator` **没有 `po_approve` 权限**，因此运营人员实际无法打开审批中心（`pending-approval` 端点要求 `po_approve`）。这是历史权限设计问题；本轮不修（修则越界改访问模型）。在当前 2 名 `role_admin` 用户环境下，「待我审批」实际服务于管理员（二级审批人）。

---

## 六、隔离测试计划（确认后执行）

> 沿用前几轮纪律：复制生产库到隔离副本 + 独立端口 + break-glass 真实登录取 cookie + 断言。生产库零污染，脚本跑完即删。

1. **环境**：`DB_PATH=/tmp/inv_test.db`（生产库副本）→ 启动隔离服务（端口 3101）→ break-glass 登录 admin 取 cookie。
2. **注入测试数据**（SQL 直插隔离副本）：2 张 `draft` PO（A、B）。
3. **断言①配置生效（基础 2 级）**：admin 提交 PO-A → `pending-approval`（无参）返回 1 行，`max_level=2`，`approvers` 长度 2，级次1=role_operator、级次2=role_admin。
4. **断言②待我审批过滤（role_admin）**：`?mine=1`（admin=role_admin）→ 0 行（当前级次1=role_operator，不匹配）；无参 → 1 行。
5. **断言③级次推进后 mine 命中**：admin 批 PO-A 一级（action=approve）→ current_level=2；`?mine=1` → 1 行（级次2=role_admin 命中）；无参仍 1 行。
6. **断言④配置驱动级数**：用 `POST /api/approval-flows` 把 flow_po 改成 3 级 → 提交 PO-B → 无参返回 `max_level=3`、`approvers` 长度 3。
7. **断言⑤兜底**：`POST /api/approval-flows` 把 flow_po 置 `is_enabled=0` → 提交新 draft PO → 无参返回 `max_level=2`、`approvers` 长度 1（还原单级兜底，提交不失败）。
8. **断言⑥无回归**：`/api/me`、`/api/purchase-orders/:id`、`/api/approval-flows`、`/api/skus`、`/api/payment-requests` 均 200。
9. **清理**：停隔离服务、删 `/tmp/inv_test.db` 与测试脚本（一次性，不留在根目录）。

---

## 七、交付物（确认并实施后）
- 改动文件：`server.js`（M1、M2）、`app.js`（M3）。
- 报告：`SYS-MGMT-APPROVAL-01-IMPL-REPORT-20260717.md`（含隔离测试全绿证据 + 已知局限）。
- 备份：`.backup-approval01/` 存改前 `server.js`/`app.js` 副本。

---

**请确认是否按此方案进入「最小修改 → 隔离测试 → 报告」。如需调整 M1–M3 任一处，请在确认前指出。**
