'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const app=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
function segment(start,end){
 const a=app.indexOf(start),b=app.indexOf(end,a);
 assert(a>=0&&b>a,'missing production function '+start);return app.slice(a,b);
}
const exportFn=segment('async function rpDoExportExcel(){','// 构建单个 Tab 的 {name, headers, rows}');
const sheetFn=segment('async function rpSheetModel(tab){','// 展示层转换：把页面现有列渲染器');
const totalFn=segment('async function loadRp(){','    // 列渲染器');
const channelFn=segment('async function loadRpChannelMonthly(channel){','    // 列渲染器 — key 必须');
const data=[{id:'s1',sku_code:'SKU-ONE',model:'MODEL-A'}];
function harness({rows=data,ready=true,selected=['total','online','offline']}={}){
 const events=[],toast=[],alerts=[],written=[],book=[];
 const check=new Set(selected);
 const ctx={
  t:(_,fallback)=>fallback,
  window:{},
  document:{getElementById:(id)=>({checked:check.has(id.slice('rp-exp-'.length))})},
  closeModal:()=>events.push('modal-close'),
  showToast:(...x)=>toast.push(x),
  showFlash:(...x)=>alerts.push(x),
  rpEnsureSnapshotReady:async()=>{events.push('snapshot-ready');return ready;},
  rpLocalSnapshotRows:()=>{events.push('snapshot-rows');return rows;},
  rpFetchCached:()=>{throw Error('legacy separate rows request forbidden');},
  rpBaseUrl:()=>{throw Error('legacy URL forbidden');},
  loadRp:async(modelOnly)=>{
   assert.equal(modelOnly,true,'total export must not render DOM');
   events.push('hydrate-total');
   rows.forEach(r=>r._totalC={qty:21});
  },
  loadRpChannelMonthly:async(tab,modelOnly)=>{
   assert.equal(modelOnly,true,'channel export must not render DOM');
   events.push('hydrate-'+tab);
   rows.forEach(r=>{r._channelC=r._channelC||{};r._channelC[tab]={qty:tab==='online'?12:9};});
  },
  getRpColConfig:tab=>[
   {key:'check',visible:true,label:'Selection'},
   {key:'sku',visible:true,label:'SKU'},
   {key:'qty',visible:true,label:'Qty'},
   {key:'hide',visible:false,label:'Secret'},
   {key:'actions',visible:true,label:'Action'}],
  rpCellText:(tab,key,r,c)=>key==='sku'?r.sku_code:key==='qty'?String(c.qty):'unexpected:'+key,
  XLSX:{utils:{
   book_new:()=>({sheets:[]}),
   aoa_to_sheet:aoa=>aoa,
   book_append_sheet:(w,sheet,name)=>{book.push({name,sheet});w.sheets.push({name,sheet});}
  },writeFile:(w,name)=>written.push({name,sheets:w.sheets})}
 };
 const api=vm.runInNewContext(sheetFn+'\n'+exportFn+'\n({rpSheetModel,rpDoExportExcel})',ctx);
 return {api,events,toast,alerts,written,book,ctx};
}
test('first visit: total/online/offline export 3 populated sheets from the same L0 row objects',async()=>{
 const h=harness();
 await h.api.rpDoExportExcel();
 assert.deepEqual(h.events,['modal-close','snapshot-ready','snapshot-rows','hydrate-total','snapshot-ready','snapshot-rows','hydrate-online','snapshot-ready','snapshot-rows','hydrate-offline']);
 assert.equal(h.written.length,1);
 assert.deepEqual(h.book.map(x=>x.name),['总预测','线上预测','线下预测']);
 assert.deepEqual(h.book.map(x=>Array.from(x.sheet[1])),[['SKU-ONE','21'],['SKU-ONE','12'],['SKU-ONE','9']]);
 assert.deepEqual(Array.from(h.book[0].sheet[0]),['SKU','Qty']);
 assert.equal(h.alerts.length,0);
});
test('already-hydrated views are reused, with no new load or extra HTTP/cache request',async()=>{
 const rows=[{id:'2',sku_code:'ABC',_totalC:{qty:7},_channelC:{online:{qty:3},offline:{qty:4}}}];
 const h=harness({rows});
 await h.api.rpDoExportExcel();
 assert.equal(h.events.filter(x=>x.startsWith('hydrate-')).length,0);
 assert.equal(h.book.length,3);
 assert.deepEqual(h.book.map(x=>x.sheet[1][1]),['7','3','4']);
});
test('exporting a single sheet only hydrates requested dimension, never other channels',async()=>{
 const h=harness({rows:[{sku_code:'X'}],selected:['online']});
 await h.api.rpDoExportExcel();
 assert.deepEqual(h.book.map(x=>x.name),['线上预测']);
 assert.deepEqual(h.events.filter(x=>x.startsWith('hydrate-')),['hydrate-online']);
});
test('an empty filter legitimately exports header-only workbook',async()=>{
 const h=harness({rows:[]});
 await h.api.rpDoExportExcel();
 assert.equal(h.book.length,3);
 assert(h.book.every(s=>s.sheet.length===1));
 assert.equal(h.alerts.length,0);
});
test('snapshot unavailable fails visibly instead of exporting stale or empty copies',async()=>{
 const h=harness({rows:[{sku_code:'X'}],ready:false});
 await h.api.rpDoExportExcel();
 assert.equal(h.written.length,0);
 assert.equal(h.alerts.length,1);
 assert.match(h.alerts[0][0],/数据未就绪/);
});
test('real projection builders have export-only early returns before table/DOM creation',()=>{
 assert.match(totalFn,/var modelOnly=arguments\[0\]===true/);
 assert.match(totalFn,/if\(modelOnly\)return/);
 assert.match(channelFn,/var modelOnly=arguments\[1\]===true/);
 assert.match(channelFn,/if\(modelOnly\)return/);
 assert.doesNotMatch(totalFn,/rpStoreViewNode|container\.innerHTML/);
 assert.doesNotMatch(channelFn,/rpStoreViewNode|container\.innerHTML/);
 assert.doesNotMatch(sheetFn,/var data=await rpFetchCached\(/);
 assert.match(sheetFn,/var data=rpLocalSnapshotRows\(\)/);
});

function derivedPrefix(startMarker,endMarker){
 const start=app.indexOf(startMarker),end=app.indexOf(endMarker,start);
 assert(start>=0&&end>start);
 return app.slice(start,end)+'\n  }catch(e){throw e;}\n}\n';
}
test('actual total/monthly and channel/monthly builders generate projections without DOM writes',async()=>{
 const row={id:'rp-row-a',sku_code:'RSKU-A',country:'Indonesia',
  avg_sales_4m:30,avg_sales_period:30,online_avg_sales_4m:12,online_avg_sales_period:12,
  offline_avg_sales_4m:18,offline_avg_sales_period:18,
  available_qty:60,in_transit_qty:20,pi_confirmed_unshipped_qty:4,
  total_inventory_pool:84,po_unconfirmed_pi_qty:3,suggested_qty:5,
  online_sales_m1:7,offline_sales_m1:8,
  online_suggested_qty:2,offline_suggested_qty:3,
  online_target_turnover:2,offline_target_turnover:4,
  manual_online_transit_qty:0,manual_offline_transit_qty:0,_recalcInFlight:true,
  channel_allocation_status:'allocated',resolved_online_pct:40};
 const snapshot={rows:[row],monthlySales:{'RSKU-A|Indonesia':{'2026-10':8}}};
 const ctx={window:{_rpSnapshot:snapshot,_rpRowData:{},_rpChannelData:{}},
   document:new Proxy({},{get(_obj,k){throw Error('Forbidden DOM access: '+String(k));}}),
   rpMode:'monthly',rpTab:'total',RP_PERF:false,rpSalesStatsDays:90,
   rpCurrentViewKey:()=> 'total.monthly',
   rpEnsureSnapshotReady:async()=>true,rpLocalSnapshotRows:()=>snapshot.rows,
   getSalesStatsDays:async()=>90,
   rpGetEffectiveSuggestedQty:(tab,row)=>tab==='online'?row.online_suggested_qty:row.offline_suggested_qty,
   rpComputeChannelAfterOrderTurnover:(c,q)=>Math.round((c.poolAllocatedPeriod+q)/Math.max(c.avgSalesPeriod,1)*10)/10,
   formatMonthLabel:(year,month)=>String(year)+'-'+String(month).padStart(2,'0'),
   t:(_k,v)=>v,showFlash:(error)=>{throw Error('Model builder failed: '+error);},
   rpGetEffectiveSuggestedQtyForTests:()=>0};
 const real=vm.runInNewContext(
   derivedPrefix('async function loadRp(){','    // 列渲染器\n    var Cols={')+
   derivedPrefix('async function loadRpChannelMonthly(channel){','    // 列渲染器 — key 必须'),
   ctx);
 await ctx.loadRp(true);
 assert.equal(row._totalC.pool,84);
 assert.equal(row._totalC.sq,5);
 assert.equal(row._totalC.oaPeriod,12);
 await ctx.loadRpChannelMonthly('online',true);
 await ctx.loadRpChannelMonthly('offline',true);
 assert.equal(row._channelC.online.suggestedQty,2);
 assert.equal(row._channelC.offline.suggestedQty,3);
 assert.equal(row._channelC.online.salesM1,7);
 assert.equal(row._channelC.offline.salesM1,8);
 assert.deepEqual(Object.keys(ctx.window._rpChannelData),[],'export must not overwrite channel editing caches');
 assert.deepEqual(Object.keys(ctx.window._rpRowData),[],'export must not overwrite total editing cache');
 assert.equal(row._recalcInFlight,true,'export must preserve in-flight save flag');
});

test('real XLSX library writes a readable workbook with all three forecast sheets',async()=>{
 const h=harness({rows:[{sku_code:'SKU-A'},{sku_code:'SKU-B'}]});
 await h.api.rpDoExportExcel();
 const XLSX=require('xlsx'),os=require('node:os');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rp-excel-export-'));
 try{
  const wb=XLSX.utils.book_new();
  h.book.forEach(s=>XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(s.sheet),s.name));
  const file=path.join(dir,'forecast.xlsx');
  XLSX.writeFile(wb,file);
  assert(fs.statSync(file).size>1000,'actual .xlsx must contain content');
  const decoded=XLSX.readFile(file);
  assert.deepEqual(decoded.SheetNames,['总预测','线上预测','线下预测']);
  for(const name of decoded.SheetNames){
   const rows=XLSX.utils.sheet_to_json(decoded.Sheets[name],{header:1});
   assert.equal(rows.length,3);
   assert.equal(rows[1][0],'SKU-A');
   assert.equal(rows[2][0],'SKU-B');
  }
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
