(function(){
'use strict';

const SESSION_KEY='quotation_import_id';
const MAX_ROWS=5000;
const MAX_FILE_BYTES=10*1024*1024;
let pollTimer=null;
let currentModal=null;
let currentRows=[];
let missCount=0;
let autoOpenedId='';

const $=(s,r=document)=>r.querySelector(s);
const api=(u,m='GET',b)=>window.api(u,m,b);
const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
function getId(){try{return sessionStorage.getItem(SESSION_KEY)||''}catch(_e){return ''}}
function setId(id){try{if(id)sessionStorage.setItem(SESSION_KEY,id);else sessionStorage.removeItem(SESSION_KEY)}catch(_e){}}
function makeId(){try{return crypto&&crypto.randomUUID?crypto.randomUUID():'quote-import-'+Date.now()+'-'+Math.random().toString(36).slice(2)}catch(_e){return 'quote-import-'+Date.now()+'-'+Math.random().toString(36).slice(2)}}
function terminal(r){return !!r&&['completed','failed','blocked','unknown_pending_reconcile'].includes(r.status)}
function phaseLabel(p){return ({starting:'正在启动',validating:'正在校验报价数据',deduplicating:'正在整理重复记录',matching:'正在匹配已有报价',writing:'正在批量写入报价',completed:'导入完成',blocked:'导入已阻断',failed:'导入失败',unknown_pending_reconcile:'导入结果待确认'})[p]||'正在导入';}

function ensureCss(){
  if($('#qm-import-progress-css'))return;
  const s=document.createElement('style');s.id='qm-import-progress-css';s.textContent=`.qip-progress{margin-top:14px;padding:14px 15px;border:1px solid #e5e5ea;background:#f8f8fa;border-radius:14px}.qip-head{display:flex;justify-content:space-between;gap:12px;align-items:center}.qip-title{font-size:13px;font-weight:650;color:#1d1d1f}.qip-pct{font-size:22px;font-weight:700;letter-spacing:-.03em;color:#238636}.qip-bar{height:7px;margin-top:10px;background:#e5e5ea;border-radius:999px;overflow:hidden}.qip-fill{height:100%;background:#238636;border-radius:999px;transition:width .25s ease}.qip-meta{display:flex;justify-content:space-between;gap:10px;margin-top:8px;font-size:11px;color:#86868b}.qip-error{margin-top:10px;padding:9px 10px;border-radius:10px;background:#fff1f0;color:#c62828;font-size:12px;white-space:pre-wrap}.qip-warn{margin-top:10px;padding:9px 10px;border-radius:10px;background:#fff8e8;color:#9a6700;font-size:12px}.qip-ok{margin-top:10px;padding:9px 10px;border-radius:10px;background:#edf8ef;color:#19713a;font-size:12px}`;document.head.appendChild(s);
}
function updateTopButton(run){const b=$('#qm-import');if(!b)return;if(run&&!terminal(run)){const p=Math.max(0,Math.min(100,Number(run.percent)||0));b.disabled=true;b.textContent='导入中 '+Math.round(p)+'%';}else if(run&&run.status==='unknown_pending_reconcile'){b.disabled=true;b.textContent='导入结果待确认';}else{b.disabled=false;b.textContent='⇧ 导入报价';}}
function progressHtml(run){
  const p=Math.max(0,Math.min(100,Number(run&&run.percent)||0));const total=Math.max(0,Number(run&&run.total_count)||0),done=Math.max(0,Number(run&&run.processed_count)||0);
  const counts=run&&terminal(run)?`新增 ${Number(run.inserted)||0} · 更新 ${Number(run.updated)||0} · 跳过 ${Number(run.skipped)||0} · 未报价 ${Number(run.no_quote)||0}`:(total?`${done} / ${total} 条`:'正在准备…');let extra='';
  if(run&&run.status==='completed')extra=`<div class="qip-ok">导入已完成。${counts}</div>`;
  else if(run&&run.status==='unknown_pending_reconcile')extra='<div class="qip-warn">服务在导入过程中发生过中断，系统无法自动确认最终结果。请勿重复提交同一任务，先检查报价列表。</div>';
  else if(run&&(run.status==='failed'||run.status==='blocked')){const detail=(run.errors||[]).slice(0,6).map(e=>`第 ${e.row} 行：${e.reason}`).join('\n');extra=`<div class="qip-error">${esc(run.message||run.error||'导入失败')}${detail?'\n'+esc(detail):''}</div>`;}
  return `<div class="qip-progress"><div class="qip-head"><div class="qip-title">${esc(run&&run.message||phaseLabel(run&&run.phase))}</div><div class="qip-pct">${Math.round(p)}%</div></div><div class="qip-bar"><div class="qip-fill" style="width:${p}%"></div></div><div class="qip-meta"><span>${esc(phaseLabel(run&&run.phase))}</span><span>${esc(counts)}</span></div>${extra}</div>`;
}
function renderModalProgress(run){if(!currentModal)return;const box=$('#qm-import-live',currentModal);if(box)box.innerHTML=progressHtml(run);const submit=$('#qm-submit',currentModal);if(submit){submit.disabled=!terminal(run)||run.status==='unknown_pending_reconcile';submit.textContent=run.status==='completed'?'完成':run.status==='unknown_pending_reconcile'?'结果待确认':terminal(run)?'重新选择文件':'正在导入 '+Math.round(Number(run.percent)||0)+'%';}const cancel=$('#qm-cancel',currentModal);if(cancel)cancel.textContent=terminal(run)?'关闭':'后台继续';}
function notify(msg,type){if(typeof window.showToast==='function'){window.showToast(msg,type||'success');return;}if(currentModal){const p=$('#qm-preview',currentModal);if(p)p.textContent=msg;}}
function refreshQuotation(){if($('#qm')&&typeof window.showQuotationManagement==='function')setTimeout(()=>window.showQuotationManagement(),80);}
function finish(run){
  stopPolling();updateTopButton(run);renderModalProgress(run);
  if(run.status==='completed'){setId('');autoOpenedId='';notify(`报价导入完成：新增 ${run.inserted||0}，更新 ${run.updated||0}，跳过 ${run.skipped||0}`,'success');refreshQuotation();}
  else if(run.status==='blocked'||run.status==='failed'){setId('');autoOpenedId='';notify(run.message||'报价导入失败','danger');}
  else if(run.status==='unknown_pending_reconcile'){notify('报价导入结果待确认，请勿重复提交。','warning');}
}
async function poll(id){if(!id)return;try{const run=await api('/api/quotation-management/import/'+encodeURIComponent(id)+'/status');missCount=0;updateTopButton(run);renderModalProgress(run);if(terminal(run)){finish(run);return;}pollTimer=setTimeout(()=>poll(id),450);}catch(e){if(e&&e.status===404)missCount++;else missCount=0;if(missCount>=8){stopPolling();updateTopButton(null);notify('暂时未找到导入任务，系统会在下次进入报价管理时继续确认。','warning');return;}pollTimer=setTimeout(()=>poll(id),900);}}
function stopPolling(){if(pollTimer){clearTimeout(pollTimer);pollTimer=null;}}
function startPolling(id){stopPolling();missCount=0;pollTimer=setTimeout(()=>poll(id),120);}

function openModal(){
  ensureCss();if(currentModal&&document.body.contains(currentModal))return;
  const m=document.createElement('div');currentModal=m;m.className='qm-modal';m.innerHTML=`<div class="qm-dialog"><h3>导入报价</h3><div class="qm-drop"><input type="file" id="qm-file" accept=".xlsx,.xls,.csv"><div class="qm-sub" style="margin-top:8px">字段：SKU、品牌、产品类型、FOB价格、币种、报价日期、备注（可选）</div><div class="qm-sub" style="margin-top:5px">FOB 填 0 = 当日未报价；会保留记录，但不会参与趋势或环比。</div></div><div style="margin-top:12px;font-size:13px">重复 SKU + 品牌 + 报价日期： <select id="qm-mode"><option value="skip">跳过已有记录</option><option value="overwrite">覆盖已有记录</option></select></div><div id="qm-preview" class="qm-sub" style="margin-top:8px"></div><div id="qm-import-live"></div><div class="qm-dialog-actions"><button class="qm-btn" id="qm-cancel">取消</button><button class="qm-btn primary" id="qm-submit">开始导入</button></div></div>`;document.body.appendChild(m);currentRows=[];
  const active=getId();if(active){$('#qm-file',m).disabled=true;$('#qm-mode',m).disabled=true;$('#qm-submit',m).disabled=true;$('#qm-preview',m).textContent='检测到未完成的导入任务，正在恢复状态…';renderModalProgress({status:'running',phase:'starting',percent:0});startPolling(active);}
  $('#qm-cancel',m).onclick=()=>{m.remove();currentModal=null;};
  $('#qm-file',m).onchange=async e=>{const f=e.target.files[0];if(!f)return;if(f.size>MAX_FILE_BYTES){currentRows=[];e.target.value='';$('#qm-preview',m).textContent='文件超过 10MB，请拆分后再导入。';return;}try{const wb=XLSX.read(await f.arrayBuffer(),{type:'array'});currentRows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{defval:''});if(currentRows.length>MAX_ROWS){$('#qm-preview',m).textContent=`已读取 ${currentRows.length} 行，超过单次 ${MAX_ROWS} 行上限，请拆分后重试。`;currentRows=[];return;}$('#qm-preview',m).textContent='已读取 '+currentRows.length+' 行。导入采用批量写入；刷新页面后可恢复任务状态。';}catch(err){currentRows=[];$('#qm-preview',m).textContent='文件读取失败：'+(err.message||err);}};
  $('#qm-submit',m).onclick=async()=>{if(getId())return;if(!currentRows.length)return alert('请先选择有效文件');const id=makeId();setId(id);$('#qm-file',m).disabled=true;$('#qm-mode',m).disabled=true;$('#qm-submit',m).disabled=true;const initial={import_id:id,status:'running',phase:'starting',percent:1,total_count:currentRows.length,processed_count:0,message:'正在启动报价导入'};updateTopButton(initial);renderModalProgress(initial);startPolling(id);try{const res=await api('/api/quotation-management/import','POST',{rows:currentRows,duplicate_mode:$('#qm-mode',m).value,import_id:id});if(terminal(res))finish(res);else{updateTopButton(res);renderModalProgress(res);}}catch(e){if(String(e&&e.message||'').startsWith('导入校验失败')){stopPolling();setId('');updateTopButton(null);renderModalProgress({status:'blocked',phase:'blocked',percent:0,message:e.message||'导入校验失败'});}else{const p=$('#qm-preview',m);if(p)p.textContent='导入请求暂未返回，正在通过任务 ID 自动确认结果，请勿重复提交。';}}};
}
function captureImportClick(e){const t=e.target&&e.target.closest?e.target.closest('#qm-import'):null;if(!t)return;e.preventDefault();e.stopImmediatePropagation();openModal();}
function maybeResumeUi(){const id=getId(),button=$('#qm-import');if(!id||!button)return;updateTopButton({status:'running',percent:0});startPolling(id);if(autoOpenedId!==id&&!currentModal){autoOpenedId=id;openModal();}}
function boot(){ensureCss();document.addEventListener('click',captureImportClick,true);maybeResumeUi();new MutationObserver(()=>maybeResumeUi()).observe(document.body,{childList:true,subtree:true});}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
