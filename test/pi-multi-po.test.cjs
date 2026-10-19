'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const core=require('../assets/pi-multi-po-core');
function db(){
 const sqlite=new DatabaseSync(':memory:');
 sqlite.exec(`
  CREATE TABLE purchase_orders(id TEXT PRIMARY KEY,po_no TEXT,supplier_id TEXT,supplier_name TEXT,
    brand TEXT,country TEXT,target_warehouse TEXT,currency TEXT,po_status TEXT,approval_status TEXT);
  CREATE TABLE purchase_order_items(id TEXT PRIMARY KEY,po_id TEXT,sku_code TEXT,po_qty INTEGER,
    transferred_pi_qty INTEGER,untransferred_pi_qty INTEGER);
  CREATE TABLE pi_po_allocations(id TEXT PRIMARY KEY,pi_id TEXT,po_id TEXT,po_no TEXT,sku_code TEXT,allocated_qty INTEGER,pi_unit_price REAL,pi_discount REAL);
  CREATE UNIQUE INDEX uq_pi_po_allocations ON pi_po_allocations(pi_id,po_id,sku_code);
 `);
 const pos=[
  ['po1','PO-1','s1','Netac','Netac','泰国','Bangkok','RMB','approved','approved'],
  ['po2','PO-2','s1','Netac','Netac','泰国','Bangkok','RMB','approved','approved'],
  ['po3','PO-3','s2','Redragon','Redragon','印度尼西亚','Bekasi','USD','approved','approved'],
  ['po4','PO-4','s1','Netac','Netac','泰国','Other WH','RMB','approved','approved'],
  ['po5','PO-5','s1','Netac','Netac','泰国','Bangkok','USD','approved','approved']
 ];
 const insertPO=sqlite.prepare('INSERT INTO purchase_orders VALUES (?,?,?,?,?,?,?,?,?,?)');
 pos.forEach(p=>insertPO.run(...p));
 const insertItem=sqlite.prepare('INSERT INTO purchase_order_items VALUES (?,?,?,?,?,?)');
 [
  ['a1','po1','SKU-A',100,20,80],['b1','po1','SKU-B',10,0,10],
  ['a2','po2','SKU-A',40,0,40],['c2','po2','SKU-C',15,0,15],
  ['a3','po3','SKU-A',60,0,60],['a4','po4','SKU-A',20,0,20],['a5','po5','SKU-A',20,0,20]
 ].forEach(i=>insertItem.run(...i));
 const query=(sql,params=[])=>({rows:sqlite.prepare(sql).all(...params)});
 const queryOne=(sql,params=[])=>sqlite.prepare(sql).get(...params);
 const run=(sql,params=[])=>sqlite.prepare(sql).run(...params);
 let i=0;const genId=()=>String(++i);
 return {sqlite,query,queryOne,run,genId,pos:()=>[queryOne('SELECT * FROM purchase_orders WHERE id=?',['po1']),queryOne('SELECT * FROM purchase_orders WHERE id=?',['po2'])]};
}
function form(){return {supplier_id:'s1',supplier_name:'Netac',country:'泰国',brand:'Netac',target_warehouse:'Bangkok',currency:'RMB'};}
test('linked id normalization, legacy fallback, duplicate and malformed rejection',()=>{
 assert.deepEqual(core.parseRelatedIds(['po1','po2'] ),['po1','po2']);
 assert.deepEqual(core.parseRelatedIds('["po1","po2"]'),['po1','po2']);
 assert.deepEqual(core.parseRelatedIds('', 'po1'),['po1']);
 assert.deepEqual(core.parseRelatedIds('', ''),[]);
 assert.throws(()=>core.parseRelatedIds(['po1','po1']),/重复/);
 assert.throws(()=>core.parseRelatedIds('not-json'),/格式/);
});
test('supplier / country / currency / warehouse / brand checked before any writes',()=>{
 const x=db();
 const a=core.validatePOs(['po1','po2'],form(),x.queryOne);assert.equal(a.length,2);
 assert.throws(()=>core.validatePOs(['po1','po3'],form(),x.queryOne),/供应商或国家/);
 assert.throws(()=>core.validatePOs(['po1','po4'],form(),x.queryOne),/目标仓库/);
 assert.throws(()=>core.validatePOs(['po1','po5'],form(),x.queryOne),/币种/);
 assert.throws(()=>core.validatePOs(['po1','po2'],{...form(),brand:'Other'},x.queryOne),/品牌/);
 assert.throws(()=>core.validatePOs(['po1','missing'],form(),x.queryOne),/不存在/);
 x.sqlite.close();
});
test('same SKU from two PO allocates FIFO into one PI SKU and preserves per-PO source',()=>{
 const x=db(),pos=core.validatePOs(['po1','po2'],form(),x.queryOne);
 x.sqlite.exec('BEGIN');
 const records=core.assignMultiPO({piId:'pi1',poRows:pos,items:[
  {sku_code:'SKU-A',pi_confirmed_qty:110},
  {sku_code:'SKU-B',pi_confirmed_qty:10},
  {sku_code:'SKU-C',pi_confirmed_qty:12},
  {sku_code:'MANUAL',pi_confirmed_qty:4}
 ],...x});
 x.sqlite.exec('COMMIT');
 assert.deepEqual(records.filter(r=>r.sku_code==='SKU-A').map(r=>[r.po_no,r.allocated_qty]),
   [['PO-1',80],['PO-2',30]]);
 assert.equal(x.queryOne('SELECT transferred_pi_qty FROM purchase_order_items WHERE id=?',['a1']).transferred_pi_qty,100);
 assert.equal(x.queryOne('SELECT transferred_pi_qty FROM purchase_order_items WHERE id=?',['a2']).transferred_pi_qty,30);
 assert.equal(x.queryOne('SELECT untransferred_pi_qty FROM purchase_order_items WHERE id=?',['a2']).untransferred_pi_qty,10);
 assert.equal(x.queryOne('SELECT po_status FROM purchase_orders WHERE id=?',['po1']).po_status,'transferred_pi');
 assert.equal(x.queryOne('SELECT po_status FROM purchase_orders WHERE id=?',['po2']).po_status,'partial_pi');
 assert.equal(x.query('SELECT * FROM pi_po_allocations').rows.length,4);
 x.sqlite.close();
});
test('over allocation triggers transaction rollback, original transfers and no ledger preserved',()=>{
 const x=db();const before=x.queryOne('SELECT transferred_pi_qty FROM purchase_order_items WHERE id=?',['a1']).transferred_pi_qty;
 const pos=x.pos();
 x.sqlite.exec('BEGIN');
 assert.throws(()=>core.assignMultiPO({piId:'pi_bad',poRows:pos,
   items:[{sku_code:'SKU-A',pi_confirmed_qty:121}],...x}),/超过已关联PO剩余数量/);
 x.sqlite.exec('ROLLBACK');
 assert.equal(x.query('SELECT * FROM pi_po_allocations').rows.length,0);
 assert.equal(x.queryOne('SELECT transferred_pi_qty FROM purchase_order_items WHERE id=?',['a1']).transferred_pi_qty,before);
 x.sqlite.close();
});
test('edit rolls back old allocations then reallocates new qty, retaining linked POs',()=>{
 const x=db(),pos=x.pos();
 x.sqlite.exec('BEGIN');
 core.assignMultiPO({piId:'pi1',poRows:pos,items:[{sku_code:'SKU-A',pi_confirmed_qty:110}],...x});
 x.sqlite.exec('COMMIT');
 x.sqlite.exec('BEGIN');
 core.restoreMultiAllocations('pi1',x.query,x.run);
 core.assignMultiPO({piId:'pi1',poRows:pos,items:[{sku_code:'SKU-A',pi_confirmed_qty:60}],...x});
 x.sqlite.exec('COMMIT');
 assert.equal(x.queryOne('SELECT transferred_pi_qty FROM purchase_order_items WHERE id=?',['a1']).transferred_pi_qty,80);
 assert.equal(x.queryOne('SELECT transferred_pi_qty FROM purchase_order_items WHERE id=?',['a2']).transferred_pi_qty,0);
 assert.equal(x.query('SELECT * FROM pi_po_allocations WHERE pi_id=?',['pi1']).rows.length,1);
 x.sqlite.close();
});
test('second PI only sees remaining PO quantity, cannot double-occupy 120 units',()=>{
 const x=db(),pos=x.pos();
 x.sqlite.exec('BEGIN');
 core.assignMultiPO({piId:'pi1',poRows:pos,items:[{sku_code:'SKU-A',pi_confirmed_qty:115}],...x});
 x.sqlite.exec('COMMIT');
 x.sqlite.exec('BEGIN');
 assert.throws(()=>core.assignMultiPO({piId:'pi2',poRows:pos,
   items:[{sku_code:'SKU-A',pi_confirmed_qty:6}],...x}),/超过/);
 x.sqlite.exec('ROLLBACK');
 assert.equal(x.query('SELECT COUNT(*) AS n FROM pi_po_allocations WHERE pi_id=?',['pi2']).rows[0].n,0);
 x.sqlite.close();
});
test('duplicate PI SKU rejected; manual-only SKU not allocated to unrelated PO',()=>{
 const x=db();
 assert.throws(()=>core.assignMultiPO({piId:'pi',poRows:x.pos(),
   items:[{sku_code:'SKU-A',pi_confirmed_qty:3},{sku_code:'SKU-A',pi_confirmed_qty:4}],...x}),/每个SKU只能有一行/);
 x.sqlite.close();
});
test('DB migration is present in both PG paths and SQLite initialization',()=>{
 const root=path.join(__dirname,'..');
 for(const file of ['db.js','db-pg.js','db-sqlite.js']){
   const text=fs.readFileSync(path.join(root,file),'utf8');
   assert.match(text,/CREATE TABLE IF NOT EXISTS pi_po_allocations/);
   assert.match(text,/related_po_ids/);
 }
});
test('downstream CI still reads one PI SKU entry; no mutations to CI/WAC/forecast source code',()=>{
 const root=path.join(__dirname,'..');
 const s=fs.readFileSync(path.join(root,'server.js'),'utf8');
 assert.match(s,/piMultiPO\.assignMultiPO/);
 assert.match(s,/piMultiPO\.restoreMultiAllocations/);
 assert.match(s,/SELECT pi_confirmed_qty, shipped_qty FROM proforma_invoice_items/);
});

