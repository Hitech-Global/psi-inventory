# L2B 成本与汇率数据库设计（依据 Final V1.0 冻结基线）

- **版本**：设计稿 v1（待评审）
- **日期**：2026-07-13
- **依据**：`docs/成本与汇率计算规则FinalV1.0.md`（✅ 已冻结，唯一业务基线）
- **性质**：数据库设计（表结构 / 字段 / 索引 / 约束）。**本稿仅设计，不执行 DDL、不改业务规则、不写实现代码。**
- **范围**：成本确认、成本结算日、成本清单、本币 WAC 版本、汇率唯一生效、付款日快照、历史 CI 隔离、付款冲销。
- **现状盘点结论**：库内已存在 `ci_cost_items` / `cost_update_logs` / `original_inventory_imports` 三张雏形表，且 `commercial_invoices` 已有 `cost_confirmed/cost_allocated/landing_total_cost/original_inventory_imported`（ALTER 补齐），`server.js` 已有部分成本确认与 WAC 重算逻辑（line 4543、4656–4799）。本设计以「对齐 Final V1.0 + 补齐缺口」为主，而非从零新建。

> 冻结红线（来自 Final V1.0 冻结确认）：后续数据库设计必须依据 Final V1.0；不得在设计中自行修改业务规则；实现困难只能提影响分析。本稿遵守。

---

## 0. 设计原则

1. **规则零改写**：所有字段 / 表均映射 Final V1.0 已定规则，不引入新业务假设。
2. **复用已有骨架**：优先增强 `ci_cost_items` / `cost_update_logs` / `original_inventory_imports`，不另起等价表。
3. **成本生命周期与入库生命周期解耦**：`ci_status` 已被入库流程占用，成本状态用独立列 `cost_status`，互不干扰（§23 vs 入库状态机）。
4. **快照锁定**：成本结算日快照、付款日快照一旦写入不可变；后续汇率同步不回写（§25.4 / §26）。
5. **WAC 维度 = 库存行**：WAC 天然按 `(sku_code, country, warehouse)` = 国家+仓库+SKU（§28），与 `inventory` 行对齐。
6. **版本永久保留**：WAC 变更只追加版本，不物理删除旧版本（§30）。

---

## 1. 现有表盘点与映射

| 表 | Final V1.0 对应章 | 现状 | 设计动作 |
|----|------------------|------|----------|
| `commercial_invoices` | §9/§22/§23/§27 | 已有 `cost_confirmed/cost_allocated/landing_total_cost/original_inventory_imported`（ALTER 补齐）；`ci_status` 被入库占用 | 新增 `cost_status` / `cost_settlement_date` / `cost_confirmed_at/by/permission` / `ci_source` / `cost_link_mode` |
| `ci_cost_items` | §14/§15/§22.3 | 已有成本清单雏形（ci_id/payment_request_id/ payable_amount/paid_amount/include_in_landing_cost/currency） | 增强：成本清单状态、结算日快照、本币金额、历史 RMB 成本 |
| `cost_update_logs` | §30 | 已记录 old→new WAC | 演进为 WAC 版本表：加 `version_no`/`adjustment_type`/`reason`/`is_current`/基数/结算日 |
| `original_inventory_imports` | §8.A/§22.2.3 | 已有 ci_id/sku_code/country/warehouse/original_qty | 基本满足，可选补 `inventory_row_id`/`import_batch` |
| `payment_requests` | §14 #2/#3/#4、§15.A、§11 | 有 `local_amount/rmb_amount/usd_amount/book_rate/actual_rate` | 补付款日快照 `payment_rate_date/payment_rate_type` + 冲销关联字段 |
| `payable_items` | §7/§15.A（费用源头） | 有 `currency/fee_type/payer_entity_key` | 已满足，作为费用（多币种）源头 |
| `inventory` | §8/§28 | `weighted_avg_cost` 按 `(sku_code,country,warehouse)` | 已满足；需确认 `(sku_code,country,warehouse)` 唯一性（影响分析 R2） |
| `exchange_rates` | §25/§26 | 有 `from/to/rate/rate_date/rate_type`，**无唯一约束** | 加唯一键 + `is_effective` + 兜底标记；新增同步历史表（可选） |
| `skus` | — | 有 `weighted_avg_cost`（按 SKU 汇总） | 保留为汇总视图，运营 WAC 以 `inventory` 为准 |
| `roles` | §22.1 | permissions JSON | 加入权限码 `cost_confirm`（初始授权 admin） |

