(function(){
'use strict';

const SESSION_KEY='quotation_import_id';
const MAX_ROWS=5000;
const MAX_FILE_BYTES=50*1024*1024;
let pollTimer=null;
let elapsedTimer=null;
let currentModal=null;
let currentRows=[];
let currentRun=null;
let missCount=0;
let handledTerminalId='';
let startedAtMs=0;
let needsRefresh=false;
let importOptions=null;
let selectedSupplierId='';
let selectedBrand='Netac';
let selectedQuoteDate='';
let quoteDateTouched=false;
let previewOffset=0;
let recognizedSheets=[];
let ignoredSheets=[];

const $=(s,r=document)=>r.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const statusApi=(u)=>window.api(u);

function getId(){try{return sessionStorage.getItem(SESSION_KEY)||''}catch(_e){return ''}}
function setId(id){try{if(id)sessionStorage.setItem(SESSION_KEY,id);else sessionStorage.removeItem(SESSION_KEY)}catch(_e){}}
function makeId(){try{return crypto&&crypto.randomUUID?crypto.randomUUID():'quote-import-'+Date.now()+'-'+Math.random().toString(36).slice(2)}catch(_e){return 'quote-import-'+Date.now()+'-'+Math.random().toString(36).slice(2)}}
function terminal(r){return !!r&&['completed','failed','blocked','unknown_pending_reconcile'].includes(r.status)}
function phaseLabel(p){return ({starting:'正在启动',queued:'文件已接收',validating:'正在校验',matching:'正在匹配 SKU 主数据和历史映射',writing:'正在写入报价',finalizing:'正在确认结果',completed:'导入完成',blocked:'导入已阻断',failed:'导入失败',unknown_pending_reconcile:'导入结果待确认'})[p]||'正在导入';}
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
  .qip-modal{box-sizing:border-box;padding:16px;overflow-y:auto}
  .qip-dialog{width:min(720px,92vw)!important;max-height:calc(100vh - 32px);max-height:calc(100dvh - 32px);display:flex;flex-direction:column;min-height:0;box-sizing:border-box;padding:0!important;overflow:hidden!important;border:1px solid rgba(0,0,0,.08)!important;border-radius:20px!important;background:rgba(252,252,253,.98)!important;box-shadow:0 28px 90px rgba(0,0,0,.28)!important;backdrop-filter:blur(24px) saturate(160%)}
  .qip-titlebar{height:54px;flex:0 0 54px;display:flex;align-items:center;border-bottom:1px solid rgba(0,0,0,.07);padding:0 18px;position:relative;background:linear-gradient(180deg,#fff,#f8f8fa)}
  .qip-dots{display:flex;gap:8px}.qip-dot{width:12px;height:12px;border-radius:50%;box-shadow:inset 0 0 0 .5px rgba(0,0,0,.15)}.qip-dot.r{background:#ff5f57}.qip-dot.y{background:#febc2e}.qip-dot.g{background:#28c840}
  .qip-title{position:absolute;left:50%;transform:translateX(-50%);font-size:14px;font-weight:650;color:#2c2c2e;white-space:nowrap}
  .qip-body{padding:22px;flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;scrollbar-gutter:stable}.qip-setup{transition:opacity .18s ease}.qip-dialog.qip-running .qip-setup{display:none}
  .qip-drop{border:1.5px dashed #c9c9ce;border-radius:14px;padding:24px;text-align:center;background:rgba(248,248,250,.92)}
  .qip-drop input{max-width:100%}.qip-fields{display:grid;grid-template-columns:1fr 1fr 170px;gap:10px;margin-bottom:14px}.qip-field label{display:block;font-size:11px;color:#777;margin:0 0 5px 2px}.qip-field select,.qip-field input{width:100%;height:36px;border:1px solid #d2d2d7;border-radius:9px;background:#fff;padding:0 10px;font-size:13px}.qip-field select:disabled,.qip-field input:disabled{opacity:.55}.qip-sub{font-size:12px;color:#86868b;line-height:1.55}.qip-options{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-top:16px;font-size:13px}.qip-options select{height:34px;border:1px solid #d2d2d7;border-radius:9px;background:#fff;padding:0 9px}
  .qip-file-ok{margin-top:12px;padding:10px 12px;border-radius:11px;background:#eef8f0;color:#256c3a;font-size:12px}.qip-file-error{margin-top:12px;padding:10px 12px;border-radius:11px;background:#fff1f0;color:#b42318;font-size:12px;white-space:pre-wrap}
  .qip-progress{padding:8px 2px 2px}.qip-hero{display:flex;align-items:center;justify-content:space-between;gap:18px}.qip-hero-left{display:flex;align-items:center;gap:14px}.qip-spinner{width:42px;height:42px;border-radius:50%;border:3px solid #e5e5ea;border-top-color:#238636;animation:qipSpin .85s linear infinite;flex:0 0 auto}.qip-progress.done .qip-spinner{animation:none;border:none;background:#eaf7ee;position:relative}.qip-progress.done .qip-spinner:after{content:'✓';position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#238636;font-size:23px;font-weight:700}.qip-progress.bad .qip-spinner{animation:none;border:none;background:#fff0ef;position:relative}.qip-progress.bad .qip-spinner:after{content:'!';position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#d92d20;font-size:24px;font-weight:750}
  .qip-main-title{font-size:17px;font-weight:700;color:#1d1d1f}.qip-main-sub{font-size:12px;color:#86868b;margin-top:4px}.qip-pct{font-size:42px;font-weight:720;letter-spacing:-.045em;color:#1d1d1f;line-height:1}
  .qip-bar{height:10px;margin-top:22px;background:#e9e9ed;border-radius:999px;overflow:hidden}.qip-fill{height:100%;background:linear-gradient(90deg,#34a853,#238636);border-radius:999px;transition:width .32s cubic-bezier(.2,.8,.2,1)}
  .qip-stages{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:18px}.qip-stage{position:relative;padding-top:16px;font-size:11px;color:#a1a1a6;text-align:center}.qip-stage:before{content:'';position:absolute;top:0;left:50%;width:8px;height:8px;border-radius:50%;transform:translateX(-50%);background:#d1d1d6;box-shadow:0 0 0 4px #f4f4f6}.qip-stage.done,.qip-stage.active{color:#3a3a3c}.qip-stage.done:before{background:#238636}.qip-stage.active:before{background:#238636;box-shadow:0 0 0 4px #e5f4e9}
  .qip-meta{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-top:20px}.qip-meta-card{background:#f7f7f9;border:1px solid #ededf0;border-radius:12px;padding:11px 12px}.qip-meta-card span{display:block;font-size:10px;color:#8e8e93;margin-bottom:4px}.qip-meta-card b{font-size:13px;color:#2c2c2e;font-weight:650}
  .qip-hint{margin-top:14px;padding:10px 12px;border-radius:11px;background:#f5f5f7;color:#6e6e73;font-size:11px;line-height:1.55}.qip-error{margin-top:14px;padding:11px 12px;border-radius:11px;background:#fff1f0;color:#b42318;font-size:12px;white-space:pre-wrap}.qip-warn{margin-top:14px;padding:11px 12px;border-radius:11px;background:#fff8e8;color:#8a5a00;font-size:12px}.qip-ok{margin-top:14px;padding:11px 12px;border-radius:11px;background:#edf8ef;color:#19713a;font-size:12px}
  .qip-preview-summary{display:flex;flex-wrap:wrap;gap:7px;margin:12px 0}.qip-summary-chip{background:#f4f5f7;border:1px solid #e8e9ec;border-radius:999px;padding:4px 9px;font-size:11px;color:#555}.qip-preview-wrap{overflow:auto;max-height:330px;border:1px solid #ececf0;border-radius:11px}.qip-preview-table{width:100%;border-collapse:collapse;font-size:11px;min-width:620px}.qip-preview-table th{position:sticky;top:0;background:#f6f6f8;text-align:left;padding:8px;border-bottom:1px solid #e6e6e9;color:#666}.qip-preview-table td{padding:8px;border-bottom:1px solid #f0f0f2;vertical-align:top}.qip-preview-table input{height:30px;width:180px;border:1px solid #d6d6db;border-radius:7px;padding:0 8px;font-size:11px}.qip-suggest-wrap{position:relative}.qip-suggestions{position:absolute;top:31px;left:0;right:0;z-index:10;background:#fff;border:1px solid #ddd;border-radius:8px;box-shadow:0 8px 22px rgba(0,0,0,.12);max-height:180px;overflow:auto}.qip-suggestions button{display:block;width:100%;border:0;background:#fff;text-align:left;padding:7px 9px;font-size:11px;cursor:pointer}.qip-suggestions button:hover{background:#f3f7f3}.qip-pagination{display:flex;justify-content:space-between;align-items:center;margin-top:8px;font-size:11px;color:#777}.qip-pagination button{border:1px solid #ddd;background:#fff;border-radius:7px;padding:5px 9px;font-size:11px} .qip-footer{display:flex;flex:0 0 auto;justify-content:flex-end;gap:9px;padding:14px 20px;border-top:1px solid rgba(0,0,0,.07);background:#f8f8fa}.qip-btn{height:36px;border:1px solid #d1d1d6;background:#fff;border-radius:10px;padding:0 16px;font-size:13px;cursor:pointer}.qip-btn.primary{background:#238636;color:#fff;border-color:#238636}.qip-btn:disabled{opacity:.45;cursor:default}
  @media (max-width:700px){.qip-modal{padding:8px}.qip-dialog{width:100%!important;max-height:calc(100vh - 16px);max-height:calc(100dvh - 16px)}.qip-fields{grid-template-columns:1fr}.qip-body{padding:14px}.qip-drop{padding:14px}.qip-options{flex-wrap:wrap}}
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
  const stages=['识别工作表','匹配 SKU','批量写入','确认完成'];
  const stageHtml=stages.map((x,i)=>`<div class="qip-stage ${i<idx?'done':i===idx?'active':''}">${x}</div>`).join('');
  const rowsText=total?(done+' / '+total+' 条'):'准备中';
  const actionText=terminal(run)?`新增 ${Number(run.inserted)||0} · 更新 ${Number(run.updated)||0} · 跳过 ${Number(run.skipped)||0} · 未关联 ${Number(run.unlinked)||0}`:'数据库任务实时状态';
  let extra='';
  if(run&&run.status==='completed')extra=`<div class="qip-ok">导入完成：新增 ${Number(run.inserted)||0}，更新 ${Number(run.updated)||0}，跳过 ${Number(run.skipped)||0}，未报价 ${Number(run.no_quote)||0}，未关联 ${Number(run.unlinked)||0}。</div>`;
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
    setId('');needsRefresh=true;notify(`报价导入完成：新增 ${run.inserted||0}，更新 ${run.updated||0}，跳过 ${run.skipped||0}，未关联 ${run.unlinked||0}`,'success');
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

function renderPreview(m){
  const box=$('#qm-preview',m);if(!box)return;
  if(!currentRows.length){box.innerHTML='';return;}
  const matched=currentRows.filter(r=>r.match_status==='matched').length;
  const unlinked=currentRows.length-matched;
  const noQuote=currentRows.filter(r=>Number(r.quote_price)===0).length;
  const visible=currentRows.map((row,index)=>({row,index})).filter(x=>x.row.match_status==='unlinked').slice(previewOffset,previewOffset+30);
  const sheetText=recognizedSheets.map(x=>esc(x.name)+'（'+x.row_count+'行）').join('、')||'—';
  const ignoredText=ignoredSheets.length?'；跳过未识别工作表：'+ignoredSheets.map(x=>esc(x.name)).join('、'):'';
  let html='<div class="qip-file-ok">已读取 '+currentRows.length+' 行报价；识别工作表：'+sheetText+ignoredText+'</div>';
  html+='<div class="qip-preview-summary"><span class="qip-summary-chip">已匹配 '+matched+'</span><span class="qip-summary-chip">未关联 '+unlinked+'</span><span class="qip-summary-chip">未报价 '+noQuote+'</span></div>';
  if(unlinked)html+='<div class="qip-warn">未关联的报价仍可导入，会保留供应商料号并标记为“未关联”，不会参与内部 SKU 采购价对比。可在下方搜索 PSI SKU 手动关联；'+(selectedSupplierId?'确认后系统会记住映射。':'如果品牌能唯一识别供应商，提交时会自动关联；否则仅本次关联，不保存映射。')+'</div>';
  if(visible.length){
    html+='<div class="qip-sub" style="margin:8px 0">以下显示未关联料号，每页最多 30 条。其他未关联记录也会正常导入。</div>';
    html+='<div class="qip-preview-wrap"><table class="qip-preview-table"><thead><tr><th>供应商料号</th><th>型号 / 规格</th><th>品牌 / 类型</th><th>FOB</th><th>手动关联 PSI SKU</th></tr></thead><tbody>';
    visible.forEach(x=>{
      const r=x.row,i=x.index;
      html+='<tr><td><b>'+esc(r.supplier_part_no)+'</b><div class="qip-sub">'+esc(r.source_sheet||'')+' · 第 '+esc(r.source_row||'—')+' 行</div></td>';
      html+='<td>'+esc([r.model,r.spec].filter(Boolean).join(' / ')||'—')+'</td><td>'+esc(r.brand)+'<div class="qip-sub">'+esc(r.product_type||'未分类')+'</div></td>';
      html+='<td>'+esc(r.quote_price===0?'未报价':(r.currency==='IDR'?'Rp '+Number(r.quote_price).toLocaleString(undefined,{maximumFractionDigits:0}):Number(r.quote_price).toFixed(2)+' '+r.currency))+'</td>';
      html+='<td><div class="qip-suggest-wrap"><input type="text" data-qip-match-search="'+i+'" placeholder="搜索 PSI SKU / 型号"><div class="qip-suggestions" data-qip-suggestions="'+i+'"></div></div></td></tr>';
    });
    html+='</tbody></table></div>';
    html+='<div class="qip-pagination"><span>显示 '+(previewOffset+1)+'–'+(previewOffset+visible.length)+' / '+unlinked+' 条未关联记录</span><span><button type="button" id="qip-prev" '+(previewOffset===0?'disabled':'')+'>上一页</button> <button type="button" id="qip-next" '+(previewOffset+30>=unlinked?'disabled':'')+'>下一页</button></span></div>';
  }
  box.innerHTML=html;
  const prev=$('#qip-prev',m),next=$('#qip-next',m);
  if(prev)prev.onclick=()=>{previewOffset=Math.max(0,previewOffset-30);renderPreview(m);};
  if(next)next.onclick=()=>{previewOffset+=30;renderPreview(m);};
  box.oninput=e=>{
    const input=e.target&&e.target.closest?e.target.closest('[data-qip-match-search]'):null;if(!input)return;
    const idx=Number(input.dataset.qipMatchSearch),row=currentRows[idx],term=String(input.value||'').trim().toLowerCase(),target=$('[data-qip-suggestions="'+idx+'"]',box);
    if(!target)return;
    if(term.length<1){target.innerHTML='';return;}
    const found=(importOptions&&importOptions.skus||[]).filter(x=>x.brand===row.brand&&[x.sku_code,x.model,x.product_name,x.category,x.barcode].some(v=>String(v||'').toLowerCase().includes(term))).slice(0,8);
    target.innerHTML=found.map(x=>'<button type="button" data-qip-select-match="'+idx+'" data-qip-sku="'+esc(x.sku_code)+'">'+esc(x.sku_code)+' · '+esc(x.model||x.product_name||x.category||'')+'</button>').join('')||'<div class="qip-sub" style="padding:8px">没有找到匹配 SKU</div>';
  };
  box.onclick=e=>{
    const btn=e.target&&e.target.closest?e.target.closest('[data-qip-select-match]'):null;if(!btn)return;
    const idx=Number(btn.dataset.qipSelectMatch),sku=String(btn.dataset.qipSku||''),target=(importOptions&&importOptions.skus||[]).find(x=>x.sku_code===sku);
    if(!target||!currentRows[idx])return;
    const row=currentRows[idx];row.psi_sku_code=sku;row.sku_code=sku;row.match_status='matched';row.match_source='manual';
    if(!row.product_type||row.product_type==='未分类')row.product_type=target.category||'未分类';
    if(!row.model)row.model=target.model||'';
    if(!row.spec)row.spec=target.color_spec||'';
    previewOffset=0;renderPreview(m);
  };
}
function rematchCurrentRows(m){
  const n=normalizer();if(!n||!importOptions||!currentRows.length)return;
  currentRows.forEach(r=>{
    if(r.brand_source==='default')r.brand=selectedBrand;
    if(r.quote_date_source==='default')r.quote_date=selectedQuoteDate;
  });
  currentRows=n.matchRows(currentRows,importOptions,{supplier_id:selectedSupplierId,brand:selectedBrand});
  const errors=n.validateRows(currentRows);
  if(errors.length){fileError(m,errors.slice(0,8).map(x=>'第 '+x.row+' 行：'+x.reason).join('\n'));return;}
  renderPreview(m);
}
function populateImportOptions(m){
  const supplier=$('#qip-supplier',m),brand=$('#qip-brand',m),file=$('#qm-file',m);
  const brands=importOptions&&importOptions.brands||[];
  const brandOptions=brands.map(x=>'<option value="'+esc(x)+'">'+esc(x)+'</option>').join('');
  brand.innerHTML=brandOptions;
  if(!brands.includes(selectedBrand))selectedBrand=brands[0]||'';
  brand.value=selectedBrand;
  const suppliers=importOptions&&importOptions.suppliers||[];
  const preferred=suppliers.find(x=>(x.brands||[]).includes(selectedBrand))||null;
  selectedSupplierId=preferred?preferred.id:'';
  supplier.innerHTML='<option value="">未指定供应商（不保存料号映射）</option>'+suppliers.map(x=>'<option value="'+esc(x.id)+'">'+esc(x.name)+'</option>').join('');
  supplier.value=selectedSupplierId;
  supplier.disabled=false;brand.disabled=false;file.disabled=false;
}
function openModal(){
  ensureCss();
  if(currentModal&&document.body.contains(currentModal))return;
  const m=document.createElement('div');currentModal=m;m.className='qm-modal qip-modal';
  selectedBrand=typeof window.getQuotationManagementBrand==='function'?window.getQuotationManagementBrand():'Netac';
  selectedQuoteDate=new Date().toISOString().slice(0,10);
  quoteDateTouched=false;
  m.innerHTML='<div class="qm-dialog qip-dialog"><div class="qip-titlebar"><div class="qip-dots"><span class="qip-dot r"></span><span class="qip-dot y"></span><span class="qip-dot g"></span></div><div class="qip-title">智能导入报价</div></div><div class="qip-body"><div class="qip-setup"><div class="qip-fields"><div class="qip-field"><label>供应商</label><select id="qip-supplier" disabled><option>正在加载…</option></select></div><div class="qip-field"><label>品牌（工作表未提供品牌时使用）</label><select id="qip-brand" disabled><option>正在加载…</option></select></div><div class="qip-field"><label>默认报价日期</label><input type="date" id="qip-date" value="'+selectedQuoteDate+'"></div></div><div class="qip-drop"><input type="file" id="qm-file" accept=".xlsx,.xls,.csv" disabled><div class="qip-sub" style="margin-top:10px">自动识别 Excel 所有工作表、表头位置和常见供应商字段，不需要先改成 PSI 模板。</div><div class="qip-sub" style="margin-top:5px">未匹配 PSI SKU 的供应商料号也可以导入；FOB 空白或 0 表示未报价。单个文件最大 50MB，单次最多 5,000 行。</div></div><div class="qip-options"><div>重复供应商 + SKU/料号 + 品牌 + 报价日期</div><select id="qm-mode"><option value="skip">跳过已有记录</option><option value="overwrite">覆盖已有记录</option></select></div><div id="qm-preview"></div></div><div id="qm-import-live"></div></div><div class="qip-footer"><button class="qip-btn" id="qm-cancel">取消</button><button class="qip-btn primary" id="qm-submit" disabled>开始导入</button></div></div>';
  document.body.appendChild(m);currentRows=[];currentRun=null;needsRefresh=false;previewOffset=0;recognizedSheets=[];ignoredSheets=[];
  const active=getId();
  if(active){
    startedAtMs=Date.now();$('#qm-submit',m).disabled=true;
    renderModalProgress({import_id:active,status:'running',phase:'starting',percent:1,total_count:0,processed_count:0,message:'正在恢复导入任务'});
    startPolling(active);
  }
  $('#qm-cancel',m).onclick=()=>closeCurrentModal();
  $('#qip-date',m).onchange=e=>{
    quoteDateTouched=true;
    selectedQuoteDate=e.target.value||new Date().toISOString().slice(0,10);
    if(currentRows.length){previewOffset=0;rematchCurrentRows(m);}
  };
  $('#qip-supplier',m).onchange=e=>{
    selectedSupplierId=e.target.value||'';
    const sup=(importOptions.suppliers||[]).find(x=>x.id===selectedSupplierId);
    if(sup&&sup.brands&&sup.brands.length===1){selectedBrand=sup.brands[0];$('#qip-brand',m).value=selectedBrand;}
    if(currentRows.length)rematchCurrentRows(m);
  };
  $('#qip-brand',m).onchange=e=>{
    selectedBrand=e.target.value||'';
    const sup=(importOptions.suppliers||[]).find(x=>(x.brands||[]).includes(selectedBrand));
    if(sup){selectedSupplierId=sup.id;$('#qip-supplier',m).value=selectedSupplierId;}
    if(currentRows.length)rematchCurrentRows(m);
  };
  $('#qm-file',m).onchange=async e=>{
    const f=e.target.files[0];if(!f)return;
    if(f.size>MAX_FILE_BYTES)return fileError(m,'文件过大。单个报价导入文件最大 50MB，请压缩无关图片或拆分工作表后重试。');
    try{
      const wb=XLSX.read(await f.arrayBuffer(),{type:'array'});
      const sheets=wb.SheetNames.map(name=>({name,rows:XLSX.utils.sheet_to_json(wb.Sheets[name],{header:1,defval:''})}));
      const n=normalizer();
      if(!n||typeof n.parseSheetRows!=='function')return fileError(m,'智能识别模块尚未加载，请刷新页面后重试。');
      const selectedSupplier=(importOptions&&importOptions.suppliers||[]).find(x=>x.id===selectedSupplierId);
      const inferredDate=!quoteDateTouched&&typeof n.inferQuoteDate==='function'?n.inferQuoteDate(sheets,f.name):'';
      if(inferredDate){selectedQuoteDate=inferredDate;$('#qip-date',m).value=inferredDate;}
      const parsed=n.parseSheetRows(sheets,{brand:selectedBrand,quote_date:selectedQuoteDate,supplier_id:selectedSupplierId,currency:selectedSupplier&&selectedSupplier.default_currency||''});
      if(parsed.errors&&parsed.errors.length)return fileError(m,parsed.errors.map(x=>x.reason).join('\n'));
      if(!parsed.rows.length)return fileError(m,'没有识别到可导入数据。请确认工作表包含供应商料号（Part No. / SKU）和报价（FOB / Price）列。');
      if(parsed.rows.length>MAX_ROWS)return fileError(m,'所有工作表合计 '+parsed.rows.length+' 行，单次最多支持 '+MAX_ROWS+' 行，请拆分后重试。');
      recognizedSheets=parsed.recognized_sheets||[];ignoredSheets=parsed.ignored_sheets||[];
      const fileBrands=[...new Set(parsed.rows.map(r=>String(r.brand||'').trim()).filter(Boolean))];
      if(fileBrands.length===1){
        selectedBrand=(importOptions.brands||[]).find(x=>x.toLowerCase()===fileBrands[0].toLowerCase())||fileBrands[0];
        $('#qip-brand',m).value=selectedBrand;
        const detectedSupplier=(importOptions.suppliers||[]).find(x=>(x.brands||[]).includes(selectedBrand));
        selectedSupplierId=detectedSupplier?detectedSupplier.id:'';$('#qip-supplier',m).value=selectedSupplierId;
      }
      currentRows=n.matchRows(parsed.rows,importOptions,{supplier_id:selectedSupplierId,brand:selectedBrand});
      const errors=n.validateRows(currentRows);
      if(errors.length)return fileError(m,'导入校验失败（'+errors.length+' 行）\n'+errors.slice(0,8).map(x=>'第 '+x.row+' 行：'+x.reason).join('\n'));
      previewOffset=0;renderPreview(m);
      $('#qm-submit',m).disabled=false;
    }catch(err){fileError(m,'文件读取失败：'+(err&&err.message?err.message:err));}
  };
  $('#qm-submit',m).onclick=async()=>{
    const submit=$('#qm-submit',m);
    if(submit.dataset.close==='1'){closeCurrentModal();return;}
    if(getId())return;
    if(!currentRows.length)return fileError(m,'请先选择文件。');
    if(!selectedSupplierId){
      const rowBrands=[...new Set(currentRows.map(r=>r.brand).filter(Boolean))];
      if(rowBrands.length===1){
        const candidates=(importOptions&&importOptions.suppliers||[]).filter(x=>(x.brands||[]).includes(rowBrands[0]));
        if(candidates.length>1)return fileError(m,'品牌 '+rowBrands[0]+' 对应多个供应商，请先选择正确供应商。');
        if(candidates.length===1){
          selectedSupplierId=candidates[0].id;$('#qip-supplier',m).value=selectedSupplierId;
          currentRows=normalizer().matchRows(currentRows,importOptions,{supplier_id:selectedSupplierId,brand:selectedBrand});
        }
      }
    }
    const mappings=currentRows.filter(r=>r.match_source==='manual'&&r.psi_sku_code).map(r=>({
      brand:r.brand,supplier_part_no:r.supplier_part_no,psi_sku_code:r.psi_sku_code
    }));
    const id=makeId();setId(id);handledTerminalId='';startedAtMs=Date.now();
    $('#qm-file',m).disabled=true;$('#qm-mode',m).disabled=true;submit.disabled=true;
    $('#qip-supplier',m).disabled=true;$('#qip-brand',m).disabled=true;$('#qip-date',m).disabled=true;
    const initial={import_id:id,status:'running',phase:'starting',percent:1,total_count:currentRows.length,processed_count:0,no_quote:currentRows.filter(r=>Number(r.quote_price)===0).length,unlinked:currentRows.filter(r=>r.match_status==='unlinked').length,message:'正在启动报价导入',created_at:new Date().toISOString()};
    updateTopButton(initial);renderModalProgress(initial);
    await nextPaint();startPolling(id);
    try{
      const res=await rawPost('/api/quotation-management/import',{
        rows:currentRows,duplicate_mode:$('#qm-mode',m).value,import_id:id,supplier_id:selectedSupplierId,brand:selectedBrand,quote_date:selectedQuoteDate,mapping_updates:mappings
      });
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
  statusApi('/api/quotation-management/import-options').then(data=>{
    importOptions=data||{suppliers:[],skus:[],mappings:[],brands:[]};
    const n=normalizer();
    if(n&&typeof n.setBrandCurrencies==='function')n.setBrandCurrencies(importOptions.brand_currencies||{},importOptions.currencies||[]);
    populateImportOptions(m);
  }).catch(err=>fileError(m,'无法加载供应商和 SKU 主数据：'+(err&&err.message?err.message:err)));
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
