(function(){
'use strict';

const SESSION_KEY='quotation_import_id';
const MAX_ROWS=5000;
const MAX_FILE_BYTES=10*1024*1024;
let pollTimer=null;
let elapsedTimer=null;
let currentModal=null;
let currentRows=[];
let currentRun=null;
let missCount=0;
let handledTerminalId='';
let startedAtMs=0;
let needsRefresh=false;

const $=(s,r=document)=>r.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const statusApi=(u)=>window.api(u);

function getId(){try{return sessionStorage.getItem(SESSION_KEY)||''}catch(_e){return ''}}
function setId(id){try{if(id)sessionStorage.setItem(SESSION_KEY,id);else sessionStorage.removeItem(SESSION_KEY)}catch(_e){}}
function makeId(){try{return crypto&&crypto.randomUUID?crypto.randomUUID():'quote-import-'+Date.now()+'-'+Math.random().toString(36).slice(2)}catch(_e){return 'quote-import-'+Date.now()+'-'+Math.random().toString(36).slice(2)}}
function terminal(r){return !!r&&['completed','failed','blocked','unknown_pending_reconcile'].includes(r.status)}
function phaseLabel(p){return ({starting:'正在启动',queued:'文件已接收',validating:'正在校验',matching:'正在匹配已有报价',writing:'正在写入报价',finalizing:'正在确认结果',completed:'导入完成',blocked:'导入已阻断',failed:'导入失败',unknown_pending_reconcile:'导入结果待确认'})[p]||'正在导入';}
function phaseIndex(p){if(['starting','queued','validating'].includes(p))return 0;if(p==='matching')return 1;if(p==='writing')return 2;if(['finalizing','completed'].includes(p))return 3;return 0;}
function nextPaint(){return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));}

async function rawPost(url,body){
  if(typeof window.apiRaw==='function')return window.apiRaw(url,'POST',body);
  const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','Accept-Language':(typeof window.getLang==='function'?window.getLang():'zh')},credentials:'same-origin',body:JSON.stringify(body)});
  let d={};try{d=await r.json();}catch(_e){const e=new Error('服务器返回了非 JSON 响应');e.status=r.status;throw e;}
  if(!r.ok||d.error){const e=new Error(d.error||('请求失败 '+r.status));e.status=r.status;e.payload=d;throw e;}
  return d;
}

function normalizer(){return window.QuotationImportNormalizer||null;}

