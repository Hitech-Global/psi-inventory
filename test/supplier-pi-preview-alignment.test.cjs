'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const start = app.indexOf('function renderSupplierPIPreview(records){');
const end = app.indexOf('\nasync function submitSupplierPIImport()', start);

test('supplier PI import preview aligns every table header and cell to the left', () => {
  assert.notEqual(start, -1, 'supplier PI preview renderer exists');
  assert.notEqual(end, -1, 'supplier PI preview renderer has a clear boundary');
  const renderer = app.slice(start, end);

  assert.match(
    renderer,
    /#sup-pi-preview \.supplier-pi-preview-table th,#sup-pi-preview \.supplier-pi-preview-table td\{text-align:left!important\}/,
    'left alignment is scoped to the supplier PI preview table'
  );
  assert.match(renderer, /<table class="data-table supplier-pi-preview-table">/);
  assert.doesNotMatch(renderer, /class="text-right"/, 'numeric cells must not override left alignment');
  assert.equal((renderer.match(/<th>/g) || []).length, 6, 'all six preview columns remain present');
  assert.match(renderer, /<td>\x27\+\(r\.pi_confirmed_qty/);
  assert.match(renderer, /<td>\x27\+\(r\.unit_price/);
  assert.match(renderer, /<td>\x27\+\(r\.discount/);
});
