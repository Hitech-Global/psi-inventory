'use strict';
// FIN-OVERVIEW V1. Read-only view on the existing payable cockpit route.
// Never derive settlement from payment_request.status or count PO+PI+CI together.
let _finOverviewData=null,_finOverviewFiltered=[];
const FIN_CAT={goods:'采购货款',warehouse_arrival:'物流/到仓',customs_duty:'关税',inspection_fee:'商检/检测',other:'其他费用'};
const FIN_TYPE={factory:'供应商',service_provider:'货代/服务商',customs:'海关',inspection_org:'检验机构'};
function finLabel(v){return FIN_CAT[v]||v||'其他费用';}
function finNum(n){return esc(fmtMoney(Number(n||0)));}
function finOpts(values,placeholder){return '<option value="">'+esc(placeholder)+'</option>'+
 values.map(v=>'<option value="'+esc(v)+'">'+esc(v)+'</option>').join('');}
function finSum(rows,key){return Math.round(rows.reduce((a,r)=>a+Number(r[key]||0),0)*100)/100;}
function finCard(label,currencyLines,sub){
 return '<div class="fin-card"><div class="fin-card-label">'+esc(label)+'</div>'+
   '<div class="fin-card-value">'+currencyLines+'</div>'+
   (sub?'<div class="fin-card-sub">'+esc(sub)+'</div>':'')+'</div>';
}
function finCurrencyDisplay(rows,key){
 const currencies=[...new Set(rows.map(r=>r.currency))].sort();
 if(!currencies.length)return '<span class="fin-no-money">—</span>';
 return currencies.map(cur=>{
   const subset=rows.filter(r=>r.currency===cur);
   return '<div><span class="fin-money-cur">'+esc(cur)+'</span> '+finNum(finSum(subset,key))+'</div>';
 }).join('');
}
function finViewRows(){
 const v=id=>{const el=document.getElementById(id);return el?el.value:'';};
 const country=v('fin-country'),category=v('fin-category'),payee=v('fin-payee'),currency=v('fin-currency');
 const rows=(_finOverviewData&&_finOverviewData.details)||[];
 return rows.filter(r=>(!country||r.country===country)&&(!category||r.category===category)
   &&(!payee||r.payee_key===payee)&&(!currency||r.currency===currency));
}
function finPurchaseFiltered(){
 const d=_finOverviewData||{},country=document.getElementById('fin-country')?.value||'',
  currency=document.getElementById('fin-currency')?.value||'',
  payee=document.getElementById('fin-payee')?.value||'',
  category=document.getElementById('fin-category')?.value||'';
 if(category&&category!=='goods')return [];
 return (d.purchase_records||[]).filter(r=>(!country||r.country===country)
   &&(!currency||r.currency===currency)&&(!payee||('supplier:'+r.supplier_id)===payee));
}
function finPIAmount(payeeKey,currency){
 const d=_finOverviewData;if(!d||!payeeKey.startsWith('supplier:'))return 0;
 const cat=document.getElementById('fin-category')?.value||'';
 if(cat&&cat!=='goods')return 0;
 const country=document.getElementById('fin-country')?.value||'';
 return (d.purchase_records||[]).filter(r=>
   'supplier:'+r.supplier_id===payeeKey&&r.currency===currency
   &&(!country||r.country===country))
   .reduce((a,r)=>a+Number(r.total_amount||0),0);
}
function finGroup(rows,keyFn,fields){
 const m=new Map();
 rows.forEach(r=>{
   const key=keyFn(r);
   let group=m.get(key);
   if(!group){
     group={...fields(r),gross:0,cash_paid:0,deductions:0,rounding:0,
      outstanding:0,overdue:0,due_today:0,due_7:0,due_30:0,no_due:0,due_ever:0,count:0};
     m.set(key,group);
   }
   group.count++;
   for(const col of ['gross','cash_paid','deductions','rounding','outstanding','overdue','due_today',
     'due_7','due_30','no_due','due_ever'])group[col]+=Number(r[col]||0);
 });
 return [...m.values()];
}
function finTable(headers,rows,empty){
 return '<div class="fin-scroll"><table class="fin-table"><thead><tr>'+
   headers.map(x=>'<th>'+esc(x)+'</th>').join('')+'</tr></thead><tbody>'+
   (rows.join('')||'<tr><td colspan="'+headers.length+'" class="fin-empty">'+esc(empty||'无匹配记录')+'</td></tr>')+
   '</tbody></table></div>';
}
function finRowClick(r){
 return 'finOpenDetails(\''+encodeURIComponent(r.payee_key).replace(/'/g,'%27')+'\',\''+encodeURIComponent(r.currency).replace(/'/g,'%27')+'\')';
}
function finRefresh(){
 const d=_finOverviewData;if(!d)return;
 const rows=finViewRows();_finOverviewFiltered=rows;
 const box=document.getElementById('fin-layers');if(!box)return;
 const cats=finGroup(rows,r=>r.category+'|'+r.currency,r=>({category:r.category,currency:r.currency}));
 const pays=finGroup(rows,r=>r.payee_key+'|'+r.currency,r=>({
   payee_key:r.payee_key,payee_name:r.payee_name,payee_type:r.payee_type,currency:r.currency
 }));
 // PI only suppliers: still show independently as booked purchase, not payable.
 if(!(document.getElementById('fin-category')?.value)||
     document.getElementById('fin-category')?.value==='goods'){
   (d.purchase_records||[]).forEach(p=>{
     const country=document.getElementById('fin-country')?.value||'';
     const cur=document.getElementById('fin-currency')?.value||'';
     const payee=document.getElementById('fin-payee')?.value||'';
     const key='supplier:'+p.supplier_id;
     if((country&&p.country!==country)||(cur&&p.currency!==cur)||(payee&&key!==payee))return;
     if(!pays.some(x=>x.payee_key===key&&x.currency===p.currency))
       pays.push({payee_key:key,payee_name:p.supplier_name,payee_type:'factory',currency:p.currency,
         gross:0,cash_paid:0,deductions:0,rounding:0,outstanding:0,overdue:0,
         due_today:0,due_7:0,due_30:0,no_due:0,due_ever:0,count:0});
   });
 }
 pays.sort((a,b)=>b.overdue-a.overdue||b.outstanding-a.outstanding||a.payee_name.localeCompare(b.payee_name));
 cats.sort((a,b)=>b.overdue-a.overdue||b.outstanding-a.outstanding);
 const small=key=>finCurrencyDisplay(rows,key);
 let html='<section class="fin-card-grid">'+
  finCard('PI录入采购货值',finCurrencyDisplay(finPurchaseFiltered().map(x=>({currency:x.currency,gross:x.total_amount})),'gross'),'独立指标，不与应付相加')+
  finCard('累计应付',small('gross'),'包含历史已结清账单')+
  finCard('现金实际已付',small('cash_paid'),'不包含抵扣与抹零')+
  finCard('抵扣 / 抹零',finCurrencyDisplay(rows,'deductions')+
    '<div class="fin-inline-note">抹零 '+finCurrencyDisplay(rows,'rounding')+'</div>','非现金结算')+
  finCard('当前全部未结',small('outstanding'),'含未到期及无到期日')+
  finCard('已到期应付',small('due_ever'),'历史截至今日到期的应付原值')+
  finCard('逾期未付',small('overdue'),'严格早于今天且仍未结清')+
  finCard('今天到期未付',small('due_today'),'独立于逾期未付')+
  finCard('未来 7 天到期',small('due_7'),'不包含今天和历史逾期')+
  finCard('未来 30 天到期',small('due_30'),'包含未来 7 天，不能重复相加')+
  finCard('无到期日未结',small('no_due'),'待核对日期，非预设为逾期')+
  '</section>';
 const issues=(d.issues||[]);
 if(issues.length)html+='<div class="fin-alert">⚠ 有 '+esc(issues.length)+
  ' 项结算事实需要人工对账（例如已付状态与实付不一致）。此处按实际流水计算，不按状态推算现金。</div>';
 html+='<h3 class="fin-heading">费用分类 <small>同一批应付事实按费用性质汇总</small></h3>';
 html+=finTable(['费用类型','币种','账单数','累计应付','现金已付','抵扣/抹零','全部未结','逾期未付'],
   cats.map(r=>'<tr><td>'+esc(finLabel(r.category))+'</td><td>'+esc(r.currency)+'</td><td>'+r.count+
    '</td><td class="fin-n">'+finNum(r.gross)+'</td><td class="fin-n">'+finNum(r.cash_paid)+
    '</td><td class="fin-n">'+finNum(r.deductions+r.rounding)+'</td><td class="fin-n">'+finNum(r.outstanding)+
    '</td><td class="fin-n fin-risk">'+finNum(r.overdue)+'</td></tr>'),'没有应付费用');
 html+='<h3 class="fin-heading">付款对象汇总 <small>按逾期未付优先排序，点击查看账单</small></h3>';
 html+=finTable(['付款对象','类型','币种','PI录入货值','累计应付','现金已付','当前未结','逾期未付','未来7天'],
   pays.map(r=>'<tr class="fin-clickable" onclick="'+finRowClick(r)+'"><td><strong>'+esc(r.payee_name)+'</strong></td>'+
    '<td>'+esc(FIN_TYPE[r.payee_type]||r.payee_type)+'</td><td>'+esc(r.currency)+'</td>'+
    '<td class="fin-n">'+(r.payee_type==='factory'?finNum(finPIAmount(r.payee_key,r.currency)):'—')+'</td>'+
    '<td class="fin-n">'+finNum(r.gross)+'</td><td class="fin-n">'+finNum(r.cash_paid)+'</td>'+
    '<td class="fin-n">'+finNum(r.outstanding)+'</td><td class="fin-n fin-risk">'+finNum(r.overdue)+'</td>'+
    '<td class="fin-n">'+finNum(r.due_7)+'</td></tr>'),'没有符合筛选的付款对象');
 html+='<h3 class="fin-heading">应付与付款明细 <small>可追溯到每笔费用事实</small></h3>';
 const sorted=rows.slice().sort((a,b)=>b.overdue-a.overdue||b.outstanding-a.outstanding);
 html+=finTable(['单据','付款对象','费用','币种','应付原值','现金实付','抵扣','抹零','未结','到期日','状态'],
   sorted.map(r=>'<tr class="fin-clickable" onclick="openPayableDetailModal(decodeURIComponent(\''+encodeURIComponent(r.id)+'\'))">'+
    '<td>'+esc(r.fee_no||r.source_no||'—')+'</td><td>'+esc(r.payee_name)+'</td>'+
    '<td>'+esc(finLabel(r.category))+'</td><td>'+esc(r.currency)+'</td>'+
    '<td class="fin-n">'+finNum(r.gross)+'</td><td class="fin-n">'+finNum(r.cash_paid)+'</td>'+
    '<td class="fin-n">'+finNum(r.deductions)+'</td><td class="fin-n">'+finNum(r.rounding)+'</td>'+
    '<td class="fin-n">'+finNum(r.outstanding)+'</td><td>'+esc(r.due_date||'—')+'</td>'+
    '<td>'+esc(r.lifecycle_status)+'</td></tr>'),'无匹配单据');
 box.innerHTML=html;
 finTranslateDOM(box);
}
function finOpenDetails(encodedKey,encodedCurrency){
 const key=decodeURIComponent(encodedKey),cur=decodeURIComponent(encodedCurrency);
 const rows=finViewRows().filter(x=>x.payee_key===key&&x.currency===cur);
 const title=rows[0]?.payee_name||key;
 const content='<p style="color:var(--text-secondary,#666);font-size:12px">每行均为独立应付费用事实，点击进入原应付费用详情。现金已付不包含抵扣与抹零。</p>'+
 finTable(['费用单号','来源','性质','应付','现金实付','抵扣','未结','到期日'],
 rows.map(r=>'<tr class="fin-clickable" onclick="openPayableDetailModal(decodeURIComponent(\''+encodeURIComponent(r.id)+'\'))">'+
 '<td>'+esc(r.fee_no||'—')+'</td><td>'+esc(r.source_no||'—')+'</td>'+
 '<td>'+esc(finLabel(r.category)+' / '+r.subcategory)+'</td><td class="fin-n">'+finNum(r.gross)+
 '</td><td class="fin-n">'+finNum(r.cash_paid)+'</td><td class="fin-n">'+finNum(r.deductions)+
 '</td><td class="fin-n">'+finNum(r.outstanding)+'</td><td>'+esc(r.due_date||'—')+'</td></tr>'),'该对象暂无已创建的应付账单');
 openModal('付款对象：'+title+' · '+cur,content);
}
function finExportExcel(){
 const d=_finOverviewData,rows=_finOverviewFiltered;
 if(!d||!window.XLSX){showToast('Excel 导出组件未加载','warning');return;}
 const cats=finGroup(rows,r=>r.category+'|'+r.currency,r=>({category:r.category,currency:r.currency}));
 const pays=finGroup(rows,r=>r.payee_key+'|'+r.currency,r=>({
    payee_key:r.payee_key,payee_name:r.payee_name,payee_type:r.payee_type,currency:r.currency
 }));
 finPurchaseFiltered().forEach(p=>{
   const key='supplier:'+p.supplier_id;
   if(!pays.some(x=>x.payee_key===key&&x.currency===p.currency))
     pays.push({payee_key:key,payee_name:p.supplier_name,payee_type:'factory',currency:p.currency,
       gross:0,cash_paid:0,deductions:0,rounding:0,outstanding:0,overdue:0});
 });
 const wb=XLSX.utils.book_new();
 const addSheet=(name,data)=>XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(data),name);
 addSheet('费用分类',[['费用','币种','笔数','应付','现金已付','抵扣','抹零','未结','逾期未付'],
   ...cats.map(x=>[finLabel(x.category),x.currency,x.count,x.gross,x.cash_paid,x.deductions,x.rounding,x.outstanding,x.overdue])]);
 addSheet('付款对象',[['付款对象','类型','币种','PI录入货值','应付','现金已付','抵扣','抹零','未结','逾期未付'],
   ...pays.map(x=>[x.payee_name,FIN_TYPE[x.payee_type]||x.payee_type,x.currency,
     finPIAmount(x.payee_key,x.currency),x.gross,x.cash_paid,x.deductions,x.rounding,x.outstanding,x.overdue])]);
 addSheet('应付明细',[['费用单号','来源单据','对象','类型','币种','应付','现金已付','抵扣','抹零','未结','到期日','国家','状态'],
  ...rows.map(x=>[x.fee_no,x.source_no,x.payee_name,finLabel(x.category),x.currency,
    x.gross,x.cash_paid,x.deductions,x.rounding,x.outstanding,x.due_date,x.country,x.lifecycle_status])]);
 addSheet('PI采购',[['供应商','国家','币种','PI录入金额','PI状态'],
   ...finPurchaseFiltered().map(x=>[x.supplier_name,x.country,x.currency,Number(x.total_amount||0),x.pi_status])]);
 XLSX.writeFile(wb,'财务付款总览_'+d.today+'.xlsx');
}
// Lightweight locale support for the newly consolidated one-page finance UI.
// Translate presentation text only; never touch data IDs, money or source records.
const FIN_TRANSLATIONS={
 '财务付款总览':['Finance Payment Overview','Ringkasan Pembayaran'],
 '累计应付':['Total payables','Total utang'],
 '现金实际已付':['Cash actually paid','Kas telah dibayar'],
 '抵扣 / 抹零':['Deduction / rounding','Potongan / pembulatan'],
 '当前全部未结':['Total outstanding','Total belum lunas'],
 '已到期应付':['Payables due to date','Kewajiban jatuh tempo'],
 '逾期未付':['Overdue unpaid','Tunggakan'],
 '今天到期未付':['Due today unpaid','Jatuh tempo hari ini'],
 '未来 7 天到期':['Due next 7 days','Jatuh tempo 7 hari'],
 '未来 30 天到期':['Due next 30 days','Jatuh tempo 30 hari'],
 '无到期日未结':['Outstanding, no due date','Belum lunas, tanpa jatuh tempo'],
 'PI录入采购货值':['Recorded PI purchases','Nilai pembelian PI'],
 '费用分类':['Expense categories','Kategori biaya'],
 '付款对象汇总':['Payee summary','Ringkasan penerima'],
 '应付与付款明细':['Payables and payments','Rincian hutang dan pembayaran'],
 '采购货款':['Purchase goods','Pembelian barang'],
 '物流/到仓':['Logistics / arrival','Logistik / kedatangan'],
 '关税':['Import duties','Bea masuk'],
 '商检/检测':['Inspection','Inspeksi'],
 '其他费用':['Other expenses','Biaya lain'],
 '供应商':['Supplier','Pemasok'],
 '货代/服务商':['Forwarder / service','Forwarder / jasa'],
 '海关':['Customs','Bea cukai'],
 '检验机构':['Inspection agency','Lembaga inspeksi'],
 '全部国家':['All countries','Semua negara'],
 '全部费用类型':['All expense types','Semua kategori'],
 '全部付款对象':['All payees','Semua penerima'],
 '全部币种':['All currencies','Semua mata uang'],
 '重置筛选':['Reset filters','Reset filter'],
 '导出 Excel':['Export Excel','Ekspor Excel'],
 '应付原值':['Gross payable','Nilai tagihan'],
 '现金已付':['Cash paid','Kas dibayar'],
 '抵扣':['Deduction','Potongan'],
 '抹零':['Rounding','Pembulatan'],
 '未结':['Outstanding','Belum lunas'],
 '到期日':['Due date','Jatuh tempo'],
 '状态':['Status','Status'],
 '币种':['Currency','Mata uang'],
 '类型':['Type','Jenis'],
 '账单数':['Item count','Jumlah tagihan'],
 '付款对象':['Payee','Penerima'],
 '全部未结':['Outstanding','Belum lunas'],
 'PI录入货值':['PI purchase value','Nilai PI'],
 '未来7天':['Next 7 days','7 hari ke depan'],
 '单据':['Document','Dokumen'],
 '费用':['Expense','Biaya'],
 '记录':['Record','Catatan'],
 '累计至今':['All time','Sejak awal'],
 '无匹配单据':['No matching items','Tidak ada item yang cocok'],
 '没有应付费用':['No payable expenses','Tidak ada biaya terutang'],
 '没有符合筛选的付款对象':['No matching payees','Tidak ada penerima yang cocok']
};
function finTranslateDOM(root){
 const lang=document.getElementById('lang-switcher')?.value||'zh';
 const index=lang==='en'?0:lang==='id'?1:-1;
 if(index<0||!root||typeof document.createTreeWalker!=='function'||typeof NodeFilter==='undefined')return;
 const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
 let node;
 while((node=walker.nextNode())){
   const original=node.nodeValue||'',key=original.trim(),translated=FIN_TRANSLATIONS[key];
   if(translated)node.nodeValue=original.replace(key,translated[index]);
 }
}
function renderFinanceOverviewPage(data){
 _finOverviewData=data;
 const all=data.details||[];
 const countries=[...new Set(all.map(r=>r.country).filter(Boolean))].sort();
 const names=[...new Map([...all.map(r=>[r.payee_key,r.payee_name]),...((data.purchase_records||[]).map(p=>['supplier:'+p.supplier_id,p.supplier_name]))]).entries()].sort((a,b)=>a[1].localeCompare(b[1]));
 const currencies=[...new Set(all.map(r=>r.currency))].sort();
 const categories=[...new Set(all.map(r=>r.category))].sort();
 const el=document.getElementById('content-inner');if(!el)return;
 const styles='<style>#fin-overview{max-width:100%;color:var(--text-primary,#1d1d1f)}'+
 '.fin-head{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:10px}'+
 '.fin-head h2{font-size:21px;letter-spacing:-.3px;margin:0}.fin-note{font-size:12px;color:var(--text-secondary,#777);line-height:1.65;margin:6px 0 15px}'+
 '.fin-filters{display:flex;gap:9px;flex-wrap:wrap;margin:12px 0 16px}.fin-filters select{min-width:126px;border:1px solid var(--border,#dfe0e4);border-radius:9px;background:var(--bg-card,#fff);padding:9px;font-size:12px;max-width:225px}'+
 '.fin-card-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px}.fin-card{border:1px solid var(--border,#e5e5e8);background:var(--bg-card,#fff);border-radius:13px;padding:16px;min-height:99px}'+
 '.fin-card-label{font-size:12px;color:var(--text-secondary,#666);margin-bottom:9px}.fin-card-value{font-size:18px;font-weight:650;line-height:1.5;font-variant-numeric:tabular-nums}.fin-money-cur{font-size:11px;color:var(--text-secondary,#777);font-weight:450}.fin-card-sub{font-size:11px;color:var(--text-secondary,#888);margin-top:7px}.fin-inline-note{font-size:11px;color:var(--text-secondary,#888);font-weight:450;margin-top:3px}.fin-inline-note>div{display:inline}'+
 '.fin-heading{font-size:15px;margin:22px 0 10px}.fin-heading small{font-size:11px;font-weight:400;color:var(--text-secondary,#777);margin-left:8px}.fin-scroll{border:1px solid var(--border,#e5e5e8);border-radius:12px;overflow:auto;max-height:440px;background:var(--bg-card,#fff)}.fin-table{border-collapse:separate;border-spacing:0;width:100%;font-size:12px;white-space:nowrap}.fin-table th{text-align:left;position:sticky;top:0;background:var(--bg-secondary,#f5f6f7);color:var(--text-secondary,#65656c);font-weight:600;padding:12px;border-bottom:1px solid var(--border,#e6e6e6);z-index:1}.fin-table td{padding:10px 12px;border-bottom:1px solid var(--border,#eee)}.fin-table .fin-n{text-align:right;font-variant-numeric:tabular-nums}.fin-table .fin-risk{color:#c73333;font-weight:550}.fin-clickable{cursor:pointer}.fin-clickable:hover{background:var(--bg-hover,#f5f8ff)}.fin-empty{text-align:center;color:var(--text-secondary,#777);padding:22px!important}.fin-alert{margin-top:12px;padding:12px 14px;background:var(--bg-secondary,#faf6ee);border:1px solid var(--border,#e7d7c3);border-radius:11px;font-size:12px}'+
 '</style>';
 let h='<div id="fin-overview">'+styles+
 '<div class="fin-head"><div><h2>财务付款总览</h2><div class="fin-note">覆盖已结清与未结清应付账单 · 截至 '+esc(data.today)+'</div></div>'+
 '<button class="btn btn-secondary btn-sm" onclick="finExportExcel()">⬇ 导出 Excel</button></div>'+
 '<div class="fin-note">应付 = 现金实付 + 抵扣 + 抹零 + 未结（按结算事实）。PI录入货值单独展示，不能与应付重复相加；不同币种独立显示。历史未入账项目不在此处臆造。</div>'+
 '<div class="fin-filters">'+
 '<select id="fin-country" onchange="finRefresh()">'+finOpts(countries,'全部国家')+'</select>'+
 '<select id="fin-category" onchange="finRefresh()"><option value="">全部费用类型</option>'+
 categories.map(x=>'<option value="'+esc(x)+'">'+esc(finLabel(x))+'</option>').join('')+'</select>'+
 '<select id="fin-payee" onchange="finRefresh()"><option value="">全部付款对象</option>'+
 names.map(([key,name])=>'<option value="'+esc(key)+'">'+esc(name)+'</option>').join('')+'</select>'+
 '<select id="fin-currency" onchange="finRefresh()">'+finOpts(currencies,'全部币种')+'</select>'+
 '<button class="btn btn-secondary btn-sm" onclick="renderFinanceOverviewPage(_finOverviewData)">重置筛选</button></div>'+
 '<div id="fin-layers"></div></div>';
 el.innerHTML=h;
 finRefresh();
 finTranslateDOM(el);
}