---

## 2. 详细表设计

### 2.1 `commercial_invoices` 增强

```sql
-- 待实施 DDL（设计稿）：ALTER TABLE commercial_invoices ADD COLUMN ...
cost_status             TEXT DEFAULT 'open'     -- 成本生命周期：open → cost_confirmed → closed（独立于 ci_status）
cost_settlement_date    TEXT DEFAULT ''         -- 成本结算日（§27，默认 Cost Confirm 当天）
cost_confirmed_at       TEXT DEFAULT ''         -- 确认时间戳
cost_confirmed_by       TEXT DEFAULT ''         -- 确认人（req.currentUserId）
cost_confirm_permission TEXT DEFAULT ''         -- 确认时权限来源（记录 'cost_confirm'，§22.1）
ci_source               TEXT DEFAULT 'normal'   -- normal | history_import（§18 历史CI隔离）
cost_link_mode          TEXT DEFAULT ''         -- 成本衔接模式标识（§18.4 未来开放，仅留字段不实现逻辑）
```

**说明**
- `cost_status` 不与 `ci_status` 混用：`ci_status` 管入库（draft/uploaded/ci_pl_uploaded/partial_inbound/completed/cancelled），`cost_status` 管成本（open/cost_confirmed/closed）。
- `cost_confirmed`（已存在）= 布尔闸门；`cost_status='cost_confirmed'` 为状态机同步值，二者在确认时同时置位。
- `ci_source='history_import'` 时，成本确认逻辑**不**写 `inventory.weighted_avg_cost`（§18.2 默认不影响运营 WAC）。
- `cost_link_mode` 仅占位；「成本初始化 / 成本衔接模式」实现留未来，本轮不设计（§18.4）。

### 2.2 `ci_cost_items` 增强（成本清单，§22.3 / §14 / §15）

```sql
-- 待实施 DDL（设计稿）：ALTER TABLE ci_cost_items ADD COLUMN ...
fee_type            TEXT DEFAULT ''   -- 关联 payable_items.fee_type：goods(货款)/freight(运费)/duty(关税)/inspection(商检)/customs(清关)/local_misc(本地杂费)/other
original_amount     REAL DEFAULT 0    -- 原始业务金额（§14 #1）；本币费用时=原币
cost_list_status    TEXT DEFAULT 'pending'  -- included(已纳入)/not_applicable(不适用)/allow_later(允许后补)/must_wait(必须等待)（§22.3）
settlement_rate     REAL DEFAULT 0    -- 成本结算日汇率（from→LC）
settlement_rate_date TEXT DEFAULT ''  -- 成本结算日（冗余便于查询）
settlement_rate_type TEXT DEFAULT ''  -- realtime / manual / nearest_available（§25.4 标记）
lc_amount           REAL DEFAULT 0    -- 批次成本本币金额（§14 #5）= original_amount×settlement_rate（外币）或 original_amount（本币，§29.3）
historical_rmb_cost REAL DEFAULT 0    -- 历史人民币成本（§14 #6 = lc_amount ÷ settlement_rate(RMB)）
snapshot_flag       TEXT DEFAULT ''   -- normal / nearest_available / manual（§19/§25.4 兜底标记）
```

**CI 维度 WAC 公式落点（§8）**
- `include_in_landing_cost=1` 且 `cost_list_status='included'` 的行参与批次本币成本汇总（§29.1）。
- `lc_amount` 由 Cost Confirm 时按 `cost_settlement_date` 的**正式生效汇率**（§25.3）折算并锁定。
- 本币费用（currency = 目的国 LC）：`lc_amount = original_amount`，`settlement_rate` 记为 1（免换算，§29.3）。

