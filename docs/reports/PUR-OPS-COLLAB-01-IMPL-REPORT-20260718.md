# PUR-OPS-COLLAB-01 实施验收报告（2026-07-18）

## 任务目标
设计「CI 确认（wac_confirmed=1）后 → 电商运营上架准备闭环」，避免货到仓库但运营未准备导致库存无法销售。
V1 仅管理：CI 编号 / 负责人 / 抄送(CC) / 计划上架日期 / Ready 状态。
不管理：图片 / Listing / 广告 / 活动 / 运营内部流程。
未触碰：采购链、CI 状态机、WAC、库存逻辑（遵循冻结约束）。

## 两项用户决策（已确认）
- CI 确认门槛 = `wac_confirmed = 1`（推荐项）。
- 通知范围 = 仅负责人 + CC（推荐项），不固定运营群/角色。

## 已修改文件（实际落库）
1. **db.js**（opsPrepMigration，约 1894–1907 行）
   - `commercial_invoices` 新增 3 列：`ops_owner_id`、`ops_plan_listing_date`、`ops_ready_status`(默认 'pending')。
   - 复用既有 `business_participants`（business_type='ci'，participant_type ∈ {'owner','cc'}）。
   - 该迁移在每次 server 启动时自动执行（含未来对生产库启动），无需手动迁移。
2. **server.js**
   - 新增 2 个通知模板 `ci_ops_assigned` / `ci_ops_ready`（FEISHU_NOTIFY_TEMPLATES，约 219 行）。
   - 新增通用函数 `notifyBusinessParticipants(businessType, businessId, eventType, ctx)`（约 262 行），复用 users.feishu_open_id、跳过无 open_id 用户、best-effort `.catch(()=>{})`。
   - 新增 3 个路由（约 7314–7392 行）：
     - `GET /api/commercial-invoices/:id/ops-prep`（`ci_view`）— 返回 wac_confirmed、ops_owner_id/name、plan_listing_date、ready_status、cc 列表。
     - `POST /api/commercial-invoices/:id/ops-prep`（`ci_edit`）— 校验 wac_confirmed=1 门槛；校验 owner/CC 存在且 active、去重；事务写库 + 重建 business_participants；事务外 best-effort 通知。
     - `POST /api/commercial-invoices/:id/ops-ready`（`ci_edit`）— 仅 owner 或 admin(role_admin / '*') 可标记 ready；best-effort 通知 CC。
3. **app.js**（viewCI 注入 + 4 个前端函数）
   - `viewCI` 末尾向 modal-body 注入上架准备分区（DOM 注入，不改动上方大字符串）。
   - 新增 `renderOpsPrepSection` / `saveOpsPrep` / `setOpsReady` / `refreshOpsPrep`。
   - 只读态（无 ci_edit 权限）仅展示；可编辑态提供负责人下拉、计划日期、CC 多选、保存、标记 Ready 按钮。
   - 修复：此前 `renderOpsPrepSection` 被调用但未定义（Edit 旧=新导致未落地），本次补全，消除打开 CI 详情时的 ReferenceError。
4. **index.html** — 新增 `.badge`/`.badge-success`/`.badge-warning`/`.cc-list`/`.cc-check` 样式。

## 隔离测试（30/30 全绿，已在独立副本运行后删除）
纪律：父进程仅 `cp` 生产主库到副本；仅子进程经 HTTP 驱动；FEISHU_NOTIFY_DRYRUN=1 记录 payload，FEISHU_NOTIFY_FORCE_FAIL=1 验证韧性；生产库零污染。

覆盖断言（T1–T7）：
- T1 读取上架准备（wac_confirmed=true、初始 pending）。
- T2 保存成功(200) + 通知 owner + 通知 CC + 无 open_id 用户(u_local)被跳过。
- T2 DB 落库：ops_owner_id / plan_listing_date / ops_ready_status / business_participants(owner1+cc2)。
- T2b 重复保存去重重建（owner1+cc1）、计划日期更新。
- T3 标记 Ready(200) + DB ready + dryrun 日志增长 + CC 收到 ci_ops_ready。
- T4 未确认 CI(wac_confirmed=0) 保存被拒(400) + 未落库 + 无参与人。
- T5 非 owner 非 admin 标记 Ready 被拒(403)。
- T6 /api/version 正常（非本功能逻辑未受影响）。
- T7 FORCE_FAIL 下保存仍 200（best-effort 不阻断事务）+ dryrun 含 forced_fail + 事务已提交。
- 生产库零污染：CITEST* CI=0、UT_ 用户=0、business_participants(ci)=0、测试会话=0。

## 关键调试发现（透明披露）
1. **测试侧缺陷（非代码缺陷）**：原测试在 server 启动【前】注入 user_admin 会话；而 `bootstrapBreakGlass()` 在 `BREAKGLASS_ADMIN_PASSWORD` 与已存哈希不符时会 `DELETE FROM sessions WHERE user_id='user_admin'`，导致所有管理员 API 返回 401，进而所有权限相关断言"假阴性"失败（实际是 401 而非 400/403/200）。
   - 修正：会话改为 server 启动【后】注入（`seedSessions`），数据为启动前种子。修复后 30/30 全绿。
2. **生产库现状（预期）**：生产库 `inventory.db` 当前缺 `business_participants` 表与 `ops_*` 列——因该库从未以含本迁移的代码启动。测试副本经 server 启动后已正确补齐（验证迁移有效），生产库将在下次正常启动该代码时自动补齐，无需手工迁移。
3. **前端补全**：`renderOpsPrepSection` 此前因 Edit 旧串=新串未落地而缺失，本次补全。

## 验收结论
PUR-OPS-COLLAB-01 实施完成并通过隔离验收：后端 3 路由 + 通知复用、前端 CI 详情上架准备分区、数据模型（ops_* 列 + business_participants 复用）均按冻结约束落地，未改动采购链 / CI 逻辑 / WAC / 库存逻辑；生产库零污染。

## 后续（待用户确认，不自行扩大）
- 真实飞书发送联调仍等待 AUTH-FEISHU-LIVE-01 L1 权限；权限就绪后做真实发送冒烟（沿用 FEISHU-NOTIFY-01 dryrun→真实切换）。
- 不扩大范围至图片 / Listing / 广告 / 活动。
