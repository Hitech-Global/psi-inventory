'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),
 fs=require('node:fs'),path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
const begin=src.indexOf('async function saveEditPI(id){'),end=src.indexOf('// 会话级主数据缓存',begin);
assert.ok(begin>=0&&end>begin);
const saveFn=src.slice(begin,end);
function harness(){
 let resolve,reject,calls=0,closed=0,refreshed=0;const messages=[];
 const btn={disabled:false,textContent:'💾 保存',aria:{},
   setAttribute(name,value){this.aria[name]=value},
   removeAttribute(name){delete this.aria[name]}};
 const status={textContent:'',style:{display:'none'},isConnected:true};
 const fields={ 'btn-save-edit-pi':btn,'pi-edit-save-status':status,
  'npi-date':{value:'2026-09-23'},'npi-cur':{value:'RMB'},'npi-del':{value:'2026-11-01'},
  'npi-need-dep':{value:'1'},'npi-dep':{value:'30'},'npi-no':{value:'PI-TEST'},
  'npi-brand':{value:'Netac'},'npi-country':{value:'印度尼西亚'},'npi-wh':{value:'Bekasi Warehouse'},
  'npi-terms':{value:'',options:[],selectedIndex:0}};
 const api=(url,method,data)=>{calls++;assert.equal(url,'/api/proforma-invoices/pi-id');
   assert.equal(method,'PUT');assert.equal(data.pi_no,'PI-TEST');
   return new Promise((a,b)=>{resolve=a;reject=b});};
 const ctx={document:{getElementById:id=>fields[id]||null,
    querySelector:s=>s.includes('saveEditPI(')?btn:null},
   window:{_piRows:[{sku:'NT01',poQty:5,piQty:5,piPrice:10,piDisc:0}],_editingPIIsMultiPO:false},
   api,showToast:(m,t)=>messages.push([m,t]),closeModal:()=>closed++,loadPI:()=>refreshed++,
   fmtMoney:v=>String(v),t:(_,fallback,vars)=>fallback.replace('{amt}',vars?.amt||'')};
 vm.createContext(ctx);vm.runInContext(saveFn,ctx);
 return {ctx,btn,status,messages,get calls(){return calls},get closed(){return closed},get refreshed(){return refreshed},
   success:()=>resolve({total_amount:50}),failure:()=>reject(Error('保存接口失败'))};
}
test('PI editor attaches the button to the active overlay, not the non-show modal',()=>{
 const open=src.slice(src.indexOf('async function editPI(id){'),begin);
 assert.match(open,/#modal-overlay\.show #modal-content \.modal-footer button\[onclick\^="saveEditPI\("/);
 assert.doesNotMatch(open,/\.modal\.show \.btn-primary/);
 assert.match(open,/id="pi-edit-save-status" role="status" aria-live="polite"/);
});
test('save immediately displays visible status, disables button, prevents duplicate submission',async()=>{
 const f=harness();const p=f.ctx.saveEditPI('pi-id');
 assert.equal(f.btn.disabled,true);
 assert.match(f.btn.textContent,/保存中/);
 assert.equal(f.btn.aria['aria-busy'],'true');
 assert.equal(f.status.style.display,'inline-flex');
 assert.match(f.status.textContent,/正在保存，请勿重复提交/);
 await f.ctx.saveEditPI('pi-id');assert.equal(f.calls,1,'double click must not issue duplicate PUT');
 f.success();await p;
 assert.equal(f.calls,1);assert.equal(f.closed,1);assert.equal(f.refreshed,1);
 assert.ok(f.messages.some(([message,type])=>type==='success'&&message.includes('PI 保存成功')));
});
test('save failure preserves edit form, clearly reports failure, restores interactive button',async()=>{
 const f=harness();const p=f.ctx.saveEditPI('pi-id');
 f.failure();await p;
 assert.equal(f.closed,0);assert.equal(f.refreshed,0);
 assert.equal(f.btn.disabled,false);assert.equal(f.btn.textContent,'💾 保存');
 assert.equal(f.btn.aria['aria-busy'],undefined);
 assert.match(f.status.textContent,/保存失败/);
 assert.ok(f.messages.some(([message,type])=>type==='danger'&&message==='保存接口失败'));
});
test('missing or disabled stale modal save button cannot send PUT',async()=>{
 const f=harness();f.btn.disabled=true;await f.ctx.saveEditPI('pi-id');
 assert.equal(f.calls,0);
});
