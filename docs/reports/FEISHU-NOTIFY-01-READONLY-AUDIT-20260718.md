# FEISHU-NOTIFY-01 只读审计报告 + 实施方案（待确认）

> 阶段：只读审计完成 → 输出方案 → **等待架构确认** → 最小修改 → 隔离测试 → 验收报告。
> 本轮零代码修改、零数据库修改、零飞书后台修改。
> 纪律：只读排查 → 方案 → 确认 → 实施。

---

## 一、只读审计结论（5 重点）

### ① 当前飞书登录能力（`server.js`）
- Web OAuth 授权码流程（`authorization_code` grant），用 `FEISHU_APP_ID` / `FEISHU_APP_SECRET`（`server.js:31-32`）。
- 端点：`GET /api/auth/feishu/login`（`:345`）→ `GET /api/auth/feishu/callback`（`:355`）。
- `exchangeFeishuCode`（`:137-168`）：**仅换取「用户级 `user_access_token`」**，再拉 `user_info`，返回 `open_id/union_id/user_id/name/email/mobile`。**token 不落库**（`:37` 结论）。
- Mock 机制：`FEISHU_MOCK=1` 仅在 `NODE_ENV=test` 允许（`:41-43` fail-closed 拒绝非测试启用）；测试用 `global.__FEISHU_TEST__`（`:138`）。
- **缺口：无任何 `tenant_access_token` 换取、无 `im/v1/messages` 发送、无通知相关代码。**

### ② 用户 open_id 存储（`db.js`）
- `users` 表含 `feishu_open_id`（UNIQUE 索引 `idx_users_open_id`，`WHERE feishu_open_id<>''`）、`feishu_union_id`、`feishu_user_id`（`:109-118`）。
- 该 `feishu_open_id` 是**当前独立应用内**的 open_id，与登录同源 → 可直接作为同应用 bot 发消息的 `receive_id`（一致，无需转换）。

### ③ 现有事件触发点（`server.js`）
- `POST /api/purchase-orders/:id/submit-approval`（`:3759-3832`）：生成审批实例 + 写 `business_participants`(cc) + 置 PO `pending_approval`（同事务，`:3820-3829`）。
- `POST /api/purchase-orders/:id/approve`（`:3835-3893`）：`approve`(中间级 `:3878-3881` / 终极 `:3873-3877`)、`reject`(`:3882-3885`)、`withdraw`(`:3886-3889`)，均改 `approval_records` + `purchase_orders` 状态。
- 触发钩子位置：以上路由的**事务提交后、`res.json` 之前**，以非阻塞 best-effort 触发（绝不影响状态机与回滚）。

### ④ business_participants 复用方式
- V1 已落地 `(business_type='approval', business_id=approval_records.id, participant_type='cc', user_id)`。
- 通知收件人解析：`business_participants` → `users.id` → `users.feishu_open_id`；零代码改动即可复用，天然支持未来 `ci_prep`/`payment_reminder`。

### ⑤ 最小通知方案（缺口 + 依赖）
- **代码缺口**：缺 `tenant_access_token` 获取 + 缺消息发送函数。
- **硬配置依赖**：独立飞书应用须启用「机器人」能力 + `im:message`（或 `im:message:send_as_bot`）权限，且收件人处于应用可见范围。此属 AUTH-FEISHU-LIVE-01 **L1（飞书后台最小配置，进行中）**。L1 完成前无法真实送达；代码可先实现，但真实投递需等 L1。
- **复用**：同一 `FEISHU_APP_ID/SECRET`（独立应用，不共用售后 App），符合冻结约定。

---

## 二、实施方案（待确认）

### 2.1 新增后端能力（`server.js`，全部新增、不改既有路由逻辑）
1. `getFeishuTenantToken()`：调 `POST /open-apis/auth/v3/tenant_access_token/internal`（`app_id`+`app_secret`）；**进程内内存缓存**（带过期，约 2h，不落库，避免每次发消息都换 token、避免敏感 token 持久化）。
2. `sendFeishuTextMessage(openId, text)`：调 `POST /open-apis/im/v1/messages?receive_id_type=open_id`，body `{receive_id, msg_type:'text', content: JSON.stringify({text})}`；返回飞书响应。
3. `notifyApprovalParticipants(approvalId, eventType, ctx)`：统一封装——
   - 解析收件人：CC（`business_participants`→`users.feishu_open_id`）+ 相关审批人/提交人（按 eventType）；
   - 过滤 `feishu_open_id` 为空的账号（本地-only 用户跳过，不报错）；
   - 逐个 `sendFeishuTextMessage`，**每个独立 try/catch，单条失败不影响其余、不抛回主流程**；
   - **任何飞书异常都不影响审批结果**（best-effort，fire-and-forget）。

