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

## 已知技术债（本版未解决，已确认风险可控）
- **普通（非 generate）接口仍使用单同步 worker（`db-sync-worker.js` + `Atomics.wait`）**。在极高并发（≈30 路并行）下存在串行等待，可能出现请求延迟上升。
- **本次测试结论**：在 12 路并行（120s 预算）与 30 路极端并行（150s 预算）的压力下，**均未出现进程崩溃、HTML 500、连接耗尽或 `status=0`**（30 路下的个别超时在给予 150s 预算后全部完成，属同步桥串行化延迟，非缺陷）。该架构债将在后续迭代（替换同步桥为统一 async DAL）中处理。

## 本版文件清单
- `server.js` — `APP_VERSION` 1.0.0→1.0.1；新增 `APP_COMMIT`/`APP_STARTED_AT`；`/api/version` 扩展返回 commit + deployTime；generate handler 改为 async PG 路径（P0）。
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
