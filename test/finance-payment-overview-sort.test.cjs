'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../assets/finance-payment-overview-ui.js'),'utf8');
function rec(id,payee,category,gross,overdue,due_date){
 return {id,fee_no:id,source_no:id,category,country:'ID',payee_key:'supplier:'+payee,
  payee_name:payee,payee_type:'factory',currency:'RMB',gross,cash_paid:0,
  deductions:0,rounding:0,outstanding:gross,overdue,due_today:0,due_7:0,
  due_30:0,no_due:0,due_ever:gross,due_date,lifecycle_status:'active'};
}
function fixture(){
 return {today:'2026-10-19',issues:[],details:[
  rec('PAY-10','Redragon','goods',300,100,'2026-08-01'),
  rec('PAY-2','Netac','goods',100,0,'2026-09-01'),
  rec('PAY-3','BOYA','warehouse_arrival',200,20,null)
 ],purchase_records:[
  {supplier_id:'Redragon',supplier_name:'Redragon',country:'ID',currency:'RMB',total_amount:250},
  {supplier_id:'Netac',supplier_name:'Netac',country:'ID',currency:'RMB',total_amount:500}
 ]};
}
function run(){
 const nodes=Object.fromEntries(['content-inner','fin-filters','fin-layers'].map(k=>[k,{innerHTML:''}]));
 const document={getElementById:id=>nodes[id]||null,querySelector:()=>null,
  addEventListener(){},removeEventListener(){}};
 const ctx={document,window:{},esc:x=>String(x??''),
  fmtMoney:x=>Number(x).toFixed(2)};
 vm.createContext(ctx);
 vm.runInContext(source,ctx);
 const data=fixture();
 ctx.renderFinanceOverviewPage(data);
 return {ctx,nodes,data};
}
function tableHTML(nodes,id){
 const match=nodes['fin-layers'].innerHTML.match(new RegExp('data-fin-table="'+id+'"([\\s\\S]*?)<\\/table>'));
 assert.ok(match,'table '+id+' rendered');
 return match[0];
}
function displayedDocs(nodes){return [...tableHTML(nodes,'details').matchAll(/<td>(PAY-[0-9]+)<\/td>/g)].map(m=>m[1]);}
test('three main tables offer header buttons, preserve initial overdue-priority default',()=>{
 const {nodes}=run();
 assert.equal((nodes['fin-layers'].innerHTML.match(/class="fin-sort-toggle"/g)||[]).length,28);
 assert.deepEqual(displayedDocs(nodes),['PAY-10','PAY-3','PAY-2']);
 assert.match(tableHTML(nodes,'details'),/aria-sort="none"/);
 assert.match(tableHTML(nodes,'pays'),/finOpenDetails/);
});
test('amount sort toggles ascending/descending without modifying financial records or cards',()=>{
 const {ctx,nodes,data}=run();
 const original=data.details.map(r=>r.id);
 const grossBefore=nodes['fin-layers'].innerHTML.match(/fin-card-value">([\s\S]*?)<\/div>/)[1];
 ctx.finToggleSort('details','gross');
 assert.deepEqual(displayedDocs(nodes),['PAY-2','PAY-3','PAY-10']);
 assert.match(tableHTML(nodes,'details'),/aria-sort="ascending"/);
 ctx.finToggleSort('details','gross');
 assert.deepEqual(displayedDocs(nodes),['PAY-10','PAY-3','PAY-2']);
 assert.match(tableHTML(nodes,'details'),/fin-sort-down is-active/);
 assert.deepEqual(data.details.map(r=>r.id),original);
 assert.equal(nodes['fin-layers'].innerHTML.match(/fin-card-value">([\s\S]*?)<\/div>/)[1],grossBefore);
});
test('date sort keeps missing due dates last in BOTH directions; document labels sort naturally',()=>{
 const {ctx,nodes}=run();
 ctx.finToggleSort('details','due_date');
 assert.deepEqual(displayedDocs(nodes),['PAY-10','PAY-2','PAY-3']);
 ctx.finToggleSort('details','due_date');
 assert.deepEqual(displayedDocs(nodes),['PAY-2','PAY-10','PAY-3']);
 ctx.finToggleSort('details','document');
 assert.deepEqual(displayedDocs(nodes),['PAY-2','PAY-3','PAY-10']);
});
test('category aggregate and PI purchase value sort numerically on filtered data',()=>{
 const {ctx,nodes}=run();
 ctx.finToggleSort('cats','gross');
 let html=tableHTML(nodes,'cats');
 assert.ok(html.indexOf('物流/到仓')<html.indexOf('采购货款'));
 ctx.finToggleSort('cats','gross');
 html=tableHTML(nodes,'cats');
 assert.ok(html.indexOf('采购货款')<html.indexOf('物流/到仓'));
 ctx.finToggleSort('pays','pi_amount');
 html=tableHTML(nodes,'pays');
 assert.ok(html.indexOf('BOYA')<html.indexOf('Redragon'),'zero PI amount sorts as zero, not missing');
 assert.ok(html.indexOf('Redragon')<html.indexOf('Netac'));
 ctx.finPick('category','goods',true);
 html=tableHTML(nodes,'details');
 assert.doesNotMatch(html,/PAY-3/);
 assert.match(html,/PAY-10/);
 assert.match(tableHTML(nodes,'pays'),/aria-sort="ascending"/);
 ctx.finToggleSort('pays','pi_amount');
 assert.ok(tableHTML(nodes,'pays').indexOf('Netac')<tableHTML(nodes,'pays').indexOf('Redragon'));
});
test('table sorts are independent and unknown columns ignored',()=>{
 const {ctx,nodes}=run();
 ctx.finToggleSort('details','gross');
 ctx.finToggleSort('cats','category_label');
 assert.match(tableHTML(nodes,'cats'),/aria-sort="ascending"/);
 assert.match(tableHTML(nodes,'details'),/aria-sort="ascending"/);
 const html=nodes['fin-layers'].innerHTML;
 ctx.finToggleSort('details','not-a-column');
 assert.equal(nodes['fin-layers'].innerHTML,html);
});
