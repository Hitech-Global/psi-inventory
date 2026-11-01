# 远程接入 Production —— 当前状态与所需操作

> 复核时间：2026-11-01 16:30
> 结论：**通道机制已验证可用；唯一阻塞是 Desktop Commander 账号不匹配。**

---

## 一、已验证可用（实测）

Desktop Commander Remote MCP 的三层结构已跑通：

```
AI 客户端（本机 WorkBuddy）
  → https://mcp.desktopcommander.app/mcp   （托管服务，OAuth）
    → 设备端 agent（npx @wonderwhy-er/desktop-commander@latest remote）
      → 在该机器上执行命令 / 读写文件
```

实测通过的三个动作（agent 自身日志为证）：

```
✅ write_file  → "Successfully wrote to /Users/wwt46/dc-remote-cmd.sh (5 lines)"
✅ read_file   → 返回文件内容（0.8 秒）
✅ start_process → 执行命令，退出码带回
```

远端输出实测内容：

```
REMOTE_EXEC_OK
madingdezaochendeMacBook-Pro.local
wwt46
Darwin
__EXIT__0
```

**服务端行为（写脚本必须知道）**

| 现象 | 说明 |
|---|---|
| 工具调用异步 | 先返回 `call_id`，结果用 `get_tool_result` 取 |
| `start_process` 的 HTTP 响应 | 要等命令结束才回来 → 必须放后台线程发 |
| `read_file` | 约 0.8 秒返回，可同步轮询 |
| 设备离线 | 返回 `No Desktop Commander device is currently online` |
| 无 User-Agent | 被边缘拦（error 1010）→ 必须带浏览器 UA |
| 读文件返回 | 会加一行 `[Reading N lines from start ...]` 头 |

---

## 二、当前阻塞：账号不匹配 ⚠️

**服务端返回的原始错误：**

```
Device with id "Hitech台式" not found for this account.
Online devices:
- madingdezaochendeMacBook-Pro.local (id: 343f5de4-51d3-4740-9767-91ada91f402d)
```

**账号状态（本机 token 查询结果）：**

| 项 | 值 |
|---|---|
| `who_am_i` 的 email | `martin0000118@gmail.com`（Google 登录） |
| `device_count` | **1** |
| 该账号下的设备 | 只有 `madingdezaochendeMacBook-Pro.local` |
| 本机 agent 登录的账号 | `martin0000118@gmail.com`（agent 日志确认） |

**结论：Hitech 台式机配在了另一个 Desktop Commander 账号下。**
Desktop Commander 的设备按账号隔离 —— `list_devices` 返回 "this account's devices"，
不在同一账号就既看不到也调不到。

---

## 三、解决办法（两条，选一条）

### 方案 A：把台式机配到当前账号（推荐）

在 **Hitech 台式机**上：

```powershell
npx -y @wonderwhy-er/desktop-commander@latest remote
```

浏览器弹窗后 → **用 `martin0000118@gmail.com` 登录**（与这台 Mac 同一个账号）
→ 确认配对码一致 → 保持窗口运行。

配好后 `list_devices` 会返回两台设备，我用 `--device <台式机ID>` 指定。

> 注意：如果台式机当前是用别的账号登录的，先执行
> `npx -y @wonderwhy-er/desktop-commander@latest remote --logout`
> 退出当前账号，再用正确账号登录。

### 方案 B：把本机配到台式机所在的账号

如果台式机那个账号更方便拿到，在**这台 Mac**上退出并用那个账号登录：

```bash
npx -y @wonderwhy-er/desktop-commander@latest remote --logout
npx -y @wonderwhy-er/desktop-commander@latest remote
```

用台式机所在的账号登录。

### 怎么确认台式机用的是哪个账号

在台式机上查看 agent 的启动输出，或看它的
`%USERPROFILE%\.desktop-commander-device\device.json` 里的会话信息。

---

## 四、账号一致后要做的事

### 1. 列出设备并找到台式机

```bash
python3 scripts/remote-exec.py --list
```

### 2. 读远程 Windows 文件

```bash
python3 scripts/remote-exec.py --device <台式机ID> "type D:\电商数据分析系统\psi-inventory-feishu-auth\shopee-analytics\package.json"
```

### 3. 执行 PowerShell 命令

```bash
python3 scripts/remote-exec.py --device <台式机ID> "powershell -NoProfile -Command \"git -C 'D:\电商数据分析系统\psi-inventory-feishu-auth' status\""
```

### 4. 生产只读检查（接入后的第一件事）

```powershell
cd D:\电商数据分析系统\psi-inventory-feishu-auth
git branch --show-current
git log --oneline -1
git status
cd shopee-analytics\deploy\desktop
docker compose --env-file runtime/.env ps
```

加上两个线上健康检查（可直接从本机 curl）：

```bash
curl https://analytics.hitechanalysis.top/api/shopee-analytics/health
curl https://auth.hitechanalysis.top/health
```

---

## 五、接入后的完整能力

| 目标 | 手段 |
|---|---|
| 代码开发 | 本机改 → commit → push；台式机 pull |
| 文件读写 | `read_file` / `write_file` / `edit_block` |
| PowerShell 命令 | `start_process` + `interact_with_process` |
| Git 管理 | 在台式机上执行 `git` 命令 |
| Docker 管理 | `docker compose ps` / `up -d --build` / `logs` |
| PostgreSQL 管理 | `docker compose exec postgres psql` |
| 测试与故障排查 | 在台式机上跑测试、看容器日志 |
| Production 部署 | `deploy-analytics-windows.ps1`（备份→pull→rebuild→验证） |

---

## 六、安全约定（不变）

- 凭据只走设备本地 `device.json` 与 `runtime/.env`，**不入库、不进聊天**
- 破坏性命令先列完整命令与影响范围，确认后再执行
- Production 数据库修改前必须备份
- 所有 Production 变更走 Git commit，可回滚
- 不动 PSI 进销存系统
