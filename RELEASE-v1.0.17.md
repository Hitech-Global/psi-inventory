# Release v1.0.17 — Listing 飞书卡片 200621 故障降级为文本

发布日期: 2026-08-09

## 背景

v1.0.16 上线后，Listing 飞书卡片通知于 2026-08-09 上午全面失败：

- 错误码：`extErrCode 200621 / Failed to create card content, parse card json err`
- 代码未变更（`git diff v1.0.16 HEAD -- server.js` 为空）
- 本地 6 场景 dryrun 全部通过飞书卡片 2.0 schema 校验 + 双向 JSON 序列化
- 推断原因：飞书 OpenAPI 侧对卡片 schema 隐式校验收紧，text 链路不受影响（同 GitHub Issue #53310 OpenClaw 现象一致）

为尽快恢复运营可达性，v1.0.17 在不动卡片结构前提下加入自动 fallback：飞书返回 `200621 / parse card json err` 时，把卡片反推成纯文本后改走 `msg_type=text` 同 receive_id 重发。

## 变更内容

### 1. 卡片降级为文本的 fallback 分支（`server.js`）

- 新增私有函数 `cardToFallbackText(card)`：从 `header.title` 与 `elements[].fields`（`tag=div`）反推 `Label: Value` 文本，自动跳过 `tag=action`（按钮）段，避免把 URL 噪声写进纯文本。
- `sendFeishuRaw` 增加判断：
  - `msgType === 'interactive'` 且 `data.code !== 0` 且 `data.msg` 含 `200621` 或 `parse card json` → 走 fallback
  - 通过同一 `fetch` + 同一 `receive_id` + `msg_type=text` 重发
  - 成功 → 返回并 `console.warn('[FEISHU-NOTIFY] 卡片降级为文本发送成功 (200621 fallback)')`
  - 失败 → 抛原卡片错误 + 注释 `(card fallback attempted)`，不吞错
- 非 200621 错误（如 230002 权限）保持原行为（不重试、不吞错）。
- `text` 模式下任何错误都保持原行为（设计：仅对卡片做 fallback）。

### 2. 行为特性

- **可逆**：飞书侧恢复后，interative 链路自然走通，fallback 自动失效，不需要回滚代码。
- **透明**：Render 日志新增 `[FEISHU-NOTIFY] 卡片降级为文本发送成功 (200621 fallback)` 行，便于观察降级频次和恢复节奏。
- **字段一致**：降级文本字段顺序与卡片一致（批次 → 品牌 → 国家 → 仓库 → 货物 → CI → 负责人 → 状态 [+ 状态更新段]），不会出现"卡片能看 a/b/c，文本版只能看 a"的认知差。
- **不影响 button 段**：卡片里的"查看物流详情"按钮不会以 URL 噪声形式出现在文本里，等卡恢复即恢复按钮能力。

## 兼容性 / 部署配置

- 无新增环境变量；fallback 是纯服务端代码分支。
- 无数据库变更。

## 不涉及范围

未修改：飞书应用配置（APP_ID/SECRET）、群 chat id（FEISHU_GROUP_CHAT_IDS/EN）、个人 open_id 收件规则、`business_participants` 数据源、`loadListingNotifyCtx` SQL、`buildListingNotifyCard` 卡片结构、其它通知链路（PO/Pay/CI/Stalled/ETA 等仍走原路径）。

## 验证

- `node --check server.js`：通过
- 本地 dryrun（`_dryrun_card.cjs`，保留作 regression）：
  - 5 卡片场景 PASS（zh/en × manual / +statusChange / 边界 listing_status=未知）
  - 5 fallback 行为 PASS（200621 降级成功 / 非 200621 不降级 / 双失败抛原错 / text 模式不降级 / 正常卡片不降级）
- 生产侧验证（部署后）：在 Render 日志观察 `[FEISHU-NOTIFY] 卡片降级为文本发送成功 (200621 fallback)`；运营手动补发一次提醒确认收到文本版通知。
