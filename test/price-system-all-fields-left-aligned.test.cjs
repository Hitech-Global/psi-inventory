'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('all current and newly configured price fields are center-aligned', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'assets', 'price-system.js'), 'utf8');
  assert.ok(source.includes('#ps-root th{position:sticky;top:0;z-index:2;background:#f7f7f9;color:#666;font-weight:600;text-align:center;'));
  assert.ok(source.includes('#ps-root td{padding:7px 9px;border-bottom:1px solid #f0f0f2;white-space:nowrap;vertical-align:middle;text-align:center}'));
  assert.ok(source.includes('#ps-root .ps-stock{text-align:center;'));
  assert.ok(source.includes('#ps-root .ps-value{text-align:center;'));
  assert.ok(source.includes('padding:3px 7px;text-align:center;'));
  assert.ok(source.includes('#ps-root .ps-srp{font-weight:700;color:#1d1d1f;text-align:center}'));
  assert.ok(source.includes('#ps-root .ps-category{color:#666;text-align:center}'));
  assert.ok(source.includes('#ps-root .ps-sku{font-weight:600;color:#252525;text-align:center}'));
  assert.ok(source.includes('#ps-root .ps-landing{min-width:0;display:flex;align-items:center;justify-content:center;'));
  assert.ok(source.includes('state.fields.map(f=>{'));
});
