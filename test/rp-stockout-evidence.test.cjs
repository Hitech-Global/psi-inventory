'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {analyzeStockoutEvidence,dayBefore}=require('../assets/rp-stockout-evidence');
const end='2026-10-16';
const ds=Array.from({length:120},(_,i)=>dayBefore(end,119-i));
const fixture=()=>({
  endDate:end,
  // 30 stocked, 30 out, 60 stocked again. Complete point-in-time observations.
  snapshots:ds.map((d,i)=>({import_date:d,available_qty:i>=30&&i<60?0:120})).reverse(),
  sales:ds.map((d,i)=>({day:d,qty:i>=30&&i<60?0:2}))
});
test('complete daily history: zero stock then restock; estimate from observed stocked days only',()=>{
  const out=analyzeStockoutEvidence(fixture());
  assert.equal(out.status,'qualified');
  assert.equal(out.observedDays,120);
  assert.equal(out.observedZeroDays,30);
  assert.equal(out.referenceMonthlyDemand,60);
  assert.equal(out.firstRestockObservedDate,ds[60]);
  assert.equal(out.salesRecoveryObserved,true);
  assert.equal(out.sampledInStockSales,180);
});
test('sparse imports: never extrapolate stockout interval or demand',()=>{
  const f=fixture();
  f.snapshots=[{import_date:ds[35],available_qty:0},
               {import_date:ds[45],available_qty:0},
               {import_date:ds[60],available_qty:100}];
  const out=analyzeStockoutEvidence(f);
  assert.equal(out.status,'stockout_observed');
  assert.equal(out.observedZeroDays,2);
  assert.equal(out.observedDays,3);
  assert.equal(out.referenceMonthlyDemand,null);
});
test('zero quantity snapshot with same-day orders blocks quantitative adjustment',()=>{
  const f=fixture();f.sales.push({day:ds[34],qty:1});
  const out=analyzeStockoutEvidence(f);
  assert.equal(out.status,'stockout_observed');
  assert.equal(out.hasZeroDaySalesConflict,true);
});
test('multiple warehouse coverage makes country-wide sales incomparable',()=>{
  const out=analyzeStockoutEvidence({...fixture(),multiWarehouse:true});
  assert.equal(out.referenceMonthlyDemand,null);
  assert.equal(out.multiWarehouse,true);
});
test('duplicate snapshot day chooses latest supplied record only',()=>{
  const f=fixture();
  f.snapshots.unshift({import_date:ds[30],available_qty:5});
  assert.equal(analyzeStockoutEvidence(f).observedZeroDays,29);
  assert.equal(analyzeStockoutEvidence(f).observedDays,120);
});
test('never infer missing zero stock from a zero-sales day',()=>{
  const f=fixture();f.snapshots=f.snapshots.filter(x=>Number(x.available_qty)>0);
  const out=analyzeStockoutEvidence(f);
  assert.equal(out.observedZeroDays,0);
  assert.equal(out.referenceMonthlyDemand,null);
});
test('restock without enough positive-day sample remains diagnostic only',()=>{
  const f=fixture();f.snapshots=f.snapshots.filter(x=>Number(x.available_qty)===0 || x.import_date===ds[60]);
  const out=analyzeStockoutEvidence(f);
  assert.equal(out.status,'stockout_observed');
  assert.equal(out.referenceMonthlyDemand,null);
});
test('invalid dates and future observations never enter the reference period',()=>{
  const f=fixture();f.snapshots.push({import_date:'2026-02-30',available_qty:0},{import_date:'2026-11-02',available_qty:0});
  const out=analyzeStockoutEvidence(f);
  assert.equal(out.observedDays,120);
  assert.equal(out.observedZeroDays,30);
});

// Regression: factual RDBM4049-like sparse snapshots; NOT a daily stock ledger.
function bm4049Snapshots(){
 const events=[
  ['2026-07-05',344],['2026-07-31',60],['2026-08-12',0],
  ['2026-08-15',0],['2026-08-23',0],['2026-08-27',49],
  ['2026-08-31',41],['2026-09-03',18],['2026-09-09',0],
  ['2026-09-10',0],['2026-09-13',0],['2026-09-20',0],
  ['2026-10-08',4],['2026-10-15',1615]
 ];
 return events.reverse().map(([import_date,available_qty])=>({
  import_date,available_qty,
  last_inbound_date:import_date==='2026-10-15'?'2026-10-13':''
 }));
}
test('BM4049: 14 snapshots, 7 observed zero days, recent major restock without invented demand',()=>{
 const ev=analyzeStockoutEvidence({
  endDate:'2026-10-16',snapshots:bm4049Snapshots(),
  sales:[{day:'2026-08-01',qty:69},{day:'2026-09-01',qty:49},{day:'2026-10-15',qty:6}]
 });
 assert.equal(ev.status,'stockout_observed');
 assert.equal(ev.observedDays,14);
 assert.equal(ev.observedZeroDays,7);
 assert.equal(ev.referenceMonthlyDemand,null);
 assert.equal(ev.salesRecoveryObserved,false);
 assert.equal(ev.recentMajorRestock,true);
 assert.equal(ev.recentRestockDate,'2026-10-13');
 assert.equal(ev.daysSinceRecentRestock,3);
 assert.equal(ev.remainingWatchDays,11);
 assert.equal(ev.observedBeforeRestockStock,4);
 assert.equal(ev.observedAfterRestockStock,1615);
 assert.equal(ev.observedStockIncrease,1611);
});
test('no recent inbound date: do not falsely mark restock window',()=>{
 const rows=bm4049Snapshots();delete rows[0].last_inbound_date;
 assert.equal(analyzeStockoutEvidence({endDate:'2026-10-16',snapshots:rows}).recentMajorRestock,false);
});
test('restock grace expires after 14 days',()=>{
 const ev=analyzeStockoutEvidence({endDate:'2026-10-28',snapshots:bm4049Snapshots()});
 assert.equal(ev.recentMajorRestock,false);
 assert.equal(ev.referenceMonthlyDemand,null);
});
test('other warehouse stock prevents unilateral country-wide restock watch',()=>{
 const ev=analyzeStockoutEvidence({endDate:'2026-10-16',snapshots:bm4049Snapshots(),multiWarehouse:true});
 assert.equal(ev.recentMajorRestock,false);
});
test('same-day zero-stock sales contradiction prevents restock watch',()=>{
 const ev=analyzeStockoutEvidence({endDate:'2026-10-16',snapshots:bm4049Snapshots(),sales:[{day:'2026-09-20',qty:1}]});
 assert.equal(ev.recentMajorRestock,false);
});
test('material inbound must be observable, not merely a recent date',()=>{
 const rows=bm4049Snapshots();rows[0].available_qty=15;
 assert.equal(analyzeStockoutEvidence({endDate:'2026-10-16',snapshots:rows}).recentMajorRestock,false);
});

test('prefer snapshot_cutoff_date as actual stock-as-of day (import may be next day)',()=>{
 const rows=bm4049Snapshots();
 rows[0].snapshot_cutoff_date='2026-10-14';
 rows[1].snapshot_cutoff_date='2026-10-07';
 const ev=analyzeStockoutEvidence({endDate:'2026-10-16',snapshots:rows});
 assert.equal(ev.recentMajorRestock,true);
 assert.equal(ev.observedAfterRestockDate,'2026-10-14');
 assert.equal(ev.observations.at(-1).date,'2026-10-14');
});