function ensureCss(){
  if($('#qm-import-progress-css'))return;
  const s=document.createElement('style');s.id='qm-import-progress-css';
  s.textContent=`
  .qip-dialog{width:min(720px,92vw)!important;padding:0!important;overflow:hidden!important;border:1px solid rgba(0,0,0,.08)!important;border-radius:20px!important;background:rgba(252,252,253,.98)!important;box-shadow:0 28px 90px rgba(0,0,0,.28)!important;backdrop-filter:blur(24px) saturate(160%)}
  .qip-titlebar{height:54px;display:flex;align-items:center;border-bottom:1px solid rgba(0,0,0,.07);padding:0 18px;position:relative;background:linear-gradient(180deg,#fff,#f8f8fa)}
  .qip-dots{display:flex;gap:8px}.qip-dot{width:12px;height:12px;border-radius:50%;box-shadow:inset 0 0 0 .5px rgba(0,0,0,.15)}.qip-dot.r{background:#ff5f57}.qip-dot.y{background:#febc2e}.qip-dot.g{background:#28c840}
  .qip-title{position:absolute;left:50%;transform:translateX(-50%);font-size:14px;font-weight:650;color:#2c2c2e;white-space:nowrap}
  .qip-body{padding:22px}.qip-setup{transition:opacity .18s ease}.qip-dialog.qip-running .qip-setup{display:none}
  .qip-drop{border:1.5px dashed #c9c9ce;border-radius:14px;padding:24px;text-align:center;background:rgba(248,248,250,.92)}
  .qip-drop input{max-width:100%}.qip-sub{font-size:12px;color:#86868b;line-height:1.55}.qip-options{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-top:16px;font-size:13px}.qip-options select{height:34px;border:1px solid #d2d2d7;border-radius:9px;background:#fff;padding:0 9px}
  .qip-file-ok{margin-top:12px;padding:10px 12px;border-radius:11px;background:#eef8f0;color:#256c3a;font-size:12px}.qip-file-error{margin-top:12px;padding:10px 12px;border-radius:11px;background:#fff1f0;color:#b42318;font-size:12px;white-space:pre-wrap}
  .qip-progress{padding:8px 2px 2px}.qip-hero{display:flex;align-items:center;justify-content:space-between;gap:18px}.qip-hero-left{display:flex;align-items:center;gap:14px}.qip-spinner{width:42px;height:42px;border-radius:50%;border:3px solid #e5e5ea;border-top-color:#238636;animation:qipSpin .85s linear infinite;flex:0 0 auto}.qip-progress.done .qip-spinner{animation:none;border:none;background:#eaf7ee;position:relative}.qip-progress.done .qip-spinner:after{content:'✓';position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#238636;font-size:23px;font-weight:700}.qip-progress.bad .qip-spinner{animation:none;border:none;background:#fff0ef;position:relative}.qip-progress.bad .qip-spinner:after{content:'!';position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#d92d20;font-size:24px;font-weight:750}
  .qip-main-title{font-size:17px;font-weight:700;color:#1d1d1f}.qip-main-sub{font-size:12px;color:#86868b;margin-top:4px}.qip-pct{font-size:42px;font-weight:720;letter-spacing:-.045em;color:#1d1d1f;line-height:1}
  .qip-bar{height:10px;margin-top:22px;background:#e9e9ed;border-radius:999px;overflow:hidden}.qip-fill{height:100%;background:linear-gradient(90deg,#34a853,#238636);border-radius:999px;transition:width .32s cubic-bezier(.2,.8,.2,1)}
  .qip-stages{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:18px}.qip-stage{position:relative;padding-top:16px;font-size:11px;color:#a1a1a6;text-align:center}.qip-stage:before{content:'';position:absolute;top:0;left:50%;width:8px;height:8px;border-radius:50%;transform:translateX(-50%);background:#d1d1d6;box-shadow:0 0 0 4px #f4f4f6}.qip-stage.done,.qip-stage.active{color:#3a3a3c}.qip-stage.done:before{background:#238636}.qip-stage.active:before{background:#238636;box-shadow:0 0 0 4px #e5f4e9}
  .qip-meta{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-top:20px}.qip-meta-card{background:#f7f7f9;border:1px solid #ededf0;border-radius:12px;padding:11px 12px}.qip-meta-card span{display:block;font-size:10px;color:#8e8e93;margin-bottom:4px}.qip-meta-card b{font-size:13px;color:#2c2c2e;font-weight:650}
  .qip-hint{margin-top:14px;padding:10px 12px;border-radius:11px;background:#f5f5f7;color:#6e6e73;font-size:11px;line-height:1.55}.qip-error{margin-top:14px;padding:11px 12px;border-radius:11px;background:#fff1f0;color:#b42318;font-size:12px;white-space:pre-wrap}.qip-warn{margin-top:14px;padding:11px 12px;border-radius:11px;background:#fff8e8;color:#8a5a00;font-size:12px}.qip-ok{margin-top:14px;padding:11px 12px;border-radius:11px;background:#edf8ef;color:#19713a;font-size:12px}
  .qip-footer{display:flex;justify-content:flex-end;gap:9px;padding:14px 20px;border-top:1px solid rgba(0,0,0,.07);background:#f8f8fa}.qip-btn{height:36px;border:1px solid #d1d1d6;background:#fff;border-radius:10px;padding:0 16px;font-size:13px;cursor:pointer}.qip-btn.primary{background:#238636;color:#fff;border-color:#238636}.qip-btn:disabled{opacity:.45;cursor:default}
  @keyframes qipSpin{to{transform:rotate(360deg)}}
  `;
  document.head.appendChild(s);
}

function updateTopButton(run){
  const b=$('#qm-import');if(!b)return;
  if(run&&!terminal(run)){const p=Math.max(0,Math.min(100,Number(run.percent)||0));b.disabled=true;b.textContent='导入中 '+Math.round(p)+'%';}
  else if(run&&run.status==='unknown_pending_reconcile'){b.disabled=true;b.textContent='导入结果待确认';}
  else{b.disabled=false;b.textContent='⇧ 导入报价';}
}