### 2.3 `cost_update_logs` 演进为 WAC 版本表（§30）

```sql
-- 待实施 DDL（设计稿）：ALTER TABLE cost_update_logs ADD COLUMN ...
version_no        INTEGER DEFAULT 1   -- WAC 版本号（§30.1：首次=1，每次前向调整+1）
adjustment_type   TEXT DEFAULT 'initial'  -- initial(首次确认)/forward_adjust(前向补费)/reconfirm(受控重确认)
reason            TEXT DEFAULT ''     -- 调整原因（§30.3）
source_ci_id      TEXT DEFAULT ''     -- 来源 CI id（related_ci_no 已有，冗余 id 便于 join）
base_qty          REAL DEFAULT 0      -- 原库存数量（§22.5 基数，审计引用）
base_wac          REAL DEFAULT 0      -- 原库存 WAC
cost_settlement_date TEXT DEFAULT ''  -- 本版本对应成本结算日
is_current        INTEGER DEFAULT 1   -- 是否 (sku,country,warehouse) 最新生效版本（§30.2）
```

```sql
-- 索引（设计稿）
CREATE UNIQUE INDEX IF NOT EXISTS uq_wac_ver
  ON cost_update_logs(sku_code, country, warehouse, version_no);
CREATE INDEX IF NOT EXISTS ix_wac_current
  ON cost_update_logs(sku_code, country, warehouse, is_current);
```

**说明**
- 现有 `old_avg_cost/new_avg_cost/original_qty/inbound_qty` 已覆盖 §30.3「原 WAC / 新 WAC / 影响维度」。
- 「当前库存引用最新生效版本」= `is_current=1` 行；前向调整时旧版本 `is_current` 置 0、新版本置 1（§30.2）。
- 历史销售成本引用「销售当时版本」：出库记录（`outbound_records`）需记录当时 `version_no`（影响分析 R3，见 §6）。

### 2.4 `exchange_rates` 唯一生效（§25 / §26）

```sql
-- 待实施 DDL（设计稿）
-- 唯一生效键（§25.2）
CREATE UNIQUE INDEX IF NOT EXISTS uq_exrate_effective
  ON exchange_rates(from_currency, to_currency, rate_date, rate_type);
-- 新增列
ALTER TABLE exchange_rates ADD COLUMN is_effective INTEGER DEFAULT 1;  -- 正式生效标记（每日每币种对仅一条=1）
ALTER TABLE exchange_rates ADD COLUMN source TEXT DEFAULT 'api';        -- api / manual / fallback
ALTER TABLE exchange_rates ADD COLUMN snapshot_basis TEXT DEFAULT '';   -- '' / nearest_available / manual（§25.4）
```

**去重策略（§25.2 落点）**
- 写入规则：同一 `(from,to,rate_date,rate_type)` 已存在 `is_effective=1` 时，新同步值 **UPDATE** 该行（保留最新生效），旧值转入同步历史表（见下），不新增重复生效行。
- 历史汇率重新同步（§26）：允许 UPDATE `exchange_rates`，但**已业务引用的快照**（写入 `ci_cost_items.settlement_rate*` / `payment_requests.payment_rate*`）不受影响。
- 同步历史表（可选，不影响正式表）：

```sql
CREATE TABLE IF NOT EXISTS exchange_rate_sync_log (
  id TEXT PRIMARY KEY,
  from_currency TEXT NOT NULL,
  to_currency TEXT NOT NULL,
  rate REAL NOT NULL,
  rate_date TEXT NOT NULL,
  rate_type TEXT DEFAULT 'realtime',
  api_raw TEXT DEFAULT '',          -- 第三方原始返回
  synced_at TEXT DEFAULT (datetime('now')),
  became_effective INTEGER DEFAULT 0
);
```

### 2.5 `payment_requests` 付款日快照与冲销（§15.A / §14 / §11）

