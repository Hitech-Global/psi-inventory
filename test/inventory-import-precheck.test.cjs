'use strict';

/**
 * 库存导入预检查（INV-IMPORT-PRECHECK-01）回归测试
 *
 * 核心原则：SKU 主数据（skus 表）是 SKU 与品牌的唯一权威来源，
 * 库存导入不负责补 SKU 主数据；Excel 品牌仅用于与 skus.brand 一致性校验，绝不回写。
 *
 * 覆盖 6 个场景：
 *   1) SKU 不存在于 skus → 整批阻断
 *   2) SKU 存在但主数据品牌为空 → 整批阻断
 *   3) Excel 品牌与 SKU 主数据品牌不一致 → 整批阻断（严格逐字符一致：区分大小写与首尾空格，REDRAGON != Redragon）
 *   4) Excel 无品牌但主数据有品牌 → 允许（品牌权威来源是 SKU 主数据）
 *   5) 全部合法 → 预检查通过，且真实路由实际写入 inventory_imports
 *   6) 校验失败时 → 真实路由整批拒绝（422），数据库零写入（无部分写入）
 *
 * 设计说明：
 *   · 场景 1-5 直接调用导出函数 validateInventoryImportRows（纯只读、确定性）。
 *   · 场景 5b / 6 通过真实 HTTP 路由 /api/inventory-imports/bulk-import 驱动，
 *     验证「闸门在 transaction 之前」这一契约：通过则写库，阻断则零写入。
 *   · NODE_ENV=test → CSRF 防护自动绕过，便于测试驱动真实路由。
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

process.env.DB_DRIVER = 'sqlite';
process.env.DB_PATH = ':memory:';
process.env.NODE_ENV = 'test'; // 关闭 CSRF 防护，便于测试驱动真实路由

// ── 测试专用模块解析钩子（不影响生产代码）──────────────────────────────
// 本地 WIP 将 rp-projection.js 重命名为 rp-projection.cjs，但 server.js 仍以
// extensionless 方式 require('./rp-projection')，导致在本 checkout 下任何 require
// server.js 的测试都无法加载。此钩子仅在「默认解析失败」时回退尝试 .cjs，
// 不改动任何项目文件，仅作用于本测试进程。
const Module = require('module');
const fs = require('fs');
const _origResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  try {
    return _origResolveFilename.call(this, request, parent, isMain, options);
  } catch (e) {
    if (typeof request === 'string' && (request.startsWith('./') || request.startsWith('../'))) {
      const base = require('path').resolve(require('path').dirname(parent ? parent.filename : '.'), request);
      const cjsPath = base + '.cjs';
      try { fs.accessSync(cjsPath); return cjsPath; } catch (_) { /* ignore */ }
    }
    throw e;
  }
};

const dbMod = require('../db');
const { query, run, getDB } = dbMod;
const { app, validateInventoryImportRows } = require('../server');

// ===== 最小 schema（仅覆盖预检查 + 真实导入路由所需表） =====
function createSchema() {
  const d = getDB();
  d.exec('PRAGMA foreign_keys=OFF;');
  d.exec(`
    DROP TABLE IF EXISTS inventory_imports;
    DROP TABLE IF EXISTS inventory;
    DROP TABLE IF EXISTS skus;
    DROP TABLE IF EXISTS roles;
    DROP TABLE IF EXISTS users;
    DROP TABLE IF EXISTS sessions;
    DROP TABLE IF EXISTS wac_history;
    DROP TABLE IF EXISTS role_data_scope;
    DROP TABLE IF EXISTS user_data_scope;
    DROP TABLE IF EXISTS warehouses;
    DROP TABLE IF EXISTS inventory_delete_tombstones;
  `);
  d.exec(`
    CREATE TABLE skus (
      sku_code TEXT PRIMARY KEY,
      brand TEXT DEFAULT ''
    );
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
    CREATE TABLE role_data_scope (
      role_id TEXT PRIMARY KEY,
      countries TEXT DEFAULT '[]',
      brands TEXT DEFAULT '[]',
      warehouses TEXT DEFAULT '[]'
    );
    CREATE TABLE user_data_scope (
      user_id TEXT PRIMARY KEY,
      countries TEXT DEFAULT '[]',
      brands TEXT DEFAULT '[]',
      warehouses TEXT DEFAULT '[]'
    );
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
    -- 与生产 db-sqlite.js:625 同构（bulk-import 合法路径的 tombstone lift 需要；缺失会导致整批回滚）
    CREATE TABLE inventory_delete_tombstones (
      id TEXT PRIMARY KEY NOT NULL,
      sku_code TEXT NOT NULL DEFAULT '',
      country TEXT NOT NULL DEFAULT '',
      warehouse TEXT NOT NULL DEFAULT '',
      deleted_at TEXT DEFAULT (datetime('now')),
      deleted_by TEXT DEFAULT '',
      reason TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE (sku_code, country, warehouse)
    );
  `);
  d.exec('PRAGMA foreign_keys=ON;');
}

