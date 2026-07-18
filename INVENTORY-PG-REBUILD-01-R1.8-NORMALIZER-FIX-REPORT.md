# INVENTORY-PG-REBUILD-01 · R1.8 Normalize Fix 报告

**日期**：2026-07-18
**阶段**：R1.8（DAL normalize 层修复，独立于 R2）
**纪律**：仅修改 `db-pg.js`；不修改 `server.js` / `app.js` / 业务规则 / schema / 部署配置 / `package.json`；使用独立 PostgreSQL 测试库；未连接任何正式 Supabase；完成后停止，不进入 R2。
**验收基线**：R1.7 FINAL DAL AUDIT 验收通过，其发现的 `INSERT OR IGNORE` 缺口（R2-RISK-01）确认属于 DAL normalize 层问题，不进入 R2，故以 R1.8 单独修复。

---

## 1. 修复内容

### 缺口来源
- `server.js:5137`（`updateCostAfterInbound` inbound/ERP 导入路径）：当库存总表无该 SKU 记录时创建一条仅含成本的记录：
  ```js
  run(`INSERT OR IGNORE INTO inventory (id, sku_code, country, warehouse, available_qty, weighted_avg_cost, inventory_value, last_inbound_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [...]);
  ```
- 该语句经 `run()` 走 `normalizeSql` 路径，但 R1 的 `normalizeSql` **无任何 `INSERT OR IGNORE` 转换规则** → PG 下会报语法错误。R1.5/R1.6 E2E 34/34 未命中此行（E2E 用 `INSERT INTO` 直构），故 R1.7 审计才暴露。

### 修复（db-pg.js `normalizeSql`，新增 rule 0）
```js
// 0. INSERT OR IGNORE INTO xxx -> INSERT INTO xxx ON CONFLICT DO NOTHING
let isInsertIgnore = false;
s = s.replace(/^\s*INSERT\s+OR\s+IGNORE\s+INTO\b/i, (m) => {
  isInsertIgnore = true;
  return m.replace(/OR\s+IGNORE\s+/i, '');
});
if (isInsertIgnore) {
  s = s.replace(/;\s*$/, '') + ' ON CONFLICT DO NOTHING';
}
```
**语义对齐**：
- `INSERT OR IGNORE` → `INSERT ... ON CONFLICT DO NOTHING`（无冲突目标 = 语句级忽略所有唯一/主键冲突），与 SQLite `OR IGNORE` 在唯一约束层面的语义一致。
- 置于所有转换之前（step 0），不引入裸 `?`，且末尾追加的子句不含 `?`，与 step 10（`?`→`$N`）无干扰。
- 大小写不敏感（`/i`），保留原始关键字大小写（PG 关键字大小写不敏感）。

### 改动规模
- `git diff --stat db-pg.js` → **1 file changed, 12 insertions(+), 0 deletions(-)**（仅新增 rule 0）。
- 未触碰 schema / `package.json` / `server.js` / 部署配置。

---

## 2. 验证结果

### 2.1 字符串级测试（normalizeSql，临时副本导出内部函数，未改原文件）
- 独立测试 `/tmp/norm-test.cjs`：**13/13 通过**（含 R1.8 新增 4 例 + R1.6 F1/F2 及其它方言回归 9 例）。
- 关键新增用例：
  | 用例 | 输入 | 输出 |
  |---|---|---|
  | 基本 | `INSERT OR IGNORE INTO inventory (id,...) VALUES (?, ...)` | `INSERT INTO inventory (id,...) VALUES ($1, ...) ON CONFLICT DO NOTHING` |
  | 末尾分号 | `INSERT OR IGNORE INTO t (a) VALUES (?);` | `INSERT INTO t (a) VALUES ($1) ON CONFLICT DO NOTHING` |
  | 小写 | `insert or ignore into t (a) values (?)` | `insert into t (a) values ($1) ON CONFLICT DO NOTHING` |
  | 非冲突路径 | `INSERT INTO t (a) VALUES (?)` | `INSERT INTO t (a) VALUES ($1)`（不追加子句） |
- 回归确认：R1.6 的 `strftime` TEXT 兼容、date 偏移 TEXT 返回，及其它方言（GLOB/instr/julianday/printf）转换**无回归**。

### 2.2 真实隔离 PG E2E（embedded-postgres 18.4，localhost:5433，`databaseDir=/tmp/pg-e2e-r18`，未连 Supabase）
- **5/5 通过**：

  | 范围 | 用例 | 结果 |
  |---|---|---|
  | S0 | normalizeSql 字符串级（INSERT OR IGNORE→ON CONFLICT DO NOTHING，移除 OR IGNORE，占位符转换） | PASS |
  | S1 | **server.js:5137 对应 SQL 首插**（真实 PG） | PASS：`changes=1`，行落库 `sku=R18-SKU-001 wac=12.34` |
  | S2 | **重复插入同 id（PK 冲突）** | PASS：冲突被忽略，原行保持不变（`sku=R18-SKU-001` 未被覆盖） |
  | S3 | **changes 返回值契约** | PASS：新插入 `changes=1`、冲突 `changes=0`、普通 `INSERT` 冲突正确抛唯一约束错误（证明 `ON CONFLICT DO NOTHING` 是 IGNORE 专有行为） |
  | S4 | 事务内 INSERT OR IGNORE | PASS：事务内首插 `changes=1`，提交后行存在 |

### 2.3 验证项与用户要求对应
| 用户要求 | 覆盖 |
|---|---|
| 1. server.js:5137 对应 inbound/import 路径 SQL 验证 | S1（真实 PG 执行该 SQL） |
| 2. 重复插入验证 | S2（PK 冲突被忽略，原行保留） |
| 3. changes 返回值验证 | S3（`changes=1`/`changes=0` 契约）+ S1/S2/S4 均断言 `changes` |
| 4. normalizeSql 字符串级测试 | S0 + 独立 13/13 套件 |

---

## 3. 语义边界说明（透明披露）
- `ON CONFLICT DO NOTHING`（无冲突目标）覆盖 **唯一约束 / 主键 / EXCLUDE** 冲突——与 SQLite `OR IGNORE` 在唯一约束层面的行为一致。
- SQLite `OR IGNORE` 还会忽略 **NOT NULL / CHECK** 等约束违规；PG 的 `ON CONFLICT DO NOTHING` **不覆盖** NOT NULL 违规（仍会报错）。
- 对本路径无影响：`server.js:5137` 提供全部 8 列（`id/sku_code/country/warehouse/available_qty/weighted_avg_cost/inventory_value/last_inbound_date`），无 NOT NULL 缺口；实际唯一可能冲突的是 `id`（PK，由 `genId` 生成，正常不重复，故 `OR IGNORE` 本就是防御性写法）。
- 若未来出现"期望 IGNORE 同时吞掉 NOT NULL 违规"的场景，需另行评估（当前不在范围内）。

---

## 4. 隔离性与复用的纪律
- 测试库为**独立 embedded-postgres** 实例（macOS arm64 原生二进制，装于受管 node workspace，**未写入项目 `package.json`**），`databaseDir=/tmp/pg-e2e-r18`，运行后实例停止、数据目录清理。
- **未连接任何正式 Supabase**；项目业务代码零改动（`server.js`/`app.js`/schema/部署配置均未动）。
- 临时测试脚本（`/tmp/r18-e2e.mjs`、`/tmp/norm-test.cjs`）运行后清理，不留在项目目录。

---

## 5. 对 R2 的影响
- R1.7 风险清单中的 **R2-RISK-01（INSERT OR IGNORE 缺口）** 已在 R1.8 于 DAL 层修复，不再阻塞 R2。
- R1.7 另指出 **R2-RISK-08**：R2 原计划的"2-line COLLATE 修复"已被 R1 normalizeSql rule 1 提前满足。
- 故 R2 实际范围收敛为：**仅 server.js 同步 DAL 调用 → async/await 转换**（~711 处），不再含 DAL 改动。

---

## 6. 交付与状态
- 修改文件：`db-pg.js`（+12 行，仅 `normalizeSql` rule 0）
- 新增报告：`INVENTORY-PG-REBUILD-01-R1.8-NORMALIZER-FIX-REPORT.md`
- 验证：字符串级 13/13 + 真实 PG E2E 5/5，全绿
- **未提交、未 push、未部署**（按纪律每阶段独立本地 commit 待用户授权）
- 下一步：等待用户确认。可选项：①本地提交 R1.8；②进入 R2（server.js async/await）；③归档规划/审计文档；④其他。
