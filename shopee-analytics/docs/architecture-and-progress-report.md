# Shopee Analytics V1 — 架构与开发进度报告

> 复核时间：2026-10-31
> 代码基线：`feat/shopee-analytics-v1-foundation` @ `dc5bdda`（本地，领先远程 `0589bec` 10 个提交）
> 范围：`shopee-analytics/` 模块 + `skills/shopee-gmv-max/`

---

## 一、当前系统架构

### 1.1 隔离边界（已实测验证）

| 方向 | 结论 |
|---|---|
| `shopee-analytics/` → PSI 服务端 | **无任何** `require('../../server\|lib\|src/')`，完全独立 |
| PSI `server.js` → `shopee-analytics/` | **无引用**，PSI 运行时未被侵入 |

这与 README 的定位一致：*"Isolated, read-only foundation…intentionally kept outside the existing
inventory runtime so current production modules remain untouched until an explicit integration gate."*

模块是**旁挂**的：独立 PostgreSQL 库、独立凭据体系、独立部署栈，通过 `shopee-analytics/` 目录
与 `skills/` 目录与 PSI 划清界限。

### 1.2 四层结构

```
┌─────────────────────────────────────────────────────────────┐
│  接入层  src/shopee-client.js  src/sync-*.js  src/shop-sync-runner.js │
│          25 个端点 · 4 个 App 角色 · HMAC-SHA256 签名 · 分页游标   │
└──────────────────────────┬──────────────────────────────────┘
                           ↓ 原始快照 → 归一化事实
┌─────────────────────────────────────────────────────────────┐
│  数据层  schema.sql（39 张 shopee_* 表）· src/*-repository.js      │
│          raw snapshots · 历史表 · 事件日历 · sync_state 断点续传    │
└──────────────────────────┬──────────────────────────────────┘
                           ↓ 确定性计算 + 版本化输入
┌─────────────────────────────────────────────────────────────┐
│  分析层  src/analysis-package.js → src/skill-*.js → shopee_skill_reports │
│          平台无关归一化 · Skill 版本绑定 · FACT/INFERENCE 分离        │
└──────────────────────────┬──────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│  呈现层  web/（原生 JS，零构建）· src/http-router.js（30 端点）        │
│          Country → Brand → Shop → Campaign → SKU 五级下钻             │
└─────────────────────────────────────────────────────────────┘
```

### 1.3 数据模型（39 张表，按域）

| 域 | 表数 | 代表表 |
|---|---|---|
| 广告 | 8 | `shopee_ad_campaign_daily` / `_hourly` / `_membership_daily` / `_setting_history` / `shopee_ad_item_daily` / `shopee_ad_promotion_daily` / `_item_daily` / `shopee_ad_campaigns` |
| 店铺 | 6 | `shopee_shops` / `_profiles` / `shopee_shop_bi_daily` / `shopee_sync_state` / `shopee_event_calendar` / `shopee_operation_history` |
| 商品 | 3 | `shopee_products` / `_models` / `shopee_item_strategy_config` |
| 订单/退货 | 5 | `shopee_orders` / `_items` / `shopee_returns` / `_items` / `shopee_order_items` |
| 认证 | 4 | `shopee_users` / `_user_shops` / `_auth_sessions` / `_auth_login_states` |
| 优惠 | 5 | `shopee_vouchers` / `_items` / `shopee_discounts` / `_items` / `shopee_voucher_items` |
| 诊断/Skill | 4 | `shopee_diagnosis_results` / `shopee_skill_reports` / `shopee_analysis_cycles` / `shopee_recommended_roi_history` |
| 其它 | 4 | `shopee_raw_api_snapshots` / `shopee_oauth_states` / `shopee_app_tokens` / `shopee_product_card_*` |

### 1.4 Shopee API 同步机制

**端点目录** `src/catalog.js`：25 个端点，4 个 App 角色各自独立凭据。

