'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('price system field INSERT supplies one value for every target column', () => {
  const api = fs.readFileSync(path.join(__dirname, '..', 'price-system-api.js'), 'utf8');
  const inserts = [...api.matchAll(/INSERT INTO price_system_fields\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/g)];
  const expectedColumns = [
    'id', 'scheme_id', 'field_key', 'field_name', 'field_type', 'unit',
    'applicable_categories', 'formula', 'formula_rules', 'display_format',
    'decimal_places', 'sync_wac', 'sync_quotation', 'source_scheme_id', 'source_field_key', 'sort_order'
  ];
  const fieldInsert = inserts.find(match =>
    match[1].split(',').map(value => value.trim()).join('|') === expectedColumns.join('|')
  );

  assert.ok(fieldInsert, 'new field INSERT statement should exist');
  const columns = fieldInsert[1].split(',').map(value => value.trim());
  const placeholders = fieldInsert[2].split(',').map(value => value.trim());
  assert.equal(placeholders.length, columns.length, 'SQL placeholder count must match target column count');
  assert.equal(placeholders.every(value => value === '?'), true);
});
