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

test('keeps supplier shipment CTN totals for mixed cartons and recalculates edits by row delta',()=>{
  assert.match(appSource,/function getPLDraftTotalCartons\(items\)/);
  assert.match(appSource,/baseTotal\+rowsSum-baseRows/);
  assert.match(appSource,/const shipmentCartons=getPLDraftTotalCartons\(items\)/);
  assert.match(appSource,/id="npl-total-ctn"[^>]*onchange="updatePLTotalCartons\(this.value\)"/);
  assert.match(appSource,/total_cartons:getPLDraftTotalCartons\(items\)/);
});

test('recalculates Redragon PL CTN total immediately after a SKU carton edit',()=>{
  const getTotal=loadPLCartonTotal(588,588);
  const currentRows=[{cartons:36},{cartons:10},{cartons:109},{cartons:40},{cartons:28},{cartons:60},{cartons:306}];
  assert.equal(getTotal(currentRows),589);
  currentRows[0].cartons=34;
  assert.equal(getTotal(currentRows),587);
});

test('preserves Netac mixed-carton shipment total while applying manual SKU carton edits',()=>{
  const getTotal=loadPLCartonTotal(12,9);
  assert.equal(getTotal([{cartons:7},{cartons:3}]),13);
  assert.equal(getTotal([{cartons:7},{cartons:1}]),11);
});

function loadPLCartonTotal(baseTotal,baseRows){
  const start=appSource.indexOf('function plDraftCartonSum(items){');
  const end=appSource.indexOf('\nfunction updatePLTotalCartons(value){',start);
  assert.ok(start>=0&&end>start,'PL carton total helpers must exist');
  const helperSource=appSource.slice(start,end);
  const sandbox={window:{_plCartonTotalBase:baseTotal,_plCartonRowsBaseSum:baseRows},Number,Math};
  require('node:vm').runInNewContext(helperSource+'\nthis.__getTotal=getPLDraftTotalCartons;',sandbox);
  return sandbox.__getTotal;
}


function makeRedragonWorkbook(){
  const rows=[
    ['Eastern Times Electronics Technology Co. limited'],
    ['PACKING LIST'],
    [],
    ['TO: PT HITECH NUSANTARA MAKMUR',null,null,null,null,null,null,null,null,'Date: 2026-10-20'],
    [null,null,null,null,null,null,null,null,null,'INV NO: HIT20261009-1A'],
    ['Model No.','Description','QTY/\nCTN','Total CTN','Total QTY','N.W.','Total N.W.','G.W.','Total G.W.','CTN DIMENSION(CM)',null,null,'CBM','Total CBM'],
    [null,null,null,'(CTN)','(PCS)','(KGS)','(KGS)','(KGS)','(KGS)','L','W','H',null,null],
    ['RDK521RGB','keyboard',10,109,1090,7.05,768.45,7.58,826.22,45.8,38,18.5,0.0321974,3.5095166],
    ['RDK630RGB','keyboard',10,35,350,7.35,257.25,7.94,277.9,34.2,27.5,32.8,0.0308484,1.079694],
    ['RDK671','keyboard',10,28,280,9.45,264.6,9.91,277.48,47,46,18,0.038916,1.089648],
    ['RDK526BPPRO','keyboard',10,26,260,8.8,228.8,9.41,244.66,46.7,26.2,34,0.04160036,1.08160936],
    ['RDK527WBLPRO','keyboard',10,60,600,9.75,585,10.27,616.2,44,27,35.5,0.042174,2.53044],
    ['RDK527WGLPRO','keyboard',10,40,400,10,400,10.68,427.2,44,27,35.5,0.042174,1.68696],
    ['RDK724SPRGBPRO','keyboard',10,5,50,11.86,59.3,12.64,63.2,39.5,35,41,0.0566825,0.2834125],
    ['NAGA M730-RGB','mouse',40,2,80,5.6,11.2,6.26,12.52,31,30.3,38.5,0.03616305,0.0723261],
    ['RDM612RGB','mouse',60,14,840,10.68,149.52,11.98,167.72,56,28,29.7,0.0465696,0.6519744],
    ['RDM724W','mouse',60,6,360,9.6,57.6,10.51,63.06,52.5,36.2,35.5,0.06746775,0.4048065],
    ['RDM916LIT1K','mouse',40,5,200,5.6,28,6.44,32.2,55.3,39.9,19.2,0.042364224,0.21182112],
    ['RDM933CWULT','mouse',40,3,120,9.8,29.4,10.8,32.4,52.5,36,24.5,0.046305,0.138915],
    ['RDM933TFULT','mouse',40,3,120,10.23,30.69,11.23,33.69,52.5,36,24.5,0.046305,0.138915],
    ['RDM933ULT','mouse',40,5,200,9.8,49,10.8,54,52.5,36,24.5,0.046305,0.231525],
    ['RDM995GBLIT','mouse',60,29,1740,8.68,251.72,10.68,309.72,53,28.5,29.5,0.04455975,1.29223275],
    ['RDM998STD','mouse',20,6,120,5.9,35.4,6.47,38.82,41.5,31.5,33.3,0.043531425,0.26118855],
    ['RDP029','mousepad',40,10,400,10.8,108,11.94,119.4,48.5,22.4,19.7,0.02140208,0.2140208],
    ['RDGS515','speaker',20,93,1860,17,1581,18.06,1679.58,49.5,46,39.8,0.0906246,8.4280878],
    ['RDGS520','speaker',20,70,1400,17.1,1197,18.48,1293.6,57,35.4,39,0.0786942,5.508594],
    ['RDGS560B','speaker',20,34,680,17.5,595,20.16,685.44,55,45.8,46.8,0.1178892,4.0082328],
    ['RDGS560W','speaker',20,2,40,17.5,35,20.16,40.32,55,45.8,46.8,0.1178892,0.2357784],
    ['RDBM2995','mouse',60,3,180,10.8,32.4,11.52,34.56,55,40,22.5,0.0495,0.1485],
    ['TOTAL:',null,null,588,11370,null,6754.33,null,7329.89,null,null,null,null,33.20819868]
  ];
  return {
    SheetNames:['INV','PL'],
    Sheets:{
      INV:{rows:[['Model NO.','Description','Total Qty (PCS)','Unit Price'],['RDK521RGB','keyboard',1090,41.27]]},
      PL:{rows}
    }
  };
}

