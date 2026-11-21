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
  assert.match(source, /#ps-root th:nth-child\(-n\+2\),#ps-root td:nth-child\(-n\+2\)\{position:sticky;background:#fff\}/);
  assert.match(source, /#ps-root th:nth-child\(1\),#ps-root td:nth-child\(1\)\{left:0;width:120px/);
  assert.match(source, /#ps-root th:nth-child\(2\),#ps-root td:nth-child\(2\)\{left:120px;width:170px/);
  assert.match(source, /#ps-root tbody tr:hover td:nth-child\(-n\+2\)\{background:#fafafa\}/);
  assert.doesNotMatch(source, /width:100%;min-width:950px/);
  assert.doesNotMatch(source, /\.ps-category\{color:#666;min-width:100px\}/);
  assert.doesNotMatch(source, /\.ps-landing\{min-width:190px/);
});
