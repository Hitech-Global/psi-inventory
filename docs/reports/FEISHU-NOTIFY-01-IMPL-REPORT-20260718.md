# FEISHU-NOTIFY-01 实施验收报告

- 日期：2026-07-18
- 阶段：FEISHU-NOTIFY-01（PO 审批飞书通知，应用级 tenant_access_token）
- 纪律：只读排查 → 方案 → 确认 → 最小实施 → 隔离测试 → 验收报告（**未 commit/push/deploy**）

---

## 一、任务范围与确认项回顾

在只读审计（`FEISHU-NOTIFY-01-READONLY-AUDIT-20260718.md`）与 4 项确认基础上实施：

| # | 确认项 | 实施结果 |
|---|--------|----------|
| 1 | 飞书后台 bot/im:message 权限 | 作为 AUTH-FEISHU-LIVE-01 前置配置项，**代码不等待**；真实发送待权限就绪后执行 |
| 2 | feishu_message_log | **本阶段不新增**；不建消息中心；不保存消息状态；失败记录复用现有 `console.error` 日志 |
| 3 | 通知范围 | submit→L1 审批人+CC；L1 通过→下一级审批人+CC；终极通过→提交人+CC；驳回→提交人+CC |
| 4 | 文案 | V1 固定模板（`FEISHU_NOTIFY_TEMPLATES`），不建模板管理 |

**实施约束（严格遵守）**：飞书失败不得影响业务事务；best-effort；事务完成后触发；不修改审批状态机。
**严格禁止项（均未触碰）**：消息中心 / 已读回执 / 通知规则引擎 / 自动 CC 规则 / 付款链修改 / 采购 WAC 修改。

---

## 二、实际修改文件与代码位置

> 透明披露：本阶段**仅修改 `server.js`**。`app.js` / `db.js` / `index.html` 的 git `M` 状态来自此前阶段（BUSINESS-CC-CORE-01 等）的未提交改动，与本阶段无关，本阶段未触碰。

### `server.js`

**A. FEISHU-NOTIFY-01 能力块（约 170–256 行）**
- `getFeishuTenantToken()`：应用级 `tenant_access_token` 获取，进程内存缓存（提前 5 分钟刷新），无 `FEISHU_APP_ID/SECRET` 时抛错（fail-fast）。
- `sendFeishuTextMessage(openId, text)`：best-effort 发送；`NODE_ENV=test` 或 `FEISHU_NOTIFY_DRYRUN=1` 或 `FEISHU_NOTIFY_FORCE_FAIL=1` 时只记录 payload 不真实发送；真实模式带 5s `AbortSignal.timeout`。
- `FEISHU_NOTIFY_TEMPLATES`：submit / approved_intermediate / approved_final / reject 四套固定文案。
- `notifyApprovalParticipants(approvalId, eventType, ctx)`：事务外 best-effort；仅向有 `feishu_open_id` 的用户发送；无收件人静默返回；收件人解析失败时仅 `console.error`，不影响业务。

**B. 诊断端点（约 481–483 行）**
- `GET /api/feishu/notify/dryrun-log`：仅当 `NODE_ENV=test` 或 `FEISHU_NOTIFY_DRYRUN=1` 时返回 `{log:[...]}`（含 dryrun 期间记录的 payload）；否则返回 **404**。生产常态恒 404 且不可读出任何内容，安全。

**C. 四个触发钩子（事务提交 + res.json 之后，fire-and-forget `.catch(()=>{})`）**
- `server.js:3925` 提交审批后 → `notifyApprovalParticipants(approvalId, 'submit', ...)`
- `server.js:3975` 终极通过 → `'approved_final'`
- `server.js:3980` 中间级通过 → `'approved_intermediate'`
- `server.js:3987` 驳回 → `'reject'`
- `withdraw` 分支**未修改**（超出本阶段范围，按确认保持现状）。

**D. 隔离测试中发现的真实缺陷修复（已修复，必须披露）**
- 原 `approved_intermediate` 收件人解析为 `approvers.find(a => a.level === (approval.current_level || 1) + 1)`。但触发 notify 时 `current_level` **已被处理为“下一级待审”级次**（如 L1 通过后 = 2），`+1` 会去找不存在的级次 3，导致**中间级通过时通知不到下一级审批人**。
- 修复为 `approvers.find(a => a.level === (approval.current_level || 1))`（即直接按已递增后的 `current_level` 定位下一级审批人）。该修复让 T2（中间级→下一级 L2）断言通过。

---

## 三、隔离测试结果

一次性隔离脚本（仅 `cp` 生产主库文件到副本，父进程绝不 `better-sqlite3` 打开生产库；子进程直连副本；`FEISHU_NOTIFY_DRYRUN=1` + `FEISHU_NOTIFY_FORCE_FAIL=1` 避免真实飞书 API 调用）。运行后脚本已按纪律删除。

**结果：PASS=31 / FAIL=0（全部通过）**

覆盖断言（节选）：
- 提交→通知 L1(`ou_test_l1`) + CC(`ou_test_cc`) + 真实管理员飞书账号(`ou_0f234...`)；无 `feishu_open_id` 用户被跳过（不生成空记录）。
- 一级通过→通知下一级(`ou_test_l2`) + CC；审批推进到 level2/pending。
- 二级通过→通知提交人(`ou_test_sub`) + CC；审批实例=approved、PO=approved（状态机正确）。
- 驳回→通知提交人 + CC；审批实例=rejected、PO 回到 draft（状态机正确）。
- FORCE_FAIL 韧性：飞书强制失败下，提交仍返回 200，PO 仍为 pending_approval（事务已提交，未因通知失败回滚）；dryrun 记录含 `forced_fail=true`（证明通知路径被执行但被捕获）。
- 非审批逻辑（/api/version）未受影响。

---

## 四、生产库零污染核查

隔离测试结束后对生产库 `data/inventory.db` 直接核查：
- `POTEST%` PO 数量 = **0**
- `UT_%` 测试用户数量 = **0**
- 测试会话数量 = **0**

父进程仅 `cp` 主库文件、不打开生产库；仅子进程写副本，生产库零写入。

---

## 五、是否影响已有审批流程

**不影响。** 通知为事务外 fire-and-forget（`.catch(()=>{})`），不修改 `approval_records` / `purchase_orders` 任何状态，不回滚，不阻断；审批状态机（submit / approve / reject / withdraw）代码路径未被改动。隔离测试中 PO 状态机、审批实例状态、CC 关系落库均验证正确。

---

## 六、已知限制与待办

1. **真实飞书发送尚未联调**：依赖飞书后台为该独立应用开启 **bot + im:message** 权限（AUTH-FEISHU-LIVE-01 L1，进行中）。权限就绪后，将真实发送从 dryrun 切到实发，并补充一次真实发送冒烟（仍走隔离副本，不写生产）。
2. **tenant_access_token 缓存**为进程内存，重启失效后首次通知会重新获取（可接受）。
3. **withdraw 不通知**：按确认范围保持现状；若后续需要，另立小任务。
4. **未新增消息持久化表**：失败仅落应用日志，无消息中心/已读回执（按确认 #2）。

---

## 七、下一步

- 待 AUTH-FEISHU-LIVE-01 L1（bot/im:message 权限）完成 → 切换实发并做真实发送冒烟（隔离副本）。
- 本阶段完成后，按既定顺序进入下一阶段（SYS-MGMT-AUDIT-01 或用户指定任务）。
- **本阶段不执行 commit/push/deploy**（用户明确纪律）。
