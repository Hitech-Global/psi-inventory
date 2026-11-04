'use strict';

process.env.DB_DRIVER = 'sqlite';
process.env.DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const Module = require('node:module');

const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function(request,parent,isMain,options){
  try{
    return originalResolveFilename.call(this,request,parent,isMain,options);
  }catch(error){
    if(typeof request==='string'&&(request.startsWith('./')||request.startsWith('../'))){
      const base=require('node:path').resolve(require('node:path').dirname(parent?parent.filename:'.'),request);
      try{fs.accessSync(base+'.cjs');return base+'.cjs';}catch(_){}
    }
    throw error;
  }
};

const { query,run,getDB } = require('../db');
const { app } = require('../server');
let AUTH_TOKEN='';

function setupSchema(){
  const d=getDB();
  d.exec('PRAGMA foreign_keys=OFF;');
  d.exec(`
    DROP TABLE IF EXISTS wac_batch_exclusions;
    DROP TABLE IF EXISTS wac_history;
    DROP TABLE IF EXISTS inventory;
    DROP TABLE IF EXISTS packing_list_items;
    DROP TABLE IF EXISTS packing_lists;
    DROP TABLE IF EXISTS commercial_invoices;
    DROP TABLE IF EXISTS logistics_batches;
    DROP TABLE IF EXISTS sessions;
    DROP TABLE IF EXISTS users;
    DROP TABLE IF EXISTS roles;
    DROP TABLE IF EXISTS role_data_scope;
    DROP TABLE IF EXISTS user_data_scope;

    CREATE TABLE logistics_batches(
      id TEXT PRIMARY KEY,batch_no TEXT NOT NULL,related_ci_id TEXT DEFAULT '',related_ci_no TEXT DEFAULT '',
      forwarder_name TEXT DEFAULT '',target_country TEXT DEFAULT '',target_warehouse TEXT DEFAULT '',
      logistics_status TEXT DEFAULT 'pending',actual_arrival_date TEXT DEFAULT '',
      international_freight REAL DEFAULT 0,local_charges REAL DEFAULT 0,customs_service_fee REAL DEFAULT 0,
      delivery_fee REAL DEFAULT 0,customs_duty REAL DEFAULT 0,vat_gst REAL DEFAULT 0,other_fees REAL DEFAULT 0,
      freight_currency TEXT DEFAULT 'USD',total_cartons INTEGER DEFAULT 0,created_at TEXT DEFAULT ''
    );
    CREATE TABLE packing_lists(
      id TEXT PRIMARY KEY,pl_no TEXT DEFAULT '',logistics_batch_id TEXT DEFAULT '',status TEXT DEFAULT 'draft',total_qty REAL DEFAULT 0
    );
    CREATE TABLE packing_list_items(
      id TEXT PRIMARY KEY,pl_id TEXT DEFAULT '',total_qty REAL DEFAULT 0
    );
    CREATE TABLE commercial_invoices(
      id TEXT PRIMARY KEY,ci_no TEXT DEFAULT '',goods_amount REAL DEFAULT 0,currency TEXT DEFAULT 'RMB',brand TEXT DEFAULT ''
    );
    CREATE TABLE wac_history(
      id TEXT PRIMARY KEY,logistics_batch_id TEXT,sku_code TEXT DEFAULT ''
    );
    CREATE TABLE wac_batch_exclusions(
      id TEXT PRIMARY KEY,logistics_batch_id TEXT NOT NULL UNIQUE,batch_no TEXT DEFAULT '',reason TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'excluded',excluded_by TEXT DEFAULT '',excluded_by_name TEXT DEFAULT '',
      excluded_at TEXT DEFAULT '',restored_by TEXT DEFAULT '',restored_by_name TEXT DEFAULT '',
      restored_at TEXT DEFAULT '',created_at TEXT DEFAULT '',updated_at TEXT DEFAULT ''
    );
    CREATE TABLE inventory(
      id TEXT PRIMARY KEY,sku_code TEXT DEFAULT '',country TEXT DEFAULT '',warehouse TEXT DEFAULT '',
      available_qty REAL DEFAULT 0,weighted_avg_cost REAL DEFAULT 0,inventory_value REAL DEFAULT 0
    );
    CREATE TABLE roles(
      id TEXT PRIMARY KEY,name TEXT NOT NULL,description TEXT DEFAULT '',permissions TEXT DEFAULT '[]',
      is_system INTEGER DEFAULT 0,created_at TEXT DEFAULT ''
    );
    CREATE TABLE users(
      id TEXT PRIMARY KEY,username TEXT NOT NULL UNIQUE,name TEXT NOT NULL,password TEXT DEFAULT '',
      role_id TEXT DEFAULT '',status TEXT DEFAULT 'active',email TEXT DEFAULT '',created_at TEXT DEFAULT ''
    );
    CREATE TABLE sessions(
      id TEXT PRIMARY KEY,token_hash TEXT NOT NULL UNIQUE,user_id TEXT NOT NULL,created_at TEXT DEFAULT '',
      expires_at TEXT DEFAULT '',user_agent TEXT DEFAULT '',ip_address TEXT DEFAULT ''
    );
    CREATE TABLE role_data_scope(role_id TEXT PRIMARY KEY,countries TEXT DEFAULT '[]',brands TEXT DEFAULT '[]',warehouses TEXT DEFAULT '[]');
    CREATE TABLE user_data_scope(user_id TEXT PRIMARY KEY,countries TEXT DEFAULT '[]',brands TEXT DEFAULT '[]',warehouses TEXT DEFAULT '[]');
  `);
  d.exec('PRAGMA foreign_keys=ON;');

  run('INSERT INTO roles(id,name,permissions) VALUES(?,?,?)',['role1','WAC operator',JSON.stringify(['ci_view','ci_edit'])]);
  run('INSERT INTO users(id,username,name,role_id,status) VALUES(?,?,?,?,?)',['u1','wac-user','WAC User','role1','active']);
  AUTH_TOKEN='wac-batch-exclusion-'+crypto.randomBytes(8).toString('hex');
  const tokenHash=crypto.createHash('sha256').update(AUTH_TOKEN).digest('hex');
  run('INSERT INTO sessions(id,token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?,?)',
    ['s1',tokenHash,'u1','2026-11-04 00:00:00','2099-12-31 23:59:59']);

  const batches=[
    ['lb1','LOG-001','ci1','CI-001','Forwarder A','印度尼西亚','Bekasi Warehouse','completed','2026-11-01'],
    ['lb2','LOG-002','ci2','CI-002','Forwarder B','印度尼西亚','Bekasi Warehouse','completed','2026-10-30'],
    ['lb3','LOG-003','ci3','CI-003','Forwarder C','泰国','Bangkok Warehouse','completed','2026-10-29']
  ];
  batches.forEach(b=>run('INSERT INTO logistics_batches (id,batch_no,related_ci_id,related_ci_no,forwarder_name,target_country,target_warehouse,logistics_status,actual_arrival_date,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',b.concat(['2026-11-04 00:00:00'])));
  [
    ['ci1','CI-001',1000,'RMB','Netac'],
    ['ci2','CI-002',2000,'RMB','Redragon'],
    ['ci3','CI-003',3000,'RMB','Joypeer']
  ].forEach(ci=>run('INSERT INTO commercial_invoices(id,ci_no,goods_amount,currency,brand) VALUES(?,?,?,?,?)',ci));
  [
    ['pl1','PL-001','lb1',100],
    ['pl2','PL-002','lb2',200],
    ['pl3','PL-003','lb3',300]
  ].forEach(pl=>{
    run('INSERT INTO packing_lists(id,pl_no,logistics_batch_id,status,total_qty) VALUES(?,?,?,?,?)',[pl[0],pl[1],pl[2],'completed',pl[3]]);
    run('INSERT INTO packing_list_items(id,pl_id,total_qty) VALUES(?,?,?)',['pli-'+pl[0],pl[0],pl[3]]);
  });
  run('INSERT INTO wac_history(id,logistics_batch_id,sku_code) VALUES(?,?,?)',['wh3','lb3','SKU-3']);
  run('INSERT INTO inventory(id,sku_code,country,warehouse,available_qty,weighted_avg_cost,inventory_value) VALUES(?,?,?,?,?,?,?)',
    ['inv1','SKU-1','印度尼西亚','Bekasi Warehouse',12,456,5472]);
}

