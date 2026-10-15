'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const src=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
const start=src.indexOf('async function requestSalesPreview(){'),end=src.indexOf('function renderSalesPreview(records){',start);
assert(start>=0&&end>start,'real preview handler unavailable');
function harness(response,reject=false){
 const btn={disabled:false}, preview={innerHTML:'',querySelector:()=>null};
 const messages=[];
 const sample=[{source_system:'Bigseller',order_no:'ORD-1',sku_code:'SKU-1',brand:'Boya',_errors:[]}];
 const context={
  window:{_salesImportData:sample},document:{getElementById:id=>({'sales-import-btn':btn,'sales-preview-stats':preview})[id]||null},
  SALES_IMPORT_COLUMNS:[{key:'source_system'},{key:'order_no'},{key:'sku_code'},{key:'brand'}],
  api:async()=>{if(reject)throw Error('Network failed');return response;},
  t:(key,fallback)=>fallback,esc:String,
  showToast:(...args)=>messages.push(args)
 };
 const run=vm.runInNewContext(src.slice(start,end)+'\nrequestSalesPreview',context);
 return {run,btn,preview,messages,context};
}
test('invalid warehouse brand blocks UI submit and offers row-level downloadable errors',async()=>{
 const h=harness({preview:[{action:'failed',errors:['品牌不匹配']}],
   blocking:[{row:2,sku_code:'SKU-1',reason:'品牌与 SKU 主数据不一致：Boya / Redragon'}],warnings:[]});
 await h.run();
 assert.equal(h.btn.disabled,true);
 assert.equal(h.context.window._salesImportPreviewReady,false);
 assert.match(h.preview.innerHTML,/整批禁止导入/);
 assert.match(h.preview.innerHTML,/SKU-1/);
 assert.match(h.preview.innerHTML,/下载错误清单/);
 assert.deepEqual(JSON.parse(JSON.stringify(h.context.window._lastSalesImportErrors)),[{row:2,reason:'品牌与 SKU 主数据不一致：Boya / Redragon'}]);
});
test('case-only aliases warn, but preview enables submission after authoritative validation',async()=>{
 const h=harness({preview:[{action:'insert',errors:[]}],blocking:[],warnings:[{row:2,sku_code:'SKU-1',from:'Boya',to:'BOYA'}]});
 await h.run();
 assert.equal(h.btn.disabled,false);
 assert.equal(h.context.window._salesImportPreviewReady,true);
 assert.match(h.preview.innerHTML,/已自动规范 1 条品牌/);
 assert.match(h.preview.innerHTML,/Boya → BOYA/);
});
test('network or auth failure fail-closes submission',async()=>{
 const h=harness({},true);
 await h.run();
 assert.equal(h.btn.disabled,true);
 assert.equal(h.context.window._salesImportPreviewReady,false);
 assert.equal(h.messages.length,1);
});
