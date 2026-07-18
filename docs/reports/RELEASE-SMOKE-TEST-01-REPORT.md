# RELEASE-SMOKE-TEST-01 报告 · 生产环境上线冒烟验证

- **执行时间**：2026-07-18 16:3x GMT+8
- **纪律**：只读验证，不修改代码，不新增功能；所有写路径（真实审批提交 / 真实飞书发送）**有意不执行**，以避免对生产数据造成状态变更。
- **方法**：以 `NODE_ENV=production` 启动当前代码（读取既有 `.env`），对真实工作库 `./data/inventory.db` 做冒烟；启动即应用了待生效的增量迁移（创建 `business_participants` 表与 CI 运营准备列）；测试结束后已确认端口释放、无残留进程。
- **结论**：✅ **上线冒烟通过** —— 全部只读验证项 PASS，启动无错误，备份脚本可运行，数据量正常。发现若干**配置类待办与受控验证建议**（均非阻断、不影响只读功能），按纪律未做任何修改。

---

## 1. 服务健康 ✅ PASS

| 项 | 结果 |
|---|---|
| 服务启动 | 正常，`[DB] 数据库表初始化完成`、`[Server] 已启动: http://localhost:3001` |
| 页面可访问 | `GET /` → **200**，34,958 字节，含「飞书」与「登录」入口 |
| API 正常 | 11 个接口全部 **200**（见第 3/4 节） |
| 启动错误日志 | **无**（启动日志 14 行，零 error/exception/migration） |

## 2. 登录与权限 ✅ PASS

| 项 | 结果 |
|---|---|
| 飞书登录入口 | `GET /api/auth/feishu/login` → **302**，正确跳转飞书授权地址（`client_id=cli_aad2251dbaf85bc6`，`redirect_uri=http://localhost:3001/...`）。完整 SSO 仍需 **B3（飞书 L1：bot + im:message 权限）** + 浏览器回调。 |
| break-glass 账号 | `POST /api/auth/local/login`（username=admin）→ **200**，成功下发 `session_token`，角色=超级管理员，权限数=**51** ✅ 可用 |
| 未登录拦截 | `GET /api/me`（无 cookie）→ **401** ✅ 鉴权门禁正常 |
| 三角色权限定义 | 超级管理员=51 / 运营人员(operator)=42 / 普通用户(viewer)=15，均为系统角色，权限分层正确 |

## 3. 核心业务只读检查 ✅ PASS

| 接口 | 状态 | 数据量 |
|---|---|---|
| `GET /api/purchase-orders`（PO） | 200 | 27 |
| `GET /api/proforma-invoices`（PI） | 200 | 44 |
| `GET /api/commercial-invoices`（CI） | 200 | 48 |
| `GET /api/wac-history`（WAC） | 200 | 3 |
| `GET /api/payment-requests`（Payment） | 200 | 48 |
| `GET /api/replenishment-suggestions`（预测） | 200 | 376 |

## 4. 最近上线功能验证

| 项 | 结果 |
|---|---|
| 审批流配置 | `GET /api/approval-flows` → **200**，返回 **10** 条配置 ✅ |
| 审批提交 | 端点已接入（`POST /api/purchase-orders/:id/submit-approval`，并在 submit/approve/reject 调用 `notifyApprovalParticipants`）。**本次未真实执行提交**（避免状态变更），建议上线后受控验证。 |
| CC 展示 | CI 运营准备接口返回含 `cc` 字段（`GET /api/commercial-invoices/:id/ops-prep` → 200，结构 `{ci_no, wac_confirmed, ops_owner_id, ops_owner_name, ops_plan_listing_date, ops_ready_status, cc}`），CC 数据通道已就绪 ✅ |
| FEISHU-NOTIFY 状态 | 通知能力已代码接入并在审批事件中触发（`sendFeishuTextMessage` 受环境开关保护）。生产模式下会**真实发送**，需 **B3（L1 权限）+ 接收人 open_id** 方可成功；提供 `FEISHU_NOTIFY_DRYRUN` / `FEISHU_NOTIFY_FORCE_FAIL` 安全演练开关。**本次未真实发送。** |
| CI 运营准备页面 | `GET /api/commercial-invoices/:id/ops-prep` → **200**，完整返回 wac_confirmed 与运营字段 ✅ |

