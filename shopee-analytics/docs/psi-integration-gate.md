# Shopee Analytics ↔ PSI 集成闸门

> 复核时间：2026-11-01
> 范围：`shopee-analytics/` 模块与 PSI 进销存系统之间的边界
> 状态：**闸门处于关闭状态** —— 这是设计意图，不是缺陷

---

## 一、为什么需要这份文档

README 写明模块 *"intentionally kept outside the existing inventory runtime so current
production modules remain untouched until an explicit integration gate"*。

也就是说：**打通 PSI 与 Analytics 是一个需要显式决策的动作**，不是顺手就能做的事。
这份文档说明当前边界在哪、闸门打开需要满足什么、以及打开后会发生什么。

它同时回答一个常见误解：**Analytics 的代码在同一个仓库里，不代表它跑在 PSI 上。**

---

## 二、当前隔离状态（2026-11-01 实测）

### 2.1 代码引用：双向零引用

| 方向 | 检查方式 | 结果 |
|---|---|---|
| `shopee-analytics/` → PSI | `grep -rE "require\(['\"](\.\./)+(server\|lib\|src/)" shopee-analytics/` | **零命中** |
| PSI → `shopee-analytics/` | `grep -nE "require\(.*shopee-analytics" server.js` | **零命中** |

PSI 的 `server.js`（21684 行）完全没有引用 analytics 的任何模块。analytics 的
`standalone-server.js` 是**独立进程**，不挂在 PSI 的 Express 应用里。

### 2.2 数据库：独立库、独立连接变量

| 系统 | 连接变量 | 存储 |
|---|---|---|
| PSI | `process.env.DATABASE_URL` | SQLite（`data/inventory.db`），可迁 PG |
| Analytics | `SHOPEE_ANALYTICS_DATABASE_URL` / `SHOPEE_ANALYTICS_PG*` | **专用 PostgreSQL** |

analytics 的桌面栈自带 postgres 服务（`deploy/desktop/docker-compose.yml`），
`POSTGRES_DB` 是该栈自己的库，与 PSI 无交集。

> ⚠️ **红线**：analytics **绝不回退复用** PSI 的 `DATABASE_URL`。
> 这是两份完全不同的数据模型（39 张 `shopee_*` 表 vs PSI 的进销存表），
> 共库会导致误删与污染。

### 2.3 凭据：完全分离

| 系统 | 凭据变量 |
|---|---|
| PSI | `FEISHU_*`、`BREAKGLASS_ADMIN_PASSWORD` 等 |
| Analytics | `SHOPEE_ADS_PARTNER_ID/KEY`、`SHOPEE_STORE_OPS_*`、`SHOPEE_ERP_*`、`SHOPEE_BRAND_PORTAL_*`、`SHOPEE_TOKEN_MASTER_KEY` |

analytics 的 Partner Key 与 token 只存在于它自己的 `runtime/.env` 与加密 token 库
（`shopee_app_tokens`），从不出现在 PSI 的运行时环境里。

### 2.4 部署：独立栈

```
桌面 NVMe/SSD
├── Docker + PostgreSQL（analytics 专用）
│   ├── app    → 127.0.0.1:3090（只读 UI/API）
│   └── worker → 定时同步
└── NAS → 仅备份目标

PSI → 保留在自有基础设施，本栈不触碰
```

---

## 三、四道 Pilot 门禁（analytics 内部的放行条件）

模块自身已有更细的放行逻辑，从"同步"到"回填"逐级放开：

| 门禁 | 脚本 | 通过条件 |
|---|---|---|
| 1. 环境校验 | `scripts/validate-desktop-env.cjs` | 凭据齐备、DB 可连、master key 合法 |
| 2. 部署预检 | `scripts/deployment-preflight.cjs` | schema 已应用、店铺配置就绪、token 可解密 |
| 3. 真实店铺对账 | `scripts/reconcile-seller-centre.cjs` | 真实店铺数据与 Seller Centre 人工核对一致 |
| 4. 试点验收 | `scripts/pilot-acceptance.cjs` | 落盘验收产物，回填被此门禁强制 |

