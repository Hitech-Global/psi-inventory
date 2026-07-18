# SYSTEM-READY-AUDIT-01 · B1–B4 上线阻断项处置方案

> 编制日期：2026-07-18
> 前置：SYSTEM-READY-AUDIT-01 只读审计报告
> 范围确认（用户 2026-07-18）：
> - 权限模型保持 **用户→角色→权限** 三层不变；审批能力由角色管理页配置。
> - **不新增财务审批角色 / 不改付款审批链 / 不改权限模型**（报告 R3 关闭）。
> - 本轮只处理真正上线阻断项 **B1 部署准备 / B2 backup-restore / B3 飞书 L1 配置 / B4 发布状态整理**。
> 纪律：本文档为**方案**，未写部署文件、未动 git、未删任何文件。等你确认后按"最小修改"实施。

---

## B1 部署准备

### 现状缺口
- `.env.example` **已过时**：仍是 `SESSION_SECRET / ADMIN_USERNAME / ADMIN_PASSWORD`（旧默认账号方案，代码已不使用），**缺** 真实必需项 `FEISHU_APP_ID/SECRET/REDIRECT_URI`、`BREAKGLASS_ADMIN_PASSWORD`、`TRUSTED_ORIGINS`、`SESSION_TTL_HOURS`、`COOKIE_SECURE`、`NODE_ENV`。
- 无进程管理器（PM2/systemd）、无反向代理样例、无持久化卷说明。
- `NODE_ENV` 默认空串 → CSRF 仅在 `NODE_ENV=production` 强制、错误栈仅 production 隐藏（见审计发现 G）。

### 拟实施（新增文件，不改已验收代码）
1. **重写 `.env.example`** 为与代码一致的真实模板（脱敏占位）：
   ```
   NODE_ENV=production
   PORT=3001
   DB_PATH=/data/inventory.db            # 生产指向持久化卷
   BREAKGLASS_ADMIN_PASSWORD=<强密码>    # 缺失则 fail-closed 拒绝启动
   FEISHU_APP_ID=<独立应用 app_id>
   FEISHU_APP_SECRET=<独立应用 app_secret>
   FEISHU_REDIRECT_URI=https://<域名>/api/auth/feishu/callback
   TRUSTED_ORIGINS=https://<域名>        # CSRF 可信来源
   COOKIE_SECURE=1                       # HTTPS 下置 1
   SESSION_TTL_HOURS=12
   # 通知默认真实发送；如需演练：FEISHU_NOTIFY_DRYRUN=1
   ```
   删除废弃的 `SESSION_SECRET / ADMIN_*`。
2. **进程管理器配置**（三选一，待你定形态）：
   - 方案 A **PM2**（推荐）：`ecosystem.config.js`——`NODE_ENV=production`、`autorestart`、`max_memory_restart`、日志路径。最贴合当前单进程 Node，崩溃自愈成本最低。
   - 方案 B **systemd**：`inventory.service`——`Restart=always`、`EnvironmentFile=/etc/inventory.env`。
   - 方案 C **Docker**：`Dockerfile`（node:22-alpine + better-sqlite3 需构建工具）+ `docker-compose.yml`（挂载持久卷 `/data`）。
3. **反向代理样例** `deploy/nginx.conf.sample`：TLS 终止、`proxy_pass` 到 PORT、透传 `X-Forwarded-Proto`（使 `req.secure` 正确→`COOKIE_SECURE` 生效）。
4. **持久化卷说明**：`DB_PATH` 指向持久盘；WAL 三文件（`.db/.db-wal/.db-shm`）同盘。

### 需你决策
- **B1-Q 部署形态**：PM2 / systemd / Docker（或"三份样例都给，由运维选型"）。

---

## B2 backup / restore

### 现状缺口
- `data/` 已达 **455MB**，含 15+ 个手工 `.bak` 库（每个 ~29MB）+ 孤儿 `-wal/-shm` + `ux01_verify.db` 等——**手工乱备份、无标准化脚本、无恢复演练**。
- 无迁移前自动备份、无保留策略、无完整性校验。

