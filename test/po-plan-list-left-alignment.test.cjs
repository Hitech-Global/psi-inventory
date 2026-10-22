'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const src=fs.readFileSync(path.join(root,'po-plan-ui.js'),'utf8');
const bootstrap=require('../scripts/po-plan-bootstrap.cjs');
function extract(begin,end){
  const start=src.indexOf(begin),stop=src.indexOf(end,start);
  assert.ok(start>=0&&stop>start,begin);
  return src.slice(start,stop);
}
const four=['明细','计划数量','已转PI','剩余可转'];
test('active PO table has a left-aligned header for each of the four problem fields',()=>{
  const fn=extract('function drawPOPlan(data){','async function createPOPlan(');
  for(const label of four){
    assert.ok(fn.includes('<th class="po-plan-col-left">'+label+'</th>'),label);
  }
});
test('actual PO table row has left-aligned cells, no center/right override, preserves data values',()=>{
  const el={innerHTML:'',querySelectorAll:()=>[]};
  const ctx={
    $:()=>el, E:v=>String(v??''),qty:v=>Math.max(0,Math.trunc(Number(v)||0)),
    global:{fmtDate:d=>d,hasPermission:()=>false},
    statusClass:()=>'',statusText:()=>'',viewPOPlan:()=>{},
  };
  vm.createContext(ctx);
  vm.runInContext(extract('function drawPOPlan(data){','async function createPOPlan('),ctx);
  ctx.drawPOPlan([{id:'po-1',po_no:'PO-ONE',supplier_name:'Netac',brand:'Netac',
    country:'印度尼西亚',target_warehouse:'Bekasi Warehouse',po_date:'2026-10-12',
    item_count:27,planned_qty:11025,transferred_qty:0,remaining_qty:11025,plan_status:'open'}]);
  const html=el.innerHTML;
  assert.equal((html.match(/<th class="po-plan-col-left">/g)||[]).length,4);
  assert.equal((html.match(/<td class="po-plan-col-left(?: po-plan-(?:num|used|remain))?">/g)||[]).length,4);
  assert.match(html,/<td class="po-plan-col-left">27<\/td>/);
  assert.match(html,/<td class="po-plan-col-left po-plan-num">11025<\/td>/);
  assert.match(html,/<td class="po-plan-col-left po-plan-used">0<\/td>/);
  assert.match(html,/<td class="po-plan-col-left po-plan-remain">11025<\/td>/);
  assert.doesNotMatch(html,/class="text-(?:center|right) po-plan/);
});
test('CSS changes are scoped only to actual PO table headers and cells',()=>{
  const style=extract('function ensureCss(){','function renderPOPlan(){');
  assert.match(style,/#po-table \.data-table th\.po-plan-col-left,#po-table \.data-table td\.po-plan-col-left\{text-align:left!important\}/);
  assert.doesNotMatch(style,/#pi-table[^\n]*po-plan-col-left/);
});
test('PO script revision changes so browser does not retain old centered table',()=>{
  assert.equal(bootstrap.ASSET_VERSION,'20261022d');
  assert.match(bootstrap.UI_MARKER,/po-plan-ui\.js\?v=20261022d/);
});
