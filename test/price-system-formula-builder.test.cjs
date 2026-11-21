'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { BUILTIN_PRICE_VARIABLES, evaluateFormula } = require('../price-system-formula');

const root = path.join(__dirname, '..');
const ui = fs.readFileSync(path.join(root, 'assets', 'price-system.js'), 'utf8');
const api = fs.readFileSync(path.join(root, 'price-system-api.js'), 'utf8');

test('formula editor offers every base variable, dynamic fee fields and arithmetic operators', () => {
  for (const key of BUILTIN_PRICE_VARIABLES) assert.ok(ui.includes(`key:'${key}'`), `missing formula variable button: ${key}`);
  assert.match(ui, /state\.fields\.filter\(x=>x\.field_key!==excluded&&!baseKeys\.has\(x\.field_key\)\)/);
  assert.match(ui, /operators=\['\+','-','\*','\/','\(','\)'\]/);
  assert.match(ui, /window\.psInsertFormulaToken=function\(token\)/);
  assert.match(ui, /oninput="psFormulaInputChanged\(\)"/);
});

test('formula builder is available while editing ordinary fee fields and auto-selects formula type', () => {
  assert.match(ui, /id="ps-formula-wrap" style="\'\+\(isWac\?'display:none':''\)/);
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
});

test('price system resolves quotation primary categories for display and fee applicability', () => {
  assert.match(api, /primaryCategoryMapForSkus\(skuRows, scheme\.brand\)/);
  assert.match(api, /skuMap\.forEach\(sku => \{ sku\.category = categoryBySku\.get/);
  assert.match(ui, /state\.rows\.map\(x=>String\(x\.category\|\|'\'\)/);
});
