# SYS-MGMT-APPROVAL-01 实施报告 · 审批流配置→执行脱钩 + 待我审批过滤

> **日期**：2026-07-17（实施）/ 2026-07-18（收口）
> **阶段**：只读审计 → 方案确认 → 最小实施 → 隔离测试 → 报告
> **纪律**：隔离 DB 副本 + 独立端口 + break-glass 实测；生产库零污染
> **关联文档**：`SYS-MGMT-APPROVAL-01-READONLY-REPORT-20260717.md`、`SYS-MGMT-APPROVAL-01-IMPL-PLAN-20260717.md`

---

## 一、实施范围（严守禁止项）

| # | 修改点 | 内容 | 文件 |
|---|---|---|---|
| M1 | PO 提交读取审批流配置 | 提交审批时读取 `approval_flows`（business_type='po' 且 is_enabled=1）的 `levels`，`max_level = levels.length`，`approvers` 改为 `[{level, approver_role, approver_name=角色名}]`；无配置/禁用时兜底原单级（max_level=2） | server.js |
| M2 | 待我审批按当前用户过滤 | `GET /api/purchase-orders/pending-approval` 增加 `?mine=1`：用已暴露的 `req.currentUserRole` 匹配「当前级次」`approvers[].approver_role` 做 JS 过滤 | server.js |
| M3 | 前端待我审批 tab 传参 | `loadApprovalCenterList` 对 `_approvalTab==='mine'` 调用 `?mine=1`，「全部/采购类」保持原逻辑 | app.js |

**明确未做（用户禁止项）**：不新增审批引擎；不增加动态条件/金额规则；不修改付款审批链；不修改采购链逻辑；不修改 `approve/reject/withdraw` 状态流转；不重构 `po_status/approval_status/approval_records` 三态模型；不接入飞书通知；不新增 CC。

---

## 二、改动明细

### server.js
- **M1（约 3678–3711 行）**：替换原硬编码 `max_level=2` + 单 `approver_id` 写入。改为：
  ```js
  const flow = queryOne("SELECT levels FROM approval_flows WHERE business_type = 'po' AND is_enabled = 1 LIMIT 1");
  // 解析 levels → maxLevel = levels.length
  // approvers = levels.map(l => ({ level:l.level, approver_role:l.approver_role, approver_name: 角色名 }))
  // 无配置/levels 空 → 兜底原单级（max_level=2, approver_id/approver_name 结构）
  ```
  `approve/reject/withdraw`（原 3693–3728，现顺延）**原封不动**。
- **M2（约 3490–3506 行）**：`pending-approval` 路由在返回前增加：
  ```js
  if (req.query.mine === '1' && req.currentUserRole) {
    // 仅保留「当前级次 approver_role === req.currentUserRole」的实例
    return res.json(filtered);
  }
  ```
  不修改 SQL、表结构、权限（`requireApiPermission('po_approve')` 不变）。

### app.js
- **M3（约 730 行）**：`loadApprovalCenterList` 第一行改为按 tab 拼接 `?mine=1`：
  ```js
  const data=await api('/api/purchase-orders/pending-approval' + (_approvalTab === 'mine' ? '?mine=1' : ''));
  ```

### 备份
- `.backup-approval01/server.js`、`.backup-approval01/app.js`：改前副本，供回滚与对照。

---

## 三、隔离测试（30/30 全绿）

**环境**：复制生产库到 `/tmp/inv_approval_test.db`（`DB_PATH` 隔离）+ 独立端口 `3211` + break-glass 本地登录（admin / `Hitech112233.`）；测试脚本跑完即删，生产库零污染。

| 组别 | 用例 | 结果 |
|---|---|---|
| 配置驱动 | PO 配置启用且 2 级；提交后 `max_level=2`、approvers 含 `role_operator`(运营人员)/`role_admin`(超级管理员)、`current_level=1` | ✅ |
| M2 过滤 | admin(role_admin) 在 level1 时「待我审批」为空、但「全部待审批」含该 PO | ✅ |
| M2 过滤 | 一级审批通过后 `current_level=2`，「待我审批」含该 PO（role_admin 命中） | ✅ |
| 状态流转 | 最终审批通过 → `approval_records.status=approved`，PO 端到端可用 | ✅ |
| 3 级驱动 | 改配置为 3 级（role_operator/role_viewer/role_admin）→ 提交 `max_level=3`、approvers 数量 3 | ✅ |
| 兜底 | 禁用配置（is_enabled=0）→ 提交仍成功，`max_level=2` 且 approvers 含 `approver_id`（单级结构） | ✅ |
| 回归 | `/api/me` `/api/roles` `/api/skus` `/api/payment-requests` `/api/approval-flows` `/api/purchase-orders` 均 200 | ✅ |

**结论**：配置→执行脱钩修复生效（管理员改审批级别/角色后，新提交即时生效）；「待我审批≠全部待审批」已修复；无普通接口回归。

---

## 四、已知局限（需用户知情，非本轮越界）

- **L1 · 每级「仅某角色可批」未强制**：`approve` 仍只校验 `po_approve` 权限（全部级次放行），不校验提交配置的角色约束——属用户禁止项（不改审批状态机/权限），不在此轮。配置本轮驱动「级数 + 角色元数据 + 待我审批可见性」。
- **L2 · 运营人员无法打开审批中心**：配置把 `role_operator` 设为一级审批人，但 `role_operator` 无 `po_approve` 权限 → 运营人员实际打不开审批中心。这是历史权限错配，修复需改访问模型（越界），留待后续独立处理。
- **L3 · 旧 PO 无 approver_role**：升级前已存在的审批实例（旧结构仅 `approver_id`）在「待我审批」中不会被角色匹配命中（仅出现在「全部」）。新提交均为配置驱动结构，无影响。

---

## 五、关联需求记录（不实施）

- **PUR-OPS-COLLAB-01 采购运营协同闭环**：已落档 `PUR-OPS-COLLAB-01-REQ.md`。CI 确认后自动生成运营准备任务（负责人/CC 复用系统用户，飞书通知）。**本轮仅记录，未实施**；待 FEISHU-NOTIFY 与 CC 体系规划后统一纳入。

---

## 六、上线/验收方式

- 生产服务当前未运行；以新代码启动即生效：`DB_PATH=./data/inventory.db PORT=3001 node server.js`（或原启动方式）。
- 验收建议：
  1. 系统管理 → 审批流管理，将 PO 审批改为 3 级并保存；
  2. 提交一张 PO，确认审批中心显示 3 个级次、对应角色；
  3. 用「待我审批」tab 验证当前登录用户仅见其负责级次；
  4. 逐級审批至最终通过。

---

## 七、改动文件清单

| 文件 | 性质 | 说明 |
|---|---|---|
| `server.js` | 修改 | M1（配置驱动提交）+ M2（`?mine=1` 过滤） |
| `app.js` | 修改 | M3（待我审批 tab 传 `?mine=1`） |
| `.backup-approval01/server.js` | 新增（备份） | 改前副本 |
| `.backup-approval01/app.js` | 新增（备份） | 改前副本 |
| `PUR-OPS-COLLAB-01-REQ.md` | 新增（需求记录） | 仅记录，不实施 |
| `SYS-MGMT-APPROVAL-01-IMPL-PLAN-20260717.md` | 既有 | 实施方案 |
| `SYS-MGMT-APPROVAL-01-READONLY-REPORT-20260717.md` | 既有 | 只读审计 |