function elapsedText(run){
  const start=Date.parse(run&&run.created_at||'')||startedAtMs||Date.now();
  const end=terminal(run)?(Date.parse(run.finished_at||'')||Date.now()):Date.now();
  const sec=Math.max(0,Math.round((end-start)/1000));
  if(sec<60)return sec+' 秒';
  return Math.floor(sec/60)+' 分 '+(sec%60)+' 秒';
}

function progressHtml(run){
  const p=Math.max(0,Math.min(100,Number(run&&run.percent)||0));
  const total=Math.max(0,Number(run&&run.total_count)||0),done=Math.max(0,Number(run&&run.processed_count)||0);
  const bad=run&&(run.status==='failed'||run.status==='blocked'||run.status==='unknown_pending_reconcile');
  const cls=run&&run.status==='completed'?' done':bad?' bad':'';
  const idx=phaseIndex(run&&run.phase);
  const stages=['校验文件','匹配历史','批量写入','确认完成'];
  const stageHtml=stages.map((x,i)=>`<div class="qip-stage ${i<idx?'done':i===idx?'active':''}">${x}</div>`).join('');
  const rowsText=total?(done+' / '+total+' 条'):'准备中';
  const actionText=terminal(run)?`新增 ${Number(run.inserted)||0} · 更新 ${Number(run.updated)||0} · 跳过 ${Number(run.skipped)||0}`:'数据库任务实时状态';
  let extra='';
  if(run&&run.status==='completed')extra=`<div class="qip-ok">导入完成：新增 ${Number(run.inserted)||0}，更新 ${Number(run.updated)||0}，跳过 ${Number(run.skipped)||0}，未报价 ${Number(run.no_quote)||0}。</div>`;
  else if(run&&run.status==='unknown_pending_reconcile')extra='<div class="qip-warn">导入结果暂时无法自动确认。系统已锁住该任务，避免重复写入，请不要再次提交同一文件。</div>';
  else if(run&&(run.status==='failed'||run.status==='blocked')){
    const detail=(run.errors||[]).slice(0,8).map(e=>`第 ${e.row} 行：${e.reason}`).join('\n');
    extra=`<div class="qip-error">${esc(run.message||run.error||'导入失败')}${detail?'\n'+esc(detail):''}</div>`;
  }
  return `<div class="qip-progress${cls}"><div class="qip-hero"><div class="qip-hero-left"><div class="qip-spinner"></div><div><div class="qip-main-title">${esc(run&&run.message||phaseLabel(run&&run.phase))}</div><div class="qip-main-sub">${esc(actionText)}</div></div></div><div class="qip-pct">${Math.round(p)}%</div></div><div class="qip-bar"><div class="qip-fill" style="width:${p}%"></div></div><div class="qip-stages">${stageHtml}</div><div class="qip-meta"><div class="qip-meta-card"><span>处理进度</span><b>${esc(rowsText)}</b></div><div class="qip-meta-card"><span>未报价记录</span><b>${Number(run&&run.no_quote)||0} 条</b></div><div class="qip-meta-card"><span>已用时间</span><b id="qip-elapsed">${esc(elapsedText(run))}</b></div></div><div class="qip-hint">这是后台实际任务进度，不是模拟动画。可以选择“后台继续”离开弹窗；刷新页面后系统会根据任务 ID 自动恢复状态，不会重复提交。</div>${extra}</div>`;
}

function startElapsedTicker(){
  stopElapsedTicker();
  elapsedTimer=setInterval(()=>{
    const el=$('#qip-elapsed',currentModal||document);if(el&&currentRun)el.textContent=elapsedText(currentRun);
  },1000);
}
function stopElapsedTicker(){if(elapsedTimer){clearInterval(elapsedTimer);elapsedTimer=null;}}

function renderModalProgress(run){
  currentRun=run||currentRun;
  if(!currentModal)return;
  const dialog=$('.qip-dialog',currentModal);if(dialog)dialog.classList.add('qip-running');
  const box=$('#qm-import-live',currentModal);if(box)box.innerHTML=progressHtml(run||{});
  const submit=$('#qm-submit',currentModal);
  if(submit){
    if(terminal(run)){submit.disabled=false;submit.textContent='关闭';submit.dataset.close='1';}
    else{submit.disabled=true;submit.textContent='正在导入';submit.dataset.close='';}
  }
  const cancel=$('#qm-cancel',currentModal);if(cancel)cancel.textContent=terminal(run)?'关闭':'后台继续';
  if(terminal(run))stopElapsedTicker();else startElapsedTicker();
}

