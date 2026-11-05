'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=fs.readFileSync(path.join(__dirname,'..','quotation-import-normalizer.js'),'utf8');
const window={api:()=>Promise.resolve({}),XLSX:null};
const document={readyState:'complete',addEventListener(){}};
vm.runInNewContext(source,{window,document,setTimeout(){},console},{timeout:1000});
const n=window.QuotationImportNormalizer;
assert(n,'quotation import normalizer must be exposed');
assert.equal(n.BRAND_CCY.GoPro,'IDR','GoPro quote currency must default to IDR');
const goproNormalized=n.normalizeRow({SKU:'CHDHW-010-RW',brand:'GoPro',quote_price:12300000,quote_date:'2026-11-01'});
assert.equal(goproNormalized.currency,'IDR','GoPro rows should inherit IDR when currency is omitted');
assert.equal(n.validateRows([goproNormalized]).length,0,'GoPro IDR quote rows should pass validation');

const parsed=n.parseSheetRows([
  {name:'Price List',rows:[
    ['NETAC SUPPLIER PRICE LIST'],
    ['Item No','Model','Product Type','FOB USD','Date'],
    ['NT-SSD-001','N535S','SSD',12.5,'2026-11-04'],
    ['NT-SSD-002','N600S','SSD',13.25,'2026-11-04']
  ]},
  {name:'Summary',rows:[['Total','Amount'],['Total','100']]},
  {name:'USB',rows:[
    ['Supplier Part Number','Model','FOB Price','Currency','Brand'],
    ['LEGACY-USB-01','U905',0,'USD','NETAC'],
    ['LEGACY-USB-02','U906','','USD','Netac'],
    ['LEGACY-USB-03','U907','USD 1.25','USD','Netac']
  ]}
],{brand:'Netac',quote_date:'2026-11-04',supplier_id:'supplier-netac'});

assert.equal(parsed.rows.length,5,'all recognized sheets should be read');
assert.equal(parsed.recognized_sheets.length,2,'both quote sheets should be recognized');
assert.equal(parsed.ignored_sheets.length,1,'non-quote sheets should be skipped');
assert.equal(parsed.rows[0].supplier_part_no,'NT-SSD-001');
assert.equal(parsed.rows[0].currency,'USD','currency should be inferred from price header');
assert.equal(parsed.rows[0].quote_price,12.5);
assert.equal(parsed.rows[2].quote_price,0,'explicit zero should be retained as no quote');
assert.equal(parsed.rows[3].quote_price,0,'blank price should become no quote');
assert.equal(parsed.rows[3].quote_date_source,'default','default date source should be tracked');
assert.equal(parsed.rows[4].quote_price,1.25,'currency-prefixed text prices should be parsed');

const netacModelSheet=n.parseSheetRows([{
  name:'Netac Weekly Price',
  rows:[
    ['Netac Weekly Distribution Price List'],
    ['Product','Model','FOB USD'],
    ['USB Flash Drive','NT03U278N-032G-20PN',12.5]
  ]
}],{brand:'Netac',quote_date:'2026-11-04',supplier_id:'supplier-netac'});
assert.equal(netacModelSheet.recognized_sheets.length,1,'Netac Product/Model/FOB headers should be recognized');
assert.equal(netacModelSheet.rows[0].product_type,'USB Flash Drive','Product should map to product type');
assert.equal(netacModelSheet.rows[0].supplier_part_no,'NT03U278N-032G-20PN','Model should be used as the SKU/part key when no explicit part number exists');
assert.equal(netacModelSheet.rows[0].model,'NT03U278N-032G-20PN','Model should remain visible in preview');
assert.equal(netacModelSheet.rows[0].currency,'USD','FOB USD header should infer USD');
const modelOnlyNormalized=n.normalizeRow({Model:'NT03U278N-032G-20PN',Product:'USB Flash Drive',brand:'Netac',quote_price:12.5,quote_date:'2026-11-04'});
assert.equal(modelOnlyNormalized.supplier_part_no,'NT03U278N-032G-20PN','Model-only rows should normalize to a SKU/part key');
assert.equal(modelOnlyNormalized.product_type,'USB Flash Drive','Product should normalize to product type');
assert.equal(n.validateRows([modelOnlyNormalized]).length,0,'Model-only Netac rows should pass validation');

