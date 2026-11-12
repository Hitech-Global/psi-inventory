(function(){
'use strict';

let BRAND_OPTIONS=[];
let brandOptionsLoadSeq=0;
const SUMMARY_CACHE_MAX=12;
const DETAIL_CACHE_MAX=24;
const summaryCache=new Map();
const detailCache=new Map();
let loadSeq=0;
let detailSeq=0;
let S={brand:'Netac',type:'',keyword:'',from:'',to:'',sort:'',data:null,detail:null,detailKey:''};

const $=(s,r=document)=>r.querySelector(s);
const E=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const money=(v,c)=>{if(v==null)return '—';const code=String(c||'').toUpperCase();const symbols=(S.data&&S.data.currency_symbols)||{};const symbol=symbols[code]||code;const digits=code==='IDR'?0:2;return (symbol?symbol+' ':'')+Number(v).toLocaleString(undefined,{minimumFractionDigits:digits,maximumFractionDigits:digits});};
const quoteMoney=(v,c,status)=>status==='no_quote'||v==null?'<span class="qm-noquote">未报价</span>':money(v,c);
const change=v=>v==null?'—':`<span class="qm-change ${v>0?'up':v<0?'down':''}">${v>0?'↑ +':v<0?'↓ ':''}${Number(v).toFixed(2)}%</span>`;
const call=(u,m='GET',b)=>window.api(u,m,b);
const canView=()=>typeof window.hasPermission==='function'&&window.hasPermission('quotation_view');
const qmLabel=text=>window.QuotationLocale?window.QuotationLocale.label(text):text;
function localizeQuotation(root){
  if(window.QuotationLocale)window.QuotationLocale.apply(root||$('#qm'));
}

function lruSet(map,key,value,max){if(map.has(key))map.delete(key);map.set(key,value);while(map.size>max)map.delete(map.keys().next().value);}
function summaryKey(){return [S.brand||'',S.type||'',S.keyword||'',S.from||'',S.to||''].join('|');}
function detailKey(s,b){return (b||'')+'|'+(s||'');}
function summaryUrl(){const q=new URLSearchParams();[["brand",S.brand],["product_type",S.type],["keyword",S.keyword],["date_from",S.from],["date_to",S.to]].forEach(([k,v])=>v&&q.set(k,v));return '/api/quotation-management/summary?'+q;}

function css(){
  if($('#qm-css'))return;
  const x=document.createElement('style');x.id='qm-css';
  x.textContent=`#qm{color:#1d1d1f}.qm-head,.qm-filter,.qm-card{background:#fff;border:1px solid #ececef;border-radius:16px;box-shadow:0 2px 12px rgba(0,0,0,.045)}.qm-head{padding:18px 20px;display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}.qm-title{font-size:24px;font-weight:750}.qm-sub{font-size:12px;color:#86868b}.qm-actions{display:flex;gap:8px}.qm-btn{border:1px solid #d8dadd;background:#fff;border-radius:9px;padding:8px 13px;cursor:pointer;font-size:13px}.qm-btn.primary{background:#238636;color:#fff;border-color:#238636}.qm-filter{padding:12px;display:grid;grid-template-columns:170px 170px minmax(220px,1fr) 145px 145px;gap:10px;margin-bottom:12px}.qm-field label{display:block;font-size:11px;color:#666;margin:0 0 4px 2px}.qm-field input,.qm-field select{width:100%;height:36px;border:1px solid #dfe1e5;border-radius:9px;padding:0 10px;background:#fff}.qm-note{font-size:12px;color:#446;background:#eef6ff;border-radius:10px;padding:8px 12px;margin-bottom:12px}.qm-grid{display:grid;grid-template-columns:minmax(650px,1.15fr) minmax(470px,.85fr);gap:12px;align-items:start}.qm-card{overflow:hidden}.qm-card-h{padding:14px 16px;border-bottom:1px solid #eee;display:flex;justify-content:space-between}.qm-table-wrap{overflow:auto;max-height:650px}.qm-table{width:100%;border-collapse:collapse;font-size:12px}.qm-table th{position:sticky;top:0;background:#f7f8fa;color:#666;text-align:left;padding:9px 10px;border-bottom:1px solid #e5e7eb;z-index:1}.qm-table td{padding:9px 10px;border-bottom:1px solid #f0f1f2;white-space:nowrap}.qm-table tr:hover{background:#f8fbf8}.qm-table tr.sel{background:#ecf8ef}.qm-link{color:#1677ff;cursor:pointer}.qm-change.up{color:#e53935}.qm-change.down{color:#188b45}.qm-noquote{display:inline-block;color:#86868b;background:#f2f2f4;border-radius:999px;padding:2px 8px;font-size:11px;font-weight:600}.qm-report{padding:16px}.qm-report-title{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px}.qm-brand{font-size:21px;font-weight:750}.qm-badge{font-size:11px;background:#e8f5e9;color:#238636;padding:3px 7px;border-radius:999px}.qm-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:14px}.qm-kpi{background:#f7f8fa;border-radius:12px;padding:12px}.qm-kpi span{font-size:11px;color:#888}.qm-kpi b{display:block;font-size:20px;margin-top:4px}.qm-section{margin-top:16px}.qm-section h4{font-size:14px;margin-bottom:8px}.qm-two{display:grid;grid-template-columns:1fr 1fr;gap:10px}.qm-mini{background:#fafafa;border:1px solid #eee;border-radius:12px;padding:10px}.qm-chart{width:100%;height:180px;background:#fcfcfd;border:1px solid #eee;border-radius:12px}.qm-empty{padding:55px 15px;text-align:center;color:#999}.qm-modal{position:fixed;inset:0;background:rgba(0,0,0,.28);z-index:9999;display:flex;align-items:center;justify-content:center}.qm-dialog{width:min(650px,92vw);background:#fff;border-radius:18px;box-shadow:0 24px 80px rgba(0,0,0,.25);padding:20px}.qm-drop{border:1.5px dashed #cfd3d8;border-radius:12px;padding:24px;text-align:center;background:#fafafa}.qm-dialog-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}.qm-skeleton{position:relative;overflow:hidden;background:#f2f3f5;border-radius:7px;color:transparent!important;user-select:none}.qm-skeleton:after{content:"";position:absolute;inset:0;transform:translateX(-100%);background:linear-gradient(90deg,transparent,rgba(255,255,255,.75),transparent);animation:qmShimmer 1.15s infinite}.qm-sk-line{height:12px;min-width:55px}.qm-sk-card{height:54px;border-radius:12px}.qm-loading-tag{font-size:11px;color:#86868b}@keyframes qmShimmer{100%{transform:translateX(100%)}}@media(max-width:1200px){.qm-grid{grid-template-columns:1fr}.qm-filter{grid-template-columns:repeat(2,1fr)}}`;
  x.textContent+='.qm-list-tools{display:flex;align-items:center;gap:9px;flex-wrap:wrap}.qm-sort-buttons{display:flex;align-items:center;gap:6px}.qm-sort{font-size:12px;padding:6px 9px;border:1px solid #e1e4e7;border-radius:8px;background:#fff;color:#444;cursor:pointer}.qm-sort:hover{background:#f5f7f8}.qm-sort.active.up{background:#fff0ee;border-color:#efc3bf;color:#b42318}.qm-sort.active.down{background:#ecf8f0;border-color:#bfe4c8;color:#19713a}.qm-card-h{align-items:center;gap:10px;flex-wrap:wrap}.qm-table td:first-child{font-weight:600}.qm-table .qm-price{font-weight:650;white-space:nowrap}.qm-grid{grid-template-columns:minmax(0,1.3fr) minmax(360px,.7fr)}@media(max-width:1320px){.qm-grid{grid-template-columns:1fr}}';
  document.head.appendChild(x);
}

function nav(){
  const n=$('#sidebar-nav');if(!n)return;
  if(!canView())return;
  // The procurement sidebar is rebuilt on language changes. Match stable
  // navigation keys and values instead of only Chinese labels.
  const labels=[
    typeof window.t==='function'?window.t('nav.po','PO管理'):'PO管理',
    typeof window.t==='function'?window.t('nav.pi','PI管理'):'PI管理',
    typeof window.t==='function'?window.t('nav.ci','CI/PL管理'):'CI/PL管理'
  ];
  const isProcurement=[...n.querySelectorAll('.sidebar-item')].some(el=>{
    const name=String(el.textContent||'').trim();
    return labels.some(label=>name===label||name.endsWith(label))||
      /^(?:PO管理|PI管理|CI\/PL管理|Purchase Orders|Proforma Invoices|Commercial Invoices \/ PL|PO|PI|CI \/ PL)$/i.test(name);
  });
  const existing=$('#qm-nav');
  if(!isProcurement){if(existing)existing.remove();return;}
  if(existing){
    const title=existing.querySelector('[data-quotation-nav-label]');
    if(title&&title.textContent!==qmLabel('报价管理'))title.textContent=qmLabel('报价管理');
    existing.classList.toggle('active',!!$('#qm'));
    return;
  }
  const e=document.createElement('div');e.id='qm-nav';
  e.className='sidebar-item'+($('#qm')?' active':'');
  e.setAttribute('data-page','quotation-management');
  e.innerHTML='<span class="icon">🏷️</span><span data-quotation-nav-label>'+E(qmLabel('报价管理'))+'</span>';
  e.onclick=show;n.appendChild(e);
}

function show(){
  if(!canView())return;
  css();
  document.querySelectorAll('.sidebar-item.active').forEach(x=>x.classList.remove('active'));
  $('#qm-nav')?.classList.add('active');
  const c=$('#content-inner');if(!c)return;
  c.innerHTML='<div id="qm"></div>';
  S.detail=null;S.detailKey='';
  renderBase();
  loadBrandOptions();
  const cached=summaryCache.get(summaryKey());
  if(cached){S.data=cached;renderSummary();load({useCache:false,background:true});}
  else{S.data=null;renderSkeleton();load({useCache:false,background:false});}
}

function loadBrandOptions(){
  const seq=++brandOptionsLoadSeq;
  call('/api/brands/all').then(rows=>{
    if(seq!==brandOptionsLoadSeq)return;
    BRAND_OPTIONS=Array.isArray(rows)?rows.filter(Boolean):[];
    const select=$('#qm-brand');if(!select)return;
    const prior=S.brand;
    if(!BRAND_OPTIONS.includes(S.brand))S.brand=BRAND_OPTIONS[0]||'';
    select.innerHTML=BRAND_OPTIONS.map(b=>`<option value="${E(b)}">${E(b)}</option>`).join('');
    select.value=S.brand;
    if(S.brand&&S.brand!==prior)switchView();
  }).catch(()=>{});
}

function renderBase(){
  const initialBrands=BRAND_OPTIONS.length?BRAND_OPTIONS:(S.brand?[S.brand]:[]);
  const brands=initialBrands.map(b=>`<option value="${E(b)}" ${b===S.brand?'selected':''}>${E(b)}</option>`).join('');
  $('#qm').innerHTML=`<div class="qm-head"><div><div class="qm-title">🏷️ 报价管理</div><div class="qm-sub">FOB 报价、价格趋势、最近采购价对比与品牌报告</div></div><div class="qm-actions"><button class="qm-btn" id="qm-template">⇩ 下载模板</button><button class="qm-btn primary" id="qm-import">⇧ 导入报价</button></div></div><div class="qm-filter"><div class="qm-field"><label>品牌</label><select id="qm-brand">${brands}</select></div><div class="qm-field"><label>一级类目</label><select id="qm-type"><option value="">全部</option></select></div><div class="qm-field"><label>SKU / 关键词</label><input id="qm-key" value="${E(S.keyword)}" placeholder="搜索 SKU 或一级类目"></div><div class="qm-field"><label>开始日期</label><input type="date" id="qm-from" value="${E(S.from)}"></div><div class="qm-field"><label>结束日期</label><input type="date" id="qm-to" value="${E(S.to)}"></div></div><div class="qm-note">仅展示 SKU 主数据中已建档且未停产的商品；报价历史继续保留。FOB=0 表示未报价，不参与价格涨跌比较。</div><div class="qm-grid"><section class="qm-card"><div class="qm-card-h"><b>SKU 列表</b><div class="qm-list-tools"><span id="qm-count" class="qm-sub"></span><div class="qm-sort-buttons"><button type="button" class="qm-sort" id="qm-sort-up" aria-pressed="false">↑ 涨价 SKU</button><button type="button" class="qm-sort" id="qm-sort-down" aria-pressed="false">↓ 降价 SKU</button></div></div></div><div class="qm-table-wrap"><table class="qm-table"><thead><tr><th>SKU</th><th>一级类目</th><th>最新FOB</th><th>较上次报价</th><th>报价日期</th><th></th></tr></thead><tbody id="qm-body"></tbody></table></div></section><section class="qm-card" id="qm-right"></section></div>`;
  bind();
  localizeQuotation($('#qm'));
}

function bind(){
  [['qm-brand','brand'],['qm-type','type'],['qm-from','from'],['qm-to','to']].forEach(([id,k])=>$('#'+id).onchange=e=>{S[k]=e.target.value;if(k==='brand')S.type='';S.detail=null;S.detailKey='';switchView();});
  let t;$('#qm-key').oninput=e=>{clearTimeout(t);t=setTimeout(()=>{S.keyword=e.target.value.trim();S.detail=null;S.detailKey='';switchView();},220)};
  $('#qm-template').onclick=template;$('#qm-import').onclick=importModal;
  $('#qm-sort-up').onclick=()=>{S.sort=S.sort==='up'?'':'up';list();};
  $('#qm-sort-down').onclick=()=>{S.sort=S.sort==='down'?'':'down';list();};
}

function switchView(){
  const cached=summaryCache.get(summaryKey());
  if(cached){S.data=cached;renderSummary();load({useCache:false,background:true});}
  else{S.data=null;renderSkeleton();load({useCache:false,background:false});}
}

function renderSkeleton(){
  const body=$('#qm-body'),right=$('#qm-right'),count=$('#qm-count');if(!body||!right)return;
  count.innerHTML='<span class="qm-loading-tag">加载中…</span>';
  body.innerHTML=Array.from({length:7},()=>'<tr>'+Array.from({length:6},(_,i)=>`<td><div class="qm-skeleton qm-sk-line" style="width:${i===0?86:i===5?42:64}px">.</div></td>`).join('')+'</tr>').join('');
  right.innerHTML=`<div class="qm-report"><div class="qm-report-title"><div><div class="qm-skeleton qm-sk-line" style="width:120px;height:22px">.</div><div class="qm-skeleton qm-sk-line" style="width:150px;margin-top:9px">.</div></div></div><div class="qm-kpis">${Array.from({length:4},()=>'<div class="qm-skeleton qm-sk-card">.</div>').join('')}</div><div class="qm-skeleton" style="height:180px;border-radius:12px;margin-top:16px">.</div><div class="qm-two qm-section"><div class="qm-skeleton" style="height:120px;border-radius:12px">.</div><div class="qm-skeleton" style="height:120px;border-radius:12px">.</div></div></div>`;
  localizeQuotation($('#qm'));
}

async function load({useCache=false,background=false}={}){
  const key=summaryKey();
  if(useCache&&summaryCache.has(key)){S.data=summaryCache.get(key);renderSummary();return;}
  const seq=++loadSeq;
  try{
    const d=await call(summaryUrl());
    lruSet(summaryCache,key,d,SUMMARY_CACHE_MAX);
    if(seq!==loadSeq||key!==summaryKey()||!$('#qm'))return;
    S.data=d;renderSummary();
  }catch(e){
    if(seq!==loadSeq||key!==summaryKey()||!$('#qm'))return;
    if(!background&&!S.data){$('#qm-body').innerHTML='<tr><td colspan="6" class="qm-empty">加载失败：'+E(e.message)+'</td></tr>';$('#qm-right').innerHTML='<div class="qm-empty">加载失败：'+E(e.message)+'</div>';$('#qm-count').textContent='';localizeQuotation($('#qm'));}
  }
}

function renderSummary(){filters();list();report();localizeQuotation($('#qm'));}
function filters(){
  const d=S.data||{};
  const brands=BRAND_OPTIONS.length?BRAND_OPTIONS:(d.brands||[]);
  const currencyMap=d.brand_currencies||{};
  $('#qm-brand').innerHTML=brands.map(b=>`<option value="${E(b)}" ${b===S.brand?'selected':''}>${E(b)}${currencyMap[b]?' · '+E(currencyMap[b]):''}</option>`).join('');
  $('#qm-type').innerHTML='<option value="">全部</option>'+(d.product_types||[]).map(t=>`<option value="${E(t)}" ${t===S.type?'selected':''}>${E(t)}</option>`).join('');
}
function list(){
  const rows=(S.data&&S.data.rows)||[];
  const up=rows.filter(x=>typeof x.vs_previous_pct==='number'&&x.vs_previous_pct>0).length;
  const down=rows.filter(x=>typeof x.vs_previous_pct==='number'&&x.vs_previous_pct<0).length;
  $('#qm-count').textContent=qmLabel('共 ')+rows.length+qmLabel(' 个有效 SKU');
  for(const [mode,count,label] of [['up',up,'↑ '],['down',down,'↓ ']]){
    const button=$('#qm-sort-'+mode);
    if(!button)continue;
    button.textContent=label+qmLabel(mode==='up'?'涨价':'降价')+' '+count;
    button.classList.toggle('active',S.sort===mode);
    button.classList.toggle(mode,true);
    button.setAttribute('aria-pressed',String(S.sort===mode));
  }
  const sorted=[...rows].sort((a,b)=>{
    if(S.sort==='up'||S.sort==='down'){
      const qualifies=x=>typeof x.vs_previous_pct==='number'&&(S.sort==='up'?x.vs_previous_pct>0:x.vs_previous_pct<0);
      const aMatch=qualifies(a),bMatch=qualifies(b);
      if(aMatch!==bMatch)return aMatch?-1:1;
      if(aMatch&&bMatch){
        const difference=S.sort==='up'?b.vs_previous_pct-a.vs_previous_pct:a.vs_previous_pct-b.vs_previous_pct;
        if(difference)return difference;
      }
    }
    return String(a.psi_sku_code||a.sku_code).localeCompare(String(b.psi_sku_code||b.sku_code));
  });
  $('#qm-body').innerHTML=sorted.length?sorted.map(x=>`<tr data-s="${E(x.sku_code)}" data-b="${E(x.brand)}"><td>${E(x.psi_sku_code||x.sku_code)}</td><td>${E(x.product_type||'未分类')}</td><td class="qm-price">${quoteMoney(x.latest_price,x.currency,x.quote_status)}</td><td>${change(x.vs_previous_pct)}</td><td>${E(x.latest_date)}</td><td><span class="qm-link">查看</span></td></tr>`).join(''):'<tr><td colspan="6" class="qm-empty">暂无符合条件的有效 SKU 报价</td></tr>';
  $('#qm-body').querySelectorAll('tr[data-s]').forEach(tr=>tr.onclick=()=>sku(tr.dataset.s,tr.dataset.b));
}
function chart(points,ccy,field='avg_price'){
  if(!points||points.length<2)return '<div class="qm-empty">历史数据不足，暂无趋势图</div>';
  const v=points.map(p=>Number(p[field])).filter(Number.isFinite);if(v.length<2)return '<div class="qm-empty">历史数据不足，暂无趋势图</div>';
  const min=Math.min(...v),max=Math.max(...v),w=520,h=180,p=22,span=max-min||1,xy=v.map((n,i)=>[p+(w-p*2)*(i/(v.length-1)),h-p-(h-p*2)*((n-min)/span)]),path=xy.map((q,i)=>(i?'L':'M')+q[0].toFixed(1)+' '+q[1].toFixed(1)).join(' ');
  return `<svg viewBox="0 0 ${w} ${h}" class="qm-chart"><path d="${path}" fill="none" stroke="#238636" stroke-width="2.5"/>${xy.map(q=>`<circle cx="${q[0]}" cy="${q[1]}" r="3.5" fill="#238636"/>`).join('')}<text x="22" y="16" font-size="11" fill="#888">${E(ccy||'')}</text></svg>`;
}
function brief(r){
  if(typeof window.getLang==='function'&&window.getLang()==='en'){
    if(!r||!r.sku_count)return 'No quote data for this brand.';
    const trend=r.avg_change_pct==null?'not enough historical data to assess price direction':
      'the latest valid quote average '+(r.avg_change_pct>=0?'increased':'decreased')+' '+Math.abs(r.avg_change_pct).toFixed(2)+'% vs. the previous quote';
    const unquoted=r.no_quote_count?', including '+r.no_quote_count+' currently unquoted entries':'';
    const unlinked=r.unlinked_count?'; '+r.unlinked_count+' supplier part numbers are not linked to PSI SKUs and are excluded from internal purchase-price comparisons':'';
    return (r.brand||S.brand)+' has '+r.sku_count+' quote entries and '+r.history_count+
      ' historical records'+unquoted+unlinked+'. Latest quote trend: '+trend+
      '. Among comparable SKUs, '+r.above_purchase_count+' are above and '+r.below_purchase_count+
      ' are below the latest purchase price.';
  }
  if(!r||!r.sku_count)return '当前品牌暂无报价数据。';const a=r.avg_change_pct==null?'暂无足够历史数据':`最新有效报价平均较上次${r.avg_change_pct>=0?'上涨':'下降'} ${Math.abs(r.avg_change_pct).toFixed(2)}%`,n=r.no_quote_count?`，其中 ${r.no_quote_count} 个条目最新记录为未报价`:'';const u=r.unlinked_count?`，另有 ${r.unlinked_count} 条供应商料号尚未关联 PSI SKU，不参与内部采购价对比`:'';return `${r.brand||S.brand} 当前覆盖 ${r.sku_count} 个报价条目，共 ${r.history_count} 条历史记录${n}${u}；${a}。与最近采购价可比的 SKU 中，${r.above_purchase_count} 个高于上次采购价，${r.below_purchase_count} 个低于上次采购价。`;
}
function mini(a,k){return(a||[]).length?a.map(x=>`<div style="display:flex;justify-content:space-between;font-size:12px;margin:8px 0"><span>${E(x.sku_code)}</span>${change(x[k])}</div>`).join(''):'<div class="qm-sub">暂无可比数据</div>';}
function report(){
  const d=S.data||{},r=d.report||{};
  $('#qm-right').innerHTML=`<div class="qm-report"><div class="qm-report-title"><div><div class="qm-brand">${E(r.brand||S.brand)} <span class="qm-badge">品牌报告</span></div><div class="qm-sub">自动生成 · 当前筛选口径</div></div><button class="qm-btn" id="qm-export">⇩ 导出品牌报告</button></div><div class="qm-kpis"><div class="qm-kpi"><span>报价条目</span><b>${r.sku_count||0}</b></div><div class="qm-kpi"><span>历史记录</span><b>${r.history_count||0}</b></div><div class="qm-kpi"><span>本月更新</span><b>${r.updated_this_month||0}</b></div><div class="qm-kpi"><span>当前未报价</span><b>${r.no_quote_count||0}</b></div></div><div class="qm-section"><h4>品牌报价趋势</h4>${chart(r.trend,r.currency)}</div><div class="qm-two qm-section"><div class="qm-mini"><h4>价格波动较大的 SKU</h4>${mini(r.top_movers,'vs_previous_pct')}</div><div class="qm-mini"><h4>较上次采购价差异</h4>${mini(r.top_purchase_gaps,'vs_purchase_pct')}</div></div><div class="qm-section"><h4>一级类目分布</h4>${Object.entries(r.product_types||{}).map(([k,v])=>`<div style="display:flex;justify-content:space-between;font-size:12px;margin:7px 0"><span>${E(k)}</span><b>${v}</b></div>`).join('')||'—'}</div><div class="qm-section qm-mini" data-qm-brief="1"><h4>品牌简报</h4><div style="font-size:13px;line-height:1.8;color:#555">${E(brief(r))}</div></div></div>`;
  $('#qm-export').onclick=exportReport;
  localizeQuotation($('#qm'));
}

async function sku(s,b){
  const key=detailKey(s,b);S.detailKey=key;
  const cached=detailCache.get(key);
  if(cached){S.detail=cached;renderSku();}
  else{$('#qm-right').innerHTML='<div class="qm-report"><div class="qm-skeleton qm-sk-line" style="width:150px;height:22px">.</div><div class="qm-kpis" style="margin-top:16px">'+Array.from({length:4},()=>'<div class="qm-skeleton qm-sk-card">.</div>').join('')+'</div><div class="qm-skeleton" style="height:180px;border-radius:12px;margin-top:16px">.</div></div>';}
  const seq=++detailSeq;
  try{
    const d=await call('/api/quotation-management/sku/'+encodeURIComponent(s)+'?brand='+encodeURIComponent(b));
    lruSet(detailCache,key,d,DETAIL_CACHE_MAX);
    if(seq!==detailSeq||S.detailKey!==key||!$('#qm'))return;
    S.detail=d;renderSku();
  }catch(e){if(seq===detailSeq&&S.detailKey===key&&!cached)$('#qm-right').innerHTML='<div class="qm-empty">加载失败：'+E(e.message)+'</div>';}
}
function renderSku(){
  const d=S.detail,h=d.history||[],l=h[0]||{},p=d.purchase,quotedHistory=h.filter(x=>x.quote_status!=='no_quote'&&x.quote_price!=null);
  $('#qm-right').innerHTML=`<div class="qm-report"><div class="qm-report-title"><div><div class="qm-brand">${E(d.sku_code)} <span class="qm-badge">${E(d.brand)}</span></div><div class="qm-sub">${d.match_status==='unlinked'?'供应商料号：'+E(d.supplier_part_no||d.sku_code)+' · 未关联 PSI SKU':'PSI SKU：'+E(d.psi_sku_code||d.sku_code)+' · 供应商料号：'+E(d.supplier_part_no||d.sku_code)} · ${E(l.product_type||'')} · ${E([l.model,l.spec].filter(Boolean).join(' / '))}</div></div><button class="qm-btn" id="qm-back">← 返回品牌报告</button></div><div class="qm-kpis"><div class="qm-kpi"><span>最新 FOB</span><b>${quoteMoney(l.quote_price,l.currency,l.quote_status)}</b></div><div class="qm-kpi"><span>记录日期</span><b style="font-size:15px">${E(l.quote_date||'—')}</b></div><div class="qm-kpi"><span>较上次报价</span><b style="font-size:16px">${l.vs_previous_pct==null?'—':l.vs_previous_pct.toFixed(2)+'%'}</b></div><div class="qm-kpi"><span>较上次采购价</span><b style="font-size:16px">${l.vs_purchase_pct==null?'—':l.vs_purchase_pct.toFixed(2)+'%'}</b></div></div><div class="qm-section"><h4>FOB 价格趋势</h4>${chart([...quotedHistory].reverse(),l.currency,'quote_price')}</div><div class="qm-section"><h4>最近采购基准（CI）</h4><div class="qm-mini" style="font-size:12px">${d.match_status==='unlinked'?'该报价尚未关联 PSI SKU，不参与内部采购价对比':p&&p.status==='exact'?`${E(p.ci_no)} · ${money(p.unit_price,p.currency)} · ${E(p.purchase_date||'')}`:p&&p.status==='ambiguous'?'最近 CI 同 SKU 存在不同原单价，已阻止比较':'暂无可比采购价'}</div></div><div class="qm-section"><h4>历史报价记录</h4><div class="qm-table-wrap" style="max-height:280px"><table class="qm-table"><thead><tr><th>报价日期</th><th>FOB</th><th>币种</th><th>较上一有效报价</th><th>备注</th></tr></thead><tbody>${h.map(x=>`<tr><td>${E(x.quote_date)}</td><td>${quoteMoney(x.quote_price,x.currency,x.quote_status)}</td><td>${E(x.currency)}</td><td>${change(x.vs_previous_pct)}</td><td>${E(x.remark||'—')}</td></tr>`).join('')}</tbody></table></div></div></div>`;
  $('#qm-back').onclick=()=>{S.detail=null;S.detailKey='';report();};
  localizeQuotation($('#qm'));
}

function template(){
  const rows=[{SKU:'M724',品牌:'Redragon',产品类型:'鼠标',FOB价格:58,币种:'RMB',报价日期:new Date().toISOString().slice(0,10),备注:''},{SKU:'U905-128G',品牌:'Netac',产品类型:'U盘',FOB价格:10.5,币种:'USD',报价日期:new Date().toISOString().slice(0,10),备注:''}],ws=XLSX.utils.json_to_sheet(rows),wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'报价导入模板');XLSX.writeFile(wb,'报价管理_导入模板.xlsx');
}
function importModal(){
  const m=document.createElement('div');m.className='qm-modal';m.innerHTML=`<div class="qm-dialog"><h3>导入报价</h3><div class="qm-drop"><input type="file" id="qm-file" accept=".xlsx,.xls,.csv"><div class="qm-sub" style="margin-top:8px">字段：SKU、品牌、产品类型、FOB价格、币种、报价日期、备注（可选）</div><div class="qm-sub" style="margin-top:5px">FOB 填 0 = 当日未报价；会保留记录，但不会作为价格参与趋势或环比。</div></div><div style="margin-top:12px;font-size:13px">重复 SKU + 品牌 + 报价日期： <select id="qm-mode"><option value="skip">跳过已有记录</option><option value="overwrite">覆盖已有记录</option></select></div><div id="qm-preview" class="qm-sub" style="margin-top:8px"></div><div class="qm-dialog-actions"><button class="qm-btn" id="qm-cancel">取消</button><button class="qm-btn primary" id="qm-submit">开始导入</button></div></div>`;document.body.appendChild(m);let rows=[];
  localizeQuotation(m);
  $('#qm-cancel',m).onclick=()=>m.remove();
  $('#qm-file',m).onchange=async e=>{const f=e.target.files[0];if(!f)return;const wb=XLSX.read(await f.arrayBuffer(),{type:'array'});rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{defval:''});$('#qm-preview',m).textContent='已读取 '+rows.length+' 行，提交时整批校验。';};
  $('#qm-submit',m).onclick=async()=>{if(!rows.length)return alert('请先选择文件');try{const r=await call('/api/quotation-management/import','POST',{rows,duplicate_mode:$('#qm-mode',m).value});m.remove();alert(`导入完成：新增 ${r.inserted}，更新 ${r.updated}，跳过 ${r.skipped}，未报价 ${r.no_quote||0}`);summaryCache.clear();detailCache.clear();S.data=null;renderSkeleton();load({useCache:false,background:false});}catch(e){alert(e.message||'导入失败')}};
}
function exportReport(){
  const d=S.data||{},r=d.report||{},wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet([{品牌:r.brand||S.brand,币种:r.currency,报价条目数:r.sku_count,未关联料号数:r.unlinked_count||0,历史记录数:r.history_count,有效报价记录:r.quoted_history_count,当前未报价SKU:r.no_quote_count,本月更新:r.updated_this_month,较上次报价平均变化:r.avg_change_pct,高于上次采购价:r.above_purchase_count,低于上次采购价:r.below_purchase_count,品牌简报:brief(r)}]),'品牌概览');XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet((d.rows||[]).map(x=>({供应商料号:x.supplier_part_no||x.sku_code,PSI_SKU:x.psi_sku_code||'',关联状态:x.match_status==='unlinked'?'未关联':'已关联',品牌:x.brand,产品类型:x.product_type,型号:x.model||'',规格:x.spec||'',最新FOB:x.quote_status==='no_quote'?'未报价':x.latest_price,币种:x.currency,报价日期:x.latest_date,较上次报价:x.vs_previous_pct,上次采购价:x.last_purchase_price,较上次采购价:x.vs_purchase_pct,最近CI:x.last_purchase_ci_no}))),'最新报价');XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet((r.top_movers||[]).map(x=>({SKU:x.sku_code,产品类型:x.product_type,最新FOB:x.latest_price,较上次报价:x.vs_previous_pct,较上次采购价:x.vs_purchase_pct}))),'价格异动');XLSX.writeFile(wb,`报价报告_${r.brand||S.brand}_${new Date().toISOString().slice(0,10)}.xlsx`);
}

async function prefetchDefault(){
  if(!canView())return;
  const key='Netac||||';if(summaryCache.has(key)||typeof window.api!=='function')return;
  try{const d=await call('/api/quotation-management/summary?brand=Netac');lruSet(summaryCache,key,d,SUMMARY_CACHE_MAX);}catch(_e){}
}

window.getQuotationManagementBrand=()=>S.brand||'Netac';
window.showQuotationManagement=show;
function boot(){
  css();nav();
  const n=$('#sidebar-nav');if(n)new MutationObserver(nav).observe(n,{childList:true,subtree:true});
  document.addEventListener('change',event=>{
    if(!event.target||event.target.id!=='lang-switcher'||!$('#qm'))return;
    const activeModal=!!document.querySelector('.qm-modal');
    // Run after the shell's own setLang handler. Keep the current quotation view
    // rather than following the previous main-app currentPage by mistake.
    queueMicrotask(()=>{
      if(activeModal){nav();return;}
      nav();
      show();
    });
  },true);
  const warm=()=>prefetchDefault();
  if('requestIdleCallback'in window)window.requestIdleCallback(warm,{timeout:1800});else setTimeout(warm,900);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
