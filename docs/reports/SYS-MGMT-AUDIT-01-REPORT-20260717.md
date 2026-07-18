# SYS-MGMT-AUDIT-01 只读审计报告

> 审计性质：**只读排查**，未修改任何代码 / 数据库 / 配置 / 权限 / 页面。
> 审计时间：2026-07-17
> 审计目标：检查系统管理模块是否满足长期运营维护需求。
> 范围：菜单结构、用户管理、角色管理、审批流管理、供应商管理、品牌管理、系统参数/基础配置、权限安全。

---

## 一、当前系统管理结构

### 1.1 导航定义（事实来源）
菜单完全由 `app.js:136-185` 的 `NAV_MODULES` 定义，`index.html` 仅含空容器（无静态菜单）。共 7 个一级模块，系统管理为其中之一。

### 1.2 系统管理菜单（18 项，app.js:165-183）
```
系统管理 (perm 门槛普遍为 system_config)
├─ 用户管理          perm=user_manage
├─ 角色权限          perm=role_manage
├─ 国家管理          perm=system_config
├─ 仓库管理          perm=system_config
├─ 品牌设置          perm=system_config
├─ 币种设置          perm=system_config
├─ 操作日志          perm=system_config   ⚠️ 后端接口实际要求 inventory_view
├─ 系统参数          perm=system_config
├─ 供应商管理        perm=system_config
├─ 货代管理          perm=system_config
├─ 付款条件          perm=system_config
├─ 付款类目管理      perm=system_config
├─ 付款主体          perm=system_config
├─ 审批流管理        perm=system_config   ⚠️ 图标与顶部「审批中心」重复(✅)
├─ 费用类型          perm=system_config
├─ 分摊规则          perm=system_config
├─ 批量任务中心      perm=system_config   ⚠️ 后端接口实际要求 inventory_view
└─ 货代分析          perm=forwarder_view  ⚠️ 分析视图误归类于系统管理
```
顶部另有独立模块「审批中心」(app.js:157-158, perm=po_approve) 与「财务」(应付驾驶舱/付款/成本)。

### 1.3 结构问题
- **审批双入口图标重复**：顶部「审批中心」(✅) 与系统管理「审批流管理」(✅) 视觉混淆（app.js:158 vs 179）。
- **菜单权限与后端 API 错配**：`operation-logs`/`batch-tasks` 菜单 perm=`system_config`，但后端 `GET /api/operation-logs`(server.js:7831) 与 `GET /api/batch-tasks`(server.js:7810) 均要求 `inventory_view`。拥有 system_config 但无 inventory_view 的角色会看到菜单、点击却 403。
- **层级归属不当**：「货代分析」(perm=forwarder_view) 是分析视图，归在系统管理下归类偏乱。
- 未发现明显废弃但仍显示的页面。

---

## 二、已存在能力

| 域 | 已实现能力（代码事实） |
|---|---|
| 用户管理 | 飞书 OAuth 自动建号(pending)→active→disabled 生命周期(apiAuth server.js:283-313)；后端 GET/POST/PUT/DELETE `/api/users` 全需 `user_manage`(server.js:440-491)；前端 `renderUsers` 支持查看/启用/停用/角色下拉(app.js:848-882) |
| 角色管理 | 3 系统角色 role_admin/role_operator/role_viewer(db.js:1924-1929, is_system=1)；权限以 JSON 存 `roles.permissions`(db.js:81-88)；后端 GET/POST/DELETE `/api/roles`(server.js:504-522)；前端 `renderRoles` 只读展示(app.js:892-902) |
| 审批流 | `approval_flows` 表(db.js:290-298) + GET/POST 接口(server.js:926-929)；PO/付款/盘点/调整均有 submit/approve 接口 |
| 供应商 | `suppliers` 表(db.js:187-202) + 维护页(app.js:521-625)，含品牌多选关联、结构化付款条件子表 |
| 品牌 | `brand_settings` 表(db.js:222，仅采购状态) + `renderBrandSettings`(app.js:906)；`/api/brands/all` 动态聚合 |
| 系统参数 | `system_config` 表(db.js:329-333) + 配置页(app.js:832-846) + GET/POST 接口(server.js:1401-1404) |
| 权限安全 | 全局 `apiAuth` 置于 `/api`(server.js:340)；敏感写操作均 `requireApiPermission` 分级兜底；前端 `hasPermission` 菜单/按钮隐藏 |

---

## 三、缺失能力