const netacRealSheets=[
  {name:'SSD',rows:[
    ['Netac Price List-SSD Drive Date: Oct 27, 2026'],
    ['Product Pic.','Product','Type','Model','Capacity','Part No.','Product Description','Warranty Period','Inner CT QTY','Master CT QTY','Unit Price (USD/pc)','EAN Code'],
    [null,'SSD','2.5 SATAIII','N535S','240GB','NT01N535S-240G-S3X','Netac N535S 240GB SSD','5 years',50,100,25.56,6926337223551]
  ]},
  {name:'DRAM',rows:[
    ['Netac Price List-Memory Modules Date: Oct 27, 2026'],
    ['Series','Product pictures','Model / PN','Product name','Heatsink color','Type','Speed (MHz)','Bandwidth (MB/s)','Capacity (GB)','Timing','Voltage','support XMP','Kit','EAN Code','Inner CT QTY','Master CT QTY','Unit Price (US$)','Remark'],
    ['Z RGB DDR5',null,'NTZED5P76DP-32S','Z RGB DDR5-7600 32GB','Silver','U-DIMM 288-Pin DDR5 / PC','DDR5-7600','PC5-57600','32GB','36-46-46-122','1.4V','XMP','Dual Channel','6926337237053','N/A',100,12.5,'']
  ]},
  {name:'TWS',rows:[
    ['Netac Price List-Smart Wearing Products Date: Oct 27, 2026'],
    ['Product Pic.','Color','Feature','Model','Part NO.','Product Description','Inner CT QTY','Master CT QTY','Unit Price (USD/pc)','EAN','Order Quantity','Sum'],
    [null,'Black','Bluetooth earbuds','OS01','OS01BEN','Netac OS01 earbuds','N/A',100,9.58,6926337239002,null,null]
  ]},
  {name:'Weight & size',rows:[
    ['Netac Products Packing Data'],
    ['Product Type','Model','N.W Product'],
    ['DRAM','Shadow DDR4&DDR5','34.7g']
  ]}
];
const inferredNetacDate=n.inferQuoteDate(netacRealSheets,'Netac Weekly Distribution Price list Oct 27, 2026(1).xlsx');
assert.equal(inferredNetacDate,'2026-10-27','Netac title/filename date should be inferred');
assert.equal(n.inferQuoteDate([],'Netac Weekly Distribution Price list Sep 15, 2026.xlsx'),'2026-09-15','filename date fallback should be supported');
const netacRealParsed=n.parseSheetRows(netacRealSheets,{brand:'Netac',quote_date:inferredNetacDate,supplier_id:'supplier-netac'});
assert.equal(netacRealParsed.recognized_sheets.length,3,'real Netac SSD, DRAM and TWS quote sheets should be recognized');
assert.equal(netacRealParsed.ignored_sheets.length,1,'Weight & size should be ignored because it has no quote price');
assert.equal(netacRealParsed.rows.length,3);
assert.equal(netacRealParsed.rows[0].product_type,'SSD','Product should be preferred as product type');
assert.equal(netacRealParsed.rows[0].spec,'2.5 SATAIII / 240GB','Type and Capacity should both be retained as specification when Product exists');
assert.equal(netacRealParsed.rows[0].model,'N535S','Model should remain as descriptive model');
assert.equal(netacRealParsed.rows[0].supplier_part_no,'NT01N535S-240G-S3X','Part No. must be used as the unique SKU key when present');
assert.equal(netacRealParsed.rows[0].quote_date,'2026-10-27');
assert.equal(netacRealParsed.rows[1].product_type,'DRAM','Sheet name should provide the Netac product type when Product is absent');
assert.equal(netacRealParsed.rows[1].spec,'U-DIMM 288-Pin DDR5 / PC / 32GB','DRAM Type and Capacity should both be retained');
assert.equal(netacRealParsed.rows[1].supplier_part_no,'NTZED5P76DP-32S','Model / PN should be recognized as the unique part key');
assert.equal(netacRealParsed.rows[1].currency,'USD','US$ price header should infer USD');
assert.equal(netacRealParsed.rows[2].product_type,'TWS','Sheet name should provide product type when no Product column exists');
assert.equal(netacRealParsed.rows[2].supplier_part_no,'OS01BEN','Part No. should be preferred over Model for TWS variants');

