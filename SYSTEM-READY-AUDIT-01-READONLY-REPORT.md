# SYSTEM-READY-AUDIT-01 只读审计报告

> 审计日期：2026-07-18
> 审计性质：**只读排查**（未修改任何代码、未运行任何写操作、未提交 git）
> 方法：静态代码审查（server.js / db.js / app.js / index.html）+ 配置审查（.env / .gitignore / package.json）+ 启动流程审查
> 纪律：只读 → 输出报告 → 等待确认 → 最小修复（本阶段仅产出报告）

---

## 0. 总体结论（上线就绪度）

| 范围 | 结论 | 说明 |
|---|---|---|
| 1. 业务闭环 | ✅ 就绪 | PO→PI→CI→PL→Inbound 链路完整，冻结守卫完好 |
| 2. 权限边界 | ⚠️ 条件就绪 | 默认仅 3 角色；财务付款审批 `payment_approve` 仅 admin 拥有 |
| 3. 数据完整性 | ✅ 就绪 | 外键开启 + WAC 锁定触发器；须先备份再迁移 |
| 4. 系统稳定性 | ⚠️ 条件就绪 | 缺全局错误处理中间件；无进程管理器 |
| 5. 用户体验 | ⚠️ 基本就绪 | 提示/空数据/权限提示齐全；防重复点击覆盖不全 |
| 6. 部署上线 | ❌ 未就绪 | 无部署产物；无备份/恢复方案；git 工作树脏；NODE_ENV 未锁定 |

**一句话**：业务功能与数据防护已达上线质量；**部署运维层与安全配置层是上线前必须补齐的短板**。

---

## 1. 业务闭环检查

逐项核验，均发现对应路由且链路连续：

- **PO → PI → CI → PL → Inbound**
  - PO 创建/审批：`/api/purchase-orders`（`PO→PI` 关联经 `related_po_id`）
  - PI 创建：`/api/proforma-invoices`（L1B-2-3 付款类目已落地）
  - CI 创建：`/api/commercial-invoices`（**P1-STATE-01B 守卫完好**，见下）
  - PL：`/api/packing-lists`
  - Inbound：`/api/inbound-records`
- **CI Confirmed → 运营准备**：PUR-OPS-COLLAB-01（本阶段刚验收）落地，`/ops-prep`、`/ops-ready` 三路由 + 通知，触发信号 `wac_confirmed=1`。
- **库存 → 销售 → 预测 → 补货**：`/api/inventory`、`/api/sales-records`、`/api/replenishment-suggestions`（含 `/generate`），按冻结口径"方案 A+B、实时算、不回写 available_qty"。
- **WAC → 成本**：`/api/cost-allocation/*`、`/update-weighted-avg`、`/wac-history`、`/cost-update-logs`（P1-03-B/C 验收，成本只写派生表，不写 inventory）。
- **Payment → 应付**：`/api/payment-requests`、`/finance/payable-cockpit`（PAY-CREDIT-DUE-01 落地）。

**冻结规则核对（确认未被违反）**：
- ✅ CI 必须关联 PI（`server.js:4352`：①未关联 PI → 400；②`need_deposit && deposit_payment_status!='paid'` → 拒绝）。历史 CI 导入为独立流程，豁免（设计预期）。
- ✅ 定金结清判断 = `deposit_payment_status='paid'`，未改用现金金额/部分态。
- ✅ 采购链不回写 `inventory.available_qty`；WAC 计算不动库存。
- ✅ WAC 历史锁定触发器 `trg_wac_history_block_update/delete` 存在（`db.js:1772/1780`），工作库不得禁用。

---

## 2. 权限边界检查

- **角色模型**：`role_admin` / `role_operator` / `role_viewer` 三档（`db.js:1955-1960`）。
- **校验点**：181 处 `requireApiPermission`，行为正确——未登录返回 **401**，无权限返回 **403**（`server.js:441-447`）。
- **权限字符串**：覆盖 40+ 细粒度权限（system_config / ci_* / po_* / pi_* / payment_* / cost_* / inventory_* / outbound_* / replenishment_* 等）。

**⚠️ 发现 A（权限粒度缺口）**：
- `role_operator` 不含 `payment_approve`、`user_manage`、`role_manage`、`system_config`（`db.js:1931-1946`）。
- **`payment_approve`（付款审批）仅 `role_admin` 拥有**（`db.js:1925`）。即"财务审核付款"这一职责在默认角色里没有独立承载——财务人员要么用 admin（权限过大），要么需由管理员新建自定义角色分配 `payment_approve`。
- 审计范围提到的"采购 / 财务 / 运营"并未拆成独立默认角色，全部归入 `operator`（除付款审批归 admin）。是否新增"财务审批"等自定义角色属**业务决策**，需你确认，本轮不自行新增。

---

## 3. 数据完整性检查

