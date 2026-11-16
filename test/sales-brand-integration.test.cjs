'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),Database=require('better-sqlite3');
const {createSqliteSalesImportAdapter,executeSalesImport,previewSalesImport}=require('../sales-import-service');
const base={source_system:'Bigseller',order_date:'2026-10-15',country:'印度尼西亚',shop_platform:'线上渠道',quantity:1,brand:'Boya',sku_code:'SKU-B'};
function row(i,o={}){return {...base,order_no:'BS-'+i,...o};}
function dbFactory(){
 const raw=new Database(':memory:');
 raw.exec([
 'CREATE TABLE skus(sku_code TEXT PRIMARY KEY,brand TEXT);',
 "INSERT INTO skus VALUES ('SKU-B','BOYA'),('SKU-R','Redragon'),('SKU-EMPTY','');",
 'CREATE TABLE sales_records (',
 " id TEXT PRIMARY KEY,source_system TEXT,order_no TEXT,order_detail_id TEXT DEFAULT '',",
 " order_date TEXT,shop_platform TEXT DEFAULT '',brand TEXT DEFAULT '',sku_code TEXT,",
 ' quantity INTEGER,is_valid_order INTEGER,original_order_status TEXT,remark TEXT,',
 ' import_batch_id TEXT,country TEXT,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,created_at TEXT DEFAULT CURRENT_TIMESTAMP',
 ');'
 ].join('\n'));
 const db={getDB:()=>raw,query:(sql,args=[])=>({rows:raw.prepare(sql).all(...args)}),
   run:(sql,args=[])=>raw.prepare(sql).run(...args)};
 return {raw,adapter:createSqliteSalesImportAdapter(db)};
}
test('real SQLite: preview and committed import both use canonical BOYA without touching unrelated fields',async()=>{
 const {raw,adapter}=dbFactory();
 try{
  const inputs=[row(1),row(2,{brand:'BOYA'}),row(3,{brand:''})];
  const prev=await previewSalesImport(adapter,inputs);
  assert.equal(prev.blocking.length,0);
  assert.equal(prev.warnings.length,2);
  const result=await executeSalesImport(adapter,inputs,{importBatchId:'IMPORT-TEST',idFactory:r=>'sale-'+r.input_order});
  assert.equal(result.result.inserted,3);
  const entries=raw.prepare('SELECT brand,order_no,quantity,country FROM sales_records ORDER BY order_no').all();
  assert.deepEqual(entries.map(r=>r.brand),['BOYA','BOYA','BOYA']);
  assert(entries.every(r=>r.country==='印度尼西亚'&&r.quantity===1));
 }finally{raw.close();}
});
test('real SQLite: wrong warehouse-brand row is skipped while valid row commits',async()=>{
 const {raw,adapter}=dbFactory();
 try{
  const inputs=[row(1),row(2,{sku_code:'SKU-R',brand:'Redragon Warehouse'})];
  const pre=await previewSalesImport(adapter,inputs);
  assert.equal(pre.blocking.length,1);
  assert.deepEqual(pre.preview.map(item=>item.action),['insert','failed']);
  const result=await executeSalesImport(adapter,inputs,{importBatchId:'PARTIAL-IMPORT'});
  assert.equal(result.result.inserted,1);
  assert.equal(result.result.updated,0);
  assert.equal(result.result.failed,1);
  assert.match(result.result.errors[0].reason,/品牌与 SKU 主数据不一致/);
  const entries=raw.prepare('SELECT order_no,sku_code,brand FROM sales_records').all();
  assert.deepEqual(entries,[{order_no:'BS-1',sku_code:'SKU-B',brand:'BOYA'}]);
 }finally{raw.close();}
});
test('real SQLite: missing and empty SKU masters are skipped while valid rows commit',async()=>{
 const {raw,adapter}=dbFactory();
 try{
  const result=await executeSalesImport(adapter,[
   row(1,{sku_code:'SKU-MISSING'}),
   row(2,{sku_code:'SKU-EMPTY'}),
   row(3)
  ]);
  assert.equal(result.result.inserted,1);
  assert.equal(result.result.failed,2);
  assert.equal(result.result.errors.length,2);
  assert.match(result.result.errors[0].reason,/SKU 主数据不存在/);
  assert.match(result.result.errors[1].reason,/SKU 主数据品牌为空/);
  const entries=raw.prepare('SELECT sku_code FROM sales_records').all();
  assert.deepEqual(entries,[{sku_code:'SKU-B'}]);
 }finally{raw.close();}
});