| 角色 | 覆盖 | 凭据来源 |
|---|---|---|
| `ADS` | 广告活动/设置、GMS 活动与商品表现、日/小时表现、推荐 ROI、已删除 GMS 商品 | `SHOPEE_ADS_PARTNER_ID/KEY` |
| `STORE_OPS` | 优惠券、折扣 | `SHOPEE_STORE_OPS_PARTNER_ID/KEY` |
| `ERP` | 退货/退款、BusinessInsights 热门商品 | `SHOPEE_ERP_PARTNER_ID/KEY` |
| `BRAND_PORTAL` | 店铺销售表现 | `SHOPEE_BRAND_PORTAL_PARTNER_ID/KEY` |

**同步编排** `src/shop-sync-runner.js` 的 `run()` 序列（每步记录 `{name, ok, required, ms}`）：

```
shop-info → campaign-settings → ads-token → gms-discovery
→ gms-{campaignId}(逐活动窗口) → product-ads-overview-7d → product-ads-7d
→ orders-recent → products → promotions(optional) → returns(optional)
→ shop-bi-yesterday → …
```

失败按 `required` 分流为 `failedRequiredSteps` / `failedOptionalSteps` —— 正是 pilot gate
第一道门禁的输入源。

**节流策略**：每个端点在 `SYNC_POLICY` 里有独立的 `minutes` 刷新周期，广告类 60 分钟、
订单 15 分钟、推荐 ROI 与店铺信息 1440 分钟。

**凭据与续期**：`token-manager.js` 过期前 300 秒自动刷新，带 in-flight 去重；
`token-crypto.js` 用 AES-256-GCM 加密落库，master key 32 字节。

**断点续传**：`shopee_sync_state` 按 `(app_role, endpoint_key, shop_id)` 记录游标，
`backfill-runner.js` 可恢复。

### 1.5 广告诊断逻辑

**诊断顺序**（README「V1 decision flow」+ `src/diagnosis.js`）：

1. 广告组订单量（Direct 优先，Broad 作贡献背景）
2. 实际 ROAS vs 目标 ROAS vs 盈亏平衡 ROAS
3. 漏斗：曝光 → 点击 → CTR → 转化 → 订单
4. 商品赛马：花费份额、直接 GMV 份额、直接订单份额、Broad vs Direct
5. 证据分级：核心候选 / 探索保留 / 探索不足 / 商品优化 / 高风险零订单
6. 事件日（Double-Day、25 号）独立于日常基线
7. 广告组验证通过后，商品才具备单品广告候选资格

**职责分层**（`docs/skill-architecture.md`）：平台负责采集/归一化/确定性计算/构建 Analysis Package；
**业务推理归属版本化 Skill**。`skills/shopee-gmv-max/SKILL.md` v0.2.0 定义了 10 条不可违背原则、
证据可用性闸门、以及 FACT / INFERENCE / HYPOTHESIS 三段分离。

**确定性 vs 推理分离**：`metrics.js` / `maturity-engine.js` / `action-engine.js` 出确定性结论；
Skill 出可解释判断，且每份报告持久化 skill 名+版本、输入快照引用、触发类型（DAILY_AUTO/MANUAL/EVENT_REVIEW）。

**多店多国**：Country → Brand → Shop → Campaign → SKU 五级；
货币**永不跨币种相加**（GMV/花费/ROAS 按币种分组，订单与销量可合并）；
每店独立时区（Shop BI 用店铺注册时区，订单用 UTC）。

### 1.6 部署方式

**桌面生产栈** `deploy/desktop/`（docker-compose，8 个服务）：

| 服务 | 作用 | 端口 |
|---|---|---|
| `postgres` | PG16 主库（卷 `shopee_pgdata`） | 无 host 端口 |
| `ollama` | 本地模型 | 无 |
| `app` | 只读 UI/API | `127.0.0.1:3090` |
| `oauth` | OAuth 回调服务 | `127.0.0.1:3091` |
| `worker` | 定时同步（每小时 :10，每日 02:30 UTC） | 无 |
| `ad-group-import-worker` | 广告组异步导入 | 无 |
| `schema` / `preflight` | 一次性 schema 应用 / 部署前检查 | 无 |

