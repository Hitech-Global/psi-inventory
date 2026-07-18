# RELEASE-PREP-01 · 最终 Render 部署清单

> 阶段：上线收敛（RELEASE-PREP-01）
> 技术选型（用户确认 2026-07-18）：**Render Web Service + SQLite V1（better-sqlite3 单文件库）+ backup/restore；暂不迁移 PostgreSQL**
> 纪律：仅部署配置/文档，不修改业务代码（server.js / db.js / app.js / index.html 均未改动）

---

## 1. render.yaml 确认

已生成 `render.yaml`（根目录），要点逐项确认：

| 项 | 值 | 说明 |
|---|---|---|
| 服务类型 | `web` | Node Web Service |
| runtime | `node` | 由 Render 提供 Node 运行时 |
| buildCommand | `npm install` | 触发 better-sqlite3 原生编译 |
| startCommand | `node server.js` | 与 package.json `start` 一致 |
| plan | `starter` | 免费版不支持持久磁盘，需 starter 及以上 |
| numInstances | `1` | **必须=1**：SQLite 单文件不支持多进程并发写（与 PM2 fork 单实例一致） |
| healthCheckPath | `/api/version` | server.js 内置轻量端点，返回 200（非业务代码，无需新增） |
| 磁盘 | mount `/data`，`sizeGb: 1` | **持久磁盘**：SQLite 主库与备份均存于此，跨部署/重启不丢 |
| DB_PATH | `/data/inventory.db` | 指向持久磁盘 |
| COOKIE_SECURE | `"1"` | 生产 HTTPS 必须，会话 Cookie 带 Secure |
| NODE_ENV | `production` | CSRF 强制 + 错误栈不外露 |

**关键约束（部署前必读）**
- ⚠️ **持久磁盘是硬性前提**：Render Web Service 默认文件系统是临时的，重启/部署会清空。SQLite 文件**必须**放在挂载磁盘 `/data`，否则数据丢失。免费版无磁盘，需 starter+。
- ⚠️ **实例数=1**：不得开启多实例/自动扩缩。多进程并发写同一 SQLite 文件会锁冲突/损坏。
- ⚠️ **TRUSTED_ORIGINS 必须填 `https://<正式域名>`**：应用未启用 `trust proxy`，经 Render HTTPS 反代后 `req.secure=false`、`selfOrigin=http://<domain>`；浏览器发来的 `Origin=https://<domain>` 与之不匹配 → **所有写请求被 CSRF 403 拒绝**。该值必须在首次写操作前于 Render 后台设好。
- 原生依赖 `better-sqlite3` 需编译，`npm install` 即构建；如构建失败需在 Render 后台确认 Node 版本（engines 要求 >=18）。

---

## 2. 环境变量清单

| 变量 | 值 / 来源 | 必填 | 说明 |
|---|---|---|---|
| `NODE_ENV` | `production`（yaml 固定） | ✅ | 生产模式 |
| `PORT` | Render 自动注入 | — | 应用读 `process.env.PORT`，无需手动设 |
| `DB_PATH` | `/data/inventory.db`（yaml 固定） | ✅ | 持久磁盘路径 |
| `BREAKGLASS_ADMIN_PASSWORD` | Render 后台填（sync:false） | ✅ | 强密码；缺失/弱值 **fail-closed 拒绝启动** |
| `FEISHU_APP_ID` | Render 后台填 | ✅ | 独立飞书应用（勿复用售后系统） |
| `FEISHU_APP_SECRET` | Render 后台填 | ✅ | 独立飞书应用密钥 |
| `FEISHU_REDIRECT_URI` | `https://<render-domain>/api/auth/feishu/callback` | ✅ | 部署拿到域名后填，且与飞书后台白名单一致 |
| `TRUSTED_ORIGINS` | `https://<render-domain>` | ✅ | **CSRF 写请求必须**；多域名逗号分隔 |
| `COOKIE_SECURE` | `1`（yaml 固定） | ✅ | HTTPS 下会话 Cookie 带 Secure |
| `SESSION_TTL_HOURS` | `12`（yaml 固定） | ⬜ | 可按需调整 |
| `BACKUP_DIR` | `/data/backups`（yaml 固定） | ⬜ | 备份落持久磁盘 |
| `FEISHU_NOTIFY_DRYRUN` | `1`（可选） | ⬜ | 演练期置 1 仅内存记录不真实发送；**AUTH-FEISHU-LIVE-01 L1 完成后删除或置 0 转真实发送** |

> 密钥与域名相关变量在 `render.yaml` 用 `sync: false` 交由 Render 后台管理，不写入 git。模板见 `.env.example`。

---

## 3. 部署步骤

