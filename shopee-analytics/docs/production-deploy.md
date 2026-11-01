# Production 部署指南

> 复核时间：2026-11-01
> 适用架构：`analytics.hitechanalysis.top` → Cloudflare → Tunnel → Hitech Windows 台式机
> → Docker → Shopee Analytics（app `127.0.0.1:3090` / oauth `127.0.0.1:3091`）

---

## 一、部署拓扑

```
                    ┌─────────── Hitech Windows 台式机 ───────────┐
                    │                                              │
 analytics.hitechanalysis.top ──Cloudflare──┐                   │
                    │                         │                   │
                    │                    Cloudflare Tunnel          │
                    │                    (跑在台式机上)            │
                    │                         │                   │
                    └────────────────────────►│                   │
                                              ▼                   │
                                    127.0.0.1:3090  app 容器      │
 auth.hitechanalysis.top ───Cloudflare──►│                   │
                                    127.0.0.1:3091  oauth 容器   │
                                                              │
                                    worker / ad-group-import-worker
                                    postgres / ollama
```

**Cloudflare Tunnel 已正常运行，普通代码部署不要重新配置 Cloudflare。**

---

## 二、部署分支

| 项 | 值 |
|---|---|
| 仓库 | `Hitech-Global/psi-inventory` |
| 生产基线分支 | `fix/shopee-brand-portal-modern-oauth-20261027` |
| 生产目录 | `D:\电商数据分析系统\psi-inventory-feishu-auth` |
| 模块目录 | `D:\电商数据分析系统\psi-inventory-feishu-auth\shopee-analytics` |
| Compose 文件 | `shopee-analytics\deploy\desktop\docker-compose.yml` |

---

## 三、部署方式

### 方式 A：脚本（推荐）

```powershell
cd D:\电商数据分析系统\psi-inventory-feishu-auth
git pull origin fix/shopee-brand-portal-modern-oauth-20261027
powershell -ExecutionPolicy Bypass -File shopee-analytics\deploy\deploy-analytics-windows.ps1
```

脚本做六件事：

1. 打印当前版本与分支
2. **备份数据库**（用 compose 的 `schema` 容器做逻辑备份）
3. 拉取代码（**工作区有已跟踪文件的本地改动时中止**，不覆盖）
4. 打印拉取后的版本
5. **重建并启动 `app` 与 `oauth` 容器**
6. 探测四个路由（`/api/shopee-analytics/health`、`/connections`、`/connections.html`、`/app.js`）

加 `-NoRestart` 可跳过重建。

### 方式 B：手工

```powershell
cd D:\电商数据分析系统\psi-inventory-feishu-auth
git pull origin fix/shopee-brand-portal-modern-oauth-20261027
cd shopee-analytics\deploy\desktop
docker compose --env-file runtime/.env up -d --build app oauth
```

---

## 四、★ 为什么必须 `--build`

`docker-compose.yml` 的 volumes 只挂配置目录：

```yaml
app:   volumes: ["./runtime:/runtime:ro", "shopee_import_tmp:/import-tmp"]
oauth: volumes: ["./runtime:/runtime:ro"]
```

**代码是打进镜像的，不是从仓库目录读的。** 因此 `git pull` 之后若不重建镜像，
容器里仍是旧代码，线上看不到任何变化。

> 这一点容易误判：源码直跑时 `git pull` 就能让前端生效（静态文件由应用直接托管），
> 但生产跑在容器里，结论相反。

---

## 五、完整上线流程（涉及数据库时）

```
本地分析需求
  → 修改 shopee-analytics/
  → 本地测试（node shopee-analytics/test/run-all.cjs）
  → git commit
  → push GitHub
  → Production 机器 git pull
  → 【涉及数据库修改时】先备份
  → docker compose up -d --build
  → Health Check
  → 出问题 → git 回滚到上一个 commit → 重新 pull → 重新 build
```

### 回滚

```powershell
cd D:\电商数据分析系统\psi-inventory-feishu-auth
git log --oneline -5            # 找到要回滚到的 commit
git revert <commit>             # 或 git reset --hard <commit>（仅在工作区干净时）
git push origin fix/shopee-brand-portal-modern-oauth-20261027
cd shopee-analytics\deploy\desktop
docker compose --env-file runtime/.env up -d --build app oauth
```

回滚同样走 Git，Production 不保留任何未提交的改动。

---

## 六、Health Check

```powershell
# 容器状态
cd D:\电商数据分析系统\psi-inventory-feishu-auth\shopee-analytics\deploy\desktop
docker compose --env-file runtime/.env ps

# 本机直连（绕过 Cloudflare）
curl.exe http://127.0.0.1:3090/api/shopee-analytics/health
curl.exe http://127.0.0.1:3091/health

# 线上（经 Cloudflare + Tunnel）
curl.exe https://analytics.hitechanalysis.top/api/shopee-analytics/health
curl.exe https://auth.hitechanalysis.top/health
```

预期返回：

```json
{"ok":true,"module":"shopee-analytics","mode":"read-only"}
{"ok":true,"module":"shopee-oauth","mode":"oauth-only"}
```

### 排查顺序

| 现象 | 先查 |
|---|---|
| 线上 502 | Cloudflare Tunnel 是否在跑；容器是否 running |
| 本机 3090 不通 | `docker compose ps` 里 app 的状态与端口 |
| 本机通、线上不通 | Tunnel 进程与 ingress 配置 |
| 本机通、线上是旧版本 | **忘了 `--build`** —— 最常见 |
| 页面 404 但服务正常 | 路由没注册（确认运行的镜像版本） |

---

## 七、凭据

`runtime/.env` 整个目录被 gitignore，**不得提交、不得输出到聊天**。

| 变量 | 用途 |
|---|---|
| `SHOPEE_ADS_PARTNER_ID` / `_KEY` | 广告 API |
| `SHOPEE_STORE_OPS_PARTNER_ID` / `_KEY` | 优惠券、折扣 |
| `SHOPEE_ERP_PARTNER_ID` / `_KEY` | 退货、BusinessInsights |
| `SHOPEE_BRAND_PORTAL_PARTNER_ID` / `_KEY` | Brand Portal |
| `SHOPEE_TOKEN_MASTER_KEY` | token 加密主密钥（base64，32 字节） |
| `SHOPEE_ANALYTICS_PG*` | 专用 PostgreSQL 连接 |

**Shopee Partner Key、access/refresh token、数据库口令、主密钥一律不进 Git、不进聊天记录。**

---

## 八、本地开发

```bash
# 起一个只读实例（用仓库自带的嵌入式 PostgreSQL，数据落 /tmp）
bash shopee-analytics/deploy/run-local.sh            # 起服务
bash shopee-analytics/deploy/run-local.sh --check    # 只验证路由
```

浏览器打开 `http://127.0.0.1:3091/connections`（端口与生产的 3090 区分开）。

**不要在 Production 机器上直接写代码。** 半成品代码只在本机产生，
经测试、提交、推送后才进入 Production。

---

## 九、不适用于 Production 的脚本

以下脚本保留作参考，**不要用于生产**：

| 脚本 | 为什么不用 |
|---|---|
| `deploy/deploy-analytics-web.sh` | 面向源码直跑；生产跑在容器里，必须重建镜像 |
| `deploy/find-deploy-info.sh`、`deploy/get-deploy-info.sh` | 用来找源站 IP；隧道架构下没有源站 IP 这个概念 |
| `.github/workflows/deploy-production.yml` | 基于 SSH 部署；Production 的 SSH 不对外暴露 |

生产只用 `deploy/deploy-analytics-windows.ps1`。
