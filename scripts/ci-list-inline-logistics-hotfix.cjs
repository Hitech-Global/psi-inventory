'use strict';
const fs = require('node:fs');
const path = require('node:path');

const APP_JS = path.join(__dirname, '..', 'app.js');
const INDEX_HTML = path.join(__dirname, '..', 'index.html');
const APP_MARKER = '// CI-LIST-INLINE-LOGISTICS-V1';
const CSS_MARKER = '/* CI-LIST-INLINE-LOGISTICS-MAC-V1 */';

function countOf(src, needle) { return src.split(needle).length - 1; }

function helperPatch() {
  return `
${APP_MARKER}
function ciListLogisticsCount(c){
  const raw=String((c&&c.related_logistics_batch_nos)||'').trim();
  if(!raw||raw==='—') return 0;
  return raw.split(',').map(function(x){return x.trim();}).filter(Boolean).length;
}
function renderCIListLogisticsRow(c){
  const cid=esc(c.id);
  const count=ciListLogisticsCount(c);
  return '<tr class="ci-list-logi-row" id="ci-list-logi-row-'+cid+'" hidden onclick="event.stopPropagation()">'
    +'<td colspan="99"><div class="ci-list-logi-panel"><div class="ci-list-logi-panel-head">'
    +'<div class="ci-list-logi-title">🚚 '+t('logistics.title','物流批次')+' <span class="ci-list-logi-count">('+count+')</span></div>'
    +'<button type="button" class="ci-list-logi-collapse" onclick="event.stopPropagation();toggleCIListLogistics(\\''+cid+'\\')" title="'+t('common.close','收起')+'">⌃</button>'
    +'</div><div class="ci-list-logi-body" id="ci-list-logi-body-'+cid+'"></div></div></td></tr>';
}
function closeCIListLogistics(ciId){
  if(!ciId) return;
  const row=document.getElementById('ci-list-logi-row-'+ciId);
  if(row) row.setAttribute('hidden','');
  const caret=document.getElementById('ci-list-logi-caret-'+ciId);
  if(caret) caret.textContent='▶';
  if(window.__ciListLogiOpenId===ciId) window.__ciListLogiOpenId=null;
}
function renderCIListLogisticsLoading(ciId){
  return '<div class="ci-list-logi-loading"><span class="ci-list-logi-spinner" aria-hidden="true"></span><div><div class="ci-list-logi-loading-title">'+t('logistics.list.loading','正在加载物流批次…')+'</div><div class="ci-list-logi-loading-sub">'+t('logistics.list.loading_hint','正在读取该 CI 的物流批次信息，请稍候')+'</div></div></div>';
}
function renderCIListLogisticsPanel(batches, ciId){
  const list=Array.isArray(batches)?batches:[];
  const canCreate=hasPermission('logistics_create');
  let body='';
  if(!list.length){
    body='<div class="ci-list-logi-empty">'+t('logistics.no_batch','该CI暂无关联物流批次')+'</div>';
  }else{
    const rows=list.map(function(b){
      const cbmFromPl=(b.pls||[]).reduce(function(s,p){return s+(Number(p.total_cbm)||0);},0);
      const cbm=cbmFromPl>0?cbmFromPl:(Number(b.total_cbm)||0);
      const fv=(b.freight_value_ratio==null)?'—':(Number(b.freight_value_ratio).toFixed(2)+'%');
      const cargoCur=b.ci_currency||b.freight_currency||'';
      return '<tr>'
        +'<td class="cell-id">'+esc(b.batch_no||'')+'</td>'
        +'<td>'+esc(b.forwarder_name||'—')+'</td>'
        +'<td>'+esc(b.transport_mode||'—')+'</td>'
        +'<td class="cell-date">'+(fmtDate(b.eta_date)||'—')+'</td>'
        +'<td class="cell-date">'+(fmtDate(b.actual_arrival_date)||'—')+'</td>'
        +'<td>'+(b.actual_transit_days!=null?esc(b.actual_transit_days):'—')+'</td>'
        +'<td>'+(b.total_cartons!=null?esc(b.total_cartons):'0')+'</td>'
        +'<td>'+cbm.toFixed(2)+'</td>'
        +'<td>'+fmtMoney(b.cargo_value||0,cargoCur)+'</td>'
        +'<td>'+fmtMoney(b.total_freight||0,b.freight_currency)+'</td>'
        +'<td>'+fv+'</td>'
        +'<td>'+esc(b.logistics_display_status||b.logistics_status||'—')+'</td>'
        +'<td>'+esc(b.listing_status||'pending_plan')+'</td>'
        +'<td class="ci-list-logi-owners">'+(b.listing_owner_names&&b.listing_owner_names.length?esc(b.listing_owner_names.join('、')):'—')+'</td>'
        +'<td class="cell-actions"><button class="action-btn" title="'+t('common.edit','编辑')+'" onclick="event.stopPropagation();editLogFromCIList(\\''+esc(b.id)+'\\',\\''+esc(ciId)+'\\')">✏️</button> '
        +'<button class="action-btn" title="'+t('common.export','导出')+'" onclick="event.stopPropagation();toggleCIListBatchExportMenu(\\''+esc(b.id)+'\\')">⬇️</button>'
        +'<div id="ci-list-logi-export-'+esc(b.id)+'" class="ci-list-logi-export" style="display:none"></div></td>'
        +'</tr>';
    }).join('');
    body='<div class="table-container ci-list-logi-table-wrap"><table class="data-table ci-list-logi-table"><thead><tr>'
      +'<th>'+t('logistics.col.batch_no','物流单号')+'</th>'
      +'<th>'+t('logistics.col.forwarder','货代')+'</th>'
      +'<th>'+t('logistics.col.transport','运输方式')+'</th>'
      +'<th>'+t('logistics.col.eta','预计到港')+'</th>'
      +'<th>'+t('logistics.col.arrival','到货日期')+'</th>'
      +'<th>'+t('logistics.col.transit_days','运输时效')+'</th>'
      +'<th>'+t('logistics.col.cartons','箱数')+'</th>'
      +'<th>'+t('logistics.col.cbm','CBM')+'</th>'
      +'<th>'+t('logistics.col.cargo_value','总货值')+'</th>'
      +'<th>'+t('logistics.col.freight','综合运费')+'</th>'
      +'<th>'+t('logistics.col.freight_ratio','运费/货值')+'</th>'
      +'<th>'+t('logistics.col.status','状态')+'</th>'
      +'<th>'+t('logistics.col.listing_status','Listing状态')+'</th>'
      +'<th>'+t('logistics.col.owners','负责人')+'</th>'
      +'<th>'+t('common.actions','操作')+'</th>'
      +'</tr></thead><tbody>'+rows+'</tbody></table></div>';
  }
  const createBtn=canCreate?'<button class="btn btn-primary btn-sm ci-list-logi-create" onclick="event.stopPropagation();createLogFromCIList(\\''+esc(ciId)+'\\')">+ '+t('logistics.new_batch','新建物流批次')+'</button>':'';
  return body+(createBtn?'<div class="ci-list-logi-actions">'+createBtn+'</div>':'');
}
async function toggleCIListLogistics(ciId, forceOpen){
  const row=document.getElementById('ci-list-logi-row-'+ciId);
  if(!row) return;
  const current=window.__ciListLogiOpenId||null;
  if(current&&current!==ciId) closeCIListLogistics(current);
  const shouldOpen=forceOpen===true||row.hasAttribute('hidden');
  if(!shouldOpen){ closeCIListLogistics(ciId); return; }
  row.removeAttribute('hidden');
  window.__ciListLogiOpenId=ciId;
  const caret=document.getElementById('ci-list-logi-caret-'+ciId);
  if(caret) caret.textContent='▼';
  const body=document.getElementById('ci-list-logi-body-'+ciId);
  if(!body) return;
  const cached=(typeof __ciLogiCache!=='undefined'&&__ciLogiCache.has(ciId))?__ciLogiCache.get(ciId):null;
  if(cached){ body.innerHTML=renderCIListLogisticsPanel(cached.data||[],ciId); return; }
  const seq=(window.__ciListLogiReqSeq||0)+1;
  window.__ciListLogiReqSeq=seq;
  body.innerHTML=renderCIListLogisticsLoading(ciId);
  try{
    const data=await api('/api/commercial-invoices/'+ciId+'/logistics-batches');
    if(typeof __ciLogiCache!=='undefined') __ciLogiCache.set(ciId,{ts:Date.now(),data:data});
    if(window.__ciListLogiReqSeq!==seq||window.__ciListLogiOpenId!==ciId) return;
    const liveBody=document.getElementById('ci-list-logi-body-'+ciId);
    if(liveBody) liveBody.innerHTML=renderCIListLogisticsPanel(data||[],ciId);
  }catch(e){
    if(window.__ciListLogiReqSeq!==seq||window.__ciListLogiOpenId!==ciId) return;
    const liveBody=document.getElementById('ci-list-logi-body-'+ciId);
    if(liveBody) liveBody.innerHTML='<div class="ci-list-logi-error">'+esc(e.message||t('common.load_fail','加载失败'))+' <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();toggleCIListLogistics(\\''+esc(ciId)+'\\',true)">'+t('common.retry','重试')+'</button></div>';
  }
}
function toggleCIListBatchExportMenu(batchId){
  const el=document.getElementById('ci-list-logi-export-'+batchId);
  if(!el) return;
  if(el.style.display!=='none'){el.style.display='none';el.innerHTML='';return;}
  el.style.display='block';
  el.innerHTML='<button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();exportBatchPL(\\''+esc(batchId)+'\\')">'+t('export.pl_only','导出PL')+'</button> '
    +'<button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();exportBatchCIAndPL(\\''+esc(batchId)+'\\')">'+t('export.ci_and_pl','导出CI&PL')+'</button>';
}
async function createLogFromCIList(ciId){
  await createLogFromCI(ciId);
  if(window.__logiCtx&&window.__logiCtx.ciId===ciId){
    window.__logiCtx={source:'ci-list',ciId:ciId};
    const back=document.querySelector('#modal-content .ci-logi-back');
    if(back) back.remove();
  }
}
async function editLogFromCIList(batchId,ciId){
  await editLogFromCI(batchId,ciId);
  if(window.__logiCtx&&window.__logiCtx.ciId===ciId){
    window.__logiCtx={source:'ci-list',ciId:ciId};
    const back=document.querySelector('#modal-content .ci-logi-back');
    if(back) back.remove();
  }
}
async function refreshCIListLogisticsAfterMutation(ciId){
  invalidateCILogistics(ciId);
  if(typeof currentPage!=='undefined'&&currentPage==='ci'){
    await loadCI();
    await toggleCIListLogistics(ciId,true);
  }
}
`;
}

