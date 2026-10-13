'use strict';
const assert=require('node:assert/strict'),crypto=require('node:crypto'),http=require('node:http');
if(process.env.PSI_ISOLATED_PG_TEST!=='1'||process.env.DB_DRIVER!=='pg'||
  !/^postgresql:\/\/[^@]+@127\.0\.0\.1:55437\/psi_shared_fee_test$/.test(process.env.DATABASE_URL||''))
 throw Error('REFUSING non-isolated PG database');
const db=require('../db'),{app}=require('../server');
const uniq=Date.now().toString(36);
const ci='sh_ap_ci_'+uniq,role='sh_ap_role_'+uniq,approver='sh_ap_user_'+uniq;
const day='2026-10-13';
function session(id){
 const token=crypto.randomBytes(32).toString('hex');
 db.run('INSERT INTO sessions(id,token_hash,user_id,created_at,expires_at,user_agent,ip_address) VALUES (?,?,?,?,?,?,?)',
  ['sh_sess_'+crypto.randomBytes(7).toString('hex'),crypto.createHash('sha256').update(token).digest('hex'),id,new Date().toISOString(),new Date(Date.now()+3600000).toISOString().replace('T',' ').replace(/\.\d+Z$/,''),'','']);
 return 'session_token='+token;
}
async function request(port,route,body,cookie){
 const r=await fetch('http://127.0.0.1:'+port+route,{method:'POST',headers:{'content-type':'application/json','cookie':cookie},body:JSON.stringify(body)});
 const data=await r.json();return {status:r.status,data};
}
async function main(){
 const existing=db.query("SELECT id FROM approval_flows WHERE business_type='payment' AND is_enabled=1").rows;
 if(existing.length){
  if(!existing.every(row=>/^sh_flow_/.test(row.id)))throw Error('Unknown active approval flow: refusing overwrite');
  existing.forEach(row=>db.run('UPDATE approval_flows SET is_enabled=0 WHERE id=?',[row.id]));
 }
 const admin=db.queryOne("SELECT id,role_id,status FROM users WHERE id='user_admin'");
 assert(admin&&admin.status==='active');
 db.transaction(()=>{
  db.run('INSERT INTO roles(id,name,permissions,is_system) VALUES (?,?,?,?)',[role,'Test approval '+uniq,JSON.stringify(['payment_approve','payment_execute']),0]);
  db.run("INSERT INTO users(id,username,name,password,role_id,status,auth_source,password_hash) VALUES (?,?,?,?,?,?,?,?)",
    [approver,'sh_approver_'+uniq,'Local PG Approver','',''+role,'active','local','']);
  db.run('INSERT INTO approval_flows(id,name,business_type,levels,is_enabled) VALUES (?,?,?,?,?)',
    ['sh_flow_'+uniq,'Local payment approval','payment',JSON.stringify([{level:1,approver_user_id:approver,cc_user_ids:[]}]),1]);
  db.run('INSERT INTO commercial_invoices(id,ci_no,ci_date,currency,country,goods_amount,cost_confirmed,cost_allocated,wac_confirmed) VALUES (?,?,?,?,?,?,?,?,?)',
    [ci,'CI-SH-APP-'+uniq,day,'RMB','印度尼西亚',10000,0,0,0]);
  for(let i=0;i<2;i++){
   const batch='sh_batch_'+i+'_'+uniq,pl='sh_pl_'+i+'_'+uniq;
   db.run('INSERT INTO logistics_batches(id,batch_no,related_ci_id,transport_mode,freight_currency,total_freight) VALUES (?,?,?,?,?,?)',
     [batch,'SHIP-TEST-'+i+'-'+uniq,ci,'sea','RMB',0]);
   db.run('INSERT INTO packing_lists(id,pl_no,related_ci_id,logistics_batch_id,status) VALUES (?,?,?,?,?)',
     [pl,'PL-TEST-'+i+'-'+uniq,ci,batch,'confirmed']);
   db.run('INSERT INTO packing_list_items(id,pl_id,sku_code,total_qty,cbm,gross_weight) VALUES (?,?,?,?,?,?)',
     ['sh_pli_'+i+'_'+uniq,pl,'SHSKU-'+i+'-'+uniq,1,i+2,(i+2)*200]);
  }
  db.run('INSERT INTO exchange_rates(id,from_currency,to_currency,rate,rate_date,rate_type) VALUES (?,?,?,?,?,?)',
   ['sh_ap_fx_'+uniq,'IDR','RMB',0.00045,day,'realtime']);
 });
 db.transaction(()=>{
  db.run('INSERT INTO roles(id,name,permissions,is_system) VALUES (?,?,?,?)',
    ['sh_no_amount_role_'+uniq,'Test no amount '+uniq,JSON.stringify(['ci_view','ci_edit','payment_create','logistics_view']),0]);
  db.run("INSERT INTO users(id,username,name,password,role_id,status,auth_source,password_hash) VALUES (?,?,?,?,?,?,?,?)",
    ['sh_no_amount_user_'+uniq,'no_amount_'+uniq,'No Amount','','sh_no_amount_role_'+uniq,'active','local','']);
 });
 const noAmountCookie=session('sh_no_amount_user_'+uniq);
 const adminCookie=session('user_admin'),approverCookie=session(approver);
 const server=await new Promise(resolve=>{const x=http.createServer(app);x.listen(0,'127.0.0.1',()=>resolve(x));});
 try{
  const port=server.address().port,batchIds=[0,1].map(i=>'sh_batch_'+i+'_'+uniq);
  const noAmountPost=await request(port,'/api/commercial-invoices/'+ci+'/shared-logistics-fees',
    {bill_no:'NO-AMOUNT-'+uniq,payee_name:'Test',currency:'IDR',amount:100,batch_ids:batchIds},noAmountCookie);
  assert.equal(noAmountPost.status,403,'no CI amount permission must not create shared charge');
  const noAmountGET=await fetch('http://127.0.0.1:'+port+'/api/commercial-invoices/'+ci+'/shared-logistics-fees',{headers:{cookie:noAmountCookie}});
  assert.equal(noAmountGET.status,403,'no CI amount permission must not view shared charge');
  const noAmountSum=await fetch('http://127.0.0.1:'+port+'/api/ci-freight-summaries?ids='+ci,{headers:{cookie:noAmountCookie}});
  assert.equal(noAmountSum.status,403,'no CI amount permission must not read freight summaries');
  const created=await request(port,'/api/commercial-invoices/'+ci+'/shared-logistics-fees',
    {bill_no:'BILL-APP-'+uniq,payee_name:'Local PG Forwarder',currency:'IDR',amount:100000,batch_ids:batchIds},adminCookie);
  assert.equal(created.status,200,'create failed: '+JSON.stringify(created.data));
  assert.equal(created.data.auto_submitted,true,'real createApprovalInstance must have submitted');
  const pid=created.data.payment_request_id;
  assert.equal(db.queryOne("SELECT COUNT(*) n FROM approval_records WHERE business_id=? AND business_type='payment'",[pid]).n,1);
  const approved=await request(port,'/api/payment-requests/'+pid+'/approve',
    {action:'approve',remark:'local pg acceptance',actual_paid_amount:100000,actual_paid_date:day,attachment:'local-test-voucher.pdf'},approverCookie);
  assert.equal(approved.status,200,'approval+settlement failed: '+JSON.stringify(approved.data));
  const p=db.queryOne('SELECT approval_status,payment_status FROM payment_requests WHERE id=?',[pid]);
  assert.equal(p.approval_status,'approved');
  const pay=db.queryOne("SELECT lifecycle_status FROM payable_items WHERE source_type='shared_logistics' AND source_ci_id=?",[ci]);
  assert.equal(pay.lifecycle_status,'paid');
  const logs=db.queryOne("SELECT COUNT(*) n FROM payment_settlement_logs WHERE payment_request_id=? AND event_type='payment' AND status='applied'",[pid]);
  assert.equal(logs.n,1,'settlement log exactly once');
  const alloc=db.queryOne("SELECT COUNT(*) n FROM payment_allocations pa JOIN payment_transactions pt ON pt.id=pa.transaction_id WHERE pt.payment_request_id=?",[pid]);
  assert.equal(alloc.n,1,'one reconciliation allocation for one payable');
  // Extra real PG cases: partial payment, second settlement, reversal, rejection.
  function seedScenario(tag){
    const secondCI='sh_'+tag+'_ci_'+uniq;
    const ids=[0,1].map(i=>'sh_'+tag+'_batch_'+i+'_'+uniq);
    db.transaction(()=>{
      db.run('INSERT INTO commercial_invoices(id,ci_no,ci_date,currency,country,goods_amount,cost_confirmed,cost_allocated,wac_confirmed) VALUES (?,?,?,?,?,?,?,?,?)',
        [secondCI,'CI-'+tag+'-'+uniq,day,'RMB','印度尼西亚',10000,0,0,0]);
      ids.forEach((batch,i)=>{
        const pl='sh_'+tag+'_pl_'+i+'_'+uniq;
        db.run('INSERT INTO logistics_batches(id,batch_no,related_ci_id,transport_mode,freight_currency,total_freight) VALUES (?,?,?,?,?,?)',
          [batch,'SHIP-'+tag+'-'+i+'-'+uniq,secondCI,'sea','RMB',0]);
        db.run('INSERT INTO packing_lists(id,pl_no,related_ci_id,logistics_batch_id,status) VALUES (?,?,?,?,?)',
          [pl,'PL-'+tag+'-'+i+'-'+uniq,secondCI,batch,'confirmed']);
        db.run('INSERT INTO packing_list_items(id,pl_id,sku_code,total_qty,cbm,gross_weight) VALUES (?,?,?,?,?,?)',
          ['sh_'+tag+'_pli_'+i+'_'+uniq,pl,'SH-'+tag+'-'+i+'-'+uniq,1,i+2,(i+2)*200]);
      });
    });
    return {ci:secondCI,ids};
  }
  async function createScenario(tag){
    const c=seedScenario(tag);
    const result=await request(port,'/api/commercial-invoices/'+c.ci+'/shared-logistics-fees',
      {bill_no:'BILL-'+tag+'-'+uniq,payee_name:'Local PG Forwarder',currency:'IDR',amount:100000,batch_ids:c.ids},adminCookie);
    assert.equal(result.status,200,'create '+tag+': '+JSON.stringify(result.data));
    assert.equal(result.data.auto_submitted,true);
    return {ci:c.ci,pid:result.data.payment_request_id,batches:c.ids};
  }
  const part=await createScenario('partial');
  const partApproved=await request(port,'/api/payment-requests/'+part.pid+'/approve',
    {action:'approve',remark:'partial test',actual_paid_amount:40000,actual_paid_date:day,attachment:'local-partial-voucher.pdf'},approverCookie);
  assert.equal(partApproved.status,200,'partial approval: '+JSON.stringify(partApproved.data));
  let current=db.queryOne('SELECT approval_status,payment_status FROM payment_requests WHERE id=?',[part.pid]);
  assert.equal(current.approval_status,'approved');
  assert.match(current.payment_status,/partial/);
  assert.equal(db.queryOne("SELECT lifecycle_status FROM payable_items WHERE source_ci_id=? AND source_type='shared_logistics'",[part.ci]).lifecycle_status,'partially_paid');
  const {sharedWacParts}=require('../shared-logistics-fee-server');
  assert(sharedWacParts(part.batches[0],'IDR').errors.length>0,'partial payment must not capitalize full bill');
  const completed=await request(port,'/api/payment-requests/'+part.pid+'/approve',
    {action:'confirm-paid',paid_amount:60000,paid_date:day,payment_voucher:'local-remainder-voucher.pdf',
     idempotency_key:'shared-pg-remain-'+uniq},approverCookie);
  assert.equal(completed.status,200,'complete remainder: '+JSON.stringify(completed.data));
  assert.equal(db.queryOne("SELECT lifecycle_status FROM payable_items WHERE source_ci_id=? AND source_type='shared_logistics'",[part.ci]).lifecycle_status,'paid');
  assert.equal(db.queryOne("SELECT COUNT(*) AS n FROM payment_settlement_logs WHERE payment_request_id=? AND event_type='payment' AND status='applied'",[part.pid]).n,2);
  assert.equal(part.batches.reduce((sum,b)=>sum+sharedWacParts(b,'IDR').parts.reduce((s,x)=>s+x.amount_minor,0),0),10000000);
  const firstLog=db.queryOne("SELECT id FROM payment_settlement_logs WHERE payment_request_id=? AND event_type='payment' AND status='applied' ORDER BY amount LIMIT 1",[part.pid]);
  const reversed=await request(port,'/api/payment-requests/'+part.pid+'/reverse-payment',
    {settlement_log_id:firstLog.id,reason:'isolated test reversal'},approverCookie);
  // Existing PAY-CORE protects reconciled bank transactions: raw reverse-payment is
  // forbidden until a separate accounting reversal workflow handles the bank line.
  assert.equal(reversed.status,409,'linked bank transaction must reject direct reverse-payment');
  assert.match(reversed.data.error,/已关联银行流水/);
  assert.equal(db.queryOne("SELECT COUNT(*) AS n FROM payment_settlement_logs WHERE payment_request_id=? AND event_type='payment' AND status='applied'",[part.pid]).n,2,'rejected reversal must leave accounting unchanged');
  assert.equal(part.batches.reduce((sum,b)=>sum+sharedWacParts(b,'IDR').parts.reduce((s,x)=>s+x.amount_minor,0),0),10000000);
  const rejected=await createScenario('reject');
  const rejection=await request(port,'/api/payment-requests/'+rejected.pid+'/approve',
    {action:'reject',remark:'isolated rejection test'},approverCookie);
  assert.equal(rejection.status,200,'reject-approval: '+JSON.stringify(rejection.data));
  assert.equal(db.queryOne("SELECT lifecycle_status FROM payable_items WHERE source_ci_id=? AND source_type='shared_logistics'",[rejected.ci]).lifecycle_status,'active');
  assert.equal(db.queryOne('SELECT approval_status FROM payment_requests WHERE id=?',[rejected.pid]).approval_status,'rejected');
  assert(sharedWacParts(rejected.batches[0],'IDR').errors.length>0,'rejected payment must not enter WAC');
  const reSubmitted=await request(port,'/api/payment-requests/'+rejected.pid+'/submit-approval',{},adminCookie);
  assert.equal(reSubmitted.status,200,'resubmission must reuse existing payable fact: '+JSON.stringify(reSubmitted.data));
  assert.equal(db.queryOne("SELECT lifecycle_status FROM payable_items WHERE source_ci_id=? AND source_type='shared_logistics'",[rejected.ci]).lifecycle_status,
    'reserved','resubmission must re-reserve single canonical payable item');
  const reApproved=await request(port,'/api/payment-requests/'+rejected.pid+'/approve',
    {action:'approve',remark:'reapproved',actual_paid_amount:100000,actual_paid_date:day,attachment:'reapproval-voucher.pdf'},approverCookie);
  assert.equal(reApproved.status,200,'reapproval failed: '+JSON.stringify(reApproved.data));
  assert.equal(db.queryOne("SELECT lifecycle_status FROM payable_items WHERE source_ci_id=? AND source_type='shared_logistics'",[rejected.ci]).lifecycle_status,
    'paid','reapproved shared fee must settle canonical ledger exactly once');
  assert.equal(db.queryOne("SELECT COUNT(*) n FROM payable_items WHERE source_ci_id=? AND source_type='shared_logistics'",[rejected.ci]).n,
    1,'no duplicated payable on resubmission');
  console.log('[LOCAL-PG] PASS: partial payment 40k, remaining payment 60k, bank-linked reversal blocked 409, rejected approval preserve canonical payable ledger and WAC safety');
  console.log('[LOCAL-PG] PASS: real CI POST → configured approval_records → approver final approval → atomic payment_settlement_logs + payment_allocations → payable_items paid');
 }finally{await new Promise(resolve=>server.close(resolve));}
}
main().then(()=>process.exit(0)).catch(e=>{console.error('[LOCAL-PG] approval FAIL',e.stack||e);process.exit(1)});
