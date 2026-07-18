# SQLite → PostgreSQL 兼容映射文档（INVENTORY-PG-REBUILD-01 · R1）

本文件是 `db-pg.js` SQL 归一化层（`normalizeSql`）的权威说明。业务代码（`server.js` /
`app.js`）仍然写 **SQLite 风格 SQL**，由 `db-pg.js` 在 `query/run/transaction` 执行前翻译为
PostgreSQL 可执行语句。R2 完成 `server.js` 异步化后，归一化层继续作为安全兜底存在。

> 顺序约定：所有转换在 `?` → `$N` 之前完成；`?` → `$N` 永远是最后一步，确保前述转换不引入裸 `?`。

---

## 1. 占位符 `?`

| SQLite | PostgreSQL | 说明 |
|---|---|---|
| `WHERE id = ? AND name = ?` | `WHERE id = $1 AND name = $2` | 按顺序把 `?` 替换为 `$1,$2,…` |

- 依赖 `params` 数组的位置顺序（与 SQLite `stmt.run(...params)` 一致）。
- **已知风险（R-E）**：当前为全局顺序替换，不会区分字符串字面量内的 `?`。`server.js` 现有 SQL 不含字面量 `?`，R1.5 全量 E2E 会覆盖验证；若未来新增含字面量 `?` 的 SQL，需在归一化中增加引号感知。

---

## 2. `datetime('now')`

| SQLite | PostgreSQL |
|---|---|
| `datetime('now')` | `NOW()` |
| `datetime('now', '+10 minutes')` | `NOW() + INTERVAL '10 minutes'` |
| `datetime('now', '+N unit')` | `NOW() + INTERVAL 'N unit'` |

- 正则：`datetime\(\s*'now'\s*\)` → `NOW()`；`datetime\(\s*'now'\s*,\s*'\+(\d+)\s+(\w+)'\s*\)` → `NOW() + INTERVAL '$1 $2'`。
- 当前代码库仅出现 `datetime('now')` 与 `datetime('now', '+10 minutes')`（server.js:463）。

---

## 3. `date('now', ...)`

| SQLite | PostgreSQL |
|---|---|
| `date('now')` | `CURRENT_DATE` |
| `date('now', '-30 days')` | `CURRENT_DATE - INTERVAL '30 days'` |
| `date('now', '-90 days')` | `CURRENT_DATE - INTERVAL '90 days'` |
| `date('now', '-6 months')` | `CURRENT_DATE - INTERVAL '6 months'` |

- 正则：`date\(\s*'now'\s*\)` → `CURRENT_DATE`；`date\(\s*'now'\s*,\s*'(-\d+)\s+(days|months)'\s*\)` → `CURRENT_DATE - INTERVAL '$1 $2'`。
- 出现位置：server.js:7666 / 7697 / 7702 / 7780。

---

## 4. `julianday(x)`（天数差）

| SQLite | PostgreSQL |
|---|---|
| `julianday(a) - julianday(b)` | `EXTRACT(EPOCH FROM (CAST(a AS timestamp)))/86400.0 - EXTRACT(EPOCH FROM (CAST(b AS timestamp)))/86400.0` |

- 转换：`julianday(X)` → `EXTRACT(EPOCH FROM (CAST(X AS timestamp)))/86400.0`（秒数差 ÷ 86400 = 天数）。
- 括号内用括号平衡解析（`replaceBalanced`），可正确处理 `julianday(a) - julianday(b)` 这种含减号的嵌套。
- 出现位置：server.js:7603-7605（`avg_transport_days` / `avg_customs_days` / `avg_delivery_days`）。

---

## 5. `strftime(fmt, col)`

| SQLite 格式 | PostgreSQL `TO_CHAR` 格式 |
|---|---|
| `%Y` | `YYYY` |
| `%y` | `YY` |
| `%m` | `MM` |
| `%d` | `DD` |
| `%H` | `HH24` |
| `%M` | `MI` |
| `%S` | `SS` |

| SQLite | PostgreSQL |
|---|---|
| `strftime('%Y-%m', lb.depart_date)` | `TO_CHAR(lb.depart_date, 'YYYY-MM')` |

- 转换：`strftime('fmt', col)` → `TO_CHAR(col, 'PGfmt')`；括号内用括号平衡解析。
- 出现位置：server.js:7697（`按月统计物流批次`）。

---

## 6. `instr(a, b)`

| SQLite | PostgreSQL |
|---|---|
| `instr(a, b)` | `strpos(a, b)` |

- 转换：`instr(inner)` → `strpos(inner)`；括号内用括号平衡解析（内部可能含逗号，如 `instr(col || '/', '/')`）。
- 出现位置：server.js:2703-2708（`salesOrderDateExpr` 历史脏日期兼容）。

