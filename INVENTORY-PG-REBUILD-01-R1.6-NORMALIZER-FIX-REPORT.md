# INVENTORY-PG-REBUILD-01 R1.6 Normalize Fix — PostgreSQL E2E 报告

- 日期：2026-07-18T14:28:04.965Z
- 目标：重建 R1.5 E2E（34 项），验证 db-pg.js 两处 normalizeSql 修复（strftime TEXT 兼容、date 负偏移）。
- 纪律：独立 embedded-postgres 测试库（**未连正式 Supabase**）；仅改 db-pg.js；不改 server.js/app.js/业务规则/schema/部署配置；不进 R2、不部署。

## 一、环境

- PostgreSQL：PostgreSQL 18.4（embedded-postgres，localhost:5433，库 inventory_e2e）
- 表数量（public）：58
- DB_DRIVER=pg；DATABASE_URL 指向本地独立实例

## 二、总体结果

**34 通过 / 0 失败（共 34 项）**

> ✅ 目标达成：34/34。两处修复在真实 PostgreSQL 上回归通过。

## 三、分项明细

### S1

| 用例 | 结果 | 说明 |
|---|---|---|
| connect | PASS | SELECT 1 -> ok=1 |
| insert | PASS | inserted s1 v=1 |
| update | PASS | updated s1 v=2 |
| transaction rollback | PASS | rolled back, row absent |
| nested SAVEPOINT | PASS | outer committed; inner savepoint rolled back |
| idempotent initDatabase | PASS | biz tables stable=58 (scratch excluded) |

### S2

| 用例 | 结果 | 说明 |
|---|---|---|
| create PO | PASS | PO E2E-PO-001 |
| create PI (linked PO) | PASS | PI E2E-PI-001 -> PO |
| create CI (linked PI) | PASS | CI E2E-CI-001 -> PI |
| create PL (linked CI) | PASS | PL E2E-PL-001 -> CI |
| create Inbound (linked CI) | PASS | Inbound E2E-IB-001 -> CI |
| chain linkage | PASS | PO→PI→CI→PL→Inbound join OK |

### S3

| 用例 | 结果 | 说明 |
|---|---|---|
| create payment_request | PASS | PR E2E-PR-001 payable=1050 |
| payable + allocation link | PASS | payable_item + payment_request_item linked |
| transaction + allocation + paid_date | PASS | tx+allocation+paid_date set |
| reversal | PASS | transaction reversed (cancelled) |

### S4

| 用例 | 结果 | 说明 |
|---|---|---|
| Cost Confirm | PASS | CI wac_confirmed=1 + wac_history locked row |
| Trigger Lock UPDATE blocked | PASS | UPDATE on locked row rejected, value intact |
| Trigger Lock DELETE blocked | PASS | DELETE on locked row rejected, row intact |
| error string preservation | PASS | both LOCKED_WAC_HISTORY_* strings present in PG trigger funcs |

### S5

| 用例 | 结果 | 说明 |
|---|---|---|
| approval_records | PASS | approval_records pending |
| business_participants CC | PASS | CC participant Alice resolved |

### S6

| 用例 | 结果 | 说明 |
|---|---|---|
| replenishment_suggestions insert | PASS | replenishment_suggestions row inserted |
| F1 strftime TEXT date col (depart_date) | PASS | TEXT '2026-07-15' -> '2026-07'; '' -> NULL (no to_char error) |
| F2 date negative offset (past) | PASS | date('now','-90 days')=2026-04-19 (past); +10=2026-07-28 (future) |
| julianday day diff | PASS | julianday diff=10.0 days |
| historical order parse via GLOB | PASS | GLOB 'ABC*' -> ['ABC123','ABCD'] |
| forecast 90d window (uses F2 fix) | PASS | 90d window sums only recent qty=7 (old excluded) |

### S7

| 用例 | 结果 | 说明 |
|---|---|---|
| GLOB * (wildcard) | PASS | 'ABC*' -> ["ABC123","ABCD"] |
| GLOB ? (single char) | PASS | 'AB?D' -> ["ABCD","ABXD"] (matches ABCD & ABXD: ?=single char) |
| GLOB [] (char class) | PASS | 'SKU-[AB]*' -> ["SKU-A1","SKU-B2"] |
| GLOB [!] (negated class) | PASS | 'AB[!X]*' -> ["ABC123","ABCD"] (ABXD excluded) |
| GLOB case-sensitive | PASS | 'abc' -> ['abc'] (case-sensitive, no uppercase match); 'ABC*' -> ["ABC123","ABCD"] |
| GLOB * suffix | PASS | '*001' -> ["RED001"] |

