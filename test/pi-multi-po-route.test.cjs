'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {DatabaseSync}=require('node:sqlite');
const src=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
const start=src.indexOf("app.post('/api/proforma-invoices',");
const end=src.indexOf("app.put('/api/proforma-invoices/:id',",start);
assert.ok(start>0&&end>start,'PI create route not found');
function fixture(){
 const sqlite=new DatabaseSync(':memory:');
 sqlite.exec(`
  CREATE TABLE purchase_orders(id TEXT PRIMARY KEY,po_no TEXT,supplier_id TEXT,supplier_name TEXT,brand TEXT,country TEXT,target_warehouse TEXT,currency TEXT,po_status TEXT,approval_status TEXT);
  CREATE TABLE purchase_order_items(id TEXT PRIMARY KEY,po_id TEXT,sku_code TEXT,po_qty INTEGER,transferred_pi_qty INTEGER,untransferred_pi_qty INTEGER);
  CREATE TABLE proforma_invoices(id TEXT PRIMARY KEY,pi_no TEXT,related_po_id TEXT,related_po_no TEXT,supplier_id TEXT,supplier_name TEXT,brand TEXT,country TEXT,target_warehouse TEXT,pi_date TEXT,currency TEXT,total_amount REAL,payment_terms TEXT,payment_term_id TEXT,need_deposit INTEGER,deposit_ratio REAL,balance_ratio REAL,payable_deposit REAL,pi_status TEXT,expected_delivery TEXT,attachment TEXT,remark TEXT,related_po_ids TEXT,related_po_nos TEXT,available_deduct_deposit REAL,deposit_payment_status TEXT,updated_at TEXT);
  CREATE TABLE proforma_invoice_items(id TEXT PRIMARY KEY,pi_id TEXT,pi_no TEXT,po_no TEXT,sku_code TEXT,po_qty INTEGER,pi_confirmed_qty INTEGER,unit_price REAL,discount REAL,pi_amount REAL,shipped_qty INTEGER,unshipped_qty INTEGER,created_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE pi_po_allocations(id TEXT PRIMARY KEY,pi_id TEXT,po_id TEXT,po_no TEXT,sku_code TEXT,allocated_qty INTEGER);
  CREATE TABLE payable_items (id TEXT PRIMARY KEY,source_type TEXT,source_id TEXT,fee_type TEXT,lifecycle_status TEXT,payable_amount_minor INTEGER,created_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE commercial_invoice_items (id TEXT PRIMARY KEY,pi_id TEXT);
  CREATE TABLE historical_commercial_invoice_items (id TEXT PRIMARY KEY,pi_id TEXT);
 `);
 const p=sqlite.prepare('INSERT INTO purchase_orders VALUES (?,?,?,?,?,?,?,?,?,?)');
 p.run('p1','PO-A','s1','Netac','Netac','泰国','Bangkok','RMB','approved','approved');
 p.run('p2','PO-B','s1','Netac','Netac','泰国','Bangkok','RMB','approved','approved');
 p.run('p3','PO-C','s1','Netac','Netac','马来西亚','KL','RMB','approved','approved');
 const item=sqlite.prepare('INSERT INTO purchase_order_items VALUES (?,?,?,?,?,?)');
 item.run('a1','p1','SKU-1',100,20,80);
 item.run('a2','p2','SKU-1',50,0,50);
 item.run('a3','p2','SKU-2',30,0,30);
 item.run('a4','p3','SKU-1',30,0,30);
 const query=(sql,params=[])=>({rows:sqlite.prepare(sql).all(...params)});
 const queryOne=(sql,params=[])=>sqlite.prepare(sql).get(...params);
 const run=(sql,params=[])=>sqlite.prepare(sql).run(...params);
 let seq=1,handler,putHandler,voidHandler,output={status:200};
 const genId=prefix=>prefix+'-'+(seq++);
 const ctx={
  app:{post(url,_auth,fn){
    if(url==='/api/proforma-invoices')handler=fn;
    else if(url==='/api/proforma-invoices/:id/void')voidHandler=fn;
    else throw Error('Unexpected POST '+url);
  },put(url,_auth,fn){assert.equal(url,'/api/proforma-invoices/:id');putHandler=fn;}},
  requireApiPermission:()=>()=>{},
  asyncHandler:fn=>fn,
  query,queryOne,run,genId,
  piMultiPO:require('../assets/pi-multi-po-core'),
  n:(val,def)=>Number(val??def),
  parseAttachment:val=>String(val||''),
  createPayableItemFromSource(){throw Error('deposit should be disabled in these route cases')},
  getPILockReason:()=>'',getPINumberLockReason:()=>'',piItemsEqual:()=>false,
  syncPayableItemAmount(){},logOperation(){},cancelPayableItem(id){const r=run("UPDATE payable_items SET lifecycle_status='cancelled' WHERE id=? AND lifecycle_status='active'",[id]);return r.changes>0;},
  updateInventoryTransitDataAsync:()=>Promise.resolve(),
  transaction(fn){
   sqlite.exec('BEGIN');
   try{const r=fn();sqlite.exec('COMMIT');return r;}
   catch(e){sqlite.exec('ROLLBACK');throw e;}
  },
  console:{error(){}}
 };
 vm.runInNewContext(src.slice(start,end),ctx);
 const editEnd=src.indexOf("app.post('/api/proforma-invoices/:id/attachment'",end);
 vm.runInNewContext(src.slice(end,editEnd),ctx);
 const voidStart=src.indexOf("app.post('/api/proforma-invoices/:id/void'",editEnd);
 const voidEnd=src.indexOf('// ==================== CI/PL',voidStart);
 vm.runInNewContext(src.slice(voidStart,voidEnd),ctx);
 const defaults={related_po_ids:['p1','p2'],related_po_id:'p1',related_po_no:'PO-A',
   supplier_id:'s1',supplier_name:'Netac',brand:'Netac',country:'泰国',target_warehouse:'Bangkok',currency:'RMB',
   pi_no:'PI-TEST-1',pi_date:'2026-10-19',need_deposit:0,items:[{sku_code:'SKU-1',pi_confirmed_qty:110,po_qty:130,unit_price:12,discount:0},{sku_code:'SKU-2',pi_confirmed_qty:10,po_qty:30,unit_price:7,discount:0}]};
 const submit=async(body={})=>{
  output={status:200};
  const res={status(code){output.status=code;return this;},json(value){output.data=value;return this;}};
  await handler({body:{...defaults,...body},currentUserId:'test'},res);
  return output;
 };
 const update=async(id,body={})=>{
   output={status:200};
   const res={status(code){output.status=code;return this;},json(value){output.data=value;return this;},once(){}};
   await putHandler({params:{id},body,currentUserId:'test',currentUserName:'tester'},res);
   return output;
 };
 const voidPI=async(id)=>{
   output={status:200};
   const res={status(code){output.status=code;return this;},json(value){output.data=value;return this;}};
   await voidHandler({params:{id},body:{void_reason:'Test only'},currentUserId:'test',currentUserName:'tester'},res);
   return output;
 };
 return {sqlite,query,queryOne,submit,update,voidPI};
}
test('real server create route: one PI, one line per SKU, both PO allocation records, accurate totals',async()=>{
 const x=fixture(),r=await x.submit();
 assert.equal(r.status,200,JSON.stringify(r));
 const pi=x.queryOne('SELECT * FROM proforma_invoices WHERE pi_no=?',['PI-TEST-1']);
 assert.deepEqual(JSON.parse(pi.related_po_ids),['p1','p2']);
 assert.deepEqual(JSON.parse(pi.related_po_nos),['PO-A','PO-B']);
 assert.equal(pi.related_po_id,'p1');
 assert.equal(pi.total_amount,1390);
 assert.equal(x.query('SELECT * FROM proforma_invoice_items WHERE pi_id=?',[pi.id]).rows.length,2);
 const allocations=x.query('SELECT po_no,sku_code,allocated_qty FROM pi_po_allocations ORDER BY po_no,sku_code').rows;
 assert.deepEqual(allocations.map(a=>[a.po_no,a.sku_code,a.allocated_qty]),
   [['PO-A','SKU-1',80],['PO-B','SKU-1',30],['PO-B','SKU-2',10]]);
 assert.equal(x.queryOne('SELECT transferred_pi_qty FROM purchase_order_items WHERE id=?',['a1']).transferred_pi_qty,100);
 assert.equal(x.queryOne('SELECT po_status FROM purchase_orders WHERE id=?',['p1']).po_status,'transferred_pi');
 x.sqlite.close();
});
test('invalid requested sum (over PO residual) returns 400 and leaves no PI or allocations',async()=>{
 const x=fixture();
 const r=await x.submit({items:[{sku_code:'SKU-1',pi_confirmed_qty:131,unit_price:10}]});
 assert.equal(r.status,400);
 assert.match(r.data.error,/超过已关联PO剩余数量/);
 assert.equal(x.query('SELECT * FROM proforma_invoices').rows.length,0);
 assert.equal(x.query('SELECT * FROM pi_po_allocations').rows.length,0);
 assert.equal(x.queryOne('SELECT transferred_pi_qty FROM purchase_order_items WHERE id=?',['a1']).transferred_pi_qty,20);
 x.sqlite.close();
});
test('cross-country mixed POs rejected before starting any transactional writes',async()=>{
 const x=fixture(),r=await x.submit({related_po_ids:['p1','p3']});
 assert.equal(r.status,400);assert.equal(x.query('SELECT * FROM proforma_invoices').rows.length,0);
 x.sqlite.close();
});
test('legacy single PO create remains unchanged without multi allocation records',async()=>{
 const x=fixture(),r=await x.submit({
  related_po_ids:['p1'],related_po_id:'p1',related_po_no:'PO-A',
  items:[{sku_code:'SKU-1',po_qty:100,pi_confirmed_qty:30,unit_price:9}]
 });
 assert.equal(r.status,200,JSON.stringify(r));
 assert.equal(x.query('SELECT * FROM pi_po_allocations').rows.length,0);
 assert.equal(x.queryOne('SELECT transferred_pi_qty FROM purchase_order_items WHERE id=?',['a1']).transferred_pi_qty,50);
 x.sqlite.close();
});