### 拟实施（新增脚本 + 文档，不改代码）
1. **`scripts/backup.js`**（用 better-sqlite3 在线 `db.backup()`，WAL 安全，无需 sqlite3 CLI）：
   - 输出 `backups/inventory-YYYYMMDD-HHmmss.db`（单文件、已 checkpoint，不含 wal/shm）；
   - 备份后 `PRAGMA integrity_check` 校验；
   - 保留策略：保留最近 N 份（默认 14），自动清理更旧的（仅限 `backups/` 目录内，不碰 `data/`）。
2. **`scripts/restore.js`**：
   - 入参指定备份文件 → 先 `integrity_check` → 提示确认 → 停服前置校验 → 替换 `DB_PATH` 主库 + **删除同名 `-wal/-shm`**（避免旧 WAL 覆盖）→ 提示重启。
   - 恢复前先对当前库做一次自动安全备份。
3. **迁移前置备份**：文档约定"生产迁移（尤其 `payment_subcategories/sources` 表重建式迁移，审计发现 B）前必须先 `backup.js`，失败可 `restore.js` 回滚"。
4. **`DEPLOY.md`**：备份计划（cron/系统定时）、恢复演练步骤、迁移回滚预案。

> 注：`data/` 内既有 455MB 手工旧 `.bak` 属数据文件清理，涉及你的历史数据，**不在本脚本自动删除范围**，单列见 B4「数据备份清理（需逐项确认）」。

---

## B3 飞书 L1 配置（你方在飞书开放平台后台执行，我提供清单）

> 此项为 AUTH-FEISHU-LIVE-01 L1 的后台操作，**只能由你在飞书后台完成**，我无法代办。提供精确清单：

1. 进入飞书开放平台 → 该**独立应用**（非售后应用）→「应用能力」启用**机器人**。
2. 「权限管理」申请并发布：
   - `im:message`（或 `im:message:send_as_bot`）——发送单聊消息；
   - 确认已有 `contact:user.base:readonly` 等登录所需 scope（若首轮不申请通讯录，登录仅依赖 OAuth union_id，维持冻结不扩 scope）。
3. 「安全设置」重定向 URL 白名单加入生产 `FEISHU_REDIRECT_URI`。
4. 创建并发布**版本**，等待企业管理员审核通过（权限生效前 dryrun 送达为空）。
5. **联调冒烟**（我可协助）：L1 生效后，在隔离副本设 `FEISHU_NOTIFY_DRYRUN=0` 对**真实管理员飞书号**发一条测试消息验证 token 与送达；**不写生产库**、三确认（DB_PATH/环境变量/目标库身份）仍适用。

### 需你确认
- **B3-Q**：L1 何时可完成？上线是否接受"break-glass 应急登录先行、飞书登录/通知 L1 就绪后再切"？

---

## B4 发布状态整理（含破坏性操作，须你授权）

### 现状盘点
- **已改已验收代码（tracked）**：`app.js / db.js / index.html / server.js`（合计 +2000/-114 行），是 FEISHU-NOTIFY-01、PUR-OPS-COLLAB-01、SYS-MGMT-APPROVAL-01 R2、BUSINESS-CC-CORE-01 等**已验收阶段**的累积改动，尚未提交。
- **代码快照残留（untracked）**：`.backup-approval01/`、`.backup-approval01-r2/`、`.backup-fix01/`、`.backup-fix02/`、`.backup-role01/`、`.backup-ux01/`、`.backup-ux02/`（共 ~6MB，均为改前手工副本，git 已可回溯，属冗余）；`.env.backup.20260716-185242`（含旧密钥，**不应入库**）。
- **遗留一次性测试脚本（违反"用后删除"约定）**：`p103b-test.js`、`p103c-test.js`、`verify_ux01.js`、`sanitize-copy.js`——按项目约定应跑完即删。
- **散落文档 ~80 个 `.md`**：各阶段实施报告/只读排查/方案/验收记录（含本次审计报告）。
- **其他 untracked**：`start.sh`、`LOCAL_DEV.md`、`docs/`、`data/`（gitignored 主体，含 455MB 旧 `.bak`）。

