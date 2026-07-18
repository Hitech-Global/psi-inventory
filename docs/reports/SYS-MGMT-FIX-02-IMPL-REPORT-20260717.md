# SYS-MGMT-FIX-02 实施报告（权限收口）

- 日期：2026-07-17
- 性质：最小实施（严格 5 处，零业务逻辑改动）
- 验证：隔离副本 + 端口 3104 + break-glass，主库零污染；临时脚本跑完即删
- 结果：**30/30 全绿**

## 一、收敛范围（用户架构确认锁定）

仅以下 5 处，未扩展其他 GET、未改 RBAC 模型、未新增权限点、未改业务流程：

| # | 文件 | 位置 | 改动 |
|---|---|---|---|
| 1 | server.js | 504 | `GET /api/roles`：`requireLogin` → `requireApiPermission('role_manage')` |
| 2 | server.js | 1401 | `GET /api/system-config`：`requireLogin` → `requireApiPermission('system_config')` |
| 3 | server.js | 926 | `GET /api/approval-flows`：`requireLogin` → `requireApiPermission('system_config')` |
| 4 | app.js | 172 | 菜单 `operation-logs`：`perm:'system_config'` → `perm:'inventory_view'` |
| 5 | app.js | 182 | 菜单 `batch-tasks`：`perm:'system_config'` → `perm:'inventory_view'` |

## 二、改动逻辑说明

### FIX-02-1 敏感读接口收口（3 处）
- 原三接口仅 `requireLogin`：任何已登录 active 用户（含 `role_viewer`）均可读取角色权限矩阵 / 系统配置 / 审批流配置，存在信息泄露。
- 改为对齐各自**写接口**既有权限（非新增权限）：
  - `GET /api/roles` 对齐 `POST/DELETE /api/roles`（本就 `role_manage`）
  - `GET /api/system-config` 对齐 `POST /api/system-config`（本就 `system_config`）
  - `GET /api/approval-flows` 对齐 `POST /api/approval-flows`（本就 `system_config`）
- **未修改 RBAC 模型、未新增权限点、未改业务权限规则**。

### FIX-02-2 菜单权限错配修复（2 处）
- 原 `operation-logs` / `batch-tasks` 菜单 `perm:'system_config'`，但后端 `GET /api/operation-logs`(7838) / `GET /api/batch-tasks`(7817) 实际要求 `inventory_view` → “可见但点击 403”。
- 仅改前端菜单 `perm` 对齐后端既有要求（`inventory_view`），**不动后端 / RBAC**。修复“可见不可点”。

## 三、隔离验证（30/30）

隔离副本注入 3 类会话：admin（break-glass 真实登录）、operator（`role_operator`，含 `inventory_view`）、viewer（`role_viewer`，含 `inventory_view`）。断言矩阵：

| 接口 | admin | operator | viewer | 结论 |
|---|---|---|---|---|
| `/api/roles` | 200 | 403 | 403 | 收紧生效 ✅ |
| `/api/system-config` | 200 | 403 | 403 | 收紧生效 ✅ |
| `/api/approval-flows` | 200 | 403 | 403 | 收紧生效 ✅ |
| `/api/operation-logs` | 200 | 200 | 200 | 错配修复（含 inventory_view 即可访问）✅ |
| `/api/batch-tasks` | 200 | 200 | 200 | 错配修复 ✅ |
| `/api/me` `/api/dashboard` `/api/skus` `/api/payment-requests` | 200 | 200 | 200 | 回归：其他接口不受影响 ✅ |
| `/api/users` | 200 | 403 | 403 | 回归：用户管理页（admin 同时调 /api/users+`/api/roles` 均 200）不破 ✅ |

- **信息泄露已修复**：非 `role_manage`/`system_config` 用户（运营/查看）不再能读取角色权限矩阵、系统配置、审批流配置。
- **菜单错配已修复**：拥有 `inventory_view` 的用户（含查看/运营）现在对操作日志、批量任务“可见且可点”，不再 403。
- **用户管理页无回归**：`user_manage` 仅存于 `role_admin`（`allPerms`，db.js:1898），故 `/api/roles` 收紧不影响用户页（`renderUsers` 仅 role_admin 可达，已含 `role_manage`）。

## 四、已知取舍（用户已确认接受）

- `GET /api/system-config` 收紧后，非 `system_config` 用户（运营/查看）在**订单预测页**调用该接口将被 403；该页 `getSalesStatsDays`(app.js:3946) / `openRpParams`(5103) 均 `try/catch` 静默回退默认值（销售统计周期 90 等）。页面不崩，符合“非授权不读管理员配置”意图。**未新增任何查看权限**。

## 五、严格遵守的边界

- 未扩展其他 GET 接口权限收口（countries/warehouses/currencies/suppliers 等列表 GET 仍 `requireLogin`，属更广泛模式，按收敛指令不纳入本轮）。
- 未修改 RBAC 模型 / 未新增角色 / 未新增权限点 / 未修改业务权限规则 / 未改动付款链 / WAC / 审批 / 配置读取逻辑（FIX-01 已落地的配置生效不受影响）。
- `app.js` 仅改 2 行菜单 `perm`；`server.js` 仅改 3 行中间件；`db.js` / 表结构 / index.html 零改动。

## 六、备份与回滚

- 改动前副本：`.backup-fix02/server.js`、`.backup-fix02/app.js`。
- 隔离测试库 `/tmp/fix02_test.db` 已删除，主库 `data/inventory.db` 全程未碰。

## 七、下一步

等待真实页面验收（操作日志/批量任务菜单可见可点；非管理员在用户管理/角色/系统参数/审批流页被拦截）。验收通过后进入 **角色管理完善**（按既定顺序）。
