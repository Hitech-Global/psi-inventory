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
 const adminCookie=session('user_admin'),approverCookie=session(approver);
 const server=await new Promise(resolve=>{const x=http.createServer(app);x.listen(0,'127.0.0.1',()=>resolve(x));});
 try{
  const port=server.address().port,batchIds=[0,1].map(i=>'sh_batch_'+i+'_'+uniq);
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
  console.log('[LOCAL-PG] PASS: real CI POST → configured approval_records → approver final approval → atomic payment_settlement_logs + payment_allocations → payable_items paid');
 }finally{await new Promise(resolve=>server.close(resolve));}
}
main().then(()=>process.exit(0)).catch(e=>{console.error('[LOCAL-PG] approval FAIL',e.stack||e);process.exit(1)});
