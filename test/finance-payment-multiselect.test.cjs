'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
const source=fs.readFileSync(path.join(root,'assets/finance-payment-overview-ui.js'),'utf8');
function runUI(data){
 const nodes={};
 for(const name of ['content-inner','fin-filters','fin-layers'])nodes[name]={innerHTML:'',textContent:''};
 let calls=0;let exported=null;
 const wb={SheetNames:[],Sheets:{}};
 const XLSX={utils:{
   book_new:()=>wb,
   aoa_to_sheet:rows=>({rows}),
   book_append_sheet:(book,sheet,name)=>{book.SheetNames.push(name);book.Sheets[name]=sheet;}
 },writeFile:(book,name)=>{exported={book,name};}};
 const ctx={document:{
   getElementById:id=>nodes[id]||null,
   addEventListener(){calls++;},
   removeEventListener(){calls--;},
   querySelector:()=>null
 },NodeFilter:{SHOW_TEXT:4},window:{XLSX},XLSX,
  esc:v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),
  fmtMoney:n=>Number(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}),
  openModal(){},showToast(){}};
 vm.createContext(ctx);vm.runInContext(source,ctx);
 ctx.renderFinanceOverviewPage(data);
 return {ctx,nodes,get exported(){return exported;},get calls(){return calls;}};
}
const record=(id,country,category,payee_key,payee_name,currency,gross)=>({
 id,fee_no:id,source_no:id,source_type:'pi',country,category,payee_key,payee_name,
 payee_type:payee_key.startsWith('supplier:')?'factory':'service_provider',
 currency,lifecycle_status:'active',gross,cash_paid:gross/2,deductions:0,rounding:0,
 outstanding:gross/2,overdue:gross/2,due_today:0,due_7:0,due_30:0,
 due_ever:gross,no_due:0,due_date:'2026-01-01'
});
function fixture(){
 return {today:'2026-10-19',issues:[],details:[
  record('a','印度尼西亚','goods','supplier:s1','Redragon','RMB',100),
  record('b','泰国','goods','supplier:s1','Redragon','RMB',200),
  record('c','印度尼西亚','warehouse_arrival','service_provider:丰年','丰年','RMB',300),
  record('d','马来西亚','warehouse_arrival','service_provider:至速','至速','IDR',400),
  record('e','马来西亚','goods','supplier:s2','Netac','IDR',500)
 ],purchase_records:[
  {id:'PI1',supplier_id:'s1',supplier_name:'Redragon',country:'印度尼西亚',currency:'RMB',total_amount:900},
  {id:'PI2',supplier_id:'s1',supplier_name:'Redragon',country:'泰国',currency:'RMB',total_amount:600},
  {id:'PI3',supplier_id:'s2',supplier_name:'Netac',country:'马来西亚',currency:'IDR',total_amount:800},
  {id:'PI4',supplier_id:'s3',supplier_name:'BOYA',country:'泰国',currency:'RMB',total_amount:700}
 ]};
}
test('four checkable multi-select menus; no single select, all table numeric columns left aligned',()=>{
 const {ctx,nodes}=runUI(fixture());
 assert.match(nodes['fin-filters'].innerHTML,/id="fin-ms-label-country"/);
 assert.match(nodes['fin-filters'].innerHTML,/id="fin-ms-label-category"/);
 assert.match(nodes['fin-filters'].innerHTML,/id="fin-ms-label-payee"/);
 assert.match(nodes['fin-filters'].innerHTML,/id="fin-ms-label-currency"/);
 assert.doesNotMatch(nodes['fin-filters'].innerHTML,/<select\b/);
 ctx.finToggleFilter('country');
 assert.match(nodes['fin-filters'].innerHTML,/type="checkbox"/);
 assert.match(nodes['fin-filters'].innerHTML,/finPick\(/);
 assert.match(nodes['fin-filters'].innerHTML,/全部 \/ 清除/);
 assert.match(nodes['content-inner'].innerHTML,/\.fin-table td\{[^}]*text-align:left!important/);
 assert.match(nodes['content-inner'].innerHTML,/\.fin-table \.fin-n\{text-align:left!important/);
 assert.doesNotMatch(nodes['content-inner'].innerHTML,/\.fin-table \.fin-n\{text-align:right/);
});
test('OR within facet, AND between country, category, payee, currency; one refresh per selection',()=>{
 const {ctx,nodes}=runUI(fixture());
 ctx.finPick('country','印度尼西亚',true);ctx.finPick('country','泰国',true);
 assert.deepEqual(Array.from(ctx.finViewRows(),r=>r.id),['a','b','c']);
 assert.equal(ctx.finSum(ctx.finViewRows(),'gross'),600);
 ctx.finPick('category','goods',true);
 assert.deepEqual(Array.from(ctx.finViewRows(),r=>r.id),['a','b']);
 ctx.finPick('payee','supplier:s1',true);
 assert.equal(ctx.finPIAmount('supplier:s1','RMB'),1500);
 ctx.finPick('country','泰国',false);
 assert.deepEqual(Array.from(ctx.finViewRows(),r=>r.id),['a']);
 assert.equal(ctx.finPIAmount('supplier:s1','RMB'),900);
 ctx.finPick('currency','IDR',true);
 assert.equal(ctx.finViewRows().length,0);
 assert.equal(ctx.finPurchaseFiltered().length,0);
 ctx.finClearFacet('currency');
 assert.equal(ctx.finViewRows().length,1);
 assert.match(nodes['fin-layers'].innerHTML,/100\.00/);
});
test('payee multi-select also contains PI-only supplier and reflects purchase filters',()=>{
 const {ctx,nodes}=runUI(fixture());
 ctx.finToggleFilter('payee');
 assert.match(nodes['fin-filters'].innerHTML,/BOYA/);
 ctx.finPick('payee','supplier:s3',true);
 assert.equal(ctx.finViewRows().length,0);
 assert.equal(ctx.finPurchaseFiltered().length,1);
 assert.equal(ctx.finPurchaseFiltered()[0].supplier_name,'BOYA');
 assert.match(nodes['fin-layers'].innerHTML,/BOYA/);
 assert.match(nodes['fin-layers'].innerHTML,/700\.00/);
});
test('Reset restores all; filter dropdown closes on Escape and outside clicks without lingering listeners',()=>{
 const ui=runUI(fixture());const {ctx}=ui;
 ctx.finToggleFilter('country');assert.equal(ui.calls,2);
 ctx.finPick('country','印度尼西亚',true);
 ctx.finPick('category','goods',true);
 ctx.finFilterKey({key:'Escape'});
 assert.equal(ui.calls,0);
 assert.equal(ctx.finViewRows().length,1);
 ctx.finToggleFilter('currency');ctx.finFilterOutside({target:{closest:()=>null}});
 assert.equal(ui.calls,0);
 ctx.finResetFilters();
 assert.equal(ctx.finViewRows().length,5);
 assert.equal(ctx.finPurchaseFiltered().length,4);
 assert.equal(ui.calls,0);
});
test('Excel shares currently selected filtered details and PI suppliers, matching displayed totals',()=>{
 const ui=runUI(fixture()),{ctx}=ui;
 ctx.finPick('country','印度尼西亚',true);
 ctx.finPick('category','goods',true);
 ctx.finPick('payee','supplier:s1',true);
 ctx.finExportExcel();
 const book=ui.exported.book;
 assert.deepEqual([...book.SheetNames],['费用分类','付款对象','应付明细','PI采购']);
 assert.equal(book.Sheets['应付明细'].rows.length,2);
 assert.equal(book.Sheets['应付明细'].rows[1][0],'a');
 assert.equal(book.Sheets['付款对象'].rows[1][3],900);
 assert.equal(book.Sheets['PI采购'].rows[1][3],900);
 assert.equal(book.Sheets['费用分类'].rows[1][3],100);
});

test('payee selections match either payee but never other payees; currency still intersects',()=>{
 const {ctx,nodes}=runUI(fixture());
 ctx.finPick('payee','supplier:s1',true);
 ctx.finPick('payee','service_provider:丰年',true);
 assert.deepEqual(Array.from(ctx.finViewRows(),r=>r.id),['a','b','c']);
 assert.equal(ctx.finPIAmount('supplier:s1','RMB'),1500);
 ctx.finPick('currency','RMB',true);
 assert.equal(ctx.finViewRows().length,3);
 ctx.finPick('currency','IDR',true);
 assert.equal(ctx.finViewRows().length,3);
 ctx.finPick('currency','RMB',false);
 assert.equal(ctx.finViewRows().length,0);
 assert.equal(ctx.finPIAmount('supplier:s1','RMB'),0);
 assert.match(nodes['fin-layers'].innerHTML,/无匹配单据/);
});
test('switching to empty overview resets filters without accumulating listeners',()=>{
 const ui=runUI(fixture()),{ctx}=ui;
 ctx.finToggleFilter('country');
 ctx.finPick('country','泰国',true);
 assert.equal(ui.calls,2);
 ctx.renderFinanceOverviewPage({today:'2026-10-19',details:[],purchase_records:[],issues:[]});
 assert.equal(ui.calls,0);
 assert.equal(ctx.finViewRows().length,0);
 assert.match(ui.nodes['fin-filters'].innerHTML,/全部国家/);
});
