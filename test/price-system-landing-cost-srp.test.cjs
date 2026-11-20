'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const ui = fs.readFileSync(path.join(root, 'assets/price-system.js'), 'utf8');
const api = fs.readFileSync(path.join(root, 'price-system-api.js'), 'utf8');

test('price table removes Product Name and adds WAC-backed Landing Cost', () => {
  assert.doesNotMatch(ui, /tr\('product'\)|product_name/);
  assert.match(ui, /tr\('landingCost'\)/);
  assert.doesNotMatch(ui, /psOpenWacSyncModal|psConfirmWacSync|psOpenFormulaModal|landing-cost\/sync-wac/);
  assert.match(ui, /ps-field-sync-wac/);
  assert.match(ui, /syncWacFieldHelp/);
  assert.match(api, /sync_wac INTEGER|sync_wac = ?/);
  assert.match(api, /createPriceSystemWacSync/);
  assert.match(api, /price_system_landing_costs/);
  assert.match(api, /wacCountryAliases/);
});

test('WAC picker only offers confirmed, locked, non-reversed history for the matching SKU and country', () => {
  assert.match(api, /COALESCE\(wh\.is_locked, 0\) = 1/);
  assert.match(api, /NOT IN \('reversed', 'void', 'cancelled'\)/);
  assert.match(api, /ORDER BY COALESCE\(NULLIF\(wh\.confirmed_at/);
  assert.match(api, /requireApiPermission\('inbound_view'\)/);
  assert.match(api, /countryAliases = wacCountryAliases\(scheme\)/);
});

test('manual SRP import overrides formula output and is included in version history', () => {
  assert.match(api, /price_system_srp_values/);
  assert.match(api, /manualSrpBySku/);
  assert.match(api, /srpSource = 'manual'/);
  assert.match(api, /snapshotLandingCosts/);
  assert.match(api, /snapshotSrpValues/);
  assert.match(api, /sync_wac, sort_order, is_active/);
  assert.ok(api.includes("fieldMap.has('srp')"));
  assert.ok(api.includes("id: 'builtin-srp'"));
  assert.match(ui, /srpIdx=headers\.findIndex/);
  assert.match(ui, /id==='builtin-srp'/);
  assert.match(ui, /row\.srp=srp/);
});

test('Excel export includes Landing Cost and SRP without a Product Name column', () => {
  assert.match(ui, /const exportFields=state\.fields\.filter/);
  assert.match(ui, /r\.values\?r\.values\[f\.field_key\]/);
  assert.match(ui, /Number\(f\.sync_wac\|\|0\)===1/);
  assert.match(ui, /field_type!=='formula'&&Number\(f\.sync_wac\|\|0\)!==1/);
  assert.match(ui, /r\.srp==null\?'':r\.srp/);
});


test('WAC history route scopes by SKU, brand and country aliases; Landing Cost selection is persisted', async () => {
  const { registerPriceSystemRoutes } = require('../price-system-api');
  const routes = new Map();
  const calls = { queries: [], runs: [] };
  const scheme = { id: 'scheme-1', country: '\u5370\u5c3c', brand: 'Netac', currency: 'IDR', srp_formula: 'landing_cost * 1.1' };
  const sku = { sku_code: 'SKU-1', brand: 'Netac', category: 'SSD' };
  const wac = { id: 'wac-1', sku_code: 'SKU-1', brand: 'Netac', country: 'Indonesia', warehouse: 'Bekasi Warehouse', new_avg_cost: 123.45, local_currency: 'IDR', ci_no: 'CI-1', version_no: 3, confirmed_at: '2026-11-07 12:00:00', last_inbound_date: '2026-11-07', is_locked: 1, confirmation_status: 'confirmed' };
  const app = { get:(p,...h)=>routes.set('GET '+p,h), post:(p,...h)=>routes.set('POST '+p,h), put:(p,...h)=>routes.set('PUT '+p,h), delete:(p,...h)=>routes.set('DELETE '+p,h) };
  let nextId=0;
  const query = (sql, params=[]) => {
    calls.queries.push({sql,params});
    if (sql.includes('FROM wac_history wh')) return { rows:[wac] };
    if (sql.includes('FROM skus')) return { rows:[sku] };
    if (sql.includes('FROM price_system_srp_values') && calls.runs.some(x=>x.sql.includes('INSERT INTO price_system_srp_values'))) return { rows:[{sku_code:'SKU-1',value:199000}] };
    return { rows:[] };
  };
  const queryOne = (sql, params=[]) => {
    calls.queries.push({sql,params});
    if (sql.includes('FROM price_system_schemes')) return scheme;
    if (sql.includes('SELECT code FROM countries')) return {code:'ID'};
    if (sql.includes('FROM skus')) return sku;
    if (sql.includes('FROM wac_history wh')) return wac;
    if (sql.includes('MAX(version_no)')) return {max_version:0};
    return null;
  };
  registerPriceSystemRoutes(app, {
    query, queryOne, run:(sql,params=[])=>calls.runs.push({sql,params}), transaction:fn=>fn(),
    genId:prefix=>prefix+'-'+(++nextId), requireApiPermission:()=> (req,res,next)=>next(),
    asyncHandler:fn=>fn, needsDataScopeFilter:()=>false
  });
  async function invoke(method, path, body) {
    const handlers=routes.get(method+' '+path);assert.ok(handlers,'route registered: '+method+' '+path);
    const req={params:{id:'scheme-1',skuCode:'SKU-1'},body:body||{},currentUserPermissions:['*'],currentUserId:'tester',currentUserName:'Tester'};
    const res={statusCode:200,status(code){this.statusCode=code;return this;},json(value){this.body=value;return this;}};
    for(const middleware of handlers.slice(0,-1)) await new Promise((resolve,reject)=>{try{middleware(req,res,resolve);}catch(e){reject(e);}});
    await handlers[handlers.length-1](req,res,()=>{});return res;
  }
  const list=await invoke('GET','/api/price-system/schemes/:id/skus/:skuCode/wac-history');
  assert.equal(list.statusCode,200);assert.equal(list.body.rows[0].new_avg_cost,123.45);
  const historyQuery=calls.queries.find(x=>x.sql.includes('FROM wac_history wh'));
  assert.ok(historyQuery.sql.includes('LOWER(wh.country) IN'));
  assert.ok(historyQuery.params.includes('indonesia'));
  assert.ok(historyQuery.params.includes('\u5370\u5c3c'));
  assert.match(historyQuery.sql,/is_locked/);assert.ok(historyQuery.sql.includes('COALESCE(NULLIF(wh.confirmed_at'));
  const selected=await invoke('POST','/api/price-system/schemes/:id/landing-cost',{sku_code:'SKU-1',wac_history_id:'wac-1'});
  assert.equal(selected.statusCode,200);assert.equal(selected.body.landing_cost.value,123.45);
  assert.ok(calls.runs.some(x=>x.sql.includes('INSERT INTO price_system_landing_costs')&&x.params.includes('wac-1')));
});

test('values API accepts SRP-only imports and stores a manual override', async () => {
  const { registerPriceSystemRoutes } = require('../price-system-api');
  const routes=new Map(),runs=[];let nextId=0;
  const scheme={id:'scheme-1',country:'Indonesia',brand:'Netac',currency:'IDR',srp_formula:'landing_cost * 1.1'};
  const app={get:(p,...h)=>routes.set('GET '+p,h),post:(p,...h)=>routes.set('POST '+p,h),put:(p,...h)=>routes.set('PUT '+p,h),delete:(p,...h)=>routes.set('DELETE '+p,h)};
  const query=(sql)=>{if(sql.includes('FROM skus'))return{rows:[{sku_code:'SKU-1',brand:'Netac',category:'SSD'}]};if(sql.includes('FROM price_system_srp_values')&&runs.some(x=>x.sql.includes('INSERT INTO price_system_srp_values')))return{rows:[{sku_code:'SKU-1',value:199000}]};return{rows:[]};};
  const queryOne=(sql)=>sql.includes('FROM price_system_schemes')?scheme:(sql.includes('MAX(version_no)')?{max_version:0}:null);
  registerPriceSystemRoutes(app,{query,queryOne,run:(sql,params=[])=>runs.push({sql,params}),transaction:fn=>fn(),genId:prefix=>prefix+'-'+(++nextId),requireApiPermission:()=> (req,res,next)=>next(),asyncHandler:fn=>fn,needsDataScopeFilter:()=>false});
  const handlers=routes.get('POST /api/price-system/schemes/:id/values');assert.ok(handlers);
  const req={params:{id:'scheme-1'},body:{rows:[{sku_code:'SKU-1',values:{},srp:199000}]},currentUserPermissions:['*'],currentUserId:'tester',currentUserName:'Tester'};
  const res={statusCode:200,status(code){this.statusCode=code;return this;},json(value){this.body=value;return this;}};
  for(const middleware of handlers.slice(0,-1)) await new Promise((resolve,reject)=>{try{middleware(req,res,resolve);}catch(e){reject(e);}});
  await handlers[handlers.length-1](req,res,()=>{});
  assert.equal(res.statusCode,200);assert.equal(res.body.saved_srp,1);
  assert.ok(runs.some(x=>x.sql.includes('INSERT INTO price_system_srp_values')&&x.params.includes(199000)));
});


test('scheme data returns imported SRP instead of formula and uses Landing Cost when no override exists', async () => {
  const { registerPriceSystemRoutes } = require('../price-system-api');
  async function loadData(manualSrp) {
    const routes=new Map();const scheme={id:'scheme-1',country:'Indonesia',brand:'Netac',currency:'IDR',srp_formula:'landing_cost * 1.1'};
    const sku={sku_code:'SKU-1',brand:'Netac',category:'SSD',model:'Model 1',purchase_currency:'IDR',standard_purchase_price:0,purchase_price_rmb:0,purchase_price_usd:0,weighted_avg_cost:0,reference_customs_rate:0,stock_qty:0,inventory_wac:0};
    const landing={sku_code:'SKU-1',wac_history_id:'wac-1',value:123.45,currency:'IDR',warehouse:'Bekasi Warehouse',ci_no:'CI-1',version_no:3,confirmed_at:'2026-11-07 12:00:00',last_inbound_date:'2026-11-07'};
    const app={get:(p,...h)=>routes.set('GET '+p,h),post:(p,...h)=>routes.set('POST '+p,h),put:(p,...h)=>routes.set('PUT '+p,h),delete:(p,...h)=>routes.set('DELETE '+p,h)};
    const query=(sql)=>{if(sql.includes('FROM skus s LEFT JOIN'))return{rows:[sku]};if(sql.includes('FROM price_system_landing_costs'))return{rows:[landing]};if(sql.includes('FROM price_system_srp_values'))return{rows:manualSrp?[{sku_code:'SKU-1',value:manualSrp}]:[]};return{rows:[]};};
    const queryOne=(sql)=>sql.includes('FROM price_system_schemes')?scheme:null;
    registerPriceSystemRoutes(app,{query,queryOne,run:()=>{},transaction:fn=>fn(),genId:p=>p,requireApiPermission:()=> (req,res,next)=>next(),asyncHandler:fn=>fn,needsDataScopeFilter:()=>false});
    const handlers=routes.get('GET /api/price-system/schemes/:id/data');const req={params:{id:'scheme-1'},currentUserPermissions:['*']};const res={status(code){this.statusCode=code;return this;},json(value){this.body=value;return this;}};
    for(const middleware of handlers.slice(0,-1)) await new Promise((resolve,reject)=>{try{middleware(req,res,resolve);}catch(e){reject(e);}});
    await handlers[handlers.length-1](req,res,()=>{});return res.body.rows[0];
  }
  const manual=await loadData(199000);assert.equal(manual.srp,199000);assert.equal(manual.srp_source,'manual');
  const formula=await loadData(null);assert.ok(Math.abs(formula.srp-135.795)<1e-9);assert.equal(formula.srp_source,'formula');
});


test('Landing Cost is synced in bulk by SKU using the latest valid WAC, with preview and unmatched preservation', async () => {
  const { registerPriceSystemRoutes } = require('../price-system-api');
  const routes=new Map(), calls={queries:[],runs:[]};let nextId=0;
  const scheme={id:'scheme-1',country:'Indonesia',brand:'Netac',currency:'IDR',srp_formula:'landing_cost * 1.1'};
  const skus=[{sku_code:'SKU-1'},{sku_code:'SKU-2'},{sku_code:'SKU-3'}];
  const wacs=[
    {id:'wac-1-new',sku_code:'SKU-1',brand:'Netac',country:'Indonesia',warehouse:'Bekasi Warehouse',new_avg_cost:125,local_currency:'IDR',ci_no:'CI-2',version_no:4,confirmed_at:'2026-11-18 12:00:00',last_inbound_date:'2026-11-17',is_locked:1,confirmation_status:'confirmed',created_at:'2026-11-18 12:00:00'},
    {id:'wac-1-old',sku_code:'SKU-1',brand:'Netac',country:'Indonesia',warehouse:'Bekasi Warehouse',new_avg_cost:110,local_currency:'IDR',ci_no:'CI-1',version_no:3,confirmed_at:'2026-11-07 12:00:00',last_inbound_date:'2026-11-06',is_locked:1,confirmation_status:'confirmed',created_at:'2026-11-07 12:00:00'},
    {id:'wac-2-new',sku_code:'SKU-2',brand:'Netac',country:'Indonesia',warehouse:'Bekasi Warehouse',new_avg_cost:225,local_currency:'IDR',ci_no:'CI-3',version_no:1,confirmed_at:'2026-11-19 12:00:00',last_inbound_date:'2026-11-19',is_locked:1,confirmation_status:'confirmed',created_at:'2026-11-19 12:00:00'}
  ];
  const app={get:(p,...h)=>routes.set('GET '+p,h),post:(p,...h)=>routes.set('POST '+p,h),put:(p,...h)=>routes.set('PUT '+p,h),delete:(p,...h)=>routes.set('DELETE '+p,h)};
  const query=(sql,params=[])=>{calls.queries.push({sql,params});if(sql.includes('SELECT sku_code FROM skus WHERE brand = ?'))return{rows:skus};if(sql.includes('FROM wac_history wh'))return{rows:wacs};if(sql.includes('SELECT sku_code, wac_history_id FROM price_system_landing_costs'))return{rows:[{sku_code:'SKU-2',wac_history_id:'wac-2-old'}]};return{rows:[]};};
  const queryOne=(sql)=>{calls.queries.push({sql});if(sql.includes('FROM price_system_schemes'))return scheme;if(sql.includes('SELECT code FROM countries'))return{code:'ID'};if(sql.includes('MAX(version_no)'))return{max_version:2};return null;};
  registerPriceSystemRoutes(app,{query,queryOne,run:(sql,params=[])=>calls.runs.push({sql,params}),transaction:fn=>fn(),genId:p=>p+'-'+(++nextId),requireApiPermission:()=> (req,res,next)=>next(),asyncHandler:fn=>fn,needsDataScopeFilter:()=>false});
  const handlers=routes.get('POST /api/price-system/schemes/:id/landing-cost/sync-wac');assert.ok(handlers);
  async function invoke(body){const req={params:{id:'scheme-1'},body,currentUserPermissions:['*'],currentUserId:'tester',currentUserName:'Tester'};const res={statusCode:200,status(code){this.statusCode=code;return this;},json(value){this.body=value;return this;}};for(const m of handlers.slice(0,-1))await new Promise((resolve,reject)=>{try{m(req,res,resolve);}catch(e){reject(e);}});await handlers.at(-1)(req,res,()=>{});return res;}
  const preview=await invoke({preview:true});
  assert.equal(preview.statusCode,200);assert.equal(preview.body.matched_count,2);assert.equal(preview.body.unmatched_count,1);assert.equal(preview.body.changed_count,2);assert.deepEqual(preview.body.unmatched_skus,['SKU-3']);
  assert.equal(calls.runs.length,0,'preview must not write data');
  const wacQuery=calls.queries.find(x=>x.sql&&x.sql.includes('FROM wac_history wh'));
  assert.ok(wacQuery.sql.includes('wh.sku_code IN'));assert.ok(wacQuery.sql.includes('LOWER(wh.country) IN'));assert.ok(wacQuery.sql.includes('is_locked'));assert.ok(wacQuery.params.includes('Netac'));assert.ok(wacQuery.sql.includes('wh.confirmed_at IS NOT NULL'));assert.ok(wacQuery.sql.includes("ORDER BY COALESCE(NULLIF(wh.confirmed_at, '')"));
  const saved=await invoke({preview:false});assert.equal(saved.statusCode,200);assert.equal(saved.body.changed_count,2);assert.equal(saved.body.version_no,3);
  const landingWrites=calls.runs.filter(x=>x.sql.includes('INSERT INTO price_system_landing_costs'));
  assert.equal(landingWrites.length,2);assert.ok(landingWrites.some(x=>x.params.includes('wac-1-new')));assert.ok(landingWrites.some(x=>x.params.includes('wac-2-new')));assert.ok(!landingWrites.some(x=>x.params.includes('SKU-3')));
});

test('price system provides an Excel template without requiring manual WAC sync', () => {
  assert.doesNotMatch(ui,/psOpenWacSyncModal|psConfirmWacSync|landing-cost\/sync-wac/);
  assert.ok(ui.includes('psDownloadImportTemplate'));
  assert.ok(ui.includes("book_append_sheet(wb,ws,tr('downloadTemplate'))"));
  assert.ok(ui.includes("book_append_sheet(wb,note,tr('templateInstructions'))"));
  assert.ok(ui.includes("const headers=['SKU',tr('category'),tr('srp')]"));
  assert.ok(ui.includes('manual.map(f=>f.field_name'));
});

test('creating a WAC-backed amount field immediately imports the latest confirmed WAC', async () => {
  const { registerPriceSystemRoutes } = require('../price-system-api');
  const routes = new Map(), runs = [], queries = [], fields = [], landing = [], versions = [];
  const scheme = { id: 'scheme-wac', country: 'Indonesia', brand: 'Netac', platform: 'Shopee', currency: 'IDR', status: 'active', srp_formula: '' };
  const sku = { sku_code: 'SKU-WAC-1', brand: 'Netac' };
  const wac = { id: 'wac-latest', sku_code: 'SKU-WAC-1', brand: 'Netac', country: 'Indonesia', warehouse: 'Bekasi Warehouse', new_avg_cost: 456.78, local_currency: 'IDR', ci_no: 'CI-WAC', version_no: 2, confirmed_at: '2026-11-20 10:00:00', last_inbound_date: '2026-11-20' };
  const app = { get:(p,...h)=>routes.set('GET '+p,h), post:(p,...h)=>routes.set('POST '+p,h), put:(p,...h)=>routes.set('PUT '+p,h), delete:(p,...h)=>routes.set('DELETE '+p,h) };
  const query = (sql, params=[]) => {
    queries.push({sql,params});
    if (sql.includes('SELECT sku_code, brand FROM skus WHERE brand = ?')) return { rows:[sku] };
    if (sql.includes('SELECT sku_code, brand FROM skus WHERE sku_code IN')) return { rows:[sku] };
    if (sql.includes('FROM price_system_schemes ps WHERE ps.status')) return { rows:fields.some(f=>f.sync_wac===1)?[scheme]:[] };
    if (sql.includes('FROM wac_history wh')) return { rows:[wac] };
    if (sql.includes('FROM price_system_landing_costs WHERE scheme_id = ? AND sku_code IN')) return { rows:[] };
    if (sql.includes('FROM price_system_fields')) return { rows:fields.filter(f=>f.scheme_id===params[0]) };
    if (sql.includes('FROM price_system_values')) return { rows:[] };
    if (sql.includes('FROM price_system_landing_costs')) return { rows:landing.filter(x=>x.scheme_id===params[0]) };
    if (sql.includes('FROM price_system_srp_values')) return { rows:[] };
    return { rows:[] };
  };
  const queryOne = (sql, params=[]) => {
    queries.push({sql,params});
    if (sql.includes('SELECT * FROM price_system_schemes WHERE id = ?')) return scheme;
    if (sql.includes('SELECT code FROM countries')) return {code:'ID'};
    if (sql.includes('SELECT id FROM price_system_fields')) return null;
    if (sql.includes('SELECT * FROM price_system_fields WHERE id = ?')) return fields.find(f=>f.id===params[0])||null;
    if (sql.includes('MAX(version_no)')) return {max_version:0};
    return null;
  };
  const run = (sql, params=[]) => {
    runs.push({sql,params});
    if (sql.includes('INSERT INTO price_system_fields')) fields.push({id:params[0],scheme_id:params[1],field_key:params[2],field_name:params[3],field_type:params[4],unit:params[5],applicable_categories:params[6],formula:params[7],sync_wac:params[8],sort_order:params[9],is_active:1});
    if (sql.includes('INSERT INTO price_system_landing_costs')) landing.push({id:params[0],scheme_id:params[1],sku_code:params[2],wac_history_id:params[3],value:params[4],currency:params[5],warehouse:params[6],ci_no:params[7],version_no:params[8],confirmed_at:params[9],last_inbound_date:params[10]});
    if (sql.includes('INSERT INTO price_system_versions')) versions.push({scheme_id:params[1],version_no:params[2],note:params[4]});
  };
  registerPriceSystemRoutes(app,{query,queryOne,run,transaction:fn=>fn(),genId:p=>p+'-'+(runs.length+1),requireApiPermission:()=> (req,res,next)=>next(),asyncHandler:fn=>fn,needsDataScopeFilter:()=>false});
  const handlers=routes.get('POST /api/price-system/schemes/:id/fields');
  const req={params:{id:scheme.id},body:{field_name:'Landing Cost',field_key:'landing_cost',field_type:'amount',unit:'IDR',sync_wac:true,applicable_categories:[]},currentUserPermissions:['*'],currentUserId:'tester',currentUserName:'Tester'};
  const res={statusCode:200,status(code){this.statusCode=code;return this;},json(value){this.body=value;return this;}};
  for(const middleware of handlers.slice(0,-1)) await new Promise((resolve,reject)=>{try{middleware(req,res,resolve);}catch(e){reject(e);}});
  await handlers[handlers.length-1](req,res,()=>{});
  assert.equal(res.statusCode,200);
  assert.equal(fields[0].sync_wac,1);
  assert.equal(landing[0].wac_history_id,'wac-latest');
  assert.equal(landing[0].value,456.78);
  assert.equal(versions.length,1,'initial WAC import should be included in one scheme version');
  assert.ok(queries.some(x=>x.sql.includes('FROM wac_history wh')));
});