```bash
# 同步（只读）
SHOPEE_ANALYTICS_ENABLE_SYNC_ALL_SHOPS=YES node shopee-analytics/scripts/sync-all-shops.cjs hourly

# 历史回填（受门禁强制，未通过则拒绝执行）
SHOPEE_ANALYTICS_ENABLE_BACKFILL=YES \
SHOPEE_BACKFILL_START_DATE=2026-05-01 SHOPEE_BACKFILL_END_DATE=2026-09-17 \
node shopee-analytics/scripts/backfill-all-shops.cjs
```

**回填被门禁强制**这一点是刻意的：历史数据一旦写进 `shopee_*` 表就难以回退，
所以必须先证明实时同步的数据是对的。

---

## 四、闸门打开的条件（需要显式决策）

以下每一项都需要业务与技术共同确认，**不是技术问题**：

### 4.1 需要决定的事

| # | 决策点 | 选项 | 影响 |
|---|---|---|---|
| 1 | **PSI 侧是否引用 analytics** | 完全独立 / PSI 内嵌只读视图 | 决定 PSI 的 `server.js` 是否要改 |
| 2 | **数据流方向** | 只读（PSI 看 analytics）/ 双向 / 不集成 | 双向需要处理一致性与冲突 |
| 3 | **用户体系是否统一** | analytics 独立飞书账号 / 复用 PSI 账号 | 决定是否要建账号映射表 |
| 4 | **店铺归属关系** | analytics 的店铺表在 PSI 里建档 / 各自维护 | 决定主数据归属 |
| 5 | **订单数据是否共享** | 各自同步 / analytics 读 PSI 的订单 | 影响 `shopee_orders` 的唯一性约束 |

### 4.2 决策后的技术动作（示例：方案 1 —— PSI 内嵌只读视图）

```
PSI server.js
  └── require('./shopee-analytics/src/http-router')  ← 唯一改动点
      └── 只读挂载，不改 PSI 的数据库与表结构
```

要点：
- **只引入只读路由**，不把 analytics 的 repository 写进 PSI 的事务
- PSI 的 `DATABASE_URL` 保持不变；analytics 仍用 `SHOPEE_ANALYTICS_DATABASE_URL`
- 若 PSI 进程要访问 analytics 的 PG，需要把 analytics 的 PG 凭据加进 PSI 的
  环境变量（**注意**：这是把两份系统的信任边界打通，必须显式决策）

### 4.3 打开闸门时**不能**做的事

- ❌ 让 analytics 回退使用 PSI 的 `DATABASE_URL`
- ❌ 把 Shopee Partner Key 写进 PSI 的环境变量
- ❌ 在 PSI 的表里加 `shopee_*` 的影子表（双写 = 两份真相）
- ❌ 跳过 pilot 门禁直接跑历史回填

---

## 五、当前建议

**保持闸门关闭。**

理由：
1. analytics 的四个视图（经营总览 / 店铺诊断 / 广告诊断 / 数据状态）已自成体系，
   用户在 `analytics.hitechanalysis.top` 能完成全部日常操作，暂不需要 PSI 侧嵌入
2. 真实店铺试点验收（门禁 3）尚未通过 —— 在数据正确性未证明前打通集成，
   会把一个未验证的数据源接进 PSI 的核心流程
3. 集成需要 5 个业务决策，当前没有明确需求驱动

**推荐的推进顺序**：
```
① 完成真实店铺试点验收（门禁 3、4）  ← 需要真实 Shopee 凭证
② 积累一段真实使用反馈，确认是否真需要 PSI 侧嵌入
③ 若需要，走上面的 4.1 五个决策，逐条确认
④ 再动代码
```

---

## 六、实测方法（随时可复核）

```bash
cd /path/to/repo

# ① 代码双向零引用
grep -rE "require\(['\"](\.\./)+(server|lib)" shopee-analytics/ | grep -v docs/
grep -nE "require\(.*shopee-analytics" server.js

# ② 数据库变量分离
grep -rhoE "SHOPEE_ANALYTICS_(DATABASE_URL|PG[A-Z]+)" shopee-analytics/src/*.js | sort -u
grep -n "process.env.DATABASE_URL" server.js

# ③ 凭据分离
grep -cE "SHOPEE_(ADS|STORE_OPS|ERP|BRAND_PORTAL)_PARTNER" shopee-analytics/.env.example

# ④ 栈独立
grep -n "PSI stays on its existing infrastructure" shopee-analytics/deploy/desktop/README.md
```
