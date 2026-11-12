'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const Database=require('better-sqlite3');

const root=path.join(__dirname,'..');
const server=fs.readFileSync(path.join(root,'quotation-server.js'),'utf8');
const start=server.indexOf('  // Quote categories are supplier-controlled;');
const end=server.indexOf("\n  app.get('/api/quotation-management/summary'",start);
assert(start>=0&&end>start,'quotation summary query block must be present');

const db=new Database(':memory:');
db.exec(`
  CREATE TABLE skus (sku_code TEXT,brand TEXT,category TEXT,status TEXT,lifecycle_status TEXT);
  CREATE TABLE quotation_prices (
    sku_code TEXT,brand TEXT,product_type TEXT,quote_price REAL,currency TEXT,quote_date TEXT,
    created_at TEXT,psi_sku_code TEXT,match_status TEXT,supplier_part_no TEXT,supplier_id TEXT,
    model TEXT,spec TEXT
  );
  CREATE TABLE brand_settings (brand TEXT,default_quote_currency TEXT);
  CREATE TABLE currencies (code TEXT,symbol TEXT,status TEXT);
  INSERT INTO brand_settings VALUES ('Netac','USD'),('Redragon','RMB');
  INSERT INTO currencies VALUES ('USD','$','active'),('RMB','¥','active');
`);
const sku=db.prepare('INSERT INTO skus VALUES (?,?,?,?,?)');
sku.run('N-UP','Netac','SSD','normal','stable');
sku.run('N-DOWN','Netac','DRAM','normal','stable');
sku.run('N-STOP','Netac','SSD','stopped','stable');
sku.run('N-EOL','Netac','SSD','normal','discontinued');
sku.run('R-MOUSE','Redragon','Mouse','normal','stable');
const quote=db.prepare('INSERT INTO quotation_prices VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)');
const add=(code,brand,type,price,date,mapped=code)=>quote.run(code,brand,type,price,brand==='Netac'?'USD':'RMB',date,date,mapped,mapped?'matched':'unlinked',code,'','','');
add('N-UP','Netac','External SSD',10,'2026-10-01');
add('N-UP','Netac','External SSD',12,'2026-11-11');
add('N-DOWN','Netac','SO-DIMM',20,'2026-10-01');
add('N-DOWN','Netac','SO-DIMM',18,'2026-11-11');
add('N-STOP','Netac','SSD',5,'2026-11-11');
add('N-EOL','Netac','SSD',5,'2026-11-11');
add('R-MOUSE','Redragon','Mouse',15,'2026-11-11');
add('UNREGISTERED','Netac','Mouse',999,'2026-11-11','');
add('WRONG-BRAND','Netac','Mouse',999,'2026-11-11','R-MOUSE');
const query=(sql,params=[])=>({rows:db.prepare(sql).all(...params)});
const context={
  query,getBrandCurrencyMap:()=>new Map([['Netac','USD'],['Redragon','RMB']]),
  purchaseBaselines:()=>new Map(),
  pairKey:(brand,code)=>brand+'|'+code,
  isQuoted:r=>Number(r.quote_price)>0,
  pct:(current,previous)=>previous?Math.round((Number(current)/Number(previous)-1)*10000)/100:null,
  Date,Map,Set,Number,String,Math,Object
};
const buildSummary=vm.runInNewContext(server.slice(start,end)+'\nbuildSummary;',context,{timeout:2000});
const summary=buildSummary({query:{brand:'Netac'}});
assert.equal(summary.rows.length,2,'only registered non-discontinued Netac SKUs are visible');
assert.equal(summary.report.sku_count,2);
assert.equal(summary.report.history_count,4,'valid SKU history remains available');
assert.deepEqual([...summary.product_types].sort(),['DRAM','SSD']);
assert.deepEqual([...new Set(summary.rows.map(r=>r.product_type))].sort(),['DRAM','SSD']);
assert(summary.rows.every(r=>r.match_status==='matched'));
assert.equal(summary.report.up_count,1);
assert.equal(summary.report.down_count,1);
assert.equal(summary.report.unlinked_count,0);
assert.equal(buildSummary({query:{brand:'Netac',product_type:'SSD'}}).rows.length,1);
assert.deepEqual([...buildSummary({query:{brand:'Netac',product_type:'SSD'}}).product_types].sort(),['DRAM','SSD'],'category options should not narrow to the selected category');
assert.equal(buildSummary({query:{brand:'Redragon'}}).rows.length,1);
assert.equal(db.prepare('SELECT count(*) AS n FROM quotation_prices').get().n,9,'hidden quote records must not be deleted');

const browser=fs.readFileSync(path.join(root,'quotation-management.js'),'utf8');
const a=browser.indexOf('function list(){');
const b=browser.indexOf('\nfunction chart(',a);
assert(a>=0&&b>a);
const nodes={};
const button=id=>({
  textContent:'',classList:{toggle(){}},setAttribute(){},
});
nodes['#qm-count']={textContent:''};
nodes['#qm-body']={innerHTML:'',querySelectorAll:()=>[]};
nodes['#qm-sort-up']=button('up');
nodes['#qm-sort-down']=button('down');
const ui={
  S:{data:{rows:[
    {sku_code:'A',psi_sku_code:'A',brand:'Netac',product_type:'SSD',vs_previous_pct:null,vs_purchase_pct:null,latest_date:'2026-11-11'},
    {sku_code:'B',psi_sku_code:'B',brand:'Netac',product_type:'SSD',vs_previous_pct:15,vs_purchase_pct:null,latest_date:'2026-11-11'},
    {sku_code:'C',psi_sku_code:'C',brand:'Netac',product_type:'SSD',vs_previous_pct:-10,vs_purchase_pct:null,latest_date:'2026-11-11'},
    {sku_code:'D',psi_sku_code:'D',brand:'Netac',product_type:'SSD',vs_previous_pct:5,vs_purchase_pct:null,latest_date:'2026-11-11'},
  ]},sort:''},
  $:selector=>nodes[selector],E:v=>String(v||''),change:()=>'',quoteMoney:()=>'',sku:()=>{}
};
vm.runInNewContext(browser.slice(a,b)+'\nthis.testList=list;',ui);
const positions=()=>[...nodes['#qm-body'].innerHTML.matchAll(/data-s="([^"]+)"/g)].map(m=>m[1]);
ui.testList();
assert.deepEqual(positions(),['A','B','C','D']);
ui.S.sort='up';ui.testList();
assert.deepEqual(positions(),['B','D','A','C'],'increases lead, largest increase first');
ui.S.sort='down';ui.testList();
assert.deepEqual(positions(),['C','A','B','D'],'decreases lead without hiding other SKUs');
assert.equal(nodes['#qm-count'].textContent,'共 4 个有效 SKU');
db.close();
console.log('quotation-active-master-category-sort: PASS');
