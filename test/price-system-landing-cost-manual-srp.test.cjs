'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ui=fs.readFileSync('assets/price-system.js','utf8');
const api=fs.readFileSync('price-system-api.js','utf8');
test('price table removes product name and exposes Landing Cost with manual WAC selection',()=>{
 assert.match(ui,/landingCost:'Landing Cost'/);
 assert.match(ui,/psChooseWac/); assert.match(ui,/psApplyWac/); assert.match(ui,/__landing_cost_wac_id/);
 const start=ui.indexOf('const head='); const end=ui.indexOf('const rows=',start); assert.ok(start>=0&&end>start);
 assert.doesNotMatch(ui.slice(start,end),/tr\('product'\)/);
});
test('Landing Cost picker only reads confirmed locked WAC history scoped to SKU and country',()=>{
 assert.ok(api.includes("'/api/price-system/schemes/:id/wac/:sku'"));
 assert.ok(api.includes('COALESCE(is_locked,0) = 1'));
 assert.ok(api.includes("NOT IN ('reversed','void','cancelled')"));
 assert.ok(api.includes('values.__landing_cost_wac_id'));
});
test('SRP Excel column is imported and manual SRP overrides formula output',()=>{
 assert.ok(ui.includes('headers.findIndex(x=>/^SRP$/i.test(x))'));
 assert.ok(ui.includes('values.__srp_manual=manualSrp'));
 assert.ok(ui.includes('Number.isFinite(manualSrp)'));
 assert.ok(api.includes('stored.__srp_manual == null ? srp : Number(stored.__srp_manual)'));
});