// ===== 仓库主数据种子（INV-IMPORT-WAREHOUSE-01 校验来源）=====
// 维度 = country_name + name + status='active'。仅 active 参与匹配；inactive 视为不存在。
const WH_SEED = [
  { id: 'w1', name: 'Bekasi Warehouse', country_name: '印度尼西亚', status: 'active' },
  { id: 'w2', name: 'Jakarta Warehouse', country_name: '印度尼西亚', status: 'active' },
  { id: 'w3', name: 'KL Hub',           country_name: '马来西亚',   status: 'active' },
  { id: 'w4', name: 'Old WH',           country_name: '印度尼西亚', status: 'inactive' }
];
function seedWarehouses() {
  getDB().exec('DELETE FROM warehouses;');
  WH_SEED.forEach(w => run(
    'INSERT INTO warehouses (id, name, country_id, country_name, warehouse_type, address, status, brands, sort_order) VALUES (?,?,?,?,?,?,?,?,?)',
    [w.id, w.name, 'CN', w.country_name, 'self', '', w.status, '', 0]));
}
// 合法仓库（供既有场景补齐 country/warehouse，使它们仍通过仓库校验、只验证各自目标字段）
const VW = { country: '印度尼西亚', warehouse: 'Bekasi Warehouse' };
// 仅当行缺少 country/warehouse 时注入合法仓库，避免覆盖新仓库场景里显式给出的错误值
function withValidWh(items) {
  return (items || []).map(it => {
    const hasC = it && (it.country || '') !== '';
    const hasW = it && (it.warehouse || '') !== '';
    return (hasC && hasW) ? it : Object.assign({}, VW, it);
  });
}

// ===== 鉴权种子（用于驱动真实路由：bulk-import 需要 inventory_import 权限） =====
let AUTH_TOKEN = null;
function seedAuth() {
  run("INSERT INTO roles (id, name, permissions) VALUES ('role_imp','Importer','[\"inventory_import\"]')");
  run("INSERT INTO users (id, username, name, role_id, status) VALUES ('u1','importer','Importer','role_imp','active')");
  AUTH_TOKEN = 'test-session-token-' + crypto.randomBytes(8).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(AUTH_TOKEN).digest('hex');
  run("INSERT INTO sessions (id, token_hash, user_id, created_at, expires_at) VALUES ('s1', ?, 'u1', datetime('now'), '2099-12-31 23:59:59')",
    [tokenHash]);
}

function resetSkus() {
  getDB().exec('DELETE FROM skus;');
}

// 驱动真实 bulk-import 路由（绕过 CSRF 后，仅受 session 鉴权约束）
async function postBulkImport(items, snapshotDate) {
  const server = app.listen(0);
  try {
    const port = server.address().port;
    const res = await fetch(`http://127.0.0.1:${port}/api/inventory-imports/bulk-import`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `session_token=${AUTH_TOKEN}`
      },
      body: JSON.stringify({ items: withValidWh(items), snapshot_cutoff_date: snapshotDate || '2026-07-05' })
    });
    const body = await res.json();
    return { status: res.status, body };
  } finally {
    await new Promise(r => server.close(r));
  }
}

function count(table) {
  return query(`SELECT COUNT(*) AS c FROM ${table}`).rows[0].c;
}

createSchema();
seedWarehouses();
seedAuth();

// ==================== 场景 1：SKU 不存在 → 整批阻断 ====================
test('1) SKU 不存在于 skus 主数据 → 整批阻断', () => {
  resetSkus();
  run("INSERT INTO skus (sku_code, brand) VALUES ('SKU-A','Redragon')");
  const items = [
    { sku_code: 'SKU-UNKNOWN', import_date: '2026-07-05', brand: 'Redragon', available_qty: 10, weighted_avg_cost: 80, _row_num: 3 }
  ];
  const r = validateInventoryImportRows(withValidWh(items));
  assert.equal(r.ok, false, '应整批阻断');
  assert.equal(r.blocking_count, 1, '应恰好 1 个阻断项');
  const b = r.blocking[0];
  assert.equal(b.issue_type, 'SKU_MASTER_MISSING');
  assert.equal(b.sku_code, 'SKU-UNKNOWN', '应报告缺失的 SKU');
  assert.equal(b.row, 3, '应回传 Excel 行号');
});

// ==================== 场景 2：SKU 主数据品牌为空 → 整批阻断 ====================
test('2) SKU 主数据品牌为空 → 整批阻断', () => {
  resetSkus();
  run("INSERT INTO skus (sku_code, brand) VALUES ('SKU-A','')"); // 品牌为空串
  const items = [
    { sku_code: 'SKU-A', import_date: '2026-07-05', brand: 'Redragon', available_qty: 10, weighted_avg_cost: 80, _row_num: 5 }
  ];
  const r = validateInventoryImportRows(withValidWh(items));
  assert.equal(r.ok, false);
  assert.equal(r.blocking.length, 1);
  assert.equal(r.blocking[0].issue_type, 'SKU_BRAND_EMPTY');
  assert.equal(r.blocking[0].sku_code, 'SKU-A');
});

