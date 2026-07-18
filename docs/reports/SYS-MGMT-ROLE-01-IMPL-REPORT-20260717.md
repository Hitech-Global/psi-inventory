# SYS-MGMT-ROLE-01 角色管理完善 · 实施报告（2026-07-17）

> 目标：让管理员可以维护现有角色权限，不重新设计 RBAC。
> 纪律：只读排查 → 架构确认 → 最小实施 → 隔离测试 → 报告。
> 改动文件：`server.js`、`app.js`。**未碰** `db.js` / 表结构 / AUTH 模块 / 业务流程 / `requireApiPermission` 逻辑。

---

## 一、改动清单（最小实施，共 5 处）

### 后端 `server.js`
1. **`PERM_LABELS` 常量**（角色路由前）：将 `db.js` 的 `allPerms`（51 个权限 key）映射为 `{label, module}`，按 6 个模块分组（系统管理 / 采购 / 库存 / 销售 / 财务 / 报表）。**纯展示用 label 目录，非权限模型，无数据库表。**
2. **`ROLE_CRITICAL_PERMS` 常量** = `['role_manage','user_manage','system_config']`。
3. **只读端点 `GET /api/permissions`**（`requireApiPermission('role_manage')`）：返回 `[{key,label,module}]`，仅把现有权限暴露给管理 UI。
4. **`POST /api/roles` 安全护栏**：`id==='role_admin'` 时，保存前强制把 3 项关键权限并入 `permissions`（即使前端尝试取消也由后端拒绝/补回）。

### 前端 `app.js`
5. **`renderRoles`/`loadRoles` 行可点击 + 新增 `openRoleEditor` / `saveRolePermissions`**：
   - 角色列表行可点击（或点「编辑权限」按钮）→ 打开 `modal-lg` 弹窗；
   - 弹窗：角色名/说明只读，按 6 模块分组渲染权限 checkbox（预勾当前 `role.permissions`）；
   - **`role_admin` 的 3 项关键权限锁定（disabled + 🔒 提示），并带黄色警示条**；
   - 保存 → `POST /api/roles`（`{id,name,description,permissions}`），复用既有 upsert；成功即刷新列表。
   - 复用既有 `openModal`/`closeModal`/`showToast`，**index.html 零改动**。

---

## 二、验证（隔离副本 + 端口 3105 + break-glass，主库零污染，临时脚本跑完即删）

**23/23 全绿**，覆盖用户 5 项验收要求：

| # | 验收要求 | 结果 |
|---|---|---|
| 1 | admin 可打开角色管理 | `GET /api/roles` 200（3 角色）、`GET /api/permissions` 200（51 项） ✅ |
| 2 | 修改 operator/viewer 权限并保存成功 | `POST /api/roles` 200，移除 `po_create` 后持久化（perms 42→41） ✅ |
| 3 | 重新登录对应用户权限立即生效 | operator 会话重读 `GET /api/me` → 不含 `po_create`（apiAuth 每次实时读 DB） ✅ |
| 4 | role_admin 删除关键权限被拒绝 | 尝试置空 → 后端强制保留 `role_manage`/`user_manage`/`system_config` 三项 ✅ |
| 5 | 普通业务接口无回归 | `/api/me` `/api/dashboard` `/api/skus` `/api/payment-requests` 均 200 ✅ |

附加校验：
- 权限目录 51 项、6 模块完整（与 `db.js allPerms` 集合一致性 **PASS**，无缺失/多余）；
- 非 `role_manage` 用户（operator）读取 `/api/permissions` 被拒（403），信息不泄露；
- `node --check` 双文件通过。

---

## 三、边界遵守（确认）

- ✅ 未新增角色 / 未删除角色 / 未新增权限点语义；
- ✅ 未修改 AUTH、未修改 `requireApiPermission` 逻辑；
- ✅ 未改 `roles` 表结构、未引入独立 permission 表、无 DB 迁移；
- ✅ 仅改 `server.js` + `app.js`（index.html 复用现有 modal 样式，零改动）；
- ✅ `role_admin` 关键权限双保险：前端锁定勾选 + 后端强制补回。

## 四、行为说明（给管理员）

- 角色管理页仅 `role_manage`（超管）可见可进；
- 点击任意角色 → 弹窗勾选权限 → 保存即时生效（下次该角色用户请求即生效，无需重启）；
- `role_admin` 的「角色管理 / 用户管理 / 系统配置」三项不可取消，避免系统失去管理入口；其余权限可自由调整；
- `role_operator` / `role_viewer` 全部权限可编辑。

## 五、下一步

等待你**真实页面验收**（角色列表点击 → 弹窗勾选 → 保存 → 对应账号重登即生效；role_admin 三项关键权限锁定不可取消）。验收通过后，按既定顺序进入 **审批流管理** 相关任务。

> 改前副本存于 `.backup-role01/`（server.js + app.js）。