function patchOperationalTable(src) {
  const fnAnchor = 'function renderOperationalCITable(data){';
  const nextFn = '\nfunction renderHistoricalCITable(data){';
  const start = src.indexOf(fnAnchor);
  const end = start >= 0 ? src.indexOf(nextFn, start) : -1;
  if (start < 0 || end < 0) throw new Error('[CI-LIST-INLINE] renderOperationalCITable range missing');
  let block = src.slice(start, end);
  if (block.includes('ci-list-logi-toggle')) return src;

  block = block.replace(fnAnchor, fnAnchor + '\n  window.__ciListLogiOpenId=null;');
  const firstCell = '<td class="cell-id"><span class="link-text"';
  if (countOf(block, firstCell) !== 1) throw new Error('[CI-LIST-INLINE] CI first-cell anchor mismatch');
  block = block.replace(firstCell,
    `<td class="cell-id"><button type="button" class="ci-list-logi-toggle" title="物流批次（'+ciListLogisticsCount(c)+'）" onclick="event.stopPropagation();toggleCIListLogistics(\''+c.id+'\')"><span id="ci-list-logi-caret-'+esc(c.id)+'">▶</span></button><span class="link-text"`);

  const tail = "</td></tr>').join('')";
  const tailPos = block.lastIndexOf(tail);
  if (tailPos < 0) throw new Error('[CI-LIST-INLINE] operational row tail mismatch');
  block = block.slice(0, tailPos) + "</td></tr>'+renderCIListLogisticsRow(c)).join('')" + block.slice(tailPos + tail.length);

  return src.slice(0, start) + block + src.slice(end);
}

