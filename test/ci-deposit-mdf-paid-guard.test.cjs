'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
process.env.DB_DRIVER='sqlite';process.env.DB_PATH=':memory:';process.env.NODE_ENV='test';
const db=require('../db');db.initDatabase();
const {app}=require('../server');
const run=db.run,one=db.queryOne;
const token='ci-paid-guard-'+crypto.randomBytes(9).toString('hex');
run('INSERT INTO roles (id,name,permissions) VALUES (?,?,?)',['role-ci-dep','CI Tester','["ci_create","ci_view","pi_view"]']);
run('INSERT INTO users (id,username,name,role_id,status) VALUES (?,?,?,?,?)',
  ['user-ci-dep','ci-dep','CI Tester','role-ci-dep','active']);
run('INSERT INTO sessions (id,token_hash,user_id,created_at,expires_at) VALUES (?,?,?,?,?)',
  ['session-ci-dep',crypto.createHash('sha256').update(token).digest('hex'),'user-ci-dep','2026-10-22','2099-12-31 23:59:59']);
function seed(name,piStatus,payableStatus,approval,paymentStatus){
 const pi='pi-'+name,payable='payable-'+name,pr='pr-'+name;
 run('INSERT INTO proforma_invoices (id,pi_no,pi_date,supplier_name,supplier_id,brand,country,target_warehouse,currency,need_deposit,deposit_ratio,payable_deposit,paid_deposit,deposit_payment_status,pi_status,total_amount) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
   [pi,name,'2026-09-23','Netac','supnetac','Netac','印度尼西亚','Bekasi Warehouse','RMB',1,30,42976.83,29184,piStatus,'pending',143256.10]);
 run('INSERT INTO payable_items (id,fee_no,source_type,source_id,source_no,fee_type,currency,payable_amount_minor,lifecycle_status,payee_type,payee_key,payee_name_snapshot,payer_entity_key,payer_name_snapshot) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
   [payable,'PAYITEM-'+name,'pi',pi,name,'deposit','RMB',4297683,payableStatus,'factory','supplier:netac','Netac','payer','Payer']);
 run('INSERT INTO payment_requests (id,request_no,payment_category,payment_subcategory,currency,payable_amount,paid_amount,deduction_amount,rounding_amount,unpaid_amount,approval_status,payment_status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
   [pr,'PAY-'+name,'goods','deposit','RMB',42976.83,29184,13792.52,0.31,0,approval,paymentStatus]);
 run('INSERT INTO payment_request_items(id,payment_request_id,payable_item_id,requested_amount_minor) VALUES (?,?,?,?)',['pri-'+name,pr,payable,4297683]);
 return {pi,pr,payable};
}
const settled=seed('NHT260923A','partial_paid','paid','approved','paid');
const outstanding=seed('NHT-NOT-PAID','partial_paid','partially_paid','approved','partial');
const unapproved=seed('NHT-NOT-APPROVED','partial_paid','paid','pending','paid');
const reversed=seed('NHT-REVERSED','partial_paid','paid','approved','reversed');
async function createCI(pi,ciNo){
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 try{
   const res=await fetch('http://127.0.0.1:'+server.address().port+'/api/commercial-invoices',{
     method:'POST',headers:{'Content-Type':'application/json',Cookie:'session_token='+token},
     body:JSON.stringify({ci_no:ciNo,supplier_name:'Netac',supplier_id:'supnetac',
       ci_date:'2026-10-20',actual_ship_date:'2026-10-21',currency:'RMB',related_pi_ids:[pi],items:[]})
   });
   return {status:res.status,body:await res.json()};
 } finally { await new Promise(resolve=>server.close(resolve)); }
}
test('Netac fully settled MDF+cash+rounding passes operational CI create despite stale partial_paid PI header',async()=>{
 const res=await createCI(settled.pi,'CI-NETAC-MDF-PAID');
 assert.equal(res.status,200,JSON.stringify(res));
 assert.ok(one('SELECT id FROM commercial_invoices WHERE ci_no=?',['CI-NETAC-MDF-PAID']));
 assert.equal(one('SELECT deposit_payment_status FROM proforma_invoices WHERE id=?',[settled.pi]).deposit_payment_status,'partial_paid','PI source not rewritten by CI read/check');
 assert.equal(one('SELECT payment_status FROM payment_requests WHERE id=?',[settled.pr]).payment_status,'paid');
});
test('genuinely unpaid PI remains blocked, with no CI record created',async()=>{
 const res=await createCI(outstanding.pi,'CI-PENDING-FAIL');
 assert.equal(res.status,400,JSON.stringify(res));
 assert.match(res.body.error,/NHT-NOT-PAID/);
 assert.equal(one('SELECT id FROM commercial_invoices WHERE ci_no=?',['CI-PENDING-FAIL']),undefined);
});
test('paid payable alone is insufficient: payment request must also be approved and paid',async()=>{
 for(const [obj,ciNo] of [[unapproved,'CI-UNAPPROVED-FAIL'],[reversed,'CI-REVERSED-FAIL']]){
   const res=await createCI(obj.pi,ciNo);
   assert.equal(res.status,400,JSON.stringify(res));assert.equal(one('SELECT id FROM commercial_invoices WHERE ci_no=?',[ciNo]),undefined);
 }
});
test('both manual and batch CI paths guard deposit payment state',()=>{
 const s=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
 assert.match(s,/function isPiDepositSettledForCI\(pi\)/);
 const manual=s.slice(s.indexOf("app.post('/api/commercial-invoices'"),s.indexOf("app.post('/api/commercial-invoices/:id/attachment'"));
 assert.match(manual,/isPiDepositSettledForCI\(pi\)/);
 const batch=s.slice(s.indexOf("app.post('/api/commercial-invoices/batch-import'"));
 assert.match(batch,/pai.lifecycle_status = 'paid'/);
 assert.match(batch,/pr.payment_status = 'paid' AND pr.approval_status = 'approved'/);
});
