'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),
  crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
process.env.DB_DRIVER='sqlite';process.env.DB_PATH=':memory:';process.env.NODE_ENV='test';
const db=require('../db');db.initDatabase();
const {app}=require('../server');
const run=db.run,queryOne=db.queryOne;
const token='pi-deposit-regression-'+crypto.randomBytes(8).toString('hex');
run('INSERT INTO roles(id,name,permissions) VALUES (?,?,?)',['role-pi-regression','PI Test','["pi_view"]']);
run('INSERT INTO users(id,username,name,role_id,status) VALUES (?,?,?,?,?)',
 ['user-pi-regression','pi-regression','PI Test','role-pi-regression','active']);
run('INSERT INTO sessions(id,token_hash,user_id,created_at,expires_at) VALUES (?,?,?,?,?)',
 ['session-pi-regression',crypto.createHash('sha256').update(token).digest('hex'),'user-pi-regression','2026-10-21','2099-12-31 23:59:59']);
function seed(id,life,prStatus){
 const pi='pi-'+id,payable='payable-'+id,pr='pr-'+id,pri='pri-'+id,tx='tx-'+id;
 run('INSERT INTO proforma_invoices(id,pi_no,pi_date,currency,supplier_name,need_deposit,deposit_ratio,payable_deposit,paid_deposit,deposit_payment_status,pi_status,total_amount) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
   [pi,id,'2026-09-23','RMB','Netac',1,30,42976.83,29184,'partial_paid','pending',143256.10]);
 run('INSERT INTO payable_items(id,fee_no,source_type,source_id,source_no,fee_type,currency,payable_amount_minor,lifecycle_status,payee_type,payee_key,payee_name_snapshot,payer_entity_key,payer_name_snapshot) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
   [payable,'PAY-ITEM-'+id,'pi',pi,id,'deposit','RMB',4297683,life,'factory','supplier:netac','Netac','payer','Payer']);
 run('INSERT INTO payment_requests(id,request_no,payment_category,payment_subcategory,currency,payable_amount,paid_amount,deduction_amount,rounding_amount,payment_status,approval_status) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
   [pr,'PAY-'+id,'goods','deposit','RMB',42976.83,29184,13792.52,0.31,prStatus,'approved']);
 run('INSERT INTO payment_request_items(id,payment_request_id,payable_item_id,requested_amount_minor) VALUES (?,?,?,?)',[pri,pr,payable,4297683]);
 run('INSERT INTO payment_transactions(id,trans_no,payment_request_id,paid_amount_minor,paid_date,trans_status) VALUES (?,?,?,?,?,?)',
   [tx,'TX-'+id,pr,2918400,'2026-10-19','reconciled']);
 run('INSERT INTO payment_allocations(id,transaction_id,payment_request_item_id,allocated_amount_minor,status) VALUES (?,?,?,?,?)',
   ['alloc-'+id,tx,pri,2918400,'reconciled']);
}
seed('NHT260923A','paid','paid');
seed('NHT_UNPAID_SAMPLE','reserved','partial_paid');
async function get(url){
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 try{
   const port=server.address().port;
   const res=await fetch('http://127.0.0.1:'+port+url,{headers:{Cookie:'session_token='+token}});
   const body=await res.json();
   assert.equal(res.status,200,JSON.stringify(body));return body;
 }finally{await new Promise(resolve=>server.close(resolve));}
}
test('Netac PI list: paid payable with MDF deduction is paid despite cash allocation of 29184 only',async()=>{
 const pi=(await get('/api/proforma-invoices')).find(x=>x.pi_no==='NHT260923A');
 assert.ok(pi);
 assert.equal(pi.deposit_payment_status,'paid');
 assert.equal(pi.deposit_paid,true,'must include effective MDF in settled payable');
 assert.equal(pi.payable_deposit,42976.83);
 assert.equal(pi.paid_deposit,29184,'GET must not change original cash history');
 assert.equal(queryOne('SELECT deposit_payment_status FROM proforma_invoices WHERE id=?',[pi.id]).deposit_payment_status,'partial_paid','read must be side effect free');
});
test('PI detail reports paid using canonical payable lifecycle even with stale PI source',async()=>{
 const pi=await get('/api/proforma-invoices/pi-NHT260923A');
 assert.equal(pi.deposit_payment_status,'paid');
 assert.equal(pi.deposit_progress.core_status,'paid');
 assert.equal(pi.deposit_paid,true);
});
test('not yet paid payable remains pending even with similarly sized cash payment',async()=>{
 const pi=(await get('/api/proforma-invoices')).find(x=>x.pi_no==='NHT_UNPAID_SAMPLE');
 assert.equal(pi.deposit_paid,false);
 const detail=await get('/api/proforma-invoices/pi-NHT_UNPAID_SAMPLE');
 assert.equal(detail.deposit_paid,false);
});
test('future payment synchronizes PI AFTER payable item is marked paid',()=>{
 const src=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
 const start=src.indexOf('function applyPaymentSettlementInTx(');
 const end=src.indexOf('async function applyPaymentSettlement(',start);
 assert.ok(start>=0&&end>start);
 const scope=src.slice(start,end);
 const mark=scope.indexOf('markPayableItemPaid(payableItemId)');
 const recalc=scope.indexOf('const result = recalculatePaymentSettlement(payment.id)');
 assert.ok(mark>0&&recalc>mark,'PI sync must see final paid lifecycle');
 assert.match(src,/MAX\(CASE WHEN pai\.lifecycle_status = 'paid' THEN 1 ELSE 0 END\) AS payable_paid/);
 assert.match(src,/pr\.payment_status = 'paid' AND pr\.approval_status = 'approved'/);
});