// ==================== 场景 3：Excel 品牌 ≠ 主数据品牌 → 整批阻断（含大小写不敏感） ====================
test('3) Excel 品牌与 SKU 主数据品牌不一致 → 整批阻断', () => {
  resetSkus();
  run("INSERT INTO skus (sku_code, brand) VALUES ('SKU-A','Redragon')");
  const items = [
    { sku_code: 'SKU-A', import_date: '2026-07-05', brand: 'Logitech', available_qty: 10, weighted_avg_cost: 80, _row_num: 7 }
  ];
  const r = validateInventoryImportRows(withValidWh(items));
  assert.equal(r.ok, false);
  const b = r.blocking[0];
  assert.equal(b.issue_type, 'BRAND_MISMATCH');
  assert.equal(b.excel_brand, 'Logitech');
  assert.equal(b.master_brand, 'Redragon');
});

test('3b) 严格品牌：REDRAGON 与 Redragon 视为不一致 → 阻断（区分大小写）', () => {
  resetSkus();
  run("INSERT INTO skus (sku_code, brand) VALUES ('SKU-A','Redragon')");
  const items = [
    { sku_code: 'SKU-A', import_date: '2026-07-05', brand: 'REDRAGON', available_qty: 10, weighted_avg_cost: 80, _row_num: 2 }
  ];
  const r = validateInventoryImportRows(withValidWh(items));
  assert.equal(r.ok, false, '大小写差异必须阻断');
  assert.equal(r.blocking[0].issue_type, 'BRAND_MISMATCH');
  assert.equal(r.blocking[0].excel_brand, 'REDRAGON');
  assert.equal(r.blocking[0].master_brand, 'Redragon');
});

// ==================== 场景 4：Excel 无品牌 + 主数据有品牌 → 允许 ====================
test('4) Excel 无品牌但主数据有品牌 → 允许（品牌权威来源是 SKU 主数据）', () => {
  resetSkus();
  run("INSERT INTO skus (sku_code, brand) VALUES ('SKU-A','Redragon')");
  const items = [
    { sku_code: 'SKU-A', import_date: '2026-07-05', brand: '', available_qty: 10, weighted_avg_cost: 80, _row_num: 2 }
  ];
  const r = validateInventoryImportRows(withValidWh(items));
  assert.equal(r.ok, true, '无 Excel 品牌时应通过（品牌以主数据为准）');
  assert.equal(r.blocking_count, 0);
});

// ==================== 场景 5：全部合法 → 预检查通过 ====================
test('5) 全部合法（SKU 在册 + 品牌一致 + 数量/成本合法）→ 预检查通过', () => {
  resetSkus();
  run("INSERT INTO skus (sku_code, brand) VALUES ('SKU-A','Redragon'), ('SKU-B','Logitech')");
  const items = [
    { sku_code: 'SKU-A', import_date: '2026-07-05', brand: 'Redragon', available_qty: 10, weighted_avg_cost: 80, _row_num: 2 },
    { sku_code: 'SKU-B', import_date: '2026-07-05', brand: 'Logitech', available_qty: 5, weighted_avg_cost: 90, _row_num: 3 }
  ];
  const r = validateInventoryImportRows(withValidWh(items));
  assert.equal(r.ok, true, '全部合法应放行');
  assert.equal(r.total_rows, 2);
  assert.equal(r.blocking_count, 0);
});

// ==================== 场景 5b：真实路由 + 全部合法 → 实际写入 ====================
test('5b) 真实路由：全部合法 → 预检查通过并实际写入 inventory_imports（1 行）', async () => {
  getDB().exec('DELETE FROM skus; DELETE FROM inventory_imports; DELETE FROM inventory;');
  run("INSERT INTO skus (sku_code, brand) VALUES ('SKU-A','Redragon')");
  const items = [
    // 合法仓库（INV-IMPORT-WAREHOUSE-01 生效后，合法导入必须使用 warehouses 主数据中的 active 仓库）
    { sku_code: 'SKU-A', import_date: '2026-07-05', country: '印度尼西亚', warehouse: 'Bekasi Warehouse', brand: 'Redragon', available_qty: 10, weighted_avg_cost: 80, _row_num: 2 }
  ];
  const before = count('inventory_imports');
  const { status, body } = await postBulkImport(items, '2026-07-05');
  // 全部合法不应被阻断
  assert.ok(!(status === 422 && body.blocked === true), '全部合法不应返回 422 阻断');
  // 合法导入应真正写入 inventory_imports
  const after = count('inventory_imports');
  assert.equal(after, before + 1, '合法导入应写入 1 行 inventory_imports');
});

