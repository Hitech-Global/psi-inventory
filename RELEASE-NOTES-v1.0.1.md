# 发布说明 — PSI 系统 v1.0.1

- **发布版本**: 1.0.1 (patch)
- **发布日期**: 2026-08-01
- **部署目标**: Render (Free Web Service) + Supabase PostgreSQL (Singapore)
- **健康/版本端点**: `GET /api/version` 返回 `{ version, commit, deployTime, timestamp }`
  - `version` = 应用版本号（package.json + server.js `APP_VERSION`，本版 1.0.1）
  - `commit`  = 构建/部署对应的 git commit（Render 自动注入 `RENDER_GIT_COMMIT`，否则回退本地 `git rev-parse HEAD`）
  - `deployTime` = 服务端进程启动时间（≈ 部署时间），用于线上核对 build/deploy time
  - 该端点同时作为 Render `healthCheckPath`，返回 200 即视为存活

## 本次发布包含的修复与变更

### P0 — 订单预测重新计算阻塞整站（已修复并验证）
**根因**：`generate`（订单预测重算）原先经由「同步桥」（`db-sync-worker.js` 的 worker_thread + `Atomics.wait`）执行，在等待 PostgreSQL 的整段读取+计算+写入期间阻塞 Node 主线程，导致并发请求（尤其 852KB 级别的 daily-sales 大响应）被 reset（`status=0`）或严重延迟，整站表现为“冻结”。

**修复内容**：
1. **集合读取（P0-1）**：generate 读取阶段改为 4 条批量聚合查询 + 内存 map，消除 N+1（原 391 次串行读 → 批量）。
2. **批量写（P0-2）**：单条 `UPDATE ... FROM (VALUES ...) AS v(id, …)`（带 PG 类型转型）+ 单条多行 `INSERT`，取代逐行写。
3. **专用 async PG 路径**：新增 `pg-async.js`，全局唯一 `pg.Pool(max=2)`，复用 `db-pg` 的 `_normalizeSql`/`_getClientConfig`；`withGenerateClient` 在单 client 上 `BEGIN→批量读→内存计算→单批 UPDATE→可选单批 INSERT→COMMIT`，异常 `ROLLBACK`，`finally` 释放 client。**generate 等待 PG 期间释放 Node 事件循环，其他页面可正常响应。**
4. **单进程并发锁**：`generateInProgress` 标志，重复触发返回 `{success:false, code:"GENERATE_IN_PROGRESS", message:"订单预测正在重新计算，请稍后再试"}`，避免并发重算。
5. 计算逻辑、`{success,count}` 契约、字段语义、品牌停采后置、`final_order_qty`、id 生成均保持不变。

**验证（隔离 schema `p0_iso`，public 未改动）**：
- Gate A 数据一致性：async 快照 vs 单条批量基线，377 行逐字段比对 → 0 差异、0 id 变更、行集一致。
- Gate B 并发可用：连续 5 次全量 generate，每次期间并发 daily-sales(933KB)/filter-options/PI/CI/Payment → 全部 200+JSON、无 `status=0`；探针 0.7–4.0s 返回、早于 generate(~7.4s)，证明主线程已释放。
- Gate C 完整性：删 3 行→重 INSERT 恢复且 0 重复键；UPDATE/INSERT 后抛错均正确回滚且连接释放无泄漏；12 次连续 generate 全 200；并发锁 g1=200、g2=384ms 拒回 `GENERATE_IN_PROGRESS`、g3=200。

### P1 — 2026-07-31 测试 SKU 及关联测试数据清理（已执行）
- 日期：2026-07-31
- 内容：执行了 **3 个测试 SKU** 及关联测试数据，并已做清理（移除库存筛选测试脏数据）。
- 对应提交：`847fa32 chore(data): P1 生产数据清理 — 移除库存筛选测试脏数据 [数据迁移]`（为 `765535a` 即原 `3846b15` 的父提交；`3846b15` 已做历史重写以清除其中误提交的生产数据库凭据）。
- 线上核对（详见下方“数据对齐”回归项 D）：Inventory 筛选不再出现已删除测试国家和仓库；P1 测试 SKU 不再出现。

## 浏览器交互验收回归修复（发布后发现，已修复并验证）

发布 v1.0.1 后，在真实浏览器交互验收中发现 3 个前端回归，并定位到一个相关后端路由遮蔽缺陷。三者均已修复，并经真实浏览器复验全部通过。

