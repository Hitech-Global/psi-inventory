'use strict';
// Stockout history diagnostic V1. READ ONLY, independent of forecast formulas.
// Inventory imports are point-in-time observations, never a daily continuous ledger.
const DAY = 86400000;
function validDay(value) {
  const s=String(value||'').slice(0,10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) &&
    new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s ? s : null;
}
function dayBefore(day, n) { return new Date(Date.parse(day+'T00:00:00Z')-n*DAY).toISOString().slice(0,10); }
function analyzeStockoutEvidence(input) {
  const o=input||{}, end=validDay(o.endDate);
  if(!end) throw new Error('endDate must be YYYY-MM-DD');
  const windowDays=120, start=dayBefore(end,windowDays-1);
  const snapMap=new Map(), saleMap=new Map();
  // Input sorted by date DESC, created_at DESC: first event per day wins.
  for(const r of (o.snapshots||[])) {
    const imported=validDay(r.import_date), cutoff=validDay(r.snapshot_cutoff_date);
    // Snapshot cutoff date is the actual stock-as-of day when trustworthy.
    // File import date is only a fallback, and cutoff must not exceed import date.
    const d=cutoff&&imported&&cutoff<=imported?cutoff:imported;
    const q=Number(r.available_qty);
    if(!d||d<start||d>end||!Number.isSafeInteger(q)||q<0||snapMap.has(d))continue;
    snapMap.set(d,{inventory:q,lastInboundDate:validDay(r.last_inbound_date)});
  }
  for(const r of (o.sales||[])){
    const d=validDay(r.day),q=Number(r.qty);
    if(!d||d<start||d>end||!Number.isFinite(q)||q<0)continue;
    saleMap.set(d,(saleMap.get(d)||0)+q);
  }
  const observations=[...snapMap].sort((a,b)=>a[0].localeCompare(b[0]))
    .map(([date,entry])=>({date,inventory:entry.inventory,
      lastInboundDate:entry.lastInboundDate,sales:saleMap.get(date)||0}));
  const zero=observations.filter(x=>x.inventory===0);
  const stocked=observations.filter(x=>x.inventory>0);
  const firstZero=zero.length?zero[0].date:null;
  const lastZero=zero.length?zero[zero.length-1].date:null;
  const restock=lastZero?stocked.find(x=>x.date>lastZero):null;
  const contradiction=zero.some(x=>x.sales>0);
  const countSales=(date,n)=>Array.from({length:n},(_,i)=>
    saleMap.get(dayBefore(date,-i))||0).reduce((a,b)=>a+b,0);
  const preSpan=firstZero?Math.min(14,Math.round((Date.parse(firstZero+'T00:00:00Z')-Date.parse(start+'T00:00:00Z'))/DAY)):0;
  const preQty=preSpan?countSales(dayBefore(firstZero,preSpan),preSpan):0;
  const gapDays=restock?Math.round((Date.parse(restock.date+'T00:00:00Z')-Date.parse(firstZero+'T00:00:00Z'))/DAY):0;
  const gapQty=gapDays?countSales(firstZero,gapDays):0;
  const postDays=restock?Math.min(14,Math.round((Date.parse(end+'T00:00:00Z')-Date.parse(restock.date+'T00:00:00Z'))/DAY)+1):0;
  const postQty=postDays?countSales(restock.date,postDays):0;
  // A sales rebound corroborates a possible demand constraint, not proof that
  // inventory was zero on unobserved days. Require a prior selling baseline.
  const salesRecoveryObserved=preSpan>=7 && preQty>0 && gapDays>=3 && postDays>=7
    && postQty>0 && postQty/postDays>=0.5 && postQty/postDays>2*(gapQty/gapDays);
  const coverage=observations.length/windowDays;
  const multiWarehouse=!!o.multiWarehouse;
  // Recent material restock is an OBSERVED point-in-time stock jump, not the
  // exact quantity received. Require a credible inbound date after prior low
  // stock, actual preceding zero-stock observations and a fresh large balance.
  const latest=observations.length?observations[observations.length-1]:null;
  const inboundDate=latest&&validDay(latest.lastInboundDate);
  const daysSinceInbound=inboundDate
    ?Math.round((Date.parse(end+'T00:00:00Z')-Date.parse(inboundDate+'T00:00:00Z'))/DAY):null;
  const prior=latest&&inboundDate
    ?observations.filter(x=>x.date<inboundDate).slice(-1)[0]:null;
  const increase=prior&&latest?latest.inventory-prior.inventory:null;
  const recentMajorRestock=!!(inboundDate&&prior&&latest&&lastZero
    && inboundDate>lastZero && inboundDate>prior.date
    && latest.date>=inboundDate && daysSinceInbound>=0 && daysSinceInbound<=14
    && latest.inventory>0 && increase>=100
    && latest.inventory>=Math.max(1,prior.inventory)*5
    && zero.length>=2 && !multiWarehouse && !contradiction);
  const observedSaleDays=stocked.length;
  const stockSales=stocked.reduce((s,x)=>s+x.sales,0);
  // Sample only well-covered, same-scope, non-contradictory observations.
  const eligible=zero.length>=2 && stocked.length>=21 && coverage>=0.80
    && !!restock && salesRecoveryObserved && !contradiction && !multiWarehouse;
  const referenceDemand=eligible?Math.round((stockSales/stocked.length*30)*100)/100:null;
  const daysWithSales=[...saleMap.values()].filter(q=>q>0).length;
  const status=eligible&&referenceDemand>0?'qualified'
    :zero.length&&restock?'stockout_observed'
      :zero.length?'zero_observed':'insufficient';
  return {
    status, windowStart:start, windowEnd:end, windowDays,
    observedDays:observations.length, coveragePct:Math.round(coverage*1000)/10,
    observedZeroDays:zero.length, observedPositiveDays:stocked.length,
    firstZeroDate:firstZero, lastZeroDate:lastZero,
    firstRestockObservedDate:restock?restock.date:null,
    hasZeroDaySalesConflict:contradiction, multiWarehouse,
    recentMajorRestock,
    recentRestockDate:recentMajorRestock?inboundDate:null,
    observedAfterRestockDate:recentMajorRestock?latest.date:null,
    observedBeforeRestockStock:recentMajorRestock?prior.inventory:null,
    observedAfterRestockStock:recentMajorRestock?latest.inventory:null,
    observedStockIncrease:recentMajorRestock?increase:null,
    daysSinceRecentRestock:recentMajorRestock?daysSinceInbound:null,
    remainingWatchDays:recentMajorRestock?14-daysSinceInbound:null,
    salesRecoveryObserved, beforeZeroSales14d:preQty, gapSales:gapQty, gapDays,
    afterRestockSales14d:postQty, afterRestockObservedDays:postDays,
    referenceMonthlyDemand:status==='qualified'?referenceDemand:null,
    sampledInStockSales:stockSales,
    saleDaysWithOrders:daysWithSales,
    // Evidence sample: each day is a snapshot, not a presumed time interval.
    observations, evidenceSource:'inventory_imports.snapshot_cutoff_date (fallback import_date) + sales_records.order_date',
    limitation:'库存快照仅证明记录日库存，不证明两次快照之间逐日库存；销量为国家维度。'
  };
}
module.exports={analyzeStockoutEvidence,validDay,dayBefore};
