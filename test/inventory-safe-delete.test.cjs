'use strict';

/**
 * 库存安全删除（tombstone / exclusion）回归测试
 * ============================================================================
 * 业务语义：
 *   · inventory_imports 是历史导入审计记录，永远保留，不因库存删除而删除。
 *   · 用户主动删除 (sku_code, country, warehouse) 后写入 tombstone，
 *     refreshInventoryTotals() 不再用旧 inventory_imports 重建该库存（防止"复活"）。
 *   · 新的合法库存导入在同一 transaction 内解除 tombstone，可重新建立库存（非永久封禁）。
 *
 * 覆盖：L1-L13 功能测试（SQLite in-memory，真实 HTTP 路由驱动）
 *       L14-L16 PostgreSQL 真机测试（需 PG_TEST_DSN，默认本机临时实例）
 *       FIRST-DEPLOY 启动门禁（全新 DB，验证建表先于 refreshInventoryTotals）
 *
 * 关键设计：tombstone 建表 DDL **直接从 db-sqlite.js 源码抽取**，
 *          确保测试 schema 与生产 schema 无法漂移。
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

process.env.DB_DRIVER = 'sqlite';
process.env.DB_PATH = ':memory:';
process.env.NODE_ENV = 'test'; // 关闭 CSRF 防护，便于测试驱动真实路由

const ROOT = path.resolve(__dirname, '..');

// ── 测试专用模块解析钩子（不影响生产代码）──────────────────────────────
const Module = require('module');
const _origResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  try {
    return _origResolveFilename.call(this, request, parent, isMain, options);
  } catch (e) {
    if (typeof request === 'string' && (request.startsWith('./') || request.startsWith('../'))) {
      const base = path.resolve(path.dirname(parent ? parent.filename : '.'), request);
      const cjsPath = base + '.cjs';
      try { fs.accessSync(cjsPath); return cjsPath; } catch (_) { /* ignore */ }
    }
    throw e;
  }
};

const dbMod = require('../db');
const { query, queryOne, run, getDB } = dbMod;
const { app, refreshInventoryTotals } = require('../server');

// ============================================================================
// tombstone DDL：从 db-sqlite.js 源码抽取（禁止在测试里重写一份，防止漂移）
// ============================================================================
function extractSqliteTombstoneDDL() {
  const src = fs.readFileSync(path.join(ROOT, 'db-sqlite.js'), 'utf8');
  const start = src.indexOf('CREATE TABLE IF NOT EXISTS inventory_delete_tombstones');
  assert.notEqual(start, -1, 'db-sqlite.js 中未找到 inventory_delete_tombstones 建表语句');
  const end = src.indexOf('`', start);
  assert.notEqual(end, -1, 'db-sqlite.js 中 tombstone 建表语句未正常闭合');
  return src.slice(start, end).trim();
}
const TOMBSTONE_DDL_SQLITE = extractSqliteTombstoneDDL();

