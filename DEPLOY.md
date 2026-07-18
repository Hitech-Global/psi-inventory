# 部署与运维手册（DEPLOY）

> 配套：SYSTEM-READY-AUDIT-01。覆盖 B1 部署、B2 备份/恢复、B3 飞书 L1、迁移回滚与上线前置检查。

---

## 0. 上线前置检查清单（Go / No-Go）

- [ ] `.env` 已按 `.env.example` provision，**`NODE_ENV=production`**、`BREAKGLASS_ADMIN_PASSWORD` 为强密码、`FEISHU_*` 已填、`TRUSTED_ORIGINS` = 正式域名 origin、`COOKIE_SECURE=1`
- [ ] `DB_PATH` 指向持久化磁盘卷
- [ ] 已执行一次 `node scripts/backup.js` 并校验 integrity_check=ok
- [ ] 反向代理（nginx）TLS 就绪，透传 `X-Forwarded-Proto`
- [ ] PM2 启动并 `pm2 save && pm2 startup` 配置开机自启
- [ ] 飞书后台 L1（机器人 + im:message）已就绪，或明确 break-glass 应急登录先行
- [ ] 首个 PO 提交前，管理员已用审批流配置页为各级选具体用户（旧 approver_role 结构新代码不识别）

---

## 1. 部署（B1，PM2 形态）

### 1.1 环境
- Node ≥ 18（推荐 22.x）。`better-sqlite3` 为原生模块，目标机首次 `npm ci` 需构建工具链（gcc/make/python3）。
- 安装依赖：`npm ci`（生产用 ci 保证锁定版本）。

### 1.2 环境变量
复制并填写：
```
cp .env.example .env
# 编辑 .env：NODE_ENV=production / BREAKGLASS_ADMIN_PASSWORD / FEISHU_* / TRUSTED_ORIGINS / COOKIE_SECURE=1 / DB_PATH
```
> `server.js` 顶部 `require('dotenv').config()` 会自动加载 `.env`。PM2 仅额外强制 `NODE_ENV=production`。

### 1.3 进程管理（PM2）
```
pm2 start ecosystem.config.js
pm2 save
pm2 startup        # 按提示执行输出的命令，配置开机自启
pm2 logs inventory-app
pm2 reload inventory-app   # 平滑重启
```
- `ecosystem.config.js`：单进程 fork（better-sqlite3 单文件库不适合 cluster 多实例并发写）、`autorestart`、`max_memory_restart=500M`、重启节流（`min_uptime/max_restarts/restart_delay`）。
- 日志输出到 `logs/pm2-*.log`（该目录已 gitignore）。

### 1.4 反向代理（nginx）
- 样例：`deploy/nginx.conf.sample`（替换域名与证书路径）。
- **关键**：必须透传 `proxy_set_header X-Forwarded-Proto $scheme;`
- **CSRF 注意**：应用未启用 Express `trust proxy`，故 `req.secure` 在反代后为 false，CSRF 的 `selfOrigin` 会按 http 计算；**因此 CSRF 放行依赖 `TRUSTED_ORIGINS` 精确匹配浏览器 Origin（`https://正式域名`）**。上线务必把 `TRUSTED_ORIGINS` 设为正式 https 域名，否则写请求会被 CSRF 拦截（403）。`COOKIE_SECURE` 由独立 env 控制（置 1 即带 Secure），不受此影响。

### 1.5 持久化
- `DB_PATH` 指向持久盘目录（如 `/data/inventory.db`）；SQLite WAL 三文件 `.db / .db-wal / .db-shm` 同盘同目录。
- 该目录需应用进程读写权限。

---

## 2. 备份与恢复（B2）

### 2.1 备份
```
node scripts/backup.js
```
- 在线 `better-sqlite3 .backup()`，WAL 安全，产出**单文件** `backups/inventory-YYYYMMDD-HHmmss.db`（已 checkpoint，不含 wal/shm）。
- 备份后自动 `PRAGMA integrity_check`，非 ok 即非零退出并保留问题文件供排查。
- 保留策略：默认保留最近 14 份（`BACKUP_RETENTION` 可调），仅清理 `backups/` 内旧备份，**绝不触碰 `data/`**。
- `backups/` 已加入 `.gitignore`，不入库。

