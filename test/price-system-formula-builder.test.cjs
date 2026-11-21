'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { BUILTIN_PRICE_VARIABLES, evaluateFormula } = require('../price-system-formula');

const root = path.join(__dirname, '..');
const ui = fs.readFileSync(path.join(root, 'assets', 'price-system.js'), 'utf8');
const api = fs.readFileSync(path.join(root, 'price-system-api.js'), 'utf8');

test('formula editor groups base data, fee fields and SRP separately without duplicate aliases', () => {
  for (const key of ['purchase_price_rmb','purchase_price_usd','standard_purchase_price','weighted_avg_cost','inventory_wac','reference_customs_rate','landing_cost','stock_qty']) {
    assert.ok(ui.includes(`{key:'${key}'`), `missing base variable button: ${key}`);
  }
  assert.ok(!ui.includes("{key:'inventory_qty'"), 'inventory_qty should not duplicate stock_qty');
  assert.match(ui, /x\.field_key!=='srp'/, 'SRP must not be mixed into fee fields');
  assert.match(ui, /x\.field_key!=='inventory_qty'/, 'inventory_qty alias must be hidden');
  assert.match(ui, /Number\(x\.sync_wac\|\|0\)!==1/, 'WAC-synced fee aliases should not duplicate system Landing Cost');
  assert.ok(ui.includes('formulaBaseFields') && ui.includes('formulaFeeFields') && ui.includes('formulaPriceFields'));
  assert.ok(ui.includes("psInsertFormulaToken('srp')"), 'SRP should be available as a separate price variable');
  assert.ok(ui.includes("operators=['+','-','*','/','(',')','%']"), 'percent operator must be available');
  assert.match(ui, /window\.psInsertFormulaToken=function\(token\)/);
  assert.match(ui, /oninput="psFormulaInputChanged\(\)"/);
});

test('formula builder is available while editing ordinary fee fields and auto-selects formula type', () => {
  assert.ok(ui.includes(`id="ps-formula-wrap" style="'+(isWac||type==='percent'?'display:none':'')+'"`));
  assert.match(ui, /if\(formula\)field_type='formula'/);
  assert.match(ui, /window\.psFormulaInputChanged=function\(\)[\s\S]*type\.value='formula'/);
});

test('formula evaluation can combine WAC, percentage fees and other calculated fields', () => {
  const result = evaluateFormula('landing_cost * (1 + platform_commission / 100) + customs_duty', {
    landing_cost: 100,
    platform_commission: 8,
    customs_duty: 5
  });
  assert.equal(result, 113);
  assert.ok(Math.abs(evaluateFormula('7.2% * srp', { srp: 1000 }) - 72) < 1e-9);
  assert.equal(BUILTIN_PRICE_VARIABLES.includes('srp'), true);
});

test('SRP can be edited inline and is saved through the dedicated SRP payload field', () => {
  assert.match(ui, /if\(f\.field_key==='srp'\)[\s\S]*data-field="srp"[\s\S]*psMarkDirty\(this\)/);
  assert.match(ui, /row\.srp=values\.srp;delete row\.values\.srp/);
  assert.match(api, /if \(Object\.prototype\.hasOwnProperty\.call\(row \|\| \{\}, 'srp'\)\)/);
  assert.match(api, /INSERT INTO price_system_srp_values/);
});

test('SRP is allowed as a dependency for fee formulas but cannot reference itself', () => {
  assert.match(api, /BUILTIN_PRICE_VARIABLES\.filter\(key => key !== excludeKey\)/);
  assert.match(api, /validateFormula\(formula, allowedFormulaVariables\(fields, 'srp'\)\)/);
  assert.ok(BUILTIN_PRICE_VARIABLES.includes('srp'));
});

