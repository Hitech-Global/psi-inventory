# PUR-OPS-COLLAB-01 · 只读审计 + 最小实现方案（待确认，零代码修改）

- 日期：2026-07-18
- 阶段：只读审计（本阶段不修改任何代码；输出方案 → 等待确认 → 实施）
- 目标：设计「CI 确认后 → 电商运营上架准备」闭环，避免货到仓库但运营未准备导致库存无法销售。
- 纪律：只读排查 → 输出方案 → 确认 → 最小修改 → 隔离测试 → 验收。

---

## 一、当前架构事实（只读核实）

### 1. CI 数据结构
- **`commercial_invoices`**（db.js:760-794 建表；状态索引 db.js:1731）：关键列 `id, ci_no(UNIQUE=CI编号), related_po_id/no, related_pi_id/no, supplier_*, brand, country, target_warehouse, ci_date(NOT NULL), ci_status(DEFAULT 'draft'), cost_confirmed, wac_confirmed, actual_ship_date, created_at/updated_at`。
- **CI 状态机实际取值**（server.js 核实）：`draft`(默认) → `uploaded`(创建) → `ci_pl_uploaded`(PL上传) → `completed` / `partial_inbound`(入库) / `cancelled`(作废)。**不存在 `confirmed` 状态。**
- 最接近「确认」的概念 = 两个布尔标志：`cost_confirmed=1`（confirm-costs 路由 server.js:6913）与 `wac_confirmed=1`（WAC 确认路由 **server.js:7280**，事务内最后置位）。
- **`commercial_invoice_items`**（db.js:832-846）：`id, ci_id, ci_no, pi_no, sku_code(NOT NULL), shipped_qty(=数量), unit_price, ci_amount, inbound_qty, uninbound_qty, created_at`。SKU+数量来源。
- **到货信息**：最接近字段 `actual_ship_date`（db.js:1863，实际出货日期）；**无 ETA / 到货日期 / 预计入库字段**（V1 可新增或用 actual_ship_date 映射）。
- **当前无 owner / cc / 计划上架日期 / ready 状态列** → V1 须新增。

### 2. 用户体系
- **`users`**（db.js:93-103 + 迁移 109-113）：`id, username(UNIQUE), name, role_id(DEFAULT 'role_viewer'), status('active'/'disabled'/'pending'), auth_source, feishu_open_id(UNIQUE), feishu_union_id, feishu_user_id, password_hash`。飞书通知依赖 `feishu_open_id`。
- **`roles`**（db.js:80-89）：`id, name, description, permissions(JSON), is_system`。默认 `role_admin / role_operator(运营) / role_viewer`。`role_operator` 权限含 `ci_view/ci_create/ci_edit/cost_view`（db.js:1916-1931），**无独立「上架/ops」角色、无 `ops_*` 权限**。
- **系统管理 UI**（app.js:165-184 侧栏「系统管理」；`renderUsers` 913-951、`renderRoles` 959 + `editRolePerms` 972-1014）：管理员可启停用户、分配角色、编辑角色权限（复用 `POST /api/roles` upsert）。足以支撑为新功能授权。
- **`GET /api/cc-candidates`**（server.js:1162-1169）：返回全部 `status='active'` 用户（`id,name,username,role_id,role_name`）—— 审批 CC 选择已复用，V1 直接复用。

### 3. 页面结构
- CI 列表/详情**已存在**：`renderCI`(app.js:5888)、`renderOperationalCITable`(5893)、`loadCI`(5903)、**`viewCI(id,...)`(app.js:5965)** 打开「CI/PL 详情」模态框（基本信息 + CI 明细 + PL 明细），由列表 `onclick="viewCI(id)"` 触发。
- **无独立「运营中心 / 上架准备」页面**：导航（app.js:136-185）仅有 首页看板 / 库存 / 销售 / 采购链(CI/PL 管理, perm `ci_view`) / 审批中心 / 财务 / 系统管理。**无「电商上架」「运营准备」入口。**
- **判断**：V1 应**挂载到现有 `viewCI` 详情模态框**（app.js:5965）内新增「上架准备」分区（读 commercial_invoices 新列 + 查 business_participants），**无需新建导航页**。符合「不改采购链 / CI 逻辑」。

### 4. business_participants 复用
- 建表（db.js:359-369）：`id, business_type, business_id, participant_type, user_id, user_name, created_at` + 索引 `idx_business_participants(business_type,business_id,participant_type)`（db.js:1753）。**无 UNIQUE 约束**，写入需应用层按 `user_id` 去重（审批已用 `Set` 去重，server.js:3901-3909）。
- 当前用法：`business_type='approval', participant_type='cc'`（写入 server.js:3919；读取 server.js:233/3655）。
- **可完全复用**：`business_type='ci'`, `participant_type IN ('cc','owner')`。db.js:356-358 注释已预留 `'ci_prep'`。无外键，CI 删除时参与人需手动清理（或忽略，V1 可不做）。

