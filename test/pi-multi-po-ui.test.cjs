'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','assets/pi-multi-po-ui.js'),'utf8');
const PO=[
 {id:'p1',po_no:'PO-1',supplier_id:'s1',supplier_name:'Netac',country:'泰国',brand:'Netac',currency:'RMB',target_warehouse:'Bangkok',approval_status:'approved',po_status:'approved',
  items:[{sku_code:'N1',po_qty:100,transferred_pi_qty:20,unit_price:10},{sku_code:'N2',po_qty:5,transferred_pi_qty:0,unit_price:4}]},
 {id:'p2',po_no:'PO-2',supplier_id:'s1',supplier_name:'Netac',country:'泰国',brand:'Netac',currency:'RMB',target_warehouse:'Bangkok',approval_status:'approved',po_status:'partial_pi',
  items:[{sku_code:'N1',po_qty:50,transferred_pi_qty:10,unit_price:12}]},
 {id:'p3',po_no:'PO-3',supplier_id:'s1',supplier_name:'Netac',country:'泰国',brand:'Netac',currency:'USD',target_warehouse:'Bangkok',approval_status:'approved',po_status:'approved',items:[]},
 {id:'p4',po_no:'PO-4',supplier_id:'s2',supplier_name:'Redragon',country:'印度尼西亚',brand:'Redragon',currency:'RMB',target_warehouse:'Bekasi',approval_status:'approved',po_status:'approved',items:[]}
];
function ui({deferred=false}={}){
 const elements={};
 const add=(id,value='')=>elements[id]={id,value,disabled:false,style:{},innerHTML:'',textContent:'',options:[],
   insertAdjacentHTML(where,html){
     if(where==='afterend')for(const id of ['pi-multi-po-shell','pi-multi-po-count','pi-multi-po-search','pi-multi-po-picker'])
       if(!elements[id])add(id);
     else if(where==='beforeend')this.options.push({value:html.match(/value="([^"]*)"/)?.[1]||''});
   }
 };
 add('npi-po');add('npi-sup','s1');elements['npi-sup'].options=[{value:'',dataset:{name:''}},{value:'s1',dataset:{name:'Netac'}},{value:'s2',dataset:{name:'Redragon'}}];
 Object.defineProperty(elements['npi-sup'],'selectedIndex',{get(){return this.options.findIndex(x=>x.value===this.value)}});
 add('npi-country','泰国');add('npi-wh');add('npi-brand');elements['npi-brand'].options=[{value:'Netac'},{value:'Redragon'}];
 add('npi-cur');add('pi-items');
 let deferredResolves=[],rendered=0,toast=[];
 const window={_piApprovedPOs:PO,_piRows:[],_poRef:[]};
 const doc={getElementById:id=>elements[id]||null};
 const ctx={window,document:doc,piPOCountrySupplierMatch:(po,c,id,name)=>{
  return po.country===c&&po.supplier_id===id;
 },renderCmpTable(){rendered++;},esc:v=>String(v??'').replaceAll('&','&amp;').replaceAll('"','&quot;'),
 showToast:(...arg)=>toast.push(arg),async populatePIWarehouse(country){
  elements['npi-wh'].value=country==='泰国'?'Bangkok':'Bekasi';
 },api:url=>{
   const id=url.split('/').at(-1),po=PO.find(p=>p.id===id);
   if(!deferred)return Promise.resolve(po);
   return new Promise(resolve=>deferredResolves.push({id,resolve}));
 }};
 vm.createContext(ctx);vm.runInContext(source,ctx);
 return {ctx,elements,toast,deferredResolves,rendered:()=>rendered};
}
test('checkbox picker only lists matching supplier/country and includes partially transferred POs',()=>{
 const u=ui();u.ctx.window.PIMultiPO.install();
 assert.match(u.elements['pi-multi-po-picker'].innerHTML,/PO-1/);
 assert.match(u.elements['pi-multi-po-picker'].innerHTML,/PO-2/);
 assert.match(u.elements['pi-multi-po-picker'].innerHTML,/PO-3/);
 assert.doesNotMatch(u.elements['pi-multi-po-picker'].innerHTML,/PO-4/);
 assert.equal(u.elements['npi-po'].style.display,'none');
});
test('two selected PO merge identical SKU and retain only remaining PO quantities',async()=>{
 const u=ui(),f=u.ctx.window.PIMultiPO;f.install();
 await f.toggle('p1',true);
 await f.toggle('p2',true);
 assert.deepEqual([...f.ids()],['p1','p2']);
 const rows=u.ctx.window._piRows;
 assert.equal(rows.filter(x=>x.sku==='N1').length,1);
 assert.equal(rows.find(x=>x.sku==='N1').poQty,120);
 assert.equal(rows.find(x=>x.sku==='N2').poQty,5);
 assert.equal(rows.find(x=>x.sku==='N1').poNos.length,2);
 assert.equal(u.elements['npi-cur'].value,'RMB');
 assert.equal(u.elements['npi-country'].disabled,true);
 assert.equal(u.elements['npi-po'].value,'p1');
 assert.equal(f.loading(),false);
});
test('currency mismatch cannot be selected and supplier switch clears linked source but preserves manual PI lines',async()=>{
 const u=ui(),f=u.ctx.window.PIMultiPO;f.install();
 await f.toggle('p1',true);
 assert.match(u.elements['pi-multi-po-picker'].innerHTML,/disabled/);
 await f.toggle('p3',true);
 assert.deepEqual([...f.ids()],['p1']);
 assert.equal(u.toast.length,1);
 u.ctx.window._piRows.push({sku:'MANUAL',fromPO:false,piQty:4});
 u.elements['npi-sup'].value='s2';u.elements['npi-country'].value='印度尼西亚';
 f.refresh();
 assert.deepEqual([...f.ids()],[]);
 assert.deepEqual(Array.from(u.ctx.window._piRows,x=>x.sku),['MANUAL']);
 assert.equal(u.elements['npi-cur'].disabled,false);
});
test('async request switch discards old PO detail replies',async()=>{
 const u=ui({deferred:true}),f=u.ctx.window.PIMultiPO;f.install();
 const old=f.toggle('p1',true);
 const newer=f.toggle('p2',true);
 assert.deepEqual(u.deferredResolves.map(x=>x.id),['p1','p1','p2']);
 u.deferredResolves[1].resolve(PO[0]);u.deferredResolves[2].resolve(PO[1]);
 await newer;
 u.deferredResolves[0].resolve(PO[0]);await old;
 assert.deepEqual([...f.ids()],['p1','p2']);
 assert.equal(u.ctx.window._piRows.find(x=>x.sku==='N1').poQty,120);
});

test('production case: matching pending PO is visible and disabled beside approved PO',async()=>{
 const u=ui(),f=u.ctx.window.PIMultiPO;
 u.ctx.window._piApprovedPOs.push(
   {...PO[0],id:'pending-plan',po_no:'PO-2026-889314',approval_status:'pending',po_status:'draft'},
   {...PO[0],id:'approved-partial',po_no:'PO-2026-602276',approval_status:'approved',po_status:'partial_pi'}
 );
 f.install();
 const html=u.elements['pi-multi-po-picker'].innerHTML;
 assert.match(html,/PO-2026-889314/);
 assert.match(html,/PO-2026-602276/);
 assert.match(html,/待审批/);
 assert.match(html,/可关联/);
 assert.match(html,/<input[^>]*disabled[^>]*>\s*<span>PO-2026-889314/);
 assert.match(u.elements['pi-multi-po-count'].textContent,/待处理 1 张/);
 await f.toggle('pending-plan',true);
 assert.deepEqual([...f.ids()],[]);
 assert.match(u.toast[0][0],/待审批/);
 await f.toggle('approved-partial',true);
 assert.deepEqual([...f.ids()],['approved-partial']);
});
test('fully transferred, cancelled, and rejected POs remain visible but not selectable',async()=>{
 const u=ui(),f=u.ctx.window.PIMultiPO;
 u.ctx.window._piApprovedPOs.push(
  {...PO[0],id:'finished',po_no:'PO-FULL',po_status:'transferred_pi'},
  {...PO[0],id:'cancelled',po_no:'PO-VOID',po_status:'cancelled'},
  {...PO[0],id:'rejected',po_no:'PO-REJECT',po_status:'rejected',approval_status:'rejected'}
 );
 f.install();
 const html=u.elements['pi-multi-po-picker'].innerHTML;
 assert.match(html,/PO-FULL/);
 assert.match(html,/已全部转PI/);
 assert.match(html,/PO-VOID/);
 assert.match(html,/PO已作废/);
 assert.match(html,/PO-REJECT/);
 assert.match(html,/审批已驳回/);
 await f.toggle('finished',true);
 await f.toggle('cancelled',true);
 await f.toggle('rejected',true);
 assert.deepEqual([...f.ids()],[]);
 assert.equal(u.toast.length,3);
});
test('pending PO does not invalidate an already selected approved PO',async()=>{
 const u=ui(),f=u.ctx.window.PIMultiPO;
 u.ctx.window._piApprovedPOs.push({...PO[0],id:'pending-plan',po_no:'PO-2026-889314',approval_status:'pending',po_status:'draft'});
 f.install();
 await f.toggle('p1',true);
 f.refresh();
 assert.deepEqual([...f.ids()],['p1']);
 assert.equal(u.ctx.window._piRows.length,2);
 assert.match(u.elements['pi-multi-po-picker'].innerHTML,/PO-2026-889314/);
 assert.match(u.elements['pi-multi-po-picker'].innerHTML,/disabled/);
});