### 3.1 用户管理
- 后端支持「新建用户」(POST) 与「删除用户」(DELETE)，但**前端无建号入口、无删除入口**（仅飞书自动建号 + 启用/停用/改角色）。
- 本地密码账号 / 改密码 / 改飞书标识按设计不允许（非缺陷）。

### 3.2 角色管理
- **前端无创建/编辑/删除角色 UI**（renderRoles 只读）；后端无 `PUT /api/roles/:id`（仅 POST 覆盖式 + DELETE）。
- `GET /api/roles` 仅 `requireLogin`，**任意登录用户可读全部角色及权限映射**（信息泄露）。
- 无「查看角色具体权限清单」界面（前端只显示权限数）。

### 3.3 审批流管理（重点：冻结需求未达成）
- **抄送（CC）功能未实现**：后端无 cc/carbon/notify 字段、表、接口；前端仅有占位 tab「抄送我的」(app.js:662/671/727)，落入 else 分支显示"后续版本接入"。**冻结要求「审批流需支持抄送」当前未满足**。
- 审批节点仅串行（`current_level/max_level` 递增，server.js:3632-3640），无并行、无 mode 字段。
- 多级审批未真正由 `approval_flows.levels` 驱动：PO 提交写死 `max_level=2`、仅单一 approver_id(server.js:3603-3610)，未消费模板多级配置。
- `approval-flows` 无 DELETE / 单条更新接口。

### 3.4 供应商管理
- **无国家字段**（suppliers 表无 country）；跨国信息无法维护。
- **多列后端接受但前端不可维护**：`short_name`/`email`/`address`/`payment_terms` 后端 POST 接受(server.js:639-641)，但前端 `saveSupplier` 仅提交 name/associated_brands/default_currency/contact_person/phone/remark/status(app.js:631)，四列永远写默认 ''，无入口也不展示。
- `payment_terms` 冗余：真实付款条件已结构化到 `supplier_payment_terms` 表，suppliers.payment_terms 为遗留死列。

### 3.5 品牌管理
- **品牌非独立基础资料**：无 `brands` 表、无品牌名 CRUD。品牌以文本/JSON 分散存储：`skus.brand`(唯一创建入口)、`suppliers.associated_brands`(JSON)、`warehouses.brands`(逗号串)、PO/PI/CI `brand` 文本。
- 品牌名只能随 SKU 创建被动出现；改名需在多处手工同步；关联以**品牌名字符串**而非外键匹配，拼写差异即断链。
- `brand_settings` 仅存采购状态，不约束品牌主数据。

### 3.6 系统参数 / 基础配置
- **配置页部分失效**：已种子化多项配置，但 server.js 仅读取 `target_stock_months`(server.js:2847)、`brand_target_stock_months`(2476)、`sales_stats_days`。以下配置**未被任何代码读取，业务逻辑走硬编码**：
  - 呆滞阈值 `stagnant_light/medium/heavy/dead_days`(=30/60/90/180) → 硬编码 server.js:2566/2659/7099，改配置无效。
  - 付款提醒 `payment_remind_days`(=7) → 硬编码 `addDays(today,7/30)`(server.js:5755-5756)，无 30 天配置项。
  - 大额付款 `large_payment_threshold`(=50000) → 无读取。
- 默认目标周转兜底硬编码 `3`(server.js:2493/2635)，与全局配置 `4` 冲突（classify 路径忽略配置）。

### 3.7 权限安全（重点）
| 风险点 | 证据 | 等级 |
|---|---|---|
| `GET /api/roles` 仅 `requireLogin`(server.js:504) → 任意登录用户可读全部角色+权限映射 | 信息泄露/权限枚举 | 中 |
| `GET /api/system-config` 仅 `requireLogin`(server.js:1401) → 任意登录用户可读全部系统配置 | 信息泄露 | 中 |
| `GET /api/approval-flows` 仅 `requireLogin`(server.js:926) → 任意登录用户可读审批流配置 | 信息泄露 | 中 |
| 前后端 `'*'` 语义不一致：前端 `hasPermission` 支持 `'*'`(app.js:62)，后端 `requireApiPermission` 仅精确匹配(server.js:325) | 新建 `['*']` 角色前端放行、后端全 403（拒绝服务，非越权） | 低 |
| **写操作受控良好**：用户/角色/系统配置/审批流 POST/PUT/DELETE 均有 `requireApiPermission` 兜底，前端隐藏被绕过仍拦截 | 无高危越权写 | ✅ 通过 |
| 无自助改自身角色/权限接口 | 普通用户无法自提权 | ✅ 通过 |