const metadata={
  skus:[
    {sku_code:'NT-SSD-001',brand:'Netac',category:'SSD',model:'N535S'},
    {sku_code:'PSI-U905',brand:'Netac',category:'USB',model:'U905'},
    {sku_code:'NT03U278N-032G-20PN',brand:'Netac',category:'USB',model:'NT03U278N-032G-20PN'},
    {sku_code:'NT01N535S-240G-S3X',brand:'Netac',category:'SSD',model:'N535S'},
    {sku_code:'NTZED5P76DP-32S',brand:'Netac',category:'DRAM',model:'NTZED5P76DP-32S'},
    {sku_code:'OS01BEN',brand:'Netac',category:'TWS',model:'OS01'}
  ],
  mappings:[
    {supplier_id:'supplier-netac',brand:'Netac',supplier_part_no_key:'LEGACY-USB-01',psi_sku_code:'PSI-U905'}
  ]
};
const matched=n.matchRows(parsed.rows,metadata,{supplier_id:'supplier-netac',brand:'Netac'});
assert.equal(matched[0].match_status,'matched','exact PSI SKU should auto-match');
assert.equal(matched[0].match_source,'exact');
assert.equal(matched[2].match_status,'matched','saved supplier mapping should auto-match');
assert.equal(matched[2].brand,'Netac','brand values should be canonicalized against the SKU master');
assert.equal(matched[2].match_source,'saved');
assert.equal(matched[3].match_status,'unlinked','unknown part number should remain unlinked');
assert.equal(matched[3].sku_code,'LEGACY-USB-02','unlinked row must preserve supplier part number');
const netacModelMatched=n.matchRows(netacModelSheet.rows,metadata,{supplier_id:'supplier-netac',brand:'Netac'});
assert.equal(netacModelMatched[0].match_status,'matched','Netac Model value should exact-match PSI SKU master');
assert.equal(netacModelMatched[0].sku_code,'NT03U278N-032G-20PN');
const netacRealMatched=n.matchRows(netacRealParsed.rows,metadata,{supplier_id:'supplier-netac',brand:'Netac'});
assert.equal(netacRealMatched[0].sku_code,'NT01N535S-240G-S3X','SSD should match by Part No., not generic Model');
assert.equal(netacRealMatched[1].sku_code,'NTZED5P76DP-32S','DRAM Model / PN should match the SKU master');
assert.equal(netacRealMatched[2].sku_code,'OS01BEN','TWS should match by Part No., not generic Model');
assert.equal(n.validateRows(matched).length,0,'unlinked rows and zero-price rows must remain importable');
const punctuationMismatch=n.matchRows([{supplier_part_no:'NTSSD001',brand:'Netac',quote_price:1,currency:'USD',quote_date:'2026-11-04'}],metadata,{supplier_id:'supplier-netac',brand:'Netac'});
assert.equal(punctuationMismatch[0].match_status,'unlinked','SKU matching must not erase meaningful punctuation');

const manual=n.matchRows([
  {...parsed.rows[3],psi_sku_code:'PSI-U905',match_source:'manual'}
],metadata,{supplier_id:'supplier-netac',brand:'Netac'});
assert.equal(manual[0].match_status,'matched','manual selection should be retained');
assert.equal(manual[0].match_source,'manual');