```sql
-- 待实施 DDL（设计稿）：ALTER TABLE payment_requests ADD COLUMN ...
payment_rate        REAL DEFAULT 0    -- 付款日汇率（from→LC），等价于 actual_rate（留清清晰起见新增）
payment_rate_date   TEXT DEFAULT ''   -- 付款日（§15.A 付款日期）
payment_rate_type   TEXT DEFAULT ''   -- realtime / manual / nearest_available
is_reversal         INTEGER DEFAULT 0 -- 是否红字冲销记录（§11）
reversal_of         TEXT DEFAULT ''   -- 被冲销原 payment_requests.id
reversal_type       TEXT DEFAULT ''   -- reverse(红字冲销) / regenerate(重生成)
```

**说明**
- `local_amount` = 付款日本币金额（§14 #3）；`rmb_amount` = 付款日人民币金额（§14 #4）。二者在付款完成（payment_transactions 对账/reconciled）时按 `payment_rate_date` 的正式生效汇率折算并锁定。
- 付款日快照**不**自动重算批次初始 WAC（§15.C.5）。
- 冲销（§11）：生成 `is_reversal=1` 红字请求 + 新 `reversal_type='regenerate'` 请求，`reversal_of` 关联原记录；仅影响财务付款状态，不触发 WAC 重算。`payment_transactions.trans_status` 已有 `cancelled`、`payment_allocations.status` 已有 `cancelled`，可承载核销冲销。

### 2.6 `original_inventory_imports`（已满足，§8.A / §22.2.3）

现有字段 `ci_id/ci_no/sku_code/country/warehouse/original_qty` 已覆盖「原库存数量基数」。
可选增强（非必须）：`inventory_row_id TEXT DEFAULT ''`、`import_batch TEXT DEFAULT ''` 便于精确回指库存行。

### 2.7 `inventory`（已满足，§8 / §28）

- `weighted_avg_cost` = 本币 WAC，维度 = `(sku_code, country, warehouse)` = 国家+仓库+SKU（§28.1）。
- 实施约束：需保证 `(sku_code, country, warehouse)` 唯一（影响分析 R2）。
- 当前人民币等值（§14 #7）**不存储**，由库存总表实时按实时展示汇率计算（§2.2 / §12）。

### 2.8 `payable_items`（已满足，§7 / §15.A 费用源头）

- 已含 `currency/fee_type/payer_entity_key`，是费用（含多币种）主数据。
- `ci_cost_items.payment_request_id → payment_requests.id → payment_request_items.payable_item_id → payable_items.id` 形成「CI 成本项 ↔ 费用单 ↔ 付款」链路。

---

## 3. 成本结算日 / 成本清单 / WAC 版本 存储形态（§27 / §22 / §30 落点）

- **成本结算日**：`commercial_invoices.cost_settlement_date`（默认 Cost Confirm 当天；受控例外选其他日需权限+原因+操作人+时间，§27.2）。
- **成本清单**：`ci_cost_items` 每行一项，`cost_list_status` 标记四态；确认时校验无 `must_wait`（§22.4）。
- **WAC 版本**：`cost_update_logs` 演进为版本表，`version_no` + `is_current` 支撑「当前引最新、历史引当时」（§30.2）。

---

## 4. 历史 CI 隔离（§18）落点

- 标记：`commercial_invoices.ci_source = 'history_import'`。
- 默认影响：付款 / 核销 / 费用 / 财务报表 / 历史成本与费用趋势（`ci_cost_items` / `payment_requests` / `payable_items` 照常存）。
- 默认不影响：`inventory.weighted_avg_cost` 不因其成本确认而更新；自然不进入预测 / 建议采购 / 在途 / PO（这些读 `inventory` / `replenishment`，天然隔离）。
- 衔接模式（未来开放）：`ci_source='history_import' AND cost_link_mode='linked'` 时才允许写运营 WAC；本轮仅留字段，**不实现逻辑**（§18.4）。

---

## 5. 开放点决议（Final V1.0 §31 各项）

