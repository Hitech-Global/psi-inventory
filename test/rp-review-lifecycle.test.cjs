'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const R = require('../assets/rp-review-report.js');

function row(extra={}) {
  return Object.assign({
    id:'r1',sku_code:'M724',brand:'Redragon',country:'Indonesia',target_warehouse:'Bekasi Warehouse',
    lifecycle_status:'stable',sales_status:'缺货风险',risk_tags:'',action:'优先补货',suggestion:'建议采购 35',
    sales_m1:10,sales_m2:10,sales_m3:10,sales_m4:10,
    online_suggested_qty:35,offline_suggested_qty:0,
    _totalC:{pool:5,taPeriod:10,ot:4,oft:4,sq:35,afterOrderTurnover:4},
    _channelC:{
      online:{poolAllocatedPeriod:5,avgSalesPeriod:10,targetTurn:4,suggestedQty:35,afterOrderTurnover:4,
        salesM1:10,salesM2:10,salesM3:10,salesM4:10}
    }
  },extra);
}
function build(rows,liveSkuStates={},tab='total') {
  return R.rpReviewBuildReport({rows,tab,liveSkuStates,blockedFn:r=>r.sales_status==='清仓'});
}
test('SKU newly changed to clearance overrides stale suggested purchase across report/copy/Excel',()=>{
  const source=row(), snapshot=JSON.stringify(source);
  const rep=build([source],{'M724':{sku_code:'M724',lifecycle_status:'clearance',status:'normal'}});
  assert.equal(rep.health.skuTotal,1);
  assert.equal(rep.health.purchaseCount,0);
  assert.equal(rep.health.purchaseQty,0);
  assert.equal(rep.health.clearanceCount,1);
  assert.equal(rep.health.lifecycleStaleCount,1);
  assert.equal(rep.health.blockedCount,1);
  assert.equal(rep.purchase.length,0);
  assert.equal(rep.overstock.length,0);
  assert.equal(rep.noSales.length,0);
  assert.equal(rep.clearance.length,1);
  assert.equal(rep.rows[0].category,'blocked');
  assert.equal(rep.rows[0].lifecycleStatus,'clearance');
  assert.equal(rep.rows[0].suggestedQty,35,'do not rewrite historical or manual quantities');
  assert.equal(rep.actions[0].priority,'P1');
  assert.match(rep.actions[0].action,/停止采购/);
  assert.match(rep.summary.highlights.join(' '),/清仓期/);
  assert.match(R.rpReviewText(rep),/清仓期（停止采购）：1/);
  const sheets=R.rpReviewSheets(rep);
  assert.equal(sheets.find(x=>x.name==='Purchase Suggestions').rows.length,0);
  assert.equal(sheets.find(x=>x.name==='Clearance').rows[0][6],35);
  assert.equal(JSON.stringify(source),snapshot,'report must not mutate forecasting row');
});
test('master status clearance also blocks purchase even if lifecycle unchanged',()=>{
  const rep=build([row()],{'M724':{lifecycle_status:'stable',status:'clearance'}});
  assert.equal(rep.health.clearanceCount,1);
  assert.equal(rep.purchase.length,0);
  assert.equal(rep.actions[0].priority,'P1');
});
test('stopped master data prevents P0 even with positive stale forecast',()=>{
  const rep=build([row()],{'M724':{lifecycle_status:'stopped',status:'stopped'}});
  assert.equal(rep.purchase.length,0);
  assert.equal(rep.rows[0].category,'blocked');
  assert.match(rep.actions[0].action,/停止采购/);
});
test('moved from clearance to stable is held for recalc, never promotes old P0',()=>{
  const rep=build([row({lifecycle_status:'clearance',sales_status:'清仓'})],
    {'M724':{lifecycle_status:'stable',status:'normal'}});
  assert.equal(rep.health.lifecycleStaleCount,1);
  assert.equal(rep.clearance.length,0);
  assert.equal(rep.purchase.length,0);
  assert.equal(rep.actions[0].priority,'P1');
  assert.match(rep.actions[0].action,/重新计算/);
});
test('unchanged stable SKU keeps previous purchase behavior without extra Clearance sheet',()=>{
  const rep=build([row()],{'M724':{lifecycle_status:'stable',status:'normal'}});
  assert.equal(rep.purchase.length,1);
  assert.equal(rep.health.lifecycleStaleCount,0);
  assert.equal(rep.health.clearanceCount,0);
  assert.equal(R.rpReviewSheets(rep).length,5);
});
test('clearance still blocks when no sales or turnover is high, and works for online channel',()=>{
  const r=row();
  r._totalC.taPeriod=0;
  r._totalC.pool=900;
  const rep=build([r],{'M724':{lifecycle_status:'clearance',status:'normal'}});
  assert.equal(rep.noSales.length,0);
  assert.equal(rep.overstock.length,0);
  assert.equal(rep.clearance.length,1);
  const online=build([row()],{'M724':{lifecycle_status:'clearance',status:'normal'}},'online');
  assert.equal(online.purchase.length,0);
  assert.equal(online.clearance.length,1);
});