### 拟实施（分级，逐项待你授权）
**B4-a 提交已验收代码**（需授权）：
- `git add app.js db.js index.html server.js` 并单次提交，message 概述已验收阶段：
  `feat: FEISHU-NOTIFY-01 + PUR-OPS-COLLAB-01 + approval R2 + CC-CORE 已验收阶段`
- 不含 push（维持"未 push/deploy"）。

**B4-b 删除代码快照残留**（破坏性，需授权）：
- 删 7 个 `.backup-*/` 目录（git 可回溯，冗余）；
- 删 `.env.backup.20260716-185242`（旧密钥不入库、留在磁盘有泄露面）；
- 删遗留一次性测试脚本 4 个（`p103b-test.js`/`p103c-test.js`/`verify_ux01.js`/`sanitize-copy.js`）。

**B4-c 文档归档**（需授权，二选一）：
- 方案 i：新建 `docs/reports/` 归集所有阶段 `.md` 并 `git add`（保留可追溯）；
- 方案 ii：将报告类 `.md` 加入 `.gitignore`（不入库，仅本地留存）。
- 建议 i（上线材料可追溯）。

**B4-d 数据备份清理（涉你历史数据，须逐项确认，本方案不预设删除）**：
- `data/` 455MB 手工旧 `.bak`（15+ 个 ~29MB）+ 孤儿 `-wal/-shm` + `ux01_verify.db`。
- ⚠️ 属数据文件，**不会自动删**。建议：待 B2 标准化备份就绪并验证后，由你逐项确认再清理；或整体移至外部归档盘。

### 需你决策
- **B4-Q1**：是否现在提交 B4-a 的 4 个已验收文件？（提交 / 暂不提交）
- **B4-Q2**：是否授权删除 B4-b 残留（`.backup-*` + `.env.backup.*` + 4 个遗留测试脚本）？
- **B4-Q3**：文档归档取 i（docs/reports 入库）还是 ii（gitignore 不入库）？
- **B4-Q4（数据）**：`data/` 旧 `.bak` 清理暂缓、待 B2 就绪后逐项确认——是否同意？

---

## 建议执行顺序（确认后）

1. **B2**（先建备份能力）→ 为后续任何变更兜底；
2. **B4-a/b/c**（整理发布状态、提交已验收代码、清理残留）；
3. **B1**（按你选定形态产出部署配置）；
4. **B3**（你方飞书后台 L1）→ 就绪后隔离副本实发冒烟；
5. 全部就绪 → 你确认后再议 push/deploy（本轮不做）。

> R1（全局错误处理中间件）、R2（前端防重复点击）为稳定性/UX 建议项，不在本轮阻断项范围，待你后续单独决定。

---

## 待你确认清单（汇总）

| 编号 | 决策点 | 选项 |
|---|---|---|
| B1-Q | 部署形态 | PM2（推荐）/ systemd / Docker / 三份都给 |
| B3-Q | 飞书 L1 时点与先行策略 | L1 何时完成；是否 break-glass 先行 |
| B4-Q1 | 提交 4 个已验收文件 | 现在提交 / 暂不 |
| B4-Q2 | 删除残留（backup 目录/旧 env/遗留测试脚本） | 授权 / 保留 |
| B4-Q3 | 文档归档 | docs/reports 入库 / gitignore |
| B4-Q4 | data/ 旧 .bak 清理 | 暂缓待 B2 后逐项确认（建议）/ 其他 |

> 本文档为方案产物。确认后我严格按"最小修改"实施，全程不越出 B1–B4；不 push/deploy。
