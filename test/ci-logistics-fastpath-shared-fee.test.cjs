'use strict';
const test=require('node:test'),a=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const dir=path.join(__dirname,'..');
const js=fs.readFileSync(path.join(dir,'app.js'),'utf8');
const perf=fs.readFileSync(path.join(dir,'app-perf.js'),'utf8');
const from=js.indexOf('function renderCISharedFeeAction('),to=js.indexOf('// Combine multiple shipped batches into ONE payable expense',from);
const cut=perf.indexOf('// CI detail logistics presentation patch.');
a(from>=0&&to>from&&cut>=0,'real sources must contain both builder and fast-path override');
const patchEndStart=perf.indexOf('\n})(typeof window !==',cut);
const patchEnd=perf.indexOf(';',patchEndStart)+1;
a(patchEndStart>cut&&patchEnd>patchEndStart,'fast-path IIFE boundary not found');
// The install pipeline appends unrelated DOMContentLoaded hooks to app-perf.js.
// Exercise the actual accelerated-shell patch, not those unrelated listeners.
const tpl=js.slice(from,to),patch=perf.slice(cut,patchEnd);
const ready=()=>new Promise(resolve=>setImmediate(resolve));
function setup(perms,serverPerms){
  let onLoad;
  const user={id:'admin-user',permissions:perms.slice()};
  const host={innerHTML:'',isConnected:true};
  const win={__ciDetailCtx:{ciId:'CI123'},addEventListener:(ev,fn)=>{a.equal(ev,'DOMContentLoaded');onLoad=fn;}};
  const ctx={window:win,currentUser:user,
    esc:String,t:(_,fallback)=>fallback,hasPermission:p=>user.permissions.includes(p),
    ciAccHead:(k,label)=>'<h3><span class="ci-acc-caret" id="ci-caret-logi">▶</span> '+label+'</h3>',
    document:{getElementById:id=>id==='ci-shared-fee-action'?host:null},
    api:()=>Promise.resolve({id:user.id,permissions:serverPerms||perms})};
  const canon=vm.runInNewContext(tpl+'\n({renderCILogisticsShell,renderCISharedFeeAction,refreshCISharedFeeAction})',ctx);
  win.renderCILogisticsShell=canon.renderCILogisticsShell;
  win.renderCILogisticsTable=()=>'<table></table>';
  vm.runInNewContext(patch,ctx);
  onLoad();
  return {win,canon,host};
}
test('CI accelerated accordion keeps canonical shared fee and new logistics buttons',()=>{
 const p=['ci_edit','payment_create','ci_amount_view','logistics_create'];
 const {win,canon}=setup(p);
 const basic=canon.renderCILogisticsShell('CI123'),quick=win.renderCILogisticsShell('CI123');
 a.match(basic,/ci-logistics-actions/);
 a.match(quick,/ci-logistics-actions/);
 a.match(quick,/合并派送费/);
 a.match(quick,/新建物流批次/);
 a.match(quick,/id="ci-caret-logi">▼/);
 a.doesNotMatch(quick,/data-rendered="0" hidden/);
});
test('No privilege escalation: fast-path has no shared fee control without all 3 rights',()=>{
 const {win}=setup(['ci_edit','ci_amount_view','logistics_create']);
 const html=win.renderCILogisticsShell('CI123');
 a.match(html,/新建物流批次/);
 a.doesNotMatch(html,/ci-shared-fee-create/);
 a.match(html,/data-rendered="0"/);
 a.doesNotMatch(html,/data-rendered="0" hidden/);
});
test('A stale client permission is reconciled by current /api/me after fast-path shell render',async()=>{
 const perms=['ci_edit','payment_create','ci_amount_view','logistics_create'];
 const h=setup(['logistics_create','ci_edit'],perms);
 a.match(h.win.renderCILogisticsShell('CI123'),/ci-shared-fee-action/);
 h.canon.refreshCISharedFeeAction('CI123');
 await ready();
 a.match(h.host.innerHTML,/合并派送费/);
});
test('Accelerated path does not duplicate or own actions; original remains callable',()=>{
 const h=setup(['ci_edit','payment_create','ci_amount_view','logistics_create']);
 const html=h.win.renderCILogisticsShell('CI123');
 a.equal((html.match(/合并派送费/g)||[]).length,1);
 a.equal((html.match(/新建物流批次/g)||[]).length,1);
 a.match(html,/id="ci-caret-logi">▼/);
 a.doesNotMatch(html,/data-rendered="0" hidden/);
 a.match(html,/ci-logistics-actions/);
});
