'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const src=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
const start=src.indexOf('function renderCISharedFeeAction(');
const end=src.indexOf('// Combine multiple shipped batches into ONE payable expense',start);
assert(start>=0&&end>start,'Actual CI shared fee action code unavailable');
const slice=src.slice(start,end);
const permissionSet=['ci_edit','ci_amount_view','payment_create'];
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function harness(initial,meReply){
  const host={innerHTML:'',isConnected:true};
  const currentUser={id:'user-1',permissions:initial};
  const calls=[];
  const ctx={currentUser,window:{__ciDetailCtx:{ciId:'CI-1'}},
    document:{getElementById:id=>id==='ci-shared-fee-action'?host:null},
    esc:s=>String(s),t:(key,defaultValue)=>defaultValue,
    hasPermission:p=>currentUser.permissions.includes('*')||currentUser.permissions.includes(p),
    ciAccHead:(k,l)=>'<h3>'+l+'</h3>',
    api:(url,method)=>{calls.push([url,method]);return Promise.resolve(meReply);}};
  const fns=vm.runInNewContext(slice+'\n({renderCISharedFeeAction,renderCILogisticsShell,refreshCISharedFeeAction})',ctx);
  return {fns,host,ctx,calls};
}
test('Full CI + finance rights display both buttons together without extra requests',()=>{
  const h=harness(['logistics_create',...permissionSet],{id:'user-1',permissions:permissionSet});
  const html=h.fns.renderCILogisticsShell('CI-1');
  assert.match(html,/ci-logistics-actions/);
  assert.match(html,/新建物流批次/);
  assert.match(html,/合并派送费/);
  assert.match(html,/ci-shared-fee-create/);
  assert.equal(h.calls.length,0,'initial modal shell cannot block on auth');
});
test('Server permissions restore missing shared fee button in a stale browser tab',async()=>{
  const h=harness(['logistics_create','ci_edit'],{id:'user-1',permissions:['logistics_create',...permissionSet]});
  assert.doesNotMatch(h.fns.renderCILogisticsShell('CI-1'),/ci-shared-fee-create/);
  h.fns.refreshCISharedFeeAction('CI-1');
  await flush();
  assert.deepEqual(h.calls,[['/api/me','GET']]);
  assert.match(h.host.innerHTML,/合并派送费/);
});
test('Server denies amount or create permission: no visible shared fee action',async()=>{
  const h=harness(['logistics_create',...permissionSet],{id:'user-1',permissions:['logistics_create','ci_edit','ci_amount_view']});
  h.fns.refreshCISharedFeeAction('CI-1');
  await flush();
  assert.equal(h.host.innerHTML,'');
  const forbidden=harness([], {id:'user-1',permissions:['ci_edit','payment_create']});
  forbidden.fns.refreshCISharedFeeAction('CI-1');
  await flush();
  assert.equal(forbidden.host.innerHTML,'');
});
test('Old modal or user session cannot be overwritten by delayed permissions response',async()=>{
  const h=harness([], {id:'user-1',permissions:permissionSet});
  h.fns.refreshCISharedFeeAction('CI-1');
  h.ctx.window.__ciDetailCtx.ciId='CI-2';
  await flush();
  assert.equal(h.host.innerHTML,'');
  const g=harness([], {id:'different-user',permissions:permissionSet});
  g.fns.refreshCISharedFeeAction('CI-1');await flush();
  assert.equal(g.host.innerHTML,'');
});
test('Auth response failure keeps initial button and does not crash',async()=>{
  const h=harness(permissionSet,{id:'user-1',permissions:permissionSet});
  h.host.innerHTML='initial';
  h.ctx.api=()=>Promise.reject(new Error('offline'));
  h.fns.refreshCISharedFeeAction('CI-1');await flush();
  assert.equal(h.host.innerHTML,'initial');
});
test('Scoped CSS and frontend render trigger; no payment POST permissions modified',()=>{
  assert(src.includes('refreshCISharedFeeAction(id); // fire-and-forget'));
  const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
  assert(html.includes('.ci-logistics-actions{display:flex;align-items:center;flex-wrap:wrap;'));
  assert(src.includes('function openSharedLogisticsFeeModal(ciId){'));
  const server=fs.readFileSync(path.join(__dirname,'..','shared-logistics-fee-server.js'),'utf8');
  assert(server.includes("requireApiPermission('payment_create'),requireCIAmountView"));
});