NAS 只做备份目标（`pg_dump` → `pg_restore --list` 校验 → 拷贝 → 更新 `backup-status.json`），
**PG 数据文件绝不从 NAS 运行**。保留策略：本地 30 天 / NAS 日 30 天 / 周 90 天 / 月 730 天。
Windows 计划任务 03:30 备份、周 04:30 还原验证。

---

## 二、已实现的功能

| 模块 | 状态 | 关键文件 |
|---|---|---|
| Shopee API 客户端（签名/多角色/分页） | ✅ 完整 | `shopee-client.js` / `catalog.js` / `client-factory.js` |
| 限流退避 | ✅ **本轮新增** | `rate-limit-retry.js` |
| 多店同步编排 + 断点续传 | ✅ 完整 | `shop-sync-runner.js` / `backfill-runner.js` |
| 历史回填 | ✅ **本轮强制门禁** | `backfill-all-shops.cjs` + `pilot-gate-store.js` |
| 商品/订单/退货/优惠/店铺 BI 同步 | ✅ 完整 | `sync-*.js` 系列 |
| 7 天诊断引擎 + 成熟度 + 动作引擎 | ✅ 完整 | `diagnosis.js` / `maturity-engine.js` / `action-engine.js` |
| Analysis Package（平台无关归一化） | ✅ 完整 | `analysis-package.js` / `source-aware-metrics.js` |
| Skill 运行时（QWEN/Ollama/OpenAI） | ✅ 完整 | `skill-*.js` + `qwen-skill-provider.js` |
| 报告持久化 + 版本绑定 | ✅ 完整 | `skill-report-repository.js` |
| 飞书登录 + 双角色（SUPER_ADMIN/OPERATOR） | ✅ 完整 | `feishu-auth.js` / `reviewer-auth.js` |
| ERP / Brand Portal OAuth（生产） | ✅ 完整 | `erp-oauth-service.js` / `brand-portal-oauth-service.js` |
| 只读 UI（5 级下钻 / 组合页 / 诊断 / SKU 赛马） | ✅ 完整 | `web/` 17 个文件 |
| Product Card 导入桥 + drop-folder 自动化 | ✅ 完整 | `product-card-normalizer.js` / `product-card-inbox.js` |
| 桌面部署栈 + 预检 + 备份/还原验证 | ✅ 完整 | `deploy/desktop/` |
| **pilot gate 强制执行** | ✅ **本轮新增** | `pilot-gate-store.js` / `pilot-acceptance.cjs` |
| CI 覆盖分支直推 | ✅ **本轮新增** | `.github/workflows/shopee-analytics-ci.yml` |
| TikTok Shop 对接 | 📄 **仅评估文档** | `docs/tiktok-shop-integration-assessment.md` |

---

## 三、当前开发进度

### 3.1 本地领先远程 10 个提交（2191 insertions / 67 deletions / 23 files）

| 提交 | 类型 | 内容 |
|---|---|---|
| `ef0184b` | fix | Product Card 标签契约（**解除 PR #5 的 CI 红灯**） |
| `dd654ed` | ci | 分支直推触发 + 契约测试 |
| `5c7bc0e` | feat | Shopee API 限流退避 |
| `cf79719` | feat | pilot gate 接入 backfill 强制路径 |
| `cb5b843` | docs | TikTok Shop 接入评估 |
| `ba19811` | chore | PAT 推送工具链 |
| `52f8d5b` | fix | macOS bash 3.2 兼容（PAT 存储脚本） |
| `ef332ee` | fix | 从 /dev/tty 读取（PAT 粘贴） |
| `f40d5ee` | chore | PAT 权限诊断脚本 |
| `dc5bdda` | fix | push 失败时用 API 定位成因 |

### 3.2 两个真实缺陷已修（本轮之前发现）

