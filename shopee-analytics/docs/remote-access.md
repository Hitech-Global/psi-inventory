# 远程接入 Production（Hitech Windows 台式机）

> 复核时间：2026-11-01
> 目的：让 WorkBuddy 能直接操作运行 Shopee Analytics 的那台机器。

---

## 一、为什么需要这一层

Production 跑在 Hitech Windows 台式机上，通过 Cloudflare Tunnel 对外：

```
analytics.hitechanalysis.top → Cloudflare → Tunnel → 台式机 → 127.0.0.1:3090
auth.hitechanalysis.top     → Cloudflare → Tunnel → 台式机 → 127.0.0.1:3091
```

Tunnel 只对外提供 HTTP/HTTPS，**没有可用的 SSH 通道**，且源站没有 DNS 记录
（被动 DNS 与证书透明日志都查不到源站地址）。所以要远程操作那台机器，
需要另外建立一条通道。

---

## 二、方案对比（已实测）

| 方案 | 需要什么 | 稳定性 | 结论 |
|---|---|---|---|
| **SSH 到台式机** | 台式机装 OpenSSH Server + 知道内网 IP + 凭据 | 高，最快 | **若台式机与本机同网段，这是首选** |
| **RDP 到台式机** | 台式机开远程桌面 + 知道 IP + 凭据 | 中，受 Windows 前台焦点限制 | 备选 |
| **Desktop Commander Remote** | 台式机跑一个 agent + 浏览器 OAuth 授权 | 中，agent 需常驻 | **与网络位置无关，最通用** |

**已实测 Desktop Commander 可行**（在本机验证，Windows 同机制）：

```
$ npx -y @wonderwhy-er/desktop-commander@latest remote
[15:42:21]  - 🔌 Connected to Desktop Commander MCP
[15:42:23]  - 🔌 Connected to Remote MCP
[15:42:23]  - ✅ Device code received
[15:42:23] 📋 Please complete authentication:
[15:42:23]    1. https://mcp.desktopcommander.app/device/verify?user_code=XXXX-XXXX
[15:42:23]    2. Make sure the code matches: XXXX-XXXX
```

远程 MCP 端点：`https://mcp.desktopcommander.app/mcp`
（OAuth 动态注册端点 `/register` 已验证可用；`/authorize` 为授权入口）

---

## 三、推荐路径

### 首选：SSH（最快）

在台式机上装 OpenSSH Server：

```powershell
# 管理员 PowerShell
Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
Start-Service sshd
Set-Service -Name sshd -StartupType Automatic
New-NetFirewallRule -Name sshd -DisplayName 'OpenSSH Server' -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22
```

然后确认台式机的内网 IP：

```powershell
ipconfig
```

把 IP 与账号告诉我（或在 `~/.workbuddy/skills/local-gui-automation/config/profiles.json`
里建一个档案），之后所有部署与排查都由我远程执行。

### 备选：Desktop Commander Remote（与网络位置无关）

**在台式机上执行**（需要有 Node.js 18+；没有就用 Docker）：

```powershell
npx -y @wonderwhy-er/desktop-commander@latest remote
```

没有 Node.js 时：

```powershell
docker run --rm -it node:22 npx -y @wonderwhy-er/desktop-commander@latest remote
```

浏览器会弹出验证页 → 登录 Desktop Commander 账号 → 确认配对码一致。

**然后在 WorkBuddy 里**：连接器管理页面 → 自定义连接器 → 信任 `remote-desktop-commander`。

> 本机的 MCP 配置已写好 `~/.workbuddy/mcp.json`：
> ```json
> { "mcpServers": { "remote-desktop-commander": { "url": "https://mcp.desktopcommander.app/mcp" } } }
> ```
> 仍需在连接器页面点「信任」并完成 OAuth 授权。

---

## 四、接入后的日常流程

```
本地改代码 → 本地测试 → commit → push GitHub
  → 远程台式机 git pull
  → （涉及数据库时）备份
  → docker compose up -d --build app oauth
  → Health Check
  → 汇报
```

部署脚本：`shopee-analytics\deploy\deploy-analytics-windows.ps1`
详见 `shopee-analytics/docs/production-deploy.md`。

---

## 五、安全约定

- 凭据只走环境变量或系统凭据存储，**不写进档案、脚本或聊天**
- 远程执行破坏性命令前先列出完整命令与影响范围，确认后再执行
- Production 数据库修改前必须备份
- Production 不保留未提交的改动 —— 所有变更走 Git commit，可回滚
