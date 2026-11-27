'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const app=read('app.js'),server=read('server.js'),db=read('db.js'),pg=read('db-pg.js'),sqlite=read('db-sqlite.js');

test('CI details show trade mode, a totals row, and hide domestic customs fields',()=>{
  assert.match(app,/function ciClearanceLabel\(v,tradeMode\)/);
  assert.match(app,/ciClearanceLabel\(c\.clearance_type,c\.trade_mode\)/);
  assert.match(app,/ciClearanceLabel\(ci\.clearance_type,ci\.trade_mode\)/);
  assert.match(app,/f==='trade_mode'/);
  assert.match(app,/isDomesticCI&&f==='import_duty_total'/);
  assert.match(app,/function renderCIItemsRows\(ci\)[\s\S]*?ci-items-total-row/);
  assert.match(app,/isDomestic\?'':'<th>'\+t\('ci\.item\.actual_customs_rate'/);
});

test('domestic CI creation forces domestic clearance mode',()=>{
  assert.match(server,/if \(ciTradeMode === 'domestic'\) clearanceType = 'domestic'/);
  assert.match(app,/clearanceEl\.value='domestic';clearanceEl\.disabled=true/);
  assert.match(app,/clearanceType=domesticOnly\?'domestic'/);
});

test('CI editor saves CI-level logistics status and actual arrival date',()=>{
  assert.match(app,/CI-DOMESTIC-DETAIL-LOGISTICS-EDITOR-V1/);
  assert.match(app,/id="eci-logistics-status"/);
  assert.match(app,/id="eci-actual-arrival-date"/);
  assert.match(app,/ci_logistics_status:logisticsStatus/);
  assert.match(app,/actual_arrival_date:actualArrivalDate/);
  assert.match(server,/ci_logistics_status = \?/);
  assert.match(server,/actual_arrival_date = \?/);
  assert.match(server,/ci\.ci_logistics_status_for_edit/);
});

test('CI logistics summary does not replace batch-level physical logistics facts',()=>{
  assert.match(server,/CI 层级状态是 CI 总览的人工摘要/);
  assert.match(server,/ciManualLogisticsStatus/);
  assert.match(server,/logistics_batches WHERE related_ci_id = \?/);
});

test('PG, SQLite, and production sync migrations include CI logistics fields',()=>{
  for(const source of [pg,sqlite]){
    assert.match(source,/ci_logistics_status TEXT DEFAULT ''/);
    assert.match(source,/actual_arrival_date TEXT DEFAULT ''/);
    assert.match(source,/clearance_type = 'domestic'/);
  }
  assert.match(db,/ADD COLUMN IF NOT EXISTS ci_logistics_status TEXT DEFAULT ''/);
  assert.match(db,/ADD COLUMN IF NOT EXISTS actual_arrival_date TEXT DEFAULT ''/);
});
console.log('ci domestic detail/logistics: PASS');
