'use strict';
// FIN-OVERVIEW V1: presentation-only aggregation over the authoritative payable
// ledger and payment settlement breakdown. All monetary arithmetic in minor units.
// Never sum PO + PI + CI, and never treat deductions or rounding as cash paid.
const VALID_LIFECYCLES=new Set(['active','reserved','partially_paid','paid']);
const OPEN_LIFECYCLES=new Set(['active','reserved','partially_paid']);
const validDate=d=>/^\d{4}-\d{2}-\d{2}$/.test(String(d||''));
const plusDays=(day,n)=>new Date(Date.parse(day+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
function emptyTotals(){return {count:0,gross:0,cash_paid:0,deductions:0,rounding:0,settled:0,
  outstanding:0,overdue:0,due_today:0,due_7:0,due_30:0,
  due_ever:0,no_due:0,unreconciled:0};}
function add(t,r){
 t.count++;
 for(const key of ['gross','cash_paid','deductions','rounding','settled','outstanding','overdue',
  'due_today','due_7','due_30','due_ever','no_due','unreconciled'])t[key]+=r[key]||0;
}
function normalizeMoney(minor){return Math.round(minor)/100;}
function createFinancePaymentOverview({rows=[],breakdownMap=new Map(),purchases=[],today,sourceCountries={}}={}){
 if(!validDate(today))throw Error('today required');
 const d7=plusDays(today,7),d30=plusDays(today,30);
 const metrics={},payees={},categories={},details=[],issues=[];
 const getBucket=(map,key,initial)=>map[key]||(map[key]=Object.assign(initial,{totals:emptyTotals()}));
 for(const p of rows){
   if(!VALID_LIFECYCLES.has(p.lifecycle_status))continue;
   const gross=Number(p.payable_amount_minor||0), b=breakdownMap.get(p.id)||{};
   const cash=Number(b.paidMinor||0),ded=Number(b.deductionMinor||0),rnd=Number(b.roundingMinor||0);
   const identityRemaining=gross-cash-ded-rnd,rem=Math.max(0,identityRemaining);
   if(![gross,cash,ded,rnd].every(Number.isSafeInteger)||gross<0||cash<0||ded<0||rnd<0){
     issues.push({id:p.id,kind:'invalid_settlement'});continue;
   }
   if(identityRemaining<0)issues.push({id:p.id,kind:'over_settled',excess:normalizeMoney(-identityRemaining)});
   if(p.lifecycle_status==='paid'&&rem>0)issues.push({id:p.id,kind:'paid_without_facts',remaining:normalizeMoney(rem)});
   const currency=String(p.currency||'').trim()||'UNSPECIFIED';
   const key=String(p.payee_key||'').trim()||'unknown:'+String(p.payee_type||'')+':'+String(p.payee_name_snapshot||'');
   const due=validDate(p.payable_date)?String(p.payable_date):'';
   const open=OPEN_LIFECYCLES.has(p.lifecycle_status)||rem>0;
   // Settlements are determined by facts, not lifecycle labels; paid records are included.
   const dateDue=!!due&&due<=today;
   const entry={
     id:p.id,fee_no:p.fee_no||'',source_type:p.source_type||'',source_no:p.source_no||'',
     source_id:p.source_id||'',source_ci_id:p.source_ci_id||'',
     category:p.category_code||'other',subcategory:p.subcategory_code||'',
     payee_key:key,payee_name:p.payee_name_snapshot||key,payee_type:p.payee_type||'other',
     currency,lifecycle_status:p.lifecycle_status,country:sourceCountries[p.source_ci_id]||
      sourceCountries[p.source_type+':'+p.source_id]||sourceCountries[p.source_type+':'+p.source_no]||'',
     due_date:due,
     gross:normalizeMoney(gross),cash_paid:normalizeMoney(cash),
     deductions:normalizeMoney(ded),rounding:normalizeMoney(rnd),
     settled:normalizeMoney(cash+ded+rnd),outstanding:normalizeMoney(rem),
     overdue:open&&due&&due<today?normalizeMoney(rem):0,
     due_today:open&&due===today?normalizeMoney(rem):0,
     due_7:open&&due>today&&due<=d7?normalizeMoney(rem):0,
     due_30:open&&due>today&&due<=d30?normalizeMoney(rem):0,
     due_ever:dateDue?normalizeMoney(gross):0,
     no_due:open&&!due?normalizeMoney(rem):0,
     unreconciled:identityRemaining<0?normalizeMoney(-identityRemaining):0
   };
   details.push(entry);
   add(getBucket(metrics,currency,{currency}).totals,entry);
   add(getBucket(payees,key+'|'+currency,{
     payee_key:key,payee_name:entry.payee_name,payee_type:entry.payee_type,currency
   }).totals,entry);
   add(getBucket(categories,entry.category+'|'+currency,{
     category:entry.category,currency
   }).totals,entry);
 }
 const purchaseMap={};
 for(const p of purchases){
   if(['cancelled','rejected','void'].includes(String(p.pi_status||'').toLowerCase()))continue;
   const cur=String(p.currency||'').trim()||'UNSPECIFIED';
   const key=p.supplier_id?'supplier:'+p.supplier_id:'unknown:supplier:'+String(p.supplier_name||'');
   const total=Number(p.total_amount||0);
   if(!Number.isFinite(total)||total<0){issues.push({id:p.id,kind:'invalid_pi_amount'});continue;}
   const group=getBucket(purchaseMap,key+'|'+cur,{
     payee_key:key,payee_name:p.supplier_name||key,currency:cur
   });
   group.totals.gross+=total;
   group.totals.count++;
 }
 const sortOutstanding=(a,b)=>b.totals.outstanding-a.totals.outstanding||a.payee_name.localeCompare(b.payee_name);
 const summary=Object.values(metrics).sort((a,b)=>a.currency.localeCompare(b.currency));
 const byPayee=Object.values(payees).sort(sortOutstanding).map(v=>({
   ...v,pi_purchase_amount:(purchaseMap[v.payee_key+'|'+v.currency]||{totals:{gross:0}}).totals.gross
 }));
 // Include PI suppliers who do not yet have an issued payable item.
 for(const p of Object.values(purchaseMap))if(!byPayee.some(x=>x.payee_key===p.payee_key&&x.currency===p.currency))
   byPayee.push({...p,totals:emptyTotals(),pi_purchase_amount:p.totals.gross,payee_type:'factory'});
 const out={
   today,summary,by_payee:byPayee,by_category:Object.values(categories).sort((a,b)=>b.totals.outstanding-a.totals.outstanding),
   details:details.sort((a,b)=>b.overdue-a.overdue||b.outstanding-a.outstanding),
   purchases:Object.values(purchaseMap),purchase_records:purchases,issues,
   notes:{
     basis:'All non-cancelled payable_items. Payment settlement from payableItemsSettlementBreakdown SSOT.',
     purchase:'PI recorded value shown independently; not added to payable total; PO totals are currently zero and historical CI may be outside PI coverage.',
     date:'Overdue: due_date < today and remaining > 0. Due today separate. Due 7/30 are inclusive future windows.',
     currency:'No cross-currency addition. No FX conversion.',
     cash:'Cash paid excludes applied deduction and rounding; negative/refunded facts follow settlement SSOT.',
     history:'History limited to existing payable_items and recorded PI. Missing historical settlements cannot be invented.'
   }
 };
 return out;
}
module.exports={createFinancePaymentOverview};
