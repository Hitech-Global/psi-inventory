# P1 库存筛选脏值 — 生产数据变更记录（脱敏）

> 本记录随 **P1 数据迁移 commit** 入库；不含任何真实生产业务数据，仅记录变更元数据与校验值。
> 完整生产数据备份见本地受控目录 `release-backups/2026-07-31-P1/delete-export.json`（**未入库**）。

## 1. 执行摘要
- **性质**：生产数据库数据修正（移除历史测试 SKU 脏数据），**非代码部署**。
- **执行时间**：2026-07-31 15:19–15:20（GMT+8）。
- **目标环境**：生产环境 PostgreSQL（Supabase，Render 托管实例）。
- **发布状态**：**生产数据修正已于 2026-07-31 执行，待随下一应用补丁版本汇总展示。**
- **应用版本号**：本次**不递增**（无代码部署）；与后续 P0 代码修复组成同一应用补丁版本统一展示。

## 2. 变更范围
只删除 3 个历史测试 SKU 的关联记录，不动真实库存 / 销售 / WAC / 采购 / PI / CI / 入库 / 成本。
- 删除的测试 `sku_code`：`P103B-TEST-SKU-001`、`P103B-TEST-SKU-003`、`P103B-TEST-SKU-004`
- 取数口径不变：`GET /api/inventory/filter-options` 仍读取 `inventory` distinct；页面逻辑不变。

## 3. 变更前后行数
| 表 | 变更前 | 变更后 | 删除 |
|---|---|---|---|
| inventory | 394 | 391 | 3 |
| inventory_imports | 4 | 0 | 4 |
| original_inventory_imports | 2 | 0 | 2 |
| replenishment_suggestions | 4 | 0 | 4 |
| outbound_records | 1 | 0 | 1 |
| inventory_adjustments | 1 | 0 | 1 |
| **合计** | **15** | **0** | **15** |

> 真实库存由 394 → 391（仅移除 3 个测试行），真实 distinct `sku_code` 394 → 391，无真实 SKU 误删。

## 4. 验证结果（删除后复核，全部通过）
- 6 张表目标 `sku_code` 残留计数均为 0；
- `inventory.country` distinct 仅剩 `["印度尼西亚"]`，`warehouse` distinct 仅剩 `["Bekasi Warehouse"]` ——
  Indonesia / Thailand / Vietnam / Jakarta-WH / Bangkok-WH / Hanoi-WH 全部清除；
- 真实库存行数 391 全部保留，真实 SKU / 销售 / WAC / 采购 / PI / CI / 入库 / 成本表均无引用、未被误伤；
- 在**单数据库事务**内执行（`BEGIN … COMMIT`），复核失败则 `ROLLBACK`。

## 5. 回滚方式
- 完整被删记录备份于本地受控目录：`release-backups/2026-07-31-P1/delete-export.json`（**不入库**）。
- 如需回滚，读取该 JSON，对每张表按导出全字段以参数化 `INSERT … ON CONFLICT DO NOTHING` 回插（依据 `sku_code` 定位，不影响其他数据）。示例：
  ```js
  const fs = require('fs'); const { Client } = require('pg');
  const b = JSON.parse(fs.readFileSync(__dirname + '/delete-export.json', 'utf8'));
  (async () => {
    const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    await c.connect(); await c.query('BEGIN');
    for (const t of Object.keys(b)) {
      for (const row of b[t]) {
        const cols = Object.keys(row);
        await c.query('INSERT INTO ' + t + ' (' + cols.join(',') + ') VALUES (' +
          cols.map((_, i) => '$' + (i + 1)).join(',') + ') ON CONFLICT DO NOTHING',
          cols.map(k => row[k]));
      }
    }
    await c.query('COMMIT'); await c.end(); console.log('rollback done');
  })();
  ```

## 6. 实际执行脚本校验值（sha256）
- `release-backups/2026-07-31-P1/export-only.cjs`：`d46e9908b755dfc7c5d5c0a50a45a9e753699ca8222279bcecc08496a3902bb8`
- `release-backups/2026-07-31-P1/delete-in-transaction.cjs`：`3c62ff93ca040ea4a564af2f589b5ea0d280e3e4f18cdf2c4f304d487d9d505c`

## 7. 提交纪律
- 本变更为**独立数据迁移 commit**；应用版本号本次不递增（无代码部署）。
- 与后续 **P0 代码修复** 组成同一应用补丁版本统一展示，并保留 P0 修复前稳定 commit 作代码回滚点。
- `delete-export.json`（真实生产数据）受 `.gitignore` 排除，仅留存于本地受控备份目录，禁止入库。
