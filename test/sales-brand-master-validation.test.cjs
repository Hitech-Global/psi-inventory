'use strict';
const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path');
const {
 validateSalesBrandRows,normalizeSalesRows,executeSalesImport,previewSalesImport,
 createSqliteSalesImportAdapter,createPostgresSalesImportAdapter,SalesBrandPrecheckError
}=require('../sales-import-service.js');
const base={source_system:'Bigseller',order_no:'SALES-1',order_date:'2026-10-15',country:'印度尼西亚',sku_code:'SKU-B',quantity:1,brand:'BOYA'};
function row(values={}){return {...base,...values};}
function mock(masters){
 const events=[],adapter={
   metrics:{},transaction:async fn=>{events.push('transaction');return fn();},
   loadSkuBrands:async rows=>{events.push('masters');return new Map([...masters].map(([sku,brand])=>[sku,{sku_code:sku,brand}]));},
   stageRows:async()=>events.push('stage'),loadCandidates:async()=>[],
   writePlan:async()=>events.push('write')
 };return {adapter,events};
}
test('case-only BOYA/Boya canonicalization and blank brand use actual SKU master in both preview and apply',async()=>{
 const master=new Map([['SKU-B','BOYA']]);
 const inputs=[row({brand:'Boya'}),row({order_no:'SALES-2',brand:'bOyA'}),row({order_no:'SALES-3',brand:''})];
 const x=mock(master);
 const preview=await previewSalesImport(x.adapter,inputs);
 assert.equal(preview.blocking.length,0);
 assert.equal(preview.warnings.length,3);
 assert.deepEqual(preview.preview.map(x=>x.brand),['BOYA','BOYA','BOYA']);
 assert.equal(preview.preview.every(x=>x.warnings.length===1),true);
 const y=mock(master);
 const run=await executeSalesImport(y.adapter,inputs,{importBatchId:'isolated',idFactory:()=>String(Math.random())});
 assert.equal(run.result.inserted,3);
 assert.deepEqual(run.rows.map(x=>x.brand),['BOYA','BOYA','BOYA']);
 assert(y.events.indexOf('masters')<y.events.indexOf('transaction'),'validation must precede transaction');
 assert(y.events.includes('write'));
});
test('a wrong brand in ANY row blocks the entire import before staging and writing',async()=>{
 const m=mock(new Map([['SKU-B','BOYA'],['SKU-R','Redragon']]));
 const items=[row(),row({brand:'Redragon Warehouse',sku_code:'SKU-R',order_no:'SALES-2'})];
 const v=await previewSalesImport(m.adapter,items);
 assert.equal(v.blocking.length,1);
 assert.match(v.blocking[0].reason,/导入「Redragon Warehouse」，主数据「Redragon」/);
 assert.deepEqual(v.preview.map(p=>p.action),['insert','failed']);
 const a=mock(new Map([['SKU-B','BOYA'],['SKU-R','Redragon']]));
 await assert.rejects(executeSalesImport(a.adapter,items),err=>{
  assert(err instanceof SalesBrandPrecheckError);
  assert.equal(err.status,422);assert.equal(err.rowErrors[0].row,3);return true;
 });
 assert.deepEqual(a.events,['masters'],'no transaction or sales mutations on any blocking row');
});
test('missing SKU master and blank canonical SKU brand fail with row-specific messages',async()=>{
 const x=mock(new Map([['SKU-B','']]));
 const v=await previewSalesImport(x.adapter,[row(),row({sku_code:'NO-MASTER',order_no:'N2'})]);
 assert.equal(v.blocking.length,2);
 assert.match(v.blocking[0].reason,/主数据品牌为空/);
 assert.match(v.blocking[1].reason,/SKU 主数据不存在/);
});
test('non-case mismatched brands are never auto-normalized and cross-brand SKU mismatch fails',async()=>{
 const x=mock(new Map([['SKU-B','Redragon']]));
 const v=await previewSalesImport(x.adapter,[row({brand:'Boya'})]);
 assert.equal(v.blocking.length,1);assert.equal(v.warnings.length,0);
 assert.equal(v.preview[0].brand,'Boya');
});
test('batch SKU lookup is deduped and chunked, for both SQLite and PG',async()=>{
 const sqlCalls=[];
 const db={
  query:(sql,args)=>{sqlCalls.push({sql,args});return {rows:args.map(s=>({sku_code:s,brand:'BOYA'}))};},
  run:()=>{},getDB:()=>({exec:()=>{}})
 };
 const sq=createSqliteSalesImportAdapter(db);
 const inputs=Array.from({length:1050},(_,i)=>({sku_code:'sku'+i}));
 const sm=await sq.loadSkuBrands(inputs.concat(inputs[0]));
 assert.equal(sm.size,1050);assert.equal(sqlCalls.length,3);
 assert(sqlCalls.every(call=>call.args.length<=450));
 const pgCalls=[];
 const pg=createPostgresSalesImportAdapter({
   query:async(sql,args)=>{pgCalls.push({sql,args});return {rows:args.map(s=>({sku_code:s,brand:'BOYA'}))};},
   run:async()=>{}
 });
 assert.equal((await pg.loadSkuBrands(inputs)).size,1050);
 assert.equal(pgCalls.length,3);
});
test('server read filter and import preflight use master brand without removing role data scope',()=>{
 const server=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
 const app=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
 assert(server.includes("SELECT DISTINCT s.brand FROM sales_records sr JOIN skus s ON s.sku_code = sr.sku_code"));
 assert(server.includes("const brandScope = buildSalesDataScopeFilter(req, 'sr')"));
 assert(server.includes("sr.sku_code IN (SELECT sku_code FROM skus WHERE brand = ?)"));
 assert(server.includes("res.status(e instanceof SalesBrandPrecheckError ? 422 : 500)"));
 assert(server.includes('blocking: preview.blocking, warnings: preview.warnings'));
 assert(app.includes('SKU/品牌预检查失败'));
 assert(app.includes('window._salesImportPreviewReady'));
});