---

## 7. `GLOB 'pattern'`（大小写敏感，锚定）

| SQLite | PostgreSQL |
|---|---|
| `col GLOB 'pat'` | `col ~ '^pat$'` |

GLOB 模式 → 正则转换规则（`globToRegex`）：

| GLOB 通配 | 正则 | 说明 |
|---|---|---|
| `*` | `.*` | 任意字符序列 |
| `?` | `.` | 单个任意字符 |
| `[abc]` | `[abc]` | 字符集合（原样） |
| `[!x]` | `[^x]` | 否定集合 |
| `[a-z]` | `[a-z]` | 范围（原样） |
| `. + ^ $ { } ( ) | \ /` | 转义 | 正则元字符转义，避免误当通配 |

- **必须用 `~`（大小写敏感匹配），严禁 `~*`（大小写不敏感）**。
- 整体锚定 `^…$`（GLOB 语义为全串匹配）。
- 转换：`\b(\w+)\s+GLOB\s+'([^']*)'` → `${col} ~ '^${globToRegex(pat)}$'`。
- 出现位置：server.js:2710（`WHEN order_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' THEN …`）。

### GLOB 专项测试覆盖（R1.5 必测）

| 用例 | GLOB 模式 | 期望正则 | 期望行为 |
|---|---|---|---|
| `*` | `a*b` | `^a.*b$` | 匹配 `axxxb`，不匹配 `abx` |
| `?` | `a?b` | `^a.b$` | 匹配 `axb`，不匹配 `ab` / `axxb` |
| `[]` | `a[xy]b` | `^a[xy]b$` | 匹配 `axb` / `ayb`，不匹配 `azb` |
| `[]` 取反 | `a[!x]b` | `^a[^x]b$` | 匹配 `ayb`，不匹配 `axb` |
| 大小写敏感 | `ABC` | `^ABC$` | 匹配 `ABC`，不匹配 `abc` |
| 大小写敏感 | `a*` | `^a.*$` | 匹配 `abc`，不匹配 `Xbc` |

---

## 8. `printf(fmt, args)`（零填充 / 拼接）

| SQLite | PostgreSQL |
|---|---|
| `printf('%04d-%02d-%02d', a, b, c)` | `LPAD(CAST(a AS TEXT),4,'0') \|\| '-' \|\| LPAD(CAST(b AS TEXT),2,'0') \|\| '-' \|\| LPAD(CAST(c AS TEXT),2,'0')` |
| `printf('%s%02d-%02d-%02d', s, a, b, c)` | `s \|\| LPAD(CAST(a AS TEXT),2,'0') \|\| '-' \|\| …` |

- 格式符：`%0Nd`（零填充整数，宽度 N）→ `LPAD(CAST(arg AS TEXT), N, '0')`；`%d` → `CAST(arg AS TEXT)`；`%s` → 原样参数。
- 非格式字符（如 `-` `/` `:`）作为字面量，用 `||` 拼接。
- 括号内用**括号平衡**解析（参数可能含 `CAST(... AS INTEGER)` 这种带括号/逗号的表达式），再按顶层逗号切分参数。
- 出现位置：server.js:2713 / 2718 / 2723（`salesOrderDateExpr` 历史脏日期归一化为 `YYYY-MM-DD`）。

---

## 9. `COLLATE NOCASE`（大小写不敏感比较）

| SQLite | PostgreSQL |
|---|---|
| `col = ? COLLATE NOCASE` | `lower(col) = lower(?)` |

- 仅出现在查询谓词（server.js:5833 / 5841，`historical_commercial_invoices` 查重）。
- DDL 中的 `COLLATE NOCASE` 唯一索引在 PG 侧改用 **`lower()` 表达式索引**（见 §11）。
- 转换：`\b(\w+)\s*=\s*\?\s+COLLATE\s+NOCASE` → `lower($1) = lower(?)`（在 `?`→`$N` 之前执行，保留 `?`）。

---

## 10. 类型映射（REAL 策略，R0 冻结）

