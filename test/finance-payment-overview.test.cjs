'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createFinancePaymentOverview:make}=require('../assets/finance-payment-overview');
const today='2026-10-19';
function row(id,status,amount,due,payee='supplier:s1',currency='RMB',category='goods'){
 return {id,fee_no:id,lifecycle_status:status,payable_amount_minor:amount,
  payable_date:due,payee_key:payee,payee_name_snapshot:payee==='supplier:s1'?'Redragon':'Forwarder',
  payee_type:payee.startsWith('supplier:')?'factory':'service_provider',currency,category_code:category};
}
function base(){
 const rows=[
  row('a','paid',10000,'2026-09-01'),
  row('b','partially_paid',15000,'2026-10-10'),
  row('c','active',23000,'2026-10-19'),
  row('d','reserved',10000,'2026-10-22'),
  row('e','active',5000,'2026-11-15'),
  row('f','paid',5000,'', 'supplier:s1'),
  row('g','active',95000000,'','service_provider:Freight','IDR','warehouse_arrival'),
  row('h','active',1000,'','supplier:s1','RMB','goods'),
  row('ignore','cancelled',40000,'2026-09-01')
 ];
 const breakdownMap=new Map([
  ['a',{paidMinor:10000}],['b',{paidMinor:3000,deductionMinor:2000,roundingMinor:1000}],
  ['f',{paidMinor:5000}]
 ]);
 const purchases=[{id:'PI1',supplier_id:'s1',supplier_name:'Redragon',currency:'RMB',
  country:'印度尼西亚',pi_status:'shipped_complete',total_amount:1895.75}];
 return {rows,breakdownMap,purchases,today};
}
test('all paid + open included, cancelled excluded, amounts reconcile in minor units',()=>{
 const o=make(base()),m=o.summary.find(s=>s.currency==='RMB').totals;
 assert.equal(o.details.length,8);
 assert.equal(m.count,7);
 assert.equal(m.gross,690);
 assert.equal(m.cash_paid,180);
 assert.equal(m.deductions,20);
 assert.equal(m.rounding,10);
 assert.equal(m.outstanding,480);
 assert.equal(m.overdue,90);
 assert.equal(m.due_today,230);
 assert.equal(m.due_7,100);
 assert.equal(m.due_30,150);
 assert.equal(m.no_due,10);
 assert.equal(m.due_ever,480); // historical paid, partially paid, today due
 assert.equal(m.gross,m.cash_paid+m.deductions+m.rounding+m.outstanding);
});
test('due date buckets exclude paid balances and treat today separately',()=>{
 const o=make(base());
 const todayDue=o.details.find(r=>r.id==='c'),previous=o.details.find(r=>r.id==='a');
 assert.equal(todayDue.overdue,0);assert.equal(todayDue.due_today,230);
 assert.equal(previous.due_ever,100);assert.equal(previous.overdue,0);
});
test('currencies and payees are separate, PI amounts not added to payables',()=>{
 const o=make(base());
 const idr=o.summary.find(s=>s.currency==='IDR').totals;
 assert.equal(idr.gross,950000);assert.equal(idr.cash_paid,0);
 assert.equal(o.by_payee.find(p=>p.payee_key==='supplier:s1').pi_purchase_amount,1895.75);
 assert.equal(o.summary.find(s=>s.currency==='RMB').totals.gross,690);
});
test('paid label without payment fact is flagged, not fabricated as paid cash',()=>{
 const cfg=base();cfg.rows.push(row('paid_bad','paid',8000,'2026-07-01'));
 const o=make(cfg);
 assert.ok(o.issues.find(x=>x.id==='paid_bad'&&x.kind==='paid_without_facts'));
 assert.equal(o.details.find(x=>x.id==='paid_bad').cash_paid,0);
 assert.equal(o.details.find(x=>x.id==='paid_bad').outstanding,80);
});
test('over-allocation raises issue, cash fact not silently truncated',()=>{
 const cfg=base();cfg.breakdownMap.set('h',{paidMinor:1200});
 const o=make(cfg);
 assert.ok(o.issues.find(x=>x.id==='h'&&x.kind==='over_settled'));
 assert.equal(o.details.find(x=>x.id==='h').outstanding,0);
});
test('zero balance with missing due never becomes erroneous overdue',()=>{
 const o=make(base());
 assert.equal(o.details.find(x=>x.id==='f').no_due,0);
 assert.equal(o.details.find(x=>x.id==='h').no_due,10);
});
test('historical PI can exist without issued payable item',()=>{
 const cfg=base();cfg.purchases.push({id:'PI2',supplier_id:'s2',supplier_name:'Netac',currency:'RMB',total_amount:200});
 const o=make(cfg);
 assert.ok(o.by_payee.some(p=>p.payee_key==='supplier:s2'&&p.pi_purchase_amount===200&&p.totals.gross===0));
});
test('source classification preserves country and paid items without a payment request',()=>{
 const cfg=base();cfg.rows[0].source_ci_id='CI123';
 cfg.sourceCountries={'CI123':'印度尼西亚'};
 const o=make(cfg);
 assert.equal(o.details.find(x=>x.id==='a').country,'印度尼西亚');
 assert.ok(o.details.find(x=>x.id==='a').fee_no);
});