const progress=fs.readFileSync(path.join(__dirname,'..','quotation-import-progress.js'),'utf8');
const fast=fs.readFileSync(path.join(__dirname,'..','quotation-import-fast.js'),'utf8');
const server=fs.readFileSync(path.join(__dirname,'..','quotation-server.js'),'utf8');
const management=fs.readFileSync(path.join(__dirname,'..','quotation-management.js'),'utf8');
assert.match(management,/GoPro:'IDR'/,'quotation management should expose GoPro');
assert.match(management,/code==='IDR'/,'IDR quotations should render with Rp and no decimals');
assert.match(fast,/GoPro:'IDR'/,'fast import should validate GoPro as IDR');
assert.match(server,/GoPro: 'IDR'/,'quotation server should compare GoPro in IDR');
assert.match(progress,/r.currency==='IDR'/,'smart-import preview should render IDR values as Rp');
assert.match(progress,/parseSheetRows/,'browser import should parse every worksheet');
assert.match(progress,/inferQuoteDate\(sheets,f\.name\)/,'browser import should infer quote date from workbook title or filename');
assert.match(progress,/quoteDateTouched/,'a manually selected quote date must not be overwritten by inference');
assert.match(progress,/未关联的报价仍可导入/,'unlinked rows should be explicitly allowed in preview');
assert.match(fast,/quotation_sku_mappings/,'server should persist supplier part-number mappings');
assert.match(fast,/match_status/,'server should store SKU match status');
assert.match(server,/event\.match_status === 'unlinked'/,'unlinked rows must not use internal purchase baselines');
const bootstrap=require(path.join(__dirname,'..','scripts','quotation-management-bootstrap.cjs'));
assert.match(bootstrap.patchQuotationManagementSource(management),/GoPro:'IDR'/,'quotation bootstrap must preserve GoPro IDR configuration');
assert.match(bootstrap.patchQuotationImportFastSource(fast),/GoPro:'IDR'/,'fast-import bootstrap must preserve GoPro IDR configuration');
assert.match(bootstrap.patchQuotationImportNormalizerSource(source),/GoPro:'IDR'/,'normalizer bootstrap must preserve GoPro IDR configuration');
assert.match(bootstrap.patchQuotationServerSource(server),/GoPro: 'IDR'/,'server bootstrap must preserve GoPro IDR configuration');
const serverEntry=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
const patchedServer=bootstrap.patchServerSource(serverEntry);
assert.match(patchedServer,/QUOTATION-IMPORT-BODY-GUARD-V1/,'bootstrap should add the import body-size guard');
assert.match(patchedServer,/quotation-import-fast\.js'\)\(\{ app, query, run, transaction, genId/,'bootstrap should register smart import with transaction support');
assert.equal(bootstrap.patchServerSource(patchedServer),patchedServer,'server bootstrap patch should be idempotent');
const indexEntry=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const patchedIndex=bootstrap.patchIndexSource(indexEntry);
assert.match(patchedIndex,/quotation-import-normalizer\.js\?v=20261105b/,'bootstrap should load smart-import normalizer');
assert.equal(bootstrap.patchIndexSource(patchedIndex),patchedIndex,'index bootstrap patch should be idempotent');


async function runBackendImportTest(){
const fastModule=require(path.join(__dirname,'..','quotation-import-fast.js'));
const originalDriver=process.env.DB_DRIVER;
process.env.DB_DRIVER='sqlite';
const routes={},executedSql=[],operationOrder=[];
const fakeApp={
  get:(url,...handlers)=>{routes['GET '+url]=handlers[handlers.length-1];},
  post:(url,...handlers)=>{routes['POST '+url]=handlers[handlers.length-1];}
};
const fakeQuery=(sql,params)=>{
  operationOrder.push('query:'+sql.slice(0,40));
  if(sql.includes('FROM suppliers WHERE id='))return {rows:[{id:'supplier-netac',name:'Netac',associated_brands:'["Netac"]',default_currency:'RMB',status:'active'}]};
  if(sql.includes('FROM skus WHERE COALESCE'))return {rows:[{sku_code:'SKU-1',brand:'Netac',category:'SSD',model:'Model 1',color_spec:'256GB'},{sku_code:'SKU-2',brand:'Netac',category:'USB',model:'Model 2',color_spec:'128GB'}]};
  if(sql.includes('FROM quotation_sku_mappings WHERE supplier_id='))return {rows:[]};
  if(sql.includes('WITH incoming'))return {rows:[{supplier_id:'supplier-netac',sku_code:'SKU-2',brand:'Netac',quote_date:'2026-11-04'}]};
  return {rows:[]};
};
const fakeRun=(sql,params)=>{executedSql.push({sql,params});operationOrder.push('run:'+sql.slice(0,40));return {changes:3};};
fastModule({
  app:fakeApp,
  query:fakeQuery,
  run:fakeRun,
  transaction:fn=>fn(),
  genId:prefix=>prefix+'_test_'+(executedSql.length+1),
  asyncHandler:fn=>fn,
  requireApiPermission:()=>()=>{}
});
const response={statusCode:200,status(code){this.statusCode=code;return this;},json(value){this.body=value;return this;}};
await routes['POST /api/quotation-management/import']({
  body:{
    supplier_id:'supplier-netac',brand:'Netac',quote_date:'2026-11-04',duplicate_mode:'skip',import_id:'test-import',
    rows:[
      {supplier_part_no:'SKU-1',brand:'Netac',quote_price:12.5,currency:'USD',quote_date:'2026-11-04',product_type:'SSD',match_source:'exact'},
      {supplier_part_no:'VENDOR-ONLY-1',brand:'Netac',quote_price:0,currency:'USD',quote_date:'2026-11-04',product_type:'SSD',match_status:'unlinked'},
      {model:'SKU-2',brand:'Netac',quote_price:11,currency:'USD',quote_date:'2026-11-05',product_type:'USB'},
      {supplier_part_no:'LEGACY-01',brand:'Netac',psi_sku_code:'SKU-2',match_source:'manual',quote_price:13,currency:'USD',quote_date:'2026-11-04',product_type:'SSD'}
    ],
    mapping_updates:[{brand:'Netac',supplier_part_no:'LEGACY-01',psi_sku_code:'SKU-2'}]
  }
},response);
if(originalDriver===undefined)delete process.env.DB_DRIVER;else process.env.DB_DRIVER=originalDriver;
assert.equal(response.statusCode,200,'backend should accept matched and unlinked supplier quote rows');
assert.equal(response.body.unlinked,1,'backend should report unlinked supplier quote rows');
assert.equal(response.body.inserted,3,'backend should accept Model-only SKU rows and skip the prior quote after applying its manual SKU mapping');
assert.equal(response.body.skipped,1,'the mapped historical quote should be treated as an existing duplicate');
assert(executedSql.some(x=>x.sql.includes('INSERT INTO quotation_sku_mappings')),'manual mappings should be persisted');
assert(executedSql.some(x=>x.sql.includes('INSERT INTO quotation_prices')&&x.sql.includes('supplier_part_no')),'quote writes should retain the source supplier part number');
assert(executedSql.some(x=>x.sql.includes("match_status='matched'")),'manual mapping should link prior unlinked history');
const historyUpdateAt=operationOrder.findIndex(x=>x.startsWith('run:UPDATE quotation_prices'));
const duplicateCheckAt=operationOrder.findIndex(x=>x.startsWith('query:WITH incoming'));
assert(historyUpdateAt>=0&&duplicateCheckAt>historyUpdateAt,'historical rows must be linked before duplicate checks to avoid duplicate quote history');
}
runBackendImportTest().then(()=>console.log('quotation-smart-import: PASS')).catch(err=>{console.error(err);process.exitCode=1;});
