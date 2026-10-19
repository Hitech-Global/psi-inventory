'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
const listStart=app.indexOf('let _poFilterFacetsReady=false;');
const listEnd=app.indexOf('async function viewPO(id){',listStart);
assert.ok(listStart>0&&listEnd>listStart,'PO list code not found');
const poJs=app.slice(listStart,listEnd);
const backendStart=server.indexOf("app.get('/api/purchase-orders',");
const backendEnd=server.indexOf('// PO 待审批列表',backendStart);
assert.ok(backendStart>0&&backendEnd>backendStart,'PO list backend route not found');
function backend(query){
 let handler,sql=null,params=[],result,permission;
 const ctx={
  app:{get(url,...middlewares){assert.equal(url,'/api/purchase-orders');handler=middlewares.at(-1);}},
  requireApiPermission(name){permission=name;return ()=>{};},
  asyncHandler:fn=>fn,
  query(statement,values){sql=statement;params=values;return {rows:[{po_no:'PO-1'}]};}
 };
 vm.runInNewContext(server.slice(backendStart,backendEnd),ctx);
 handler({query},{json(value){result=value;}});
 return {permission,sql,params,result};
}
test('PO backend supports brand/country as bound AND predicates, keeps status/keyword/supplier',()=>{
 const got=backend({status:'approved',supplier_id:'sup1',brand:' Redragon ',country:' 泰国 ',keyword:'PO'});
 assert.equal(got.permission,'po_view');
 assert.match(got.sql,/po\.po_status = \?/);
 assert.match(got.sql,/po\.supplier_id = \?/);
 assert.match(got.sql,/LOWER\(TRIM\(po\.brand\)\) = LOWER\(TRIM\(\?\)\)/);
 assert.match(got.sql,/LOWER\(TRIM\(po\.country\)\) = LOWER\(TRIM\(\?\)\)/);
 assert.match(got.sql,/po\.po_no LIKE \?/);
 assert.deepEqual([...got.params],['approved','sup1','Redragon','泰国','%PO%','%PO%','%PO%']);
 assert.equal(got.result[0].po_no,'PO-1');
});
test('parameterized brand filter cannot inject raw SQL',()=>{
 const injected="Netac' OR 1=1 --";
 const got=backend({brand:injected,country:'印度尼西亚'});
 assert.equal(got.params[0],injected);
 assert.equal(got.params[1],'印度尼西亚');
 assert.ok(!got.sql.includes(injected));
 assert.deepEqual([...backend({}).params],[]);
});
const fixtures=[
 {id:'p1',po_no:'PO1',po_status:'draft',supplier_name:'A',brand:'Netac',country:'印度尼西亚',target_warehouse:'Bekasi Warehouse',currency:'RMB',po_date:'2026-10-01'},
 {id:'p2',po_no:'PO2',po_status:'approved',supplier_name:'B',brand:'Redragon',country:'印度尼西亚',target_warehouse:'Bekasi Warehouse',currency:'RMB',po_date:'2026-10-02'},
 {id:'p3',po_no:'PO3',po_status:'approved',supplier_name:'B',brand:'redragon',country:'泰国',target_warehouse:'BKK',currency:'RMB',po_date:'2026-10-03'},
 {id:'p4',po_no:'PO4',po_status:'approved',supplier_name:'B',brand:'Redragon',country:'马来西亚',target_warehouse:'KUL',currency:'RMB',po_date:'2026-10-04'}
];
function select(){
 let html='<option value="">全部</option>',value='';
 return {get innerHTML(){return html;},set innerHTML(v){html=v;value='';},
   get value(){return value;},set value(v){value=v;}};
}
function frontend({translated=false,deferred=false}={}){
 const els={'content-inner':{innerHTML:''},'po-fs':select(),'po-fk':{value:''},'po-table':{innerHTML:''}};
 let installed=0,errors=[],requests=[],apiResolves=[];
 const actions={insertAdjacentHTML(h,html){
   assert.equal(h,'beforebegin');
   assert.match(html,/po-fb/);assert.match(html,/po-fc/);
   els['po-fb']=select();els['po-fc']=select();installed++;
 }};
 const form={querySelector(selector){
   if(selector==='.filter-actions')return actions;
   if(selector==='#po-fb')return els['po-fb']||null;
   return null;
 }};
 const doc={getElementById:id=>els[id]||null,
   querySelector:selector=>selector==='#content-inner .filter-bar .filter-form'?form:null};
 const store={page:{onRefresh(_name,fn){store.refresh=fn;}}};
 const ctx={document:doc,window:{AppStore:store,__psiPageRenderEpoch:0,__psiPageContent:()=>els['content-inner']},
  t:(key,fallback)=>{
   if(translated&&key==='html.renderPO')
     return '<div class="filter-bar"><div class="filter-form"><div class="filter-actions">Search</div></div></div><div id="po-table"></div>';
   return fallback||key;
  },
  hasPermission:()=>false,
  esc:v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),
  fmtDate:v=>v||'',fmtMoney:v=>String(v),formatQuantityDisplay:v=>String(v),statusLabel:v=>String(v),
  rowClickView(){},showFlash:error=>errors.push(error),
  api:(url,method,_body,config)=>{
    requests.push({url,method,config});
    const params=new URLSearchParams(url.split('?')[1]);
    const values=fixtures.filter(x=>['status','brand','country'].every(key=>{
       const v=params.get(key)||'';
       const attr=key==='status'?'po_status':key;
       return !v||String(x[attr]).toLocaleLowerCase()===v.trim().toLocaleLowerCase();
    }));
    if(deferred)return new Promise(resolve=>apiResolves.push(()=>resolve(values)));
    return Promise.resolve(values);
  }
 };
 vm.createContext(ctx);
 vm.runInContext(poJs,ctx);
 const settle=async()=>{await new Promise(resolve=>setImmediate(resolve));};
 return {ctx,els,requests,installed:()=>installed,errors,apiResolves,settle};
}
test('PO view installs brand/country controls even when translated HTML overrides fallback',async()=>{
 const f=frontend({translated:true});
 await f.ctx.renderPO();await f.settle();
 assert.equal(f.installed(),1);
 assert.match(f.els['po-fb'].innerHTML,/Netac/);
 assert.match(f.els['po-fb'].innerHTML,/Redragon/);
 assert.equal((f.els['po-fb'].innerHTML.match(/<option value="Redragon"/gi)||[]).length,1,'case variants collapse');
 assert.match(f.els['po-fc'].innerHTML,/泰国/);
 assert.match(f.els['po-fc'].innerHTML,/马来西亚/);
 assert.equal(f.requests.length,1,'no extra API GET for facets');
 assert.match(f.requests[0].url,/brand=&country=/);
 assert.match(f.els['po-table'].innerHTML,/PO1/);
});
test('select brand and country filters PO list on server; cache signature uses both values',async()=>{
 const f=frontend();
 await f.ctx.renderPO();await f.settle();
 f.els['po-fb'].value='Redragon';
 f.els['po-fc'].value='泰国';
 await f.ctx.loadPO();
 assert.match(f.requests.at(-1).url,/brand=Redragon&country=%E6%B3%B0%E5%9B%BD/);
 assert.equal(f.requests.at(-1).config.signature,f.requests.at(-1).url);
 assert.match(f.els['po-table'].innerHTML,/PO3/);
 assert.doesNotMatch(f.els['po-table'].innerHTML,/PO4|PO1|PO2/);
 assert.match(f.els['po-fb'].innerHTML,/Netac/,'options not erased by filtered results');
});
test('status AND brand AND country; cleared filters restore full PO records',async()=>{
 const f=frontend();
 await f.ctx.renderPO();await f.settle();
 f.els['po-fs'].value='approved';f.els['po-fb'].value='Redragon';f.els['po-fc'].value='印度尼西亚';
 await f.ctx.loadPO();
 assert.match(f.els['po-table'].innerHTML,/PO2/);
 assert.doesNotMatch(f.els['po-table'].innerHTML,/PO3|PO1|PO4/);
 f.els['po-fs'].value='';f.els['po-fb'].value='';f.els['po-fc'].value='';
 await f.ctx.loadPO();
 assert.match(f.els['po-table'].innerHTML,/PO1/);
 assert.match(f.els['po-table'].innerHTML,/PO4/);
});
test('quick switching only latest request renders; page destroyed does not throw',async()=>{
 const f=frontend({deferred:true});
 await f.ctx.renderPO();
 f.els['po-fb'].value='Netac';
 const p=f.ctx.loadPO();
 assert.equal(f.apiResolves.length,2);
 f.apiResolves[1]();await p;
 assert.match(f.els['po-table'].innerHTML,/PO1/);
 f.apiResolves[0]();await f.settle();
 assert.match(f.els['po-table'].innerHTML,/PO1/);
 const next=f.ctx.loadPO();delete f.els['po-table'];
 f.apiResolves[2]();await next;
 assert.equal(f.errors.length,0);
});

test('previous page request cannot populate a newly entered PO page',async()=>{
 const f=frontend({deferred:true});
 await f.ctx.renderPO();
 assert.equal(f.apiResolves.length,1);
 await f.ctx.renderPO();
 assert.equal(f.apiResolves.length,2);
 f.apiResolves[0]();await f.settle();
 assert.equal(f.els['po-fb'].innerHTML,'<option value="">全部</option>');
 f.apiResolves[1]();await f.settle();
 assert.match(f.els['po-fb'].innerHTML,/Netac/);
 assert.match(f.els['po-table'].innerHTML,/PO2/);
 assert.equal(f.errors.length,0);
});
