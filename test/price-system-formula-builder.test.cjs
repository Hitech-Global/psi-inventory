'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { BUILTIN_PRICE_VARIABLES, evaluateFormula } = require('../price-system-formula');

const root = path.join(__dirname, '..');
const ui = fs.readFileSync(path.join(root, 'assets', 'price-system.js'), 'utf8');
const api = fs.readFileSync(path.join(root, 'price-system-api.js'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'migrations', 'price-system.js'), 'utf8');

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
  assert.ok(ui.includes('oninput="psFormulaRuleChanged(\'+index+\',this)"'));
  assert.match(ui, /onfocus="window\.__psFormulaTargetInput=this"/);
});

test('formula rules support multiple formulas with multi-category selection and quick actions', () => {
  assert.ok(ui.includes(`id="ps-formula-wrap" style="'+(isWac||isQuote||type==='percent'||type==='reference'?'display:none':'')+'"`));
  assert.ok(ui.includes('window.__psFormulaRulesDraft='));
  assert.ok(ui.includes('function formulaRuleDraftsFromMap(map,legacyFormula,legacyCategories,categoryList)'));
  assert.ok(ui.includes('window.psAddFormulaRule=function()'));
  assert.ok(ui.includes('window.psCopyFormulaRule=function(index)'));
  assert.ok(ui.includes('window.psDeleteFormulaRule=function(index)'));
  assert.ok(ui.includes('window.psSelectAllRuleCategories=function(index)'));
  assert.ok(ui.includes('window.psClearRuleCategories=function(index)'));
  assert.ok(ui.includes('window.psFilterRuleCategories=function(index,query)'));
  assert.ok(ui.includes('class="ps-formula-rule-input"'));
  assert.ok(ui.includes('formula_rules[category]=expression'));
  assert.ok(ui.includes('id="ps-reference-scheme"'));
  assert.ok(ui.includes('id="ps-reference-field"'));
  assert.ok(ui.includes('psReferenceSourceChanged'));
  assert.ok(ui.includes('psReferenceFieldChanged'));
  assert.ok(ui.includes("f.field_type==='reference'"));
  assert.ok(ui.includes('window.psPreviewFormulaRule=async function(index)'));
  assert.ok(ui.includes('每条公式规则都需要填写公式并至少选择一个适用类目。'));
  assert.ok(ui.includes('被多个公式规则重复选择'));
  assert.ok(ui.includes('applicable_categories=field_type===\'formula\'?[]'));
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
  assert.match(api, /validateFormula\(normalizeFormulaExpression\(formula, existingFieldsForSrp\), allowedFormulaVariables\(existingFieldsForSrp, 'srp'\)\)/);
  assert.ok(BUILTIN_PRICE_VARIABLES.includes('srp'));
});

