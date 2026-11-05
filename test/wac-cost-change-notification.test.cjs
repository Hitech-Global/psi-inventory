'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {buildWacCostChangeRows,resolveWacCostChangeHistory,summarizeWacCostChangeRows,chunkWacCostChangeRows,getUniqueWacCcRecipientIds,buildWacGroupRecipientId,parseWacGroupRecipientId,buildWacCostChangeCard,cardToFallbackText}=require('../wac-notification');

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
test('first-time status is based on a previous cost value, not the write-order version number',()=>{
  const rows=buildWacCostChangeRows([
    {sku_code:'SKU-V1-WITH-BASELINE',version_no:1,old_avg_cost:100,new_avg_cost:110},
    {sku_code:'SKU-V2-WITHOUT-BASELINE',version_no:2,old_avg_cost:0,new_avg_cost:120}
  ]);
  const bySku=new Map(rows.map(row=>[row.sku_code,row]));
  assert.equal(bySku.get('SKU-V1-WITH-BASELINE').is_first_time,false);
  assert.equal(bySku.get('SKU-V1-WITH-BASELINE').change_pct,10);
  assert.equal(bySku.get('SKU-V2-WITHOUT-BASELINE').is_first_time,true);
});

test('previous WAC follows effective confirmed date even when history was imported later',()=>{
  const currentRows=[{
    sku_code:'SKU-HISTORY-ORDER',wac_id:'wac-current',version_no:1,
    old_avg_cost:0,new_avg_cost:120
  }];
  const historyRows=[
    {
      id:'wac-current',sku_code:'SKU-HISTORY-ORDER',country:'Indonesia',warehouse:'Bekasi',
      version_no:1,original_avg_cost:0,new_avg_cost:120,
      confirmed_at:'2026-11-03 02:49:00',created_at:'2026-11-03 02:49:00',
      logistics_batch_id:'batch-current'
    },
    {
      id:'wac-history-imported-later',sku_code:'SKU-HISTORY-ORDER',country:'Indonesia',warehouse:'Bekasi',
      version_no:2,original_avg_cost:0,new_avg_cost:100,
      confirmed_at:'2026-10-27 12:00:00',created_at:'2026-11-04 03:00:00',
      logistics_batch_id:null
    },
    {
      id:'wac-other-country',sku_code:'SKU-HISTORY-ORDER',country:'Malaysia',warehouse:'Bekasi',
      version_no:1,original_avg_cost:0,new_avg_cost:999,
      confirmed_at:'2026-10-01 12:00:00',created_at:'2026-10-01 12:00:00',
      logistics_batch_id:null
    }
  ];
  const resolved=resolveWacCostChangeHistory(currentRows,historyRows);
  assert.equal(resolved[0].old_avg_cost,100);
  assert.equal(resolved[0].previous_wac_id,'wac-history-imported-later');
  const report=buildWacCostChangeRows(resolved)[0];
  assert.equal(report.is_first_time,false);
  assert.equal(report.old_wac,100);
  assert.equal(report.new_wac,120);
  assert.equal(report.change_amount,20);
  assert.equal(report.change_pct,20);
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
test('post-confirmation CC keeps previously notified recipients eligible and deduplicates only within the current selection',()=>{
  assert.deepEqual(getUniqueWacCcRecipientIds(['u1','u2','u2','u3','',null]),['u1','u2','u3']);
  assert.deepEqual(getUniqueWacCcRecipientIds(['u1','u1']),['u1']);
});
test('WAC group recipient keys preserve language and chat ID without colliding with user IDs',()=>{
  assert.equal(buildWacGroupRecipientId('zh','oc_chat_1'),'group:zh:oc_chat_1');
  assert.equal(buildWacGroupRecipientId('en','oc_chat_2'),'group:en:oc_chat_2');
  assert.deepEqual(parseWacGroupRecipientId('group:en:oc_chat_2'),{language:'en',chat_id:'oc_chat_2'});
  assert.equal(parseWacGroupRecipientId('user_123'),null);
  assert.equal(buildWacGroupRecipientId('zh',''),'');
});
test('English WAC cards use the country English-name mapping value',()=>{
  const rows=buildWacCostChangeRows([{sku_code:'SKU-ID',version_no:2,old_avg_cost:100,new_avg_cost:110}]);
  const card=buildWacCostChangeCard({batch_no:'LOG-ID',country:'印度尼西亚',country_en:'Indonesia',rows,summary:summarizeWacCostChangeRows(rows)},'en');
  const summary=card.body.elements.find(e=>e.tag==='markdown').content;
  assert.match(summary,/Country:\*\* Indonesia/);
  assert.doesNotMatch(summary,/Country:\*\* 印度尼西亚/);
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

test('Card 2.0 text fallback preserves report summary and every SKU table row',()=>{
  const rows=buildWacCostChangeRows([
    {sku_code:'SKU-UP',version_no:2,old_avg_cost:100,new_avg_cost:110},
    {sku_code:'SKU-DOWN',version_no:2,old_avg_cost:200,new_avg_cost:190},
    {sku_code:'SKU-FIRST',version_no:1,old_avg_cost:0,new_avg_cost:80}
  ]);
  const card=buildWacCostChangeCard({
    batch_no:'LOG-FALLBACK-TEST',ci_no:'CI-FALLBACK-TEST',brand:'Netac',
    country:'印度尼西亚',country_en:'Indonesia',warehouse:'Bekasi',
    local_currency:'IDR',confirmed_at:'2026-11-05',
    rows,summary:summarizeWacCostChangeRows(rows),part_no:1,part_count:1
  },'zh');
  const fallback=cardToFallbackText(card);
  assert.match(fallback,/WAC 成本变动报告/);
  assert.match(fallback,/Netac/);
  assert.match(fallback,/LOG-FALLBACK-TEST/);
  assert.match(fallback,/SKU 明细/);
  assert.match(fallback,/SKU-UP/);
  assert.match(fallback,/SKU-DOWN/);
  assert.match(fallback,/SKU-FIRST/);
  assert.match(fallback,/原 WAC \(IDR\)/);
  assert.match(fallback,/\+10\.00%/);
  assert.match(fallback,/-5\.00%/);
  assert.match(fallback,/首次建立/);
  assert.doesNotMatch(fallback,/<font\b|<\/font>|\*\*/);
  assert.ok(fallback.length>200);
});
test('legacy Feishu card text fallback remains supported',()=>{
  const fallback=cardToFallbackText({
    header:{title:{content:'Legacy WAC Report'}},
    elements:[{tag:'div',fields:[{text:{content:'**Brand**\nRedragon'}}]}]
  });
  assert.match(fallback,/Legacy WAC Report/);
  assert.match(fallback,/Brand/);
  assert.match(fallback,/Redragon/);
});

test('WAC UI, retry API and both database adapters are wired',()=>{
  const root=path.resolve(__dirname,'..');
  const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
  const ui=fs.readFileSync(path.join(root,'wac-notification-ui.js'),'utf8');
  const index=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
  const pg=fs.readFileSync(path.join(root,'db-pg.js'),'utf8');
  const sqlite=fs.readFileSync(path.join(root,'db-sqlite.js'),'utf8');
  const db=fs.readFileSync(path.join(root,'db.js'),'utf8');
  assert.match(app,/wac-cc-cb/);
  assert.match(app,/openWacCcModal/);
  assert.match(app,/wac-cc-add-cb/);
  assert.match(app,/retryWacNotifications/);
  assert.match(ui,/wac-cc-add-group-cb/);
  assert.match(ui,/wac-cc-macos/);
  assert.match(index,/<script src="wac-notification-ui\.js"><\/script>/);
  assert.match(server,/\/api\/wac\/cc-candidates/);
  assert.match(server,/\/api\/wac\/cc-groups/);
  assert.match(server,/parseWacGroupRecipientId/);
  assert.match(server,/cardToFallbackText/);
  const sendRawStart=server.indexOf('async function sendFeishuRaw');
  const sendRawEnd=server.indexOf('async function sendFeishuMessage',sendRawStart);
  assert.ok(sendRawStart>=0&&sendRawEnd>sendRawStart);
  const sendRawSource=server.slice(sendRawStart,sendRawEnd);
  assert.match(sendRawSource,/content: JSON.stringify\(contentObj\)/);
  assert.match(sendRawSource,/const card = msgType === 'interactive' \? contentObj : null/);
  const sendInteractiveStart=server.indexOf('async function sendFeishuInteractive');
  const sendInteractiveEnd=server.indexOf('async function sendFeishuTextMessage',sendInteractiveStart);
  assert.match(server.slice(sendInteractiveStart,sendInteractiveEnd),/sendFeishuRaw\(receiveId, receiveIdType, 'interactive', card\)/);
  assert.match(server,/buildWacCostChangeReportRows\(logs\)/);
  assert.match(server,/buildWacCostChangeReportRows\(historyRows\)/);
  assert.match(server,/resolveWacCostChangeHistory/);
  assert.match(server,/sendFeishuInteractive\(groupRecipient\.chat_id,'chat_id',card\)/);
  assert.match(server,/\/api\/wac\/notifications\/:logistics_batch_id\/retry/);
  assert.match(server,/\/api\/wac\/notifications\/:logistics_batch_id\/cc/);
  assert.match(server,/FROM wac_history WHERE logistics_batch_id=\?/);
  assert.match(server,/getUniqueWacCcRecipientIds/);
  assert.doesNotMatch(server,/getNewWacCcRecipientIds/);
  assert.equal(server.includes('ON CONFLICT (logistics_batch_id,recipient_user_id,part_no) DO NOTHING'),false);
  assert.match(server,/already_sent:alreadySent/);
  assert.match(ui,/已有抄送记录，可再次 CC/);
  assert.match(ui,/已有抄送记录的人员也可再次选择/);
  assert.match(ui,/已抄送过的群也可再次选择/);
  assert.equal(ui.includes('!existing.has(String(u.id))'),false);
  assert.match(pg,/DROP CONSTRAINT/);
  assert.match(db,/DROP CONSTRAINT/);
  assert.match(sqlite,/wac_notification_logs_repeatable_tmp/);
  assert.equal(pg.includes('UNIQUE(logistics_batch_id, recipient_user_id, part_no)'),false);
  assert.equal(db.includes('UNIQUE(logistics_batch_id, recipient_user_id, part_no)'),false);
  assert.equal(sqlite.includes('UNIQUE(logistics_batch_id, recipient_user_id, part_no)'),false);
  assert.match(server,/business_type.*wac/);
  assert.match(pg,/CREATE TABLE IF NOT EXISTS wac_notification_logs/);
  assert.match(sqlite,/CREATE TABLE IF NOT EXISTS wac_notification_logs/);
  assert.match(db,/CREATE TABLE IF NOT EXISTS wac_notification_logs/);
  assert.match(db,/CREATE INDEX IF NOT EXISTS idx_wac_notification_batch_status/);
});