test('real PI PUT releases and reallocates BOTH POs inside same transaction',async()=>{
 const x=fixture(),first=await x.submit();assert.equal(first.status,200);
 const pi=x.queryOne('SELECT * FROM proforma_invoices WHERE pi_no=?',['PI-TEST-1']);
 const r=await x.update(pi.id,{items:[
  {sku_code:'SKU-1',pi_confirmed_qty:50,po_qty:130,unit_price:12,discount:0},
  {sku_code:'SKU-2',pi_confirmed_qty:20,po_qty:30,unit_price:7,discount:0}
 ],need_deposit:0,deposit_ratio:0});
 assert.equal(r.status,200,JSON.stringify(r));
 assert.equal(x.queryOne('SELECT transferred_pi_qty FROM purchase_order_items WHERE id=?',['a1']).transferred_pi_qty,70);
 assert.equal(x.queryOne('SELECT transferred_pi_qty FROM purchase_order_items WHERE id=?',['a2']).transferred_pi_qty,0);
 assert.equal(x.queryOne('SELECT po_status FROM purchase_orders WHERE id=?',['p1']).po_status,'partial_pi');
 const alloc=x.query('SELECT po_no,sku_code,allocated_qty FROM pi_po_allocations ORDER BY po_no,sku_code').rows;
 assert.deepEqual(alloc.map(a=>[a.po_no,a.sku_code,a.allocated_qty]),[['PO-A','SKU-1',50],['PO-B','SKU-2',20]]);
 assert.equal(x.query('SELECT * FROM proforma_invoice_items WHERE pi_id=?',[pi.id]).rows.length,2);
 x.sqlite.close();
});
test('failed multi-PO edit over residual rolls back allocations, existing PI items, and statuses',async()=>{
 const x=fixture();await x.submit();
 const pi=x.queryOne('SELECT * FROM proforma_invoices WHERE pi_no=?',['PI-TEST-1']);
 const old=x.query('SELECT sku_code,pi_confirmed_qty FROM proforma_invoice_items ORDER BY sku_code').rows;
 const result=await x.update(pi.id,{items:[{sku_code:'SKU-1',pi_confirmed_qty:131,unit_price:12,discount:0}]});
 assert.notEqual(result.status,200);
 assert.deepEqual(x.query('SELECT sku_code,pi_confirmed_qty FROM proforma_invoice_items ORDER BY sku_code').rows,old);
 assert.equal(x.queryOne('SELECT transferred_pi_qty FROM purchase_order_items WHERE id=?',['a1']).transferred_pi_qty,100);
 assert.equal(x.queryOne('SELECT transferred_pi_qty FROM purchase_order_items WHERE id=?',['a2']).transferred_pi_qty,30);
 assert.equal(x.query('SELECT * FROM pi_po_allocations').rows.length,3);
 x.sqlite.close();
});
test('multi-PO PI void returns all allocations to POs, with no new finance records',async()=>{
 const x=fixture();await x.submit();
 const pi=x.queryOne('SELECT * FROM proforma_invoices WHERE pi_no=?',['PI-TEST-1']);
 const r=await x.voidPI(pi.id);
 assert.equal(r.status,200,JSON.stringify(r));
 assert.equal(x.queryOne('SELECT pi_status FROM proforma_invoices WHERE id=?',[pi.id]).pi_status,'cancelled');
 assert.equal(x.query('SELECT * FROM pi_po_allocations').rows.length,0);
 assert.equal(x.queryOne('SELECT transferred_pi_qty FROM purchase_order_items WHERE id=?',['a1']).transferred_pi_qty,20);
 assert.equal(x.queryOne('SELECT transferred_pi_qty FROM purchase_order_items WHERE id=?',['a2']).transferred_pi_qty,0);
 assert.equal(x.queryOne('SELECT po_status FROM purchase_orders WHERE id=?',['p1']).po_status,'partial_pi');
 x.sqlite.close();
});

