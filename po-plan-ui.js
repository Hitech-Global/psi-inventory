(function(global){
'use strict';

const planCache=new Map();
const CACHE_TTL=30000;
let availablePlans=[];
let _poPlanFacetRows=null;
let _poPlanPageEpoch=0;
let _poFacetOutsideHandlerBound=false;
let originalCreatePI=null,originalCmpRowHTML=null,originalCmpDerived=null,originalRecompute=null;
const $=(s,r=document)=>r.querySelector(s);
const E=v=>typeof global.esc==='function'?global.esc(v):String(v??'');
const qty=v=>Math.max(0,Math.trunc(Number(v)||0));
const apiCall=(u,m='GET',b=null)=>global.api(u,m,b);
const statusText=s=>({open:'待采购',partial:'部分转PI',completed:'已全部转PI',closed:'已关闭'}[s]||s||'—');
const statusClass=s=>s==='completed'?'status-completed':s==='partial'?'status-pending':s==='closed'?'status-draft':'status-approved';
function bindPOFacetOutsideClose(){
  if(_poFacetOutsideHandlerBound)return;
  _poFacetOutsideHandlerBound=true;
  document.addEventListener('click',event=>{
    const current=event.target?.closest?.('.pp-facet')||null;
    document.querySelectorAll('.pp-facet[open]').forEach(facet=>{
      if(facet!==current)facet.open=false;
    });
  });
}
function selectedPOFacets(kind){
  const root=$('#po-'+kind+'-options');
  return root?[...root.querySelectorAll('input[type="checkbox"]:checked')].map(input=>input.value).sort((a,b)=>a.localeCompare(b,'zh-Hans')):[];
}
function poFacetHtml(kind,label){
  return '<div class="filter-group pp-facet-group"><label>'+E(label)+'</label><details id="po-'+kind+'-filter" class="pp-facet"><summary id="po-'+kind+'-summary">全部'+E(label)+'</summary><div class="pp-facet-options" id="po-'+kind+'-options"><span>加载中…</span></div></details></div>';
}
function poPlanPopulateFacets(rows){
  _poPlanFacetRows=rows;
  for(const [kind,field,label] of [['brand','brand','品牌'],['country','country','国家']]){
    const el=$('#po-'+kind+'-options');if(!el)return;
    const selected=new Set(selectedPOFacets(kind));
    const map=new Map();
    rows.forEach(row=>{
      const value=String(row[field]||'').trim();
      if(value&&!map.has(value.toLocaleLowerCase()))map.set(value.toLocaleLowerCase(),value);
    });
    const options=[...map.values()].sort((a,b)=>a.localeCompare(b,'zh-Hans'));
    el.innerHTML=options.length?options.map(value=>'<label class="pp-facet-option"><input type="checkbox" value="'+E(value)+'"'+(selected.has(value)?' checked':'')+'><span>'+E(value)+'</span></label>').join(''):'<span class="pp-facet-empty">无可用选项</span>';
    poPlanFacetSummary(kind,label);
  }
}
function poPlanFacetSummary(kind,label){
  const el=$('#po-'+kind+'-summary');
  if(!el)return;
  const values=selectedPOFacets(kind);
  el.textContent=values.length===0?'全部'+label:values.length===1?values[0]:'已选 '+values.length+' 项';
}
function cacheKey(){return [$('#po-fs')?.value||'',selectedPOFacets('brand').join('~'),selectedPOFacets('country').join('~'),$('#po-fk')?.value||''].join('|');}
function clearCaches(){planCache.clear();availablePlans=[];try{if(global.AppStore)global.AppStore.onMutation('PUT','/api/purchase-orders/po-plan',{});}catch(_e){}}
function ensureCss(){if($('#po-plan-css'))return;const s=document.createElement('style');s.id='po-plan-css';s.textContent=`.po-plan-summary{display:flex;gap:18px;align-items:center}.po-plan-num{font-variant-numeric:tabular-nums;font-weight:650}.po-plan-remain{color:#1677ff;font-weight:700}.po-plan-used{color:#6e6e73}.po-plan-editor{border:1px solid #e7e7ea;border-radius:14px;overflow:hidden}.po-plan-editor table{width:100%;border-collapse:collapse}.po-plan-editor th{font-size:12px;color:#6e6e73;background:#f7f8fa;padding:9px 8px;text-align:left}.po-plan-editor th:nth-child(-n+2){padding-left:18px}.po-plan-editor td{padding:8px;border-top:1px solid #eee;text-align:left}.po-plan-editor input{height:34px;border:1px solid #d8dadd;border-radius:8px;padding:0 9px;text-align:left}.po-plan-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:12px 0}.po-plan-card{background:#f7f8fa;border-radius:12px;padding:12px}.po-plan-card span{font-size:11px;color:#86868b}.po-plan-card b{display:block;font-size:21px;margin-top:4px}.po-plan-hint{font-size:12px;color:#6e6e73;background:#f5f7fb;border-radius:10px;padding:9px 11px;margin:10px 0} .po-plan-pi-note{font-size:11px;color:#6e6e73;margin-top:4px}.pp-facet-group{position:relative;min-width:152px}.pp-facet{position:relative}.pp-facet>summary{list-style:none;height:30px;min-width:150px;padding:5px 10px;border:1px solid var(--border);border-radius:7px;background:var(--card-bg);font-size:12px;cursor:pointer;user-select:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.pp-facet>summary::-webkit-details-marker{display:none}.pp-facet>summary::after{content:'▾';float:right;margin-left:8px}.pp-facet-options{position:absolute;top:32px;left:0;z-index:80;background:var(--card-bg);border:1px solid var(--border);border-radius:9px;box-shadow:0 6px 20px #0002;min-width:210px;max-height:250px;overflow:auto;padding:6px}.pp-facet-option{display:flex;align-items:center;gap:8px;padding:7px 8px;font-size:12px;cursor:pointer;white-space:nowrap}.pp-facet-option:hover{background:var(--hover-bg,#f5f5f7)}.pp-facet-empty{display:block;padding:10px;font-size:12px;color:#888}#po-table .data-table th.po-plan-col-left,#po-table .data-table td.po-plan-col-left{text-align:left!important}.pp-fx-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin:12px 0}.pp-fx-field{background:#f7f8fa;border:1px solid #eceef1;border-radius:11px;padding:10px 12px;min-width:0}.pp-fx-field label{display:block;font-size:11px;color:#777;margin-bottom:6px}.pp-fx-value{font-size:14px;font-weight:650;color:#222;min-height:22px}.pp-fx-field input{width:100%;height:34px;border:1px solid #d8dadd;border-radius:8px;background:#fff;padding:0 10px;text-align:left}.pp-fx-field input:disabled{background:#f0f1f3;color:#777}.pp-price-alert{font-size:12px;border-radius:9px;padding:9px 11px;margin:8px 0;color:#4f5965;background:#f4f6f8}.pp-price-alert.is-warning{color:#805b13;background:#fff7e5}.pp-price-alert.is-error{color:#a4262c;background:#fff0f0}.pp-price-preview{margin-top:12px;border:1px solid #e7e7ea;border-radius:12px;overflow:auto}.pp-price-preview table{width:100%;min-width:690px;border-collapse:collapse;font-size:12px}.pp-price-preview th{background:#f7f8fa;color:#6e6e73;font-weight:600;text-align:left;padding:10px 9px;white-space:nowrap}.pp-price-preview td{padding:10px 9px;border-top:1px solid #eee;text-align:left;white-space:nowrap}.pp-price-preview td.num,.pp-price-preview th.num{text-align:right;font-variant-numeric:tabular-nums}.pp-price-preview tfoot td{background:#fafafa;font-weight:700}.pp-price-empty{padding:14px;color:#777;font-size:12px}.pp-price-source{color:#6e6e73;font-size:11px}.pp-price-total{font-weight:750;font-variant-numeric:tabular-nums}`;document.head.appendChild(s);}

function renderPOPlan(){
  ++_poPlanPageEpoch;
  _poPlanFacetRows=null;
  ensureCss();
  bindPOFacetOutsideClose();
  const c=$('#content-inner');if(!c)return;
  c.innerHTML=`<div id="flash-container"></div><div class="filter-bar"><div class="filter-form"><div class="filter-group"><label>状态</label><select id="po-fs"><option value="">全部</option><option value="open">待采购</option><option value="partial">部分转PI</option><option value="completed">已全部转PI</option><option value="closed">已关闭</option></select></div>${poFacetHtml('brand','品牌')}${poFacetHtml('country','国家')}<div class="filter-group"><label>关键词</label><input id="po-fk" placeholder="PO号 / 供应商"></div><div class="filter-actions"><button class="btn btn-primary btn-sm" id="po-plan-search">搜索</button>${global.hasPermission&&global.hasPermission('po_create')?'<button class="btn btn-primary btn-sm" id="po-plan-new">➕ 新建PO</button>':''}</div></div></div><div class="table-section"><div class="table-section-title"><div class="table-section-title-left">🛒 PO采购计划</div><div style="font-size:12px;color:#86868b">PO=动态采购计划 · PI=实际采购确认</div></div><div id="po-table"><div class="empty-state"><div class="empty-icon">⏳</div>加载中…</div></div></div>`;
  for(const [kind,label] of [['brand','品牌'],['country','国家']]){
    const options=$('#po-'+kind+'-options');
    options.addEventListener('change',event=>{
      if(event.target.matches('input[type="checkbox"]')){
        poPlanFacetSummary(kind,label);
        loadPOPlan(false);
      }
    });
  }
  $('#po-plan-search').onclick=()=>loadPOPlan(false);$('#po-fk').onkeypress=e=>{if(e.key==='Enter')loadPOPlan(false)};if($('#po-plan-new'))$('#po-plan-new').onclick=createPOPlan;
  loadPOPlan(true);
}
async function loadPOPlan(useCache){
  const key=cacheKey(),el=$('#po-table');if(!el)return;
  const hit=planCache.get(key);if(useCache&&hit&&Date.now()-hit.at<CACHE_TTL){if(_poPlanFacetRows===null)poPlanPopulateFacets(hit.data);drawPOPlan(hit.data);fetchPOPlan(key,true);return;}
  await fetchPOPlan(key,false);
}
async function fetchPOPlan(key,background){
  const epoch=_poPlanPageEpoch;
  try{
    const q=new URLSearchParams(),s=$('#po-fs')?.value||'',brands=selectedPOFacets('brand'),countries=selectedPOFacets('country'),k=$('#po-fk')?.value.trim()||'';
    if(s)q.set('status',s);
    brands.forEach(b=>q.append('brand',b));countries.forEach(c=>q.append('country',c));
    if(k)q.set('keyword',k);
    const data=await apiCall('/api/po-plans?'+q.toString());
    if(epoch!==_poPlanPageEpoch)return;
    planCache.set(key,{at:Date.now(),data});
    if(key!==cacheKey()||!$('#po-table'))return;
    if(!s&&!k&&!brands.length&&!countries.length)poPlanPopulateFacets(data);
    drawPOPlan(data);
  }catch(e){if(!background&&$('#po-table'))$('#po-table').innerHTML='<div class="empty-state">'+E(e.message)+'</div>';}
}
function drawPOPlan(data){
  const el=$('#po-table');if(!el)return;
  if(!data.length){el.innerHTML='<div class="empty-state"><div class="empty-icon">🛒</div>暂无PO采购计划</div>';return;}
  el.innerHTML=`<div class="table-container" style="box-shadow:none;border-radius:0"><table class="data-table"><thead><tr><th>PO号</th><th>供应商</th><th>品牌</th><th>国家</th><th>仓库</th><th>PO日期</th><th class="po-plan-col-left">明细</th><th class="po-plan-col-left">计划数量</th><th class="po-plan-col-left">已转PI</th><th class="po-plan-col-left">剩余可转</th><th>状态</th><th>操作</th></tr></thead><tbody>${data.map(p=>`<tr class="clickable-detail-row" data-id="${E(p.id)}"><td class="cell-id"><span class="link-text">${E(p.po_no)}</span></td><td>${E(p.supplier_name)}</td><td>${E(p.brand)}</td><td>${E(p.country)}</td><td>${E(p.target_warehouse)}</td><td class="cell-date">${global.fmtDate?global.fmtDate(p.po_date):E(p.po_date)}</td><td class="po-plan-col-left">${qty(p.item_count)}</td><td class="po-plan-col-left po-plan-num">${qty(p.planned_qty)}</td><td class="po-plan-col-left po-plan-used">${qty(p.transferred_qty)}</td><td class="po-plan-col-left po-plan-remain">${qty(p.remaining_qty)}</td><td><span class="status-badge ${statusClass(p.plan_status)}">${statusText(p.plan_status)}</span></td><td class="cell-actions"><button class="action-btn pp-view">👁️</button>${global.hasPermission&&global.hasPermission('po_create')&&p.plan_status!=='closed'?'<button class="action-btn pp-edit" title="编辑计划数量">✏️</button><button class="action-btn pp-close" title="关闭PO">关闭</button>':''}${global.hasPermission&&global.hasPermission('po_create')&&qty(p.transferred_qty)===0?'<button class="action-btn pp-del" style="color:#d4380d" title="删除未使用PO">删除</button>':''}</td></tr>`).join('')}</tbody></table></div>`;
  el.querySelectorAll('tr[data-id]').forEach(tr=>{const id=tr.dataset.id;tr.onclick=e=>{if(e.target.closest('button'))return;viewPOPlan(id)};tr.querySelector('.pp-view').onclick=()=>viewPOPlan(id);tr.querySelector('.pp-edit')?.addEventListener('click',()=>editPOPlan(id));tr.querySelector('.pp-close')?.addEventListener('click',()=>closePOPlan(id));tr.querySelector('.pp-del')?.addEventListener('click',()=>deletePOPlan(id));});
}
async function createPOPlan(){
  global.openModal('新建PO采购计划','<div style="padding:40px;text-align:center">⏳ 加载中…</div>');
  try{
    const m=typeof global._getMaster==='function'?await global._getMaster(['suppliers','countries','brands']):{suppliers:await apiCall('/api/suppliers'),countries:[],brands:[]};
    if(!$('#modal-overlay')?.classList.contains('show'))return;
    const countries=(m.countries||[]).filter(x=>!x.status||x.status==='active');
    const body='<div class="form-card" style="box-shadow:none;padding:0">'+
      '<div class="po-plan-hint">有最新报价时自动抓取报价日期最新的FOB；无报价SKU沿用SKU主数据价格。PO会锁定原始报价、报价日期和汇率快照。</div>'+
      '<div class="form-grid">'+
      '<div class="form-group"><label>供应商 *</label><select id="pp-sup">'+(m.suppliers||[]).map(x=>'<option value="'+E(x.id)+'" data-name="'+E(x.name)+'">'+E(x.name)+'</option>').join('')+'</select></div>'+
      '<div class="form-group"><label>品牌 *</label><select id="pp-brand"><option value="">请选择</option>'+(m.brands||[]).map(x=>'<option>'+E(x)+'</option>').join('')+'</select></div>'+
      '<div class="form-group"><label>国家 *</label><select id="pp-country"><option value="">请选择</option>'+countries.map(x=>'<option>'+E(x.name)+'</option>').join('')+'</select></div>'+
      '<div class="form-group"><label>仓库 *</label><input id="pp-wh"></div>'+
      '<div class="form-group"><label>PO日期</label><input type="date" id="pp-date" value="'+new Date().toISOString().slice(0,10)+'"></div>'+
      '<div class="form-group"><label>最终币种</label><select id="pp-cur"><option value="RMB">RMB</option><option value="USD">USD</option></select></div>'+
      '</div>'+
      '<div class="pp-fx-grid">'+
      '<div class="pp-fx-field"><label>报价原币种（自动识别）</label><div class="pp-fx-value" id="pp-quote-currency">选择品牌和SKU后自动识别</div></div>'+
      '<div class="pp-fx-field"><label id="pp-rate-label">换算汇率</label><input id="pp-rate" type="number" min="0" step="any" placeholder="根据报价币种填写" disabled></div>'+
      '</div>'+
      '<div id="pp-price-alert" class="pp-price-alert">先选择品牌并填写SKU，系统会自动读取最新报价。</div>'+
      '<h4 style="margin:16px 0 8px">采购计划明细 <button class="btn btn-secondary btn-sm" id="pp-add">➕ 添加SKU</button></h4>'+
      '<div id="pp-create-items" class="po-plan-editor"></div>'+
      '<div id="pp-price-preview" class="pp-price-preview"><div class="pp-price-empty">等待读取报价…</div></div>'+
      '</div>';
    global.openModal('新建PO采购计划',body,'<button class="btn btn-secondary" onclick="closeModal()">取消</button><button class="btn btn-primary" id="pp-save-new" disabled>创建计划</button>');
    global._ppCreateRows=[{sku:'',qty:1}];
    global._ppPricePreview=null;global._ppPricePreviewError='';global._ppPricePreviewEpoch=0;
    renderCreateRows();
    $('#pp-add').onclick=()=>{syncCreateRowsFromForm();global._ppCreateRows.push({sku:'',qty:1});renderCreateRows();loadCreatePricePreview();};
    $('#pp-brand').onchange=()=>{$('#pp-rate').value='';loadCreatePricePreview();};
    $('#pp-cur').onchange=()=>{$('#pp-rate').value='';loadCreatePricePreview();};
    $('#pp-rate').oninput=renderCreatePricePreview;
    $('#pp-save-new').onclick=saveNewPOPlan;
    renderCreatePricePreview();
  }catch(e){global.showToast(e.message,'danger')}
}
function syncCreateRowsFromForm(){
  const rows=global._ppCreateRows||[];
  global._ppCreateRows=rows.map((r,i)=>({
    sku:$('#pp-c-s-'+i)?.value??r.sku??'',
    qty:Number($('#pp-c-q-'+i)?.value??r.qty??1)
  }));
}
function createPOItems(){
  syncCreateRowsFromForm();
  return (global._ppCreateRows||[]).map(r=>({sku_code:String(r.sku||'').trim(),po_qty:Number(r.qty||0)})).filter(r=>r.sku_code);
}
function renderCreateRows(){
  const rows=global._ppCreateRows||[];
  $('#pp-create-items').innerHTML='<table><thead><tr><th>SKU</th><th>计划数量</th><th></th></tr></thead><tbody>'+
    rows.map((r,i)=>'<tr><td><input id="pp-c-s-'+i+'" value="'+E(r.sku)+'" style="width:100%"></td><td><input id="pp-c-q-'+i+'" type="number" min="1" step="1" value="'+(qty(r.qty)||1)+'" style="width:130px"></td><td><button class="btn btn-danger btn-sm" data-rm="'+i+'">🗑️</button></td></tr>').join('')+
    '</tbody></table>';
  $('#pp-create-items').querySelectorAll('input[id^="pp-c-s-"]').forEach(input=>input.addEventListener('change',()=>{syncCreateRowsFromForm();loadCreatePricePreview();}));
  $('#pp-create-items').querySelectorAll('input[id^="pp-c-q-"]').forEach(input=>input.addEventListener('input',()=>{syncCreateRowsFromForm();renderCreatePricePreview();}));
  $('#pp-create-items').querySelectorAll('[data-rm]').forEach(button=>button.onclick=()=>{
    syncCreateRowsFromForm();global._ppCreateRows.splice(Number(button.dataset.rm),1);renderCreateRows();loadCreatePricePreview();
  });
}
async function loadCreatePricePreview(){
  syncCreateRowsFromForm();
  const brand=String($('#pp-brand')?.value||'').trim(),currency=String($('#pp-cur')?.value||'RMB').trim().toUpperCase(),items=createPOItems();
  if(!brand||!items.length){
    global._ppPricePreview=null;global._ppPricePreviewError='';
    renderCreatePricePreview();return;
  }
  const epoch=(global._ppPricePreviewEpoch||0)+1;global._ppPricePreviewEpoch=epoch;
  const previous=global._ppPricePreview;
  global._ppPricePreview=null;global._ppPricePreviewError='';
  const button=$('#pp-save-new');if(button)button.disabled=true;
  const box=$('#pp-price-preview');if(box)box.innerHTML='<div class="pp-price-empty">正在读取报价管理中的最新FOB…</div>';
  try{
    const data=await apiCall('/api/po-plans/price-preview','POST',{brand,currency,items});
    if(epoch!==global._ppPricePreviewEpoch||!$('#pp-price-preview'))return;
    if(previous&&((previous.quote_currency||'')!==(data.quote_currency||'')||previous.currency!==currency))$('#pp-rate').value='';
    global._ppPricePreview=data;renderCreatePricePreview();
  }catch(e){
    if(epoch!==global._ppPricePreviewEpoch)return;
    global._ppPricePreviewError=e.message||'报价读取失败';renderCreatePricePreview();
  }
}
function renderCreatePricePreview(){
  const box=$('#pp-price-preview'),alert=$('#pp-price-alert'),quoteEl=$('#pp-quote-currency'),rateInput=$('#pp-rate'),rateLabel=$('#pp-rate-label'),button=$('#pp-save-new');
  if(!box)return;
  const preview=global._ppPricePreview,currency=String($('#pp-cur')?.value||'RMB').toUpperCase();
  if(!preview){
    if(quoteEl)quoteEl.textContent='等待识别';
    if(rateInput){rateInput.disabled=true;rateInput.value='';}
    if(rateLabel)rateLabel.textContent='换算汇率';
    box.innerHTML='<div class="pp-price-empty">'+E(global._ppPricePreviewError||'先选择品牌并填写SKU，系统会自动读取最新报价。')+'</div>';
    if(alert){alert.className='pp-price-alert'+(global._ppPricePreviewError?' is-error':'');alert.textContent=global._ppPricePreviewError||'报价预览将在选择品牌和SKU后显示。';}
    if(button)button.disabled=true;
    return;
  }
  const quoteCurrency=String(preview.quote_currency||'').toUpperCase(),currencies=preview.quote_currencies||[];
  const mismatch=!!preview.currency_mismatch,rateRequired=!!quoteCurrency&&quoteCurrency!==currency;
  const rate=rateRequired?Number(rateInput?.value):1,rateValid=!rateRequired||(Number.isFinite(rate)&&rate>0);
  if(quoteEl)quoteEl.textContent=mismatch?'币种不一致：'+currencies.join(' / '):(quoteCurrency||'无有效报价，使用SKU主数据');
  if(rateInput){
    rateInput.disabled=!rateRequired||mismatch;
    if(!rateRequired&&!mismatch)rateInput.value='1';
  }
  if(rateLabel)rateLabel.textContent=mismatch?'换算汇率（请先统一报价币种）':rateRequired?'汇率（1 '+quoteCurrency+' = X '+currency+'）':'换算汇率（无需换算）';
  const mismatchText=(preview.currency_mismatch_items||[]).map(x=>x.sku_code+'（'+x.currency+'）').join('、');
  if(alert){
    if(mismatch){alert.className='pp-price-alert is-error';alert.textContent='同一张PO的最新报价币种不一致：'+mismatchText+'。请先统一报价币种，当前禁止创建。';}
    else if(rateRequired&&!rateValid){alert.className='pp-price-alert is-warning';alert.textContent='报价币种为'+quoteCurrency+'，最终币种为'+currency+'。请填写换算汇率：1 '+quoteCurrency+' = X '+currency+'。';}
    else if(rateRequired){alert.className='pp-price-alert';alert.textContent='已抓取报价日期最新的'+quoteCurrency+'报价；按1 '+quoteCurrency+' = '+rate+' '+currency+'换算。';}
    else if(quoteCurrency){alert.className='pp-price-alert';alert.textContent='已抓取报价日期最新的'+quoteCurrency+'报价，原币种与最终币种一致，无需换算。';}
    else{alert.className='pp-price-alert';alert.textContent='未找到有效FOB报价的SKU将沿用SKU主数据价格。';}
  }
  const rows=createPOItems(),priceMap=new Map((preview.rows||[]).map(x=>[String(x.sku_code||'').toUpperCase(),x]));
  const fmt=value=>value==null?'—':Number(value).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:4});
  const round=value=>Math.round((Number(value)+Number.EPSILON)*10000)/10000;
  let total=0,totalValid=true,rowsValid=rows.length>0;
  const body=rows.map(row=>{
    const price=priceMap.get(row.sku_code.toUpperCase());
    if(!price){rowsValid=false;totalValid=false;return '<tr><td>'+E(row.sku_code)+'</td><td class="num">'+qty(row.po_qty)+'</td><td>—</td><td>—</td><td class="num">—</td><td class="pp-price-source">未匹配</td></tr>';}
    if(!Number.isFinite(row.po_qty)||row.po_qty<=0)rowsValid=false;
    const quoted=price.price_source==='quotation';
    const source=quoted?fmt(price.quote_unit_price)+' '+E(price.quote_currency):'—';
    const finalUnit=quoted?(mismatch||!rateValid?null:round(Number(price.quote_unit_price)*rate)):Number(price.master_unit_price||0);
    const amount=finalUnit==null?null:round(finalUnit*row.po_qty);
    if(amount==null)totalValid=false;else total+=amount;
    const sourceText=quoted?'报价管理 · '+E(price.quote_date||'—'):'SKU主数据';
    return '<tr><td>'+E(row.sku_code)+'</td><td class="num">'+qty(row.po_qty)+'</td><td>'+source+'</td><td class="num">'+fmt(finalUnit)+'</td><td class="num">'+fmt(amount)+'</td><td class="pp-price-source">'+sourceText+'</td></tr>';
  }).join('');
  const sourceHead=quoteCurrency?'FOB ('+E(quoteCurrency)+')':'FOB（报价原币种）';
  const html='<table><thead><tr><th>SKU</th><th class="num">数量</th><th>'+sourceHead+'</th><th class="num">FOB ('+E(currency)+')</th><th class="num">金额 ('+E(currency)+')</th><th>价格来源 / 报价日期</th></tr></thead><tbody>'+body+'</tbody><tfoot><tr><td colspan="4">PO采购总金额（'+E(currency)+'）</td><td class="num pp-price-total">'+(totalValid?fmt(round(total)):'—')+'</td><td></td></tr></tfoot></table>';
  box.innerHTML=html;
  if(button)button.disabled=mismatch||!rateValid||!rowsValid;
}
async function saveNewPOPlan(){
  const rows=createPOItems(),sup=$('#pp-sup'),preview=global._ppPricePreview,currency=String($('#pp-cur')?.value||'RMB').toUpperCase();
  if(!preview){global.showToast(global._ppPricePreviewError||'请先完成报价预览','danger');return;}
  if(preview.currency_mismatch){global.showToast('同一张PO的最新报价币种不一致，请先统一报价币种','danger');return;}
  const quoteCurrency=String(preview.quote_currency||'').toUpperCase(),rateRequired=!!quoteCurrency&&quoteCurrency!==currency;
  const exchangeRate=rateRequired?Number($('#pp-rate')?.value):1;
  if(rateRequired&&(!Number.isFinite(exchangeRate)||exchangeRate<=0)){global.showToast('请填写有效汇率：1 '+quoteCurrency+' = X '+currency,'danger');return;}
  const body={supplier_id:sup.value,supplier_name:sup.options[sup.selectedIndex]?.dataset.name||'',brand:$('#pp-brand').value,country:$('#pp-country').value,target_warehouse:$('#pp-wh').value.trim(),po_date:$('#pp-date').value,currency,quote_currency:quoteCurrency,exchange_rate:rateRequired?exchangeRate:1,price_snapshot_key:preview.snapshot_key,items:rows};
  const button=$('#pp-save-new');if(button)button.disabled=true;
  try{
    await apiCall('/api/po-plans','POST',body);clearCaches();global.closeModal();global.showToast('PO采购计划已创建，报价和汇率已锁定','success');loadPOPlan(false);
  }catch(e){global.showToast(e.message,'danger');renderCreatePricePreview();}
}