// ==================== 场景 6：校验失败 → 整批拒绝 + 数据库零写入 ====================
test('6) 真实路由：含阻断行的批次整批拒绝（422），数据库零写入（无部分写入）', async () => {
  getDB().exec('DELETE FROM skus; DELETE FROM inventory_imports; DELETE FROM inventory;');
  run("INSERT INTO skus (sku_code, brand) VALUES ('SKU-A','Redragon')"); // 仅 SKU-A 合法
  // 批次混合：1 行合法(SKU-A) + 1 行 SKU 不存在(SKU-UNKNOWN)
  const items = [
    { sku_code: 'SKU-A', import_date: '2026-07-05', brand: 'Redragon', available_qty: 10, weighted_avg_cost: 80, _row_num: 2 },
    { sku_code: 'SKU-UNKNOWN', import_date: '2026-07-05', brand: 'Logitech', available_qty: 5, weighted_avg_cost: 90, _row_num: 3 }
  ];
  const beforeImp = count('inventory_imports');
  const beforeInv = count('inventory');
  const { status, body } = await postBulkImport(items, '2026-07-05');
  assert.equal(status, 422, '应返回 422 整批阻断');
  assert.equal(body.blocked, true);
  assert.ok(body.failed >= 1, '应报告至少 1 个阻断项');
  // 关键不变量：即便批次中存在合法行，也不应产生任何写入（整批语义，禁止部分写入）
  const afterImp = count('inventory_imports');
  const afterInv = count('inventory');
  assert.equal(afterImp, beforeImp, 'inventory_imports 不应产生任何写入');
  assert.equal(afterInv, beforeInv, 'inventory 不应产生任何写入');
});

// ==================== 场景 3c：品牌首尾空格 / 大小写 → 严格比较，禁止 trim ====================
test('3c) 严格品牌：Excel 品牌含首尾空格（" Redragon "）与主数据 "Redragon" 不一致 → 阻断（禁止 trim）', () => {
  resetSkus();
  run("INSERT INTO skus (sku_code, brand) VALUES ('SKU-A','Redragon')");
  const items = [
    { sku_code: 'SKU-A', import_date: '2026-07-05', brand: ' Redragon ', available_qty: 10, weighted_avg_cost: 80, _row_num: 2 }
  ];
  const r = validateInventoryImportRows(withValidWh(items));
  assert.equal(r.ok, false, '首尾空格差异必须阻断（禁止提前 trim）');
  assert.equal(r.blocking[0].issue_type, 'BRAND_MISMATCH');
  assert.equal(r.blocking[0].excel_brand, ' Redragon ');
});

// ==================== 场景 3d：品牌严格比较矩阵（逐字符 ===）================
test('3d) 品牌严格比较矩阵：仅完全一致放行，大小写 / 首尾空格 / 内部空格 / 纯空格均阻断，真空允许', () => {
  resetSkus();
  run("INSERT INTO skus (sku_code, brand) VALUES ('SKU-A','Redragon')");
  const cases = [
    { brand: 'Redragon', expect: 'pass' },   // 1 完全一致
    { brand: 'REDRAGON', expect: 'block' },  // 2 全大写
    { brand: 'redragon', expect: 'block' },  // 3 全小写
    { brand: ' Redragon', expect: 'block' }, // 4 前导空格
    { brand: 'Redragon ', expect: 'block' },  // 5 尾部空格
    { brand: ' Redragon ', expect: 'block' }, // 6 前后空格
    { brand: 'Red Dragon', expect: 'block' }, // 7 内部空格
    { brand: '   ', expect: 'block' },        // 8 纯空格（已填写，非“空”）
    { brand: '', expect: 'pass' }             // 9 真正空（允许，品牌以主数据为准）
  ];
  cases.forEach(function (c) {
    const items = [{ sku_code: 'SKU-A', import_date: '2026-07-05', brand: c.brand, available_qty: 10, weighted_avg_cost: 80, _row_num: 2 }];
    const r = validateInventoryImportRows(withValidWh(items));
    if (c.expect === 'pass') {
      assert.equal(r.ok, true, '品牌 ' + JSON.stringify(c.brand) + ' 应放行');
      assert.equal(r.blocking_count, 0);
    } else {
      assert.equal(r.ok, false, '品牌 ' + JSON.stringify(c.brand) + ' 应阻断');
      assert.equal(r.blocking[0].issue_type, 'BRAND_MISMATCH', '品牌 ' + JSON.stringify(c.brand) + ' 应为 BRAND_MISMATCH');
    }
  });
});

// ==================== 场景 3e：大小写不一致经真实 bulk-import 闸门 → 422 零写入 ====================
test('3e) 后端闸门：Excel 品牌 REDRAGON（大小写不一致）直连 bulk-import → 422 零写入', async () => {
  seedSingleValidSku('Redragon');
  const items = [{ sku_code: 'SKU-A', import_date: VALID_DATE, brand: 'REDRAGON', available_qty: VALID_QTY, weighted_avg_cost: VALID_WAC, _row_num: 2 }];
  const beforeImp = count('inventory_imports'), beforeInv = count('inventory');
  const { status, body } = await postBulkImport(items, VALID_DATE);
  assert.equal(status, 422, '大小写不一致应 422');
  assert.equal(body.blocking[0].issue_type, 'BRAND_MISMATCH');
  assert.equal(count('inventory_imports'), beforeImp, '闸门先于 write，零写入 inventory_imports');
  assert.equal(count('inventory'), beforeInv, '零写入 inventory');
});

