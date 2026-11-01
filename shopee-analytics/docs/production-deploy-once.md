# 生产部署 —— 一次性设置

> 目标：把「在服务器上手动 pull」变成「在 GitHub 上点一次」。
> 做完这一步，以后所有部署我都能代为触发，你不用再登服务器。

---

## 为什么需要这一步

生产服务器只暴露 80/443，SSH 端口对公网关闭。我从任何地方都连不上它：

| 尝试的通道 | 结果 |
|---|---|
| SSH 到 22 端口 | 不可达 |
| DNS 查真实 IP | 被本地代理的 fake-ip 拦截，拿不到 |
| 本机是否有部署副本 | 没有 |
| 本机是否有 PM2 / Docker / cloudflared | 全都没有 |
| 仓库里有部署 webhook 吗 | 没有 |
| GitHub 上有自托管 runner 吗 | 没有，用的是托管 runner |

所以必须有人登上那台机器一次 —— 做下面的设置。

---

## 设置步骤（在生产服务器上执行）

### 1. 生成部署密钥

```bash
ssh-keygen -t ed25519 -C "github-actions-deploy" -f ~/.ssh/gh_deploy -N ""
```

### 2. 把公钥加进 authorized_keys

```bash
cat ~/.ssh/gh_deploy.pub >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

### 3. 确认你能免密登录自己（避免锁死）

```bash
ssh -i ~/.ssh/gh_deploy localhost 'echo 连接正常'
```

### 4. 记录部署目录与用户名

```bash
pwd                          # 部署目录（后面要填进 DEPLOY_DIR）
whoami                       # 用户名（后面要填进 DEPLOY_USER）
```

> 部署目录就是那个同时包含 `.git` 和 `shopee-analytics/` 的目录。
> 找它：`ps aux | grep -i standalone-server`，输出里会带完整路径。

### 5. 在 GitHub 上添加 4 个 Secret

打开仓库 → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**，
逐个添加：

| Secret 名 | 值 |
|---|---|
| `DEPLOY_SSH_KEY` | `~/.ssh/gh_deploy` 私钥文件的**全部内容**（含 `-----BEGIN OPENSSH PRIVATE KEY-----` 开头和结尾） |
| `DEPLOY_HOST` | 服务器 IP 或主机名 |
| `DEPLOY_USER` | 上一步 `whoami` 的输出 |
| `DEPLOY_DIR` | 上一步 `pwd` 的输出（部署目录的绝对路径） |

> 查看私钥内容：`cat ~/.ssh/gh_deploy`
> 复制时**不要**带 `~` 前缀。

---

## 之后怎么部署

GitHub 仓库 → **Actions** → **Deploy Shopee Analytics to Production** → **Run workflow** →
选分支（默认 `main`）→ 点绿色的 Run。

或者直接告诉我「部署」，我来触发。

### 部署流程（workflow 自动完成）

1. 检查 4 个 secret 是否齐全（缺了就明确报出缺哪个）
2. 显示当前运行的版本号
3. 备份数据库（`scripts/backup.js`；没有则提示改用 pg_dump）
4. `git pull origin <分支>`
5. **检查工作区是否干净** —— 有本地改动就中止（避免覆盖服务器上的手工修改）
6. 重启应用（自动识别 PM2 / Docker）
7. 从外部验证：静态文件更新时间、健康端点、`/connections.html` 与 `/connections` 的状态码

### 两道保护

- **pull 失败即中止**，不会继续重启 —— 否则会把旧代码重启起来却显示成功
- **工作区有改动即中止** —— 服务器上的手工修改不会被静默覆盖

---

## 如果暂时不想做这一步

那就直接在服务器上跑现成的脚本（效果一样）：

```bash
cd <部署目录>
bash shopee-analytics/deploy/deploy-analytics-web.sh
```

脚本会：检查目录 → 备份 → pull → 提示重启方式。
（需要先 `git pull` 一次才能拿到这个脚本，或者从仓库下载。）

---

## 部署后怎么确认成功

```bash
# 服务器上
git log --oneline -1        # 应显示 c33bc36 或更新

# 线上
curl -sI https://analytics.hitechanalysis.top/app.js | grep -i last-modified   # 应是今天
curl -s -o /dev/null -w '%{http_code}\n' https://analytics.hitechanalysis.top/connections.html  # 应 200
```

浏览器：登录后顶栏应出现「平台接入」按钮，点击进 `/connections`。