async function viewPOPlan(id){
  try{
    const p=await apiCall('/api/po-plans/'+id);
    const money=value=>Number(value||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:4});
    const info=[['供应商',p.supplier_name],['品牌',p.brand],['国家',p.country],['仓库',p.target_warehouse],['PO日期',p.po_date],['最终币种',p.currency||'—'],['报价原币种',p.po_quote_currency||'—'],['换算汇率',p.po_quote_currency?'1 '+p.po_quote_currency+' = '+p.po_exchange_rate+' '+p.currency:'—'],['状态',statusText(p.plan_status)]];
    const detail='<div class="detail-card" style="box-shadow:none;padding:0"><div class="detail-section"><h3>计划信息</h3><div class="detail-grid">'+info.map(x=>'<div class="detail-item"><span class="detail-label">'+E(x[0])+'</span><span class="detail-value">'+E(x[1]||'—')+'</span></div>').join('')+'</div><div class="po-plan-cards"><div class="po-plan-card"><span>计划数量</span><b>'+qty(p.planned_qty)+'</b></div><div class="po-plan-card"><span>已转PI</span><b>'+qty(p.transferred_qty)+'</b></div><div class="po-plan-card"><span>剩余可转</span><b class="po-plan-remain">'+qty(p.remaining_qty)+'</b></div></div></div><div class="detail-section"><h3>SKU计划与FOB价格</h3><div class="table-container"><table class="data-table"><thead><tr><th>SKU</th><th>计划数量</th><th>报价FOB ('+E(p.po_quote_currency||'—')+')</th><th>最终FOB ('+E(p.currency||'')+')</th><th>金额 ('+E(p.currency||'')+')</th><th>已转PI</th><th>剩余可转</th></tr></thead><tbody>'+
      (p.items||[]).map(i=>'<tr><td class="cell-id">'+E(i.sku_code)+'</td><td>'+qty(i.planned_qty)+'</td><td>'+(i.price_source==='quotation'?money(i.quote_unit_price):'—')+'</td><td>'+money(i.unit_price)+'</td><td>'+money(i.po_amount)+'</td><td>'+qty(i.transferred_qty)+'</td><td class="po-plan-remain">'+qty(i.remaining_qty)+'</td></tr>').join('')+
      '</tbody></table></div></div></div>';
    const footer=(global.hasPermission&&global.hasPermission('po_create')&&p.plan_status!=='closed'?'<button class="btn btn-primary" id="pp-detail-edit">编辑数量</button>':'')+'<button class="btn btn-secondary" onclick="closeModal()">关闭</button>';
    global.openModal('PO采购计划 - '+E(p.po_no),detail,footer);
    $('#pp-detail-edit')?.addEventListener('click',()=>editPOPlan(id));
  }catch(e){global.showToast(e.message,'danger')}
}

