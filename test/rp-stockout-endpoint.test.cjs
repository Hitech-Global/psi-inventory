'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
const from=source.indexOf('const { analyzeStockoutEvidence, dayBefore }');
const to=source.indexOf('// 历史销售查看',from);
assert.ok(from>0&&to>from,'pilot endpoint not found');
const routeCode=source.slice(from,to);
function harness({authorized=true,otherWarehouse=false}={}){
 const calls=[],perms=[];
 let handler=null,body=null,status=200;
 const context={
  require(mod){return require('../assets/rp-stockout-evidence');},
  app:{get(url,...args){assert.equal(url,'/api/replenishment-suggestions/stockout-evidence');handler=args.at(-1);}},
  asyncHandler(fn){return fn;},
  requireApiPermission(name){perms.push(name);return function permission(){};},
  buildReplenishmentDataScopeFilter(){return {sql:' AND s.brand=?',params:['BOYA']};},
  buildSalesDataScopeFilter(){return {sql:' AND sr.brand=?',params:['BOYA']};},
  salesOrderDateExpr(col){return 'substr('+col+',1,10)';},
  query(sql,params){
   calls.push({sql,params});
   assert.match(sql,/^\s*SELECT/i,'endpoint must execute SELECT only');
   if(sql.includes('FROM replenishment_suggestions'))return {rows:authorized&&params[0]!=='BM4094'?[{sku_code:params[0]}]:[]};
   if(sql.includes('FROM inventory_imports WHERE sku_code')&&sql.includes('ORDER BY'))return {rows:[
       {import_date:'2026-10-10',available_qty:50},
       {import_date:'2026-10-01',available_qty:0}]};
   if(sql.includes('FROM sales_records sr'))return {rows:[{day:'2026-10-10',qty:5}]};
   if(sql.includes('FROM inventory\n'))return {rows:otherWarehouse?[{warehouse:'other'}]:[]};
   if(sql.includes('FROM inventory_imports\n'))return {rows:[]};
   throw Error('unexpected sql: '+sql);
  }
 };
 vm.runInNewContext(routeCode,context);
 const req={query:{sku_code:'BM4049',country:'印度尼西亚',warehouse:'Bekasi Warehouse'}};
 const res={status(n){status=n;return this;},json(b){body=b;return this;},set(){return this;}};
 return {calls,perms,req,res,run:()=>handler(req,res),result:()=>({body,status})};
}
test('BM4049 endpoint needs both forecast and inventory permissions; uses SELECT only',()=>{
 const h=harness();h.run();
 assert.deepEqual(h.perms,['replenishment_view','inventory_view']);
 assert.equal(h.result().status,200);
 assert.equal(h.result().body.sku_code,'BM4049');
 assert.equal(h.result().body.evidence.status,'stockout_observed');
 assert.equal(h.result().body.evidence.observedZeroDays,1);
 assert.equal(h.result().body.evidence.referenceMonthlyDemand,null);
 assert.equal(h.calls.length,5);
 assert.ok(h.calls[0].sql.includes('AND s.brand=?'));
 assert.ok(h.calls[2].sql.includes('AND sr.brand=?'));
});
test('no authorized forecast row means no historical stock or sales disclosure',()=>{
 const h=harness({authorized:false});h.run();
 assert.equal(h.result().status,404);
 assert.equal(h.calls.length,1);
});
test('unrelated SKU not accepted and cannot query private data',()=>{
 const h=harness();h.req.query.sku_code='BM4094';h.run();
 assert.equal(h.result().status,404);
 assert.equal(h.calls.length,1);
});
test('warehouse mismatch marks demand reference as incomparable',()=>{
 const h=harness({otherWarehouse:true});h.run();
 assert.equal(h.result().body.evidence.multiWarehouse,true);
 assert.equal(h.result().body.evidence.referenceMonthlyDemand,null);
});
