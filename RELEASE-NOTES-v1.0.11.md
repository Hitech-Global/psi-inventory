# Release Notes — v1.0.11

**发布日期**：2026-08-07
**类型**：P0 热修（仅迁移补齐，无业务逻辑改动）
**Commit**：（见发布提交）

## 问题
生产环境编辑物流单保存时报：
```
column "listing_owner_ids" of relation "logistics_batches" does not exist
```

## 根因
LOGISTICS-LISTING-01 的迁移只写在 `db-pg.js` 的 `initDatabase`，而生产 PG 实际走 `db.js`
（worker_threads 同步包装）。`db.js` 的 `initDatabase` 是硬编码迁移列表，**从不调用**
`db-pg.js` 的 `initDatabase`（在 worker_threads 模式下为死代码）。导致 `logistics_batches`
缺失整组 Listing 列，编辑路由的 `UPDATE ... SET listing_owner_ids` 直接 500；列表因走 `lb.*`
且对缺失列容错而侥幸显示，掩盖了问题。

## 修复
在 `db.js` 生产实际执行的迁移入口补入 5 条幂等迁移（`ADD COLUMN IF NOT EXISTS`，不影响历史数据）：
- `listing_status` TEXT NOT NULL DEFAULT 'pending_plan'
- `listing_owner_ids` TEXT NOT NULL DEFAULT ''
- `listing_status_updated_at` TEXT NOT NULL DEFAULT ''
- `listing_remind_date` TEXT NOT NULL DEFAULT ''
- `listing_eta_remind_date` TEXT NOT NULL DEFAULT ''

## 不变更项
- server.js / app.js 业务逻辑不变
- PAY-CORE 不变
- 飞书通知逻辑不变
- 未包含 app.js 未提交的审批 UI 改动
- 未做 migration 架构重构（仅补齐漏同步的迁移）

## 验证
- 隔离环境模拟生产"列缺失"态：5 条迁移补齐全部列，原报错 UPDATE 持久化多负责人成功；幂等重跑稳定。
- 完整服务器端到端：登录 → 建 2 个 active 用户 → 建物流单 → PATCH /listing 多负责人 → 返回成功。
- 生产部署后：`/api/version` = 1.0.11；编辑物流单选择多个上架负责人保存成功；`listing_owner_ids` 正常写入。