test('pending/draft plan can be linked while retaining its approval state; rejected plan cannot',()=>{
 const x=db();x.run("UPDATE purchase_orders SET po_status='draft',approval_status='pending' WHERE id='po1'");
 const pos=core.validatePOs(['po1','po2'],form(),x.queryOne);
 x.sqlite.exec('BEGIN');
 core.assignMultiPO({piId:'pi1',poRows:pos,items:[{sku_code:'SKU-A',pi_confirmed_qty:115}],...x});
 x.sqlite.exec('COMMIT');
 const pending=x.queryOne("SELECT po_status,approval_status FROM purchase_orders WHERE id='po1'");
 assert.equal(pending.po_status,'draft');assert.equal(pending.approval_status,'pending');
 assert.equal(x.queryOne("SELECT po_status FROM purchase_orders WHERE id='po2'").po_status,'partial_pi');
 x.run("UPDATE purchase_orders SET approval_status='rejected' WHERE id='po1'");
 assert.throws(()=>core.validatePOs(['po1','po2'],form(),x.queryOne),/驳回/);
 x.sqlite.close();
});

test('zero-quantity PO does not become transferred_pi without actual PI transfers',()=>{
 const x=db();
 x.run("UPDATE purchase_order_items SET po_qty=0,transferred_pi_qty=0 WHERE po_id='po1'");
 core.updatePOStatus('po1',x.query,x.run);
 assert.equal(x.queryOne("SELECT po_status FROM purchase_orders WHERE id='po1'").po_status,'approved');
 x.sqlite.close();
});

