'use strict';
const fs=require('node:fs');
const path=require('node:path');

const ROOT=path.join(__dirname,'..');
const SERVER=path.join(ROOT,'server.js');
const PERF=path.join(ROOT,'app-perf.js');
const SERVER_MARKER='// HCI-CLEARANCE-SETTING-SERVER-V1';
const UI_MARKER='// HCI-CLEARANCE-SETTING-UI-V1';

function uiPatch(){
return `\n\n${UI_MARKER}
(function(global){
'use strict';
if(!global||typeof global.addEventListener!=='function')return;
function esc(v){return typeof global.esc==='function'?global.esc(v):String(v==null?'':v).replace(/[&<>"']/g,function(c){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]);});}
function selectHtml(h){
var v=h.clearance_type||'';
var disabled=!(typeof global.hasPermission==='function'&&global.hasPermission('ci_edit'));
return '<select class="hci-clearance-inline" aria-label="设置历史CI清关方式" title="设置历史CI清关方式"'+(disabled?' disabled':'')+' onclick="event.stopPropagation()" onchange="updateHistoricalCIClearance(this,\\''+esc(h.id)+'\\')">'
+'<option value=""'+(!v?' selected':'')+'>未设置</option>'
+'<option value="formal"'+(v==='formal'?' selected':'')+'>正清</option>'
+'<option value="non_formal"'+(v==='non_formal'?' selected':'')+'>灰清</option></select>';
}
function addStyle(){
if(document.getElementById('hci-clearance-style'))return;
var s=document.createElement('style');s.id='hci-clearance-style';
s.textContent='#ci-table .hci-clearance-inline{appearance:none;-webkit-appearance:none;min-width:76px;max-width:104px;height:28px;padding:0 10px;border:1px solid transparent;border-radius:8px;background:#f2f2f7;color:#1d1d1f;font:500 12px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer;transition:background .15s,border-color .15s,box-shadow .15s}#ci-table .hci-clearance-inline:hover{background:#e9e9ef;border-color:#d2d2d7}#ci-table .hci-clearance-inline:focus{background:#fff;border-color:#007aff;box-shadow:0 0 0 3px rgba(0,122,255,.12);outline:none}#ci-table .hci-clearance-inline:disabled{opacity:.65;cursor:not-allowed}';
document.head.appendChild(s);
}
global.updateHistoricalCIClearance=async function(sel,id){
if(!sel||!id||sel.disabled)return;
var old=sel.getAttribute('data-saved-value')||'',next=sel.value;
if(!['formal','non_formal',''].includes(next)){sel.value=old;return;}
sel.disabled=true;
try{
await global.api('/api/historical-commercial-invoices/'+encodeURIComponent(id),'PUT',{clearance_type:next});
sel.setAttribute('data-saved-value',next);
sel.disabled=!(typeof global.hasPermission==='function'&&global.hasPermission('ci_edit'));
if(typeof global.showToast==='function')global.showToast('历史CI清关方式已更新','success');
}catch(e){
sel.value=old;sel.disabled=false;
if(typeof global.showToast==='function')global.showToast((e&&e.message)||'保存失败','danger');
}
};
global.addEventListener('DOMContentLoaded',function(){
addStyle();
if(typeof global.renderHistoricalCITable!=='function'||global.renderHistoricalCITable.__hciClearanceWrapped)return;
var original=global.renderHistoricalCITable;
function wrapped(data){
var html=original.apply(this,arguments);
if(!Array.isArray(data)||!data.length)return html;
var host=document.createElement('div');host.innerHTML=html;
var table=host.querySelector('table.data-table');
if(!table||!table.tHead||!table.tBodies.length)return html;
var headers=Array.prototype.slice.call(table.tHead.rows[0].cells);
var countryCol=headers.findIndex(function(c){return(c.textContent||'').trim()==='国家';});
if(countryCol<0)return html;
var header=table.tHead.rows[0].insertCell(countryCol+1);header.textContent='清关方式';
var rows=Array.prototype.slice.call(table.tBodies[0].querySelectorAll('tr.clickable-detail-row'));
if(rows.length!==data.length)return html;
data.forEach(function(h,i){
var cell=rows[i].insertCell(countryCol+1);
cell.innerHTML=selectHtml(h);
var sel=cell.querySelector('select');
if(sel)sel.setAttribute('data-saved-value',h.clearance_type||'');
cell.onclick=function(e){if(e)e.stopPropagation();};
});
return host.innerHTML;
}
wrapped.__hciClearanceWrapped=true;wrapped.__original=original;global.renderHistoricalCITable=wrapped;
},{once:true});
})(typeof window!=='undefined'?window:(typeof globalThis!=='undefined'?globalThis:this));
`;
}
function patchPerf(src){
if(src.includes(UI_MARKER))return src;
return src.replace(/\\s*$/,'')+uiPatch();
}
function patchServer(src){
if(src.includes(SERVER_MARKER))return src;
const startup="  initDatabase();";
if(!src.includes(startup))throw new Error('[HCI-CLEARANCE] startup anchor missing');
const startupPatch=`  initDatabase();
  // HCI-CLEARANCE-SETTING-V1：历史 CI 清关方式独立字段；幂等迁移，不触碰付款/库存/WAC。
  try {
    const migration = require('./migrations/historical-ci-clearance').ensureHistoricalCIClearanceColumn(
      run, query, (process.env.DB_DRIVER || 'sqlite').toLowerCase() === 'pg'
    );
    console.log('[STARTUP] historical CI clearance_type 就绪' + (migration.added ? '（已新增字段）' : '（字段已存在）'));
  } catch (e) {
    console.error('[FATAL] historical CI clearance_type migration failed:', e.message);
    process.exit(1);
  }`;
let out=src.replace(startup,startupPatch);
const anchor="CI-SHIP-DATE-01：仅补充/更正历史 CI 的实际出货日期";
if(!out.includes(anchor))throw new Error('[HCI-CLEARANCE] historical route anchor missing');
const route=`  // HCI-CLEARANCE-SETTING-V1：只更新历史 CI 清关方式；不修改应付、付款、库存、WAC 或预测数据。
  app.put('/api/historical-commercial-invoices/:id', requireApiPermission('ci_edit'), asyncHandler((req, res) => {
    try {
      const hci = queryOne('SELECT id FROM historical_commercial_invoices WHERE id = ?', [req.params.id]);
      if (!hci) return res.status(404).json({ error: '历史 CI 不存在' });
      const value = req.body && req.body.clearance_type;
      if (!['formal', 'non_formal', ''].includes(value)) return res.status(400).json({ error: '清关方式只能选择正清、灰清或未设置' });
      run('UPDATE historical_commercial_invoices SET clearance_type = ?, updated_at = datetime(\\'now\\') WHERE id = ?', [value || null, hci.id]);
      res.json({ success: true, id: hci.id, clearance_type: value || null });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  }));

`;
out=out.replace(anchor,route+'  // '+anchor);
return out.replace(/\\s*$/,'')+'\n'+SERVER_MARKER+'\n';
}
function apply(){
const p=fs.readFileSync(PERF,'utf8'),p2=patchPerf(p);if(p!==p2)fs.writeFileSync(PERF,p2,'utf8');
const s=fs.readFileSync(SERVER,'utf8'),s2=patchServer(s);if(s!==s2)fs.writeFileSync(SERVER,s2,'utf8');
require('node:child_process').execFileSync(process.execPath,['--check',PERF],{stdio:'inherit'});
require('node:child_process').execFileSync(process.execPath,['--check',SERVER],{stdio:'inherit'});
console.log('[HCI-CLEARANCE] applied');
}
if(require.main===module)apply();
module.exports={UI_MARKER,SERVER_MARKER,patchPerf,patchServer};
