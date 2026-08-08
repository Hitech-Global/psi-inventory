# Release v1.0.16 — Listing 飞书通知卡片化 + 状态变化通知

发布日期: 2026-08-08

## 变更内容

### 1. 飞书 Listing 通知升级为 Interactive Card
- 创建物流单通知、手动提醒、群通知、owner_added 通知统一改为飞书交互卡片。
- 卡片展示字段：物流批次 / 品牌 / 国家 / 仓库 / 总箱数 / 总重量 / 总体积 / 关联 CI / 当前负责人 / 当前状态。
- 保留文本 fallback（飞书部分场景不渲染卡片时仍可收到文字）。

### 2. 国家 / 状态按语言输出（修复英文群 Country 显示中文）
- 服务端新增 `countryLabel(lang, country)`：中文群显示中文国家名，英文群显示英文（如 Indonesia）。
- 服务端新增 `logisticsDisplayStatusLabel(lang, key)`：物流展示状态 5 桶（待出运 / 运输中 / 清关中 / 待派送 / 已到仓）。
- 上架状态沿用既有 `listingStatusLabel`（待提交上架计划 / 准备中 / 已准备完成 / 已上架）。

### 3. 状态变化通知 `notifyListingStatusChanged`
- 触发范围：物流展示状态变化（logistics_status 跨展示桶）或上架状态变化（listing_status）。
- 通知对象：当前上架负责人（owner）+ 上架抄送（CC）+ 对应中文群 + 对应英文群。
- 按业务展示状态比较，避免 `arrived → customs`（同属「清关中」）误触发。
- 卡片额外渲染 **Status Update** 段（Previous Status / Current Status）。
- `logistics_status` 变化补齐 `operation_logs`（`logistics_status_change`）留痕，与 listing_status 口径一致。

### 4. 详情深链
- 卡片 `View Logistics Detail` 按钮指向 `APP_BASE_URL + ?page=logistics&batch=<id>`。
- 前端登录后自动进入物流管理并打开对应物流详情弹窗。

## 兼容性 / 部署配置提醒
以下环境变量**未配置时功能降级但不报错**，不阻断发布：
- `APP_BASE_URL`：未配置 → 卡片不生成按钮（其余字段正常发送）。
- `FEISHU_GROUP_CHAT_IDS`：中文群 chat id，为空 → 跳过中文群。
- `FEISHU_GROUP_CHAT_IDS_EN`：英文群 chat id，为空 → 跳过英文群。

**发布后需在 Render 面板确认以上三项已配置**，否则对应能力（按钮跳转 / 群通知）在生产上不生效。

## 不涉及范围
未修改数据库结构、物流状态流转、Listing 业务逻辑、PAY-CORE、审批流程。
