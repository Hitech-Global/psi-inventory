'use strict';

process.env.DB_DRIVER = 'sqlite';
process.env.DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const Module = require('node:module');

// 与现有回归测试一致：若开发工作区只有 rp-projection.cjs，测试进程内回退解析，不改生产文件。
const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function(request, parent, isMain, options) {
  try {
    return originalResolveFilename.call(this, request, parent, isMain, options);
  } catch (error) {
    if (typeof request === 'string' && (request.startsWith('./') || request.startsWith('../'))) {
      const base = require('node:path').resolve(require('node:path').dirname(parent ? parent.filename : '.'), request);
      try { fs.accessSync(base + '.cjs'); return base + '.cjs'; } catch (_) {}
    }
    throw error;
  }
};

const db = require('../db');
const { query, run, getDB } = db;
const { app, validateWacHistoryImportRows } = require('../server');

let AUTH_TOKEN = '';

function setupSchema() {
  const d = getDB();
  d.exec('PRAGMA foreign_keys=OFF;');
  d.exec(`
    DROP TABLE IF EXISTS wac_history;
    DROP TABLE IF EXISTS inventory;
    DROP TABLE IF EXISTS exchange_rates;
    DROP TABLE IF EXISTS logistics_batches;
    DROP TABLE IF EXISTS warehouses;
    DROP TABLE IF EXISTS countries;
    DROP TABLE IF EXISTS skus;
    DROP TABLE IF EXISTS sessions;
    DROP TABLE IF EXISTS users;
    DROP TABLE IF EXISTS roles;
    DROP TABLE IF EXISTS role_data_scope;
    DROP TABLE IF EXISTS user_data_scope;

    CREATE TABLE skus (
      sku_code TEXT PRIMARY KEY,
      brand TEXT DEFAULT '',
      model TEXT DEFAULT ''
    );
    CREATE TABLE countries (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      code TEXT DEFAULT '',
      default_currency TEXT DEFAULT '',
      status TEXT DEFAULT 'active',
      sort_order INTEGER DEFAULT 0
    );
    CREATE TABLE warehouses (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      country_id TEXT DEFAULT '',
      country_name TEXT DEFAULT '',
      status TEXT DEFAULT 'active',
      sort_order INTEGER DEFAULT 0
    );
    CREATE TABLE exchange_rates (
      id TEXT PRIMARY KEY,
      from_currency TEXT NOT NULL,
      to_currency TEXT NOT NULL,
      rate NUMERIC NOT NULL,
      rate_date TEXT NOT NULL,
      rate_type TEXT DEFAULT 'realtime',
      created_at TEXT DEFAULT ''
    );
    CREATE TABLE logistics_batches (
      id TEXT PRIMARY KEY,
      actual_arrival_date TEXT DEFAULT ''
    );
    CREATE TABLE inventory (
      id TEXT PRIMARY KEY,
      sku_code TEXT,
      country TEXT,
      warehouse TEXT,
      available_qty NUMERIC DEFAULT 0,
      weighted_avg_cost NUMERIC DEFAULT 0,
      inventory_value NUMERIC DEFAULT 0
    );
    CREATE TABLE wac_history (
      id TEXT PRIMARY KEY,
      version_no INTEGER NOT NULL,
      ci_id TEXT DEFAULT '',
      ci_no TEXT DEFAULT '',
      po_id TEXT DEFAULT '',
      po_no TEXT DEFAULT '',
      pi_id TEXT DEFAULT '',
      pi_no TEXT DEFAULT '',
      sku_code TEXT NOT NULL,
      model TEXT DEFAULT '',
      brand TEXT DEFAULT '',
      country TEXT DEFAULT '',
      warehouse TEXT DEFAULT '',
      original_qty NUMERIC DEFAULT 0,
      original_avg_cost NUMERIC DEFAULT 0,
      original_inventory_value NUMERIC DEFAULT 0,
      inbound_qty NUMERIC DEFAULT 0,
      unit_landing_cost NUMERIC DEFAULT 0,
      inbound_total_cost NUMERIC DEFAULT 0,
      new_avg_cost NUMERIC DEFAULT 0,
      settlement_date TEXT DEFAULT '',
      confirmation_status TEXT DEFAULT 'confirmed',
      is_locked INTEGER DEFAULT 1,
      confirmed_by TEXT DEFAULT '',
      confirmed_at TEXT DEFAULT '',
      logistics_batch_id TEXT,
      last_inbound_date TEXT DEFAULT '',
      local_currency TEXT DEFAULT '',
      rmb_to_local_rate NUMERIC,
      fx_rate_date TEXT DEFAULT '',
      source_type TEXT DEFAULT 'system',
      import_batch_id TEXT DEFAULT '',
      created_at TEXT DEFAULT ''
    );
    CREATE UNIQUE INDEX uq_test_wac_version ON wac_history(sku_code,country,warehouse,version_no);
    CREATE TABLE roles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      permissions TEXT DEFAULT '[]',
      is_system INTEGER DEFAULT 0,
      created_at TEXT DEFAULT ''
    );
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      password TEXT DEFAULT '',
      role_id TEXT DEFAULT '',
      status TEXT DEFAULT 'active',
      email TEXT DEFAULT '',
      created_at TEXT DEFAULT ''
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
  `);
  d.exec('PRAGMA foreign_keys=ON;');

  run('INSERT INTO skus (sku_code,brand,model) VALUES (?,?,?)', ['NT-HISTORY-01','Netac','SSD A']);
  run('INSERT INTO skus (sku_code,brand,model) VALUES (?,?,?)', ['NT-HISTORY-02','Netac','SSD B']);
  run('INSERT INTO countries (id,name,code,default_currency,status,sort_order) VALUES (?,?,?,?,?,?)',
    ['c1','印尼','ID','IDR','active',1]);
  run('INSERT INTO warehouses (id,name,country_name,status) VALUES (?,?,?,?)',
    ['wh1','Bekasi Warehouse','印度尼西亚','active']);
  run('INSERT INTO exchange_rates (id,from_currency,to_currency,rate,rate_date,rate_type,created_at) VALUES (?,?,?,?,?,?,?)',
    ['fx-old','RMB','IDR',2724.7956,'2026-10-29','realtime','2026-10-29 00:00:00']);
  // 有今天汇率但没有 2026-10-30 的汇率：历史记录不得错误回退到今天。
  run('INSERT INTO exchange_rates (id,from_currency,to_currency,rate,rate_date,rate_type,created_at) VALUES (?,?,?,?,?,?,?)',
    ['fx-today','RMB','IDR',2800,'2026-11-03','realtime','2026-11-03 00:00:00']);
  run('INSERT INTO inventory (id,sku_code,country,warehouse,available_qty,weighted_avg_cost,inventory_value) VALUES (?,?,?,?,?,?,?)',
    ['inv1','NT-HISTORY-01','印度尼西亚','Bekasi Warehouse',20,777,15540]);

  run('INSERT INTO roles (id,name,permissions) VALUES (?,?,?)',
    ['role1','WAC Importer',JSON.stringify(['ci_edit','ci_view'])]);
  run('INSERT INTO users (id,username,name,role_id,status) VALUES (?,?,?,?,?)',
    ['u1','wac-importer','WAC Importer','role1','active']);
  AUTH_TOKEN = 'wac-history-test-' + crypto.randomBytes(8).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(AUTH_TOKEN).digest('hex');
  run('INSERT INTO sessions (id,token_hash,user_id,created_at,expires_at) VALUES (?,?,?,?,?)',
    ['s1',tokenHash,'u1','2026-11-03 00:00:00','2099-12-31 23:59:59']);
}