- **外键约束**：`db.pragma('foreign_keys = ON')`（`db.js:21`）——引用完整性已开启，避免孤儿记录。
- **WAC 版本锁定**：`wac_history` 表 + 两 BEFORE 触发器拦截 `is_locked=1` 行的 UPDATE/DELETE（固定错误码 `LOCKED_WAC_HISTORY_*`）。已确认存在且未被改动。
- **汇率 / 付款 / 应付 / 库存快照表**：`exchange_rates`、`payment_requests`、`system_config`（应付日期来源）、`inventory`（含快照截止 `inventory/snapshot-cutoff-date`）均存在。
- **⚠️ 发现 B（生产迁移风险）**：存在**表重建式迁移**——`payment_subcategories` / `payment_subcategory_sources` 采用"建新表 → 复制 → DROP 旧表"（`db.js:1275-1340`，因 SQLite DROP COLUMN 不支持删 CHECK 引用列）。该迁移**幂等**（仅旧 schema 触发），但运行后旧表被 DROP，**不可逆**。生产迁移前**必须先整库备份**。

---

## 4. 系统稳定性检查

- **启动流程**：迁移在模块加载期 `getDB()` 内执行（`db.js:13` 起），早于 `app.listen`（`server.js:8351`），**无竞态**。`bootstrapBreakGlass()` 在 `BREAKGLASS_ADMIN_PASSWORD` 缺失/不符时 fail-closed 拒绝启动（`server.js:8349` + `:287`）。
- **迁移幂等性**：全部 `CREATE TABLE IF NOT EXISTS` + `ALTER` 包裹 `try/catch` 吞掉已存在错误，可重复运行。
- **环境变量依赖**（共 17 项）：`DB_PATH`、`PORT`、`NODE_ENV`、`FEISHU_APP_ID/SECRET/REDIRECT_URI`、`FEISHU_NOTIFY_DRYRUN/FORCE_FAIL`、`FEISHU_MOCK`、`BREAKGLASS_ADMIN_PASSWORD`、`TRUSTED_ORIGINS`、`SESSION_TTL_HOURS`、`CSRF_FORCE/DISABLE`、`COOKIE_SECURE`。`FEISHU_MOCK=1` 在非 test 环境 **fail-closed 拒绝启动**（`server.js:41`），安全。
- **⚠️ 发现 C（全局错误处理缺失）**：**无 `app.use((err,req,res,next)=>{})` 全局错误处理中间件**。211 个路由中约 185 处有局部 `try/catch`（106 处 `res.status(500)`），覆盖较好但**非 100%**。任何未被局部捕获的异步异常会演变为 `unhandledRejection`，当前仅 `console.error` 记录（`server.js:8344`），**请求侧可能挂起/无响应**。建议补全局错误中间件。
- **⚠️ 发现 D（无进程管理器）**：无 PM2 / systemd / Dockerfile。`uncaughtException` 处理器仅记录不退出（`server.js:8341`），进程崩溃后**无自愈**。生产需外部 supervisor。
- **飞书通知默认态**：`NODE_ENV=test` 或 `FEISHU_NOTIFY_DRYRUN=1` 或 `FORCE_FAIL=1` 时走 dryrun（`server.js:178`）；**生产默认会真实发送**（best-effort，`.catch` 不阻断业务）。真实发送依赖 AUTH-FEISHU-LIVE-01 L1（飞书后台 bot + im:message 权限），当前未完成。

---

## 5. 用户体验检查

- **成功/失败提示**：`showToast(msg, type)`（`app.js:11`）统一提示，type=info/success/danger。
- **空数据展示**：约 41 处"暂无数据"等空态（`app.js`）。
- **权限不足提示**：后端 403 → 前端 `showToast(e.message,'danger')`，体验正确。
- **提交 loading / 防重复点击**：关键保存/导入按钮已有 `btn.disabled=true; btn.textContent='保存中…'` 守卫（约 16 处，如 `app.js:1398/1608/1707/1828/2321` 等）。
- **⚠️ 发现 E（防重复点击覆盖不全）**：全前端约 173 个 `api(`/`fetch(` 调用点，仅 16 处显式 `disabled=true` 守卫。多数写操作（尤其部分 POST/审批/批量导入之外的表单）**缺少提交后禁用**，快速连点可能产生重复提交（如重复建单/重复付款请求）。建议补充通用提交守卫（表单级 disabled 或请求锁）。

---

## 6. 部署上线准备

