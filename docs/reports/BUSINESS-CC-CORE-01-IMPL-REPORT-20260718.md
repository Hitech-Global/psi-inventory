# BUSINESS-CC-CORE-01 业务协同 CC 基础能力 V1 —— 实施报告

> 日期：2026-07-18
> 范围：在现有审批体系上增加最小 CC 能力；建立可复用的通用业务参与人模型（本轮仅 `participant_type='cc'`，`owner` 仅预留列不进代码）。
> 纪律：只读确认 → 方案确认 → 最小修改 → 隔离测试 → 验收报告。生产库零污染，未 commit/push/deploy。

---

## 一、修改文件（4 个）

| 文件 | 改动 |
|---|---|
| `db.js` | 新增 `business_participants` 表（`CREATE TABLE IF NOT EXISTS`）+ 索引 `idx_business_participants` |
| `server.js` | ① 新增 `GET /api/cc-candidates`；② `submit-approval` 接收可选 `cc_user_ids` 并同事务落库；③ `pending-approval` 响应附带 `cc_users` |
| `app.js` | ① `submitPO` 改为「选择抄送人（可选）」多选弹窗 + `confirmSubmitApproval`；② `openApprovalDetail` 新增「抄送人 (CC)」展示区块 |
| （无新增/修改迁移脚本；表在启动时幂等创建） |  |

---

## 二、数据结构变化

### 新增表 `business_participants`（通用、不绑定 approval 专属）
```
id              TEXT PK
business_type  TEXT NOT NULL   -- V1='approval'；预留 'ci_prep' / 'payment_reminder'
business_id    TEXT NOT NULL   -- V1 = approval_records.id
participant_type TEXT NOT NULL -- V1 仅写 'cc'；'owner' 列预留但任何代码均不写入
user_id        TEXT NOT NULL   -- 复用系统用户（users.id）
user_name      TEXT            -- 落库时姓名快照
created_at     TEXT            -- datetime('now')
索引: idx_business_participants(business_type, business_id, participant_type)
```
- **未改动** `approval_records` / `approval_flows` 任何字段（遵守"不重新设计审批模型"）。
- Migration 方式：与现有 schema 一致——启动时 `d.exec('CREATE TABLE IF NOT EXISTS ...')` + 启动时建索引，幂等、无 ALTER、无数据迁移。

### 接口变更
- `POST /api/purchase-orders/:id/submit-approval`：新增可选体字段 `cc_user_ids: string[]`（缺省/空数组 = 无抄送，完全向后兼容）。
- `GET /api/purchase-orders/pending-approval`：每行新增 `cc_users: [{user_id,user_name}]`。
- 新增 `GET /api/cc-candidates`（requireLogin）：返回全部 active 系统用户（复用 users 表，不要求 po_approve）。

---

## 三、测试结果（隔离测试 19/19 全绿）

**测试方式**：复制生产库**主文件**（规避 WAL 视图不一致）→ 独立端口 3099 启动子服务（独立 DB 副本）→ break-glass 登录拿 cookie → 仅通过真实 HTTP 接口跑场景 → 跑完删除副本。父进程绝不直连 DB，生产库零污染。

| # | 场景 | 结果 |
|---|---|---|
| A | 提交带 CC → 落 `business_participants` 1 条，pending-approval 携带正确 `cc_users`（含姓名快照） | ✅ |
| B | 提交**无** CC → 成功（向后兼容），`cc_users` 为空数组 | ✅ |
| C | 非法 CC id → 400 拒绝，且无审批实例泄露（原子回滚） | ✅ |
| D | 停用用户作 CC → 400 拒绝 | ✅ |
| E | CC 不影响审批流转（approve 通过）；待我审批过滤仍按审批人（CC 不混入审批人判定） | ✅ |
| F | `cc-candidates` 返回 active 用户、含目标飞书账号、不含停用用户 | ✅ |
| G | 多选 CC → 落 2 条 | ✅ |

**生产库验证**：`business_participants` 在生产库不存在（仅副本创建并已删除）；`sessions`/`purchase_orders` 无 `cc_sess_%`/`po_cctest_%` 残留；`/tmp/cc-test` 已删除。

---

## 四、是否影响已有审批流程

**不影响。** 具体边界：
- 审批状态流转（pending→approved/rejected/withdrawn）：未改动，CC 仅写入独立参与人表。
- 审批人逻辑 / 待我审批（`?mine=1` 按 `approver_user_id` 过滤）：CC 不进入审批人判定。
- 付款审批链 / 采购链 / WAC：未触碰。
- 飞书通知 / 已读回执 / CC 中心 / 消息中心 / 自动 CC 规则：均未实现（仅数据记录）。
- 提交审批默认行为（无 CC）：与原体验一致，无额外阻塞。

---

## 五、关键约束遵守

- ✅ CC 数据结构**不绑定 approval 专属**（通用 `business_participants`，为 CI 运营准备 / 付款提醒预留复用）。
- ✅ 仅实现 `participant_type='cc'`；`owner` 仅预留列，不进代码。
- ✅ CC 为可选项；提交流：提交 → 可选 CC → 确认。
- ✅ 用户来源复用系统用户（`users`），未新建账号体系。
- ✅ 测试 CC 目标 = 管理员飞书账号 `user_1784266196210_yqwf3c`（仅数据记录，不接飞书通知）。

## 六、后续（未在本轮，已冻结）
- CC 与 CI 运营准备（PUR-OPS-COLLAB-01）、付款提醒的复用：待对应子阶段，复用同一 `business_participants` 表（`business_type` 区分）。
- 飞书通知 / 已读 / 抄送中心 / 自动规则：待 FEISHU-NOTIFY 体系统一设计。