function notify(msg,type){
  if(typeof window.showToast==='function'){window.showToast(msg,type||'success');return;}
  if(currentModal){const p=$('#qm-preview',currentModal);if(p)p.textContent=msg;}
}

function refreshQuotation(){
  if(!needsRefresh)return;needsRefresh=false;
  const run=()=>{if($('#qm')&&typeof window.showQuotationManagement==='function')window.showQuotationManagement();};
  if('requestIdleCallback'in window)requestIdleCallback(run,{timeout:1200});else setTimeout(run,180);
}

function closeCurrentModal(){
  stopElapsedTicker();
  if(currentModal&&document.body.contains(currentModal))currentModal.remove();
  currentModal=null;
  if(needsRefresh)refreshQuotation();
}

function finish(run){
  currentRun=run;stopPolling();updateTopButton(run);renderModalProgress(run);
  const id=run&&run.import_id||getId();
  if(id&&handledTerminalId===id)return;
  if(id)handledTerminalId=id;
  if(run.status==='completed'){
    setId('');needsRefresh=true;notify(`报价导入完成：新增 ${run.inserted||0}，更新 ${run.updated||0}，跳过 ${run.skipped||0}`,'success');
    if(!currentModal)refreshQuotation();
  }else if(run.status==='failed'||run.status==='blocked'){
    setId('');notify(run.message||'报价导入失败','danger');
  }else if(run.status==='unknown_pending_reconcile'){
    notify('导入结果待确认，系统已阻止重复提交','warning');
  }
}

async function poll(id){
  if(!id)return;
  try{
    const run=await statusApi('/api/quotation-management/import/'+encodeURIComponent(id)+'/status');
    missCount=0;currentRun=run;updateTopButton(run);renderModalProgress(run);
    if(terminal(run)){finish(run);return;}
    pollTimer=setTimeout(()=>poll(id),420);
  }catch(e){
    if(e&&e.status===404)missCount++;else missCount=0;
    if(missCount>=12){
      stopPolling();updateTopButton(null);
      if(currentModal){const p=$('#qm-preview',currentModal);if(p)p.textContent='正在等待服务器登记导入任务，请稍后重试状态查询。';}
      return;
    }
    pollTimer=setTimeout(()=>poll(id),800);
  }
}
function stopPolling(){if(pollTimer){clearTimeout(pollTimer);pollTimer=null;}}
function startPolling(id){stopPolling();missCount=0;pollTimer=setTimeout(()=>poll(id),220);}

function fileError(m,msg){
  currentRows=[];
  const p=$('#qm-preview',m);if(p)p.innerHTML=`<div class="qip-file-error">${esc(msg)}</div>`;
  const b=$('#qm-submit',m);if(b)b.disabled=true;
}

