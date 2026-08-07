# Release Notes — v1.0.9 (Listing 上架状态管理 前端 + owner 多选)

**发布日期**: 2026-08-07
**版本**: v1.0.9
**commit**: (版本提交后回填)
**部署目标**: Render (https://psi-inventory.onrender.com) + Supabase PG

## 变更范围（仅前端 + 版本同步，无业务逻辑改动）

### 本次上线内容
- `624deaa` — Listing 上架负责人 owner 单选改为多选（`listing_owner_ids` 数组 + `business_participants` 多行）
- `2da7f20` — LOGISTICS-LISTING-01 前端恢复：
  - 物流列表新增「Listing 状态」「上架负责人」两列
  - 列表内联四态切换（pending_plan / preparing / ready / listed），写入 operation_log 并持久
  - 创建 / 编辑物流单：上架负责人改为多选且 ≥1 校验；CC 与负责人独立
  - 多负责人显示「张三 +N」截断

> 注：`5edb1ca`（Listing 后端）已于 v1.0.8 随 origin/main 一同上线，本次不再重复推送。

## 部署步骤
1. 版本号同步：package.json + server.js APP_VERSION → 1.0.9
2. 提交版本变更（独立 chore(release) commit）
3. `git push origin main`（推送 624deaa / 2da7f20 / 版本提交）
4. Render 自动部署（node server.js → initDatabase 执行迁移：logistics_batches 加 listing 列 + business_participants 写入）
5. 核对 /api/version → 1.0.9 + 新 commit
6. 重建 annotated tag v1.0.9 并推送

## 验证清单
- [x] 隔离环境浏览器验收 5 项全 PASS（2026-08-07，Task #5）
- [ ] 生产 /api/version = 1.0.9
- [ ] 生产 Listing 迁移已执行（server 启动无报错）
- [ ] 生产物流列表状态列 + 多负责人显示
- [ ] 生产内联状态修改持久
- [ ] 生产创建物流单负责人多选 + ≥1 校验
- [ ] 生产飞书通知链路（owner 多选后正确通知）