async function request(path,method,body){
  const http=await new Promise(resolve=>{
    const listener=app.listen(0,()=>resolve(listener));
  });
  try{
    const response=await fetch('http://127.0.0.1:'+http.address().port+path,{
      method:method||'GET',
      headers:{'Cookie':'session_token='+AUTH_TOKEN,...(body?{'Content-Type':'application/json'}:{})},
      body:body?JSON.stringify(body):undefined
    });
    return {status:response.status,body:await response.json()};
  }finally{
    await new Promise(resolve=>http.close(resolve));
  }
}

function ids(rows){return rows.map(r=>r.id).sort();}

test('WAC batch exclusion is reversible, atomic, and never deletes or mutates business facts',async()=>{
  setupSchema();

  const initial=await request('/api/wac/pending-batches');
  assert.equal(initial.status,200);
  assert.deepEqual(ids(initial.body),['lb1','lb2']);

  const excluded=await request('/api/wac/batches/exclude','POST',{
    batch_ids:['lb1','lb2'],reason:'之前已手动核算'
  });
  assert.equal(excluded.status,200);
  assert.equal(excluded.body.excluded_count,2);

  const pendingAfter=await request('/api/wac/pending-batches');
  assert.equal(pendingAfter.status,200);
  assert.deepEqual(ids(pendingAfter.body),[]);

  const excludedRows=await request('/api/wac/excluded-batches');
  assert.equal(excludedRows.status,200);
  assert.deepEqual(ids(excludedRows.body),['lb1','lb2']);
  assert.ok(excludedRows.body.every(r=>r.exclusion_reason==='之前已手动核算'));

  // 原始物流、CI、PL、WAC历史、库存数量、WAC和货值均保持不变。
  assert.equal(query('SELECT id FROM logistics_batches').rows.length,3);
  assert.equal(query('SELECT id FROM commercial_invoices').rows.length,3);
  assert.equal(query('SELECT id FROM packing_lists').rows.length,3);
  assert.equal(query('SELECT id FROM wac_history').rows.length,1);
  const inventory=query('SELECT available_qty,weighted_avg_cost,inventory_value FROM inventory WHERE id=?',['inv1']).rows[0];
  assert.equal(Number(inventory.available_qty),12);
  assert.equal(Number(inventory.weighted_avg_cost),456);
  assert.equal(Number(inventory.inventory_value),5472);

  const restored=await request('/api/wac/batches/lb1/restore-exclusion','POST',{});
  assert.equal(restored.status,200);
  assert.equal(restored.body.restored,true);
  const pendingRestored=await request('/api/wac/pending-batches');
  assert.deepEqual(ids(pendingRestored.body),['lb1']);
  const excludedRemaining=await request('/api/wac/excluded-batches');
  assert.deepEqual(ids(excludedRemaining.body),['lb2']);

  // 批量操作具有原子性：混入已确认批次时，lb1 也不得被部分写入。
  const blockedBulk=await request('/api/wac/batches/exclude','POST',{batch_ids:['lb1','lb3']});
  assert.equal(blockedBulk.status,409);
  assert.equal(blockedBulk.body.blockers[0].code,'WAC_ALREADY_CONFIRMED');
  assert.deepEqual(ids((await request('/api/wac/pending-batches')).body),['lb1']);
  assert.equal(query("SELECT status FROM wac_batch_exclusions WHERE logistics_batch_id='lb1'").rows[0].status,'restored');

  // 被排除批次即使从旧页面直接请求，也不能预览或提交WAC确认。
  assert.equal((await request('/api/wac/preview/lb2')).status,409);
  assert.equal((await request('/api/wac/confirm/lb2','POST',{})).status,409);

  const restoredSecond=await request('/api/wac/batches/lb2/restore-exclusion','POST',{});
  assert.equal(restoredSecond.status,200);
  assert.deepEqual(ids((await request('/api/wac/pending-batches')).body),['lb1','lb2']);
  assert.equal((await request('/api/wac/excluded-batches')).body.length,0);
  assert.equal(query("SELECT status FROM wac_batch_exclusions WHERE logistics_batch_id='lb2'").rows[0].status,'restored');
});

