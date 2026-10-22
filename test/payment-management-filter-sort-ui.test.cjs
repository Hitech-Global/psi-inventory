'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
function section(a,b){const i=src.indexOf(a),j=src.indexOf(b,i);assert(i>=0&&j>i,a);return src.slice(i,j);}
const helpers=section('// PAYMENT-MANAGEMENT-FILTER-SORT-20261022','// 统一付款申请详情弹窗');
const loadPay=section('async function loadPay(){','async function apprPay(');
const rows=[
 {id:'a',request_no:'PAY-A',supplier_name:'Netac',expense_country:'印度尼西亚',paid_date:'2026-10-19',payment_category:'goods',payment_subcategory:'deposit',payment_status:'paid',approval_status:'approved',paid_amount:29184,payable_amount:42976.83,deduction_amount:13792.52,rounding_amount:.31,actual_pay_amount:29184,unpaid_amount:0,currency:'RMB',source_no:'PI-A'},
 {id:'b',request_no:'PAY-B',supplier_name:'丰年',expense_country:'泰国',paid_date:'2026-10-09',payment_category:'warehouse_arrival',payment_subcategory:'freight',payment_status:'paid',approval_status:'approved',paid_amount:12044.50,payable_amount:12044.5,deduction_amount:0,rounding_amount:0,actual_pay_amount:12044.5,unpaid_amount:0,currency:'RMB',source_no:'CI-B'},
 {id:'c',request_no:'PAY-C',supplier_name:'Netac',expense_country:'马来西亚',paid_date:'',payment_category:'goods',payment_subcategory:'balance',payment_status:'approved',approval_status:'approved',paid_amount:0,payable_amount:80,deduction_amount:0,rounding_amount:0,unpaid_amount:80,currency:'RMB',source_no:'PI-C'},
 {id:'d',request_no:'PAY-D',supplier_name:'丰年',expense_country:'ID',paid_date:'2026-10-21',payment_category:'warehouse_arrival',payment_subcategory:'delivery',payment_status:'paid',approval_status:'approved',paid_amount:900,payable_amount:900,deduction_amount:0,rounding_amount:0,unpaid_amount:0,currency:'IDR',source_no:'CI-D'}];
function harness(){
 const els={'pay-table':{innerHTML:''},'pay-fs':{value:''},'pay-fc':{value:''},'pay-fk':{value:''}};
 const ctx={
   document:{getElementById:id=>els[id]||null},
   window:{},PAY_CATEGORIES:{goods:'货款',warehouse_arrival:'到仓费用'},
   PAY_SUBCATS:{goods:{deposit:'定金',balance:'尾款'},warehouse_arrival:{freight:'运费',delivery:'派送费'}},
   PAY_STATUS_MAP:{paid:'已付款',approved:'已审批'},
   esc:x=>String(x==null?'':x).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'),
   t:(_,fallback)=>fallback,fmtMoney:x=>Number(x||0).toFixed(2),
   fmtDate:x=>x,hasPermission:()=>false,showFlash:e=>{throw Error(e)},
   api:async()=>rows.slice()
 };
 vm.createContext(ctx);vm.runInContext(helpers+'\n'+loadPay,ctx);
 ctx.paymentManageInit=()=>{}; // No DOM creation in pure list-render tests.
 return {ctx,els,st:vm.runInContext('_paymentManageState',ctx)};
}
test('mixed country codes are normalized for filter options, not changed in the stored rows',()=>{
 const {ctx}=harness();assert.equal(ctx.paymentManageCountry(rows[3]),'印度尼西亚');
 assert.equal(ctx.paymentManageCountry({expense_country:'MY'}),'马来西亚');
 assert.equal(ctx.paymentManageCountry({expense_country:'TH'}),'泰国');
 assert.equal(rows[3].expense_country,'ID');
});
test('country + payee multi-select combine as intersection without mutating source',()=>{
 const {ctx,st}=harness();st.countries.add('印度尼西亚');st.countries.add('马来西亚');st.payees.add('Netac');
 const v=ctx.paymentManageView(rows);assert.deepEqual(Array.from(v,r=>r.request_no),['PAY-A','PAY-C']);
 assert.equal(rows.length,4);
 st.payees.clear();assert.equal(ctx.paymentManageView(rows).length,3);
});
test('paid date sorts chronologically in both directions with missing dates last',()=>{
 const {ctx,st}=harness();st.sortKey='paid_date';st.sortDir='asc';
 assert.deepEqual(Array.from(ctx.paymentManageView(rows),r=>r.request_no),['PAY-B','PAY-A','PAY-D','PAY-C']);
 st.sortDir='desc';
 assert.deepEqual(Array.from(ctx.paymentManageView(rows),r=>r.request_no),['PAY-D','PAY-A','PAY-B','PAY-C']);
});
test('numeric sorts use numbers, not lexical order and retain tie stability',()=>{
 const {ctx,st}=harness();st.sortKey='paid_amount';st.sortDir='desc';
 assert.deepEqual(Array.from(ctx.paymentManageView(rows),r=>r.request_no),['PAY-A','PAY-B','PAY-D','PAY-C']);
 st.sortDir='asc';assert.equal(ctx.paymentManageView(rows)[0].request_no,'PAY-C');
});
test('filter and sort persist, selecting another column resets to ascending',()=>{
 const {ctx,st}=harness();ctx.paymentManageSort('paid_date');ctx.paymentManageSort('paid_date');
 assert.equal(st.sortDir,'desc');ctx.paymentManageMultiFilter('country','印度尼西亚',true);
 assert.equal(st.sortDir,'desc');assert.equal(st.sortKey,'paid_date');
 ctx.paymentManageSort('paid_amount');assert.equal(st.sortDir,'asc');
});
test('payment table displays payment date and sortable headers, preserving source trace and actions',async()=>{
 const {ctx,els,st}=harness();
 await ctx.loadPay();const html=els['pay-table'].innerHTML;
 assert.match(html,/实际付款日期/);assert.match(html,/2026-10-19/);
 assert.match(html,/paymentManageSort\('paid_date'\)/);
 assert.match(html,/paymentManageSort\('paid_amount'\)/);
 assert.match(html,/PAY-A/);assert.match(html,/PI-A/);
 assert.ok(html.indexOf('PAY-A')<html.indexOf('PAY-B'));
 st.sortKey='paid_date';st.sortDir='desc';await ctx.loadPay();
 assert.ok(els['pay-table'].innerHTML.indexOf('PAY-D')<els['pay-table'].innerHTML.indexOf('PAY-A'));
});
test('no backend payment, settlement or approval write has been introduced',()=>{
 assert.match(src,/paymentManageView\(data\)/);
 assert.doesNotMatch(helpers,/api\(.*'POST'/);
 assert.match(src,/cacheKey:'payment',ttl:30000,signature:_payUrl/);
 assert.match(helpers,/#pay-table \.data-table th,#pay-table \.data-table td\{text-align:left!important\}/);
});
