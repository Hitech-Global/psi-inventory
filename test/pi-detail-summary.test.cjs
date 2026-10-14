'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
const from=source.indexOf('function calcPIDetailTotals(items){');
const to=source.indexOf('async function viewPI(',from);
assert(from>=0&&to>from,'PI detail summary function source not found');
const created=[];
function cell(tag) {
  const element={tag,children:[],textContent:'',className:'',appendChild(child){this.children.push(child);return child;}};
  created.push(element);return element;
}
const context={document:{createElement:cell},fmtMoney:(n)=>Number(n).toFixed(2),t:(key,fallback)=>key==='common.total'?'合计':fallback};
const fns=vm.runInNewContext(source.slice(from,to)+'\n({calcPIDetailTotals,insertPIDetailSummaryRow})',context);
const {calcPIDetailTotals,insertPIDetailSummaryRow}=fns;
function table() {
  const body={children:[],get firstChild(){return this.children[0]||null;},
    querySelector(selector){return selector==='.pi-detail-summary-row'?this.children.find(x=>x.className==='pi-detail-summary-row')||null:null;},
    insertBefore(row,first){if(first){this.children.splice(this.children.indexOf(first),0,row);}else this.children.push(row);}};
  const old={className:'sku-line'};
  body.children.push(old);
  return {table:{tBodies:[body]},body,old};
}
test('PI 详情汇总使用接口显示的 5 个指标，金额逐行分位相加',()=>{
  const items=[
    {po_qty:'0',pi_confirmed_qty:'50',pi_amount:'1565.50',shipped_qty:0,unshipped_qty:50},
    {po_qty:10,pi_confirmed_qty:20,pi_amount:355.6,shipped_qty:5,unshipped_qty:15},
    {po_qty:15,pi_confirmed_qty:3,pi_amount:0.1,shipped_qty:1,unshipped_qty:2},
    {po_qty:null,pi_confirmed_qty:undefined,pi_amount:'0.20',shipped_qty:null,unshipped_qty:null},
  ];
  const totals=calcPIDetailTotals(items);
  assert.equal(totals.po_qty,25);
  assert.equal(totals.pi_confirmed_qty,73);
  assert.equal(totals.amount_cents,192140);
  assert.equal(totals.shipped_qty,6);
  assert.equal(totals.unshipped_qty,67);
  const result=table();
  insertPIDetailSummaryRow(result.table,items);
  const cells=result.body.children[0].children.map(x=>x.textContent);
  assert.equal(result.body.children[0].className,'pi-detail-summary-row');
  assert.deepEqual(cells,['合计','25','73','—','—','1921.40','6','67']);
  assert.strictEqual(result.body.children[1],result.old,'original SKU row remains unchanged');
});
test('空明细也可显示零汇总，重复调用不叠加',()=>{
  const result=table();
  insertPIDetailSummaryRow(result.table,[]);
  insertPIDetailSummaryRow(result.table,[{pi_amount:12345}]);
  assert.equal(result.body.children.length,2);
  assert.deepEqual(result.body.children[0].children.map(x=>x.textContent),['合计','0','0','—','—','0.00','0','0']);
});
test('读取版 PI 专用，编辑对比表不被修改，顶部样式只限定 PI detail',()=>{
  assert(source.includes("insertPIDetailSummaryRow(_piItemsTbl,pi.items||[])"));
  assert(source.includes(".data-table:not(.pi-cmp-table)"));
  assert(!source.slice(source.indexOf('async function editPI('),source.indexOf('async function saveEditPI(')).includes('insertPIDetailSummaryRow'));
  const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
  assert(html.includes('.modal-pi .pi-items-readonly tbody tr.pi-detail-summary-row td'));
  assert(html.includes('border-bottom:2px solid'));
  assert(source.includes("t('common.total','汇总')"));
});
