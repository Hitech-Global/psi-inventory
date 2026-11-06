'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const app = fs.readFileSync(require.resolve('../app.js'), 'utf8');

const opStart = app.indexOf('function renderOperationalCITable');
const histStart = app.indexOf('function renderHistoricalCITable');
const summaryStart = app.indexOf('function renderPurchaseAmountSummary');
assert.ok(opStart >= 0 && histStart > opStart && summaryStart > histStart, 'CI list renderers must exist');
const operational = app.slice(opStart, histStart);
const historical = app.slice(histStart, summaryStart);

assert.match(operational, /title="编辑CI"/, 'operational CI list must show an explicit edit action');
assert.ok(operational.includes('title="编辑CI">编辑</button>'), 'edit action must have a visible text label, not only an icon');
assert.match(operational, /hasPermission\('ci_edit'\)/, 'edit action must respect CI edit permission');
assert.match(operational, /editCI\(/, 'edit action must call the existing CI editor');
assert.doesNotMatch(operational, /<th>供应商<\/th>/, 'operational CI table must not show supplier column');
assert.doesNotMatch(operational, /c\.supplier_name/, 'operational CI table must not render supplier cells');
assert.doesNotMatch(historical, /<th>供应商<\/th>/, 'historical CI table must not show supplier column');
assert.doesNotMatch(historical, /h\.supplier_name/, 'historical CI table must not render supplier cells');

console.log('CI edit entry and supplier column regression: PASS');