test('void multi-PO PI cancels active deposit payable in the SAME transaction',async()=>{
 const x=fixture();await x.submit();
 const pi=x.queryOne('SELECT * FROM proforma_invoices WHERE pi_no=?',['PI-TEST-1']);
 x.sqlite.prepare('INSERT INTO payable_items(id,source_type,source_id,fee_type,lifecycle_status,payable_amount_minor) VALUES (?,?,?,?,?,?)')
   .run('payable1','pi',pi.id,'deposit','active',9000);
 const r=await x.voidPI(pi.id);
 assert.equal(r.status,200,JSON.stringify(r));
 assert.equal(x.queryOne('SELECT lifecycle_status FROM payable_items WHERE id=?',['payable1']).lifecycle_status,'cancelled');
 assert.equal(x.query('SELECT COUNT(*) n FROM pi_po_allocations').rows[0].n,0);
 x.sqlite.close();
});
test('void forbidden after historical CI or reserved deposit, no PO allocations released',async()=>{
 const x=fixture();await x.submit();
 const pi=x.queryOne('SELECT * FROM proforma_invoices WHERE pi_no=?',['PI-TEST-1']);
 x.sqlite.prepare('INSERT INTO historical_commercial_invoice_items(id,pi_id) VALUES (?,?)').run('hci1',pi.id);
 const result=await x.voidPI(pi.id);
 assert.equal(result.status,409);
 assert.equal(x.query('SELECT COUNT(*) n FROM pi_po_allocations').rows[0].n,3);
 assert.equal(x.queryOne('SELECT pi_status FROM proforma_invoices WHERE id=?',[pi.id]).pi_status,'pending');
 x.sqlite.close();
});

