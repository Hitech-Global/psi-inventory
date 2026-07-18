# SYS-MGMT-ROLE-01 角色管理完善 · 只读排查报告（2026-07-17）

> 性质：纯只读排查，未改任何代码 / 数据库 / 配置 / 权限 / 页面。
> 纪律：仅输出方案，等待架构确认后再进入最小实施。
> 本轮目标：恢复已有角色的可维护能力，不重新设计 RBAC。

---

## 一、角色表结构（db.js:81-88）

唯一角色表 `roles`：

| 列 | 类型 | 说明 |
|---|---|---|
| id | TEXT PK | 角色 id（role_admin / role_operator / role_viewer） |
| name | TEXT | 显示名 |
| description | TEXT | 描述 |
| permissions | TEXT(JSON) | **权限数组**，如 `["dashboard_view","sku_view",...]` |
| is_system | INTEGER | 1=系统角色（种子），0=自定义 |
| created_at | TEXT | |

**关键事实：没有独立的 `permissions` 目录表。** 权限目录只以 45 个 key 硬编码在 `db.js` 的 `allPerms`（1883-1899），作为种子写入各角色 `permissions` 列。没有任何地方存储「权限 key → 中文 label」的映射。

## 二、权限模型

- 每个角色通过 `permissions` JSON 数组持有一组权限 key。
- `allPerms`（db.js:1883）= 全部 45 个权限 key，是**事实上的权限目录**，但：
  - 只存在于 db.js 种子代码，**无任何数据库表、无任何 label、无 catalog 端点**；
  - `operatorPerms` / `viewerPerms` 是其子集。
- 权限生效链路已核实：
  - `apiAuth`（server.js:314-321）：active 用户**每次请求实时从 DB 读 `roles.permissions` 并 JSON.parse** → 改角色权限**即时生效，无缓存**。
  - `requireApiPermission`（server.js:325-332）：直接比对 `req.currentUserPermissions` 数组。
  - 结论：**编辑 `roles.permissions` JSON 列即可改变访问控制，且立即生效**。✅

## 三、当前角色管理 API（server.js:504-528）

| 路由 | 守卫 | 能力 |
|---|---|---|
| `GET /api/roles` (504) | `requireApiPermission('role_manage')` | 列出角色（含 permissions 数组） |
| `POST /api/roles` (511) | `requireApiPermission('role_manage')` | **upsert**：`ON CONFLICT(id) DO UPDATE SET name,description,permissions`（516 行）→ **已能更新已有角色的权限** |
| `DELETE /api/roles/:id` (522) | `requireApiPermission('role_manage')` | 仅删非系统角色；`role_admin` 受保护（返回 400） |

**重要发现**：后端并无独立的「编辑」缺口——`POST /api/roles` 的 upsert 在传入已有 `id` 时会更新该角色的 `permissions`。因此**后端保存能力已具备**，真正的缺口在前端（没有编辑 UI）和「权限目录暴露」（UI 不知道有哪些 key + label 可勾选）。

## 四、当前角色管理页面（app.js:892-902）

`renderRoles` / `loadRoles` 是**纯只读表格**：

```
角色名 | 描述 | 权限数 | 系统
```

- 无任何编辑/保存入口；
- 不展示权限明细（只显示数量）；
- 不加载权限目录；
- 行不可点击、无弹窗、无勾选网格、无保存按钮。

## 五、缺失的编辑 / 保存能力

1. **权限目录未暴露**：后端无 `GET /api/permissions` 之类端点，前端无从得知「系统有哪些权限 key + 中文名」可勾选。
2. **前端无编辑 UI**：点击行 → 弹窗（名称/描述 + 权限勾选网格）→ 保存，这一整套流程完全缺失。
3. **前端无保存函数**：无 `saveRole` / `openRoleEditor` / `editRole` 等任何痕迹（grep 为空）。

## 六、是否只需 admin 修改现有角色权限？——是，且结论清晰

- 角色管理菜单 `perm:'role_manage'`（app.js:167），`GET /api/roles` 也已要求 `role_manage` → 只有管理员（role_admin）能进入。
- 现状即有 3 个系统角色 + 可建自定义角色；用户明确「恢复已有角色可维护能力、不重新设计 RBAC、不新增大量角色」。
- **因此最小范围 = 让管理员能编辑现有角色的 permissions（含系统角色）**，无需新增角色创建/删除 UI，无需新增权限点语义。

---

## 七、最小实施方向（仅提议，待确认）

### A. 后端（server.js）
1. 新增 in-code 常量 `PERM_LABELS`（45 项 key→中文 label，按模块分组）。**这不是新权限模型，仅是展示用 label 目录**，不新增任何权限语义、不写库。
2. 新增只读端点 `GET /api/permissions` → 返回 `[{key,label,group}]`（供前端渲染勾选网格）。
   - 备选：不新增端点，改在 `GET /api/roles` 响应里附带 `catalog` 字段。两种皆可，报告倾向独立端点（更清晰、复用简单）。
3. **复用现有 `POST /api/roles` upsert 作为保存入口**——无需新增写路由。
4. （可选安全护栏）保存时强制 `role_admin` 始终包含 `role_manage`，防止管理员误删自身权限导致自锁。

### B. 前端（app.js）
1. `renderRoles` / `loadRoles`：行可点击 → 打开角色编辑弹窗。
2. 弹窗内容：角色名（可编辑，系统角色可改描述）、描述、**按模块分组的权限勾选网格**（从 `GET /api/permissions` 加载，预勾 `role.permissions`）。
3. 保存按钮 → `POST /api/roles`（`{id, name, description, permissions}`）。
4. `index.html`：复用现有 `.modal` / `.modal-overlay` CSS（历史记录表明已有该样式），**大概率零 CSS 改动**。

### C. 不改动项（边界）
- 不改 RBAC 模型、不新增权限点语义、不改 AUTH、不改业务权限规则（`requireApiPermission` 逻辑不动）。
- 不改 `roles` 表结构、不新增/删除角色表、不引入 `permissions` 目录表（label 仅 in-code 常量）。
- 不新增「新建角色 / 删除角色」UI（按「不新增大量角色」收敛）。
- `is_system` 角色允许编辑其权限（符合「恢复已有角色可维护能力」）；删除仍受现有 `role_admin` 保护。

---

## 八、待你架构确认的决策点

1. **权限目录暴露方式**：新增只读 `GET /api/permissions`（倾向） vs 在 `GET /api/roles` 响应附带 catalog？
2. **是否允许编辑系统角色（role_admin/operator/viewer）的权限**？还是仅允许编辑自定义角色（is_system=0）？——报告按「恢复已有角色可维护能力」默认**允许编辑全部角色（含系统角色）**。
3. **安全护栏**：保存时强制 role_admin 始终保留 role_manage（防自锁），是否认可？（建议保留，仅 2 行）
4. **UI 范围**：仅做「编辑现有角色权限」（点击行→弹窗勾选→保存），不新增「新建/删除角色」UI——是否认可？
5. **label 来源**：45 个 key 的中文 label 由 AI 依据命名规则生成（如 `sku_create`→「SKU 创建」），是否会与你心中的命名冲突？如你有既定 label 表请附上，否则按命名规则生成。

请确认上述 5 点（尤其 2、3、4 的范围边界），确认后我进入最小实施 → 隔离测试 → 报告。
