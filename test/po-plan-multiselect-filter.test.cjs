'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
const src=fs.readFileSync(path.join(root,'po-plan-ui.js'),'utf8');
const boot=fs.readFileSync(path.join(root,'scripts/po-plan-bootstrap.cjs'),'utf8');
const plans=[
 {id:'1',po_no:'P1',brand:'Netac',country:'印度尼西亚',planned_qty:20,transferred_qty:0},
 {id:'2',po_no:'P2',brand:'Redragon',country:'泰国',planned_qty:10,transferred_qty:5},
 {id:'3',po_no:'P3',brand:'redragon',country:'马来西亚',planned_qty:50,transferred_qty:15},
 {id:'4',po_no:'P4',brand:'Netac',country:'印度尼西亚',planned_qty:40,transferred_qty:0}
];
const extract=(a,b)=>{const i=src.indexOf(a),j=src.indexOf(b,i);assert(i>=0&&j>i,a);return src.slice(i,j);};
function facetHarness(){
 const selected={brand:new Set(),country:new Set()},dom={};
 for(const kind of ['brand','country']){
   dom['#po-'+kind+'-options']={innerHTML:'',querySelectorAll:()=>[...selected[kind]].map(value=>({value}))};
   dom['#po-'+kind+'-summary']={textContent:''};
 }
 dom['#po-fs']={value:''};dom['#po-fk']={value:''};
 const ctx={document:{querySelector:s=>dom[s]||null},esc:s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;')};
 const helpers=`const $=s=>document.querySelector(s);const E=v=>esc(v);let _poPlanFacetRows=null;`+
   extract('function selectedPOFacets(','function clearCaches()');
 vm.createContext(ctx);vm.runInContext(helpers,ctx);
 return {ctx,selected,dom};
}
test('PO actual visible UI contains brand/country multi-select dropdowns rather than text boxes',()=>{
 assert.match(src,/\$\{poFacetHtml\('brand','品牌'\)\}/);
 assert.match(src,/\$\{poFacetHtml\('country','国家'\)\}/);
 assert.doesNotMatch(src,/<input id="po-fb" placeholder=/);
 assert.doesNotMatch(src,/<input id="po-fc" placeholder=/);
 assert.match(src,/options\.addEventListener\('change'/);
 assert.match(src,/if\(!s&&!k&&!brands\.length&&!countries\.length\)poPlanPopulateFacets\(data\)/);
});
test('facets are built from all PO rows, collapse case variants, preserve selected values',()=>{
 const {ctx,selected,dom}=facetHarness();
 ctx.poPlanPopulateFacets(plans);
 assert.match(dom['#po-brand-options'].innerHTML,/value="Netac"/);
 assert.match(dom['#po-brand-options'].innerHTML,/value="Redragon"/);
 assert.equal((dom['#po-brand-options'].innerHTML.match(/value="redragon"/ig)||[]).length,1);
 for(const v of ['印度尼西亚','泰国','马来西亚'])assert.ok(dom['#po-country-options'].innerHTML.includes(v));
 selected.brand.add('Redragon');selected.country.add('泰国');selected.country.add('马来西亚');
 ctx.poPlanPopulateFacets(plans);assert.match(dom['#po-brand-options'].innerHTML,/value="Redragon" checked/);
 assert.equal(dom['#po-country-summary'].textContent,'已选 2 项');
 assert.ok(ctx.cacheKey().includes('Redragon'));
});
test('facet values escape unsafe markups',()=>{
 const {ctx,dom}=facetHarness();ctx.poPlanPopulateFacets([{brand:'<bad x="x">',country:'泰国'}]);
 assert.doesNotMatch(dom['#po-brand-options'].innerHTML,/<bad/);
 assert.match(dom['#po-brand-options'].innerHTML,/&lt;bad/);
});
test('frontend sends selected brands and countries as repeated URL query parameters',async()=>{
 const u=[],ctx={URLSearchParams,planCache:new Map(),Date,
   _poPlanPageEpoch:3,cacheKey:()=>'',selectedPOFacets:kind=>kind==='brand'?['Netac','Redragon']:['印度尼西亚','泰国'],
   $:selector=>selector==='#po-fs'?{value:'partial'}:selector==='#po-fk'?{value:'P'}:selector==='#po-table'?{}:null,
   apiCall:async url=>{u.push(url);return[];},drawPOPlan:()=>{},poPlanPopulateFacets:()=>{}};
 const code=extract('async function fetchPOPlan(','function drawPOPlan(');
 vm.createContext(ctx);vm.runInContext(code,ctx);
 await ctx.fetchPOPlan('test',false);
 const url=new URL('https://example.com'+u[0]);assert.equal(url.pathname,'/api/po-plans');
 assert.deepEqual(url.searchParams.getAll('brand'),['Netac','Redragon']);
 assert.deepEqual(url.searchParams.getAll('country'),['印度尼西亚','泰国']);
 assert.equal(url.searchParams.get('status'),'partial');
 assert.equal(url.searchParams.get('keyword'),'P');
});
test('production bootstrap bumps asset URL so browsers load updated PO plan UI',()=>{
 assert.match(boot,/ASSET_VERSION='20261022c'/);
 assert.match(boot,/patchIndex\(/);
});
test('backend supports parameterized AND of multi-brand and multi-country, status and keyword',()=>{
 const handlers={};
 const dep={app:{get:(route,...args)=>{handlers[route]=args.at(-1)},post:()=>{},put:()=>{},delete:()=>{}},
 query:(sql,args)=>{dep.querySql=sql;dep.params=args;return{rows:plans.map(p=>({...p,created_at:'',po_date:'',item_count:1}))}},
 queryOne:()=>null,run:()=>{},transaction:x=>x(),genId:()=>'',asyncHandler:x=>x,requireApiPermission:()=>()=>{},updateInventoryTransitDataAsync:()=>Promise.resolve()};
 require('../po-plan-server.js')(dep);
 let result;handlers['/api/po-plans']({query:{status:'partial',brand:['Netac','Redragon'],country:['印度尼西亚','泰国'],keyword:'PO'}},{json:x=>{result=x}});
 assert.match(dep.querySql,/LOWER\(TRIM\(po\.brand\)\) IN \(\?,\?\)/);
 assert.match(dep.querySql,/LOWER\(TRIM\(po\.country\)\) IN \(\?,\?\)/);
 assert.deepEqual(dep.params,['netac','redragon','印度尼西亚','泰国','%po%','%po%','%po%','%po%']);
 assert.ok(result.every(p=>p.plan_status==='partial'));
 handlers['/api/po-plans']({query:{brand:'Netac',country:'印度尼西亚'}},{json:x=>{result=x}});
 assert.match(dep.querySql,/po\.brand\)\) IN \(\?\)/);assert.equal(dep.params[0],'netac');
});