### 2.2 定时备份（建议）
crontab 示例（每日 02:00）：
```
0 2 * * * cd /path/to/inventory-app && /usr/bin/node scripts/backup.js >> logs/backup.log 2>&1
```

### 2.3 恢复
```
node scripts/restore.js backups/inventory-YYYYMMDD-HHmmss.db
```
流程：备份完整性校验 → 交互确认（须先停服）→ 对当前库做 pre-restore 安全备份 → 覆盖 `DB_PATH` 并删除旧 `-wal/-shm` → 提示重启。
> 自动化可用 `FORCE=1` 跳过交互（谨慎）。

---

## 3. 数据库迁移与回滚

- 迁移在模块加载期（`db.js` 的 `getDB()`）执行，早于 `app.listen`，全部 `CREATE TABLE IF NOT EXISTS` + `ALTER … try/catch` 幂等，可重复启动。
- **⚠️ 表重建式迁移**：`payment_subcategories / payment_subcategory_sources` 采用"建新表→复制→DROP 旧表"（仅旧 schema 触发，**不可逆**）。
- **迁移前必须先备份**：
  ```
  node scripts/backup.js        # 迁移前
  pm2 start ecosystem.config.js # 启动即执行迁移
  # 如迁移后异常：
  pm2 stop inventory-app
  node scripts/restore.js backups/<迁移前那份>.db
  pm2 start ecosystem.config.js
  ```

---

## 4. 飞书 L1 配置（B3，飞书开放平台后台，由你方执行）

> AUTH-FEISHU-LIVE-01 L1。使用**独立飞书应用**（勿与售后系统共用 App ID/Secret）。

1. 飞书开放平台 → 该独立应用 →「应用能力」启用**机器人**。
2. 「权限管理」申请并发布：`im:message`（发送单聊消息）；确认登录所需 scope（首轮不扩通讯录 scope，登录依赖 OAuth union_id）。
3. 「安全设置」重定向 URL 白名单加入生产 `FEISHU_REDIRECT_URI`。
4. 创建并发布**版本**，企业管理员审核通过（权限生效前 dryrun 送达为空）。
5. **联调冒烟**：L1 生效后在隔离副本设 `FEISHU_NOTIFY_DRYRUN=0`，对真实管理员飞书号发一条测试消息验证 token 与送达；**不写生产库**，遵守三确认（DB_PATH / 环境变量 / 目标库身份）。

> 未就绪期间：飞书登录/通知不可用，可用登录页底部 **break-glass 应急登录**（需 `BREAKGLASS_ADMIN_PASSWORD`）先行。

---

## 5. 首次上线注意（业务侧）

- **审批流**：SYS-MGMT-APPROVAL-01 R2 后，审批人以**具体用户**为责任主体。上线后提交新 PO 前，管理员须在审批流配置页为 `flow_po` 各级选定具体用户并保存启用；旧 `approver_role` 结构新代码不识别，提交会被拒（设计意图）。
- **默认账号**：`admin/admin` 已停用；本地管理员仅经 `BREAKGLASS_ADMIN_PASSWORD` 初始化（break-glass）。
- **库存唯一事实**：ERP 手动导入；采购链不回写 `available_qty`（冻结规则）。

---

## 6. 常见故障排查

| 现象 | 排查 |
|---|---|
| 启动即退出，提示 break-glass | 未设 `BREAKGLASS_ADMIN_PASSWORD` 或过弱（fail-closed） |
| 写请求 403「跨站请求被拒绝」 | `TRUSTED_ORIGINS` 未含正式 https 域名（见 1.4） |
| 登录页飞书登录失败 | 飞书 L1 未就绪或 `FEISHU_REDIRECT_URI` 白名单不符；可用 break-glass |
| `Failed to fetch` | 进程退出/端口占用；`pm2 logs` 查 `EADDRINUSE` 或异常栈 |
| 提交 PO 报无可用审批人 | 审批流各级未配置具体用户（见第 5 节） |
