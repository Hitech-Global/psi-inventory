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

const metadata={
  skus:[
    {sku_code:'NT-SSD-001',brand:'Netac',category:'SSD',model:'N535S'},
    {sku_code:'PSI-U905',brand:'Netac',category:'USB',model:'U905'}
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
assert.match(progress,/parseSheetRows/,'browser import should parse every worksheet');
assert.match(progress,/未关联的报价仍可导入/,'unlinked rows should be explicitly allowed in preview');
assert.match(fast,/quotation_sku_mappings/,'server should persist supplier part-number mappings');
assert.match(fast,/match_status/,'server should store SKU match status');
assert.match(server,/event\.match_status === 'unlinked'/,'unlinked rows must not use internal purchase baselines');


const fastModule=require(path.join(__dirname,'..','quotation-import-fast.js'));
const originalDriver=process.env.DB_DRIVER;
process.env.DB_DRIVER='sqlite';
const routes={},executedSql=[];
const fakeApp={
  get:(url,...handlers)=>{routes['GET '+url]=handlers[handlers.length-1];},
  post:(url,...handlers)=>{routes['POST '+url]=handlers[handlers.length-1];}
};
const fakeQuery=(sql,params)=>{
  if(sql.includes('FROM suppliers WHERE id='))return {rows:[{id:'supplier-netac',name:'Netac',associated_brands:'["Netac"]',default_currency:'RMB',status:'active'}]};
  if(sql.includes('FROM skus WHERE COALESCE'))return {rows:[{sku_code:'SKU-1',brand:'Netac',category:'SSD',model:'Model 1',color_spec:'256GB'}]};
  if(sql.includes('FROM quotation_sku_mappings WHERE supplier_id='))return {rows:[]};
  if(sql.includes('WITH incoming'))return {rows:[]};
  return {rows:[]};
};
const fakeRun=(sql,params)=>{executedSql.push({sql,params});return {changes:3};};
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
      {supplier_part_no:'LEGACY-01',brand:'Netac',psi_sku_code:'SKU-1',match_source:'manual',quote_price:13,currency:'USD',quote_date:'2026-11-04',product_type:'SSD'}
    ],
    mapping_updates:[{brand:'Netac',supplier_part_no:'LEGACY-01',psi_sku_code:'SKU-1'}]
  }
},response);
if(originalDriver===undefined)delete process.env.DB_DRIVER;else process.env.DB_DRIVER=originalDriver;
assert.equal(response.statusCode,200,'backend should accept matched and unlinked supplier quote rows');
assert.equal(response.body.unlinked,1,'backend should report unlinked supplier quote rows');
assert.equal(response.body.inserted,3,'backend should import all quote rows');
assert(executedSql.some(x=>x.sql.includes('INSERT INTO quotation_sku_mappings')),'manual mappings should be persisted');
assert(executedSql.some(x=>x.sql.includes('INSERT INTO quotation_prices')&&x.sql.includes('supplier_part_no')),'quote writes should retain the source supplier part number');
assert(executedSql.some(x=>x.sql.includes("match_status='matched'")),'manual mapping should attempt to link prior unlinked history');

console.log('quotation-smart-import: PASS');
