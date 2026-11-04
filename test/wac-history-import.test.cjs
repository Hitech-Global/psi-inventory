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
      effective_end_date TEXT DEFAULT '',
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
    last_inbound_date: '2026-10-29',
    effective_end_date: '2026-11-01',
    local_currency: 'IDR',
    rmb_to_local_rate: 2724.7956
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

  const template = await request('/api/wac/history-import/template','GET');
  assert.equal(template.status,200);
  assert.deepEqual(template.body.columns,[
    'SKU','品牌','国家','仓库','历史WAC（本币）','最后入库日期','结束日期','本币币种','1 RMB = 本币汇率'
  ]);

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
  assert.equal(history.confirmed_at,'2026-10-29 12:00:00');
  assert.equal(history.last_inbound_date,'2026-10-29');
  assert.equal(history.effective_end_date,'2026-11-01');
  assert.equal(history.fx_rate_date,'2026-10-29');
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

  const rateWithoutDate = validateWacHistoryImportRows([validRow({last_inbound_date:''})]);
  assert.equal(rateWithoutDate.ok,false);
  assert.ok(rateWithoutDate.blocking.some(x=>x.issue_type==='HISTORY_DATE_INVALID'));

  const noFx = validRow({
    sku_code:'NT-HISTORY-02',
    new_avg_cost:12345,
    last_inbound_date:'2026-10-30',
    local_currency:'IDR',
    rmb_to_local_rate:undefined
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

test('WAC history import validates effective date ranges and blocks overlapping periods', () => {
  setupSchema();
  const overlap = validateWacHistoryImportRows([
    validRow({row_no:2, last_inbound_date:'2026-10-29', effective_end_date:'2026-10-30'}),
    validRow({row_no:3, last_inbound_date:'2026-10-30', effective_end_date:'2026-11-01'})
  ]);
  assert.equal(overlap.ok,false);
  assert.ok(overlap.blocking.some(x=>x.issue_type==='IMPORT_PERIOD_OVERLAP'));

  const invalidEnd = validateWacHistoryImportRows([
    validRow({row_no:2, last_inbound_date:'2026-10-29', effective_end_date:'2026-10-28'})
  ]);
  assert.equal(invalidEnd.ok,false);
  assert.ok(invalidEnd.blocking.some(x=>x.issue_type==='HISTORY_END_BEFORE_START'));
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
  assert.match(page,/effective_end_date/);
  assert.match(page,/品牌/);
  assert.match(page,/国家/);
  assert.match(page,/仓库/);
  assert.match(page,/text-align:left!important/);
  assert.match(page,/position:sticky;top:0/);
  assert.match(page,/导入历史WAC/);
  assert.match(page,/downloadWacHistoryImportTemplate/);
  assert.match(page,/submitWacHistoryImport/);
  assert.doesNotMatch(page,/<select[^>]*multiple/);
  assert.match(page,/wac-history-search/);
  assert.match(page,/wac-history-search\{box-sizing:border-box;height:36px;width:260px[^}]*margin-left:auto/);
  assert.match(page,/wac-history-filter-row\{display:flex;gap:8px;align-items:center;flex-wrap:nowrap/);
  assert.match(page,/wac-history-date-range-panel/);
  assert.match(page,/id="wac-matrix-date-trigger"/);
  assert.equal((page.match(/class="wac-history-date-trigger"/g)||[]).length,1);
  assert.match(page,/id="wac-matrix-from" type="hidden"/);
  assert.match(page,/id="wac-matrix-to" type="hidden"/);
  assert.match(page,/wac-history-calendar-months/);
  assert.match(page,/wac-history-calendar-selection/);
  assert.doesNotMatch(page,/type="date"/);
  assert.ok(!page.includes('wac-history-query-btn'));
  assert.ok(!page.includes('>查询</button>'));
  assert.ok(page.includes('oninput="loadWacHistoryMatrix(false)"'));
  assert.doesNotMatch(page,/id="wac-matrix-search"[^']*flex:1/);
  assert.match(appSource,/function selectVisibleWacHistoryOptions/);
  assert.match(appSource,/function clearWacHistoryFilter/);
  assert.ok(appSource.includes('onchange="updateWacHistoryFilterLabel'));
  assert.ok(appSource.includes('function selectWacHistoryCalendarDate'));
  assert.ok(appSource.includes('function renderWacHistoryDateCalendar'));
  assert.ok(appSource.includes('function moveWacHistoryCalendar'));
  assert.ok(appSource.includes("selected.join('、')"));
  assert.ok(appSource.includes('if (apply) loadWacHistoryMatrix(false)'));
  assert.ok(appSource.includes('null,true)'), 'checkbox, clear and select-all changes must apply filters immediately');
  assert.match(appSource,/全选当前结果/);
  assert.match(page,/closest\('\.wac-history-date-range'\)/);
  assert.match(page,/dateFxLabels/);
  assert.match(page,/wac-history-date-fx/);
  assert.match(page,/dates\.map\(dateHeader\)/);
  assert.doesNotMatch(page,/wac-history-fx/);

  const latestStart=serverSource.indexOf('function latestConfirmedWac');
  const latestEnd=serverSource.indexOf('// P1-03-B',latestStart);
  assert.ok(latestStart>=0 && latestEnd>latestStart);
  assert.match(serverSource.slice(latestStart,latestEnd),/ORDER BY confirmed_at DESC, version_no DESC/);

  const routeStart=serverSource.indexOf("app.post('/api/wac/history-import'");
  const routeEnd=serverSource.indexOf("/* WAC历史矩阵",routeStart);
  assert.ok(routeStart>=0 && routeEnd>routeStart);
  const importRoute=serverSource.slice(routeStart,routeEnd);
  assert.doesNotMatch(importRoute,/UPDATE inventory|INSERT INTO inventory/);
  // PostgreSQL production uses db.js worker_threads migrations, not db-pg.js initDatabase.
  ['last_inbound_date','effective_end_date','local_currency','rmb_to_local_rate','fx_rate_date','source_type','import_batch_id'].forEach(function(column) {
    assert.ok(dbAdapterSource.includes('ALTER TABLE wac_history ADD COLUMN IF NOT EXISTS ' + column),
      'worker_threads startup migration missing: ' + column);
  });
  const importColumnsStart = appSource.indexOf('const WAC_HISTORY_IMPORT_COLUMNS');
  const importModalStart = appSource.indexOf('function openWacHistoryImport()', importColumnsStart);
  const importPayloadStart = appSource.indexOf('function _wacHistoryImportPayload()', importModalStart);
  assert.ok(importColumnsStart >= 0 && importModalStart > importColumnsStart && importPayloadStart > importModalStart);
  const importConfig = appSource.slice(importColumnsStart, importPayloadStart);
  assert.match(importConfig,/last_inbound_date/);
  assert.match(importConfig,/effective_end_date/);
  assert.doesNotMatch(importConfig,/确认日期|汇率日期|confirmed_at|fx_rate_date/);
  const templateStart = serverSource.indexOf("app.get('/api/wac/history-import/template'");
  const templateEnd = serverSource.indexOf("app.post('/api/wac/history-import/precheck'",templateStart);
  assert.ok(templateStart >= 0 && templateEnd > templateStart);
  const templateRoute = serverSource.slice(templateStart,templateEnd);
  assert.match(templateRoute,/columns: \['SKU', '品牌', '国家', '仓库', '历史WAC（本币）', '最后入库日期', '结束日期', '本币币种', '1 RMB = 本币汇率'\]/);
  assert.doesNotMatch(templateRoute,/确认日期|汇率日期/);

});


test('WAC history matrix presentation hides redundant columns and fills available viewport', () => {
  const html = fs.readFileSync(require('node:path').join(__dirname, '..', 'index.html'), 'utf8');
  const appSource = fs.readFileSync(require.resolve('../app'), 'utf8');
  const start = html.indexOf('/* WAC-HISTORY-PRESENTATION-20261104:');
  const end = html.indexOf('</style>', start);
  assert.ok(start >= 0 && end > start, 'WAC history presentation overrides must be present in the page shell');
  const css = html.slice(start, end);
  ['thead th:nth-child(2)', 'thead th:nth-child(3)', 'thead th:nth-child(4)',
    'tbody td:nth-child(2)', 'tbody td:nth-child(3)', 'tbody td:nth-child(4)',
    'wac-history-source', '#wac-matrix-table > div[style*="font-size:11px"]',
    'max-height: calc(100dvh - 210px) !important',
    'left: 150px !important', 'left: 290px !important', 'left: 450px !important'
  ].forEach(function(selectorOrRule) {
    assert.ok(css.includes(selectorOrRule), 'missing WAC presentation rule: ' + selectorOrRule);
  });
  assert.ok(css.includes('display: none !important'), 'redundant fields and annotations must be hidden');
  assert.ok(appSource.includes("_wacMatrixMultiMarkup('brand'"), 'brand filter remains available');
  assert.ok(appSource.includes("_wacMatrixMultiMarkup('country'"), 'country filter remains available');
  assert.ok(appSource.includes("_wacMatrixMultiMarkup('warehouse'"), 'warehouse filter remains available');
});


test('WAC country multi-select omits internal search and the matrix search uses Mac-style controls', () => {
  const appSource = fs.readFileSync(require.resolve('../app'), 'utf8');
  const start = appSource.indexOf('function _wacMatrixMultiMarkup');
  const end = appSource.indexOf('\nfunction _wacMatrixSelected', start);
  assert.ok(start >= 0 && end > start, 'WAC multi-select renderer must exist');

  const vm = require('node:vm');
  const sandbox = {};
  vm.runInNewContext(appSource.slice(start, end), sandbox);
  const countryMarkup = sandbox._wacMatrixMultiMarkup('country', '全部国家');
  const brandMarkup = sandbox._wacMatrixMultiMarkup('brand', '全部品牌');

  assert.doesNotMatch(countryMarkup, /type="search"|wac-history-multi-search/,
    'country selector must show the country list directly without an internal search field');
  assert.match(countryMarkup, /wac-history-multi-options/,
    'country selector must retain its multi-select options');
  assert.match(countryMarkup, /data-wac-filter-wrap="country"/);
  assert.match(brandMarkup, /wac-history-multi-search/,
    'brand selector keeps its existing search capability');

  assert.ok(appSource.includes('background-image:url("data:image/svg+xml,'),
    'matrix search field must include a subtle search icon');
  assert.ok(appSource.includes('background-position:12px center'));
  assert.ok(appSource.includes('border-radius:10px!important'));
  assert.ok(appSource.includes('.wac-history-page .wac-history-reset-btn{'),
    'reset must use secondary macOS-style treatment');
  assert.ok(appSource.includes('background:#f5f5f7!important'));
  assert.ok(appSource.includes('.wac-history-page .wac-history-reset-btn:hover{'));
});


test('WAC history export mirrors the filtered matrix and keeps every historical date column', () => {
  const appSource = fs.readFileSync(require.resolve('../app'), 'utf8');
  const vm = require('node:vm');
  const helperStart = appSource.indexOf('function _wacHistoryMatrixExportModel');
  const helperEnd = appSource.indexOf('\nasync function exportWacHistoryMatrix', helperStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart, 'WAC export model helper must exist');
  const sandbox = {};
  vm.runInNewContext(appSource.slice(helperStart, helperEnd) + '\nthis.buildExportModel = _wacHistoryMatrixExportModel;', sandbox);

  const rows = [
    {sku_code:'M724',model:'M724 Gaming Mouse',brand:'Redragon',country:'Indonesia',warehouse:'Bekasi',
      confirmed_at:'2026-10-30T10:00:00',version_no:2,new_avg_cost:120000,last_inbound_date:'2026-10-29',
      local_currency:'IDR',rmb_to_local_rate:2500,source_type:'system'},
    {sku_code:'M724',model:'M724 Gaming Mouse',brand:'Redragon',country:'Indonesia',warehouse:'Bekasi',
      confirmed_at:'2026-09-30T10:00:00',version_no:1,new_avg_cost:110000,last_inbound_date:'2026-09-28',
      local_currency:'IDR',rmb_to_local_rate:2400,source_type:'historical_import',effective_end_date:'2026-10-29'},
    {sku_code:'M816',model:'M816 Keyboard',brand:'Redragon',country:'Indonesia',warehouse:'Bekasi',
      confirmed_at:'2026-10-20T10:00:00',version_no:1,new_avg_cost:200000,last_inbound_date:'2026-10-18',
      local_currency:'IDR',rmb_to_local_rate:2500,source_type:'system'},
    {sku_code:'M724',model:'M724 Gaming Mouse',brand:'Other',country:'Indonesia',warehouse:'Bekasi',
      confirmed_at:'2026-10-29T10:00:00',version_no:1,new_avg_cost:100000,last_inbound_date:'2026-10-27',
      local_currency:'IDR',rmb_to_local_rate:2500,source_type:'system'}
  ];
  const model = sandbox.buildExportModel(rows,{
    brands:['Redragon'],countries:['Indonesia'],warehouses:['Bekasi'],
    search:'m724',from:'2026-09-01',to:'2026-10-31'
  });
  assert.equal(model.groups.length,1);
  assert.equal(model.selectedCount,2);
  assert.deepEqual(JSON.parse(JSON.stringify(model.dates)),['2026-10-30','2026-09-30']);
  assert.deepEqual(JSON.parse(JSON.stringify(model.headers.slice(0,7))),
    ['SKU','品牌','国家','仓库','Latest WAC','较上次 WAC 变化','最后入库日期']);
  assert.match(model.headers[7],/1 RMB = 2,500 IDR[\s\S]*2026-10-30/);
  assert.equal(model.rows[0][0],'M724');
  assert.equal(model.rows[0][4],'120,000.00 IDR');
  assert.match(model.rows[0][5], /9\.09%/);
  assert.match(model.rows[0][5],/\+10,000\.00 IDR/);
  assert.match(model.rows[0][7],/120,000\\.00 IDR/);
  assert.match(model.rows[0][8],/历史导入 · 有效至 2026-10-29/);
});

test('WAC history export button sits beside import and exports the current filter result to Excel', async () => {
  const appSource = fs.readFileSync(require.resolve('../app'), 'utf8');
  const vm = require('node:vm');
  const actionStart = appSource.indexOf("'<div class=\"wac-history-title-actions\">'");
  const actionEnd = appSource.indexOf("'</div></div>'",actionStart);
  assert.ok(actionStart >= 0 && actionEnd > actionStart, 'WAC title action group must exist');
  const actions = appSource.slice(actionStart,actionEnd);
  assert.ok(actions.indexOf('wac-matrix-export-btn') >= 0);
  assert.ok(actions.indexOf('wac-matrix-export-btn') < actions.indexOf('openWacHistoryImport'),
    'export button must be adjacent to and placed before the import button');
  assert.match(actions,/btn btn-secondary btn-sm/);

  const helperStart = appSource.indexOf('function _wacHistoryMatrixExportModel');
  const exportStart = appSource.indexOf('async function exportWacHistoryMatrix',helperStart);
  const exportEnd = appSource.indexOf('\nasync function loadWacHistoryMatrix',exportStart);
  assert.ok(helperStart >= 0 && exportStart > helperStart && exportEnd > exportStart);
  const source = appSource.slice(helperStart,exportEnd);
  const writes = [], sheets = [], notices = [];
  const button = {disabled:false,innerHTML:'📤 导出历史WAC',textContent:'📤 导出历史WAC'};
  const row = {sku_code:'M724',model:'M724 Gaming Mouse',brand:'Redragon',country:'Indonesia',warehouse:'Bekasi',
    confirmed_at:'2026-10-30T10:00:00',version_no:1,new_avg_cost:120000,last_inbound_date:'2026-10-29',
    local_currency:'IDR',rmb_to_local_rate:2500,source_type:'system'};
  const ctx = {
    window:{_wacHistoryMatrixData:{rows:[row]}},
    document:{getElementById:function(id) {
      if(id==='wac-matrix-export-btn') return button;
      if(id==='wac-matrix-search') return {value:'M724'};
      if(id==='wac-matrix-from') return {value:''};
      if(id==='wac-matrix-to') return {value:''};
      return null;
    }},
    _wacMatrixSelected:function(){return [];},
    XLSX:{utils:{
      aoa_to_sheet:function(data){return {data:data};},
      book_new:function(){return {sheets:[]};},
      book_append_sheet:function(wb,ws,name){sheets.push({ws:ws,name:name});wb.sheets.push(ws);},
      encode_range:function(range){return 'A1:'+String.fromCharCode(64+range.e.c+1)+(range.e.r+1);}
    },writeFile:function(wb,name){writes.push({wb:wb,name:name});}},
    showToast:function(message,type){notices.push({message:message,type:type});}
  };
  vm.runInNewContext(source + '\nthis.runExport = exportWacHistoryMatrix;',ctx);
  await ctx.runExport();
  assert.equal(writes.length,1);
  assert.equal(sheets[0].name,'WAC历史矩阵');
  assert.match(writes[0].name,/^WAC历史矩阵_\d{4}-\d{2}-\d{2}\.xlsx$/);
  assert.equal(sheets[0].ws.data.length,2);
  assert.equal(sheets[0].ws.data[1][0],'M724');
  assert.equal(button.disabled,false);
  assert.equal(button.innerHTML,'📤 导出历史WAC');
  assert.equal(notices[0].type,'success');
});
