'use strict';
const {test}=require('node:test');
const a=require('node:assert/strict');
process.env.DB_DRIVER='sqlite';process.env.DB_PATH=':memory:';
const db=require('../db');
const express=require('express');
const {installSharedLogisticsFeeRoutes,sharedWacParts}=require('../shared-logistics-fee-server');
test('shared IDR bill → single approval request → 3 sea batches → RMB/IDR FX with no duplicate cost',async()=>{
  db.initDatabase();
  db.run("INSERT INTO commercial_invoices(id,ci_no,ci_date,currency,country,goods_amount,cost_confirmed,wac_confirmed) VALUES (?,?,?,?,?,?,?,?)",
    ['ci_shared_1','CI-SHARED-TEST','2026-10-13','RMB','印度尼西亚',10000,0,0]);
  const entries=[['b1','SZIS0013407',4.47],['b2','SZIS0013408',2.76],['b3','SZIS0013406',3.07]];
  entries.forEach(([id,no,cbm],i)=>{
    db.run("INSERT INTO logistics_batches(id,batch_no,related_ci_id,transport_mode,freight_currency,total_freight,forwarder_id,forwarder_name) VALUES (?,?,?,?,?,?,?,?)",
      [id,no,'ci_shared_1','sea','RMB',i===0?100:0,'ff-test','丰年']);
    db.run('INSERT INTO packing_lists(id,pl_no,related_ci_id,logistics_batch_id,status) VALUES (?,?,?,?,?)',
      ['pl'+id,'PL-'+id,'ci_shared_1',id,'confirmed']);
    db.run('INSERT INTO packing_list_items(id,pl_id,sku_code,total_qty,cbm,gross_weight) VALUES (?,?,?,?,?,?)',
      ['pli'+id,'pl'+id,'SKU-'+id,1,cbm,cbm*200]);
  });
  let approvals=0;
  const app=express();app.use(express.json());
  const pass=()=>((req,res,next)=>next());
  installSharedLogisticsFeeRoutes(app,{
    requireApiPermission:pass,requireCIAmountView:pass(),
    asyncHandler:fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next),
    genId:db.genId,sourceExpenseCountry:()=> '印度尼西亚',
    createApprovalInstance:async()=>{approvals++;return {approvalId:'approved_in_mock'};}
  });
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  try{
    const url='http://127.0.0.1:'+server.address().port;
    const payload={bill_no:'BILL-20261013',payee_name:'Forwarder X',currency:'IDR',amount:100000,
      batch_ids:entries.map(b=>b[0]),remark:'合并派送到仓'};
    const post=async()=>{const r=await fetch(url+'/api/commercial-invoices/ci_shared_1/shared-logistics-fees',{
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});return {status:r.status,body:await r.json()};};
    const made=await post();
    a.equal(made.status,200,JSON.stringify(made.body));
    a.equal(made.body.allocations.length,3);
    a.equal(made.body.allocations.reduce((s,x)=>s+x.amount_minor,0),10000000);
    a.equal(approvals,1);
    a.equal(db.queryOne('SELECT COUNT(*) AS n FROM payment_requests').n,1);
    a.equal(db.queryOne('SELECT COUNT(*) AS n FROM payable_items WHERE source_type=?',[ 'shared_logistics' ]).n,1);
    a.equal(db.queryOne('SELECT COUNT(*) AS n FROM payment_request_items WHERE payment_request_id=?',[made.body.payment_request_id]).n,1);
    a.equal(db.queryOne('SELECT lifecycle_status FROM payable_items WHERE source_type=?',[ 'shared_logistics' ]).lifecycle_status,'reserved');
    a.equal(db.queryOne('SELECT COUNT(*) AS n FROM ci_cost_items').n,0);
    const dup=await post();a.equal(dup.status,409);
    a.equal(db.queryOne('SELECT COUNT(*) AS n FROM payment_requests').n,1);
    const unpaid=await (await fetch(url+'/api/commercial-invoices/ci_shared_1/shared-logistics-fees')).json();
    a.match(unpaid.fees[0].conversion.error,/尚未实际结算|尚未付款|未审批通过/);
    a.ok(unpaid.currency_options.includes('IDR'),'currency options must come from system currency master');
    const pre=await (await fetch(url+'/api/ci-freight-summaries?ids=ci_shared_1')).json();
    a.equal(pre.ci_shared_1.total_rmb,null,'unpaid IDR must not be counted as RMB');
    db.run('INSERT INTO exchange_rates (id,from_currency,to_currency,rate,rate_date,rate_type) VALUES (?,?,?,?,?,?)',
      ['rate_shared_idr_rmb','IDR','RMB',0.00045,'2026-10-13','realtime']);
    db.run("INSERT INTO payment_settlement_logs (id,payment_request_id,event_type,status,amount,original_currency,local_amount,local_currency,local_rate_date,paid_date,local_rate,rmb_rate,rmb_rate_date,rmb_rate_direction,rmb_amount) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      ['paid1',made.body.payment_request_id,'payment','applied',100000,'IDR',100000,'IDR','2026-10-13','2026-10-13',1,0.00045,'2026-10-13','direct',45]);
    db.run("UPDATE payment_requests SET approval_status='approved',payment_status='paid' WHERE id=?",[made.body.payment_request_id]);
    const paid=await (await fetch(url+'/api/commercial-invoices/ci_shared_1/shared-logistics-fees')).json();
    a.equal(Number(paid.fees[0].conversion.amount_minor),4500);
    a.equal(Object.values(paid.batch_totals_rmb).reduce((sum,x)=>sum+Number(x.total_minor||0),0),14500,
      'every batch comprehensive freight must conserve RMB 145 total');
    a.equal(paid.batch_totals_rmb.b1.total_minor>10000,true,'first batch contains original RMB freight');
    a.equal(paid.batch_totals_rmb.b2.total_minor>0,true);
    a.equal(paid.batch_totals_rmb.b3.total_minor>0,true);
    const ci=await (await fetch(url+'/api/ci-freight-summaries?ids=ci_shared_1')).json();
    a.equal(ci.ci_shared_1.total_rmb,145,'RMB100 own batch freight + RMB45 shared delivery');
    a.equal(ci.ci_shared_1.freight_ratio,1.45);
    const wac=entries.map(([id])=>sharedWacParts(id,'IDR'));
    a(wac.every(x=>x.errors.length===0));
    a.equal(wac.reduce((s,x)=>s+x.parts[0].amount_minor,0),10000000);
    const wacCny=entries.map(([id])=>sharedWacParts(id,'RMB'));
    a.equal(wacCny.reduce((s,x)=>s+x.parts[0].amount_minor,0),4500);
    // New UI sends no bill number / payee: backend derives the only canonical forwarder.
    const automatic={request_key:'forwarder-auto-20261015',payee_name:'Forged client name',
      currency:'IDR',amount:21000,batch_ids:entries.map(b=>b[0]),remark:'auto'};
    const create=async data=>{const r=await fetch(url+'/api/commercial-invoices/ci_shared_1/shared-logistics-fees',{
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});
      return {status:r.status,body:await r.json()};};
    const automaticResult=await create(automatic);
    a.equal(automaticResult.status,200,JSON.stringify(automaticResult.body));
    const newPr=db.queryOne('SELECT source_no,payee_name_snapshot FROM payment_requests WHERE id=?',[automaticResult.body.payment_request_id]);
    a.equal(newPr.payee_name_snapshot,'丰年','payment payee must be taken from authoritative selected batches');
    a.equal(newPr.source_no,'SHF-forwarder-auto-20261015','internal bill reference is generated');
    const repeat=await create(automatic);
    a.equal(repeat.status,409,'retry with same request_key cannot create another payable');
    a.equal(db.queryOne('SELECT COUNT(*) AS n FROM payment_requests').n,2);
    db.run('UPDATE logistics_batches SET forwarder_id=?,forwarder_name=? WHERE id=?',['other-ff','另一家货代','b3']);
    const mixed=await create({...automatic,request_key:'another-key-20261015'});
    a.equal(mixed.status,409,'different forwarder may not share a payment');
    a.match(mixed.body.error,/不同货代/);
    a.equal(db.queryOne('SELECT COUNT(*) AS n FROM payment_requests').n,2);
    db.run('UPDATE logistics_batches SET forwarder_id=?,forwarder_name=? WHERE id=?',['ff-test','丰年','b3']);
    db.run('UPDATE logistics_batches SET forwarder_name=? WHERE id=?',['','b2']);
    const missing=await create({...automatic,request_key:'missing-fwd-20261015'});
    a.equal(missing.status,400);
    a.match(missing.body.error,/缺少货代/);

  }finally{await new Promise(resolve=>server.close(resolve));}
});