function patchSaveContexts(src) {
  const oldBlock = `if(window.__logiCtx && window.__logiCtx.source==='ci-detail'){
      const cid=window.__logiCtx.ciId; window.__logiCtx=null;
      invalidateCILogistics(cid);
      await viewCI(cid);
    } else { loadLog(); }`;
  const newBlock = `if(window.__logiCtx && window.__logiCtx.source==='ci-list'){
      const cid=window.__logiCtx.ciId; window.__logiCtx=null;
      await refreshCIListLogisticsAfterMutation(cid);
    } else if(window.__logiCtx && window.__logiCtx.source==='ci-detail'){
      const cid=window.__logiCtx.ciId; window.__logiCtx=null;
      invalidateCILogistics(cid);
      await viewCI(cid);
    } else { loadLog(); }`;
  const n = countOf(src, oldBlock);
  if (n !== 2) throw new Error('[CI-LIST-INLINE] logistics save-context anchor mismatch: ' + n);
  return src.split(oldBlock).join(newBlock);
}

function patchAppSource(src) {
  if (src.includes(APP_MARKER)) return src;
  const fnAnchor = 'function renderOperationalCITable(data){';
  if (countOf(src, fnAnchor) !== 1) throw new Error('[CI-LIST-INLINE] renderOperationalCITable anchor mismatch');
  let out = src.replace(fnAnchor, helperPatch() + '\n' + fnAnchor);
  out = patchOperationalTable(out);
  out = patchSaveContexts(out);
  return out;
}

