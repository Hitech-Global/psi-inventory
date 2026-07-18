# 方案：PO 审批人侧补齐（最小执行范围）

> 状态：仅方案，未改任何代码。
> 范围：只补 **PO 审批链路的人侧能力**。不扩费用支付、PI/CI/PL、预测、停采、失真、多维周转、三页口径、采购链实时回写等已调顺模块。

---

## 一、背景（已确认结论）

提交侧是通的：
- PO 列表「提交审批」→ `POST /api/purchase-orders/:id/submit-approval`（权限 `po_create`）
- PO 状态 → `pending_approval`，`approval_status='pending'`
- 写入 `approval_records`（business_type='po', status='pending', max_level=2, current_level=1, 含 approval_history）

真正卡点 = **审批人侧没接完**：
- 后端：缺「待审列表查询接口」（`approval_records` 仅在 submit/approve 内部读写，无 `GET` 列表接口）
- 前端：缺「审批中心 / 待我审批」页面、入口、通过/驳回 UI

本方案只补这一侧。

---

## 二、后端改动（最小，仅新增 1 个只读接口）

### 2.1 新增：`GET /api/purchase-orders/pending-approval`
- **权限**：`po_approve`
- **SQL**（以 `approval_records` 为主表，JOIN `purchase_orders` 与明细累加）：
  ```sql
  SELECT
    ar.id              AS approval_id,
    ar.business_id     AS po_id,
    ar.business_code   AS po_no,
    ar.submitter_name,
    ar.current_level,
    ar.max_level,
    ar.approval_history,
    ar.created_at      AS submitted_at,
    po.brand,
    po.country,
    po.target_warehouse,
    po.total_amount,
    po.currency,
    po.po_status,
    (SELECT SUM(poi.po_qty)
       FROM purchase_order_items poi
      WHERE poi.po_id = po.id) AS total_qty
  FROM approval_records ar
  JOIN purchase_orders po ON po.id = ar.business_id
  WHERE ar.business_type = 'po'
    AND ar.status = 'pending'
  ORDER BY ar.created_at DESC
  ```
- **返回字段清单（每条待审 PO）**：
  | 字段 | 来源 | 说明 |
  |---|---|---|
  | approval_id | approval_records.id | 审批记录 id（通过/驳回时回传用） |
  | po_id | business_id | PO 主键 |
  | po_no | business_code | PO 号 |
  | submitter_name | approval_records | 提交人 |
  | brand / country / target_warehouse | purchase_orders | 品牌 / 国家 / 仓库 |
  | total_qty | 明细累加 | 总数量（SUM po_qty） |
  | total_amount / currency | purchase_orders | 总金额 / 币种 |
  | submitted_at | approval_records.created_at | 提交时间 |
  | current_level / max_level | approval_records | 当前级次 / 总级次（如 1/2） |
  | approval_history | approval_records | JSON 审批轨迹（详情弹窗用） |
- **不动**：`submit-approval` 端点、`approve` 端点、`approval_records` 表结构、`purchase_orders` 状态机。

### 2.2 复用现有端点（不新增）
- 通过/驳回统一调用 **已有** `POST /api/purchase-orders/:id/approve`，body `{ action: 'approve'|'reject', remark }`，权限 `po_approve`。

---

## 三、前端改动（最小，新增 1 页 + 1 入口）

### 3.1 新增页面 `approval-center`（审批中心 / 待我审批）
- 渲染函数 `renderApprovalCenter()`，路由 key `approval-center`。
- 进入即调用 `GET /api/purchase-orders/pending-approval` 拉列表。

### 3.2 侧边栏入口
- 在 `.sidebar-nav`（或等价菜单数组）新增一项 `{ key:'approval-center', label:'审批中心', icon:'✅' }`。
- **位置建议**：与现有「审批流管理」（配置页）并列但明显区分——「审批中心」= 处理任务，「审批流管理」= 配置流程。建议排在采购管理（PO/PI/CI）之后、系统类之前，作为高频待办入口。
- 权限门控：`hasPermission('po_approve')` 才显示（无审批权限的人看不到入口，避免空列表）。