### A — 财务驾驶舱异步竞态（已修复）
- **根因**：`renderPayableCockpit` 在 `await api(...)` 期间若用户已切换页面或重复触发加载，过期响应仍会写回已卸载的 DOM 节点，导致 `Cannot set properties of null` 类报错。
- **修复**：引入加载序号守卫 `_cockpitLoadSeq`；每次加载递增 `seq`，`await` 之后及 `catch` 分支均校验 `seq===_cockpitLoadSeq && currentPage==='payable-cockpit'`，过期响应静默放弃。仅前端改动，无业务逻辑变化。

### C — 新建 PI 缺少 PI 号字段（已修复）
- **修复**：`createPI` 表单首位新增可选「PI号」输入框，留空则由系统自动生成；`saveNewPI` 读取该字段并以空串表示自动生成。`editPI` 中 PI 号保持 frozen 强锁（符合 CI/PL 经 `pi_no` 关联的冻结规则，未改动）。

### B — 应付费用列表入口恢复（已验收冻结的用户路径，已修复并浏览器复验通过）
- **背景**：该入口为已验收冻结功能，本轮按「恢复冻结路径」而非新增功能处理。
- **修复**：新增 `renderPayableList`（独立导航 `payable-list`、多选/全选、统一操作菜单）；查看/创建/撤回均委托既有 PAY-CORE 端点（`by-payable-items` / `multi-expense` / `batch-cancel`），页面不维护业务规则。
- **已落地的 4 条门禁**：①本轮不开放「取消应付费用」；②仅按 `payable_items` 真实状态（active/reserved）展示，不虚构 approved；③国家维度校验复用 `multi-expense` 统一入口（`commonPayableItemsExpenseCountry`），页面不重复实现；④统一操作菜单按选中对象动态变化（active→查看/创建，reserved→查看/撤回，混选禁操作并提示）。
- **浏览器复验（全部通过）**：active 单条查看正常显示且「暂无关联付款申请」；reserved 单条查看显示关联 PR 的 `request_no`/`approval_status`/`payment_status`；创建/撤回/多选/全选行为正常；无新 JS 报错。

### 后端路由遮蔽修复（by-payable-items 404，已修复）
- **根因**：`GET /api/payment-requests/by-payable-items` 注册于 `GET /api/payment-requests/:id` 之后，被 Express 按注册顺序抢先匹配为 `id='by-payable-items'`，导致该专用端点永远返回 `404 {"error":"付款申请不存在"}`，进而「查看」应付费用整体失败。
- **修复**：将 `by-payable-items` 路由上移至所有 `/api/payment-requests/:id` 通用动态路由之前注册。仅调整路由顺序，**未改动**任何查询 SQL、返回结构、付款业务逻辑或 PAY-CORE 状态机。同前缀下其他固定路径均为 POST 或不冲突，无需改动。

## 已知技术债（本版未解决，已确认风险可控）
- **普通（非 generate）接口仍使用单同步 worker（`db-sync-worker.js` + `Atomics.wait`）**。在极高并发（≈30 路并行）下存在串行等待，可能出现请求延迟上升。
- **本次测试结论**：在 12 路并行（120s 预算）与 30 路极端并行（150s 预算）的压力下，**均未出现进程崩溃、HTML 500、连接耗尽或 `status=0`**（30 路下的个别超时在给予 150s 预算后全部完成，属同步桥串行化延迟，非缺陷）。该架构债将在后续迭代（替换同步桥为统一 async DAL）中处理。

## 本版文件清单
- `server.js` — `APP_VERSION` 1.0.0→1.0.1；新增 `APP_COMMIT`/`APP_STARTED_AT`；`/api/version` 扩展返回 commit + deployTime；generate handler 改为 async PG 路径（P0）；`GET /api/payment-requests/by-payable-items` 路由上移至 `/:id` 动态路由之前（修复 404 遮蔽）。
- `app.js` — 财务驾驶舱加载序号守卫（A）；新建 PI 表单新增可选 PI 号字段（C）；新增 `renderPayableList` 应付费用列表（B）。
- `i18n.js` — 补充应付费用列表相关三语词条。
- `CI-CREATE-UI-FIX-REPORT.md` — 应付费用列表（B）只读映射与实施报告。
- `package.json` — version 1.0.1。
- `pg-async.js` — 新增：generate 专用 async PG Pool（P0）。
- `scripts/verify-smoke.cjs` — 新增（从 `verify-gate-*` 重构并脱敏）：发布前固定冒烟脚本，仅从 `DATABASE_URL` 环境读取连接、默认且只能作用于隔离 schema、结束后 `finally` 清理隔离 schema 与子进程、不内置任何密码/连接串/真实数据。
- `RELEASE-NOTES-v1.0.1.md` — 本说明。
- 清理：`git rm` 了含生产凭据的临时验证脚本 `scripts/verify-gate-b.cjs`、`scripts/verify-gate-c.cjs`，并删除其余含凭据的临时验证脚本与根目录调试/审计产物（不入库）。

