'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
process.env.DB_DRIVER='sqlite';process.env.DB_PATH=':memory:';
const db=require('../db');
const {settledConversion,sharedWacParts}=require('../shared-logistics-fee-server');
db.initDatabase();
let n=0;
function setup(payments){
 const id='pr-lock-'+(++n),orig='IDR';
 db.run('INSERT INTO payment_requests (id,request_no,payment_category,payment_subcategory,source_type,source_id,currency,payable_amount,paid_amount,unpaid_amount,payment_status,approval_status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
 [id,'PAY-LOCK-'+n,'warehouse_arrival','delivery','shared_logistics','s'+n,orig,payments.reduce((sum,x)=>sum+x.amount,0),payments.reduce((sum,x)=>sum+x.amount,0),0,'paid','approved']);
 payments.forEach((row,i)=>{
   const fields=['id','payment_request_id','event_type','status','amount','original_currency','local_amount',
     'local_currency','local_rate','local_rate_date','paid_date','rmb_rate','rmb_rate_date',
     'rmb_rate_direction','rmb_amount','reversed_at'];
   const values=[id+'-'+i,id,'payment','applied',row.amount,row.currency||orig,row.amount,orig,1,
     row.date||'2026-10-13',row.paid_date||'2026-10-13',
     row.rate===undefined?.00037:row.rate,row.date===undefined?'2026-10-13':row.date,
     'direct',row.rmb===undefined?row.amount*(row.rate===undefined?.00037:row.rate):row.rmb,
     row.reversed_at||''];
   db.run('INSERT INTO payment_settlement_logs ('+fields.join(',')+') VALUES ('+fields.map(()=>'?').join(',')+')',values);
 });
 return id;
}
test('multiple payments: sum the exact RMB snapshots, not a current or single FX rate',()=>{
 const pr=setup([{amount:500000,rate:0.00037,rmb:185,date:'2026-10-13'},
                 {amount:450000,rate:0.00038,rmb:171,date:'2026-10-14',paid_date:'2026-10-14'}]);
 const result=settledConversion(pr,95000000,'IDR','RMB',true);
 assert.equal(result.amount_minor,35600);
 assert.equal(result.fx.length,2);
 assert.equal(result.source,'locked_payment_rmb_snapshot');
});
test('reversed settlement or insufficient actual payment never gets a confirmed cost',()=>{
 const pr=setup([{amount:950000,rmb:351.5,reversed_at:'2026-10-15'}]);
 assert.match(settledConversion(pr,95000000,'IDR','RMB',true).error,/尚未实际结算/);
 const partial=setup([{amount:500000,rmb:185}]);
 assert.match(settledConversion(partial,95000000,'IDR','RMB',true).error,/尚未结清/);
 db.run("UPDATE payment_requests SET payment_status='partial' WHERE id=?",[partial]);
 assert.match(settledConversion(partial,50000000,'IDR','RMB',true).error,/未全部付款/);
});
test('RMB snapshot missing, wrong currency, future-dated, or tampered => blocked',()=>{
 const missing=setup([{amount:950000,rmb:null}]);
 assert.match(settledConversion(missing,95000000,'IDR','RMB',true).error,/快照/);
 const wrong=setup([{amount:950000,currency:'USD',rmb:351.5}]);
 assert.match(settledConversion(wrong,95000000,'IDR','RMB',true).error,/币种不一致/);
 const future=setup([{amount:950000,rmb:351.5,date:'2026-10-14',paid_date:'2026-10-13'}]);
 assert.match(settledConversion(future,95000000,'IDR','RMB',true).error,/快照/);
 const tampered=setup([{amount:950000,rmb:999999}]);
 assert.match(settledConversion(tampered,95000000,'IDR','RMB',true).error,/不一致/);
});
test('RMB rate snapshot from prior banking business day remains valid',()=>{
 const pr=setup([{amount:950000,rmb:351.5,date:'2026-10-12',paid_date:'2026-10-13'}]);
 const result=settledConversion(pr,95000000,'IDR','RMB',true);
 assert.equal(result.amount_minor,35150);
 assert.equal(result.fx[0].rate_date,'2026-10-12');
});
test('later changes to realtime/automatic FX tables do not change locked conversion',()=>{
 const pr=setup([{amount:950000,rmb:351.5}]);
 const before=settledConversion(pr,95000000,'IDR','RMB',true);
 db.run("INSERT INTO exchange_rates (id,from_currency,to_currency,rate,rate_date,rate_type) VALUES (?,?,?,?,?,?)",
   ['fxauto_new','IDR','RMB',0.0005,'2026-10-13','realtime']);
 db.run("INSERT INTO exchange_rates (id,from_currency,to_currency,rate,rate_date,rate_type) VALUES (?,?,?,?,?,?)",
   ['fxmanual_new','IDR','RMB',0.0009,'2026-10-13','realtime']);
 const after=settledConversion(pr,95000000,'IDR','RMB',true);
 assert.equal(before.amount_minor,35150);
 assert.equal(after.amount_minor,before.amount_minor);
});
