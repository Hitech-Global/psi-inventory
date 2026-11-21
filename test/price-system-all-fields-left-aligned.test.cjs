'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('all current and newly configured price fields are left-aligned', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'assets', 'price-system.js'), 'utf8');
  assert.match(source, /#ps-root \.ps-stock\{text-align:left/);
  assert.match(source, /#ps-root \.ps-value\{text-align:left/);
  assert.match(source, /#ps-root \.ps-input\{[^}]*text-align:left/);
  assert.match(source, /#ps-root \.ps-srp\{[^}]*text-align:left/);
  assert.match(source, /const head='<th>'\+tr\('category'\)\+'<\/th><th>'\+tr\('sku'\)\+'<\/th><th>'\+tr\('stock'\)/);
  assert.match(source, /state\.fields\.map\(f=>'<th title=/);
  assert.doesNotMatch(source, /text-align:right/);
});
