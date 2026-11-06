'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');

assert.ok(src.includes('<label>CI类型</label><select id="ci-source-mode"'));
assert.ok(src.includes('<option value="all" selected>全部</option>'));
assert.ok(src.includes('function renderUnifiedCITable(operationalData,historicalData)'));

assert.ok(src.includes('table.innerHTML=renderUnifiedCITable(results[0]||[],results[1]||[])'));
assert.ok(!src.includes("运营 CI</h3>{v1}"));
assert.ok(!src.includes("历史 CI</h3>{v2}"));
assert.ok(src.includes('function toggleHistoricalCIDetail'));
assert.ok(src.includes("toggle.className='ci-history-expand ci-list-logi-toggle'"),'historical CI caret must share operational caret styling');
assert.ok(src.includes("className = 'ci-list-logi-toggle'") || fs.readFileSync(path.join(__dirname,'..','ci-list-inline-logistics.js'),'utf8').includes("className = 'ci-list-logi-toggle'"),'operational CI caret style class must remain');
assert.ok(src.includes('function unifiedCICountryLabel(raw)'),'both CI types must use one country label normalizer');
for(const code of ["ID:'印度尼西亚'","TH:'泰国'","MY:'马来西亚'"])assert.ok(src.includes(code),'country code '+code+' must normalize to the Chinese country name');
assert.ok(src.includes('unifiedCICountryLabel(c.country)'));
assert.ok(src.includes('unifiedCICountryLabel(h.country)'));

assert.ok(src.includes('ci-list-logi-row'));
const logisticsUi=fs.readFileSync(path.join(__dirname,'..','ci-list-inline-logistics.js'),'utf8');
const index=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const freightUi=fs.readFileSync(path.join(__dirname,'..','assets','ci-list-freight.js'),'utf8');
assert.ok(logisticsUi.includes('data-ci-logi-toggle'),'existing logistics batch expander must remain available');
assert.ok(index.includes('assets/ci-list-freight.js'),'existing CI freight summary must remain loaded');
assert.ok(src.includes("setAttribute('data-ci-freight-cell','total')"));
assert.ok(freightUi.includes("label === 'ci金额'"));
assert.ok(freightUi.includes("rawClick.indexOf('viewHistoricalCI') !== -1"));
assert.ok(!freightUi.includes('removeInboundColumn(table);'),'unified table must retain inbound status');
for(const field of ['导入历史已付','后续已付','抵扣','抹零'])assert.ok(src.includes(field));
const fn=src.slice(src.indexOf('function renderUnifiedCITable'),src.indexOf('function renderPurchaseAmountSummary'));
for(const field of ['关联PI','关联物流单'])assert.ok(!fn.includes(field),'removed column leaked into unified table');
assert.ok(fn.includes("['物流状态','ci.col.logistics_status']"));
assert.ok(fn.includes("['入库状态','ci.col.inbound_status']"));
console.log('Unified CI management table static regression: PASS');
