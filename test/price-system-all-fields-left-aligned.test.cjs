'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('all current and newly configured price fields are center-aligned', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'assets', 'price-system.js'), 'utf8');
  assert.match(source, /#ps-root th\\{[^}]*text-align:center/);
  assert.match(source, /#ps-root td\\{[^}]*text-align:center/);
  assert.match(source, /#ps-root \\.ps-stock\\{text-align:center/);
  assert.match(source, /#ps-root \\.ps-value\\{text-align:center/);
  assert.match(source, /#ps-root \\.ps-input\\{[^}]*text-align:center/);
  assert.match(source, /#ps-root \\.ps-srp\\{[^}]*text-align:center/);
  assert.match(source, /#ps-root \\.ps-category\\{[^}]*text-align:center/);
  assert.match(source, /#ps-root \\.ps-sku\\{[^}]*text-align:center/);
  assert.match(source, /#ps-root \\.ps-landing\\{[^}]*justify-content:center/);
  assert.match(source, /state\\.fields\\.map\\(f=>'<th title=/);
  assert.doesNotMatch(source, /text-align:left/);
});