### 3.3 待审列表展示（列）
| 列 | 字段 |
|---|---|
| PO 号 | po_no |
| 提交人 | submitter_name |
| 品牌 | brand |
| 国家 | country |
| 仓库 | target_warehouse |
| 总数量 | total_qty |
| 总金额 | total_amount + currency |
| 提交时间 | submitted_at |
| 审批级次 | `current_level / max_level` |
| 操作 | 查看详情 / 通过 / 驳回 |

- 列表为空时显示「暂无待审批 PO」。

### 3.4 通过 / 驳回交互
- **通过**：行内「通过」按钮 → 直接调 `approve({action:'approve'})`（可选弹窗填 remark，remark 非必填）→ 成功后从列表移除该行 + toast。
- **驳回**：行内「驳回」按钮 → 弹窗**必填**驳回理由（remark）→ 调 `approve({action:'reject', remark})` → 成功后移除该行 + toast。
- 操作后重新拉列表（或前端直接移除该行）。

### 3.5 详情 / 审批历史
- 行内「查看详情」→ 弹窗展示：
  - PO 基本信息（po_no、品牌、国家、仓库、总金额、提交人、提交时间、级次）
  - **审批历史时间线**：解析 `approval_history` JSON，按 `time` 顺序展示每条 `{level, action(提交/通过/驳回/撤回), user_name, time, remark}`。
- 便于审批人看上下文，不做编辑。

---

## 四、状态流转与页面体现

| 状态 | PO 列表体现 | 审批中心体现 |
|---|---|---|
| **draft**（草稿） | 「提交审批」按钮可用；可删除 | 不出现 |
| **pending_approval**（审批中） | 显示「审批中」徽标；操作列仅「查看 / 作废」，无「发工厂」 | **出现在待审列表**，可「通过 / 驳回」 |
| **approved**（已通过） | 显示「已审批」徽标；「发工厂」按钮出现 → sent_factory | 从待审列表消失 |
| **rejected**（驳回） | po_status 回 `draft`，显示「已驳回」或回到草稿态 | 从待审列表消失（approval_history 留痕） |
| **withdraw**（撤回） | po_status 回 `draft`，approval_status='pending' | 从待审列表消失 |

> 说明：`approve` 端点逻辑已固定：approve 后 current_level+1；当 current_level > max_level 才最终置 `approved`；reject/withdraw 均回 `draft`。本方案前端只调用、不重写状态机。

---

## 五、边界保持清单（本次明确不动）

- ❌ 不改 `submit-approval` 端点逻辑
- ❌ 不改 `approve` 端点逻辑与状态机
- ❌ 不改 `approval_records` / `purchase_orders` 表结构
- ❌ 不碰 PI / CI / PL 任何逻辑
- ❌ 不碰订单预测、停采、失真、多维周转、三页口径、采购链实时回写
- ❌ 不改「审批流管理」配置页（approval_flows）
- ❌ 不扩到费用支付等其他审批对象（仅 PO）

---

## 六、待确认决策点（请拍板，本次不改）

1. **待审列表过滤粒度**：方案默认「列出所有 status='pending' 的 PO，凡有 `po_approve` 权限者皆可审」。是否要改为「只显示当前用户被指定为审批人的项」？（当前 `approvers` 实际只写了 level 1 一人，多级匹配暂不实现，建议先全量。）
2. **审批级次**：提交侧写死 `max_level=2` 但 `approvers` 仅 1 人 → 实际需**点两次 approve** 才最终通过。本次是否顺手改为「单次通过」（`max_level=1`）？建议本次**保持提交侧原样**，仅提示此现象。
3. **通过是否必填 remark**：方案默认通过可留空、驳回必填理由。是否改为通过也必填？
4. **侧边栏入口命名/位置**：建议「审批中心」与「审批流管理」并列区分；是否接受该命名与位置？

---

## 七、执行顺序（改代码时按此，本次只出方案）

1. 后端：`GET /api/purchase-orders/pending-approval`（仅查询，JOIN 累加）
2. 前端：侧边栏加入口（门控 `po_approve`）
3. 前端：`renderApprovalCenter()` 列表 + 通过/驳回调用现有 `approve`
4. 前端：详情弹窗 + 审批历史时间线
5. 自测：draft→提交→审批中心出现→通过→approved→发工厂可用；驳回→回 draft