function openModal(){
  ensureCss();
  if(currentModal&&document.body.contains(currentModal))return;
  const m=document.createElement('div');currentModal=m;m.className='qm-modal';
  m.innerHTML=`<div class="qm-dialog qip-dialog"><div class="qip-titlebar"><div class="qip-dots"><span class="qip-dot r"></span><span class="qip-dot y"></span><span class="qip-dot g"></span></div><div class="qip-title">导入报价</div></div><div class="qip-body"><div class="qip-setup"><div class="qip-drop"><input type="file" id="qm-file" accept=".xlsx,.xls,.csv"><div class="qip-sub" style="margin-top:10px">字段：SKU、品牌、产品类型、FOB价格、币种、报价日期、备注（可选）</div><div class="qip-sub" style="margin-top:5px">FOB 填 0 = 当日未报价；会保留记录，但不会参与趋势或环比。</div></div><div class="qip-options"><div>重复 SKU + 品牌 + 报价日期</div><select id="qm-mode"><option value="skip">跳过已有记录</option><option value="overwrite">覆盖已有记录</option></select></div><div id="qm-preview"></div></div><div id="qm-import-live"></div></div><div class="qip-footer"><button class="qip-btn" id="qm-cancel">取消</button><button class="qip-btn primary" id="qm-submit" disabled>开始导入</button></div></div>`;
  document.body.appendChild(m);currentRows=[];currentRun=null;needsRefresh=false;

  const active=getId();
  if(active){
    startedAtMs=Date.now();
    $('#qm-submit',m).disabled=true;
    renderModalProgress({import_id:active,status:'running',phase:'starting',percent:1,total_count:0,processed_count:0,message:'正在恢复导入任务'});
    startPolling(active);
  }

  $('#qm-cancel',m).onclick=()=>closeCurrentModal();
  $('#qm-file',m).onchange=async e=>{
    const f=e.target.files[0];if(!f)return;
    if(f.size>MAX_FILE_BYTES)return fileError(m,'文件过大。单个报价导入文件最大 10MB，请拆分后重试。');
    try{
      const wb=XLSX.read(await f.arrayBuffer(),{type:'array'});
      const raw=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{defval:''});
      if(!raw.length)return fileError(m,'文件中没有可导入的数据。');
      if(raw.length>MAX_ROWS)return fileError(m,`本次共 ${raw.length} 行，单次最多支持 ${MAX_ROWS} 行，请拆分后重试。`);
      const n=normalizer();
      const rows=n?raw.map(n.normalizeRow):raw;
      const errors=n?n.validateRows(rows):[];
      if(errors.length){
        const preview=errors.slice(0,8).map(x=>`第 ${x.row} 行：${x.reason}`).join('\n');
        return fileError(m,`导入校验失败（${errors.length} 行）\n${preview}${errors.length>8?'\n另有 '+(errors.length-8)+' 行错误':''}`);
      }
      currentRows=rows;
      const noQuote=rows.filter(r=>Number(r.quote_price??r['FOB价格']??r['报价价格']??r['报价'])===0).length;
      $('#qm-preview',m).innerHTML=`<div class="qip-file-ok">已读取 ${rows.length} 行${noQuote?`，其中 ${noQuote} 行为“未报价”`:''}。已完成浏览器端校验，可以开始导入。</div>`;
      $('#qm-submit',m).disabled=false;
    }catch(err){fileError(m,'文件读取失败：'+(err&&err.message?err.message:err));}
  };

  $('#qm-submit',m).onclick=async()=>{
    const submit=$('#qm-submit',m);
    if(submit.dataset.close==='1'){closeCurrentModal();return;}
    if(getId())return;
    if(!currentRows.length)return fileError(m,'请先选择文件。');
    const id=makeId();setId(id);handledTerminalId='';startedAtMs=Date.now();
    $('#qm-file',m).disabled=true;$('#qm-mode',m).disabled=true;submit.disabled=true;
    const initial={import_id:id,status:'running',phase:'starting',percent:1,total_count:currentRows.length,processed_count:0,no_quote:currentRows.filter(r=>Number(r.quote_price??r['FOB价格']??r['报价价格']??r['报价'])===0).length,message:'正在启动报价导入',created_at:new Date().toISOString()};
    updateTopButton(initial);renderModalProgress(initial);

    // 先让浏览器完成一次绘制，再序列化/发送数据；避免大文件提交时看起来“页面没反应”。
    await nextPaint();
    startPolling(id);
    try{
      const res=await rawPost('/api/quotation-management/import',{rows:currentRows,duplicate_mode:$('#qm-mode',m).value,import_id:id});
      currentRun=res;updateTopButton(res);renderModalProgress(res);
      if(terminal(res))finish(res);
    }catch(e){
      const payload=e&&e.payload;
      if(payload&&(payload.status==='blocked'||payload.errors)){
        finish({import_id:id,status:'blocked',phase:'blocked',percent:0,total_count:currentRows.length,message:payload.error||e.message||'导入校验失败',errors:payload.errors||[]});
      }else{
        const p=$('#qm-import-live',m);
        if(p&&!p.innerHTML)p.innerHTML=progressHtml(initial);
        const preview=$('#qm-preview',m);if(preview)preview.innerHTML='<div class="qip-file-error">导入请求暂未返回，系统正在通过任务 ID 自动确认结果。请勿重复提交。</div>';
      }
    }
  };
}

function captureImportClick(e){
  const t=e.target&&e.target.closest?e.target.closest('#qm-import'):null;if(!t)return;
  e.preventDefault();e.stopImmediatePropagation();openModal();
}

function resumeIfNeeded(){
  const id=getId();if(!id)return;
  startedAtMs=Date.now();updateTopButton({status:'running',percent:1});startPolling(id);
}

function boot(){ensureCss();document.addEventListener('click',captureImportClick,true);resumeIfNeeded();}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