### 3.8 死权限（定义但永不生效）
以下权限出现在角色 JSON（db.js）但 `requireApiPermission`/`hasPermission` 零引用，无法真正限制/放开功能，属冗余：
`sku_export`、`inventory_export`、`payment_export`、`check_export`、`stagnant_export`、`forwarder_export`、`inbound_confirm`（及 `pi_export`/`ci_export` 甚至未种子化）。

---

## 四、问题优先级

### P0：阻塞上线
**本轮未识别到必须阻塞上线的致命缺陷**。AUTH 模块已独立收口验收，所有写接口均受后端权限兜底，无高危越权写路径。
> 说明：若「审批流抄送」被确定为上线强制冻结需求，则它应升级为 P0；否则按 P1 处理（见下）。

### P1：上线前建议处理
1. **审批抄送功能缺失**（冻结需求未达成）—— 后端无表/字段/接口，前端仅占位。
2. **敏感读接口越权泄露** —— `GET /api/roles`、`/api/system-config`、`/api/approval-flows` 仅 `requireLogin`，应加 `requireApiPermission` 收窄。
3. **配置页部分失效** —— 呆滞阈值 / 付款提醒天数 / 大额阈值 实际由硬编码决定，运维改配置不生效；需改为读取 system_config。
4. **菜单权限与后端错配** —— `operation-logs`/`batch-tasks` 显示却 403（perm 应改为 inventory_view 或后端接口权限对齐）。
5. **品牌无独立主数据** —— 品牌作为采购链核心基础资料，当前非独立、无 CRUD、关联脆弱，长期运营风险高。
6. **供应商缺失国家字段 + 多列不可维护** —— 跨国主体无法维护；short_name/email/address 前端无入口。

### P2：后续优化
1. 审批节点仅串行、多级未由模板驱动、无 DELETE 接口。
2. 角色管理前端只读（无创建/编辑/删除 UI）、无 PUT。
3. 死权限清理（sku_export 等 9 项）。
4. 菜单结构整理（审批双入口图标重复、货代分析归类）。
5. 供应商 `payment_terms` 冗余列清理。
6. 默认周转硬编码 3 与配置 4 冲突。
7. 前后端 `'*'` 权限语义不一致修复。
8. 用户管理前端补全建号/删除入口（如需）。

---

## 五、推荐实施顺序

> 顺序遵循「安全优先 → 配置可用性 → 核心主数据 → 冻结需求 → 体验优化」，且每项独立最小实施、隔离验证。

1. **权限安全加固（P1-2）**：敏感读接口加 `requireApiPermission`（roles→role_manage、system-config→system_config、approval-flows→system_config）。无表结构变更，低风险快赢。
2. **菜单权限错配修复（P1-4）**：对齐 operation-logs/batch-tasks 的菜单 perm 与后端接口权限（或后端接口权限对齐菜单），消除 403 可见不可点。
3. **配置页生效（P1-3）**：server.js 读取 stagnant_*_days / payment_remind_days / large_payment_threshold，消除硬编码；统一默认周转来源。
4. **品牌独立主数据（P1-5）**：新增 `brands` 表 + CRUD 接口 + 前端维护页；SKU/供应商/仓库品牌关联外键化（或至少统一为品牌 ID 引用）。
5. **供应商补全（P1-6）**：suppliers 增加 country 字段；前端开放 short_name/email/address 维护；品牌关联改为外键引用。
6. **审批抄送（P1-1 / 冻结需求）**：approval_flows.levels 增加 cc 字段 + 抄送接口 + 前端「抄送我的」真实数据加载。
7. **审批流增强（P2-1）**：节点由模板驱动、支持并行、增加 DELETE/单条更新。
8. **角色管理可用化 + 死权限清理（P2-2/3）**：前端角色 CRUD + PUT；清理 9 项死权限。
9. **菜单结构整理（P2-4/5/6/7）**：图标去重、货代分析归类、冗余列清理、'*' 语义统一。

---

## 六、审计结论

系统管理模块**骨架完整、权限纵深防御基本到位（写操作受控）**，但存在若干长期运营隐患：
- 安全侧：敏感读接口对全体登录用户开放（中风险，需收窄）。
- 配置侧：配置页部分形同失效（硬编码覆盖），运维不可控。
- 主数据侧：品牌非独立、供应商缺国家，是长期运营最核心的短板。
- 冻结需求：审批抄送未落地。

**本轮为零改动只读审计，未实施任何修复。等待架构确认后，按以上顺序进入最小实施。**
