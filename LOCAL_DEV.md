# 进销存系统 — 本地开发 / 运行指南（LOCAL_DEV）

本文档说明如何在本地（Mac）启动、访问、停止与重启进销存管理系统。
部署到 Render 线上环境的相关说明见 `render.yaml`，不在本文档范围内。

---

## 1. 项目目录

```
/Users/a1-6/Workbuddy/2026-07-04-17-45-01/inventory-app
```

关键文件：

| 文件 | 说明 |
|------|------|
| `server.js` | Express 后端服务（端口 3001） |
| `app.js` | 前端逻辑（页面渲染 / 交互） |
| `index.html` | 页面结构 + 样式 |
| `db.js` | SQLite 数据库初始化（`./data/inventory.db`） |
| `start.sh` | 本地一键启动脚本（已加可执行权限） |
| `render.yaml` | Render 部署配置（线上用，本地不用） |

依赖：`node`（建议 ≥ 18，当前验证环境 v22.22.2）。首次运行前执行 `npm install`。

---

## 2. 如何启动本地服务

### 方式一（推荐）：用启动脚本

```bash
cd /Users/a1-6/Workbuddy/2026-07-04-17-45-01/inventory-app
./start.sh
```

`start.sh` 会自动切到自身所在目录并以 `PORT=3001` 启动服务，**无需手动设置目录或端口**。
服务在前台运行，终端会持续打印日志。

### 方式二：直接运行

```bash
cd /Users/a1-6/Workbuddy/2026-07-04-17-45-01/inventory-app
PORT=3001 node server.js
```

> 注意：服务是本地进程，不会跨会话常驻。关闭终端 / 进程被回收后需重新启动。

---

## 3. 正确访问地址

在**真实浏览器**（Safari / Chrome 等）地址栏输入：

```
http://localhost:3001
```

✅ 这是唯一正确的访问方式。localhost 服务运行在你本机，真实浏览器可直接访问。

---

## 4. 管理员入口和账号

- 管理员入口（进入管理视图）：`http://localhost:3001?admin`
- 默认账号：`admin`
- 默认密码：`admin`

普通访问直接使用 `http://localhost:3001` 即可。

---

## 5. 为什么不要使用 WorkBuddy 内置预览 iframe

WorkBuddy 的「预览」面板本质是一个 **iframe**，受浏览器同源策略与沙盒限制：

- 它**禁止加载 `http://localhost` 这类不同源的地址**，会报错：
  `Unsafe attempt to load URL http://localhost:3001/... from frame with URL chrome-error://chromewebdata/`
- 这个报错**不是服务或代码的问题**，是平台预览框的安全限制。
- 同样，WorkBuddy 的 Bash 沙箱会在任务空闲 / 回收时销毁整个进程命名空间，
  后台启动的服务也会随之停止（即使 `setsid` / `nohup` 也无法常驻）。

**结论**：请始终用第 3 节的真实浏览器地址访问；不要用 WorkBuddy 预览框打开 localhost。
若希望服务长期稳定运行，请在 Mac 终端用 `./start.sh` 启动（不受 WorkBuddy 沙箱影响）。

---

## 6. 如果 localhost 打不开，如何排查

按以下顺序检查：

1. **服务是否在跑？**
   ```bash
   curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/
   ```
   - 返回 `200` → 服务正常，问题在浏览器（清缓存 / 换浏览器 / 别用预览框）。
   - 返回 `000` 或连接失败 → 服务没起来，继续下面步骤。

2. **端口是否被占用 / 有残留进程？**
   ```bash
   lsof -ti tcp:3001
   ```
   若有输出 PID，先释放（见第 7 节「停止服务」），再重新 `./start.sh`。

3. **是不是用了 WorkBuddy 预览框？**
   若看到 `chrome-error://chromewebdata/` 报错，请改用真实浏览器打开 `http://localhost:3001`。

4. **依赖是否安装？**
   ```bash
   npm install
   ```
   再启动。

5. **查看启动日志**
   直接运行时日志在终端；用 `start.sh` 时日志也在终端。也可检查
   `/tmp/inventory_server.log`（若此前重定向过）。

6. **数据库是否损坏？**
   数据文件在 `./data/inventory.db`。如怀疑损坏，删除 `./data/inventory.db*` 后
   用 `node insert_demo_data.js` 重新生成演示数据（会清空现有数据，谨慎）。

---

## 7. 如何停止服务

### 在启动终端里
直接按 `Ctrl + C` 即可停止。

### 终端已关闭 / 后台运行的情况
通过端口找到进程并结束：

```bash
lsof -ti tcp:3001 | xargs kill
```

如仍无法停止，可加 `-9` 强杀：

```bash
lsof -ti tcp:3001 | xargs kill -9
```

> 若是经 WorkBuddy 后台任务启动的，任务被沙箱回收时服务会自动停止；
> 如需主动停止，可在 WorkBuddy 的任务面板结束对应后台任务，或用上面的端口杀进程法。

---

## 8. 如何重启服务

1. 先停止（见第 7 节），确保 3001 端口已释放：
   ```bash
   lsof -ti tcp:3001 | xargs kill   # 若无输出说明端口已空
   ```
2. 重新启动：
   ```bash
   cd /Users/a1-6/Workbuddy/2026-07-04-17-45-01/inventory-app
   ./start.sh
   ```
3. 验证：
   ```bash
   curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/
   # 返回 200 即成功
   ```
4. 在真实浏览器打开 `http://localhost:3001`。

---

## 常见问题速查

| 现象 | 原因 | 解决 |
|------|------|------|
| 预览框报 `chrome-error://chromewebdata/` | iframe 禁止加载 localhost | 用真实浏览器打开 `http://localhost:3001` |
| 浏览器显示无法连接 / curl 返回 000 | 服务被沙箱回收或未启动 | 终端执行 `./start.sh` 重启 |
| 启动报 `EADDRINUSE` | 3001 端口被旧进程占用 | `lsof -ti tcp:3001 \| xargs kill` 后重启动 |
| 启动报 `command not found: node` | 终端 PATH 无 node | 安装 Node.js（≥18）并确认 `node -v` 可用 |