1. **PR #5 的 CI 是红的**：`0589bec` 引入旧式 `Broad ROAS` 标签违反契约，且该提交直推分支
   绕过了 CI（check-runs = 0），直到下次 PR 运行才暴露。已复现验证因果并修复。
2. **限流无退避**：`shopee-client.js` 早已标记 `err.kind='RATE_LIMIT'` 并解析 `Retry-After`，
   但**无任何消费方**，全模块无 retry/backoff/429 处理 —— 与项目全局规则第 2 条直接冲突。

### 3.3 一个承诺与实现脱节（已修）

`evaluatePilotGate` 实现了四道门禁却**无生产消费方**，而三处文档都在承诺它生效
（desktop README、`install-desktop.ps1` 提示、PR body）。backfill 实际只校验 deployment mode
+ 一个环境变量。现已改为 fail-closed 强制门禁，并加了契约测试锁定接线。

### 3.4 测试

**254 语法检查 + 107 测试文件，全部通过。** 纯逻辑测试无需 DB；
`postgres.integration.cjs` 需 `SHOPEE_ANALYTICS_TEST_DATABASE_URL`，否则自动 skip。

---

## 四、尚未完成的功能

| # | 项 | 阻塞原因 |
|---|---|---|
| 1 | **推送 10 个提交 + PR #5 转 ready** | GitHub 写权限（见下） |
| 2 | 真实店铺试点验收 | 需真实 Shopee 凭证 + Seller Centre 人工对账（工具链已就绪） |
| 3 | Product Card 官方 item 级 BI API | 官方未提供，当前只能 Excel 导入 |
| 4 | TikTok Shop 对接 | 4 项决策未定 |
| 5 | PSI 与 Analytics 的集成闸门 | 设计上刻意保留，需显式决策才打通 |

### 4.1 写权限的根因（已精确定位）

**GitHub 连接器的 OAuth 授权只授了读 scope**。证据链：

- MCP protected-resource 元数据：`authorization_servers: ["https://github.com/login/oauth"]`，
  `scopes_supported: ["repo", ...]` → **`repo` scope 明确受支持**，缺的是勾选
- 有效令牌下 `GET /user/repos` → `permissions.push: true`，GraphQL → `viewerPermission: WRITE`，
  但 `POST /git/refs`、`PUT /contents`、`POST /pulls` 全 403
  → **账号有权限，令牌 scope 不含写能力**

**用户上次建的 PAT 失败原因已查明**：`Hitech-Global` 是**个人账号**（`orgs/Hitech-Global` →
Not Found，`users/Hitech-Global` → User），PR #5 作者是 `Hitech-Global <hitechjames@163.com>`；
而令牌 Resource owner 选了 `martin0000118-dev`（另一主体），且 Repository access 选了
**Public repositories（read-only）**。

**正确做法**：Resource owner 选 `Hitech-Global` + Repository access 选 `All repositories`
+ Repository permissions 勾 Contents/Workflows/Pull requests 三项 Read and write。

---

## 五、本地运行与测试方法

### 5.1 纯逻辑测试（无需数据库）

```bash
cd /Users/wwt46/WorkBuddy/2026-10-30-14-22-28
node shopee-analytics/test/run-all.cjs          # 完整套件：254 语法 + 107 测试文件
node shopee-analytics/test/diagnosis.test.cjs   # 单个测试文件
```

### 5.2 PostgreSQL 集成测试

```bash
SHOPEE_ANALYTICS_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/shopee_test \
  node shopee-analytics/test/postgres.integration.cjs
```

### 5.3 只读 UI（本地）

```bash
# 需要专用 PG；绝不回退复用 PSI 的 DATABASE_URL
export SHOPEE_ANALYTICS_DATABASE_URL=postgresql://...
export SHOPEE_TOKEN_MASTER_KEY=$(openssl rand -base64 32)
node shopee-analytics/src/standalone-server.js
# → http://127.0.0.1:3090
```

### 5.4 桌面部署

