# 生产部署 —— 一次性设置（只需做一次）

> 目标：配置完成后，每次更新都能自动部署到生产，我会向你汇报结果。
> 完成设置后，仓库的 **Shopee Analytics 自动部署** 会每 10 分钟检查一次，
> 生产落后于 main 时自动部署并通知。

---

## 你要做的（在生产服务器上，约 3 分钟）

### 第 1 步：生成一对部署密钥

```bash
ssh-keygen -t ed25519 -C "github-actions-deploy" -f ~/.ssh/gh_deploy -N ""
```

### 第 2 步：把公钥加进 authorized_keys

```bash
cat ~/.ssh/gh_deploy.pub >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

### 第 3 步：先自测，避免把唯一的门锁死

```bash
ssh -i ~/.ssh/gh_deploy localhost 'echo 连接正常'
```

> 这一步很重要 —— 服务器只有这一条入口，先确认密钥能用再继续。

### 第 4 步：记下部署目录与用户名

```bash
pwd      # → DEPLOY_DIR（部署目录的绝对路径）
whoami   # → DEPLOY_USER
```

> 部署目录 = 同时包含 `.git` 和 `shopee-analytics/` 的那个目录。
> 找不到的话跑 `ps aux | grep -i standalone-server`，输出里带完整路径。

### 第 5 步：把 3 个信息告诉我

| 信息 | 从哪来 |
|---|---|
| 服务器 IP 或主机名 | 你知道的那个 |
| DEPLOY_USER | 第 4 步的 `whoami` |
| DEPLOY_DIR | 第 4 步的 `pwd` |

以及**私钥文件内容**（`cat ~/.ssh/gh_deploy` 的输出）。

拿到后我会用 `scripts/set-repo-secret.js` 把 4 个 secret 写进仓库 ——
**你不用自己去 GitHub 页面粘贴私钥**，也就不会因为少一行头尾出岔子。

> 不想把私钥发给我？也可以自己在 GitHub 仓库 →
> Settings → Secrets and variables → Actions → New repository secret 逐个添加：
> `DEPLOY_SSH_KEY`（私钥全文）、`DEPLOY_HOST`、`DEPLOY_USER`、`DEPLOY_DIR`。
> 效果一样。

---

## 配置完成后会怎样

| 环节 | 谁来做 |
|---|---|
| 我改代码、提交、推送 | 我 |
| 检查生产是否落后于 main | 自动部署自动化（每 10 分钟） |
| 备份 → pull → 重启 → 验证 | deploy-production.yml |
| 向你汇报部署结果 | 我 |

**手动触发一次**（不用等）：
GitHub 仓库 → Actions → Deploy Shopee Analytics to Production → Run workflow。

---

## 部署流程与两道保护

1. 检查 4 个 secret 齐全
2. 显示当前运行的版本
3. 备份数据库
4. `git pull origin main`
5. **检查工作区干净** —— 有本地改动就中止
6. 重启应用（自动识别 PM2 / Docker 栈）
7. 从外部验证：静态文件更新时间、健康端点、接入页状态码

保护一：**pull 失败即中止** —— 否则会把旧代码重启起来却显示成功。
保护二：**工作区有改动即中止** —— 不覆盖服务器上的手工修改。

---

## 部署后如何确认

```bash
# 服务器上
git log --oneline -1        # 应显示 be56f05 或更新

# 线上
curl -sI https://analytics.hitechanalysis.top/app.js | grep -i last-modified   # 应是今天
curl -s -o /dev/null -w '%{http_code}\n' https://analytics.hitechanalysis.top/connections.html  # 应 200
curl -s -o /dev/null -w '%{http_code}\n' https://analytics.hitechanalysis.top/connections       # 应 302（未登录）
```

浏览器：登录后顶栏应出现「平台接入」按钮。

---

## 备选：不想配 SSH 密钥

在服务器上直接跑现成脚本，效果一样：

```bash
cd <部署目录>
bash shopee-analytics/deploy/deploy-analytics-web.sh
```

脚本会自动：检查目录 → 备份 → pull → 提示重启方式。
只是这样每次都得手动跑，无法自动化。