test('recognizes Redragon Eastern Times PL with its two-row header and exact total columns',()=>{
  const parsed=parser.parseWorkbook(makeRedragonWorkbook(),fakeXlsx());
  assert.equal(parsed.source_sheet,'PL');
  assert.equal(parsed.reference_ci_no,'HIT20261009-1A');
  assert.equal(parsed.items.length,22);
  assert.equal(parsed.total_cartons,588);
  assert.equal(parsed.items.reduce((sum,item)=>sum+item.total_qty,0),11370);
  assert.equal(parsed.items.reduce((sum,item)=>sum+item.cartons,0),588);
  assert.ok(Math.abs(parsed.items.reduce((sum,item)=>sum+item.gross_weight,0)-7329.89)<1e-9);
  assert.ok(Math.abs(parsed.items.reduce((sum,item)=>sum+item.net_weight,0)-6754.33)<1e-9);
  assert.ok(Math.abs(parsed.total_cbm-33.20819868)<1e-9);
  assert.ok(Math.abs(parsed.items.reduce((sum,item)=>sum+item.cbm,0)-33.20819868)<1e-9);
  assert.equal(parsed.items.find(item=>item.sku_code==='NAGA M730-RGB').total_qty,80);
  assert.equal(parsed.items.find(item=>item.sku_code==='RDK521RGB').cartons,109);
});

test('supports a genuinely split two-row header such as Model / No. and Total / QTY',()=>{
  const rows=[
    ['Model','Total','Total','Total','Total','Total'],
    ['No.','QTY (PCS)','CTN (CTN)','N.W. (KGS)','G.W. (KGS)','CBM'],
    ['SKU-1',100,10,20,22,0.4],
    ['TOTAL:',null,10,null,22,null,0.4]
  ];
  const parsed=parser.parsePackingListRows(rows,0);
  assert.equal(parsed.items[0].sku_code,'SKU-1');
  assert.equal(parsed.items[0].total_qty,100);
  assert.equal(parsed.items[0].cartons,10);
  assert.equal(parsed.items[0].net_weight,20);
  assert.equal(parsed.items[0].gross_weight,22);
});

test('validates imported SKU quantities against CI remaining quantities',()=>{
  const result=parser.validateImportAgainstCI(
    [{sku_code:'rdk521rgb',total_qty:80},{sku_code:'UNKNOWN',total_qty:5},{sku_code:'RDM724W',total_qty:101}],
    [{sku_code:'RDK521RGB',shipped_qty:100},{sku_code:'RDM724W',shipped_qty:120}],
    [{sku_code:'RDK521RGB',pl_qty:20},{sku_code:'RDM724W',pl_qty:30}]
  );
  assert.equal(result.matched,2);
  assert.deepEqual(result.unmatched,['UNKNOWN']);
  assert.deepEqual(result.overages,[{sku_code:'RDM724W',imported_qty:101,remaining_qty:90}]);
});

test('PL import applies only after format and quantity validation and warns when document CI number differs',()=>{
  const start=appSource.indexOf('function handlePLFile(file){');
  const end=appSource.indexOf('\nfunction renderOtherFees()',start);
  const handler=appSource.slice(start,end);
  assert.ok(start>=0&&end>start);
  assert.ok(handler.includes('validateImportAgainstCI'));
  assert.ok(handler.indexOf('validation.overages.length')<handler.indexOf('window._plDraft=nextDraft'));
  assert.ok(handler.includes('原有PL草稿未改变'));
  assert.ok(handler.includes('referenceCiNo'));
  assert.ok(handler.includes('与当前CI'));
  const saveStart=appSource.indexOf('async function saveLogWithPL(){');
  const saveEnd=appSource.indexOf('\nasync ',saveStart+20);
  const save=appSource.slice(saveStart,saveEnd);
  assert.ok(save.includes('超过CI剩余数量'));
  assert.ok(save.includes('total_cartons:getPLDraftTotalCartons(items)'),'saved total CTN must use the same live recalculation as the UI');
});