- **❌ 发现 F（无部署产物）**：仓库内**无任何** Dockerfile / Procfile / `ecosystem.config.js`(PM2) / systemd unit / nginx 配置。仅 `package.json` 的 `start`/`dev`/`seed`。上线须补部署清单（进程管理器 + 反向代理 + 持久化卷）。
- **❌ 发现 G（NODE_ENV 未锁定）**：`NODE_ENV` 默认空串（`server.js:39`）。CSRF 防护**仅在 `NODE_ENV='production'` 时强制开启**（开发/测试态默认关闭，`server.js:49-50`）；且 Express 错误栈仅在 production 下隐藏。部署环境**必须显式设置 `NODE_ENV=production`**，否则 CSRF 关闭 + 错误泄露栈。
- **✅ .env 处理**：`.env` 已被 `.gitignore` 排除（密钥不入库）；存在 `.env.example` 模板。但部署目标须自行 provision `.env`（含 `FEISHU_*` / `BREAKGLASS_ADMIN_PASSWORD` / `DB_PATH`）。
- **❌ 发现 H（备份/恢复方案缺失）**：仓库内**无 backup / restore 脚本或文档**。数据库 `data/*.db` 被 `.gitignore` 排除，依赖部署侧持久化。上线前须明确：备份方式（如 `sqlite3 .backup()` 或文件级拷贝，注意 WAL `-shm/-wal`）、恢复演练、迁移回滚预案。
- **❌ 发现 I（git 工作树脏）**：当前有未提交修改——`app.js / db.js / index.html / server.js`（含 PUR-OPS-COLLAB-01 改动及更早阶段累积），以及大量未跟踪文件：`.backup-approval01*/`、`.backup-fix01/02/`、`.backup-role01/`、`/backup-ux01/02/`、`.env.backup.*`、若干 `*IMPL-REPORT*.md`、以及散落的 `A-Step1_*.md`。**部署前置条件：先 commit 已验收阶段、清理 `.backup-*` 残留与临时报告**，避免把审计/临时产物带上生产。
- **⚠️ 发现 J（飞书登录启用状态）**：登录页 `doFeishuLogin()` 无条件跳转 `/api/auth/feishu/login`（`app.js:104`），**无配置开关**；`.env` 已含 `FEISHU_APP_ID/SECRET/REDIRECT_URI`，即飞书登录实际已启用。但 AUTH-FEISHU-LIVE-01 **L1 尚未完成**（飞书后台 bot + im:message 权限未确认）。上线前须：①完成 L1，或 ②明确以 break-glass 应急登录先行、飞书后置。否则用户点飞书登录可能因后台配置不全而失败（可退用 break-glass，但非预期主路径）。

---

## 7. 上线阻断项（Blockers）与建议修复

### 阻断项（上线前必须解决）
- **B1 部署产物 + NODE_ENV**：补进程管理器（PM2/systemd）+ 反向代理；部署环境强制 `NODE_ENV=production`（CSRF 与错误栈依赖）。
- **B2 备份/恢复方案**：提供 backup 脚本（含 WAL 文件）+ restore 演练 + 迁移前全量备份 + 回滚预案。
- **B3 飞书登录 L1**：完成 AUTH-FEISHU-LIVE-01 L1（飞书后台 bot + im:message），或明确 break-glass 先行策略。
- **B4 git 工作树清理**：commit 已验收阶段；删除 `.backup-*` 残留目录与散落临时报告/`.env.backup.*`。

### 建议修复（待你确认后最小实施）
- **R1 全局错误处理中间件**：Express `errorHandler` + async 包装，确保任何异常均返回 JSON 500，杜绝请求挂起。
- **R2 前端防重复点击通用守卫**：表单级提交锁（disabled + loading），补齐 E 类缺口。
- **R3 财务审批角色**：是否新增"财务"自定义角色并分配 `payment_approve`（业务决策，勿自行扩大）。
- **R4 生产迁移安全**：对 `payment_subcategories/sources` 表重建迁移，上线脚本须"先备份、后迁移、可回滚"。

---

## 8. 冻结纪律核对（确认未违反）

下列已冻结决策在本审计覆盖范围内**均未被改动/回滚**：
- 三周转口径(D1) 实时算、采购链 4 月口径；
- 采购链→订单预测方案 A+B（在途回写、不触发 /generate）；
- 成本汇率 Final V1.0（成本确认=Cost Confirm、汇率快照锁定、付款仅可冲销）；
- SYS-E2E-02（库存唯一事实=ERP 手动导入，采购链不永久增 available_qty）；
- 定金结清判断（=deposit_payment_status='paid'）；
- 登录页视觉基线（飞书主入口 + break-glass 低调保留）；
- 协作纪律（只读→方案→确认→实施→验收，不扩大范围）。

---

## 9. 待你确认事项

1. 是否新增独立"财务审批"默认角色（R3）？还是维持 admin 审批付款？
2. AUTH-FEISHU-LIVE-01 L1 预计何时完成？上线是否接受"break-glass 先行、飞书后置"？
3. 目标部署形态：PM2 / Docker / systemd？有无反向代理与持久化卷方案？
4. 是否授权我进入"最小修复"阶段处理 B1–B4 / R1–R4（按你的优先级）？

> 本报告为**只读审计产物**，未对任何源文件、数据库、git 做写操作。下一步请确认修复范围，我将严格按"最小修改"纪律实施。
