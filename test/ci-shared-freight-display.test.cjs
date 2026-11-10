'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
process.env.DB_DRIVER='sqlite';
process.env.DB_PATH=':memory:';
const db=require('../db');
const express=require('express');
const {installSharedLogisticsFeeRoutes}=require('../shared-logistics-fee-server');

test('CI detail summary includes transport modes and one shared bill allocated across batches',async()=>{
  db.initDatabase();
  const ciId='ci_shared_detail_summary';
  db.run("INSERT INTO commercial_invoices(id,ci_no,ci_date,currency,country,goods_amount,cost_confirmed,cost_allocated,wac_confirmed) VALUES (?,?,?,?,?,?,?,?,?)",
    [ciId,'HIT20260912-1','2026-10-13','RMB','印度尼西亚',279517.2,0,0,0]);
  const batches=[
    {id:'batch_15359',no:'SZIS0015359',cbm:0.74},
    {id:'batch_15360',no:'SZIS0015360',cbm:4.06},
    {id:'batch_15358',no:'SZIS0015358',cbm:5.07}
  ];
  batches.forEach((b)=>{
    db.run("INSERT INTO logistics_batches(id,batch_no,related_ci_id,transport_mode,freight_currency,total_freight,forwarder_id,forwarder_name) VALUES (?,?,?,?,?,?,?,?)",
      [b.id,b.no,ciId,'sea','RMB',0,'ff-test','丰年']);
    db.run('INSERT INTO packing_lists(id,pl_no,related_ci_id,logistics_batch_id,status) VALUES (?,?,?,?,?)',
      ['pl_'+b.id,'PL-'+b.no,ciId,b.id,'confirmed']);
    db.run('INSERT INTO packing_list_items(id,pl_id,sku_code,total_qty,cbm,gross_weight) VALUES (?,?,?,?,?,?)',
      ['pli_'+b.id,'pl_'+b.id,'SKU-'+b.no,1,b.cbm,b.cbm*200]);
  });

  const app=express();app.use(express.json());
  const pass=()=>((req,res,next)=>next());
  installSharedLogisticsFeeRoutes(app,{
    requireApiPermission:pass,requireCIAmountView:pass(),
    asyncHandler:fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next),
    genId:db.genId,sourceExpenseCountry:()=> '印度尼西亚',
    createApprovalInstance:async()=>({approvalId:'approval-test'})
  });
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  try{
    const base='http://127.0.0.1:'+server.address().port;
    const created=await fetch(base+'/api/commercial-invoices/'+ciId+'/shared-logistics-fees',{
      method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({request_key:'ci-shared-summary-test-20261110',currency:'RMB',amount:11307.10,
        batch_ids:['batch_15359','batch_15360'],remark:'one combined freight bill'})
    });
    const createBody=await created.json();
    assert.equal(created.status,200,JSON.stringify(createBody));

    const detail=await (await fetch(base+'/api/commercial-invoices/'+ciId+'/shared-logistics-fees')).json();
    assert.deepEqual(detail.transport_modes,['sea']);
    assert.equal(detail.total_freight_currency,'RMB');
    assert.equal(detail.total_freight_rmb,11307.10);
    assert.equal(detail.batch_totals_rmb.batch_15359.batch_no,'SZIS0015359');
    assert.equal(detail.batch_totals_rmb.batch_15360.batch_no,'SZIS0015360');
    assert.equal(detail.batch_totals_rmb.batch_15358.total_minor,0);
    assert.equal(detail.batch_totals_rmb.batch_15359.total_minor+
      detail.batch_totals_rmb.batch_15360.total_minor,1130710);
    assert.equal(detail.batch_totals_rmb.batch_15359.transport_mode,'sea');

    const list=await (await fetch(base+'/api/ci-freight-summaries?ids='+ciId)).json();
    assert.equal(list[ciId].has_shared,true);
    assert.equal(list[ciId].total_rmb,11307.10);
    assert.equal(list[ciId].freight_ratio,4.05);
  }finally{
    await new Promise(resolve=>server.close(resolve));
  }
});

test('CI freight display assets expose the combined-fee values and distinguish CI paid amount',()=>{
  const fs=require('node:fs'),path=require('node:path');
  const root=path.join(__dirname,'..');
  const detail=fs.readFileSync(path.join(root,'assets/ci-shared-freight-display.js'),'utf8');
  const list=fs.readFileSync(path.join(root,'assets/ci-list-freight.js'),'utf8');
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  assert.match(detail,/transport_modes/);
  assert.match(detail,/total_freight_rmb/);
  assert.match(detail,/batch_totals_rmb/);
  assert.match(detail,/data-ci-shared-freight-summary/);
  assert.match(detail,/ci-acc-body-logi/);
  assert.match(list,/CI已付金额/);
  assert.match(list,/CI Paid Amount/);
  assert.match(html,/ci-list-freight\.js\?v=20261110-2/);
  assert.match(html,/ci-shared-freight-display\.js\?v=20261110-1/);
});