// ==================== 场景 3f：Excel 品牌为空 + 主数据有品牌 → 真实路由允许写入 ====================
test('3f) 后端闸门：Excel 品牌为空 + 主数据有品牌 → 200 允许写入（品牌以主数据为准）', async () => {
  seedSingleValidSku('Redragon');
  const items = [{ sku_code: 'SKU-A', import_date: VALID_DATE, brand: '', available_qty: VALID_QTY, weighted_avg_cost: VALID_WAC, _row_num: 2 }];
  const beforeImp = count('inventory_imports');
  const { status, body } = await postBulkImport(items, VALID_DATE);
  assert.ok(!(status === 422 && body.blocked === true), '空品牌不应被阻断');
  assert.equal(count('inventory_imports'), beforeImp + 1, '空品牌应正常写入 1 行');
});

// ===== 以下场景全部通过真实 bulk-import 路由驱动（绕过 /precheck 直连写入闸门）=====
// 目的：证明所有阻断校验都存在于后端最终写入闸门，而非仅前端；
// 任一行存在阻断问题 → HTTP 422 + inventory_imports 零新增 + inventory 零变化 + 不执行 refreshInventoryTotals。

// 工具：写入一个品牌合法、在册的 SKU，使「唯一变量」就是被验证的字段
function seedSingleValidSku(brand) {
  getDB().exec('DELETE FROM skus; DELETE FROM inventory_imports; DELETE FROM inventory;');
  run("INSERT INTO skus (sku_code, brand) VALUES ('SKU-A', ?)", [brand]);
}

const VALID_QTY = 10, VALID_WAC = 80, VALID_DATE = '2026-07-05';

// 场景 7：SKU 为空 → 422，整批零写入
test('7) 后端闸门：SKU 为空 → 422，整批零写入', async () => {
  seedSingleValidSku('Redragon');
  const items = [{ sku_code: '', import_date: VALID_DATE, brand: '', available_qty: VALID_QTY, weighted_avg_cost: VALID_WAC, _row_num: 2 }];
  const beforeImp = count('inventory_imports'), beforeInv = count('inventory');
  const { status, body } = await postBulkImport(items, VALID_DATE);
  assert.equal(status, 422, 'SKU 为空应 422');
  assert.equal(body.blocked, true);
  assert.equal(body.blocking[0].issue_type, 'SKU_EMPTY');
  assert.equal(count('inventory_imports'), beforeImp, '零写入 inventory_imports');
  assert.equal(count('inventory'), beforeInv, '零写入 inventory');
});

// 场景 8：available_qty 非数字（字符串）→ 422，整批零写入
test('8) 后端闸门：available_qty 非数字 → 422，整批零写入', async () => {
  seedSingleValidSku('Redragon');
  const items = [{ sku_code: 'SKU-A', import_date: VALID_DATE, brand: 'Redragon', available_qty: 'abc', weighted_avg_cost: VALID_WAC, _row_num: 2 }];
  const beforeImp = count('inventory_imports'), beforeInv = count('inventory');
  const { status, body } = await postBulkImport(items, VALID_DATE);
  assert.equal(status, 422, '数量非数字应 422');
  assert.equal(body.blocking[0].issue_type, 'QTY_INVALID');
  assert.equal(count('inventory_imports'), beforeImp);
  assert.equal(count('inventory'), beforeInv);
});

// 场景 9：available_qty 为负数 → 422，整批零写入
test('9) 后端闸门：available_qty 为负数 → 422，整批零写入', async () => {
  seedSingleValidSku('Redragon');
  const items = [{ sku_code: 'SKU-A', import_date: VALID_DATE, brand: 'Redragon', available_qty: -5, weighted_avg_cost: VALID_WAC, _row_num: 2 }];
  const beforeImp = count('inventory_imports'), beforeInv = count('inventory');
  const { status, body } = await postBulkImport(items, VALID_DATE);
  assert.equal(status, 422, '数量为负应 422');
  assert.equal(body.blocking[0].issue_type, 'QTY_INVALID');
  assert.equal(count('inventory_imports'), beforeImp);
  assert.equal(count('inventory'), beforeInv);
});

// 场景 10：available_qty 为小数（非整数）→ 422，整批零写入
test('10) 后端闸门：available_qty 为小数（非整数）→ 422，整批零写入', async () => {
  seedSingleValidSku('Redragon');
  const items = [{ sku_code: 'SKU-A', import_date: VALID_DATE, brand: 'Redragon', available_qty: 10.5, weighted_avg_cost: VALID_WAC, _row_num: 2 }];
  const beforeImp = count('inventory_imports'), beforeInv = count('inventory');
  const { status, body } = await postBulkImport(items, VALID_DATE);
  assert.equal(status, 422, '数量为小数应 422（业务口径：严格非负整数）');
  assert.equal(body.blocking[0].issue_type, 'QTY_INVALID');
  assert.equal(count('inventory_imports'), beforeImp);
  assert.equal(count('inventory'), beforeInv);
});

// 场景 11：weighted_avg_cost 非数字（字符串）→ 422，整批零写入
test('11) 后端闸门：weighted_avg_cost 非数字 → 422，整批零写入', async () => {
  seedSingleValidSku('Redragon');
  const items = [{ sku_code: 'SKU-A', import_date: VALID_DATE, brand: 'Redragon', available_qty: VALID_QTY, weighted_avg_cost: 'abc', _row_num: 2 }];
  const beforeImp = count('inventory_imports'), beforeInv = count('inventory');
  const { status, body } = await postBulkImport(items, VALID_DATE);
  assert.equal(status, 422, '成本非数字应 422');
  assert.equal(body.blocking[0].issue_type, 'WAC_INVALID');
  assert.equal(count('inventory_imports'), beforeImp);
  assert.equal(count('inventory'), beforeInv);
});