test('WAC batch exclusion UI and all database drivers include the reversible exclusion contract',()=>{
  const appSource=fs.readFileSync(require.resolve('../app'),'utf8');
  const serverSource=fs.readFileSync(require.resolve('../server'),'utf8');
  const dbSource=fs.readFileSync(require.resolve('../db'),'utf8');
  const sqliteSource=fs.readFileSync(require.resolve('../db-sqlite'),'utf8');
  const pgSource=fs.readFileSync(require.resolve('../db-pg'),'utf8');

  assert.match(appSource,/无需计算记录/);
  assert.match(appSource,/toggleWacBatchSelection/);
  assert.match(appSource,/openWacBatchExcludeConfirm/);
  assert.match(appSource,/submitWacBatchExclusion/);
  assert.match(appSource,/openWacBatchRestoreConfirm/);
  assert.match(appSource,/submitWacBatchRestore/);
  assert.match(appSource,/wac\/excluded-batches/);
  assert.match(serverSource,/wac_batch_exclusions/);
  assert.match(serverSource,/restore-exclusion/);
  assert.match(dbSource,/CREATE TABLE IF NOT EXISTS wac_batch_exclusions/);
  assert.match(sqliteSource,/CREATE TABLE IF NOT EXISTS wac_batch_exclusions/);
  assert.match(pgSource,/CREATE TABLE IF NOT EXISTS wac_batch_exclusions/);
});