test('price system resolves quotation primary categories for display and fee applicability', () => {
  assert.match(api, /primaryCategoryMapForSkus\(skuRows, scheme\.brand\)/);
  assert.match(api, /skuMap\.forEach\(sku => \{ sku\.category = categoryBySku\.get/);
  assert.match(ui, /state\.rows\.map\(x=>String\(x\.category\|\|'\'\)/);
});

test('price system toolbar removes redundant page heading and combines Excel import actions', () => {
  const shell = ui.slice(ui.indexOf('function shell(){'), ui.indexOf('async function meta()', ui.indexOf('function shell(){')));
  assert.ok(shell.includes('<div id="ps-main">'));
  assert.ok(!shell.includes('class="ps-head"'), 'redundant page title and subtitle should be removed');
  assert.ok(!shell.includes("tr('title')") && !shell.includes("tr('subtitle')"));
  const main = ui.slice(ui.indexOf('function main(){'), ui.indexOf('function updateSave()', ui.indexOf('function main(){')));
  assert.ok(main.includes('class="ps-import-menu-wrap"'));
  assert.ok(main.includes('id="ps-import-menu"'));
  assert.ok(main.includes('psDownloadImportTemplate()'), 'template download should be in the import dropdown');
  assert.ok(main.includes('psClickImport()'), 'Excel import should remain available in the dropdown');
  assert.ok(!main.includes('onclick="psDownloadImportTemplate()"'), 'template download should no longer be a standalone toolbar button');
  assert.ok(main.includes("onclick=\"psOpenSchemeModal()\""), 'new scheme action should move into the toolbar');
  assert.match(ui, /window\.psToggleImportMenu=function\(event\)/);
  assert.match(ui, /window\.psCloseImportMenu=function\(\)/);
  assert.match(ui, /ps-import-menu\[hidden\]\{display:none\}/);
});

test('percentage fields have a bulk default control and batch-apply to SKUs in the selected category scope', () => {
  assert.ok(ui.includes('id="ps-percent-wrap"'));
  assert.ok(ui.includes('id="ps-field-default-percent"'));
  assert.ok(ui.includes('window.psApplyPercentToSkus=async function(id)'));
  assert.ok(ui.includes('values:{[data.field_key]:percent}'));
  assert.ok(ui.includes("'/values','POST'"));
  assert.ok(ui.includes('f.field_type===\'percent\'?\'<span class="ps-unit">%</span>\''));
  assert.ok(ui.includes('data-field="') && ui.includes('esc(f.field_key)'));
  assert.ok(ui.includes('window.psMarkDirty=function(input)'));
});

test('percentage field type displays percentage settings and hides formula calculation settings', () => {
  assert.ok(ui.includes("isWac||type==='percent'?'display:none':''"));
  assert.ok(ui.includes("if(w)w.style.display=(c&&c.checked)||t==='percent'?'none':'';"));
  assert.ok(ui.includes("if(p)p.style.display=t==='percent'?'':'none';"));
});

test('category scope editor provides a reversible select-all action and keeps empty scope as all categories', () => {
  assert.ok(ui.includes('ps-category-select-all'));
  assert.ok(ui.includes('window.psSelectAllCategories=function()'));
  assert.ok(ui.includes('const selectAll=!checks.every(x=>x.checked);'));
  assert.ok(ui.includes('checks.forEach(x=>{x.checked=selectAll;})'));
  assert.ok(ui.includes('window.psUpdateCategorySelectAll();'));
  assert.ok(ui.includes('(!checked.length||checked.length===total)?[]:checked'));
  assert.ok(ui.includes('allScope||selected.has(category)'));
  assert.ok(!ui.includes('if(checks.length&&checked===0)'));
});


test('formula editor exposes MIN/MAX and a live server-validated SKU preview', () => {
  assert.ok(ui.includes("const functions=['MIN','MAX']"));
  assert.ok(ui.includes("const isFunction=['MIN','MAX'].includes(token)"));
  assert.match(ui, /id="ps-formula-preview"/);
  assert.match(ui, /window\.psRunFormulaPreview=async function/);
  assert.match(api, /app\.post\('\/api\/price-system\/schemes\/:id\/formula\/preview'/);
  assert.match(api, /formula_context: Object\.assign\(\{\}, base, values\)/);
});

test('all price-system table fields, including dynamically added fields, are center aligned', () => {
  assert.ok(ui.includes('#ps-root th{position:sticky;top:0;z-index:2;background:#f7f7f9;color:#666;font-weight:600;text-align:center;'));
  assert.ok(ui.includes('#ps-root .ps-category{color:#666;text-align:center}'));
  assert.ok(ui.includes('#ps-root .ps-sku{font-weight:600;color:#252525;text-align:center}'));
  assert.ok(ui.includes('#ps-root .ps-stock{text-align:center;'));
  assert.ok(ui.includes('#ps-root .ps-value{text-align:center;'));
  assert.ok(ui.includes('padding:3px 7px;text-align:center;'));
  assert.ok(ui.includes('#ps-root .ps-srp{font-weight:700;color:#1d1d1f;text-align:center}'));
  assert.ok(ui.includes('justify-content:center;gap:8px;text-align:center}#ps-root .ps-landing-value'));
  assert.ok(ui.includes("state.fields.map(f=>'<th"));
  assert.ok(ui.includes("return '<td class=\"ps-value\"><input"));
});


test('category scope starts unselected and select-all toggles both ways', () => {
  assert.ok(ui.includes('const allScope=categoryList.length>0&&selected.size===categoryList.length;'));
  assert.ok(ui.includes("((allScope||selected.has(category))?'checked':'')"));
  assert.ok(ui.includes('const selectAll=!checks.every(x=>x.checked);'));
  assert.ok(ui.includes('checks.forEach(x=>{x.checked=selectAll;});'));
  assert.ok(ui.includes('window.psUpdateCategorySelectAll();'));
  assert.ok(!ui.includes('if(checks.length&&checked===0){checks.forEach(x=>{x.checked=true;});'));
  assert.ok(ui.includes('const applicable_categories=(!checked.length||checked.length===total)?[]:checked;'));
});