test('multi-PO creation can mix draft/pending PO with approved PO, without granting approval',async()=>{
 const x=fixture();
 x.sqlite.prepare("UPDATE purchase_orders SET approval_status='pending', po_status='draft' WHERE id='p1'").run();
 const r=await x.submit();
 assert.equal(r.status,200,JSON.stringify(r));
 assert.equal(x.queryOne("SELECT approval_status FROM purchase_orders WHERE id='p1'").approval_status,'pending');
 assert.equal(x.queryOne("SELECT po_status FROM purchase_orders WHERE id='p1'").po_status,'draft');
 assert.equal(x.queryOne("SELECT po_status FROM purchase_orders WHERE id='p2'").po_status,'partial_pi');
 assert.equal(x.query("SELECT * FROM pi_po_allocations").rows.length,3);
 x.sqlite.close();
});
test('single draft PO may create PI and remains draft rather than falsely approved',async()=>{
 const x=fixture();
 x.sqlite.prepare("UPDATE purchase_orders SET approval_status='pending', po_status='draft' WHERE id='p1'").run();
 const r=await x.submit({related_po_ids:['p1'],related_po_id:'p1',related_po_no:'PO-A',
   items:[{sku_code:'SKU-1',po_qty:100,pi_confirmed_qty:60,unit_price:9}]});
 assert.equal(r.status,200,JSON.stringify(r));
 const po=x.queryOne("SELECT * FROM purchase_orders WHERE id='p1'");
 assert.equal(po.approval_status,'pending');
 assert.equal(po.po_status,'draft');
 assert.equal(x.queryOne("SELECT transferred_pi_qty FROM purchase_order_items WHERE id='a1'").transferred_pi_qty,80);
 x.sqlite.close();
});
test('rejected PO remains blocked; no partial PI or PO quantity writes',async()=>{
 const x=fixture();
 x.sqlite.prepare("UPDATE purchase_orders SET approval_status='rejected', po_status='draft' WHERE id='p1'").run();
 const r=await x.submit();
 assert.equal(r.status,400);
 assert.equal(x.query("SELECT COUNT(*) AS n FROM proforma_invoices").rows[0].n,0);
 assert.equal(x.queryOne("SELECT transferred_pi_qty FROM purchase_order_items WHERE id='a1'").transferred_pi_qty,20);
 x.sqlite.close();
});
