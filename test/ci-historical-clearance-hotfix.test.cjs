'use strict';
const assert=require('node:assert/strict');
const {patchPerf,patchServer,UI_MARKER,SERVER_MARKER}=require('../scripts/ci-historical-clearance-hotfix.cjs');
const {ensureHistoricalCIClearanceColumn}=require('../migrations/historical-ci-clearance');

const perf=patchPerf('function renderHistoricalCITable(data){return data;}');
assert.equal(patchPerf(perf),perf,'UI patch is idempotent');
assert.ok(perf.includes(UI_MARKER));
assert.ok(perf.includes("querySelectorAll('tr.clickable-detail-row')"));
assert.ok(perf.includes("updateHistoricalCIClearance"));
assert.ok(perf.includes("'/api/historical-commercial-invoices/'"));
assert.ok(perf.includes("h.clearance_type"));
new Function(perf);

const server=[
'function initDatabase(){}',
'if (require.main === module) {',
'  initDatabase();',
'}',
"  // CI-SHIP-DATE-01：仅补充/更正历史 CI 的实际出货日期（不触发 payable_date、不动 due_date、不创建/修改 payment_request）",
].join('\n');
const patched=patchServer(server);
assert.equal(patchServer(patched),patched,'server patch is idempotent');
assert.ok(patched.includes(SERVER_MARKER));
assert.ok(patched.includes("ensureHistoricalCIClearanceColumn"));
assert.ok(patched.includes("app.put('/api/historical-commercial-invoices/:id'"));
assert.ok(patched.includes("UPDATE historical_commercial_invoices SET clearance_type"));
new Function(patched);

let runCalls=[];
const pgQuery=()=>({rows:[]});
const pgResult=ensureHistoricalCIClearanceColumn((sql)=>runCalls.push(sql),pgQuery,true);
assert.deepEqual(pgResult,{added:true});
assert.match(runCalls[0],/ALTER TABLE historical_commercial_invoices ADD COLUMN clearance_type TEXT/);
runCalls=[];
const pgExisting=ensureHistoricalCIClearanceColumn((sql)=>runCalls.push(sql),()=>({rows:[{column_name:'clearance_type'}]}),true);
assert.deepEqual(pgExisting,{added:false});
assert.equal(runCalls.length,0,'existing PG column is not altered');
runCalls=[];
const sqliteExisting=ensureHistoricalCIClearanceColumn((sql)=>runCalls.push(sql),()=>({rows:[{name:'clearance_type'}]}),false);
assert.deepEqual(sqliteExisting,{added:false});
assert.equal(runCalls.length,0,'existing SQLite column is not altered');
console.log('historical CI clearance setting regression: PASS');
