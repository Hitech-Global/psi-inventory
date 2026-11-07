'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const parser=require('../assets/pl-import-parser.js');
const fs=require('node:fs');
const path=require('node:path');
const appSource=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');

function fakeXlsx(){
  return {utils:{sheet_to_json(sheet,options){
    assert.equal(options.header,1);
    assert.equal(options.defval,'');
    return sheet.rows;
  }}};
}
function makeWorkbook(){
  const plRows=[
    ['NETAC'],
    ['PACKING LIST'],
    [],
    ['Description','Item','QTY(PCS)','N.W.(KG)',' G.W.(KG)','CNT NO.','REMARK','MEAS','HS CODE'],
    ['USB FLASH DRIVE','NT03UA31N-008G-20BL',3000,42,46.8,'#4-#9','#4-#9=500PCS','(54*29*28.6)CM*12CTNS',85235111],
    ['USB FLASH DRIVE','NT03U197N-008G-20BK',760,11.9,13.2,'#2，#3','#2=500PCS，#3=260PCS','',85235111],
    ['USB FLASH DRIVE','NT03UM81N-008G-20BK',500,6.6,7.4,'#11','','',85235111],
    ['Total:','',4260,60.5,67.4,12,'','0.54CBM']
  ];
  return {
    SheetNames:['数据源','IN','PL'],
    Sheets:{
      '数据源':{rows:[['Source'],['ignore me']]},
      'IN':{rows:[['Description','Item','QTY(PCS)','Unit Price']]},
      'PL':{rows:plRows}
    }
  };
}

test('automatically finds the PL worksheet even when it is not the first sheet',()=>{
  const parsed=parser.parseWorkbook(makeWorkbook(),fakeXlsx());
  assert.equal(parsed.source_sheet,'PL');
  assert.equal(parsed.items.length,3);
  assert.equal(parsed.total_cartons,12);
  assert.equal(parsed.total_cbm,0.54);
});
test('maps Item, QTY, weights and unique carton references to each SKU',()=>{
  const parsed=parser.parseWorkbook(makeWorkbook(),fakeXlsx());
  const first=parsed.items.find(item=>item.sku_code==='NT03UA31N-008G-20BL');
  const second=parsed.items.find(item=>item.sku_code==='NT03U197N-008G-20BK');
  const third=parsed.items.find(item=>item.sku_code==='NT03UM81N-008G-20BK');
  assert.deepEqual(
    [first.total_qty,first.cartons,first.gross_weight,first.net_weight],
    [3000,6,46.8,42]
  );
  assert.deepEqual(
    [second.total_qty,second.cartons,second.gross_weight,second.net_weight],
    [760,2,13.2,11.9]
  );
  assert.deepEqual(
    [third.total_qty,third.cartons,third.gross_weight,third.net_weight],
    [500,1,7.4,6.6]
  );
});
test('allocates total CBM by gross-weight share and preserves the shipment total',()=>{
  const parsed=parser.parseWorkbook(makeWorkbook(),fakeXlsx());
  const sum=parsed.items.reduce((value,item)=>value+item.cbm,0);
  assert.ok(Math.abs(sum-0.54)<1e-9);
  const first=parsed.items.find(item=>item.sku_code==='NT03UA31N-008G-20BL');
  assert.ok(Math.abs(first.cbm-(0.54*46.8/67.4))<1e-6);
});
test('can derive total CBM from a merged MEAS dimensions cell when the total row has no CBM',()=>{
  const rows=makeWorkbook().Sheets.PL.rows.map(row=>row.slice());
  rows[7][7]='';
  const parsed=parser.parsePackingListRows(rows,3);
  assert.ok(Math.abs(parsed.total_cbm-0.5374512)<1e-9);
  assert.ok(Math.abs(parsed.items.reduce((sum,item)=>sum+item.cbm,0)-parsed.total_cbm)<1e-9);
});
test('does not mistake the existing standard import template for a vendor PL sheet',()=>{
  const workbook={
    SheetNames:['标准模板'],
    Sheets:{'标准模板':{rows:[['SKU','数量','CTN数量','总毛重','总净重','总体积'],['SKU-1',10,1,2,1.8,0.02]]}}
  };
  assert.equal(parser.parseWorkbook(workbook,fakeXlsx()),null);
});
test('handles duplicate carton IDs across SKUs without inflating the shipment carton total',()=>{
  const rows=[
    ['Description','Item','QTY(PCS)','N.W.(KG)','G.W.(KG)','CNT NO.','MEAS'],
    ['A','SKU-A',10,1,1.2,'#1-#2',''],
    ['B','SKU-B',10,1,1.2,'#2-#3',''],
    ['Total:','',20,2,2.4,3,'0.01CBM']
  ];
  const parsed=parser.parsePackingListRows(rows,0);
  assert.equal(parsed.items[0].cartons,2);
  assert.equal(parsed.items[1].cartons,2);
  assert.equal(parsed.total_cartons,3);
});

test('shows the shipment CTN total for mixed-carton supplier PL files instead of summing overlapping SKU carton counts',()=>{
  assert.match(appSource,/const shipmentCartons=window\._plImportSourceSheet&&Number\(window\._plImportTotalCartons\)>0\?Number\(window\._plImportTotalCartons\):tc/);
  assert.match(appSource,/\+shipmentCartons\+'<\/td>/);
  assert.match(appSource,/id="npl-total-ctn"[^>]*onchange="renderPLDraftTable\(\)"/);
});