1. **准备仓库**：本仓库已就绪（含 `render.yaml`、`server.js`、`package.json`）。确认 `main` 分支为部署分支。
2. **GitHub 连接 Render**：Render 后台 → New → Blueprint → 连接 GitHub 仓库，选择本仓库（Blueprint 会读取 `render.yaml` 自动建服务+磁盘）。
   - 或 New → Web Service → 手动选仓库与分支，再粘贴 `render.yaml` 等效配置。
3. **创建磁盘**：Blueprint 会自动按 `render.yaml` 创建 `inventory-data` 磁盘（mount `/data`）。手动模式需在 Disk 页先建磁盘再挂到服务。
4. **填写环境变量（sync:false 项）**：在 Render 服务 → Environment 填：
   - `BREAKGLASS_ADMIN_PASSWORD`（强密码）
   - `FEISHU_APP_ID` / `FEISHU_APP_SECRET`
   - 其余固定值已由 `render.yaml` 注入。
5. **首次部署**：Render 拉取 `main` → `npm install` → `node server.js`。启动后 db.js 自动建表+迁移（首次无库则初始化空库）。
6. **拿到正式域名**：部署完成后 Render 分配 `https://<service>.onrender.com`（或自定义域名）。
7. **回填域名相关变量（关键）**：
   - `FEISHU_REDIRECT_URI=https://<域名>/api/auth/feishu/callback`
   - `TRUSTED_ORIGINS=https://<域名>`
   - 改完后 **Manual Deploy** 重启使环境变量生效。
8. **飞书后台白名单**：在独立飞书应用安全设置加入上述 `FEISHU_REDIRECT_URI`（与 AUTH-FEISHU-LIVE-01 L1 的 bot+im:message 权限一并完成）。
9. **持久化校验**：SSH/Shell 进服务执行 `ls -la /data` 确认 `inventory.db` 已生成且位于持久磁盘。

> 数据初始化：当前本地 `data/inventory.db`（含历史数据）**不会自动同步**到 Render。生产数据通过两种途径之一建立：① fresh bootstrap（空库，从 ERP 重新导入）；② 用 `scripts/backup.js` 在本地备份 → 传至 `/data/backups` → `scripts/restore.js` 恢复。**数据库迁移不在本次 RELEASE-PREP-01 范围**，另行计划。

---

## 4. 上线后 Smoke Test 计划

复用 `RELEASE-SMOKE-TEST-01` 的 6 大范围，但目标改为**生产 URL**，并在写操作前确认 `TRUSTED_ORIGINS` 已生效。

**前置条件（必须已全部满足）**
- [ ] Render 服务 Running，健康检查 `/api/version`=200
- [ ] `TRUSTED_ORIGINS=https://<域名>` 已设并重启生效（否则写请求 403）
- [ ] `NODE_ENV=production`、`COOKIE_SECURE=1` 已生效
- [ ] 飞书后台回调白名单 + bot/im:message（AUTH-FEISHU-LIVE-01 L1）已完成

**测试范围与判定**
1. **服务健康**：`GET /api/version`=200；`GET /`=200（含登录/飞书入口）；启动日志无 error。
2. **登录与权限**：飞书入口 302 跳授权；break-glass 登录 200 + 权限正常；未登录 API 401 拦截；三角色（超级管理员/运营/普通用户）权限校验。
3. **核心业务只读**：PO / PI / CI / WAC / Payment / 预测 列表接口 200。
4. **新功能**：审批流配置可读；CI 运营准备接口可读；FEISHU-NOTIFY 代码路径就绪（真实发送待 L1 后受控验证）。
5. **数据安全**：`node scripts/backup.js`（BACKUP_DIR=/data/backups）产出单文件 + integrity_check=ok；DB 连接正常；数据量与预期一致。
6. **日志检查**：无 server error / unhandled exception / migration error。

**写操作受控验证（F4，待 L1 后）**
- 审批真实提交（另起受控单据，验证状态流转 + 通知触发）
- FEISHU 真实发送（dryrun→实发切换，确认接收人收到）
- 以上均**不在本次部署阻塞项内**，等 AUTH-FEISHU-LIVE-01 L1 完成再做。

**账号（F5，上线后处理）**
- 配齐 operator / viewer 测试账号（角色定义已正确），非当前阻断项。

---

## 5. 与既有文档的关系
- `DEPLOY.md`：覆盖**自托管**路径（PM2 + nginx）。本清单的 Render 为**已选生产目标**；若改回自托管，参考 DEPLOY.md。
- `SYSTEM-READY-AUDIT-01-*` / `RELEASE-SMOKE-TEST-01-REPORT.md`：已归档至 `docs/reports/`。
- `.env.example`：环境变量模板（含 TRUSTED_ORIGINS 预留说明）。

**结论**：部署配置与清单已就绪，未改动任何业务代码。当前立场：仅本地提交，未 push、未 deploy。