```bash
cd shopee-analytics/deploy/desktop
./prepare-desktop.ps1     # 生成 runtime/ 目录、DB 口令、token master key
# 填 runtime/.env：Shopee Partner 凭证、NAS 备份路径
./install-desktop.ps1     # 起 PG → 应用 schema → 预检 → 起 app/worker
./install-backup-tasks.ps1  # 计划任务：每日 03:30 备份、周日 04:30 还原验证
```

### 5.5 同步与回填

```bash
# 只读同步
SHOPEE_ANALYTICS_ENABLE_SYNC_ALL_SHOPS=YES node shopee-analytics/scripts/sync-all-shops.cjs hourly
SHOPEE_ANALYTICS_ENABLE_SYNC_ALL_SHOPS=YES node shopee-analytics/scripts/sync-all-shops.cjs daily

# 试点验收（四道门禁）
node shopee-analytics/scripts/validation-report.cjs
node shopee-analytics/scripts/reconcile-seller-centre.cjs
node shopee-analytics/scripts/pilot-acceptance.cjs     # 落盘门禁产物

# 历史回填（受门禁强制）
SHOPEE_ANALYTICS_ENABLE_BACKFILL=YES \
SHOPEE_BACKFILL_START_DATE=2026-05-01 SHOPEE_BACKFILL_END_DATE=2026-09-17 \
node shopee-analytics/scripts/backfill-all-shops.cjs
```

---

## 六、目前可以接手开发的任务

### 高优先级（阻塞其它一切）

| # | 任务 | 说明 |
|---|---|---|
| 1 | **用正确配置的 PAT 推送 10 个提交** | Resource owner = `Hitech-Global`，All repositories，三项权限 RW |
| 2 | **PR #5 转 ready + 合并** | 推送后 CI 转绿即可；需确认 629 commits 的合并策略 |
| 3 | **完成真实店铺试点验收** | 工具链齐备，缺真实凭证与 Seller Centre 人工对账 |

### 中优先级（质量与可运维性）

| # | 任务 | 说明 |
|---|---|---|
| 4 | **CI 增加 PR 合并前的必过检查** | 当前 `mergeable_state: unstable`，建议把 pilot gate 状态检查纳入 |
| 5 | **`.pgtest/` 加入 .gitignore** | 600MB PSI 侧嵌入式 PG 产物，当前分支未覆盖，有误提交风险 |
| 6 | **补 `shopee-analytics` 与 PSI 的集成闸门文档** | 设计上刻意保留，需显式决策 |
| 7 | **Product Card 官方 BI API 持续跟踪** | 官方一旦提供 item 级端点即切换，解除 Excel 依赖 |

### 需要决策后才能启动

| # | 任务 | 待决策 |
|---|---|---|
| 8 | **TikTok Shop M0 平台底座** | 目标区域：仅 ROW 还是 US+ROW 双 app（决定凭据模型） |
| 9 | **TikTok Shop M1 只读经营分析** | 是否接受第一期不覆盖付费广告（缺口用结算流水自建净 ROAS 补） |
| 10 | **TikTok Shop 适配映射表** | 是否需要逐文件级改写映射 |
| 11 | **GMV 口径对齐表** | 跨平台对比分析正确性的前提（TikTok 三个 GMV 口径不同） |
| 12 | **诊断引擎平台无关化** | `metrics.js` 的 direct/broad 语义在 TikTok 不可复用，需先定义中间模型 |

---

## 七、关键风险提示

1. **PR #5 体量巨大**：629 commits / 281 files / +38985。合并前建议确认 squash 策略与评审方式。
2. **令牌在截图与对话记录中明文暴露**，必须在 GitHub 侧 revoke。
3. **`.pgtest/` 未被忽略**，每轮提交都需显式 `git add <file>`，避免 `git add -A`。
4. **GMV Max 归因口径**：Shopee Direct/Broad 语义在 TikTok 不可直接复用，
   照搬会得出错误结论。
5. **Product Card 数据窗口**：联盟订单单次最多 3 个月；Analytics 日期参数用店铺注册时区
   而订单用 UTC，join 时必须归一。
