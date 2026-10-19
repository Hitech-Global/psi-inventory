'use strict';
// Read-only dynamic contract test for PAY-CORE final approve+pay input validation.
// In-process test uses a mocked settlement SSOT and performs zero DB writes.
const test=require('node:test'), assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
const start=source.indexOf('const MAX_ROUND_OFF_AMOUNT = 1;');
const end=source.indexOf('function settleFinalPaymentApprovalInTx(',start);
assert.ok(start>=0&&end>start,'final approval validation must remain available');
const approvalCode=source.slice(start,end);
function createHarness({gross=42976.83,deduction=13792.52,paid=0,priorRound=0}={}){
 let calls=0;
 const snapshot={grossPayable:gross,effectiveDeduction:deduction,effectivePaid:paid,effectiveRounding:priorRound,
   outstanding:Math.round((gross-deduction-paid-priorRound)*100)/100};
 const context={
  settlementMoney:value=>{const n=Number(value);return Number.isFinite(n)?Math.round((n+Number.EPSILON)*100)/100:NaN;},
  settlementDate:day=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(day))throw new Error('invalid date');return day;},
  paymentSettlementFacts:payment=>{calls++;assert.equal(payment.id,'pay-1');return snapshot;},
  parseAttachment:value=>String(value??''),
  SettlementError:class SettlementError extends Error{constructor(status,message){super(message);this.status=status;}}
 };
 vm.createContext(context);vm.runInContext(approvalCode+';globalThis.testFunction=finalPaymentApprovalInput;',context);
 const payment={id:'pay-1',payable_amount:gross,attachment:'bank-confirmation'};
 const body={actual_paid_date:'2026-10-19',actual_paid_amount:29184,rounding_amount:0.31};
 return {payment,body,snapshot,run:(patch={})=>context.testFunction(payment,{...body,...patch}),calls:()=>calls};
}
test('Netac PAY-MULTI-2026-297128: gross 42,976.83, prior deduction 13,792.52, pay 29,184 and round 0.31: fully settled',()=>{
 const h=createHarness(),v=h.run();
 assert.equal(h.snapshot.outstanding,29184.31);
 assert.equal(v.actualPaidAmount,29184);
 assert.equal(v.roundingAmount,.31);
 assert.equal(v.applyRoundOff,true);
 assert.equal(v.isPartialPayment,false);
 assert.equal(Math.round((h.snapshot.grossPayable-h.snapshot.effectiveDeduction-v.actualPaidAmount-v.roundingAmount)*100),0);
 assert.equal(h.calls(),1);
});
test('without deduction: classic integer payment + cents round-off still works',()=>{
 const h=createHarness({gross:1000.31,deduction:0});
 const v=h.run({actual_paid_amount:1000,rounding_amount:0.31});
 assert.equal(v.isPartialPayment,false);
 assert.equal(v.roundingAmount,.31);
});
test('earlier partial transaction and deduction combine with fresh current outstanding',()=>{
 const h=createHarness({gross:1000.36,deduction:100,paid:400});
 const v=h.run({actual_paid_amount:500,rounding_amount:0.36});
 assert.equal(v.isPartialPayment,false);
 assert.equal(v.applyRoundOff,true);
});
test('deduction already covers amount: does not permit another payment',()=>{
 const h=createHarness({gross:200,deduction:200});
 assert.throws(()=>h.run({actual_paid_amount:1,rounding_amount:0}),e=>e.status===409);
});
test('attempting to pay original gross after deduction is explicitly rejected',()=>{
 const h=createHarness();
 assert.throws(()=>h.run({actual_paid_amount:42976.83,rounding_amount:0}),e=>e.status===400&&/当前未结金额/.test(e.message));
});
test('bad rounding cannot be used to wipe a larger remainder',()=>{
 const h=createHarness();
 assert.throws(()=>h.run({actual_paid_amount:29183,rounding_amount:1.31}),e=>e.status===400);
 assert.throws(()=>h.run({actual_paid_amount:29184,rounding_amount:0.30}),e=>e.status===400&&/当前未结金额/.test(e.message));
 assert.throws(()=>h.run({actual_paid_amount:29184,rounding_amount:2}),e=>e.status===400);
});
test('no round-off with less-than-outstanding actual paid remains partial; no silent 0.31 write',()=>{
 const h=createHarness(),v=h.run({actual_paid_amount:29184,rounding_amount:0});
 assert.equal(v.isPartialPayment,true);
 assert.equal(v.roundingAmount,0);
 assert.equal(v.applyRoundOff,false);
});
test('full payment for fractional outstanding without round-off remains valid',()=>{
 const h=createHarness();
 const v=h.run({actual_paid_amount:29184.31,rounding_amount:0});
 assert.equal(v.isPartialPayment,false);
 assert.equal(v.roundingAmount,0);
});
test('round-off cannot be applied to a fractional actual payment or whole Yuan remainder',()=>{
 const h=createHarness();
 assert.throws(()=>h.run({actual_paid_amount:29184.10,rounding_amount:.21}),e=>e.status===400&&/小数尾差/.test(e.message));
 const whole=createHarness({gross:1000,deduction:0});
 assert.throws(()=>whole.run({actual_paid_amount:999,rounding_amount:1}),e=>e.status===400);
});
test('negative/NaN inputs and missing voucher are rejected before settlement',()=>{
 const h=createHarness();
 assert.throws(()=>h.run({rounding_amount:'not-a-number'}),e=>e.status===400&&/抹零金额无效/.test(e.message));
 assert.throws(()=>h.run({rounding_amount:-.01}),e=>e.status===400);
 assert.throws(()=>h.run({actual_paid_amount:0}),e=>e.status===400);
 const noVoucher=createHarness();noVoucher.payment.attachment='';
 assert.throws(()=>noVoucher.run(),e=>e.status===400&&/上传水单附件/.test(e.message));
});
test('transaction SSOT is used and not payment.unpaid_amount (which can be stale)',()=>{
 const h=createHarness(),p=h.payment;p.unpaid_amount=42976.83;
 const v=h.run();assert.equal(v.roundingAmount,.31);assert.equal(v.isPartialPayment,false);
});
test('rounding input passed to settlement atomic helper, not deducted twice',()=>{
 const s=source.slice(end,source.indexOf('/**',end));
 assert.match(s,/rounding_amount: input\.roundingAmount/);
 assert.match(s,/input\.actualPaidAmount/);
 assert.match(s,/apply_round_off: input\.applyRoundOff/);
});
