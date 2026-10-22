'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
function portion(start,end){
 const a=app.indexOf(start),b=app.indexOf(end,a);
 assert.ok(a>=0&&b>a,'missing '+start);
 return app.slice(a,b);
}
const helpers=portion('function userChecklist(users, selectedIds, cbClass){','async function changeListingStatus(');
const userRows=[
 {id:'active-a',name:'Titi Dwi Agustin',status:'active'},
 {id:'disabled-b',name:'张佳漫 Chloe',status:'disabled'},
 {id:'pending-c',name:'Rafli Rizky Kurniawan',status:'pending'},
 {id:'active-d',name:'洪子锋 James',status:'active'},
 {id:'active-e',name:'Aisya',status:'active'}
];
function client(){
 const ctx={t:(key,fallback)=>fallback,esc:value=>String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;')};
 vm.createContext(ctx);vm.runInContext(helpers,ctx);return ctx;
}
test('create owner and CC choices include only status active, not disabled/pending',()=>{
 const ctx=client();
 for(const cb of ['listing-owner-cb','listing-cc-cb']){
  const output=ctx.userChecklist(userRows,[],cb);
  assert.match(output,/Titi Dwi Agustin/);
  assert.match(output,/洪子锋 James/);
  assert.doesNotMatch(output,/张佳漫 Chloe/);
  assert.doesNotMatch(output,/Rafli Rizky Kurniawan/);
  assert.equal((output.match(/type="checkbox"/g)||[]).length,3);
  assert.match(output,/class="listing-person-name"/);
 }
});
test('edit selection retains active preselection, inactive historical assignment not selectable',()=>{
 const ctx=client();
 const html=ctx.userChecklist(userRows,['active-a','disabled-b','pending-c'],'listing-owner-cb');
 assert.match(html,/value="active-a" checked/);
 assert.doesNotMatch(html,/value="disabled-b"/);
 assert.doesNotMatch(html,/value="pending-c"/);
 assert.equal((html.match(/ checked/g)||[]).length,1);
 const onlyDisabled=ctx.userChecklist(userRows,['disabled-b'],'listing-cc-cb');
 assert.equal((onlyDisabled.match(/ checked/g)||[]).length,0);
});
test('responsive CSS uses grid cards with readable names, only logistics listing selectors',()=>{
 for(const id of ['npl-owner-list','npl-cc-list','el-owner-list','el-cc-list'])
  assert.ok(html.includes('#'+id),'missing CSS for '+id);
 assert.match(html,/grid-template-columns:repeat\(auto-fill,minmax\(min\(100%,180px\),1fr\)\)/);
 assert.match(html, /\.listing-person-name\{/);
 assert.match(html, /white-space:normal;overflow-wrap:break-word/);
 assert.match(html, /word-break:normal;text-align:left/);
 assert.match(html, /flex:0 0 auto;width:15px;height:15px/);
});
function editHarness({initialOwners=['active-a'],initialCc=['active-e'],nowOwners=initialOwners,nowCc=initialCc}={}){
 const calls=[],notices=[];let closed=0,refreshed=0;
 const inputs={
  'el-ff':{value:'ff1',selectedIndex:0,options:[{dataset:{name:'F'}}]},
  'el-country':{value:'ID',dataset:{raw:'ID',display:'印度尼西亚'}}
 };
 for(const id of ['el-batchno','el-mode','el-wh','el-pickup','el-depart','el-eta','el-arrival','el-status','el-cur','el-freight','el-local','el-feestatus','el-remark'])
  inputs[id]={value:id==='el-freight'?'35':'misc'};
 const ctx={
  document:{
    getElementById:id=>inputs[id]||null,
    querySelectorAll:selector=>{
      const ids=selector.includes('listing-owner-cb')?nowOwners:nowCc;
      return ids.map(value=>({checked:true,value}));
    }
  },window:{_listingEditSelection:{id:'batch1',owners:[...initialOwners].sort(),cc:[...initialCc].sort()}},
  api:async(url,method,payload)=>{calls.push({url,method,payload});return {success:true}},
  t:(_key,fallback)=>fallback,showToast:(message,kind)=>notices.push({message,kind}),
  closeModal:()=>closed++,loadLog:()=>refreshed++,invalidateCILogistics:()=>{},viewCI:async()=>{}
 };
 vm.createContext(ctx);
 vm.runInContext(helpers+portion('async function saveEditLog(logId,plId){','// 正常「到货日期」业务入口'),ctx);
 return {ctx,calls,notices,get closed(){return closed},get refreshed(){return refreshed}};
}
test('editing non-assignee logistics fields does NOT rewrite any previous inactive listing membership',async()=>{
 const h=editHarness({initialOwners:['active-a'],initialCc:['active-e']});
 await h.ctx.saveEditLog('batch1');
 assert.equal(h.calls.filter(c=>c.url.endsWith('/listing')).length,0);
 assert.equal(h.calls.filter(c=>c.method==='PUT').length,1);
 assert.equal(h.closed,1);
});
test('CC-only change does not resend historical owner IDs; owner-only change does not resend CC',async()=>{
 const cc=editHarness({nowCc:['active-a']});await cc.ctx.saveEditLog('batch1');
 assert.equal(cc.calls.length,2);
 assert.deepEqual(Object.keys(cc.calls[1].payload),['listing_cc_user_ids']);
 assert.deepEqual(Array.from(cc.calls[1].payload.listing_cc_user_ids),['active-a']);
 const owner=editHarness({nowOwners:['active-d']});await owner.ctx.saveEditLog('batch1');
 assert.deepEqual(Object.keys(owner.calls[1].payload),['listing_owner_ids']);
});
test('an original inactive owner can remain historically assigned without blocking unrelated edits',async()=>{
 const h=editHarness({initialOwners:[],nowOwners:[],initialCc:[],nowCc:[]});
 await h.ctx.saveEditLog('batch1');
 assert.equal(h.calls.length,1,'unrelated logistics edit must not rewrite inactive owner/cc');
 assert.equal(h.notices.find(n=>n.kind==='warning'),undefined);
});
test('changing owners to nobody still stops submission, even if other fields are edited',async()=>{
 const h=editHarness({nowOwners:[]});
 await h.ctx.saveEditLog('batch1');
 assert.equal(h.calls.length,0);
 assert.ok(h.notices.some(n=>n.kind==='warning'));
});
test('logistics create and edit both use the same status-filtered checklist',()=>{
 const create=portion('async function selectCIForPL(ciId){','function renderPLDraftTable(');
 const edit=portion('async function editLog(id){','async function saveEditLog(logId,plId){');
 for(const cls of ['listing-owner-cb','listing-cc-cb']){
  assert.ok(create.includes("'"+cls+"'"));
  assert.ok(edit.includes("'"+cls+"'"));
 }
 assert.match(edit,/_listingEditSelection=\{/);
 assert.match(app,/if\(Object.keys\(listingChange\).length\)/);
});