async function editPOPlan(id){try{const p=await apiCall('/api/po-plans/'+id);global._ppEdit=p;global.openModal('编辑PO计划 - '+E(p.po_no),`<div class="po-plan-hint">数量可随时调整，但不能低于已经转入PI的数量；已转PI的SKU不能删除或更换。</div><div class="form-grid"><div class="form-group"><label>品牌</label><input id="pp-e-brand" value="${E(p.brand)}"></div><div class="form-group"><label>国家</label><input id="pp-e-country" value="${E(p.country)}"></div><div class="form-group"><label>仓库</label><input id="pp-e-wh" value="${E(p.target_warehouse)}"></div><div class="form-group"><label>预计交期</label><input type="date" id="pp-e-del" value="${E(p.expected_delivery||'')}"></div></div><h4 style="margin:16px 0 8px">计划明细 <button class="btn btn-secondary btn-sm" id="pp-e-add">➕ 添加SKU</button></h4><div id="pp-edit-items" class="po-plan-editor"></div>`,`<button class="btn btn-secondary" onclick="closeModal()">取消</button><button class="btn btn-primary" id="pp-e-save">保存计划</button>`);renderEditRows();$('#pp-e-add').onclick=()=>{global._ppEdit.items.push({id:'',sku_code:'',planned_qty:1,transferred_qty:0,remaining_qty:1});renderEditRows()};$('#pp-e-save').onclick=savePOPlanEdit;}catch(e){global.showToast(e.message,'danger')}}
function renderEditRows(){const p=global._ppEdit,rows=p.items||[];$('#pp-edit-items').innerHTML=`<table><thead><tr><th>SKU</th><th>计划数量</th><th>已转PI</th><th>剩余可转</th><th></th></tr></thead><tbody>${rows.map((r,i)=>{const used=qty(r.transferred_qty),planned=qty(r.planned_qty),rem=Math.max(0,planned-used);return `<tr><td><input id="pp-e-s-${i}" value="${E(r.sku_code)}" ${used?'readonly':''} style="width:100%"></td><td><input id="pp-e-q-${i}" type="number" min="${Math.max(1,used)}" step="1" value="${planned||Math.max(1,used)}" style="width:120px" data-i="${i}"></td><td class="po-plan-used">${used}</td><td id="pp-e-r-${i}" class="po-plan-remain">${rem}</td><td>${used?'<span style="font-size:11px;color:#86868b">已使用</span>':`<button class="btn btn-danger btn-sm" data-rm="${i}">🗑️</button>`}</td></tr>`}).join('')}</tbody></table>`;$('#pp-edit-items').querySelectorAll('input[data-i]').forEach(x=>x.oninput=()=>{const i=Number(x.dataset.i),used=qty(rows[i].transferred_qty),v=qty(x.value);$('#pp-e-r-'+i).textContent=Math.max(0,v-used)});$('#pp-edit-items').querySelectorAll('[data-rm]').forEach(b=>b.onclick=()=>{rows.splice(Number(b.dataset.rm),1);renderEditRows()});}
async function savePOPlanEdit(){const p=global._ppEdit,items=(p.items||[]).map((r,i)=>({id:r.id||'',sku_code:$('#pp-e-s-'+i)?.value.trim()||'',po_qty:Number($('#pp-e-q-'+i)?.value||0),remark:r.remark||''}));try{await apiCall('/api/po-plans/'+p.id,'PUT',{brand:$('#pp-e-brand').value.trim(),country:$('#pp-e-country').value.trim(),target_warehouse:$('#pp-e-wh').value.trim(),expected_delivery:$('#pp-e-del').value,items});clearCaches();global.closeModal();global.showToast('PO计划已更新','success');loadPOPlan(false);}catch(e){global.showToast(e.message,'danger')}}
async function closePOPlan(id){if(!global.confirm('关闭后该PO不再用于新PI，历史PI不受影响。确认关闭？'))return;try{await apiCall('/api/po-plans/'+id+'/close','POST',{});clearCaches();global.showToast('PO已关闭','success');loadPOPlan(false);}catch(e){global.showToast(e.message,'danger')}}
async function deletePOPlan(id){if(!global.confirm('仅未被PI使用的PO可以删除。确认删除？'))return;try{await apiCall('/api/po-plans/'+id,'DELETE');clearCaches();global.showToast('PO已删除','success');loadPOPlan(false);}catch(e){global.showToast(e.message,'danger')}}

