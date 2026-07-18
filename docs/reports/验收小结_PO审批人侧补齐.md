# PO 审批人侧补齐 · 实现与验收小结

> 状态：已实现并通过端到端验证。范围严格限定 PO 审批人侧。
> 用户拍板方向：审批中心放顶部导航（跨模块工作台），本期只做 PO，信息架构预留其余分类。

## 一、改动文件

| 文件 | 改动 |
|---|---|
| `server.js` | 新增 `GET /api/purchase-orders/pending-approval`（权限 `po_approve`）；**注册位置在 `GET /api/purchase-orders/:id` 之前**，避免被 `:id` 参数路由抢匹配（关键修复） |
| `app.js` | ① `NAV_MODULES` 新增独立模块 `approval`（顶部导航「审批中心」，门控 `po_approve`）；② `R` 路由映射 + `titles` 注册 `approval-center`；③ 新增函数群：`renderApprovalCenter` / `switchApprovalTab` / `loadApprovalCenterList` / `approvePO` / `rejectPO` / `openApprovalDetail` |
| `index.html` | 补充审批中心标签（`.approval-tab`）、审批轨迹时间线（`.approval-timeline`）、提示样式 |

## 二、后端接口

`GET /api/purchase-orders/pending-approval`（权限 `po_approve`）
- 仅列表查询，JOIN `approval_records` + `purchase_orders` + `purchase_order_items`（累加 `total_qty`），**不写任何状态、不动 submit-approval / approve 端点**。
- 返回字段：`approval_id, po_id, po_no, submitter_name, current_level, max_level, approval_history, submitted_at, brand, country, target_warehouse, total_amount, currency, po_status, total_qty`
- 通过 / 驳回复用现有 `POST /api/purchase-orders/:id/approve`（已有端点）。

## 三、前端（审批中心）

- **顶部导航**新增「审批中心」入口（与「审批流管理」并列区分：前者干活、后者配规则），门控 `po_approve`。
- **页内分组（信息架构预留）**：
  - 已实现：「待我审批」(默认) / 「全部待审批」 / 「采购类审批」——三者均加载 PO 待审列表。
  - 占位预留：「财务类审批」/「确认任务」/「抄送我的」/「已处理」——点击显示「该分类将于后续版本接入（本期仅实现 PO 审批）」。
- **列表行操作**：👁️ 查看详情 / ✅ 通过 / ⛔ 驳回。
  - 通过：`approve {action:'approve'}`（带二次确认，remark 可空）。
  - 驳回：弹窗**必填原因**后 `approve {action:'reject', remark}`。
  - 详情弹窗：PO 基本信息 + 解析 `approval_history` 渲染审批轨迹时间线（提交/通过/驳回/撤回）。

## 四、验证结果

- `node --check app.js` / `node --check server.js` 均通过；服务重启 `HTTP=200`。
- **端到端**（取真实 draft PO）：`draft` → 提交审批 → 待审列表出现该 PO（字段齐全） → `approve`×2（离开列表，`approved`） → `reject`（回 `draft`）；最终 PO 状态干净恢复。
- **测试数据已清理**：两个被端到端脚本碰过的 PO 均 `withdraw` 还原为 `draft/pending`，无遗留污染。

## 五、已知限制（按用户拍板保留）

1. `max_level=2`：当前需**两次 `approve`** 调用才最终通过（提交侧逻辑不动，仅作已知限制记录）。
2. 待审列表按**全量 `pending`** 过滤（有 `po_approve` 即可看/审），不按审批人/层级精细过滤。
3. 财务类 / 确认任务 / 抄送我的 / 已处理 为**占位**，后续版本接入。
4. **历史既有数据不一致**（非本轮造成）：库中存在 1 条 `approval_records.status='pending'` 但其对应 PO 状态非 `pending_approval` 的记录，属早期测试遗留，与本次改动无关，本轮未修。

## 六、边界（明确未动）

`submit-approval` / `approve` 端点与状态机、`approval_records` 表结构、`purchase_orders` 状态机、PI / CI / PL、订单预测、停采、失真、多维周转、三页口径、采购链实时回写、「审批流管理」配置页、费用支付等其他审批对象。

## 七、用户验收步骤

1. 浏览器**硬刷新**（Cmd+Shift+R）加载新 `app.js` / `index.html`。
2. 顶部导航出现「审批中心」→ 点击进入 → 默认「待我审批」列出所有 `pending_approval` 的 PO。
3. 对任一条点「✅ 通过」（需两次）→ PO 状态变 `approved`，PO 管理页出现「发工厂」；或点「⛔ 驳回」（必填原因）→ PO 回 `draft`。
4. 点 👁️ 查看审批轨迹时间线。
