'use strict';
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.join(__dirname,'..');
const APP=path.join(ROOT,'app.js');
const MARKER='// CI-UNIFIED-DATA-BINDING-V1';
function patchAppSource(src){
  if(src.includes(MARKER)) return src;
  const labelOld="function ciClearanceLabel(v){return v==='formal'?t('ci.clearance.formal','正清'):v==='non_formal'?t('ci.clearance.non_formal','非正清'):t('ci.clearance.unset','未设置');}";
  const labelNew="function ciClearanceLabel(v){var raw=String(v==null?'':v);return raw==='domestic'?t('pi.trade_mode.domestic','国内贸易'):raw==='formal'?t('ci.clearance.formal','正清'):raw==='non_formal'?t('ci.clearance.non_formal','非正清'):raw?t('ci.clearance.unknown','原值待核对')+' ('+raw+')':t('ci.clearance.unset','未设置');}";
  if(!src.includes(labelOld))throw new Error('[CI-DATA-BINDING] clearance label anchor not found');
  src=src.replace(labelOld,labelNew);
  const renderAt=src.indexOf('function renderUnifiedCITable');
  const start=src.indexOf('  function addOpRow(srcTable,sourceRow,c){',renderAt);
  const hist=src.indexOf('  function addHistoricalRow(srcTable,sourceRow,h){',start);
  const end=src.indexOf('\n\n  if(operationalData.length)',hist);
  if(renderAt<0||start<0||hist<0||end<0) throw new Error('[CI-DATA-BINDING] row renderer anchors not found');
  const op=[
"  function addOpRow(srcTable,sourceRow,c){",
"    var tr=document.createElement('tr');tr.className=sourceRow.className||'clickable-detail-row';",
"    var click=sourceRow.getAttribute('onclick');if(click)tr.setAttribute('onclick',click);",
"    var noCell=document.createElement('td');noCell.className='cell-id';",
"    var logiToggle=document.createElement('button');logiToggle.type='button';logiToggle.className='ci-list-logi-toggle';logiToggle.setAttribute('data-ci-logi-toggle',String(c.id));logiToggle.title=t('logistics.title','物流批次');logiToggle.innerHTML='<span id=\"ci-list-logi-caret-'+esc(String(c.id))+'\">▶</span>';noCell.appendChild(logiToggle);",
"    var noLink=document.createElement('span');noLink.className='link-text';noLink.textContent=c.ci_no||'—';noLink.onclick=function(event){event.stopPropagation();viewCI(c.id);};noCell.appendChild(noLink);tr.appendChild(noCell);",
"    var typeCell=document.createElement('td');typeCell.innerHTML=ciTypeBadge('operational');tr.appendChild(typeCell);",
"    tr.appendChild(textCell(c.brand));",
"    tr.appendChild(textCell(unifiedCICountryLabel(c.country)));",
"    tr.appendChild(textCell(c.target_warehouse));",
"    var clearanceCell=document.createElement('td');",
"    if(String(c.trade_mode||'international').toLowerCase()==='domestic'){clearanceCell.textContent=t('pi.trade_mode.domestic','国内贸易');}",
"    else {",
"      var clearanceValue=String(c.clearance_type==null?'':c.clearance_type);",
"      var clearanceSelect=document.createElement('select');clearanceSelect.className='ci-clearance-inline';",
"      var clearanceLabel=t('ci.clearance_type','清关方式');clearanceSelect.setAttribute('aria-label',clearanceLabel);clearanceSelect.title=clearanceLabel;",
"      clearanceSelect.setAttribute('data-saved-value',clearanceValue);clearanceSelect.setAttribute('data-original-value',clearanceValue);clearanceSelect.setAttribute('data-ci-id',String(c.id));",
"      clearanceSelect.disabled=!(typeof hasPermission==='function'&&hasPermission('ci_edit'));",
"      var clearanceOptions=[['',t('ci.clearance.unset','未设置')],['formal',t('ci.clearance.formal','正清')],['non_formal',t('ci.clearance.non_formal','非正清')]];if(clearanceValue&&['formal','non_formal'].indexOf(clearanceValue)<0)clearanceOptions.push([clearanceValue,t('ci.clearance.unknown','原值待核对')+' ('+clearanceValue+')']);clearanceOptions.forEach(function(option){var node=document.createElement('option');node.value=option[0];node.textContent=option[1];if(clearanceValue===option[0])node.setAttribute('selected','selected');if(option[0]===clearanceValue&&option[0]!==''&&['formal','non_formal'].indexOf(option[0])<0)node.disabled=true;clearanceSelect.appendChild(node);});",
"      clearanceCell.appendChild(clearanceSelect);",
"    }",
"    tr.appendChild(clearanceCell);",
"    tr.appendChild(textCell(fmtDate(c.ci_date)));",
"    tr.appendChild(textCell(fmtMoney(c.goods_amount,c.currency)));",
"    var freightTotal=textCell('—');freightTotal.setAttribute('data-ci-freight-cell','total');freightTotal.setAttribute('data-ci-id',String(c.id));tr.appendChild(freightTotal);",
"    var freightRatio=textCell('—');freightRatio.setAttribute('data-ci-freight-cell','ratio');freightRatio.setAttribute('data-ci-id',String(c.id));tr.appendChild(freightRatio);",
"    tr.appendChild(textCell(fmtMoney(Number(c.actual_deducted_deposit||0)+Number(c.balance_paid_amount||0),c.currency)));",
"    tr.appendChild(textCell(fmtMoney(c.balance_unpaid_amount,c.currency)));",
"    tr.appendChild(textCell(fmtDate(c.due_date)));",
"    tr.appendChild(textCell(ciPaymentStatusLabel(c.balance_payment_status)));",
"    tr.appendChild(textCell(logisticsStatusLabelByKey(c.ci_logistics_display_status)));",
"    tr.appendChild(cell(srcTable,sourceRow,['操作','Actions']));tbody.appendChild(tr);",
"  }"
  ].join('\n');
  const historical=[
"  function addHistoricalRow(srcTable,sourceRow,h){",
"    var tr=document.createElement('tr');tr.className=sourceRow.className||'clickable-detail-row';",
"    var click=sourceRow.getAttribute('onclick');if(click)tr.setAttribute('onclick',click);",
"    var noCell=document.createElement('td');noCell.className='cell-id';",
"    var toggle=document.createElement('button');toggle.type='button';toggle.className='ci-history-expand ci-list-logi-toggle';toggle.id='ci-historical-caret-'+h.id;toggle.textContent='▶';toggle.title='展开历史付款明细';",
"    toggle.setAttribute('onclick',\"toggleHistoricalCIDetail(event,'\"+String(h.id).replace(/'/g,'')+\"')\");noCell.appendChild(toggle);",
"    var link=document.createElement('span');link.className='link-text';link.textContent=h.historical_ci_no||'—';link.onclick=function(event){event.stopPropagation();viewHistoricalCI(h.id);};noCell.appendChild(link);tr.appendChild(noCell);",
"    var typeCell=document.createElement('td');typeCell.innerHTML=ciTypeBadge('historical');tr.appendChild(typeCell);",
"    tr.appendChild(textCell(h.brand_name));tr.appendChild(textCell(unifiedCICountryLabel(h.country)));",
"    var histCountryKey=String(h.country||'').trim().toUpperCase();",
"    var historicalWarehouse=h.target_warehouse||(['ID','IND','INDONESIA','印尼','印度尼西亚'].includes(histCountryKey)?'Bekasi Warehouse':(['TH','THA','THAILAND','泰国','MY','MYS','MALAYSIA','马来西亚'].includes(histCountryKey)?'至速仓':'—'));",
"    tr.appendChild(textCell(historicalWarehouse));",
"    var clearanceCell=cell(srcTable,sourceRow,['清关方式','Clearance Type','Clearance','Customs Clearance']);",
"    if(!clearanceCell.querySelector('select'))clearanceCell.textContent=h.clearance_type?ciClearanceLabel(h.clearance_type):'—';",
"    tr.appendChild(clearanceCell);",
"    tr.appendChild(textCell(fmtDate(h.ci_date)));tr.appendChild(textCell(fmtMoney(h.gross_goods_amount,h.currency)));",
"    var historicalFreightAmount=Number(h.freight_amount);",
"    var historicalFreightCurrencyRaw=String(h.freight_currency||h.currency||'').trim().toUpperCase();",
"    var historicalFreightCurrency=historicalFreightCurrencyRaw==='CNY'?'RMB':historicalFreightCurrencyRaw;",
"    tr.appendChild(textCell(Number.isFinite(historicalFreightAmount)&&historicalFreightAmount>0?fmtMoney(historicalFreightAmount,historicalFreightCurrency):'—'));",
"    var historicalGoodsCurrencyRaw=String(h.currency||'').trim().toUpperCase();",
"    var sameHistoricalFreightCurrency=historicalFreightCurrencyRaw===historicalGoodsCurrencyRaw||((historicalFreightCurrencyRaw==='CNY'||historicalFreightCurrencyRaw==='RMB')&&(historicalGoodsCurrencyRaw==='CNY'||historicalGoodsCurrencyRaw==='RMB'));",
"    var historicalFreightRatio=sameHistoricalFreightCurrency&&Number.isFinite(historicalFreightAmount)&&historicalFreightAmount>0&&Number(h.gross_goods_amount)>0?(historicalFreightAmount/Number(h.gross_goods_amount)*100).toFixed(2)+'%':'—';",
"    tr.appendChild(textCell(historicalFreightRatio));",
"    tr.appendChild(textCell(fmtMoney(Number(h.historical_paid_amount||0)+Number(h.subsequent_paid_amount||0),h.currency)));",
"    tr.appendChild(textCell(fmtMoney(h.unpaid_amount,h.currency)));tr.appendChild(textCell(fmtDate(h.due_date)));",
"    tr.appendChild(textCell(ciPaymentStatusLabel(h.payment_status)));tr.appendChild(textCell('—'));",
"    tr.appendChild(cell(srcTable,sourceRow,['操作','Actions']));tbody.appendChild(tr);",
"    var detail=document.createElement('tr');detail.className='ci-historical-detail-row';detail.id='ci-historical-detail-'+h.id;detail.hidden=true;",
"    var td=document.createElement('td');td.colSpan=columns.length;",
"    var items=[[t('ci.historical_paid','导入历史已付'),h.historical_paid_amount],[t('ci.subsequent_paid','后续已付'),h.subsequent_paid_amount],[t('ci.deduction','抵扣'),h.deduction_amount],[t('ci.rounding','抹零'),h.rounding_amount]];",
"    td.innerHTML='<div class=\"ci-historical-payment-grid\" style=\"display:grid;grid-template-columns:repeat(4,minmax(130px,1fr));gap:10px;padding:12px 14px;background:#f5f5f7;border:1px solid #e5e5ea;border-radius:10px\">'+items.map(function(item){return '<div style=\"display:flex;flex-direction:column;gap:5px\"><span style=\"font-size:12px;color:#86868b\">'+esc(item[0])+'</span><strong style=\"font-size:13px;color:#1d1d1f;font-weight:600\">'+esc(fmtMoney(Number(item[1]||0),h.currency))+'</strong></div>';}).join('')+'</div>';",
"    detail.appendChild(td);tbody.appendChild(detail);",
"  }"
  ].join('\n');
  return src.slice(0,start)+op+'\n'+historical+src.slice(end).replace('\n\n  if(operationalData.length)','\n\n  '+MARKER+'\n  if(operationalData.length)');
}
function apply(){const src=fs.readFileSync(APP,'utf8'),next=patchAppSource(src);if(next!==src)fs.writeFileSync(APP,next,'utf8');console.log('[CI-DATA-BINDING] language-independent CI row mapping applied');}
if(require.main===module)apply();
module.exports={MARKER,patchAppSource};
