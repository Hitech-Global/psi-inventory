'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('price table columns size to their content without forced wide columns', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'assets', 'price-system.js'), 'utf8');
  assert.match(source, /#ps-root table\{border-collapse:separate;border-spacing:0;width:max-content;min-width:0;table-layout:auto;font-size:12px\}/);
  assert.match(source, /#ps-root \.ps-category\{color:#666;text-align:center\}/);
  assert.match(source, /#ps-root \.ps-landing\{min-width:0;display:flex;align-items:center;justify-content:center;gap:8px;text-align:center\}/);
  assert.match(source, /#ps-root \.ps-table-wrap\{overflow:auto/);
  assert.match(source, /#ps-root td\{[^}]*white-space:nowrap/);
  assert.match(source, /#ps-root th\.ps-frozen-cell\{position:sticky;top:0;background:#f7f7f9;z-index:6\}/);
  assert.match(source, /#ps-root td\.ps-frozen-cell\{position:sticky;background:#fff;z-index:4\}/);
  assert.match(source, /#ps-root th:nth-child\(1\),#ps-root td:nth-child\(1\)\{left:0;width:120px/);
  assert.match(source, /#ps-root th:nth-child\(2\),#ps-root td:nth-child\(2\)\{left:120px;width:170px/);
  assert.match(source, /#ps-root tbody tr:hover td\.ps-frozen-cell\{background:#fafafa\}/);
  assert.doesNotMatch(source, /width:100%;min-width:950px/);
  assert.doesNotMatch(source, /\.ps-category\{color:#666;min-width:100px\}/);
  assert.doesNotMatch(source, /\.ps-landing\{min-width:190px/);
});


test('create pricing scheme modal uses a compact responsive form layout', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'assets', 'price-system.js'), 'utf8');
  assert.match(source, /\.ps-scheme-create\{width:min\(100%,760px\);margin:0 auto/);
  assert.match(source, /\.ps-scheme-grid\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(source, /\.ps-scheme-create \.ps-scheme-field input,\.ps-scheme-create \.ps-scheme-field select\{box-sizing:border-box;width:100%;height:40px/);
  assert.match(source, /@media\(max-width:640px\)\{\.ps-scheme-create/);
  assert.match(source, /class="ps-scheme-create"/);
  assert.match(source, /class="ps-scheme-section-title"/);
  assert.match(source, /id="ps-country"/);
  assert.match(source, /id="ps-brand"/);
  assert.match(source, /id="ps-channel"/);
  assert.match(source, /id="ps-shop"/);
  assert.match(source, /id="ps-currency"/);
});