// ============================================================================
// 最小 schema（覆盖 refreshInventoryTotals + 删除守卫 + 日志/任务表）
// ============================================================================
function createSchema() {
  const d = getDB();
  d.exec('PRAGMA foreign_keys=OFF;');
  d.exec(`
    DROP TABLE IF EXISTS inventory_delete_tombstones;
    DROP TABLE IF EXISTS inventory_imports;
    DROP TABLE IF EXISTS inventory;
    DROP TABLE IF EXISTS skus;
    DROP TABLE IF EXISTS sales_records;
    DROP TABLE IF EXISTS outbound_records;
    DROP TABLE IF EXISTS inventory_adjustments;
    DROP TABLE IF EXISTS inbound_records;
    DROP TABLE IF EXISTS inventory_checks;
    DROP TABLE IF EXISTS wac_history;
    DROP TABLE IF EXISTS operation_logs;
    DROP TABLE IF EXISTS batch_tasks;
    DROP TABLE IF EXISTS sessions;
    DROP TABLE IF EXISTS users;
    DROP TABLE IF EXISTS roles;
    DROP TABLE IF EXISTS role_data_scope;
    DROP TABLE IF EXISTS user_data_scope;
    DROP TABLE IF EXISTS warehouses;
  `);
  d.exec(`
    CREATE TABLE inventory_imports (
      id TEXT PRIMARY KEY,
      import_date TEXT DEFAULT '',
      country TEXT DEFAULT '',
      warehouse TEXT DEFAULT '',
      channel TEXT DEFAULT '',
      sku_code TEXT DEFAULT '',
      available_qty NUMERIC DEFAULT 0,
      remark TEXT DEFAULT '',
      snapshot_cutoff_date TEXT DEFAULT '',
      brand TEXT DEFAULT '',
      weighted_avg_cost NUMERIC DEFAULT 0,
      last_inbound_date TEXT DEFAULT '',
      first_inbound_date TEXT DEFAULT ''
    );
    CREATE TABLE inventory (
      id TEXT PRIMARY KEY,
      sku_code TEXT DEFAULT '',
      country TEXT DEFAULT '',
      warehouse TEXT DEFAULT '',
      available_qty NUMERIC DEFAULT 0,
      weighted_avg_cost NUMERIC DEFAULT 0,
      inventory_value NUMERIC DEFAULT 0,
      last_import_date TEXT DEFAULT '',
      snapshot_cutoff_date TEXT DEFAULT '',
      last_inbound_date TEXT DEFAULT '',
      first_inbound_date TEXT DEFAULT '',
      updated_at TEXT DEFAULT ''
    );
    -- 库存导入预检查（INV-IMPORT-PRECHECK-01）要求 SKU 主数据存在且 brand 非空
    CREATE TABLE skus (
      sku_code TEXT PRIMARY KEY,
      brand TEXT DEFAULT ''
    );
    -- sales_records 刻意不建 warehouse 列：复现生产真实结构（无 warehouse 字段）
    CREATE TABLE sales_records (
      id TEXT PRIMARY KEY,
      sku_code TEXT DEFAULT '',
      country TEXT DEFAULT '',
      quantity NUMERIC DEFAULT 0,
      order_date TEXT DEFAULT '',
      is_valid_order INTEGER DEFAULT 1
    );
    CREATE TABLE outbound_records (
      id TEXT PRIMARY KEY,
      sku_code TEXT DEFAULT '',
      country TEXT DEFAULT '',
      warehouse TEXT DEFAULT ''
    );
    CREATE TABLE inventory_adjustments (
      id TEXT PRIMARY KEY,
      sku_code TEXT DEFAULT '',
      country TEXT DEFAULT '',
      warehouse TEXT DEFAULT ''
    );
    CREATE TABLE inbound_records (
      id TEXT PRIMARY KEY,
      sku_code TEXT DEFAULT '',
      country TEXT DEFAULT '',
      warehouse TEXT DEFAULT ''
    );
    CREATE TABLE inventory_checks (
      id TEXT PRIMARY KEY,
      sku_code TEXT DEFAULT '',
      country TEXT DEFAULT '',
      warehouse TEXT DEFAULT ''
    );
    CREATE TABLE wac_history (
      id TEXT PRIMARY KEY,
      sku_code TEXT DEFAULT '',
      country TEXT DEFAULT '',
      warehouse TEXT DEFAULT '',
      new_avg_cost NUMERIC DEFAULT 0,
      confirmation_status TEXT DEFAULT '',
      is_locked INTEGER DEFAULT 0,
      version_no INTEGER DEFAULT 0
    );
    CREATE TABLE operation_logs (
      id TEXT PRIMARY KEY,
      operator_id TEXT DEFAULT '',
      operator_name TEXT DEFAULT '',
      page TEXT DEFAULT '',
      operation_type TEXT DEFAULT '',
      target_ids TEXT DEFAULT '[]',
      affected_count INTEGER DEFAULT 0,
      old_values TEXT DEFAULT '',
      new_values TEXT DEFAULT '',
      reason TEXT DEFAULT '',
      triggered_recalc INTEGER DEFAULT 0,
      is_rollbackable INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE batch_tasks (
      id TEXT PRIMARY KEY,
      task_name TEXT NOT NULL,
      operation_type TEXT DEFAULT '',
      operator_id TEXT DEFAULT '',
      operator_name TEXT DEFAULT '',
      page TEXT DEFAULT '',
      status TEXT DEFAULT 'running',
      total_count INTEGER DEFAULT 0,
      success_count INTEGER DEFAULT 0,
      failed_count INTEGER DEFAULT 0,
      skipped_count INTEGER DEFAULT 0,
      error_report TEXT DEFAULT '[]',
      is_rollbackable INTEGER DEFAULT 0,
      started_at TEXT DEFAULT (datetime('now')),
      finished_at TEXT DEFAULT ''
    );
    CREATE TABLE roles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      permissions TEXT DEFAULT '[]',
      is_system INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      password TEXT DEFAULT '',
      role_id TEXT DEFAULT '',
      status TEXT DEFAULT 'active',
      email TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL UNIQUE,
      user_id TEXT NOT NULL,
      created_at TEXT DEFAULT '',
      expires_at TEXT DEFAULT '',
      user_agent TEXT DEFAULT '',
      ip_address TEXT DEFAULT ''
    );
    CREATE TABLE role_data_scope (
      role_id TEXT PRIMARY KEY, countries TEXT DEFAULT '[]', brands TEXT DEFAULT '[]', warehouses TEXT DEFAULT '[]'
    );
    CREATE TABLE user_data_scope (
      user_id TEXT PRIMARY KEY, countries TEXT DEFAULT '[]', brands TEXT DEFAULT '[]', warehouses TEXT DEFAULT '[]'
    );
    -- INV-IMPORT-WAREHOUSE-01：库存导入预检查要求 warehouses 主数据（country_name + name + status）
    CREATE TABLE warehouses (
      id TEXT PRIMARY KEY,
      name TEXT DEFAULT '',
      country_id TEXT DEFAULT '',
      country_name TEXT DEFAULT '',
      warehouse_type TEXT DEFAULT 'self',
      address TEXT DEFAULT '',
      status TEXT DEFAULT 'active',
      brands TEXT DEFAULT '',
      sort_order INTEGER DEFAULT 0
    );
  `);
  // tombstone 表使用从 db-sqlite.js 抽取的真实 DDL
  d.exec(TOMBSTONE_DDL_SQLITE);
  d.exec('PRAGMA foreign_keys=ON;');
  // 种子：本文件全部导入行使用 印度尼西亚 / Bekasi Warehouse，预检查仓库校验需要该 active 仓库存在
  run("INSERT INTO warehouses (id, name, country_id, country_name, status) VALUES ('wh_id_1','Bekasi Warehouse','ID','印度尼西亚','active')");
}

let AUTH_TOKEN = null;
function seedAuth() {
  run("INSERT OR REPLACE INTO roles (id, name, permissions) VALUES ('role_imp','Importer','[\"inventory_import\"]')");
  run("INSERT OR REPLACE INTO users (id, username, name, role_id, status) VALUES ('u1','importer','Importer','role_imp','active')");
  AUTH_TOKEN = 'test-session-token-' + crypto.randomBytes(8).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(AUTH_TOKEN).digest('hex');
  run("INSERT OR REPLACE INTO sessions (id, token_hash, user_id, created_at, expires_at) VALUES ('s1', ?, 'u1', datetime('now'), '2099-12-31 23:59:59')",
    [tokenHash]);
}

// ============================================================================
// 辅助
// ============================================================================
function resetData() {
  const d = getDB();
  for (const t of ['inventory_delete_tombstones', 'inventory_imports', 'inventory', 'skus', 'sales_records',
                   'outbound_records', 'inventory_adjustments', 'inbound_records', 'inventory_checks',
                   'wac_history', 'operation_logs', 'batch_tasks']) {
    d.exec(`DELETE FROM ${t};`);
  }
  dropAllTriggers();
}

// 库存导入预检查要求 SKU 主数据存在且 brand 非空
function seedSku(sku, brand) {
  run('INSERT OR REPLACE INTO skus (sku_code, brand) VALUES (?, ?)', [sku, brand || 'Redragon']);
}

function dropAllTriggers() {
  const d = getDB();
  const rows = d.prepare("SELECT name FROM sqlite_master WHERE type='trigger'").all();
  for (const r of rows) d.exec(`DROP TRIGGER IF EXISTS ${r.name};`);
}

function count(table, where, params) {
  const sql = `SELECT COUNT(*) AS c FROM ${table}${where ? ' WHERE ' + where : ''}`;
  return Number(query(sql, params || []).rows[0].c);
}