### 5. FEISHU-NOTIFY 复用点
- 组件位置：getFeishuTenantToken(server.js:177)、sendFeishuTextMessage(194)、FEISHU_NOTIFY_TEMPLATES(214-219, 4 键)、notifyApprovalParticipants(222, 签名 `(approvalId, eventType, ctx)`)、4 触发钩子(submit 3926 / approved_final 3976 / approved_intermediate 3981 / reject 3988)。
- 收件人解析（server.js:222-253）：查 approval_records→取 PO 号；addUser 按 users.id 取 feishu_open_id 入 Map；CC 来自 business_participants('approval',id,'cc')；按 eventType 分支取审批人/提交人；按模板生成文案逐人发送。
- **泛化改造（只读评估，不改）**：将签名改为 `notifyBusinessParticipants(businessType, businessId, eventType, ctx)`；收件人统一从 `business_participants WHERE business_type=? AND business_id=? AND participant_type IN ('cc','owner')` 取出（复用 server.js:233 同款查询、仅改参数）；`eventType` 新增 `'ci_ops_assigned'` / `'ci_ops_ready'`，在 FEISHU_NOTIFY_TEMPLATES(214) 增模板；文案变量从 `ctx.ci_no` 读取。逻辑层不引入审批分支，仅 owner+cc 满足 V1。
- **CI Confirmed 触发位置（候选）**：现有最契合挂钩点 = `wac_confirmed=1`（server.js:7280，事务内 UPDATE 后、res.json 前）→ 在此追加 fire-and-forget 通知（best-effort，同审批钩子）。

---

## 二、最小实现方案（待确认）

**原则**：仅新增 / 挂载，不触 ci_status 机、采购链、WAC 计算、库存逻辑。

1. **数据层（db.js 幂等迁移）**：`commercial_invoices` 追加 `ops_owner_id`、`ops_plan_listing_date`、`ops_ready_status(DEFAULT 'pending')`；CC 入 `business_participants(business_type='ci', participant_type='cc')`。参考 db.js:1862-1873 风格做 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`。
2. **新路由（不碰现有 CI 路由）**：
   - `POST /api/commercial-invoices/:id/ops-prep`：校验 owner(存在/active) + CC 列表(存在/active/去重) → 写 ops_owner_id + ops_plan_listing_date + ops_ready_status='pending' + 写 CC 行 → fire-and-forget 通知(businessType='ci', businessId, eventType='ci_ops_assigned')。
   - `POST /api/commercial-invoices/:id/ops-ready`（或 PATCH）：仅 owner/admin 可置 ops_ready_status='ready' → 通知 CC(eventType='ci_ops_ready')。
   - 权限：新增 `ops_prep`（挂 role_operator）或复用 `ci_edit`。
3. **触发通知复用 FEISHU-NOTIFY**：泛化 notify 函数 + 2 模板；沿用 dryrun / FORCE_FAIL 标志做隔离测试。
4. **CI 确认门槛（关键待确认）**：`viewCI` 的「上架准备」分区仅在 CI 处于「已确认」态可编辑。推荐以 `wac_confirmed=1` 作为「CI 确认」门槛（或 `ci_status IN ('ci_pl_uploaded','completed','partial_inbound')`）。

---

## 三、数据模型建议

```sql
-- commercial_invoices 新增列（ALTER ADD COLUMN IF NOT EXISTS，幂等）
ops_owner_id           TEXT     -- 负责人 user.id
ops_plan_listing_date TEXT     -- 计划上架日期 yyyy-mm-dd
ops_ready_status      TEXT DEFAULT 'pending'  -- pending | ready

-- business_participants 复用，不新建表
--   business_type='ci', participant_type IN ('cc','owner')
--   CC:  (business_type='ci', participant_type='cc',     user_id)
--   owner 冗余存一份 (business_type='ci', participant_type='owner', user_id) 便于统一通知解析
```

- SKU / 数量 / 到货：**直接读** `commercial_invoice_items`(sku_code, shipped_qty) 与 `commercial_invoices`(actual_ship_date / ci_date)，**不另存**（V1 展示用，避免数据漂移）。
- 不新增图片 / Listing / 广告 / 活动 / 运营内部流程字段（V1 范围外）。

---

## 四、页面建议

- **不新建页面**：在 `viewCI`(app.js:5965) 模态框内追加「上架准备」分区（位于 CI 明细 / PL 明细之后）。
- 分区内容：CI 编号(只读) · SKU+数量(读 items) · 到货信息(读 actual_ship_date/ci_date) · 负责人(下拉复用 `GET /api/cc-candidates` + 角色过滤) · CC(多选复用 cc-candidates) · 计划上架日期(date input) · Ready 状态(待准备/已就绪 切换，仅 owner/admin)。
- 只读 / 可编辑受 `ops_prep` 权限 + CI 确认门槛控制。
- 未来若要独立运营工作台再拆页，V1 不预建。

---

## 五、待用户确认的关键决策

**Q1：V1 的「CI 确认」触发定义（决定通知 / 可编辑门槛挂哪）**
- (A) 以 `wac_confirmed=1`（server.js:7280，成本/WAC 确认完成）作为「CI 确认」信号【推荐：财务闭环后运营开始准备，确定性强，不新建「确认」概念】；
- (B) 以 CI 上传完成(`uploaded`)作为更早触发（给运营最长提前期，但 CI 仍可能作废）；
- (C) 不引入 CI 状态事件，改为「运营在 CI 详情保存上架准备(负责人+CC+计划上架日期)」动作本身即触发通知（负责人/CC 分配即通知）。

**Q2：CI 确认时是否需要「通知固定运营群/角色」（如全部 role_operator）？** 还是仅负责人+CC 分配时通知即可？
（影响是否要为 FEISHU-NOTIFY 增加「按角色解析收件人」能力）