| 开放点 | 本设计决议 | 状态 |
|--------|-----------|------|
| A. 历史CI财务/运营隔离表结构 | `ci_source` 字段 + 实施时逻辑分支；财务维度复用既有表 | 已决议 |
| C. 多 SKU 分摊权重 | **默认按数量占比分摊**（quantity-weighted）；在 `cost_update_logs` 记 `allocation_base`；具体权重用户最终确认 | 待用户确认 |
| D. RMB/CNY 命名 | 全系统已统一 `RMB`（`currencies.code` / `exchange_rates` 均用 RMB），无 CNY，无需改动 | 已确认 |
| E. 付款冲销关联与展示 | `payment_requests.is_reversal/reversal_of/reversal_type` + 既有 `trans_status/cancelled` | 已决议 |
| 成本结算日/成本清单/WAC版本存储 | 见 §3 | 已决议 |
| `cost_confirm` 权限码 | 新增权限码 `cost_confirm`，初始授权 `admin`（§22.1） | 已决议 |
| CI 状态机 CLOSED 触发 | `cost_status` 状态机；CLOSED = 库存=0 且无待补，或显式关闭（§23.4） | 已决议（细节实施定） |
| 成本初始化/成本衔接模式 | 仅留 `ci_source`+`cost_link_mode` 字段，不实现 | 已决议（未来） |
| 汇率唯一生效去重/覆盖/历史 | 见 §2.4（唯一键 + is_effective + 同步历史表） | 已决议 |

---

## 6. 影响分析 / 风险（实现阶段需处理，非设计阻塞）

- **R1 `ci_status` 不可复用**：已被入库流程强占用（draft/uploaded/ci_pl_uploaded/completed/partial_inbound/cancelled）。成本状态必须用独立 `cost_status` 列。✅ 已在本设计解耦。
- **R2 `inventory` 唯一性**：需确认 `(sku_code, country, warehouse)` 当前是否唯一。若非唯一，WAC 版本与「当前引用」会产生歧义，实施时需补唯一约束并迁移。
- **R3 出库成本版本引用**：`outbound_records` 需记录销货当时的 `wac_version_no`，才能实现「历史销售引用当时版本、补费不回写利润」（§24.4）。需在实施时补列。
- **R4 现有 server.js 部分实现需对齐**：`server.js:4543`（`cost_confirmed=1`）与 `4656–4799`（WAC 重算 + `cost_update_logs` 写入）已存在，但其公式/快照/版本/历史CI隔离/结算日可能与 Final V1.0 不一致。**实施不是新写，而是重构对齐**——需逐条核对：是否区分 §8.A/§8.B、是否记 `version_no`、是否处理 `ci_source` 隔离、是否按 `cost_settlement_date` 取正式生效汇率。
- **R5 多币种先折本币再汇总**：现有 `ci_cost_items` 仅存 `payable_amount`（原币），缺 `settlement_rate/lc_amount`；Cost Confirm 实施时需按 `cost_settlement_date` 查 `exchange_rates` 正式生效汇率折算（§29.1），禁先换 RMB 再换 LC。
- **R6 付款日快照缺失 date/type**：`payment_requests` 现有 `book_rate/actual_rate` 无日期/类型，需补 §2.5 字段并在付款对账时锁定。
- **R7 汇率历史重复行迁移**：`exchange_rates` 现有无唯一约束，实施加唯一键前需先清理/归档历史重复行。

---

## 7. 实施顺序建议（供下一阶段参考，非本轮执行）

1. `exchange_rates` 唯一键 + `is_effective` + 同步历史表（R7 先清理）。
2. `commercial_invoices` 增强列（cost_status 等）。
3. `ci_cost_items` 增强列（成本清单状态 + 结算快照）。
4. `cost_update_logs` 演进为版本表（version_no/is_current）。
5. `payment_requests` 付款日快照 + 冲销字段。
6. `roles` 加入 `cost_confirm` 权限。
7. `outbound_records` 补 `wac_version_no`（R3）。
8. 重构 `server.js` 成本确认 / WAC 重算逻辑对齐 Final V1.0（R4）。

---

## 8. 设计状态

- 本设计稿依据 **Final V1.0（已冻结）** 编写，未改写任何业务规则。
- 本轮仅产出数据库设计，**未执行任何 DDL、未修改代码、未进入实施**。
- 待评审确认后，方可进入实施阶段（建表 / 改表 / server 逻辑对齐）。