// 场景 12：weighted_avg_cost 为负数 → 422，整批零写入
test('12) 后端闸门：weighted_avg_cost 为负数 → 422，整批零写入', async () => {
  seedSingleValidSku('Redragon');
  const items = [{ sku_code: 'SKU-A', import_date: VALID_DATE, brand: 'Redragon', available_qty: VALID_QTY, weighted_avg_cost: -3, _row_num: 2 }];
  const beforeImp = count('inventory_imports'), beforeInv = count('inventory');
  const { status, body } = await postBulkImport(items, VALID_DATE);
  assert.equal(status, 422, '成本为负应 422（业务口径：成本不为负）');
  assert.equal(body.blocking[0].issue_type, 'WAC_INVALID');
  assert.equal(count('inventory_imports'), beforeImp);
  assert.equal(count('inventory'), beforeInv);
});

// 场景 13：weighted_avg_cost 为空 → 允许（保留现有业务口径：空 = 不提供 → 0，不阻断）
test('13) 后端闸门：weighted_avg_cost 为空 → 允许写入（沿用原业务口径 empty→0，不阻断）', async () => {
  seedSingleValidSku('Redragon');
  const items = [{ sku_code: 'SKU-A', import_date: VALID_DATE, brand: 'Redragon', available_qty: VALID_QTY, weighted_avg_cost: '', _row_num: 2 }];
  const beforeImp = count('inventory_imports');
  const { status, body } = await postBulkImport(items, VALID_DATE);
  assert.ok(!(status === 422 && body.blocked === true), '空成本不应被阻断');
  assert.equal(count('inventory_imports'), beforeImp + 1, '空成本应正常写入 1 行');
  // 确认写入落库值：空成本按原业务规则归 0（与旧代码 parseFloat(x)||0 行为一致，未改变口径）
  const row = query("SELECT weighted_avg_cost FROM inventory_imports WHERE sku_code='SKU-A'").rows[0];
  assert.equal(Number(row.weighted_avg_cost), 0, '空成本落库应为 0（沿用原口径，不改变业务语义）');
});

// 场景 14：非法字符串成本经直接 bulk-import → 422 零写入，证明旧代码 parseFloat(x)||0 静默变 0 的路径已被闸门拦截
test('14) 后端闸门：非法字符串成本直连 bulk-import → 422 零写入（旧 parseFloat||0 静默归零已被拦截）', async () => {
  seedSingleValidSku('Redragon');
  const items = [{ sku_code: 'SKU-A', import_date: VALID_DATE, brand: 'Redragon', available_qty: VALID_QTY, weighted_avg_cost: '12abc', _row_num: 2 }];
  const beforeImp = count('inventory_imports'), beforeInv = count('inventory');
  const { status, body } = await postBulkImport(items, VALID_DATE);
  assert.equal(status, 422, '带尾随字符的非法成本应被后端闸门拦截');
  assert.equal(body.blocking[0].issue_type, 'WAC_INVALID');
  assert.equal(count('inventory_imports'), beforeImp, '闸门先于 write 路径，非法成本不会静默写成 0');
  assert.equal(count('inventory'), beforeInv);
});

// ==================== 场景 15：库存导入绝不 UPDATE/INSERT skus 主数据 ====================
test('15) 库存导入不写入/不修改 skus 主数据（即使 Excel 提供了 brand）', async () => {
  getDB().exec('DELETE FROM skus; DELETE FROM inventory_imports; DELETE FROM inventory;');
  run("INSERT INTO skus (sku_code, brand) VALUES ('SKU-A','Redragon')"); // 主数据品牌 = Redragon
  const beforeSkus = count('skus');
  const beforeBrand = query("SELECT brand FROM skus WHERE sku_code='SKU-A'").rows[0].brand;
  // Excel 提供完全相同的品牌（合法），验证导入路径不会回写/新增 skus
  const items = [{ sku_code: 'SKU-A', import_date: VALID_DATE, brand: 'Redragon', available_qty: VALID_QTY, weighted_avg_cost: VALID_WAC, _row_num: 2 }];
  const { status } = await postBulkImport(items, VALID_DATE);
  assert.ok(status === 200, '合法导入应成功');
  // 不变式：skus 行数不变、主数据品牌不变（库存导入不补 SKU 主数据）
  assert.equal(count('skus'), beforeSkus, 'skus 行数不应因库存导入而增加');
  const afterBrand = query("SELECT brand FROM skus WHERE sku_code='SKU-A'").rows[0].brand;
  assert.equal(afterBrand, beforeBrand, 'skus.brand 不应被库存导入回写/修改');
});

