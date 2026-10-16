'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const R=require('../assets/rp-review-report');
function row(){
 return {id:'r1',sku_code:'BM4049',brand:'BOYA',country:'印度尼西亚',target_warehouse:'Bekasi Warehouse',
 lifecycle_status:'stable',sales_status:'慢销',risk_tags:'高库存严重',
 avg_sales_period:45,total_inventory_pool:240,available_qty:240,suggested_qty:0,
 sales_m1:0,sales_m2:0,sales_m3:90,sales_m4:90,online_target_turnover:4,offline_target_turnover:4,
 _totalC:{pool:240,taPeriod:45,ot:4,oft:4,sq:0,afterOrderTurnover:5.3}};
}
function evidence(status,referenceMonthlyDemand){
 return {status,windowDays:120,observedDays:status==='qualified'?120:3,
   observedZeroDays:2,salesRecoveryObserved:true,lastZeroDate:'2026-09-25',firstRestockObservedDate:'2026-10-01',
   referenceMonthlyDemand:referenceMonthlyDemand||null};
}
function report(e,sku='BM4049'){
 const r=row();r.sku_code=sku;
 const ev=e?{[sku+'|印度尼西亚|Bekasi Warehouse']:e}:{};
 return R.rpReviewBuildReport({rows:[r],tab:'total',filters:{},stockoutEvidence:ev,blockedFn:()=>true});
}
test('BM4049 observed historical zero then restock: never assert definite overstock',()=>{
 const res=report(evidence('stockout_observed'));
 assert.equal(res.overstock.length,0);
 assert.equal(res.stockoutReview.length,1);
 assert.equal(res.health.stockoutReviewCount,1);
 assert.equal(res.health.blockedCount,1); // no bypass of purchase block
 assert.equal(res.purchase.length,0);
 assert.match(res.actions[0].action,/系统原采购拦截不变/);
 assert.match(R.rpReviewText(res),/断货核验 BM4049/);
 assert.equal(R.rpReviewSheets(res).at(-1).name,'Stockout Review');
});
test('qualified evidence adjusts reference turnover for reporting only',()=>{
 const res=report(evidence('qualified',60));
 assert.equal(res.stockoutReview[0].referenceTurnover,4);
 assert.equal(res.stockoutReview[0].avgSales,45);
 assert.equal(res.stockoutReview[0].suggestedQty,0);
 assert.equal(res.stockoutReview[0].currentTurnover,5.3);
});
test('qualified but still above target: keep high-stock category',()=>{
 const res=report(evidence('qualified',50));
 assert.equal(res.overstock.length,1);
 assert.equal(res.stockoutReview.length,0);
 assert.equal(res.overstock[0].referenceTurnover,4.8);
});
test('no evidence and other SKUs preserve original reporting and 5 sheets',()=>{
 const bm=report(null);
 assert.equal(bm.overstock.length,1);
 assert.equal(R.rpReviewSheets(bm).length,5);
 const other=report(evidence('stockout_observed'),'BM4094');
 assert.equal(other.overstock.length,1);
});
test('invalid or missing evidence cannot clear high-stock category',()=>{
 assert.equal(report(evidence('insufficient')).overstock.length,1);
 assert.equal(report({status:'unavailable',error:'no access'}).overstock.length,1);
});

test('historical zero/restock without observed sales recovery stays high stock',()=>{
 const e=evidence('stockout_observed');
 e.salesRecoveryObserved=false;
 const res=report(e);
 assert.equal(res.overstock.length,1);
 assert.equal(res.stockoutReview.length,0);
});
test('country with multiple stock warehouses never gets reference reclassification',()=>{
 const e=evidence('qualified',60);
 e.multiWarehouse=true;
 const res=report(e);
 assert.equal(res.overstock.length,1);
 assert.equal(res.stockoutReview.length,0);
});
test('manual clearance lifecycle must not be overridden by stockout evidence',()=>{
 const r=row();r.lifecycle_status='clearance';
 const key='BM4049|印度尼西亚|Bekasi Warehouse';
 const res=R.rpReviewBuildReport({rows:[r],tab:'total',filters:{},
   stockoutEvidence:{[key]:evidence('qualified',60)},blockedFn:()=>true});
 assert.equal(res.stockoutReview.length,0);
});

test('newly restocked BM4049, no sales rebound yet: defer high-stock judgement only in report',()=>{
 const ev=evidence('stockout_observed');
 ev.salesRecoveryObserved=false;
 ev.recentMajorRestock=true;
 ev.recentRestockDate='2026-10-13';
 ev.daysSinceRecentRestock=3;
 ev.remainingWatchDays=11;
 ev.observedBeforeRestockStock=4;
 ev.observedAfterRestockStock=1615;
 const rep=report(ev);
 assert.equal(rep.stockoutReview.length,1);
 assert.equal(rep.overstock.length,0);
 assert.equal(rep.health.blockedCount,1);
 assert.equal(rep.rows[0].avgSales,45);
 assert.equal(rep.rows[0].currentTurnover,5.3);
 assert.equal(rep.rows[0].suggestedQty,0);
 assert.equal(rep.rows[0].referenceMonthlyDemand,null);
 assert.match(rep.actions[0].issue,/入库日 2026-10-13/);
 assert.match(rep.actions[0].action,/原采购建议和拦截不变/);
 const text=R.rpReviewText(rep);
 assert.match(text,/观测库存 4 → 1615/);
 const sheet=R.rpReviewSheets(rep).find(x=>x.name==='Stockout Review');
 assert.ok(sheet.headers.includes('近期大批补货入库日'));
 assert.equal(sheet.rows[0][8],'2026-10-13');
});

test('the actual code prefix RDBM4049 qualifies for new restock review, not BM4094',()=>{
 const r=row();r.sku_code='RDBM4049';
 const e=evidence('stockout_observed');e.salesRecoveryObserved=false;e.recentMajorRestock=true;
 e.recentRestockDate='2026-10-13';e.daysSinceRecentRestock=3;
 const rep=R.rpReviewBuildReport({rows:[r],tab:'total',filters:{},
   stockoutEvidence:{'RDBM4049|印度尼西亚|Bekasi Warehouse':e},blockedFn:()=>true});
 assert.equal(rep.stockoutReview.length,1);
 assert.equal(rep.overstock.length,0);
});
