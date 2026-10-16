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