// =====================================================================================
// INV-IMPORT-WAREHOUSE-01：仓库合法性强校验（country + warehouse + status='active'）
// 规则：仅 trim 前后空格后精确匹配（大小写敏感、非模糊、非 alias）；空仓库阻断；
//       inactive 仓库视为不存在；任意一行仓库非法 → 整批 422 零写入。
// 注：W1-W7 直接调用 validateInventoryImportRows（自带你 country/warehouse，不走 withValidWh）。
// =====================================================================================

// 驱动只读 precheck 端点（不应产生任何写入）
async function postPrecheck(items) {
  const server = app.listen(0);
  try {
    const port = server.address().port;
    const res = await fetch(`http://127.0.0.1:${port}/api/inventory-imports/precheck`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': `session_token=${AUTH_TOKEN}` },
      body: JSON.stringify({ items, snapshot_cutoff_date: VALID_DATE })
    });
    return { status: res.status, body: await res.json() };
  } finally {
    await new Promise(r => server.close(r));
  }
}

function whRow(overrides) {
  return Object.assign({
    sku_code: 'SKU-A', import_date: VALID_DATE, brand: 'Redragon',
    available_qty: VALID_QTY, weighted_avg_cost: VALID_WAC, _row_num: 2
  }, overrides || {});
}

// W1（场景 A）：印度尼西亚 / Bigseller → WAREHOUSE_MISSING + 允许仓库清单
test('W1) 印度尼西亚 / Bigseller（生产事故仓库名）→ WAREHOUSE_MISSING，带允许仓库清单', () => {
  seedSingleValidSku('Redragon');
  const items = [whRow({ country: '印度尼西亚', warehouse: 'Bigseller', _row_num: 12 })];
  const r = validateInventoryImportRows(items);
  assert.equal(r.ok, false, 'Bigseller 不在主数据中，必须阻断');
  assert.equal(r.blocking.length, 1, 'SKU/品牌/数量均合法，应只有仓库 1 个问题');
  const b = r.blocking[0];
  assert.equal(b.issue_type, 'WAREHOUSE_MISSING');
  assert.equal(b.row, 12, '应回传 Excel 行号');
  assert.equal(b.country, '印度尼西亚');
  assert.equal(b.warehouse, 'Bigseller');
  assert.deepEqual(b.allowed_warehouses, ['Bekasi Warehouse', 'Jakarta Warehouse'],
    '应带出该国家当前允许仓库（active、插入序）');
  assert.ok(b.suggestion.indexOf('Bekasi Warehouse') >= 0 && b.suggestion.indexOf('Jakarta Warehouse') >= 0,
    'suggestion 应包含允许仓库名单');
  assert.ok(b.suggestion.indexOf('Bigseller') === -1, 'suggestion 无需回显错误名（由前端句式拼装）');
});

// W2（场景 B）：马来西亚 / Bekasi Warehouse → 证明不是按 warehouse 全局匹配
test('W2) 马来西亚 / Bekasi Warehouse → 阻断，且允许仓库仅为该国的 KL Hub（country+warehouse 维度）', () => {
  seedSingleValidSku('Redragon');
  const items = [whRow({ country: '马来西亚', warehouse: 'Bekasi Warehouse', _row_num: 8 })];
  const r = validateInventoryImportRows(items);
  assert.equal(r.ok, false, '仓库存在于系统但不在该国，必须阻断（非全局匹配）');
  assert.equal(r.blocking[0].issue_type, 'WAREHOUSE_MISSING');
  assert.deepEqual(r.blocking[0].allowed_warehouses, ['KL Hub'],
    '允许清单必须限定在马来西亚，不得混入印尼仓库');
});

// W3（场景 C）：印度尼西亚 / Bekasi Warehouse → PASS
test('W3) 印度尼西亚 / Bekasi Warehouse（合法 active 仓库）→ PASS', () => {
  seedSingleValidSku('Redragon');
  const items = [whRow({ country: '印度尼西亚', warehouse: 'Bekasi Warehouse' })];
  const r = validateInventoryImportRows(items);
  assert.equal(r.ok, true, '合法仓库应放行');
  assert.equal(r.blocking_count, 0);
});

// W4（场景 D）：尾部空格 → trim 后精确匹配 → PASS
test('W4) 印度尼西亚 / "Bekasi Warehouse "（尾部空格）→ trim 后匹配 → PASS', () => {
  seedSingleValidSku('Redragon');
  const items = [whRow({ country: '印度尼西亚 ', warehouse: 'Bekasi Warehouse  ' })];
  const r = validateInventoryImportRows(items);
  assert.equal(r.ok, true, '前后空格仅 trim，应放行');
  assert.equal(r.blocking_count, 0);
});

// W5（场景 E）：小写 → 大小写敏感 → FAIL（禁止模糊/静默纠错）
test('W5) 印度尼西亚 / "bekasi warehouse"（大小写不同）→ FAIL（精确匹配、不做大小写归一）', () => {
  seedSingleValidSku('Redragon');
  const items = [whRow({ country: '印度尼西亚', warehouse: 'bekasi warehouse' })];
  const r = validateInventoryImportRows(items);
  assert.equal(r.ok, false, '大小写差异必须阻断，禁止静默纠错');
  assert.equal(r.blocking[0].issue_type, 'WAREHOUSE_MISSING');
});

