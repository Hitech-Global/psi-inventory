'use strict';
/** Explicitly gated PG integration; rejects production DB URLs. */
const assert=require('node:assert/strict');
if(process.env.PSI_ISOLATED_PG_TEST!=='1'||process.env.DB_DRIVER!=='pg'||
   !/^postgresql:\/\/[^@]+@127\.0\.0\.1:55437\/psi_shared_fee_test$/.test(process.env.DATABASE_URL||''))
  throw Error('REFUSING: tests may run only on isolated localhost PG database');
const db=require('../db');
const express=require('express');
const {installSharedLogisticsFeeRoutes,sharedWacParts}=require('../shared-logistics-fee-server');
const suffix=Date.now().toString(36);
const ciId='ci_shared_pg_'+suffix;
const batchIds=['b1','b2','b3'].map(x=>x+'_'+suffix);
const name='CI-SHARED-PG-'+suffix;
async function main(){
  const seen=db.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('shared_logistics_fees','shared_logistics_fee_batches')").rows;
  assert.equal(seen.length,2);
  const packs=[4.47,2.76,3.07];
  db.transaction(()=>{
    db.run('INSERT INTO commercial_invoices(id,ci_no,ci_date,currency,country,goods_amount,cost_confirmed,cost_allocated,wac_confirmed) VALUES (?,?,?,?,?,?,?,?,?)',
      [ciId,name,'2026-10-13','RMB','Indonesia',10000,0,0,0]);
    batchIds.forEach((id,i)=>{
      db.run('INSERT INTO logistics_batches(id,batch_no,related_ci_id,transport_mode,freight_currency,total_freight,forwarder_id,forwarder_name) VALUES (?,?,?,?,?,?,?,?)',
        [id,'TEST-SEA-'+i+'-'+suffix,ciId,'sea','RMB',i===0?100:0,'ff-test','PG Test Forwarder']);
      const pl='pl_'+id;
      db.run('INSERT INTO packing_lists(id,pl_no,related_ci_id,logistics_batch_id,status) VALUES (?,?,?,?,?)',
        [pl,'PL-'+id,ciId,id,'confirmed']);
      db.run('INSERT INTO packing_list_items(id,pl_id,sku_code,total_qty,cbm,gross_weight) VALUES (?,?,?,?,?,?)',
        ['pli_'+id,pl,'SKU-'+id,1,packs[i],packs[i]*200]);
    });
  });
  const app=express();app.use(express.json());
  let approvals=0;
  const pass=()=>((req,res,next)=>next());
  installSharedLogisticsFeeRoutes(app,{requireApiPermission:pass,requireCIAmountView:pass(),
    asyncHandler:fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next),
    genId:db.genId,sourceExpenseCountry:()=> 'Indonesia',
    createApprovalInstance:async()=>{approvals++;return {approvalId:'pg_mock_approval'};}});
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  try{
    const endpoint='http://127.0.0.1:'+server.address().port;
    const payload={bill_no:'PG-SHARED-BILL-'+suffix,payee_name:'PG Test Forwarder',currency:'IDR',amount:100000,
      batch_ids:batchIds,remark:'isolated pg test'};
    const post=async()=>{const r=await fetch(endpoint+'/api/commercial-invoices/'+ciId+'/shared-logistics-fees',{
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});return {status:r.status,body:await r.json()};};
    const unchanged=await (await fetch(endpoint+'/api/ci-freight-summaries?ids='+ciId)).json();
    assert.equal(unchanged[ciId].has_shared,false,'legacy CI must retain original client rendering');
    const made=await post();
    assert.equal(made.status,200,JSON.stringify(made.body));
    assert.equal(approvals,1);
    assert.equal(made.body.allocations.reduce((s,a)=>s+a.amount_minor,0),10000000);
    assert.equal(db.queryOne('SELECT COUNT(*) AS n FROM payment_requests WHERE id=?',[made.body.payment_request_id]).n,1);
    assert.equal(db.queryOne('SELECT COUNT(*) AS n FROM payable_items WHERE source_type=? AND source_ci_id=?',['shared_logistics',ciId]).n,1);
    assert.equal(db.queryOne('SELECT COUNT(*) AS n FROM payment_request_items WHERE payment_request_id=?',[made.body.payment_request_id]).n,1);
    assert.equal(db.queryOne('SELECT lifecycle_status FROM payable_items WHERE source_type=? AND source_ci_id=?',['shared_logistics',ciId]).lifecycle_status,'reserved');
    assert.equal(db.queryOne('SELECT COUNT(*) AS n FROM ci_cost_items WHERE ci_id=?',[ciId]).n,0);
    const dup=await post();assert.equal(dup.status,409);
    const pending=await (await fetch(endpoint+'/api/ci-freight-summaries?ids='+ciId)).json();
    assert.equal(pending[ciId].total_rmb,null);
    const day='2026-10-13';
    db.run('INSERT INTO exchange_rates(id,from_currency,to_currency,rate,rate_date,rate_type) VALUES (?,?,?,?,?,?)',
      ['pg_fx_'+suffix,'IDR','RMB',0.00045,day,'realtime']);
    db.run('INSERT INTO payment_settlement_logs(id,payment_request_id,event_type,status,amount,local_amount,local_currency,local_rate_date,paid_date,local_rate) VALUES (?,?,?,?,?,?,?,?,?,?)',
      ['pg_settle_'+suffix,made.body.payment_request_id,'payment','applied',100000,100000,'IDR',day,day,1]);
    db.run("UPDATE payment_requests SET approval_status='approved',payment_status='paid' WHERE id=?",[made.body.payment_request_id]);
    const data=await (await fetch(endpoint+'/api/commercial-invoices/'+ciId+'/shared-logistics-fees')).json();
    assert.equal(data.fees[0].conversion.amount_minor,4500);
    assert.equal(Object.values(data.batch_totals_rmb).reduce((s,r)=>s+r.total_minor,0),14500);
    const total=await (await fetch(endpoint+'/api/ci-freight-summaries?ids='+ciId)).json();
    assert.equal(total[ciId].total_rmb,145);
    assert.equal(total[ciId].freight_ratio,1.45);
    const wac=batchIds.map(id=>sharedWacParts(id,'IDR'));
    assert(wac.every(x=>x.errors.length===0));
    assert.equal(wac.reduce((s,x)=>s+x.parts[0].amount_minor,0),10000000);
    db.run("UPDATE payment_requests SET payment_status='reversed' WHERE id=?",[made.body.payment_request_id]);
    const reversed=sharedWacParts(batchIds[0],'IDR');
    assert.equal(reversed.parts.length,0,'reversed payment must not enter WAC');
    assert(reversed.errors.some(x=>/撤销|冲销/.test(x.message)),'reversal must fail closed');
    const reversedCi=await (await fetch(endpoint+'/api/ci-freight-summaries?ids='+ciId)).json();
    assert.equal(reversedCi[ciId].total_rmb,null,'reversed settlement invalidates CI freight');
    // New no-bill-number UI contract also works on the actual PostgreSQL worker.
    const fresh={request_key:'pg-auto-forwarder-'+suffix,currency:'IDR',amount:30000,batch_ids:batchIds,payee_name:'Forged Client Payee'};
    const createFresh=async()=>{
      const resp=await fetch(endpoint+'/api/commercial-invoices/'+ciId+'/shared-logistics-fees',{
        method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(fresh)});
      return {status:resp.status,data:await resp.json()};
    };
    const f=await createFresh();
    assert.equal(f.status,200,'PG no-bill-number shared fee creation: '+JSON.stringify(f.data));
    assert.equal(db.queryOne('SELECT payee_name_snapshot FROM payment_requests WHERE id=?',[f.data.payment_request_id]).payee_name_snapshot,
      'PG Test Forwarder','server must derive forwarder, not client data');
    assert.equal(db.queryOne('SELECT bill_no FROM shared_logistics_fees WHERE id=?',[f.data.id]).bill_no,
      'SHF-'+fresh.request_key);
    assert.equal((await createFresh()).status,409,'PG idempotent retry must be blocked');
    db.run('UPDATE packing_list_items SET cbm=? WHERE pl_id=?',[9,'pl_'+batchIds[0]]);
    // The SKU/WAC calculator checks snapshots; the allocation core itself remains immutable.
    console.log('[LOCAL-PG] PASS: actual postgres transaction, 1 request, 3 shares, duplicate 409, paid FX, CI RMB 145, WAC IDR 100000');
  } finally {await new Promise(resolve=>server.close(resolve));}
}
main().then(()=>process.exit(0)).catch(e=>{console.error('[LOCAL-PG] FAIL',e.stack||e);process.exit(1)});