function installPIIntegration(){
  const rawApi=global.api;if(typeof rawApi==='function'&&!rawApi.__poPlanCapture){const wrapped=async function(url){const out=await rawApi.apply(this,arguments);if(String(url||'').split('?')[0]==='/api/po-plans/available'&&Array.isArray(out))availablePlans=out;return out;};wrapped.__poPlanCapture=true;global.api=wrapped;}
  originalCreatePI=global.createPI;originalCmpRowHTML=global.cmpRowHTML;originalCmpDerived=global.cmpDerived;originalRecompute=global.recomputeCmpFooter;
  if(typeof originalCreatePI==='function')global.createPI=async function(){await originalCreatePI.apply(this,arguments);bindPIPlanFilters();};
  if(typeof originalCmpDerived==='function')global.cmpDerived=function(r){if(r&&r.poRemaining!=null)return originalCmpDerived({...r,poQty:r.poRemaining});return originalCmpDerived(r);};
  if(typeof originalCmpRowHTML==='function')global.cmpRowHTML=function(idx,r){if(!r||r.poRemaining==null)return originalCmpRowHTML(idx,r);return `<tr data-idx="${idx}"><td><input type="text" value="${E(r.sku)}" id="pi-rsk-${idx}" readonly></td><td style="color:var(--text-muted)" title="原计划 ${qty(r.poQty)} / 已转 ${qty(r.poTransferred)}">${qty(r.poRemaining)}</td><td><input type="number" min="0" max="${qty(r.poRemaining)}" value="${r.piQty||0}" id="pi-rq-${idx}" oninput="updCmpRow(${idx})"></td><td style="color:var(--text-muted)">${global.fmtMoney(r.poPrice||0)}</td><td><input type="number" step="0.01" value="${r.piPrice||0}" id="pi-rp-${idx}" oninput="updCmpRow(${idx})"></td><td><input type="number" step="0.01" value="${r.piDisc||0}" id="pi-rd-${idx}" oninput="updCmpRow(${idx})"></td><td id="pi-ramt-${idx}">0.00</td><td id="pi-rqd-${idx}">0</td><td id="pi-rpd-${idx}">0</td><td><button class="btn btn-danger btn-sm" onclick="delCmpRow(${idx})">🗑️</button></td></tr>`;};
  global.loadPOForPI=loadPlanForPI;
}
function bindPIPlanFilters(){const po=$('#npi-po'),country=$('#npi-country'),brand=$('#npi-brand');if(!po)return;const label=po.closest('.form-group');if(label&&!label.querySelector('.po-plan-pi-note'))label.insertAdjacentHTML('beforeend','<div class="po-plan-pi-note">先选国家/品牌，可快速筛选仍有剩余数量的PO</div>');const filter=()=>{const c=country?.value||'',b=brand?.value||'',cur=po.value;po.innerHTML='<option value="">无关联</option>'+availablePlans.filter(p=>(!c||p.country===c)&&(!b||p.brand===b)&&qty(p.remaining_qty)>0).map(p=>`<option value="${E(p.id)}">${E(p.po_no)} · ${E(p.brand)} · ${E(p.country)} · 剩余 ${qty(p.remaining_qty)}</option>`).join('');if([...po.options].some(o=>o.value===cur))po.value=cur;};country?.addEventListener('change',filter);brand?.addEventListener('change',filter);filter();const heads=$('#pi-items-table')?.querySelectorAll('thead th');if(heads&&heads[1])heads[1].textContent='PO剩余可转';}
async function loadPlanForPI(){const poId=$('#npi-po')?.value;global._poRef=null;const cur=$('#npi-cur'),country=$('#npi-country'),wh=$('#npi-wh'),brand=$('#npi-brand');if(!poId){if(cur)cur.disabled=false;if(typeof global.setPICountryWarehouseEditable==='function')global.setPICountryWarehouseEditable(true);if(brand)brand.disabled=false;if(country)country.disabled=false;if(wh)wh.disabled=false;global._piRows=[];global.renderCmpTable();return;}try{const po=await apiCall('/api/po-plans/'+poId);const sup=$('#npi-sup');let sid=po.supplier_id;if(sup&&sid&&![...sup.options].some(o=>o.value===sid)){const x=[...sup.options].find(o=>o.dataset.name===po.supplier_name);if(x)sid=x.value;}if(sup)sup.value=sid||'';if(typeof global.onPISupplierChange==='function')global.onPISupplierChange();if(cur){cur.value=po.currency;cur.disabled=true;}if(country){country.value=po.country||'';country.disabled=true;}if(wh){if(typeof global.populatePIWarehouse==='function')await global.populatePIWarehouse(po.country||'');wh.value=po.target_warehouse||'';wh.disabled=true;}if(brand){brand.value=po.brand||'';brand.disabled=true;}global._poRef=po.items||[];const extra=(global._piRows||[]).filter(r=>!r.fromPO);global._piRows=(po.items||[]).filter(it=>qty(it.remaining_qty)>0).map(it=>({sku:it.sku_code||'',poQty:qty(it.po_qty),poRemaining:qty(it.remaining_qty),poTransferred:qty(it.transferred_pi_qty),poPrice:Number(it.unit_price)||0,piQty:0,piPrice:0,piDisc:0,fromPO:true})).concat(extra);global.renderCmpTable();const heads=$('#pi-items-table')?.querySelectorAll('thead th');if(heads&&heads[1])heads[1].textContent='PO剩余可转';}catch(e){global.showToast(e.message,'danger')}}

function boot(){ensureCss();global.renderPO=renderPOPlan;global.loadPO=loadPOPlan;global.viewPO=viewPOPlan;global.createPO=createPOPlan;installPIIntegration();}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})(window);
