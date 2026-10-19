'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const app=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
const server=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
function between(text,start,end){
 const a=text.indexOf(start),b=text.indexOf(end,a);
 assert.ok(a>0&&b>a,'missing source: '+start);return text.slice(a,b);
}
const frontendSrc=[
 between(app,'let _piPOSelectSeq=0;','// 国家 → 仓库联动'),
 between(app,'function onPICountryChange(){','// 设置/恢复 国家+仓库'),
 between(app,'async function loadPOForPI(){','function computePODiff(')
].join('\n');
const poList=[
 {id:'po-ri',po_no:'RI-01',supplier_id:'r',supplier_name:'Redragon',country:'印度尼西亚',currency:'RMB',target_warehouse:'Bekasi',brand:'Redragon',items:[{sku_code:'M724',po_qty:50,unit_price:1}]},
 {id:'po-rt',po_no:'RT-02',supplier_id:'r',supplier_name:'Redragon',country:'泰国',currency:'USD',target_warehouse:'Bangkok',brand:'Redragon',items:[{sku_code:'M816',po_qty:10,unit_price:2}]},
 {id:'po-r2',po_no:'RT-03',supplier_id:'r',supplier_name:'Redragon',country:'泰国',currency:'USD',target_warehouse:'Bangkok',brand:'Redragon',items:[{sku_code:'M995',po_qty:20,unit_price:3}]},
 {id:'po-nt',po_no:'NT-04',supplier_id:'n',supplier_name:'Netac',country:'泰国',currency:'RMB',target_warehouse:'Bangkok',brand:'Netac',items:[{sku_code:'N1',po_qty:20,unit_price:5}]}
];
function select(items,value){
 let options=(items||[{value:'',dataset:{}}]).map(x=>({...x,dataset:x.dataset||{}})),v=value||'';
 const el={disabled:false,title:'',
  insertAdjacentHTML(where,html){
    assert.equal(where,'beforeend');
    const prev=v;
    this.innerHTML=this.innerHTML+html;
    v=prev;
  },
  get value(){return v;},set value(next){v=String(next||'');},
  get options(){return options;},set options(v){options=v;},
  get selectedIndex(){const i=options.findIndex(x=>x.value===v);return i>=0?i:0;},
  get innerHTML(){return options.map(x=>'<option value="'+x.value+'">'+x.value+'</option>').join('');},
  set innerHTML(html){
   options=[...html.matchAll(/<option value="([^"]*)"([^>]*)>(.*?)<\/option>/g)].map(m=>({
     value:m[1],textContent:m[3],dataset:{
       no:(m[2].match(/data-no="([^"]*)"/)||[])[1]||'',
       name:(m[2].match(/data-name="([^"]*)"/)||[])[1]||''
     }}));
   v=options[0]?.value||'';
  }
 };
 return el;
}
function harness({deferPO=false}={}){
 const el={
  'npi-po':select(),'npi-sup':select([
     {value:'',dataset:{name:''}},
     {value:'r',dataset:{name:'Redragon'}},
     {value:'n',dataset:{name:'Netac'}}
   ],''),
  'npi-country':select([{value:''},{value:'泰国'},{value:'印度尼西亚'},{value:'马来西亚'}],''),
  'npi-wh':select(),'npi-brand':select(),'npi-cur':select([{value:'USD'},{value:'RMB'}],'USD'),
  'npi-terms':select()
 };
 const pending=[],calls=[],toast=[],renders=[];
 const ctx={
  window:{_piApprovedPOs:poList.map(p=>({...p})),_piRows:[],_poRef:null},
  document:{getElementById:id=>el[id]||null},
  t:(key,s)=>s||key,esc:v=>String(v??''),showToast:(...args)=>toast.push(args),
  setPICountryWarehouseEditable(editable){for(const k of ['npi-country','npi-wh','npi-brand'])el[k].disabled=!editable;},
  renderCmpTable(){renders.push(ctx.window._piRows.map(r=>r.sku));},
  async populatePIWarehouse(country){
   el['npi-wh'].innerHTML='<option value=""></option>'+
     (country?'<option value="Bangkok">Bangkok</option><option value="Bekasi">Bekasi</option>':'');
  },
  api:(url)=>{
   calls.push(url);
   if(url.includes('/payment-terms'))return Promise.resolve([]);
   const id=url.split('/').at(-1),po=poList.find(p=>p.id===id);
   if(deferPO)return new Promise(resolve=>pending.push({id,resolve}));
   return Promise.resolve(po);
  }
 };
 vm.createContext(ctx);vm.runInContext(frontendSrc,ctx);
 const flush=async()=>{for(let i=0;i<4;i++)await new Promise(resolve=>setImmediate(resolve));};
 return {ctx,el,calls,toast,pending,renders,flush};
}
test('PO options require BOTH supplier and country; filter by ID and country, never default-select',()=>{
 const {ctx,el}=harness();
 ctx.refreshAvailablePOForPI();
 assert.equal(el['npi-po'].disabled,true);
 assert.equal(el['npi-po'].options.length,1);
 el['npi-sup'].value='r';ctx.refreshAvailablePOForPI();
 assert.equal(el['npi-po'].options.length,1);
 el['npi-country'].value='泰国';ctx.refreshAvailablePOForPI();
 assert.deepEqual(el['npi-po'].options.slice(1).map(x=>x.value),['po-rt','po-r2']);
 assert.equal(el['npi-po'].value,'');
 assert.equal(el['npi-po'].disabled,false);
 assert.ok(!el['npi-po'].innerHTML.includes('RI-01'));
 assert.ok(!el['npi-po'].innerHTML.includes('NT-04'));
});
test('changing supplier clears stale PO, resets PO rows and restores locked fields',async()=>{
 const {ctx,el,flush}=harness();
 el['npi-country'].value='泰国';el['npi-sup'].value='r';
 ctx.refreshAvailablePOForPI();el['npi-po'].value='po-rt';
 await ctx.loadPOForPI();await flush();
 assert.equal(el['npi-country'].disabled,true,JSON.stringify({po:el['npi-po'].value,sup:el['npi-sup'].value,toast:ctx._debug||[],rows:ctx.window._piRows}));
 assert.equal(ctx.window._piRows.length,1);
 ctx.window._piRows.push({sku:'extra',fromPO:false});
 el['npi-sup'].value='n';await ctx.onPISupplierChange();await flush();
 assert.equal(el['npi-po'].value,'');
 assert.deepEqual(el['npi-po'].options.map(x=>x.value),['','po-nt']);
 assert.deepEqual(ctx.window._piRows.map(x=>x.sku),['extra']);
 assert.equal(ctx.window._poRef,null);
 assert.equal(el['npi-country'].disabled,false);
 assert.equal(el['npi-country'].value,'泰国');
 assert.equal(el['npi-cur'].disabled,false);
});
test('country switch rebuilds PO list and discards mismatching association',async()=>{
 const {ctx,el,flush}=harness();
 el['npi-sup'].value='r';el['npi-country'].value='泰国';
 ctx.refreshAvailablePOForPI();el['npi-po'].value='po-rt';
 await ctx.loadPOForPI();await flush();
 el['npi-country'].value='印度尼西亚';
 ctx.onPICountryChange();await flush();
 assert.deepEqual(el['npi-po'].options.map(x=>x.value),['','po-ri']);
 assert.equal(el['npi-po'].value,'');
 assert.equal(el['npi-country'].disabled,false);
});
test('legacy blank supplier ID may match exact name only; mismatched supplier never matches',()=>{
 const {ctx,el}=harness();
 ctx.window._piApprovedPOs=[{id:'legacy',po_no:'HIST-1',supplier_id:'',
   supplier_name:'Redragon',country:'泰国'},
  {id:'wrong',po_no:'WRONG',supplier_id:'n',supplier_name:'Redragon',country:'泰国'}];
 el['npi-country'].value='泰国';el['npi-sup'].value='r';ctx.refreshAvailablePOForPI();
 assert.deepEqual(el['npi-po'].options.map(o=>o.value),['','legacy']);
});
test('re-selecting no PO removes linked rows and restores independent PI country',async()=>{
 const {ctx,el,flush}=harness();
 el['npi-country'].value='泰国';el['npi-sup'].value='r';ctx.refreshAvailablePOForPI();
 el['npi-po'].value='po-rt';await ctx.loadPOForPI();await flush();
 el['npi-po'].value='';await ctx.loadPOForPI();
 assert.equal(el['npi-country'].value,'');
 assert.equal(el['npi-country'].disabled,false);
 assert.equal(ctx.window._piRows.length,0);
 assert.equal(el['npi-po'].disabled,true);
});
test('PO detail response for a superseded selection cannot overwrite PI rows',async()=>{
 const {ctx,el,pending,flush}=harness({deferPO:true});
 el['npi-country'].value='泰国';el['npi-sup'].value='r';ctx.refreshAvailablePOForPI();
 el['npi-po'].value='po-rt';const old=ctx.loadPOForPI();
 el['npi-po'].value='po-r2';const latest=ctx.loadPOForPI();
 assert.deepEqual(pending.map(p=>p.id),['po-rt','po-r2']);
 pending[1].resolve(poList.find(p=>p.id==='po-r2'));await latest;await flush();
 pending[0].resolve(poList.find(p=>p.id==='po-rt'));await old;await flush();
 assert.equal(el['npi-po'].value,'po-r2');
 assert.deepEqual(ctx.window._piRows.map(r=>r.sku),['M995'],JSON.stringify({value:el['npi-po'].value,pending,rows:ctx.window._piRows}));
});
test('unlisted PO is rejected by frontend detail loader before any GET',async()=>{
 const {ctx,el,calls,toast}=harness();
 el['npi-sup'].value='r';el['npi-country'].value='泰国';ctx.refreshAvailablePOForPI();
 el['npi-po'].value='po-nt';
 await ctx.loadPOForPI();
 assert.equal(calls.filter(x=>x.includes('/purchase-orders/')).length,0);
 assert.equal(el['npi-po'].value,'');
 assert.equal(toast.length,1);
});
function preflight(po,d){
 const start=server.indexOf("app.post('/api/proforma-invoices',");
 const first=server.indexOf('    const d = req.body;',start);
 const end=server.indexOf('    // 关联 PO 时锁定币种',first);
 assert.ok(start>0&&first>start&&end>first);
 const prefix=server.slice(first,end);
 assert.doesNotMatch(prefix,/\btransaction\(/);
 const ctx={queryOne(){return po;},piMultiPO:require('../assets/pi-multi-po-core')};
 const fn=vm.runInNewContext('(async function(req,res){'+prefix+'return res.json({accepted:true});})',ctx);
 const res={code:200,status(c){this.code=c;return this;},json(x){return {code:this.code,...x};}};
 return fn({body:d},res);
}
const form=(patch={})=>({related_po_id:'po-rt',supplier_id:'r',supplier_name:'Redragon',country:'泰国',currency:'USD',...patch});
const record={id:'po-rt',supplier_id:'r',supplier_name:'Redragon',country:'泰国',approval_status:'approved',currency:'USD'};
test('backend refuses cross-country and cross-supplier PO links before writes',async()=>{
 assert.equal((await preflight(record,form({country:'印度尼西亚'}))).code,400);
 assert.equal((await preflight(record,form({supplier_id:'n'}))).code,400);
 assert.equal((await preflight(record,form({country:''}))).code,400);
 assert.equal((await preflight(record,form())).accepted,true);
 assert.equal((await preflight(null,form())).code,400);
 assert.equal((await preflight({...record,approval_status:'pending'},form())).code,400);
});
test('backend supports legacy PO with no supplier_id, requires exact name',async()=>{
 assert.equal((await preflight({...record,supplier_id:''},form())).accepted,true);
 assert.equal((await preflight({...record,supplier_id:''},form({supplier_name:'Other'}))).code,400);
});

test('saving a forged/stale PO reference is blocked client-side before POST',async()=>{
 const {ctx,el,calls,toast}=harness();
 const saveSrc=between(app,'async function saveNewPI(){','async function createDepPay(');
 vm.runInContext(saveSrc,ctx);
 Object.assign(el,{
  'btn-save-new-pi':{disabled:false,textContent:'创建'},
  'npi-no':{value:''},'npi-date':{value:'2026-10-19'},
  'npi-need-dep':{value:'0'},'npi-dep':{value:'0'},'npi-del':{value:''}
 });
 el['npi-sup'].value='r';
 el['npi-country'].value='泰国';
 ctx.refreshAvailablePOForPI();
 el['npi-po'].value='po-nt';
 await ctx.saveNewPI();
 assert.ok(toast.some(x=>x[1]==='warning'));
 assert.equal(el['btn-save-new-pi'].disabled,false);
 assert.equal(calls.filter(x=>x==='/api/proforma-invoices').length,0);
});
test('valid mismatched-country normalization and standalone PI keep correct backend behavior',async()=>{
 assert.equal((await preflight(record,form({country:' 泰国 '}))).accepted,true);
 assert.equal((await preflight(record,form({country:'马来西亚'}))).code,400);
 assert.equal((await preflight(record,form({country:'印度尼西亚'}))).error.includes('国家'),true);
 assert.equal((await preflight(null,form({related_po_id:''}))).accepted,true);
});
test('create PI initializes PO filtering after country/supplier masters arrive',()=>{
 const src=between(app,'let _piCreateEpoch=0;','// Only PO with the selected country');
 assert.match(src,/window\._piApprovedPOs=pos/);
 assert.match(src,/refreshAvailablePOForPI\(\); \/\/ no PO selectable/);
 assert.match(src,/createEpoch!==_piCreateEpoch/);
 assert.match(src,/api\('\/api\/purchase-orders'\)/);
});
