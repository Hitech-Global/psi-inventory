'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {buildWacCostChangeRows,summarizeWacCostChangeRows,chunkWacCostChangeRows,getNewWacCcRecipientIds,buildWacCostChangeCard}=require('../wac-notification');

test('sorts WAC changes by absolute percentage and places first-time SKUs last',()=>{
  const rows=buildWacCostChangeRows([
    {sku_code:'SKU-A',version_no:2,old_avg_cost:100,new_avg_cost:110},
    {sku_code:'SKU-B',version_no:2,old_avg_cost:100,new_avg_cost:95},
    {sku_code:'SKU-C',version_no:1,old_avg_cost:0,new_avg_cost:120},
    {sku_code:'SKU-D',version_no:2,old_avg_cost:100,new_avg_cost:102}
  ]);
  assert.deepEqual(rows.map(r=>r.sku_code),['SKU-A','SKU-B','SKU-D','SKU-C']);
  assert.equal(rows[0].change_amount,10);
  assert.equal(rows[0].change_pct,10);
  assert.equal(rows[3].is_first_time,true);
  assert.equal(rows[3].old_wac,null);
  assert.equal(rows[3].change_amount,null);
  assert.equal(rows[3].change_pct,null);
});
test('summary and chunking preserve every SKU',()=>{
  const rows=buildWacCostChangeRows([
    {sku_code:'A',version_no:2,old_avg_cost:100,new_avg_cost:101},
    {sku_code:'B',version_no:2,old_avg_cost:100,new_avg_cost:99},
    {sku_code:'C',version_no:2,old_avg_cost:100,new_avg_cost:100},
    {sku_code:'D',version_no:1,old_avg_cost:0,new_avg_cost:10},
    {sku_code:'E',version_no:2,old_avg_cost:0,new_avg_cost:20}
  ]);
  assert.deepEqual(summarizeWacCostChangeRows(rows),{total:5,increase:2,decrease:1,unchanged:1,first_time:1});
  const chunks=chunkWacCostChangeRows(rows,2);
  assert.equal(chunks.length,3);
  assert.deepEqual(chunks.flat().map(r=>r.sku_code),rows.map(r=>r.sku_code));
});
test('post-confirmation CC deduplicates selected IDs and never re-sends to existing recipients',()=>{
  assert.deepEqual(getNewWacCcRecipientIds(['u1','u2','u2','u3','',null],['u2']),['u1','u3']);
  assert.deepEqual(getNewWacCcRecipientIds(['u1','u1'],['u1']),[]);
});
test('Feishu Card 2.0 report has all five columns and every SKU row',()=>{
  const rows=buildWacCostChangeRows([
    {sku_code:'SKU-UP',version_no:2,old_avg_cost:100,new_avg_cost:110},
    {sku_code:'SKU-DOWN',version_no:2,old_avg_cost:100,new_avg_cost:95},
    {sku_code:'SKU-FIRST',version_no:1,old_avg_cost:0,new_avg_cost:120}
  ]);
  const card=buildWacCostChangeCard({batch_no:'LOG-TEST',ci_no:'CI-TEST',brand:'Netac',country:'Indonesia',warehouse:'Bekasi',local_currency:'IDR',confirmed_at:'2026-11-04',rows,summary:summarizeWacCostChangeRows(rows),part_no:1,part_count:1},'zh');
  assert.equal(card.schema,'2.0');
  const table=card.body.elements.find(e=>e.tag==='table');
  assert.ok(table);
  assert.equal(table.page_size,10);
  assert.deepEqual(table.columns.map(c=>c.display_name),['SKU','原 WAC (IDR)','新 WAC (IDR)','变化金额 (IDR)','环比变化']);
  assert.equal(table.rows.length,3);
  assert.equal(table.rows[0].sku,'SKU-UP');
  assert.match(table.rows[0].change_pct,/red/);
  assert.match(table.rows[1].change_pct,/green/);
  assert.match(table.rows[2].change_pct,/首次建立/);
});
test('WAC UI, retry API and both database adapters are wired',()=>{
  const root=path.resolve(__dirname,'..');
  const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
  const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
  const pg=fs.readFileSync(path.join(root,'db-pg.js'),'utf8');
  const sqlite=fs.readFileSync(path.join(root,'db-sqlite.js'),'utf8');
  const db=fs.readFileSync(path.join(root,'db.js'),'utf8');
  assert.match(app,/wac-cc-cb/);
  assert.match(app,/openWacCcModal/);
  assert.match(app,/wac-cc-add-cb/);
  assert.match(app,/retryWacNotifications/);
  assert.match(server,/\/api\/wac\/cc-candidates/);
  assert.match(server,/\/api\/wac\/notifications\/:logistics_batch_id\/retry/);
  assert.match(server,/\/api\/wac\/notifications\/:logistics_batch_id\/cc/);
  assert.match(server,/FROM wac_history WHERE logistics_batch_id=\?/);
  assert.match(server,/getNewWacCcRecipientIds/);
  assert.match(server,/business_type.*wac/);
  assert.match(pg,/CREATE TABLE IF NOT EXISTS wac_notification_logs/);
  assert.match(sqlite,/CREATE TABLE IF NOT EXISTS wac_notification_logs/);
  assert.match(db,/CREATE TABLE IF NOT EXISTS wac_notification_logs/);
  assert.match(db,/CREATE INDEX IF NOT EXISTS idx_wac_notification_batch_status/);
});
