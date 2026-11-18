'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const app=fs.readFileSync(require('node:path').join(__dirname,'..','app.js'),'utf8');
const start=app.indexOf('function renderPurchaseAmountSummary(');
const end=app.indexOf('function ciTypeBadge',start);
assert.ok(start>=0&&end>start,'CI summary renderer exists');
const source=app.slice(start,end);
const context={t:(key,fallback)=>fallback,esc:value=>String(value==null?'':value)};
vm.runInNewContext(source+'; this.renderPurchaseAmountSummary=renderPurchaseAmountSummary;',context);
test('CI summary cards use filtered CI rows, currency grouping and actual-paid-only totals',()=>{
 const html=context.renderPurchaseAmountSummary(
  [
   {ci_status:'shipped',currency:'RMB',goods_amount:100,actual_deducted_deposit:10,balance_paid_amount:20,balance_deduction_amount:5,balance_rounding_amount:0.5,balance_unpaid_amount:64.5},
   {ci_status:'cancelled',currency:'RMB',goods_amount:999,actual_deducted_deposit:999,balance_paid_amount:0,balance_unpaid_amount:0}
  ],
  [
   {currency:'USD',gross_goods_amount:50,historical_paid_amount:5,subsequent_paid_amount:10,deduction_amount:3,rounding_amount:0.2,unpaid_amount:31.8}
  ]
 );
 assert.match(html,/采购金额合计/);
 assert.match(html,/已付款总金额/);
 assert.match(html,/剩余未付款总金额/);
 assert.match(html,/未结金额合计/);
 assert.match(html,/已付款：RMB 20\.00 · USD 15\.00/);
 assert.match(html,/抵扣：RMB 15\.00 · USD 3\.00/);
 assert.match(html,/抹零：RMB 0\.50 · USD 0\.20/);
 assert.match(html,/RMB 100\.00/);
 assert.match(html,/USD 50\.00/);
 assert.match(html,/RMB 20\.00/);
 assert.match(html,/USD 15\.00/);
 assert.match(html,/RMB 64\.50/);
 assert.match(html,/USD 31\.80/);
 assert.doesNotMatch(html,/999\.00/);
});
test('summary renderer accepts the date-filter bridge payload and uses its already-filtered rows',()=>{
 const html=context.renderPurchaseAmountSummary({
  operationalRows:[{ci_status:'completed',currency:'RMB',goods_amount:100,actual_deducted_deposit:20,balance_paid_amount:30,balance_unpaid_amount:50}],
  historicalRows:[{currency:'USD',gross_goods_amount:40,historical_paid_amount:10,subsequent_paid_amount:5,unpaid_amount:25}]
 });
 assert.match(html,/RMB 100\.00/);
 assert.match(html,/RMB 50\.00/);
 assert.match(html,/USD 40\.00/);
 assert.match(html,/USD 15\.00/);
 assert.match(html,/USD 25\.00/);
});
test('CI list refresh recalculates the three cards from the currently fetched filtered rows',()=>{
 const load=app.slice(app.indexOf('async function loadCI()'),app.indexOf('async function createHistoricalCI()'));
 assert.match(load,/renderPurchaseAmountSummary\(\{operationalRows:operationalRows,historicalRows:historicalRows\}\)/);
 assert.doesNotMatch(load,/api\('\/api\/purchase-amount-summary'\)/);
});
