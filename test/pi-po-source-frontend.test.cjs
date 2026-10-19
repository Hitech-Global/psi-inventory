'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const code=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
const script=fs.readFileSync(path.join(__dirname,'..','assets/pi-multi-po-ui.js'),'utf8');
function between(start,end){
 const i=code.indexOf(start),j=code.indexOf(end,i);
 assert.ok(i>=0&&j>i,'source fragment '+start);return code.slice(i,j);
}
const build=vm.runInNewContext('('+between('function buildMultiPOEditableRows(poRef,pi){','async function editPI(id){').trim()+')');
test('edit reload keeps same SKU from 2 POs as distinct rows, each with own price/qty',()=>{
 const pi={items:[{sku_code:'M724',pi_confirmed_qty:50,unit_price:10.8,discount:.03}],
  po_allocations:[
   {po_no:'PO-A',sku_code:'M724',allocated_qty:30,pi_unit_price:10,pi_discount:.1},
   {po_no:'PO-B',sku_code:'M724',allocated_qty:20,pi_unit_price:12,pi_discount:0}
  ]};
 const source=[
  {po_id:'a',po_no:'PO-A',sku_code:'M724',po_qty:100,transferred_pi_qty:40,unit_price:9},
  {po_id:'b',po_no:'PO-B',sku_code:'M724',po_qty:50,transferred_pi_qty:35,unit_price:11}
 ];
 const rows=build(source,pi);
 assert.equal(rows.length,2);
 assert.deepEqual(Array.from(rows,r=>[r.poNo,r.sku,r.piQty,r.piPrice,r.piDisc,r.poQty]),
  [['PO-A','M724',30,10,.1,90],['PO-B','M724',20,12,0,35]]);
});
test('legacy multi-PO ledger with no source price falls back to old aggregate PI price',()=>{
 const rows=build([
  {po_id:'a',po_no:'PO-A',sku_code:'K617',po_qty:40,transferred_pi_qty:20,unit_price:5}
 ],{items:[{sku_code:'K617',pi_confirmed_qty:20,unit_price:9,discount:.05}],
 po_allocations:[{po_no:'PO-A',sku_code:'K617',allocated_qty:20,pi_unit_price:null,pi_discount:null}]});
 assert.equal(rows.length,1);
 assert.equal(rows[0].piPrice,9);
 assert.equal(rows[0].piDisc,.05);
});
test('source PO number renders before SKU and sourced SKU is read-only',()=>{
 const fn=vm.runInNewContext('('+between('function cmpRowHTML(idx,r){','function updCmpRow(idx){').trim()+')',
  {esc:String,fmtMoney:x=>String(x)});
 const html=fn(0,{poNo:'PO-A',poId:'a',sku:'M724',fromPO:true,poQty:30,poPrice:9,piQty:15,piPrice:10,piDisc:0});
 assert.ok(html.indexOf('PO-A')<html.indexOf('id="pi-rsk-0"'));
 assert.match(html,/readonly title="PO来源SKU不可更改"/);
 assert.match(between('function renderCmpTable(){','function cmpRowHTML(idx,r){'),/pi-po-source-head/);
 assert.match(between('function saveNewPI(){','async function createDepPay(').replace(/^/,'async '),/po_source_items/);
});
test('supplier PI import refuses ambiguous SKU-only data in multiple POs',()=>{
 const src=between('async function submitSupplierPIImport(){','function downloadSupplierPIImportErrors(){');
 assert.match(src,/ambiguous=new Set/);
 assert.match(src,/相同SKU来自多张PO/);
 assert.match(script,/poNo:po.po_no/);
});
test('separate per-PO detail is rendered while CI records still aggregate by SKU',()=>{
 assert.match(code,/function piSeparatedDetailRows\(pi,poRef\)/);
 assert.match(code,/a\.pi_unit_price/);
 assert.match(code,/window\._editingPIIsMultiPO\?buildMultiPOEditableRows/);
});

test('PI detail uses one displayed row per source PO and does not invent PO-level shipped quantities',()=>{
 const buildDetail=vm.runInNewContext('('+between('function piSeparatedDetailRows(pi,poRef){','function renderPIReadonlyByPO(rows){').trim()+')');
 const pi={related_po_no:'PO-A',
   items:[{sku_code:'M724',pi_confirmed_qty:50,unit_price:10,discount:0,pi_amount:500,shipped_qty:15,unshipped_qty:35}],
   po_allocations:[
     {po_no:'PO-A',sku_code:'M724',allocated_qty:30,pi_unit_price:10,pi_discount:0},
     {po_no:'PO-B',sku_code:'M724',allocated_qty:20,pi_unit_price:12,pi_discount:.1}
   ]};
 const ref=[{po_no:'PO-A',sku_code:'M724',po_qty:80},{po_no:'PO-B',sku_code:'M724',po_qty:40}];
 const rows=buildDetail(pi,ref);
 assert.deepEqual(Array.from(rows,r=>[r.po_no,r.sku_code,r.pi_confirmed_qty,r.unit_price,r.po_qty]),
  [['PO-A','M724',30,10,80],['PO-B','M724',20,12,40]]);
 assert.equal(rows[0].shipped_qty,null);
 assert.equal(rows[1].unshipped_qty,null);
 assert.match(code,/i\.shipped_qty==null\?'—'/);
 assert.match(code,/insertPIDetailSummaryRow\(_piItemsTbl,pi\.items\|\|\[\]\)/);
});
test('PO comparison uses source-separated rows for a multi PO PI',()=>{
 assert.match(code,/renderPIReadonlyByPO\(buildMultiPOEditableRows\(poRef,pi\)\)/);
 const src=between('function renderPIReadonlyByPO(rows){','async function viewPI(id, backPay, backMode){');
 assert.match(src,/<th style="text-align:left">PO号<\/th>/);
 assert.match(src,/esc\(r\.poNo\|\|'-'\)/);
});
