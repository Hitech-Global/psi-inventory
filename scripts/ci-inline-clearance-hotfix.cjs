'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const APP_PERF=path.join(__dirname,'..','app-perf.js');
const SERVER_JS=path.join(__dirname,'..','server.js');
const UI_MARKER='// CI-INLINE-CLEARANCE-UI-V1';
const SERVER_MARKER='// CI-INLINE-CLEARANCE-SERVER-V1';

function uiPatch(){
return "\n\n"+UI_MARKER+"\n"+String.raw\`
(function(global){
'use strict';
if(!global||typeof global.addEventListener!=='function')return;
function esc(v){return typeof global.esc==='function'?global.esc(v):String(v==null?'':v).replace(/[&<>"']/g,function(c){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]);});}
function selectHtml(ci){
var v=ci.clearance_type||'',disabled=!(typeof global.hasPermission==='function'&&global.hasPermission('ci_edit'));
return '<select class="ci-clearance-inline" aria-label="编辑清关方式" title="点击修改清关方式"'+(disabled?' disabled':'')+' onclick="event.stopPropagation()" onchange="updateCIClearanceInline(this,\\''+esc(ci.id)+'\\')">'
+'<option value=""'+(!v?' selected':'')+'>未设置</option>'
+'<option value="formal"'+(v==='formal'?' selected':'')+'>正清</option>'
+'<option value="non_formal"'+(v==='non_formal'?' selected':'')+'>灰清</option></select>';
}
function style(){
if(document.getElementById('ci-inline-clearance-style'))return;
var s=document.createElement('style');s.id='ci-inline-clearance-style';
s.textContent='#ci-table .ci-clearance-inline{appearance:none;-webkit-appearance:none;min-width:76px;max-width:104px;height:28px;padding:0 10px;border:1px solid transparent;border-radius:8px;background:#f2f2f7;color:#1d1d1f;font:500 12px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer;transition:background .15s,border-color .15s,box-shadow .15s}#ci-table .ci-clearance-inline:hover{background:#e9e9ef;border-color:#d2d2d7}#ci-table .ci-clearance-inline:focus{background:#fff;border-color:#007aff;box-shadow:0 0 0 3px rgba(0,122,255,.12);outline:none}#ci-table .ci-clearance-inline:disabled{opacity:.65;cursor:not-allowed}';
document.head.appendChild(s);
}
global.updateCIClearanceInline=async function(sel,id){
if(!sel||!id||sel.disabled)return;
var old=sel.getAttribute('data-saved-value')||'',next=sel.value;
if(!['formal','non_formal',''].includes(next)){sel.value=old;return;}
sel.disabled=true;sel.classList.add('is-saving');
try{
await global.api('/api/commercial-invoices/'+encodeURIComponent(id),'PUT',{clearance_type:next});
sel.setAttribute('data-saved-value',next);sel.setAttribute('data-original-value',next);
sel.classList.remove('is-saving');
sel.disabled=!(typeof global.hasPermission==='function'&&global.hasPermission('ci_edit'));
if(typeof global.showToast==='function')global.showToast('清关方式已更新','success');
}catch(e){
sel.value=old;sel.classList.remove('is-saving');sel.disabled=false;
if(typeof global.showToast==='function')global.showToast((e&&e.message)||'清关方式保存失败','danger');
}
};
global.addEventListener('DOMContentLoaded',function(){
style();
if(typeof global.renderOperationalCITable!=='function'||global.renderOperationalCITable.__ciInlineClearanceWrapped)return;
var original=global.renderOperationalCITable;
function wrapped(data){
var html=original.apply(this,arguments);
if(!Array.isArray(data)||!data.length)return html;
var host=document.createElement('div');host.innerHTML=html;
var table=host.querySelector('table.data-table');
if(!table||!table.tHead||!table.tBodies.length)return html;
var headers=Array.prototype.slice.call(table.tHead.rows[0].cells);
var col=headers.findIndex(function(c){return(c.textContent||'').trim()==='清关方式';});
if(col<0)return html;
data.forEach(function(ci,i){
var row=table.tBodies[0].rows[i],cell=row&&row.cells[col];if(!cell)return;
cell.innerHTML=selectHtml(ci);
var sel=cell.querySelector('select');
if(sel){sel.setAttribute('data-saved-value',ci.clearance_type||'');sel.setAttribute('data-original-value',ci.clearance_type||'');}
cell.onclick=function(e){if(e)e.stopPropagation();};
});
return host.innerHTML;
}
wrapped.__ciInlineClearanceWrapped=true;wrapped.__original=original;global.renderOperationalCITable=wrapped;
},{once:true});
})(typeof window!=='undefined'?window:(typeof globalThis!=='undefined'?globalThis:this));
\`+"\n";
}
function patchAppPerfSource(src){return src.includes(UI_MARKER)?src:src.replace(/\\s*$/,'')+uiPatch();}
function patchServerSource(src){
if(src.includes(SERVER_MARKER))return src;
const anchor="    if (generatedPl) return res.status(409).json({ error: '该CI已生成PL，不能编辑', locked: true, lock_reason: 'pl_generated', pl_no: generatedPl.pl_no || '' });";
if(!src.includes(anchor))throw new Error('[CI-INLINE-CLEARANCE] generated PL guard anchor missing');
const replacement="    // 已生成 PL 的 CI 只允许修改清关方式；其余字段继续锁定，避免影响 PL / 付款 / 物流链路。\\n    const clearanceOnlyEdit = d.clearance_type !== undefined && Object.keys(d).every(k => k === 'clearance_type');\\n    if (generatedPl && !clearanceOnlyEdit) return res.status(409).json({ error: '该CI已生成PL，仅允许修改清关方式', locked: true, lock_reason: 'pl_generated', pl_no: generatedPl.pl_no || '' });";
return src.replace(anchor,replacement+'\\n    '+SERVER_MARKER);
}
function apply(){
const a=fs.readFileSync(APP_PERF,'utf8'),b=patchAppPerfSource(a);if(a!==b)fs.writeFileSync(APP_PERF,b,'utf8');
const s=fs.readFileSync(SERVER_JS,'utf8'),t=patchServerSource(s);if(s!==t)fs.writeFileSync(SERVER_JS,t,'utf8');
execFileSync(process.execPath,['--check',APP_PERF],{stdio:'inherit'});
execFileSync(process.execPath,['--check',SERVER_JS],{stdio:'inherit'});
console.log('[CI-INLINE-CLEARANCE] applied');
}
if(require.main===module)apply();
module.exports={UI_MARKER,SERVER_MARKER,patchAppPerfSource,patchServerSource};
