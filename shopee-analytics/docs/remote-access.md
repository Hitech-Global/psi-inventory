# 远程操作 Production（Hitech Windows 台式机）

> 复核时间：2026-11-01
> 已实测：授权流程、远程写文件、远程执行命令、远程读回输出，全部跑通。

---

## 一、原理

Desktop Commander Remote 是一组三层结构：

```
WorkBuddy（本机）
  → mcp.desktopcommander.app （托管的 MCP 服务，走 OAuth）
    → 设备端 agent（本机或台式机，跑 npx … remote）
      → 在该机器上执行命令 / 读写文件
```

**agent 跑在哪台机器，WorkBuddy 就能操作哪台机器。**
要让 WorkBuddy 操作生产台式机，agent 必须跑在台式机上。

---

## 二、台式机上的操作（一次性）

### 步骤 1：装 Node.js（若已有则跳过）

检查：`node --version`（需 18+）
没有的话：<https://nodejs.org/> 下载 LTS 版安装。

### 步骤 2：启动 agent

在台式机的 PowerShell 里：

```powershell
npx -y @wonderwhy-er/desktop-commander@latest remote
```

首次运行会打开浏览器做设备码授权，**用与本机相同的账号登录**
（Google 账号 `martin0000118@gmail.com`）。

### 步骤 3：让它常驻

agent 必须一直运行，关掉终端就失去访问。用其中一种：

**方式 A（简单）**：开一个 PowerShell 窗口跑上面的命令，别关。

**方式 B（推荐，配成开机自启）**：用 nssm 或计划任务，把它注册为服务。

**方式 C（Docker）**：若台式机没装 Node.js 但有 Docker：

```powershell
docker run -d --name dc-agent --restart unless-stopped `
  -v "$env:USERPROFILE:/data" `
  node:22 npx -y @wonderwhy-er/desktop-commander@latest remote
```

> 授权信息保存在 `~/.desktop-commander-device/device.json`（Windows 上在用户目录），
> 重启 agent 会复用已保存的会话，不需要每次重新授权。

---

## 三、验证

在**本机**（WorkBuddy 所在的这台 Mac）执行：

```bash
python3 scripts/remote-exec.py --list
```

应看到台式机在线：

```
1. <台式机名>
   Status: Online
   ID: <设备 id>
```

再执行一条命令：

```bash
python3 scripts/remote-exec.py "hostname && whoami"
```

应返回台式机的信息。

> 注意：本机要执行 `remote-exec.py` 需要本机也有 `~/.desktop-commander-device/device.json`
> （即本机也授权过）。若只有台式机授权了，本机需先跑一次
> `npx -y @wonderwhy-er/desktop-commander@latest remote` 完成授权。
> 两台机器都授权后，用 `--device <id>` 指定目标。

---

## 四、日常用法

```bash
# 列设备
python3 scripts/remote-exec.py --list

# 在指定设备执行
python3 scripts/remote-exec.py --device <设备id> "cd D:\电商数据分析系统\psi-inventory-feishu-auth; git status"

# 读某个后台进程的输出
python3 scripts/remote-exec.py --read <pid>
```

脚本行为：把命令写成脚本写到设备上 → 设备侧后台执行、输出写文件 → 读回文件 → 打印输出与退出码。

**凭据**：只使用设备本地的 `device.json`，不入库、不进聊天。

---

## 五、一次完整部署（示例）

```bash
python3 scripts/remote-exec.py --device <id> "cd D:/电商数据分析系统/psi-inventory-feishu-auth && git pull origin fix/shopee-brand-portal-modern-oauth-20261027 && cd shopee-analytics/deploy/desktop && docker compose --env-file runtime/.env up -d --build app oauth"
```

随后验证（可直接从本机访问线上）：

```bash
curl https://analytics.hitechanalysis.top/api/shopee-analytics/health
curl -o /dev/null -w '%{http_code}\n' https://analytics.hitechanalysis.top/connections.html
```

更完整的步骤见 `production-deploy.md`，其中含备份与回滚。

---

## 六、注意事项

| 事项 | 说明 |
|---|---|
| agent 必须常驻 | 终端关掉即失去访问；建议注册为服务 |
| 授权会过期 | 过期后在台式机重启 agent 即可（会话持久化在 device.json） |
| 破坏性命令 | 先列出完整命令与影响范围，确认后再执行 |
| 凭据 | 不写进脚本、不写进仓库、不写进聊天 |
| 数据库 | 修改前必须备份 |
| PSI 系统 | 不在本模块范围内，不动 |

---

## 七、已知的调用特性

服务端行为（实测得出，写脚本时需注意）：

- 工具调用是**异步**的：先返回 `call_id`，结果要用 `get_tool_result` 取
- `start_process` 的 HTTP 响应要等命令结束才回来 → 放在后台线程发
- `read_file` 约 0.8 秒返回，可同步轮询
- 设备离线时返回明确提示：`No Desktop Commander device is currently online`
- Cloudflare 会拦无 User-Agent 的请求（error 1010）→ 必须带正常 UA