function validRow(overrides) {
  return Object.assign({
    row_no: 2,
    sku_code: 'NT-HISTORY-01',
    brand: 'Netac',
    country: '印度尼西亚',
    warehouse: 'Bekasi Warehouse',
    new_avg_cost: 88365.398,
    confirmed_at: '2026-10-31',
    last_inbound_date: '2026-10-29',
    local_currency: 'IDR',
    rmb_to_local_rate: 2724.7956,
    fx_rate_date: '2026-10-29'
  }, overrides || {});
}

async function request(path, method, body) {
  const http = await new Promise(resolve => {
    const listener = app.listen(0, () => resolve(listener));
  });
  try {
    const port = http.address().port;
    const response = await fetch('http://127.0.0.1:' + port + path, {
      method: method || 'GET',
      headers: {
        'Cookie': 'session_token=' + AUTH_TOKEN,
        ...(body ? {'Content-Type':'application/json'} : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise(resolve => http.close(resolve));
  }
}

function one(sql, params) {
  return query(sql, params).rows[0] || null;
}

test('WAC history import validates master data, writes immutable history only, skips exact duplicates, and keeps FX date-exact', async () => {
  setupSchema();

  const valid = validateWacHistoryImportRows([validRow()]);
  assert.equal(valid.ok, true);
  assert.equal(valid.valid_count, 1);
  assert.equal(valid.normalized_items[0].brand, 'Netac');
  assert.equal(valid.normalized_items[0].local_currency, 'IDR');

  const precheck = await request('/api/wac/history-import/precheck','POST',{items:[validRow()]});
  assert.equal(precheck.status,200);
  assert.equal(precheck.body.ok,true);
  assert.equal(precheck.body.valid_count,1);

  const imported = await request('/api/wac/history-import','POST',{items:[validRow()]});
  assert.equal(imported.status,200);
  assert.equal(imported.body.inserted,1);
  assert.equal(imported.body.skipped_duplicates,0);

  const history = one('SELECT * FROM wac_history WHERE sku_code = ?', ['NT-HISTORY-01']);
  assert.ok(history);
  assert.equal(Number(history.new_avg_cost),88365.398);
  assert.equal(history.confirmed_at,'2026-10-31 12:00:00');
  assert.equal(history.last_inbound_date,'2026-10-29');
  assert.equal(history.local_currency,'IDR');
  assert.equal(Number(history.rmb_to_local_rate),2724.7956);
  assert.equal(history.source_type,'historical_import');
  assert.equal(history.is_locked,1);
  assert.equal(history.confirmation_status,'confirmed');

  // 导入历史WAC绝不能改动库存总表当前WAC/数量/货值。
  const inventory = one('SELECT available_qty,weighted_avg_cost,inventory_value FROM inventory WHERE sku_code = ?', ['NT-HISTORY-01']);
  assert.equal(Number(inventory.available_qty),20);
  assert.equal(Number(inventory.weighted_avg_cost),777);
  assert.equal(Number(inventory.inventory_value),15540);

  const duplicate = await request('/api/wac/history-import','POST',{items:[validRow()]});
  assert.equal(duplicate.status,200);
  assert.equal(duplicate.body.inserted,0);
  assert.equal(duplicate.body.skipped_duplicates,1);
  assert.equal(query('SELECT id FROM wac_history WHERE sku_code = ?', ['NT-HISTORY-01']).rows.length,1);

  const conflict = await request('/api/wac/history-import','POST',{
    items:[validRow({new_avg_cost:90000})]
  });
  assert.equal(conflict.status,422);
  assert.equal(conflict.body.blocked,true);
  assert.equal(query('SELECT id FROM wac_history WHERE sku_code = ?', ['NT-HISTORY-01']).rows.length,1);

  const badBrand = validateWacHistoryImportRows([validRow({brand:'netac'})]);
  assert.equal(badBrand.ok,false);
  assert.ok(badBrand.blocking.some(x=>x.issue_type==='BRAND_MISMATCH'));
  const badWarehouse = validateWacHistoryImportRows([validRow({warehouse:'bekasi warehouse'})]);
  assert.equal(badWarehouse.ok,false);
  assert.ok(badWarehouse.blocking.some(x=>x.issue_type==='WAREHOUSE_MISSING'));

  const badPrecheck = await request('/api/wac/history-import/precheck','POST',{
    items:[validRow({sku_code:'SKU-NOT-IN-MASTER'})]
  });
  assert.equal(badPrecheck.status,200);
  assert.equal(badPrecheck.body.ok,false);
  assert.ok(badPrecheck.body.blocking.some(x=>x.issue_type==='SKU_MASTER_MISSING'));

  const rateWithoutDate = validateWacHistoryImportRows([validRow({last_inbound_date:'',fx_rate_date:''})]);
  assert.equal(rateWithoutDate.ok,false);
  assert.ok(rateWithoutDate.blocking.some(x=>x.issue_type==='FX_DATE_REQUIRED_FOR_RATE'));

  const noFx = validRow({
    sku_code:'NT-HISTORY-02',
    new_avg_cost:12345,
    confirmed_at:'2026-10-30',
    last_inbound_date:'',
    local_currency:'IDR',
    rmb_to_local_rate:undefined,
    fx_rate_date:''
  });
  const noFxPrecheck = validateWacHistoryImportRows([noFx]);
  assert.equal(noFxPrecheck.ok,true);
  assert.equal(noFxPrecheck.normalized_items[0].rmb_to_local_rate,null);
  assert.ok(noFxPrecheck.warnings.length>0);

  const noFxImport = await request('/api/wac/history-import','POST',{items:[noFx]});
  assert.equal(noFxImport.status,200);
  const matrix = await request('/api/wac/history-matrix','GET');
  assert.equal(matrix.status,200);
  const importedWithFx = matrix.body.rows.find(x=>x.sku_code==='NT-HISTORY-01');
  const importedWithoutFx = matrix.body.rows.find(x=>x.sku_code==='NT-HISTORY-02');
  assert.equal(Number(importedWithFx.rmb_to_local_rate),2724.7956);
  assert.equal(importedWithFx.local_currency,'IDR');
  assert.equal(importedWithFx.source_type,'historical_import');
  assert.equal(importedWithoutFx.rmb_to_local_rate,null,'must not fall back to current-day FX');
});

test('WAC history matrix keeps the agreed dimensions, left alignment, sticky header, Mac filters, and import entry', () => {
  const appSource = fs.readFileSync(require.resolve('../app'), 'utf8');
  const serverSource = fs.readFileSync(require.resolve('../server'), 'utf8');
  const dbAdapterSource = fs.readFileSync(require.resolve('../db'), 'utf8');
  const start = appSource.indexOf('async function renderWacHistoryMatrix');
  const end = appSource.indexOf('async function renderInbound()',start);
  assert.ok(start>=0 && end>start);
  const page = appSource.slice(start,end);
  assert.match(page,/wac-history-multi-panel/);
  assert.match(page,/Latest WAC/);
  assert.match(page,/较上次 WAC 变化/);
  assert.match(page,/最后入库日期/);
  assert.match(page,/品牌/);
  assert.match(page,/国家/);
  assert.match(page,/仓库/);
  assert.match(page,/text-align:left!important/);
  assert.match(page,/position:sticky;top:0/);
  assert.match(page,/导入历史WAC/);
  assert.match(page,/downloadWacHistoryImportTemplate/);
  assert.match(page,/submitWacHistoryImport/);
  assert.doesNotMatch(page,/<select[^>]*multiple/);

  const routeStart=serverSource.indexOf("app.post('/api/wac/history-import'");
  const routeEnd=serverSource.indexOf("/* WAC历史矩阵",routeStart);
  assert.ok(routeStart>=0 && routeEnd>routeStart);
  const importRoute=serverSource.slice(routeStart,routeEnd);
  assert.doesNotMatch(importRoute,/UPDATE inventory|INSERT INTO inventory/);
  // PostgreSQL production uses db.js worker_threads migrations, not db-pg.js initDatabase.
  ['last_inbound_date','local_currency','rmb_to_local_rate','fx_rate_date','source_type','import_batch_id'].forEach(function(column) {
    assert.ok(dbAdapterSource.includes('ALTER TABLE wac_history ADD COLUMN IF NOT EXISTS ' + column),
      'worker_threads startup migration missing: ' + column);
  });
});
