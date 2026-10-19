'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
const s=fs.readFileSync(path.join(root,'server.js'),'utf8');
const from=s.indexOf("const {createFinancePaymentOverview} = require(") >=0
 ?s.indexOf("const {createFinancePaymentOverview} = require("):s.indexOf("const {createFinancePaymentOverview} = require(");
const start=from>=0?from:s.indexOf("const {createFinancePaymentOverview} = require(");
const pos=start<0?s.indexOf("const {createFinancePaymentOverview}"):start;
const end=s.indexOf("app.get('/api/finance/payable-cockpit'",pos);
assert.ok(pos>0&&end>pos,'overview endpoint missing');
function serverHarness(){
 let handler,permissions=[],reads=[],body=null,status=200,headers={};
 const record={id:'fee1',fee_no:'F-1',category_code:'goods',
  payee_key:'supplier:s1',payee_type:'factory',payee_name_snapshot:'Redragon',
  currency:'RMB',lifecycle_status:'paid',payable_amount_minor:10000,payable_date:'2026-09-01'};
 const ctx={
  require:()=>require('../assets/finance-payment-overview'),
  app:{get(url,...fns){assert.equal(url,'/api/finance/payment-overview');handler=fns.at(-1);}},
  requireApiPermission:p=>{permissions.push(p);return ()=>{};},
  asyncHandler:f=>f,
  query(sql){
   reads.push(sql);
   assert.match(sql,/^\s*SELECT/i,'any non-SELECT is prohibited');
   if(sql.includes('FROM payable_items'))return {rows:[record]};
   if(sql.includes('FROM commercial_invoices'))return {rows:[]};
   if(sql.includes('FROM historical_commercial_invoices'))return {rows:[]};
   if(sql.includes('FROM proforma_invoices'))return {rows:[{id:'pi1',supplier_id:'s1',
    supplier_name:'Redragon',currency:'RMB',country:'印度尼西亚',pi_status:'pending',total_amount:300}]};
   throw Error('Unexpected read');
  },
  payableItemsSettlementBreakdown:ids=>new Map(ids.map(id=>[id,{paidMinor:10000,deductionMinor:0,roundingMinor:0}])),
  canonCountry:s=>s,
  displayCountry:s=>s
 };
 vm.runInNewContext(s.slice(pos,end),ctx);
 const res={set(k,v){headers[k]=v;return this;},json(x){body=x;return this;},status(s){status=s;return this;}};
 return {run:()=>handler({},res),result:()=>({body,status,headers}),permissions,reads};
}
test('endpoint is permission-guarded, only SELECTs, includes fully paid histories',()=>{
 const h=serverHarness();h.run();
 assert.deepEqual(h.permissions,['payment_view']);
 assert.equal(h.reads.length,5);
 assert.equal(h.result().body.details.length,1);
 assert.equal(h.result().body.details[0].cash_paid,100);
 assert.equal(h.result().body.details[0].outstanding,0);
 assert.equal(h.result().body.by_payee[0].pi_purchase_amount,300);
 assert.equal(h.result().headers['Cache-Control'],'private, no-store');
});
test('app router remains in prior nav and loads one unified overview, not old open-only cockpit',()=>{
 const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
 const idx=fs.readFileSync(path.join(root,'index.html'),'utf8');
 const start=app.indexOf('async function renderPayableCockpit(){');
 const stop=app.indexOf('function cockpitCard(',start);
 const fn=app.slice(start,stop);
 assert.match(fn,/api\/finance\/payment-overview/);
 assert.doesNotMatch(fn,/api\/finance\/payable-cockpit/);
 assert.match(fn,/_cockpitLoadSeq/);
 assert.ok(idx.includes('assets/finance-payment-overview-ui.js'));
 assert.ok(idx.indexOf('finance-payment-overview-ui.js')<idx.indexOf('src="app.js"'));
});
test('UI all-currency page renders expenses, reconciled cash, and drilldown',()=>{
 const html=fs.readFileSync(path.join(root,'assets/finance-payment-overview-ui.js'),'utf8');
 const elements={'content-inner':{innerHTML:''},'fin-layers':{innerHTML:''}};
 const context={document:{getElementById:id=>elements[id]||null},
   esc:v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),
   fmtMoney:n=>Number(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}),
   window:{},openModal(){},showToast(){}};
 vm.runInNewContext(html,context);
 const detail={id:'p1',fee_no:'F-1',country:'印度尼西亚',payee_key:'supplier:s1',
  payee_name:'Redragon',payee_type:'factory',category:'goods',currency:'RMB',gross:100,
  cash_paid:70,deductions:20,rounding:0,outstanding:10,overdue:10,due_ever:100,
  due_today:0,due_7:0,due_30:0,due_date:'2026-10-10',lifecycle_status:'partially_paid'};
 const d={today:'2026-10-19',details:[detail],purchase_records:[{supplier_id:'s1',
  supplier_name:'Redragon',currency:'RMB',country:'印度尼西亚',total_amount:1250}],issues:[]};
 context.renderFinanceOverviewPage(d);
 const output=elements['fin-layers'].innerHTML;
 assert.match(output,/PI录入采购货值/);
 assert.match(output,/现金实际已付/);
 assert.match(output,/付款对象汇总/);
 assert.match(output,/应付与付款明细/);
 assert.match(output,/1,250\.00/);
 assert.match(output,/70\.00/);
 assert.match(output,/finOpenDetails/);
});

test('Excel export includes PI-only suppliers and creates four isolated sheets',()=>{
 const script=fs.readFileSync(path.join(root,'assets/finance-payment-overview-ui.js'),'utf8');
 const els={'content-inner':{innerHTML:''},'fin-layers':{innerHTML:''}};
 const sheets=[],book={SheetNames:[],Sheets:{}};
 const XLSX={utils:{
   book_new:()=>book,
   aoa_to_sheet:arr=>({rows:arr}),
   book_append_sheet:(b,ws,name)=>{b.SheetNames.push(name);b.Sheets[name]=ws;}
 },writeFile:(b,name)=>{sheets.push({b,name});}};
 const ctx={document:{getElementById:id=>els[id]||null},
  window:{XLSX},XLSX,fmtMoney:n=>String(n),esc:n=>String(n??''),showToast(){}};
 vm.runInNewContext(script,ctx);
 const d={today:'2026-10-19',details:[],
   purchase_records:[{supplier_id:'s2',supplier_name:'Netac',currency:'RMB',
    country:'泰国',total_amount:300,pi_status:'shipped_complete'}],issues:[]};
 ctx.renderFinanceOverviewPage(d);ctx.finExportExcel();
 assert.equal(sheets.length,1);
 assert.deepEqual([...book.SheetNames],['费用分类','付款对象','应付明细','PI采购']);
 assert.equal(book.Sheets['付款对象'].rows[1][0],'Netac');
 assert.equal(book.Sheets['PI采购'].rows[1][3],300);
});
