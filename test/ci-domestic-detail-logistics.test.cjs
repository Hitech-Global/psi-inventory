'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const app=read('app.js'),server=read('server.js'),db=read('db.js'),pg=read('db-pg.js'),sqlite=read('db-sqlite.js');

test('CI details show trade mode, a totals row, and hide domestic customs fields',()=>{
  assert.ok(app.includes('function ciClearanceLabelForCI(v,tradeMode)'));
  assert.ok(app.includes('ciClearanceLabelForCI(c.clearance_type,c.trade_mode)'));
  assert.ok(app.includes('ciClearanceLabelForCI(ci.clearance_type,ci.trade_mode)'));
  assert.ok(app.includes("f==='trade_mode'"));
  assert.ok(app.includes("isDomesticCI&&f==='import_duty_total'"));
  assert.ok(app.includes('ci-items-total-row'));
  assert.ok(app.includes("isDomestic?'':'<th>'+t('ci.item.actual_customs_rate'"));
});

test('domestic CI creation forces domestic clearance mode',()=>{
  assert.ok(server.includes("if (ciTradeMode === 'domestic') clearanceType = 'domestic'"));
  assert.ok(app.includes("clearanceEl.value='domestic';clearanceEl.disabled=true"));
  assert.ok(app.includes("clearanceType=domesticOnly?'domestic'"));
});

test('CI editor saves CI-level logistics status and actual arrival date',()=>{
  assert.ok(app.includes('CI-DOMESTIC-DETAIL-LOGISTICS-EDITOR-V1'));
  assert.ok(app.includes('id="eci-logistics-status"'));
  assert.ok(app.includes('id="eci-actual-arrival-date"'));
  assert.ok(app.includes('ci_logistics_status:logisticsStatus'));
  assert.ok(app.includes('actual_arrival_date:actualArrivalDate'));
  assert.ok(server.includes('ci_logistics_status = ?'));
  assert.ok(server.includes('actual_arrival_date = ?'));
  assert.ok(server.includes('ci.ci_logistics_status_for_edit'));
  assert.ok(!server.includes('ciDetailMaxRawStatus'));
});

test('CI logistics summary does not replace batch-level physical logistics facts',()=>{
  assert.ok(server.includes('CI 层级状态是 CI 总览的人工摘要'));
  assert.ok(server.includes('ciManualLogisticsStatus'));
  assert.ok(server.includes('logistics_batches WHERE related_ci_id = ?'));
});

test('PG, SQLite, and production sync migrations include CI logistics fields',()=>{
  for(const source of [pg,sqlite]){
    assert.ok(source.includes("ci_logistics_status TEXT DEFAULT ''"));
    assert.ok(source.includes("actual_arrival_date TEXT DEFAULT ''"));
    assert.ok(source.includes("clearance_type = 'domestic'"));
  }
  assert.ok(db.includes("ADD COLUMN IF NOT EXISTS ci_logistics_status TEXT DEFAULT ''"));
  assert.ok(db.includes("ADD COLUMN IF NOT EXISTS actual_arrival_date TEXT DEFAULT ''"));
});

test('CI editor footer actions are rebound safely after modal creation',async()=>{
  const index=read('index.html');
  const fix=read('assets/ci-edit-save-handler-fix.js');
  assert.ok(index.includes('assets/ci-edit-save-handler-fix.js?v=20261128-1'));
  assert.ok(index.lastIndexOf('app.js') < index.lastIndexOf('ci-edit-save-handler-fix.js'));
  assert.ok(fix.includes("save.removeAttribute('onclick')"));
  assert.ok(fix.includes('save.onclick = function (event)'));
  assert.ok(fix.includes("cancel.removeAttribute('onclick')"));
  assert.ok(fix.includes('global.saveCIEdit(id, backPay, backMode)'));
  new Function('window',fix);

  const calls=[];
  const cancel={removeAttribute(name){this.removed=name;},onclick:null,type:''};
  const footer={querySelector(){return cancel;}};
  const save={removeAttribute(name){this.removed=name;},closest(){return footer;},onclick:null,type:''};
  const fakeWindow={
    document:{getElementById(id){return id==='eci-save'?save:null;}},
    editCI:async function(){return 'opened';},
    saveCIEdit:function(){calls.push(['save',...arguments]);return 'saved';},
    viewCI:function(){calls.push(['cancel',...arguments]);return 'viewed';}
  };
  new Function('window',fix)(fakeWindow);
  assert.equal(await fakeWindow.editCI('ci-123','pay-1','view'),'opened');
  save.onclick({preventDefault(){},stopPropagation(){}});
  cancel.onclick({preventDefault(){},stopPropagation(){}});
  assert.deepEqual(calls,[
    ['save','ci-123','pay-1','view'],
    ['cancel','ci-123','pay-1','view']
  ]);
});

console.log('ci domestic detail/logistics: PASS');
