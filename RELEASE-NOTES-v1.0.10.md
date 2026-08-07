# 发布说明 — v1.0.10

**日期**: 2026-08-07
**类型**: 热修发布（修复 v1.0.9 生产回归）
**包含提交**: `ac86622`(修复) + 本版本号提交

## 修复内容

### LOGISTICS-LISTING-01 物流列表 500 回归（v1.0.9 引入）

**根因**:
- v1.0.9 的 `624deaa` 把列表 SELECT 由 `lb.* ... LEFT JOIN users lu ON lu.id=lb.listing_owner_id`
  改为 `lb.*, ... lb.listing_owner_ids`，使 `listing_owner_ids` 列被重复 SELECT。
  SQLite 容忍重复列，PostgreSQL 报 `column listing_owner_ids specified more than once` → 500(HTML) → 前端"非 JSON 响应"。
- 列表逐行 `resolveOwnerNames` 对每单×每人各发一条 users 查询（N+1），PG 下反复建连。

**修复**（`ac86622`）:
- 列表 SELECT 移除重复的 `lb.listing_owner_ids`（`lb.*` 已含该列），回归为 v1.0.8 合法 SQL。
- 新增 `resolveOwnerNameMap`：收集当前页全部 owner id，单次 `SELECT id,name FROM users WHERE id IN (...)` 建 id→name 映射；
  `namesFromMap` 按映射回填；`resolveOwnerNames` 复用批量映射。
- 列表端点取行后一次性建映射，逐行仅做 map 查找，消除 N+1。

## 验证（隔离 sqlite 测试服务器）
- 列表/详情/GET /:id/listing 三处 `listing_owner_names` 均返回真实姓名（非 id）。
- 2/3 负责人场景正确；空 owner 行返回 `[]` 且不 500；全程无 500。

## 未改动（保持冻结）
- `listing_owner_ids` 字段不变
- `business_participants` 不变
- 飞书通知逻辑不变
- reminder scan 不变
- 不回滚 v1.0.9 业务逻辑

## 部署后核对项
- [ ] /api/version = 1.0.10
- [ ] commit 对应正确
- [ ] 物流管理页面正常加载
- [ ] listing_owner_names 返回真实姓名
- [ ] 多负责人展示正常
- [ ] 无 500 / 非 JSON 错误
