# 生产部署指引 —— 平台接入页与 TikTok 底座

> 适用：把 `feat/shopee-analytics-v1-foundation` 上已同步的 analytics 模块更新到生产
> 目标站点：`https://analytics.hitechanalysis.top`
> 同步提交：`a2183f7`（模块内容与 `main` 完全一致）

---

## 一、现状说明

生产站点当前跑的是 **2026-10-02 的版本**（`62631b2`），表现为：

- 顶栏**没有**「平台接入」入口
- `/connections` 返回 **404**
- 授权回调后**没有任何提示**（回调参数从来没人读）

代码已同步到生产部署的分支，只差服务器上的一次拉取 + 重启。

---

## 二、部署步骤（在生产服务器上执行）

### 1. 备份（按 DEPLOY.md 第 3 节，迁移前必做）

```bash
cd /path/to/deployed/repo        # 生产部署目录
node scripts/backup.js
# 确认输出 integrity_check=ok
```

### 2. 拉取代码

```bash
cd /path/to/deployed/repo
git fetch origin
git checkout feat/shopee-analytics-v1-foundation
git pull origin feat/shopee-analytics-v1-foundation
# 应到达 a2183f7
git log --oneline -1
```

> ⚠️ 若生产工作区有本地改动，先 `git status` 确认再决定如何处理，**不要盲目 reset**。

### 3. 前端静态文件（立即生效，无需重启）

nginx 直接托管 `shopee-analytics/web/`，所以：

```bash
# 确认新文件已到位
ls -l shopee-analytics/web/connections.html
```

前端刷新浏览器即可看到「平台接入」入口（注意浏览器缓存；站点用 `Cache-Control: no-cache`，
一般无需强制刷新）。

### 4. 重启应用（让 /connections 路由生效）

路由由 `standalone-server.js` 提供，**必须重启进程**。

生产形态按 DEPLOY.md 是 PM2：

```bash
pm2 reload inventory-app     # 或你的实际进程名
pm2 logs inventory-app --lines 30
```

若生产用 Docker 桌面栈：

```bash
cd shopee-analytics/deploy/desktop
docker compose --env-file runtime/.env up -d --build app oauth worker
```

> schema.sql 全部是 `CREATE TABLE IF NOT EXISTS`，启动时幂等应用，
> 会自动建出 4 张新表：`tiktok_shop_tokens` / `tiktok_marketing_tokens` /
> `tiktok_raw_api_snapshots` / `tiktok_oauth_states`。**不会影响现有表与数据。**

### 5. 验证

```bash
# 健康检查
curl -s https://analytics.hitechanalysis.top/api/shopee-analytics/health

# 新路由（未登录会 302 到 /login，属正常）
curl -s -o /dev/null -w "%{http_code}\n" https://analytics.hitechanalysis.top/connections
```

浏览器验证：

1. 登录后顶栏应出现「平台接入」胶囊按钮
2. 点击进入 `/connections`，应看到 Shopee 与 TikTok Shop 两张卡片
3. TikTok 卡片显示「未配置」（因为还没填 TIKTOK_* 环境变量）——这是预期状态

---

## 三、可选：启用 TikTok 授权

只有需要真正连 TikTok 时才做。在生产 `.env` 追加：

```bash
# Partner Center 应用详情页取这三个值
TIKTOK_APP_KEY=
TIKTOK_APP_SECRET=
TIKTOK_SERVICE_ID=
TIKTOK_REGION_GROUP=ROW
# 回调地址：必须与 Partner Center 里登记的一致
TIKTOK_REDIRECT_URL=https://analytics.hitechanalysis.top/api/shopee-analytics/tiktok/oauth/callback
```

改完 `.env` 后**重启进程**。

> ⚠️ `TRUSTED_ORIGINS` 必须精确包含 `https://analytics.hitechanalysis.top`，
> 否则授权相关的写请求会被 CSRF 拦截（403）。见 DEPLOY.md 1.4。

---

## 四、回滚

```bash
cd /path/to/deployed/repo
pm2 stop inventory-app
node scripts/restore.js backups/inventory-<迁移前那份>.db
pm2 start inventory-app
```

代码侧回滚：

```bash
git checkout 62631b2
# 前端文件即刻生效，进程重启后路由也回到旧版
```

---

## 五、这次同步了什么

| 类别 | 内容 |
|---|---|
| 前端 | 新增 `web/connections.html`（平台接入页）；`index.html` 顶栏加入口；`app.js` 新增 OAuth 回调提示；`i18n-v1.js` 补词条；`styles.css` 加样式 |
| 后端 | 9 个 TikTok 模块（签名器 / 中间模型 / client / catalog / 凭据存储 / 授权服务 / 同步服务 / 基线采集 / adapter）；`http-router.js` 加 3 个 TikTok 路由；`standalone-server.js` 挂载接入页 |
| 数据库 | `schema.sql` 加 4 张 `tiktok_*` 表（幂等创建） |
| 配置 | `.env.example` 加 8 个 `TIKTOK_*` 变量（都可为空，不影响启动） |
| CI | workflow 的 push 触发改为 `feat/**` 通配，新分支不再静默绕过校验 |

同步后 `shopee-analytics/` 目录与 `main` **完全一致**。