test('PI grouped CI-facing SKU total keeps different PO prices/quantities in individual ledger',()=>{
 const x=db(),pos=x.pos();
 const sources=[
  {po_id:'po1',po_no:'PO-1',sku_code:'SKU-A',po_qty:80,pi_confirmed_qty:30,unit_price:10,discount:0},
  {po_id:'po2',po_no:'PO-2',sku_code:'SKU-A',po_qty:40,pi_confirmed_qty:20,unit_price:12,discount:0.1},
  {po_id:'po2',po_no:'PO-2',sku_code:'SKU-C',po_qty:15,pi_confirmed_qty:8,unit_price:5,discount:0}
 ];
 const agg=core.aggregateSourceItems(sources,pos);
 assert.equal(agg.length,2);
 assert.equal(agg[0].pi_confirmed_qty,50);
 assert.equal(agg[0].pi_amount,516);
 assert.equal(agg[0].unit_price,10.8);
 assert.ok(Math.abs(agg[0].discount-(1-516/540))<1e-9);
 x.sqlite.exec('BEGIN');
 core.assignMultiPO({piId:'split-pi',poRows:pos,items:agg,sourceItems:sources,...x});
 x.sqlite.exec('COMMIT');
 assert.deepEqual(x.query('SELECT po_no,sku_code,allocated_qty,pi_unit_price,pi_discount FROM pi_po_allocations ORDER BY po_no,sku_code').rows
  .map(r=>[r.po_no,r.sku_code,r.allocated_qty,r.pi_unit_price,r.pi_discount]),
  [['PO-1','SKU-A',30,10,0],['PO-2','SKU-A',20,12,.1],['PO-2','SKU-C',8,5,0]]);
 assert.equal(x.queryOne('SELECT transferred_pi_qty FROM purchase_order_items WHERE id=?',['a1']).transferred_pi_qty,50);
 assert.equal(x.queryOne('SELECT transferred_pi_qty FROM purchase_order_items WHERE id=?',['a2']).transferred_pi_qty,20);
 x.sqlite.close();
});
test('PO source lines cannot impersonate other PO or double-book a PO+SKU',()=>{
 const x=db(),pos=x.pos();
 assert.throws(()=>core.aggregateSourceItems([{po_id:'po1',po_no:'PO-2',sku_code:'SKU-A',pi_confirmed_qty:2,unit_price:1}],pos),/来源PO/);
 assert.throws(()=>core.aggregateSourceItems([
  {po_id:'po1',po_no:'PO-1',sku_code:'SKU-A',pi_confirmed_qty:2,unit_price:1},
  {po_id:'po1',po_no:'PO-1',sku_code:'SKU-A',pi_confirmed_qty:3,unit_price:1}],pos),/只能出现一行/);
 assert.throws(()=>core.aggregateSourceItems([
  {po_id:'po1',po_no:'PO-1',sku_code:'SKU-A',pi_confirmed_qty:2,unit_price:1},
  {po_id:'',sku_code:'SKU-A',pi_confirmed_qty:3,unit_price:1}],pos),/手工行与PO来源SKU重复/);
 x.sqlite.close();
});
test('per-PO confirmation cannot exceed just that PO residual, even when other PO has capacity',()=>{
 const x=db(),pos=x.pos();
 const sources=[{po_id:'po1',po_no:'PO-1',sku_code:'SKU-A',pi_confirmed_qty:81,unit_price:4,discount:0}];
 const items=core.aggregateSourceItems(sources,pos);
 x.sqlite.exec('BEGIN');
 assert.throws(()=>core.assignMultiPO({piId:'excess',poRows:pos,items,sourceItems:sources,...x}),/超过对应PO剩余数量/);
 x.sqlite.exec('ROLLBACK');
 assert.equal(x.query('SELECT COUNT(*) AS n FROM pi_po_allocations').rows[0].n,0);
 assert.equal(x.queryOne('SELECT transferred_pi_qty FROM purchase_order_items WHERE id=?',['a1']).transferred_pi_qty,20);
 x.sqlite.close();
});
