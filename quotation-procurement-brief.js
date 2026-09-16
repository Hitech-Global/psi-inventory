(function(){
'use strict';

let latestSummary=null;
let latestUrl='';

function esc(v){return String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[m]));}
function currentSummaryUrl(){
  const q=new URLSearchParams();
  const brand=document.getElementById('qm-brand')?.value||'';
  const type=document.getElementById('qm-type')?.value||'';
  const keyword=document.getElementById('qm-key')?.value?.trim()||'';
  const from=document.getElementById('qm-from')?.value||'';
  const to=document.getElementById('qm-to')?.value||'';
  [['brand',brand],['product_type',type],['keyword',keyword],['date_from',from],['date_to',to]].forEach(([k,v])=>v&&q.set(k,v));
  return '/api/quotation-management/summary?'+q.toString();
}
function ensureCss(){
  if(document.getElementById('qm-procurement-brief-css'))return;
  const s=document.createElement('style');
  s.id='qm-procurement-brief-css';
  s.textContent=`.qm-procurement-brief{margin:0 0 14px!important;padding:14px 15px!important;background:linear-gradient(180deg,#f7fbf8 0%,#f4f7f5 100%)!important;border:1px solid #dfe9e2!important;border-radius:14px!important}.qm-procurement-brief h4{display:flex;align-items:center;gap:7px;margin:0 0 10px!important;font-size:14px!important}.qm-procurement-headline{font-size:13px;line-height:1.7;color:#2b2f33;margin-bottom:10px}.qm-procurement-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.qm-procurement-item{background:#fff;border:1px solid #e8ece9;border-radius:10px;padding:9px 10px}.qm-procurement-item b{display:block;font-size:12px;color:#1d1d1f;margin-bottom:3px}.qm-procurement-item span{display:block;font-size:11px;line-height:1.5;color:#686d72}.qm-procurement-item.good b{color:#19713a}.qm-procurement-item.warn b{color:#9a6700}.qm-procurement-item.risk b{color:#b42318}.qm-procurement-item.muted b{color:#6e6e73}@media(max-width:1100px){.qm-procurement-grid{grid-template-columns:1fr}}`;
  document.head.appendChild(s);
}
function makeBrief(r){
  const brand=r.brand||document.getElementById('qm-brand')?.value||'当前品牌';
  const avg=r.avg_change_pct;
  const lower=Number(r.below_purchase_count)||0;
  const higher=Number(r.above_purchase_count)||0;
  const noQuote=Number(r.no_quote_count)||0;
  const comparable=Number(r.comparable_purchase_count)||(lower+higher);
  const mismatch=Number(r.currency_mismatch_count)||0;
  const up=Number(r.up_count)||0;
  const down=Number(r.down_count)||0;
  let headline='';
  if(avg==null) headline=`${brand} 当前报价历史还不足以判断整体价格方向。`;
  else if(avg<0) headline=`${brand} 最新有效报价较上一轮平均下降 ${Math.abs(avg).toFixed(2)}%，采购侧可以优先查看降价 SKU，再结合库存和补货需求决定是否下单。`;
  else if(avg>0) headline=`${brand} 最新有效报价较上一轮平均上涨 ${Math.abs(avg).toFixed(2)}%，采购侧应优先关注涨幅大的 SKU，并在下单前核对涨价原因。`;
  else headline=`${brand} 最新有效报价较上一轮整体持平，采购侧重点应放在单 SKU 异动和最近采购价差异。`;

  const items=[];
  if(comparable>0){
    items.push(`<div class="qm-procurement-item good"><b>${lower} 个 SKU 低于上次采购价</b><span>这些 SKU 当前报价更有采购优势，可优先结合补货需求复核。</span></div>`);
    items.push(`<div class="qm-procurement-item ${higher?'risk':'muted'}"><b>${higher} 个 SKU 高于上次采购价</b><span>${higher?'建议优先议价或核对涨价原因，再决定是否下单。':'当前没有高于上次采购价的可比 SKU。'}</span></div>`);
  }else if(mismatch>0){
    items.push(`<div class="qm-procurement-item warn"><b>${mismatch} 个 SKU 币种不一致</b><span>报价与上次采购价币种不同，系统不会自动换算，因此不参与采购价环比。</span></div>`);
  }else{
    items.push(`<div class="qm-procurement-item warn"><b>暂无可比采购价</b><span>当前筛选范围内没有能与报价 SKU 对上的同币种历史 CI/PI 采购记录。</span></div>`);
  }
  items.push(`<div class="qm-procurement-item ${noQuote?'warn':'muted'}"><b>${noQuote} 个 SKU 当前未报价</b><span>${noQuote?'这部分应先向供应商补报价，不进入价格优劣判断。':'当前所选范围内没有未报价 SKU。'}</span></div>`);
  items.push(`<div class="qm-procurement-item muted"><b>${down} 个降价 · ${up} 个涨价</b><span>优先查看波动最大的 SKU，确认是否需要提前锁价、议价或延后采购。</span></div>`);

  return `<h4>🧭 采购简报</h4><div class="qm-procurement-headline">${esc(headline)}</div><div class="qm-procurement-grid">${items.join('')}</div>`;
}
function apply(){
  ensureCss();
  const right=document.getElementById('qm-right');
  if(!right)return;
  const badge=[...right.querySelectorAll('.qm-badge')].find(x=>x.textContent.includes('品牌报告'));
  if(!badge)return;
  const report=latestSummary&&latestSummary.report;
  if(!report)return;
  const brandInDom=(right.querySelector('.qm-brand')?.childNodes?.[0]?.textContent||'').trim();
  if(report.brand&&brandInDom&&report.brand!==brandInDom)return;
  const sections=[...right.querySelectorAll('.qm-section')];
  let brief=sections.find(s=>s.querySelector('h4')?.textContent.includes('品牌简报'))||sections.find(s=>s.classList.contains('qm-procurement-brief'));
  if(!brief)return;
  brief.classList.add('qm-procurement-brief');
  brief.innerHTML=makeBrief(report);
  const reportTitle=right.querySelector('.qm-report-title');
  if(reportTitle&&brief.previousElementSibling!==reportTitle)reportTitle.insertAdjacentElement('afterend',brief);
}
function wrapApi(){
  if(typeof window.api!=='function'||window.api.__qmProcurementWrapped)return;
  const original=window.api;
  const wrapped=async function(url,method,body,opts){
    const out=await original.apply(this,arguments);
    if((!method||method==='GET')&&String(url||'').startsWith('/api/quotation-management/summary?')&&out&&out.report){latestSummary=out;latestUrl=String(url);queueMicrotask(apply);}
    return out;
  };
  wrapped.__qmProcurementWrapped=true;
  window.api=wrapped;
}
function boot(){
  wrapApi();ensureCss();
  const obs=new MutationObserver(()=>{if(latestSummary&&latestUrl===currentSummaryUrl())apply();else if(latestSummary)apply();});
  obs.observe(document.body,{childList:true,subtree:true});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