test('price system resolves quotation primary categories for display and fee applicability', () => {
  assert.match(api, /primaryCategoryMapForSkus\(skuRows, scheme\.brand\)/);
  assert.match(api, /skuMap\.forEach\(sku => \{ sku\.category = categoryBySku\.get/);
  assert.match(ui, /state\.rows\.map\(x=>String\(x\.category\|\|'\'\)/);
});

test('price system toolbar keeps fee settings separate and groups remaining actions in one menu', () => {
  const shell = ui.slice(ui.indexOf('function shell(){'), ui.indexOf('async function meta()', ui.indexOf('function shell(){')));
  assert.ok(shell.includes('<div id="ps-main">'));
  assert.ok(!shell.includes('class="ps-head"'), 'redundant page title and subtitle should be removed');
  assert.ok(!shell.includes("tr('title')") && !shell.includes("tr('subtitle')"));
  const main = ui.slice(ui.indexOf('function main(){'), ui.indexOf('function updateSave()', ui.indexOf('function main(){')));
  assert.ok(main.includes('onclick="psOpenFieldsModal()"'), 'fee field settings should remain a standalone button');
  assert.ok(main.includes('class="ps-actions-menu-wrap"'));
  assert.ok(main.includes('id="ps-actions-menu"'));
  assert.ok(main.includes('psDownloadImportTemplate()'), 'template download should be in the actions menu');
  assert.ok(main.includes('psClickImport()'), 'Excel import should be in the actions menu');
  assert.ok(main.includes('psOpenSchemeModal()'), 'new scheme should be in the actions menu');
  assert.ok(main.includes('psOpenVersionsModal()'));
  assert.ok(main.includes('psDeactivateScheme()'));
  assert.ok(main.includes('psExportExcel()'));
  assert.ok(main.includes('psSaveChanges()'));
  assert.ok(main.includes('psDeleteScheme()'));
  assert.match(ui, /window\.psToggleActionsMenu=function\(event\)/);
  assert.match(ui, /window\.psCloseActionsMenu=function\(\)/);
  assert.match(ui, /ps-actions-menu\[hidden\]\{display:none\}/);
  assert.ok(!main.includes('ps-import-menu'));
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
  assert.ok(ui.includes("isWac||isQuote||type==='percent'?'display:none':''"));
  assert.ok(ui.includes("if(w)w.style.display=(c&&c.checked)||(q&&q.checked)||t==='percent'?'none':'';"));
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


test('formula rules expose MIN/MAX and a server-validated preview for the selected category', () => {
  assert.ok(ui.includes("const functions=['MIN','MAX']"));
  assert.ok(ui.includes("const isFunction=['MIN','MAX'].includes(token)"));
  assert.match(ui, /window\.psPreviewFormulaRule=async function\(index\)/);
  assert.match(ui, /formula\/preview','POST'/);
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


test('category scope starts unselected, toggles both ways and hides dynamically for formula fields', () => {
  assert.ok(ui.includes('id="ps-category-scope-wrap"'));
  assert.ok(ui.includes("style=\"'+(type==='formula'?'display:none':'')+'\""));
  assert.ok(ui.includes("if(scope)scope.style.display=t==='formula'?'none':'';"));
  assert.ok(ui.includes('const allScope=categoryList.length>0&&selected.size===categoryList.length;'));
  assert.ok(ui.includes("((allScope||selected.has(category))?'checked':'')"));
  assert.ok(ui.includes('const selectAll=!checks.every(x=>x.checked);'));
  assert.ok(ui.includes('checks.forEach(x=>{x.checked=selectAll;});'));
  assert.ok(ui.includes('window.psUpdateCategorySelectAll();'));
  assert.ok(!ui.includes('if(checks.length&&checked===0){checks.forEach(x=>{x.checked=true;});'));
  assert.ok(ui.includes("const applicable_categories=field_type==='formula'?[]:((!checked.length||checked.length===total)?[]:checked);"));
});


test('category formula rules are persisted, validated and restored without falling back to another category', () => {
  assert.match(api, /function parseFormulaRules\(value\)/);
  assert.match(api, /function formulaForCategory\(field, category\)/);
  assert.match(api, /formula_rules = \?/);
  assert.match(api, /if \(field\.field_type === 'formula' && Object\.keys\(parseFormulaRules\(field\.formula_rules\)\)\.length && !categoryFormula\)/);
  assert.match(api, /Object\.keys\(formulaRules\)\.forEach\(category =>/);
  assert.match(api, /formula_rules = \?/);
  assert.match(api, /JSON\.stringify\(parseFormulaRules\(field\.formula_rules\)\)/);
  assert.match(api, /getFormulaVariables\(expression\)/);
});

test('formula rule values can be different by category while preserving the shared fee key', () => {
  const accessories = evaluateFormula('8.5% * srp', { srp: 1000000 });
  const memoryCard = evaluateFormula('MIN(8.5% * srp,60000)', { srp: 1000000 });
  const ssd = evaluateFormula('MIN(7.2% * srp,80000)', { srp: 1000000 });
  const dram = evaluateFormula('6% * srp', { srp: 1000000 });
  assert.deepEqual([accessories,memoryCard,dram],[85000,60000,60000]);
  assert.ok(Math.abs(ssd-72000)<1e-8);
});


test('formula editor displays readable field names instead of internal field keys', () => {
  assert.ok(ui.includes('function formulaTokenLabel(token)'));
  assert.ok(ui.includes('function formulaDisplayExpression(expression)'));
  assert.ok(ui.includes('function priceFieldDisplayName(field)'));
  assert.ok(ui.includes('esc(priceFieldDisplayName(x))+"</button>"'));
  assert.ok(!ui.includes('esc(x.field_key)+"</code></button>'));
  assert.ok(ui.includes('rule.formula=String(input.value||\'\')'));
  assert.ok(ui.includes('const displayToken='));
});

test('backend normalizes localized readable formula labels to stable internal keys', () => {
  assert.match(api, /function normalizeFormulaExpression\(expression, fields\)/);
  assert.match(api, /purchase_price_rmb: \['采购价 RMB', 'Purchase Price RMB', 'Harga Beli RMB'\]/);
  assert.match(api, /stock_qty: \['库存数量', 'Stock Qty', 'Jumlah Stok'\]/);
  assert.match(api, /aliases\.forEach\(\(\[label, key\]\)/);
  assert.match(api, /normalizeFormulaExpression\(expression, existingFields\)/);
  assert.match(api, /normalizeFormulaExpression\(formula, fields\)/);
});


test('formula editor and field list share the exact configured field display name', () => {
  assert.ok(ui.includes('function priceFieldDisplayName(field)'));
  assert.ok(ui.includes('priceFieldDisplayName(x))+"</button>"'));
  assert.ok(ui.includes("esc(priceFieldDisplayName(f))+'</div><code"));
  assert.ok(ui.includes('state.fields.map(x=>[x.field_key,priceFieldDisplayName(x)||x.field_key])'));
});


test('formula rule cards store one expression across all selected categories in the existing category map', () => {
  assert.ok(ui.includes('categories.forEach(category=>{'));
  assert.ok(ui.includes('formula_rules[category]=expression'));
  assert.ok(ui.includes('grouped.find(x=>x.formula===expression)'));
  assert.ok(ui.includes('window.psSetRuleCategory=function(index,category,checked)'));
  assert.ok(ui.includes('const taken=(window.__psFormulaRulesDraft||[]).some'));
  assert.ok(ui.includes('this.dataset.category'));
});


test('formula fields support independent cell display format and decimal precision', () => {
  assert.ok(ui.includes("displayFormat:'Cell Format'") || ui.includes("displayFormat:'单元格格式'"));
  assert.ok(ui.includes('id="ps-field-display-format"'));
  assert.ok(ui.includes('id="ps-field-decimal-places"'));
  assert.ok(ui.includes("if(format==='percent')return number(f.field_type==='formula'?raw*100:raw)+'%'"));
  assert.ok(ui.includes('display_format,decimal_places'));
  assert.ok(ui.includes("f.display_format==='percent'?'<span class=\"ps-unit\">%</span>'"));
  assert.ok(ui.includes("cell.z='0.00%'"));
  assert.match(api, /display_format = \?, decimal_places = \?/);
  assert.match(api, /displayFormat, decimalPlaces, syncWac/);
  assert.match(api, /field\.display_format \|\| 'auto'/);
  assert.match(migration, /display_format TEXT NOT NULL DEFAULT 'auto'/);
  assert.match(migration, /decimal_places INTEGER NOT NULL DEFAULT 2/);
});

test('all editable amount inputs display thousand separators while save values remain numeric', () => {
  assert.ok(ui.includes("function formatAmountInput(value,decimalPlaces)"));
  assert.ok(ui.includes("n.toLocaleString('en-US',{maximumFractionDigits:p})"));
  assert.ok(ui.includes('window.psPrepareAmountInput=function(input)'));
  assert.ok(ui.includes('window.psFormatAmountInput=function(input)'));
  assert.ok(ui.includes("replace(/,/g,'').trim()"));
  assert.ok(ui.includes("state.dirty[sku][key]=raw===''?null:Number(raw)"));
  assert.ok(ui.includes('data-decimal-places="2"'));
  assert.ok(ui.includes('formatAmountInput(shown,2)'));
  assert.ok(ui.includes("const isAmountInput=f.field_type==='amount'||(f.field_type!=='percent'&&f.display_format==='amount')"));
  assert.ok(ui.includes("type=\"'+(isAmountInput?'text':'number')+'\""));
  assert.ok(ui.includes('formatAmountInput(shown,inputPlaces)'));
  assert.ok(ui.includes("row.srp=values.srp;delete row.values.srp"));
});