| 语义类别 | SQLite | PostgreSQL | 涉及列示例 |
|---|---|---|---|
| 金额 / 成本 / WAC / 付款 | `REAL` | `NUMERIC(18,4)` | `total_amount`、`payable_amount`、`weighted_avg_cost`、`goods_amount`、`inventory_value`、`diff_amount` 等 |
| 财务汇率 | `REAL` | `NUMERIC(18,8)` | `exchange_rates.rate`、`reference_customs_rate`、`actual_customs_rate`、`book_rate`、`actual_rate`、`local_rate`、`rmb_rate` |
| 业务数量 qty | `REAL` | `NUMERIC(18,4)` | `wac_history.original_qty`、`cost_update_logs.inbound_qty`、`original_inventory_imports.original_qty` 等 |
| 重量 / CBM / 物理测量 | `REAL` | `DOUBLE PRECISION` | `unit_weight`、`unit_cbm`、`total_gross_weight`、`total_net_weight`、`total_cbm`、`cost_allocation_details.basis_value` 等 |
| 比例（rate/ratio/discount） | `REAL` | `DOUBLE PRECISION` | `payment_terms.ratio`、`deposit_ratio`、`balance_ratio`、`proforma_invoice_items.discount`、`cost_allocation_details.ratio` |
| 周转 / 月均（turnover/avg/months） | `REAL` | `DOUBLE PRECISION` | `turnover_months`、`avg_sales_4m`、`target_stock_months`、`forecast_turnover_months`、`avg_sales_period` 等 |

> 日期统一以 `TEXT` 存储（与 SQLite 一致），故 `DEFAULT NOW()` 赋值给 TEXT 列时由 PG 隐式转型为文本，无类型冲突（R1 核实：全列均为 `TEXT`/`INTEGER`/`REAL` 三类，无 `DATE`/`DATETIME` 类型列）。

---

## 11. DDL 差异（PG 侧直接写原生，不经归一化）

| 项目 | SQLite | PostgreSQL |
|---|---|---|
| 自增主键 | `INTEGER PRIMARY KEY AUTOINCREMENT` | 本项目全部使用 `TEXT` UUID 主键（`genId`），**无自增**，直迁 |
| `INSERT OR IGNORE` | `INSERT OR IGNORE INTO t …` | `INSERT INTO t … ON CONFLICT (冲突列) DO NOTHING`（冲突列：`brand_settings` 用 `(brand)`，其余用 `(id)`；付款类目映射用 `(source_type, fee_type) WHERE status='active'`） |
| `COLLATE NOCASE` 唯一索引 | `CREATE UNIQUE INDEX … ON t(col COLLATE NOCASE)` | `CREATE UNIQUE INDEX … ON t(LOWER(col))`（表达式索引） |
| 部分唯一索引 | `CREATE UNIQUE INDEX … WHERE is_active=1` | PG 原生支持 `WHERE is_active = 1` |
| `PRAGMA table_info` 探测列 | `PRAGMA table_info(t)` | 不再需要：PG 初次建库即写入**完整最终 schema**（含所有历史迁移追加列），`CREATE TABLE IF NOT EXISTS` 幂等 |
| `CHECK` 约束 | 支持 | PG 原生支持 |
| 外键 | 支持 | PG 原生支持 `ON DELETE RESTRICT` |
| 触发器（WAC 锁） | `CREATE TRIGGER … WHEN OLD.is_locked=1 BEGIN SELECT RAISE(ABORT,'LOCKED_…') END` | `CREATE FUNCTION` + `CREATE TRIGGER … EXECUTE FUNCTION`，`RAISE EXCEPTION 'LOCKED_WAC_HISTORY_UPDATE_FORBIDDEN'` / `'LOCKED_WAC_HISTORY_DELETE_FORBIDDEN'`（**错误串逐字符不变**） |
| `DEFAULT (datetime('now'))` | `DEFAULT (datetime('now'))` | `DEFAULT NOW()` |

---

## 12. 数值类型解析（避免 JS 字符串拼接式算术）

`db-pg.js` 在加载时设置：

```js
types.setTypeParser(1700, parseFloat); // NUMERIC -> number
types.setTypeParser(20,   parseInt);   // BIGINT (COUNT/SUM) -> integer
types.setTypeParser(23,   parseInt);   // INTEGER -> integer
```

- 否则 `COUNT(*)` / `SUM(...)` 返回字符串，`server.js` 的 `a + b` 会变成字符串拼接（如 `cnt === 0` 误判导致重复 seed）。
- `NUMERIC(18,4)` 以浮点参与运算（与 SQLite `REAL` 行为一致，精度足够业务使用）。

---

## 13. 并发安全（事务连接路由）

- 使用 `AsyncLocalStorage`（`als`）：`transaction(fn)` 内 `als.run({ client }, fn)`，
  `query/run` 通过 `als.getStore()` 取到当前事务独占连接。
- **严禁模块级全局 `txClient`**（R0 已否决：并发请求会互相覆盖连接）。
- 嵌套 `transaction()` 使用 `SAVEPOINT`（复用外层同一连接），不新建连接。
- 事务用 `pool.connect()` 获取独占 client（非 `pool.query` 隐式事务），跨多 `await` 期间连接不被其他请求复用。