function cssPatch() {
  return `
${CSS_MARKER}
/* Inline logistics workspace under CI list rows. Lazy-loaded; CSS adds no requests/listeners/timers. */
.content-inner:has(#ci-source-mode) #ci-table .ci-list-logi-toggle{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;margin-right:5px;padding:0;border:0;border-radius:6px;background:transparent;color:#6e6e73;font-size:10px;vertical-align:middle;cursor:pointer;box-shadow:none}
.content-inner:has(#ci-source-mode) #ci-table .ci-list-logi-toggle:hover{background:#ececf0;color:#1d1d1f}
.content-inner:has(#ci-source-mode) #ci-table .ci-list-logi-row[hidden]{display:none!important}
.content-inner:has(#ci-source-mode) #ci-table .ci-list-logi-row>td{padding:0!important;background:#f8f8fa!important;border-bottom:1px solid #e5e5ea!important;white-space:normal!important}
.content-inner:has(#ci-source-mode) #ci-table .ci-list-logi-panel{margin:8px 10px 12px;padding:0;background:#fff;border:1px solid #e1e1e6;border-radius:14px;overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,.025)}
.content-inner:has(#ci-source-mode) #ci-table .ci-list-logi-panel-head{display:flex;align-items:center;justify-content:space-between;padding:11px 13px;border-bottom:1px solid #ededf0;background:#fbfbfc}
.content-inner:has(#ci-source-mode) #ci-table .ci-list-logi-title{font-size:13px;font-weight:650;color:#1d1d1f}
.content-inner:has(#ci-source-mode) #ci-table .ci-list-logi-count{color:#86868b;font-weight:500}
.content-inner:has(#ci-source-mode) #ci-table .ci-list-logi-collapse{display:flex;align-items:center;justify-content:center;width:28px;height:26px;padding:0;border:1px solid #e5e5ea;border-radius:8px;background:#fff;color:#6e6e73;cursor:pointer}
.content-inner:has(#ci-source-mode) #ci-table .ci-list-logi-collapse:hover{background:#f2f2f4;color:#1d1d1f}
.content-inner:has(#ci-source-mode) #ci-table .ci-list-logi-body{padding:10px 12px 12px}
.content-inner:has(#ci-source-mode) #ci-table .ci-list-logi-table-wrap{margin:0;border:1px solid #e5e5ea;border-radius:10px!important;overflow:auto;background:#fff;box-shadow:none!important}
.content-inner:has(#ci-source-mode) #ci-table .ci-list-logi-table{min-width:1320px;font-size:12px;background:#fff}
.content-inner:has(#ci-source-mode) #ci-table .ci-list-logi-table th{padding:8px 9px!important;background:#f2f2f4!important;color:#6e6e73!important;font-size:11px!important;font-weight:650!important;text-align:left!important;white-space:nowrap!important}
.content-inner:has(#ci-source-mode) #ci-table .ci-list-logi-table td{padding:8px 9px!important;background:#fff!important;color:#3a3a3c!important;text-align:left!important;white-space:nowrap!important;border-bottom:1px solid #ededf0!important}
.content-inner:has(#ci-source-mode) #ci-table .ci-list-logi-table .text-right{text-align:left!important}
.content-inner:has(#ci-source-mode) #ci-table .ci-list-logi-table tbody tr:hover td{background:#fafafa!important}
.content-inner:has(#ci-source-mode) #ci-table .ci-list-logi-owners{max-width:220px;overflow:hidden;text-overflow:ellipsis}
.content-inner:has(#ci-source-mode) #ci-table .ci-list-logi-table .cell-actions{position:relative}
.content-inner:has(#ci-source-mode) #ci-table .ci-list-logi-actions{padding-top:10px}
.content-inner:has(#ci-source-mode) #ci-table .ci-list-logi-create{min-height:32px;padding:5px 11px;border-radius:8px;background:#1d1d1f;border-color:#1d1d1f;color:#fff;font-size:12px;font-weight:650;box-shadow:none}
.content-inner:has(#ci-source-mode) #ci-table .ci-list-logi-create:hover{background:#000;border-color:#000}
.content-inner:has(#ci-source-mode) #ci-table .ci-list-logi-export{position:absolute;z-index:8;margin-top:5px;padding:6px;background:#fff;border:1px solid #e5e5ea;border-radius:9px;box-shadow:0 8px 24px rgba(0,0,0,.12);white-space:nowrap}
.content-inner:has(#ci-source-mode) #ci-table .ci-list-logi-loading{display:flex;align-items:center;gap:11px;min-height:82px;padding:15px 16px;background:#fafafa;border:1px solid #ededf0;border-radius:10px;color:#1d1d1f}
.content-inner:has(#ci-source-mode) #ci-table .ci-list-logi-spinner{width:18px;height:18px;flex:0 0 18px;border:2px solid #d2d2d7;border-top-color:#1d1d1f;border-radius:50%;animation:ciListLogiSpin .75s linear infinite}
@keyframes ciListLogiSpin{to{transform:rotate(360deg)}}
.content-inner:has(#ci-source-mode) #ci-table .ci-list-logi-loading-title{font-size:13px;font-weight:650;color:#1d1d1f}
.content-inner:has(#ci-source-mode) #ci-table .ci-list-logi-loading-sub{margin-top:3px;font-size:11px;color:#86868b}
.content-inner:has(#ci-source-mode) #ci-table .ci-list-logi-empty,.content-inner:has(#ci-source-mode) #ci-table .ci-list-logi-error{padding:18px 14px;background:#fafafa;border:1px solid #ededf0;border-radius:10px;color:#86868b;font-size:12px}
.content-inner:has(#ci-source-mode) #ci-table .ci-list-logi-error{color:#b45309}
`;
}

function patchIndexSource(src) {
  if (src.includes(CSS_MARKER)) return src;
  const close = '</style>';
  const pos = src.lastIndexOf(close);
  if (pos < 0) throw new Error('[CI-LIST-INLINE] index style anchor missing');
  return src.slice(0, pos) + cssPatch() + '\n' + src.slice(pos);
}

function apply() {
  const appSrc = fs.readFileSync(APP_JS, 'utf8');
  const appOut = patchAppSource(appSrc);
  if (appOut !== appSrc) fs.writeFileSync(APP_JS, appOut, 'utf8');
  const htmlSrc = fs.readFileSync(INDEX_HTML, 'utf8');
  const htmlOut = patchIndexSource(htmlSrc);
  if (htmlOut !== htmlSrc) fs.writeFileSync(INDEX_HTML, htmlOut, 'utf8');
  console.log('[CI-LIST-INLINE] lazy inline logistics workspace applied');
}

if (require.main === module) apply();
module.exports = { APP_MARKER, CSS_MARKER, helperPatch, patchOperationalTable, patchSaveContexts, patchAppSource, cssPatch, patchIndexSource };