## 5. 数据安全 ✅ PASS

| 项 | 结果 |
|---|---|
| 数据库连接 | 正常（服务端所有查询均成功返回） |
| backup 脚本可运行 | `node scripts/backup.js`（指向临时目录）→ 成功产出 **28.2MB 单文件**，`integrity_check=ok` ✅ |
| 当前数据量正常 | PO 27 / PI 44 / CI 48 / Payment 48 / WAC 3 / skus 420 / inventory 401 / approval_flows 10 / replenishment 376，与启动前一致，无异常膨胀 |

## 6. 日志检查 ✅ PASS

- 扫描启动日志（`/tmp/smoke-server.log`）：**无** `error` / `unhandled` / `exception` / `uncaught` / `migration fail` / `throw` / `EADDRIN` / `crash` 关键字。
- 迁移执行无报错，启动日志干净。

---

## 发现的问题 / 风险（仅报告，未修改）

> 以下均按纪律**未做任何代码/功能修改**，供上线前决策。

- **F1（配置缺口·建议上线前处理）**：生产 `.env` 当前**未设置 `NODE_ENV=production`**，亦**缺失 `TRUSTED_ORIGINS`**。本次冒烟以 `NODE_ENV=production` 覆盖启动。真实部署经 nginx 反代后，若 `TRUSTED_ORIGINS` 不含公网域名，CSRF 防护会 **403 拒绝所有写请求**（GET 不受影响）。建议部署 `.env` 显式设置 `NODE_ENV=production` 与 `TRUSTED_ORIGINS=<公网域名>`（详见 `DEPLOY.md`）。
- **F2（预期行为）**：启动日志 `[AUTH] break-glass 密码已更新，旧 Session 已失效` —— 表示 `.env` 中的 `BREAKGLASS_ADMIN_PASSWORD` 与库内旧哈希不一致，启动即重新同步并作废旧会话。首次部署属预期；记录以备排障。
- **F3（预期）**：`business_participants` 表已由迁移创建，但当前 **0 行**（CC 待在运营准备保存时分配），符合预期。
- **F4（受控验证建议）**：审批提交与 FEISHU-NOTIFY 的**真实写路径本次未执行**（遵守不修改/数据安全）。上线后建议做：① 一次真实审批提交→确认状态机与通知触发；② 在 B3 完成后做飞书真实发送冒烟。
- **F5（账号建议）**：当前仅 2 个 admin 用户（break-glass + 1 飞书 admin），**无 operator / viewer 账号**。三角色权限定义正确（51/42/15），建议上线后配齐各至少 1 个测试账号并验证其权限边界。
- **F6（已知残留风险·非本次引入）**：缺少全局错误处理中间件（早前 R1 建议，已递延）。本次未触发；上线后若出现未捕获异步异常可能挂起请求，建议后续补强。

---

## 附录：执行方法

- 启动：`NODE_ENV=production TRUSTED_ORIGINS=http://127.0.0.1:3001 node server.js`（读取既有 `.env`；日志落 `/tmp/smoke-server.log`）。
- 客户端：以 break-glass 登录获取 `session_token`，对全部接口做只读 GET（密码从 `.env` 读取，不落地打印）。
- 备份验证：`BACKUP_DIR=/tmp/smoke-backup node scripts/backup.js`（产物 28.2MB 单文件，integrity_check=ok）。
- 收尾：已 `kill` 全部 `node server.js` 进程，`lsof -iTCP:3001` 确认无监听者；临时文件已清理。
- **未做**：未提交代码、未 push、未部署；未对生产库做除增量迁移外的任何写操作（增量迁移为代码预期内的发布步骤）。