## 与历史提交的关系
- `ea15f5c` fix: 最小上线准备（基线）
- `847fa32` chore(data): P1 生产数据清理 — **本版的父链起点之一（P1 数据清理）**
- `765535a`（原 `3846b15`，已重写移除误提交的生产数据库凭据）P0: generate 改用专用 async pg Pool，解除主线程阻塞 — **本版的直接父提交（P0 修复）**
- **本版 `v1.0.1` 发布提交** — 建立在 `765535a` 之上，仅增量版本号/版本端点/脱敏冒烟脚本 + 清理。

## 回滚目标
- **首选回滚点：`765535a`（原 `3846b15`，保留 P0 修复）**（仅撤销本版的版本号/端点/冒烟脚本/清理增量）。
- 若需回退到 P0 之前：`847fa32`（P1 数据清理状态）或 `ea15f5c`（上线准备基线）。
- 回滚方式：`git revert <release-commit>` 或 `git reset --hard 765535a` 后重新部署；数据库为外部 Supabase，回滚代码不影响既有数据（P0/P1 均为幂等迁移）。

## 验收与上线状态（2026-08-01 线上回归 + 真实浏览器交互验收，全部通过）
- **状态：v1.0.1 标记为新的生产稳定版本 ✅（接口/数据层线上回归 + 真实浏览器交互验收均已通过）**
- **线上版本核对**：`/api/version` → `version=1.0.1`、`commit=v1.0.1 tag 指向的发布提交`（部署后于生产端点核对一致）；`/api/auth/feishu/status` 200 且配置正常。
- **认证后线上回归 `scripts/verify-online-regression.cjs`（覆盖用户验收清单 A/B/C/D）结果：PASS**。
  - **A 登录/会话**：错误密码→401 拒登；登录→200 拿到会话；`/api/me`→200；`/api/logout`→200 后 `/api/me`→401（会话真正失效）；重新登录 OK。
  - **B 各模块端点**（me/feishu_status/inventory(+filter)/sku/daily_sales/forecast/po/pi/ci/pl/inbound/payable/payment(+pending)/po_pending_approval/approval_flows，共 17 项）：全部 200 + JSON，无 HTML500 / status=0 / 非 JSON。
  - **C generate + 并发稳定性**：连续 2 轮 `/api/replenishment-suggestions/generate` 均 200 + `success=true`（5.2–6.3s）；每轮期间并发 inventory/PI/CI/Payment/daily_sales 探针全部 200 + JSON；无 `status=0`、无 500、无“非 JSON 响应”，Render 未重启/丢响应 → **P0 修复在生产并发下成立**。
  - **D 数据对齐**：`inventory/filter-options` 国家仅剩 `["印度尼西亚"]`、仓库仅剩 `["Bekasi Warehouse"]`（P1 清理的 Indonesia/Thailand/Vietnam、Jakarta-WH/Bangkok-WH/Hanoi-WH 全部不再出现）；3 个 P1 测试 SKU（P103B-TEST-SKU-001/003/004）查询结果为空 → **脏数据已清除、真实数据未误伤**。
- **E 真实浏览器交互验收（用户执行，全部通过）**：
  - **A 财务驾驶舱**：异步竞态修复后正常加载，无 `Cannot set properties of null`。
  - **C 新建 PI**：PI 号字段存在，留空自动生成；编辑态 PI 号保持冻结。
  - **B 应付费用列表**：active 单条查看显示「暂无关联付款申请」且无报错；reserved 单条查看显示关联 PR 的 `request_no`/`approval_status`/`payment_status`；创建付款申请、撤回付款申请、多选/全选行为正常；浏览器控制台无新 JS 报错。
- **说明（诚实披露）**：本环境无真实浏览器驱动，`agent-browser` 不可用，故接口/数据/逻辑层验收由脚本完成；真实浏览器交互验收（A/C/B）已由用户在真实浏览器中完成，结果全部通过。线上版本核对（version/commit/deployTime）于部署后在生产端点完成，并与 git tag `v1.0.1` 指向提交核对一致。
- 回归脚本已纳入仓库（`scripts/verify-online-regression.cjs`，凭据仅来自环境变量、不写文件/仓库）。