// W-F（场景 F）：warehouse 为空 → WAREHOUSE_EMPTY
test('W-F) warehouse 为空 → WAREHOUSE_EMPTY（空仓库禁止进入 inventory_imports / inventory）', () => {
  seedSingleValidSku('Redragon');
  const items = [whRow({ country: '印度尼西亚', warehouse: '' })];
  const r = validateInventoryImportRows(items);
  assert.equal(r.ok, false);
  assert.equal(r.blocking[0].issue_type, 'WAREHOUSE_EMPTY');
  assert.deepEqual(r.blocking[0].allowed_warehouses, ['Bekasi Warehouse', 'Jakarta Warehouse'],
    '空仓库也应提示该国允许仓库');
});

// W6：国家完全不存在 → COUNTRY_NO_WAREHOUSE + 空 allowed
test('W6) 国家 ZZZ 完全不存在 → COUNTRY_NO_WAREHOUSE，allowed 为空', () => {
  seedSingleValidSku('Redragon');
  const items = [whRow({ country: 'ZZZ', warehouse: 'Anything', _row_num: 20 })];
  const r = validateInventoryImportRows(items);
  assert.equal(r.ok, false);
  assert.equal(r.blocking[0].issue_type, 'COUNTRY_NO_WAREHOUSE');
  assert.deepEqual(r.blocking[0].allowed_warehouses, []);
  assert.equal(r.blocking[0].row, 20);
});

// W7（场景 G）：inactive 仓库 → FAIL（只认 status='active'）
test('W7) 印度尼西亚 / Old WH（inactive）→ FAIL（inactive 视为不存在，不得继续导入）', () => {
  seedSingleValidSku('Redragon');
  const items = [whRow({ country: '印度尼西亚', warehouse: 'Old WH' })];
  const r = validateInventoryImportRows(items);
  assert.equal(r.ok, false, 'inactive 仓库必须阻断');
  assert.equal(r.blocking[0].issue_type, 'WAREHOUSE_MISSING');
  assert.ok(r.blocking[0].allowed_warehouses.indexOf('Old WH') === -1,
    '允许清单不得包含 inactive 仓库');
});

// W8（场景 H）：真实 bulk-import —— 1 行合法 + 1 行 Bigseller → 422 整批零写入
test('W8) 真实路由：1 行合法 + 1 行 Bigseller → 422，inventory_imports / inventory 零写入', async () => {
  seedSingleValidSku('Redragon');
  const items = [
    whRow({ country: '印度尼西亚', warehouse: 'Bekasi Warehouse', _row_num: 2 }),            // 合法行
    whRow({ country: '印度尼西亚', warehouse: 'Bigseller', _row_num: 3 })                     // 非法行
  ];
  const beforeImp = count('inventory_imports'), beforeInv = count('inventory');
  const { status, body } = await postBulkImport(items, VALID_DATE);
  assert.equal(status, 422, '任一行仓库非法必须整批 422');
  assert.equal(body.blocked, true);
  const whIssues = body.blocking.filter(b => b.issue_type === 'WAREHOUSE_MISSING');
  assert.equal(whIssues.length, 1, '仅 Bigseller 行报仓库问题');
  assert.equal(whIssues[0].row, 3);
  assert.deepEqual(whIssues[0].allowed_warehouses, ['Bekasi Warehouse', 'Jakarta Warehouse']);
  // 关键不变量：合法行也不得部分写入
  assert.equal(count('inventory_imports'), beforeImp, 'inventory_imports 零写入');
  assert.equal(count('inventory'), beforeInv, 'inventory 零写入');
});

// W9：真实 precheck 端点 → ok=false，纯只读不写库
test('W9) 真实 precheck 端点：Bigseller → ok=false，且不产生任何写入', async () => {
  seedSingleValidSku('Redragon');
  const items = [whRow({ country: '印度尼西亚', warehouse: 'Bigseller' })];
  const beforeImp = count('inventory_imports'), beforeInv = count('inventory');
  const { status, body } = await postPrecheck(items);
  assert.equal(status, 200, 'precheck 是只读校验，正常返回 200');
  assert.equal(body.ok, false);
  assert.equal(body.blocking[0].issue_type, 'WAREHOUSE_MISSING');
  assert.equal(count('inventory_imports'), beforeImp, 'precheck 不得写 inventory_imports');
  assert.equal(count('inventory'), beforeInv, 'precheck 不得写 inventory');
});

// W10：仓库校验独立于 SKU —— SKU 为空也能同时报出仓库问题（不因提前 return 漏检）
test('W10) SKU 为空 + 仓库非法 → 同时报 SKU_EMPTY 与 WAREHOUSE_MISSING（仓库校验不依赖 SKU）', () => {
  getDB().exec('DELETE FROM skus;');
  const items = [whRow({ sku_code: '', country: '印度尼西亚', warehouse: 'Bigseller' })];
  const r = validateInventoryImportRows(items);
  assert.equal(r.ok, false);
  const types = r.blocking.map(b => b.issue_type).sort();
  assert.deepEqual(types, ['SKU_EMPTY', 'WAREHOUSE_MISSING'], '两类问题都必须报出');
});
