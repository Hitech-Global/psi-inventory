'use strict';
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const {patchPerf,patchServer,UI_MARKER,SERVER_MARKER}=require('../scripts/ci-historical-clearance-hotfix.cjs');
const indexHtml=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
assert.match(indexHtml,/<script src="app-perf\.js\?v=[^"]+"><\/script>/,'app-perf.js must be cache-busted after generated hotfix changes');
const {ensureHistoricalCIClearanceColumn}=require('../migrations/historical-ci-clearance');

const perf=patchPerf('function renderHistoricalCITable(data){return data;}');
assert.equal(patchPerf(perf),perf,'UI patch is idempotent');
assert.ok(perf.includes(UI_MARKER));
assert.ok(perf.includes("querySelectorAll('tr.clickable-detail-row')"));
assert.ok(perf.includes("updateHistoricalCIClearance"));
assert.ok(perf.includes("'/api/historical-commercial-invoices/'"));
assert.ok(perf.includes("h.clearance_type"));
assert.ok(perf.includes("text==='国家'||text==='Country'"),'historical clearance column must work in Chinese and English source tables');
assert.ok(perf.includes("label('ci.clearance_type','清关方式')"),'historical clearance selector label must follow the current language');

const labelHelperAt=perf.indexOf('function label(key,fallback)');
const selectHtmlAt=perf.indexOf('function selectHtml(h)');
assert.ok(labelHelperAt>=0 && labelHelperAt<selectHtmlAt,'label helper must be in the wrapper scope, not nested inside selectHtml');

// Run the generated wrapper, not just a syntax check: the unified CI list calls this
// wrapper while rendering historical rows, so a missing outer-scope helper blanks the list.
const listeners={};
const select={setAttribute(){}};
const headerRow={cells:[{textContent:'国家'}],insertCell(index){const cell={textContent:''};this.cells.splice(index,0,cell);return cell;}};
const historicalRow={cells:[],insertCell(index){const cell={innerHTML:'',onclick:null,querySelector(){return select;}};this.cells.splice(index,0,cell);return cell;}};
const table={tHead:{rows:[headerRow]},tBodies:[{length:1,querySelectorAll(){return [historicalRow];}}]};
const host={set innerHTML(value){},get innerHTML(){return 'wrapped-html';},querySelector(){return table;}};
const sandbox={
  console,Promise,
  addEventListener(name,fn){listeners[name]=fn;},
  t(key,fallback){return fallback;},
  esc(value){return String(value==null?'':value);},
  hasPermission(){return true;},
  api(){return Promise.resolve({});},
  showToast(){},
  document:{head:{appendChild(){}},getElementById(){return null;},createElement(tag){return tag==='div'?host:{};}}
};
sandbox.window=sandbox;
sandbox.globalThis=sandbox;
vm.runInNewContext(perf,sandbox);
assert.equal(typeof listeners.DOMContentLoaded,'function','historical clearance wrapper must register');
listeners.DOMContentLoaded();
assert.equal(sandbox.renderHistoricalCITable([{id:'HCI-1',clearance_type:'formal'}]),'wrapped-html','historical CI table must render after adding clearance selector');
assert.equal(headerRow.cells[1].textContent,'清关方式','historical clearance header should be localized');

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