### 2.2 触发点（仅追加，不改动既有状态/权限/状态机）
| 事件 | 通知对象 | 文案要点 |
|---|---|---|
| submit-approval（提交后） | CC 用户 + 一级审批人 | 「PO {po_no} 已提交审批，待您处理/抄送知会」 |
| approve（中间级通过） | 下一级审批人 + CC | 「PO {po_no} 第N级已通过，待您审批」 |
| approve（终极通过） | 提交人 + CC | 「PO {po_no} 审批已全部通过」 |
| reject | 提交人 + CC | 「PO {po_no} 已被驳回」 |

（withdraw 本轮不通知，保持最小；如需要可后续加。）

### 2.3 安全测试（关键，结合用户补充纪律）
- **真实发送禁令**：目标 CC 测试账号 = 真实管理员飞书账号（`ou_0f234f74ac3954da65bb3ca0592d45d9`）。测试中**严禁真实送达**。
- 复用 mock 思路：扩展 `FEISHU_MOCK` 语义或新增 `FEISHU_NOTIFY_DRYRUN=1` → `sendFeishuTextMessage` 不调真实 API，改为**内存记录构造的 `{open_id, text}` payload**，供断言验证；仅在 `NODE_ENV=test` 或显式 dry-run 下生效（fail-closed，生产默认真实发送）。
- 隔离测试仍严格先确认 **①`DB_PATH` ②环境变量 ③目标数据库身份**（用户本轮补充纪律），且**子进程唯一写库**。

### 2.4 可选：轻量 `feishu_message_log` 表（仅 ops 审计，非消息中心）
- 字段：`id, business_type, business_id, event_type, recipient_open_id, status(sent/failed/skipped), error, created_at`。
- 用途：排查投递、对账；**不含收件箱/已读/回执**，不构成消息中心。
- 是否新增由用户确认（若否决，则复用 `operation_logs` 记一条 `page='feishu_notify'` 审计，或完全不落库只打日志）。

### 2.5 冻结 / 不做
- 不改审批状态机、审批人逻辑、待我审批过滤、付款链/采购WAC、登录链路。
- 不建消息中心、已读、回执、自动 CC 规则、模板引擎、第三方接入。
- 不共用售后 App Secret/ID；不静默 fallback。

---

## 三、影响评估
- **审批逻辑**：零影响（通知为事务外 best-effort 副作用，飞书故障不阻断审批）。
- **既有接口**：既有审批接口响应不变；新增为内部调用 + 可选日志表。
- **性能**：tenant token 内存缓存；每条消息一次网络调用，失败即跳过。
- **生产零污染**：隔离副本测试，不 commit/push/deploy。

## 四、测试计划（隔离）
1. 提交带 CC → 断言 CC 用户 + 一级审批人进入收件人集合、构造的 payload 正确（dry-run 记录）。
2. 中间级通过 → 下一级审批人 + CC 收到；终极通过 → 提交人 + CC 收到；驳回 → 提交人 + CC 收到。
3. 本地-only 用户（无 open_id）→ 被跳过，不报错。
4. 飞书发送抛异常 → 审批仍成功（不影响状态机）。
5. 生产库零残留（DB_PATH/环境变量/目标库身份三确认 + 子进程唯一写库）。

## 五、需用户确认事项
1. **飞书后台 bot/`im:message` 权限**：由谁在独立应用控制台启用？（硬前置；L1 进行中，未完成前仅能 dry-run 验证，无法真实送达）
2. 是否新增 `feishu_message_log` 表（还是复用 `operation_logs` / 不落库）。
3. 触发范围确认：仅 CC，还是 CC + 审批人 + 提交人（方案默认后者）。
4. 文案模板是否采用上方要点（或你给固定模板）。

*方案完。确认后进入最小修改。*