## 四、两处修复验证（R1.6 核心）

### 修复 1：strftime TEXT 日期兼容
- 修复前：`strftime('%Y-%m', text_col)` → `TO_CHAR(text_col,'%Y-%m')` → PG 报 `to_char(text, unknown) does not exist`。
- 修复后：`strftime(col,fmt)` → `TO_CHAR(CAST(NULLIF(col,'') AS timestamp), fmt)`。
- 证据（S6/F1）：TEXT 列 '2026-07-15' → '2026-07'；空字符串 '' → NULL（无报错）。复现 server.js:7697 `strftime('%Y-%m', lb.depart_date)`。

### 修复 2：date('now','-N days') 偏移符号 + TEXT 返回类型
- 修复前：`date('now','-90 days')` → `CURRENT_DATE - INTERVAL '-90 days'` = 未来 +90 天；且返回 DATE 类型，与 server.js 中 TEXT 日期列（order_date / depart_date）比较时触发 `operator does not exist: text >= timestamp`。
- 修复后：符号与 INTERVAL 幅度分离，且返回 TEXT 'YYYY-MM-DD'（与 SQLite 的 date() 返回类型一致）：
  - `date('now','-90 days')` → `TO_CHAR(CURRENT_DATE - INTERVAL '90 days', 'YYYY-MM-DD')`（过去）
  - `date('now','+10 days')` → `TO_CHAR(CURRENT_DATE + INTERVAL '10 days', 'YYYY-MM-DD')`（未来）
- 偏离说明：用户 R1.6 指令字面给出 `CURRENT_DATE - INTERVAL '90 days'`（DATE 形式）。因 server.js:7666/7702/7780 将 `date(...)` 与 TEXT 列比较（SQLite 的 date() 本就返回 TEXT），保留 DATE 形式会导致真实预测查询运行时报 `text >= timestamp`（已在本 E2E 的 S6/forecast 90d window 中实测复现）。故采用 TEXT 形式，既修正方向又保证与 TEXT 列可比，完全对齐 SQLite 语义。
- 证据（S6/F2、S6/forecast 90d window）：`date('now','-90 days')` 返回 90 天前（TEXT）；`+10 days` 返回 10 天后；历史销量 90d 窗口聚合仅含近期（7），排除 100 天前（99）。

## 五、发现与待办

- 无阻断性缺陷。R1.5 报告中的 F1/F2 两项已在 R1.6 修复并验证通过。
- 关联缺陷 F3（修复过程中发现并一并修正）：`date('now', 修饰符)` 原返回 DATE 类型，与 server.js 的 TEXT 日期列比较会报 `text >= timestamp`（R1.5 E2E 未覆盖该真实比较路径）。R1.6 改为返回 TEXT 'YYYY-MM-DD'（与 SQLite 一致）后解决，详见"修复 2 偏离说明"。
- GLOB 转换仅支持字面量模式（server.js 唯一用法 line 2710 即字面量 `'[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`），无参数化 GLOB 隐患。
- 隔离性更正（R1.5 报告事实修正）：R1.5 E2E 因 embedded-postgres 选项名误用（传入 `dataDir`，实际应为 `databaseDir`，默认回退到 `<cwd>/data/db`），PG 数据簇实际落在本项目 `data/db`，并非报告所称的 /tmp 隔离实例。R1.6 已修正为 `databaseDir` 指向 `/tmp/pg-e2e-r16`，实现真正的文件/进程隔离，并已清理 R1.5 误建的 `data/db` 集群（该目录为 PG 簇、非 SQLite 文件 `data/inventory.db`，清理不影响业务数据）。功能验证结论不变（R1.5 同样针对真实 db-pg.js 跑通），但 R1.5 报告的"独立测试库"应理解为"项目内本地 PG 实例"。
- 测试库为独立 embedded-postgres 实例（本运行位于 /tmp/pg-e2e-r16），未触碰任何正式 Supabase；测试结束后实例销毁。

## 六、停点

R1.6 完成即停。下一步（待用户授权）：R2（server.js async/await + 2 行 COLLATE 修复，若有）或部署相关阶段。