function insertImport(sku, country, wh, date, qty, wac) {
  run(`INSERT INTO inventory_imports (id, import_date, country, warehouse, channel, sku_code, available_qty, weighted_avg_cost)
       VALUES (?, ?, ?, ?, '线上', ?, ?, ?)`,
      ['imp_' + Math.random().toString(36).slice(2, 10), date, country, wh, sku, qty, wac == null ? 0 : wac]);
}

function invRow(sku) {
  return queryOne('SELECT * FROM inventory WHERE sku_code=?', [sku]);
}

function tombRow(sku) {
  return queryOne('SELECT * FROM inventory_delete_tombstones WHERE sku_code=?', [sku]);
}

async function postJson(pathname, payload) {
  const server = app.listen(0);
  try {
    const port = server.address().port;
    const res = await fetch(`http://127.0.0.1:${port}${pathname}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': `session_token=${AUTH_TOKEN}` },
      body: JSON.stringify(payload)
    });
    const body = await res.json();
    return { status: res.status, body };
  } finally {
    await new Promise(r => server.close(r));
  }
}

const postBatchDelete = (ids, reason) => postJson('/api/inventory/batch-delete', { ids, reason: reason || '测试删除原因' });
const postBulkImport = (items, snapshotDate) =>
  postJson('/api/inventory-imports/bulk-import', { items, snapshot_cutoff_date: snapshotDate || '2026-09-04' });

createSchema();
seedAuth();

// ============================================================================
// L1：有旧 inventory_imports / 无 tombstone / 无 inventory → refresh 正常建立
// ============================================================================
test('L1) 旧导入 + 无 tombstone + 无 inventory → refresh 后 inventory 正常建立', async () => {
  resetData();
  insertImport('SKU-L1', '印度尼西亚', 'Bekasi Warehouse', '2026-07-06', 100, 50);
  assert.equal(count('inventory', 'sku_code=?', ['SKU-L1']), 0, '前置：inventory 应为空');

  await refreshInventoryTotals('');

  const row = invRow('SKU-L1');
  assert.ok(row, 'inventory 应被建立');
  assert.equal(Number(row.available_qty), 100);
  assert.equal(Number(row.weighted_avg_cost), 50);
});

// ============================================================================
// L2【核心】：有旧 inventory_imports / 有 tombstone / 无 inventory → refresh 后仍不存在
// ============================================================================
test('L2) 旧导入 + tombstone + 无 inventory → refresh 后 inventory 仍不存在（不复活）', async () => {
  resetData();
  insertImport('SKU-L2', '印度尼西亚', 'Bekasi Warehouse', '2026-07-06', 100, 50);
  run(`INSERT INTO inventory_delete_tombstones (id, sku_code, country, warehouse, deleted_by, reason)
       VALUES ('tomb_L2', 'SKU-L2', '印度尼西亚', 'Bekasi Warehouse', 'u1', '测试')`);

  await refreshInventoryTotals('');
  assert.equal(count('inventory', 'sku_code=?', ['SKU-L2']), 0, '首次 refresh：不得复活');

  await refreshInventoryTotals('');
  assert.equal(count('inventory', 'sku_code=?', ['SKU-L2']), 0, '重复 refresh：仍不得复活（幂等）');

  // 历史导入记录必须原样保留
  assert.equal(count('inventory_imports', 'sku_code=?', ['SKU-L2']), 1, '历史导入记录必须保留');
});

// ============================================================================
// L3：tombstone + inventory + 无业务关联 → batch-delete 成功
// ============================================================================
test('L3) 无业务关联的库存 → batch-delete 成功：inventory 删除 + tombstone 存在 + success=1', async () => {
  resetData();
  insertImport('SKU-L3', '印度尼西亚', 'Bekasi Warehouse', '2026-07-06', 100, 50);
  await refreshInventoryTotals('');
  assert.equal(count('inventory', 'sku_code=?', ['SKU-L3']), 1, '前置：inventory 已建立');
  const invId = invRow('SKU-L3').id;

  const { status, body } = await postBatchDelete([invId]);

  assert.equal(status, 200);
  assert.equal(body.success, 1, 'success 应为 1');
  assert.equal(body.failed, 0);
  assert.equal(body.skipped, 0);
  assert.equal(count('inventory', 'sku_code=?', ['SKU-L3']), 0, 'inventory 应已删除');
  assert.equal(count('inventory_delete_tombstones', 'sku_code=?', ['SKU-L3']), 1, 'tombstone 应已写入');
  assert.equal(count('inventory_imports', 'sku_code=?', ['SKU-L3']), 1, '历史导入记录必须保留');
});

// ============================================================================
// L4：有 sales_records → 删除失败，inventory 保留，tombstone 不产生
// ============================================================================
test('L4) 有 sales_records → 删除失败：inventory 保留 + tombstone 不产生 + failed=1', async () => {
  resetData();
  insertImport('SKU-L4', '印度尼西亚', 'Bekasi Warehouse', '2026-07-06', 100, 50);
  await refreshInventoryTotals('');
  const invId = invRow('SKU-L4').id;
  run(`INSERT INTO sales_records (id, sku_code, country, quantity, order_date) VALUES ('s_L4','SKU-L4','印度尼西亚',5,'2026-08-01')`);

  const { status, body } = await postBatchDelete([invId]);

  assert.equal(status, 200);
  assert.equal(body.success, 0);
  assert.equal(body.failed, 1);
  assert.match(body.errors[0].reason, /销售明细/);
  assert.equal(count('inventory', 'sku_code=?', ['SKU-L4']), 1, 'inventory 必须保留');
  assert.equal(count('inventory_delete_tombstones', 'sku_code=?', ['SKU-L4']), 0, 'tombstone 不得产生');
});

// ============================================================================
// L5：sales_records 只有 sku + country，证明不会再查询不存在的 warehouse 列
// ============================================================================
test('L5) sales_records 无 warehouse 列 → 守卫不拼接 warehouse 条件，不产生 SQL 错误', async () => {
  resetData();
  // 生产真实结构：sales_records 没有 warehouse 列
  const cols = getDB().prepare('PRAGMA table_info(sales_records)').all().map(c => c.name);
  assert.ok(!cols.includes('warehouse'), '测试 schema 必须复现 sales_records 无 warehouse 列');

  insertImport('SKU-L5', '印度尼西亚', 'Bekasi Warehouse', '2026-07-06', 100, 50);
  await refreshInventoryTotals('');
  const invId = invRow('SKU-L5').id;
  // 销售记录同 sku+country 但不同 warehouse（本表无 warehouse 列，按保守口径应拦截）
  run(`INSERT INTO sales_records (id, sku_code, country, quantity, order_date) VALUES ('s_L5','SKU-L5','印度尼西亚',3,'2026-08-02')`);

  const { status, body } = await postBatchDelete([invId]);

  assert.equal(status, 200, '不得因 warehouse 列不存在而抛 500');
  assert.equal(body.failed, 1, '保守口径：同 sku+country 有销售即拦截');
  assert.match(body.errors[0].reason, /销售明细/);
  assert.equal(count('inventory', 'sku_code=?', ['SKU-L5']), 1, 'inventory 必须保留');
});

// ============================================================================
// L6：outbound / adjustment / inbound / inventory_checks 分别阻止删除
// ============================================================================
test('L6) outbound / adjustment / inbound / inventory_checks 各表分别阻止删除', async () => {
  const cases = [
    { table: 'outbound_records',      label: '出库记录' },
    { table: 'inventory_adjustments', label: '库存调整单' },
    { table: 'inbound_records',       label: '入库记录' },
    { table: 'inventory_checks',      label: '库存盘点' }
  ];
  for (const c of cases) {
    resetData();
    const sku = 'SKU-L6-' + c.table;
    insertImport(sku, '印度尼西亚', 'Bekasi Warehouse', '2026-07-06', 100, 50);
    await refreshInventoryTotals('');
    const invId = invRow(sku).id;
    run(`INSERT INTO ${c.table} (id, sku_code, country, warehouse) VALUES (?,?,?,?)`,
        ['x_' + c.table, sku, '印度尼西亚', 'Bekasi Warehouse']);

    const { status, body } = await postBatchDelete([invId]);

    assert.equal(status, 200, `${c.label}：不得 500`);
    assert.equal(body.failed, 1, `${c.label}：应被拦截`);
    assert.match(body.errors[0].reason, new RegExp(c.label), `${c.label}：拦截原因应指明该表`);
    assert.equal(count('inventory', 'sku_code=?', [sku]), 1, `${c.label}：inventory 必须保留`);
    assert.equal(count('inventory_delete_tombstones', 'sku_code=?', [sku]), 0, `${c.label}：tombstone 不得产生`);
  }
});

// ============================================================================
// L7【关键】：旧 import + tombstone + 无 inventory → 新导入 → 解除封禁并重建
// ============================================================================
test('L7) 旧导入 + tombstone + 无 inventory → 新合法导入 → 解除 tombstone + 用新值重建', async () => {
  resetData();
  const sku = 'SKU-L7';
  const country = '印度尼西亚';
  const wh = 'Bekasi Warehouse';
  seedSku(sku);
  insertImport(sku, country, wh, '2026-07-06', 100, 50);
  run(`INSERT INTO inventory_delete_tombstones (id, sku_code, country, warehouse, deleted_by, reason)
       VALUES ('tomb_L7', ?, ?, ?, 'u1', '测试')`, [sku, country, wh]);
  await refreshInventoryTotals('');
  assert.equal(count('inventory', 'sku_code=?', [sku]), 0, '前置：tombstone 生效，inventory 不存在');
  assert.equal(count('inventory_delete_tombstones', 'sku_code=?', [sku]), 1, '前置：tombstone 存在');

  // 一次新的合法库存导入：qty=42（新值），wac=77（新值）
  const { status, body } = await postBulkImport([{
    sku_code: sku, country, warehouse: wh, import_date: '2026-09-04',
    available_qty: 42, weighted_avg_cost: 77, remark: '重新导入'
  }]);

  assert.equal(status, 200, '新导入应成功：' + JSON.stringify(body));
  assert.equal(body.tombstones_lifted, 1, 'tombstone 应被解除（lifted=1）');
  assert.equal(count('inventory_imports', 'sku_code=?', [sku]), 2, '新导入记录应产生（累计 2 条历史）');
  assert.equal(count('inventory_delete_tombstones', 'sku_code=?', [sku]), 0, 'tombstone 应已解除');

  const row = invRow(sku);
  assert.ok(row, 'inventory 应重新建立');
  assert.equal(Number(row.available_qty), 42, 'qty 必须为新导入值，不是旧历史值 100');
  assert.equal(Number(row.weighted_avg_cost), 77, 'wac 必须为新导入值，不是旧历史值 50');

  await refreshInventoryTotals('');
  const after = invRow(sku);
  assert.equal(Number(after.available_qty), 42, '再次 refresh 后 qty 仍为新值');
  assert.equal(Number(after.weighted_avg_cost), 77, '再次 refresh 后 wac 仍为新值');
});

// ============================================================================
// L8：导入失败 → tombstone 不得被解除
// ============================================================================
test('L8a) 导入被预检查整批阻断 → 零写入 + tombstone 必须仍然存在', async () => {
  resetData();
  const sku = 'SKU-L8A';
  const country = '印度尼西亚';
  const wh = 'Bekasi Warehouse';
  seedSku(sku);
  insertImport(sku, country, wh, '2026-07-06', 100, 50);
  run(`INSERT INTO inventory_delete_tombstones (id, sku_code, country, warehouse, deleted_by, reason)
       VALUES ('tomb_L8A', ?, ?, ?, 'u1', '测试')`, [sku, country, wh]);

  // 第 2 条 import_date 为空 → 预检查阶段整批阻断（根本不进入 transaction）
  const { status, body } = await postBulkImport([
    { sku_code: sku, country, warehouse: wh, import_date: '2026-09-04', available_qty: 42, weighted_avg_cost: 77 },
    { sku_code: 'SKU-BAD', country, warehouse: wh, import_date: '', available_qty: 5, weighted_avg_cost: 1 }
  ]);

  assert.ok(body.blocked === true || status === 422, '非法批次应被阻断，实际：' + JSON.stringify(body));
  assert.equal(count('inventory_delete_tombstones', 'sku_code=?', [sku]), 1, 'tombstone 必须仍然存在');
  assert.equal(count('inventory_imports', 'sku_code=?', [sku]), 1, '不得产生新导入记录（零写入）');
  assert.equal(count('inventory', 'sku_code=?', [sku]), 0, 'inventory 不得被建立');
});

test('L8b) 单条 INSERT 在事务内失败 → 该条 tombstone 不得解除（lift 位于 INSERT 之后）', async () => {
  resetData();
  const sku = 'SKU-L8B';
  const country = '印度尼西亚';
  const wh = 'Bekasi Warehouse';
  seedSku(sku);
  insertImport(sku, country, wh, '2026-07-06', 100, 50);
  run(`INSERT INTO inventory_delete_tombstones (id, sku_code, country, warehouse, deleted_by, reason)
       VALUES ('tomb_L8B', ?, ?, ?, 'u1', '测试')`, [sku, country, wh]);

  // 注入：本条 INSERT 必定失败 → lift 语句（在其之后）不会执行
  getDB().exec(`
    CREATE TRIGGER fail_import_insert BEFORE INSERT ON inventory_imports
    WHEN NEW.sku_code = '${sku}' AND NEW.import_date = '2026-09-04'
    BEGIN SELECT RAISE(ABORT, 'simulated insert failure'); END;
  `);

  try {
    await postBulkImport([{ sku_code: sku, country, warehouse: wh, import_date: '2026-09-04', available_qty: 42, weighted_avg_cost: 77 }]);
  } catch (_) { /* 500 也可接受 */ }

  assert.equal(count('inventory_delete_tombstones', 'sku_code=?', [sku]), 1, 'INSERT 失败 → tombstone 必须保留');
  assert.equal(count('inventory_imports', 'sku_code=?', [sku]), 1, '不得留下新的导入记录');

  dropAllTriggers();
});

test('L8c) 导入已写入但 lift 失败 → 整批回滚，不留「有导入无解除」的不一致状态', async () => {
  resetData();
  const sku = 'SKU-L8C';
  const country = '印度尼西亚';
  const wh = 'Bekasi Warehouse';
  seedSku(sku);
  insertImport(sku, country, wh, '2026-07-06', 100, 50);
  run(`INSERT INTO inventory_delete_tombstones (id, sku_code, country, warehouse, deleted_by, reason)
       VALUES ('tomb_L8C', ?, ?, ?, 'u1', '测试')`, [sku, country, wh]);

  // 注入：lift（DELETE tombstone）必定失败
  getDB().exec(`
    CREATE TRIGGER fail_lift BEFORE DELETE ON inventory_delete_tombstones
    BEGIN SELECT RAISE(ABORT, 'simulated lift failure'); END;
  `);

  const { status } = await postBulkImport([{ sku_code: sku, country, warehouse: wh, import_date: '2026-09-04', available_qty: 42, weighted_avg_cost: 77 }]);

  assert.equal(status, 500, 'lift 失败必须整批回滚并返回 500，不得返回 created=1 的假成功');
  assert.equal(count('inventory_imports', 'sku_code=?', [sku]), 1, '导入记录必须被回滚（仍只有旧的那 1 条）');
  assert.equal(count('inventory_delete_tombstones', 'sku_code=?', [sku]), 1, 'tombstone 必须仍在');

  dropAllTriggers();
});

// ============================================================================
// L9：目标 inventory 不存在 → skipped
// ============================================================================
test('L9) 目标 inventory 不存在 → 归类为 skipped，不伪造 success', async () => {
  resetData();
  const { status, body } = await postBatchDelete(['inv_not_exist_001']);

  assert.equal(status, 200);
  assert.equal(body.success, 0, '不得伪造 success');
  assert.equal(body.skipped, 1, '应记 skipped');
  assert.equal(body.failed, 0);
  assert.match(body.errors[0].reason, /记录不存在/);
});

// ============================================================================
// L10：混合批次 — 可删 + 有业务关联 + 不存在
// ============================================================================
test('L10) 混合批次：可删 / 有业务关联 / 不存在 → success=1 failed=1 skipped=1', async () => {
  resetData();
  insertImport('SKU-OK', '印度尼西亚', 'Bekasi Warehouse', '2026-07-06', 10, 5);
  insertImport('SKU-BLK', '印度尼西亚', 'Bekasi Warehouse', '2026-07-06', 20, 5);
  await refreshInventoryTotals('');
  const okId = invRow('SKU-OK').id;
  const blkId = invRow('SKU-BLK').id;
  run(`INSERT INTO outbound_records (id, sku_code, country, warehouse) VALUES ('o1','SKU-BLK','印度尼西亚','Bekasi Warehouse')`);

  const { status, body } = await postBatchDelete([okId, blkId, 'inv_ghost_001']);

  assert.equal(status, 200);
  assert.equal(body.success, 1, 'SKU-OK 应删除成功');
  assert.equal(body.failed, 1, 'SKU-BLK 应被拦截');
  assert.equal(body.skipped, 1, '不存在的 id 应 skipped');
  assert.equal(count('inventory', 'sku_code=?', ['SKU-OK']), 0, '可删的必须删掉');
  assert.equal(count('inventory', 'sku_code=?', ['SKU-BLK']), 1, '被拦截的必须保留');
  assert.equal(count('inventory_delete_tombstones', 'sku_code=?', ['SKU-OK']), 1);
  assert.equal(count('inventory_delete_tombstones', 'sku_code=?', ['SKU-BLK']), 0);
});

// ============================================================================
// L11：tombstone 写入失败 → inventory 不得被删除
// ============================================================================
test('L11) tombstone 写入失败 → inventory 不得被删除（事务回滚）', async () => {
  resetData();
  insertImport('SKU-L11', '印度尼西亚', 'Bekasi Warehouse', '2026-07-06', 100, 50);
  await refreshInventoryTotals('');
  const invId = invRow('SKU-L11').id;

  // 注入：tombstone INSERT 必定失败
  getDB().exec(`
    CREATE TRIGGER fail_tomb_insert BEFORE INSERT ON inventory_delete_tombstones
    BEGIN SELECT RAISE(ABORT, 'simulated tombstone write failure'); END;
  `);

  const { status } = await postBatchDelete([invId]);

  assert.equal(status, 500, '应整体失败（500），不得静默部分成功');
  assert.equal(count('inventory', 'sku_code=?', ['SKU-L11']), 1, 'inventory 必须仍在（不得出现删了但没 tombstone）');
  assert.equal(count('inventory_delete_tombstones', 'sku_code=?', ['SKU-L11']), 0);

  dropAllTriggers();
});

// ============================================================================
// L12：DELETE inventory 成功后发生硬错误 → 整批 rollback
// ============================================================================
test('L12) 中途硬错误 → 整批 rollback：inventory 与 tombstone 均恢复事务前状态', async () => {
  resetData();
  insertImport('SKU-A', '印度尼西亚', 'Bekasi Warehouse', '2026-07-06', 10, 5);
  insertImport('SKU-B', '印度尼西亚', 'Bekasi Warehouse', '2026-07-06', 20, 5);
  await refreshInventoryTotals('');
  const idA = invRow('SKU-A').id;
  const idB = invRow('SKU-B').id;

  // 注入：删除 idB 时抛错（模拟第 2 条处理中的硬错误）
  getDB().exec(`
    CREATE TRIGGER fail_second_delete BEFORE DELETE ON inventory
    WHEN OLD.id = '${idB}'
    BEGIN SELECT RAISE(ABORT, 'simulated hard error on second delete'); END;
  `);

  const { status } = await postBatchDelete([idA, idB]);

  assert.equal(status, 500, '应整体失败（500）');
  assert.equal(count('inventory', 'sku_code=?', ['SKU-A']), 1, 'SKU-A 必须回滚恢复');
  assert.equal(count('inventory', 'sku_code=?', ['SKU-B']), 1, 'SKU-B 必须仍在');
  assert.equal(count('inventory_delete_tombstones', 'sku_code=?', ['SKU-A']), 0, 'SKU-A 的 tombstone 必须回滚');
  assert.equal(count('inventory_delete_tombstones'), 0, '不得残留任何 tombstone');

  dropAllTriggers();
});

// ============================================================================
// L13：batch task 计数与 API 返回完全一致
// ============================================================================
test('L13) batch_tasks 的 success/failed/skipped 与 API 返回一致，is_rollbackable=0', async () => {
  resetData();
  insertImport('SKU-T1', '印度尼西亚', 'Bekasi Warehouse', '2026-07-06', 10, 5);
  insertImport('SKU-T2', '印度尼西亚', 'Bekasi Warehouse', '2026-07-06', 20, 5);
  await refreshInventoryTotals('');
  const id1 = invRow('SKU-T1').id;
  const id2 = invRow('SKU-T2').id;
  run(`INSERT INTO outbound_records (id, sku_code, country, warehouse) VALUES ('o2','SKU-T2','印度尼西亚','Bekasi Warehouse')`);

  const { status, body } = await postBatchDelete([id1, id2, 'inv_ghost']);

  assert.equal(status, 200);
  assert.deepEqual(
    { s: body.success, f: body.failed, k: body.skipped },
    { s: 1, f: 1, k: 1 }
  );
  assert.ok(body.task_id, '应返回 task_id');

  const task = queryOne('SELECT * FROM batch_tasks WHERE id=?', [body.task_id]);
  assert.ok(task, 'batch_tasks 应有对应记录');
  assert.equal(Number(task.total_count), 3);
  assert.equal(Number(task.success_count), 1);
  assert.equal(Number(task.failed_count), 1);
  assert.equal(Number(task.skipped_count), 1);
  assert.equal(Number(task.is_rollbackable), 0, '删除不可逆 → is_rollbackable=0');
  assert.equal(task.status, 'completed');
  assert.equal(task.page, 'inventory');
  assert.equal(task.operation_type, 'delete');
});

// ============================================================================
// FIRST-DEPLOY 门禁（§12）：全新数据库 → 建表必须先于 refreshInventoryTotals
// ============================================================================
test('FIRST-DEPLOY) 全新 DB：initDatabase 建表 → refreshInventoryTotals 不报 no such table', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'invsd-'));
  const dbFile = path.join(tmpDir, 'fresh.db');
  const dbPath = path.join(ROOT, 'db.js');
  const serverPath = path.join(ROOT, 'server.js');

  const script = `
    process.env.DB_DRIVER = 'sqlite';
    // node -e <script> <arg> 时 argv[1] 才是第一个参数（argv[0] 是 node 可执行文件）。
    // 必须断言 DB_PATH 确实被设置，否则会静默回落到项目默认 DB（污染本地开发库）。
    process.env.DB_PATH = process.argv[1];
    if (!process.env.DB_PATH) { console.error('FATAL: DB_PATH 未传入'); process.exit(9); }
    process.env.NODE_ENV = 'test';
    const Module = require('module');
    const fs = require('fs'); const path = require('path');
    const _orig = Module._resolveFilename;
    Module._resolveFilename = function (request, parent, isMain, options) {
      try { return _orig.call(this, request, parent, isMain, options); }
      catch (e) {
        if (typeof request === 'string' && (request.startsWith('./') || request.startsWith('../'))) {
          const base = path.resolve(path.dirname(parent ? parent.filename : '.'), request);
          try { fs.accessSync(base + '.cjs'); return base + '.cjs'; } catch (_) {}
        }
        throw e;
      }
    };
    const db = require(${JSON.stringify(dbPath)});
    db.initDatabase();
    const srv = require(${JSON.stringify(serverPath)});
    (async () => {
      const t = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='inventory_delete_tombstones'");
      if (!t.rows.length) { console.log('RESULT:FAIL_TABLE_MISSING'); process.exit(0); }
      try {
        await srv.refreshInventoryTotals('');
        console.log('RESULT:OK');
      } catch (e) {
        console.log('RESULT:FAIL_REFRESH:' + e.message);
      }
      process.exit(0);
    })();
  `;

  const out = execFileSync(process.execPath, ['-e', script, dbFile], { encoding: 'utf8', cwd: ROOT });
  fs.rmSync(tmpDir, { recursive: true, force: true });

  assert.match(out, /RESULT:OK/, '全新 DB 上 initDatabase + refreshInventoryTotals 必须成功。实际输出：' + out);
});

test('FIRST-DEPLOY) 反向证明：若 tombstone 表缺失，refreshInventoryTotals 确实会失败（说明启动顺序门禁必要）', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'invsd2-'));
  const dbFile = path.join(tmpDir, 'notable.db');
  const dbPath = path.join(ROOT, 'db.js');
  const serverPath = path.join(ROOT, 'server.js');

  const script = `
    process.env.DB_DRIVER = 'sqlite';
    // node -e <script> <arg> 时 argv[1] 才是第一个参数（argv[0] 是 node 可执行文件）。
    // 必须断言 DB_PATH 确实被设置，否则会静默回落到项目默认 DB（污染本地开发库）。
    process.env.DB_PATH = process.argv[1];
    if (!process.env.DB_PATH) { console.error('FATAL: DB_PATH 未传入'); process.exit(9); }
    process.env.NODE_ENV = 'test';
    const Module = require('module');
    const fs = require('fs'); const path = require('path');
    const _orig = Module._resolveFilename;
    Module._resolveFilename = function (request, parent, isMain, options) {
      try { return _orig.call(this, request, parent, isMain, options); }
      catch (e) {
        if (typeof request === 'string' && (request.startsWith('./') || request.startsWith('../'))) {
          const base = path.resolve(path.dirname(parent ? parent.filename : '.'), request);
          try { fs.accessSync(base + '.cjs'); return base + '.cjs'; } catch (_) {}
        }
        throw e;
      }
    };
    const db = require(${JSON.stringify(dbPath)});
    db.initDatabase();
    db.run('DROP TABLE IF EXISTS inventory_delete_tombstones');
    const srv = require(${JSON.stringify(serverPath)});
    (async () => {
      try { await srv.refreshInventoryTotals(''); console.log('RESULT:NO_ERROR'); }
      catch (e) { console.log('RESULT:ERROR:' + e.message); }
      process.exit(0);
    })();
  `;

  const out = execFileSync(process.execPath, ['-e', script, dbFile], { encoding: 'utf8', cwd: ROOT });
  fs.rmSync(tmpDir, { recursive: true, force: true });

  assert.match(out, /RESULT:ERROR/, '表缺失时 refreshInventoryTotals 必须报错，证明建表必须先于 refresh。实际输出：' + out);
});

test('FIRST-DEPLOY) 静态顺序门禁：server.js 启动块中 migration 调用位于 refreshInventoryTotals 之前', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const blockStart = src.indexOf('if (require.main === module) {');
  assert.notEqual(blockStart, -1, '未找到 require.main 启动块');

  const iInit = src.indexOf('initDatabase();', blockStart);
  const iMigr = src.indexOf('inventory-delete-tombstone', blockStart);
  // 用真实调用形态（含 .then(）定位，避免匹配到注释里出现的同名字符串
  const iRefresh = src.indexOf("refreshInventoryTotals('').then(", blockStart);
  const iNormalize = src.indexOf('normalizeImportDatesBackfill();', blockStart);

  assert.notEqual(iInit, -1, '启动块中应有 initDatabase()');
  assert.notEqual(iMigr, -1, '启动块中应有 tombstone migration 调用');
  assert.notEqual(iRefresh, -1, '启动块中应有 refreshInventoryTotals');
  assert.ok(iInit < iMigr, `initDatabase 必须先于 migration（init=${iInit}, migr=${iMigr}）`);
  assert.ok(iMigr < iNormalize, `migration 必须先于 normalizeImportDatesBackfill（migr=${iMigr}, norm=${iNormalize}）`);
  assert.ok(iMigr < iRefresh, `migration 必须先于 refreshInventoryTotals（migr=${iMigr}, refresh=${iRefresh}）`);

  // 失败必须 fail-fast，不得 catch 后继续
  const seg = src.slice(iMigr - 400, iRefresh);
  assert.match(seg, /process\.exit\(1\)/, 'migration 失败必须 process.exit(1) 阻止后续 refresh');
});

// ============================================================================
// L14 / L15 / L16：PostgreSQL 真机测试（需 PG_TEST_DSN）
// ============================================================================
const PG_DSN = process.env.PG_TEST_DSN || '';

test('L14) PG migration 首次执行成功建表', { skip: PG_DSN ? false : 'PG_TEST_DSN 未设置' }, async () => {
  const { Client } = require(path.join(ROOT, 'node_modules', 'pg'));
  const { CREATE_TABLE_SQL, ensureInventoryDeleteTombstoneTable } = require('../migrations/inventory-delete-tombstone');
  const c = new Client({ connectionString: PG_DSN, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    await c.query('DROP TABLE IF EXISTS inventory_delete_tombstones');
    await c.query(CREATE_TABLE_SQL);
    const r = await c.query(`SELECT to_regclass('public.inventory_delete_tombstones') AS t`);
    assert.ok(r.rows[0].t, '表应被创建');
    // migration 函数本身（isPg=true）也应可执行
    const calls = [];
    ensureInventoryDeleteTombstoneTable((sql) => { calls.push(sql); }, true);
    assert.equal(calls.length, 1, 'isPg=true 时应发出 1 条建表 SQL');
    assert.match(calls[0], /CREATE TABLE IF NOT EXISTS inventory_delete_tombstones/);
  } finally {
    await c.query('DROP TABLE IF EXISTS inventory_delete_tombstones');
    await c.end();
  }
});

test('L15) PG migration 重复执行幂等', { skip: PG_DSN ? false : 'PG_TEST_DSN 未设置' }, async () => {
  const { Client } = require(path.join(ROOT, 'node_modules', 'pg'));
  const { CREATE_TABLE_SQL } = require('../migrations/inventory-delete-tombstone');
  const c = new Client({ connectionString: PG_DSN, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    await c.query('DROP TABLE IF EXISTS inventory_delete_tombstones');
    await c.query(CREATE_TABLE_SQL);
    await c.query(CREATE_TABLE_SQL);
    await c.query(CREATE_TABLE_SQL);
    const r = await c.query(`SELECT to_regclass('public.inventory_delete_tombstones') AS t`);
    assert.ok(r.rows[0].t, '重复执行后表仍存在且不报错');
    // UNIQUE 约束只应存在一份（排除主键索引）
    const uq = await c.query(`SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename='inventory_delete_tombstones' AND indexname NOT LIKE '%_pkey'`);
    assert.equal(uq.rows.length, 1, '重复执行不得产生重复 UNIQUE 索引，实际：' + JSON.stringify(uq.rows));
    assert.match(uq.rows[0].indexname, /sku_code/, 'UNIQUE 索引应覆盖 sku_code');
  } finally {
    await c.query('DROP TABLE IF EXISTS inventory_delete_tombstones');
    await c.end();
  }
});

test('L16) SQLite / PG schema parity（列名、类型、默认值、NOT NULL、UNIQUE）', { skip: PG_DSN ? false : 'PG_TEST_DSN 未设置' }, async () => {
  const { Client } = require(path.join(ROOT, 'node_modules', 'pg'));
  const { CREATE_TABLE_SQL } = require('../migrations/inventory-delete-tombstone');

  // ── SQLite：用真实 db-sqlite.js 的 initDatabase 建表 ──
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'invsd-parity-'));
  const dbFile = path.join(tmpDir, 'parity.db');
  const script = `
    process.env.DB_DRIVER = 'sqlite';
    // node -e <script> <arg> 时 argv[1] 才是第一个参数（argv[0] 是 node 可执行文件）。
    // 必须断言 DB_PATH 确实被设置，否则会静默回落到项目默认 DB（污染本地开发库）。
    process.env.DB_PATH = process.argv[1];
    if (!process.env.DB_PATH) { console.error('FATAL: DB_PATH 未传入'); process.exit(9); }
    process.env.NODE_ENV = 'test';
    const db = require(${JSON.stringify(path.join(ROOT, 'db.js'))});
    db.initDatabase();
    const cols = db.getDB().prepare('PRAGMA table_info(inventory_delete_tombstones)').all();
    // SQLite 内联 UNIQUE 会生成自动索引（sqlite_master.sql 为 NULL），须用 PRAGMA index_list/index_info 探测
    const idxList = db.getDB().prepare("PRAGMA index_list(inventory_delete_tombstones)").all();
    const uniqIdx = idxList.find(r => Number(r.unique) === 1);
    const idxCols = uniqIdx ? db.getDB().prepare('PRAGMA index_info("' + uniqIdx.name + '")').all().map(c => c.name) : [];
    console.log(JSON.stringify({ cols, idxList, idxCols }));
  `;
  const raw = execFileSync(process.execPath, ['-e', script, dbFile], { encoding: 'utf8', cwd: ROOT });
  fs.rmSync(tmpDir, { recursive: true, force: true });
  const sq = JSON.parse(raw.trim().split('\n').pop());

  const sqCols = sq.cols.map(c => ({
    name: c.name, type: String(c.type).toUpperCase(), notnull: !!c.notnull, dflt: c.dflt_value
  }));

  // ── PG：真机建表后读 information_schema ──
  const c = new Client({ connectionString: PG_DSN, ssl: { rejectUnauthorized: false } });
  await c.connect();
  let pgCols;
  try {
    await c.query('DROP TABLE IF EXISTS inventory_delete_tombstones');
    await c.query(CREATE_TABLE_SQL);
    const r = await c.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema='public' AND table_name='inventory_delete_tombstones'
      ORDER BY ordinal_position`);
    pgCols = r.rows.map(x => ({
      name: x.column_name, type: String(x.data_type).toUpperCase(), notnull: x.is_nullable === 'NO', dflt: x.column_default
    }));
  } finally {
    await c.query('DROP TABLE IF EXISTS inventory_delete_tombstones');
    await c.end();
  }

  // 列名集合与顺序必须一致
  assert.deepEqual(pgCols.map(x => x.name), sqCols.map(x => x.name), '列名与顺序必须一致');

  // 类型映射：TEXT ⇄ text
  for (let i = 0; i < pgCols.length; i++) {
    assert.equal(pgCols[i].type, 'TEXT', `PG 列 ${pgCols[i].name} 应为 text，实际 ${pgCols[i].type}`);
    assert.equal(sqCols[i].type, 'TEXT', `SQLite 列 ${sqCols[i].name} 应为 TEXT，实际 ${sqCols[i].type}`);
  }

  // NOT NULL 语义一致（仅 sku_code / country / warehouse 为 NOT NULL）
  for (let i = 0; i < pgCols.length; i++) {
    assert.equal(pgCols[i].notnull, sqCols[i].notnull,
      `NOT NULL 语义不一致：${pgCols[i].name} PG=${pgCols[i].notnull} SQLite=${sqCols[i].notnull}`);
  }

  // 默认值：PG NOW() ⇄ SQLite (datetime('now'))，其余必须逐字一致
  for (let i = 0; i < pgCols.length; i++) {
    const p = pgCols[i].dflt == null ? null : String(pgCols[i].dflt);
    const s = sqCols[i].dflt == null ? null : String(sqCols[i].dflt);
    const nm = pgCols[i].name;
    if (nm === 'id') {
      // 主键由应用层 genId() 生成，两端均不应有默认值（NULL）
      assert.equal(p, null, `PG ${nm} 不应有默认值，实际 ${p}`);
      assert.equal(s, null, `SQLite ${nm} 不应有默认值，实际 ${s}`);
    } else if (['deleted_at', 'created_at'].includes(nm)) {
      assert.match(p, /^NOW\(\)/i, `PG ${nm} 默认应为 NOW()，实际 ${p}`);
      assert.match(s, /datetime\('now'\)/i, `SQLite ${nm} 默认应为 (datetime('now'))，实际 ${s}`);
    } else {
      // PG 将 text 默认值显示为 ''::text，SQLite 显示为 ''；剥离 ::text 类型标注后语义等价
      const pNorm = p == null ? null : String(p).replace(/::text$/i, '');
      assert.equal(pNorm, s, `默认值不一致：${nm} PG=${p} SQLite=${s}`);
      // 空字符串语义：非时间列默认为 ''，不得为 NULL
      assert.equal(pNorm, "''", `PG ${nm} 默认值应为 ''（剥离 ::text 后），实际 ${p}`);
    }
  }

  // UNIQUE (sku_code, country, warehouse) 两端都存在
  const idxList = sq.idxList || [];
  const idxCols = sq.idxCols || [];
  const uniqIdx = idxList.find(r => Number(r.unique) === 1);
  assert.ok(uniqIdx, 'SQLite 应有 UNIQUE 约束（index_list 含 unique=1）');
  assert.deepEqual(idxCols.slice().sort(), ['country', 'sku_code', 'warehouse'].sort(),
    'SQLite UNIQUE 应覆盖 sku_code/country/warehouse，实际：' + JSON.stringify(idxCols));
  assert.match(CREATE_TABLE_SQL, /UNIQUE \(sku_code, country, warehouse\)/i, 'PG DDL 应含 UNIQUE');
});
