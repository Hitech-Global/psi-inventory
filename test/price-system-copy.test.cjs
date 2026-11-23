'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildCopiedFieldRows } = require('../price-system-api');

test('copies reusable field configuration with new field IDs and target scheme ID', () => {
  const sourceFields = [
    {
      id: 'old-field-1',
      scheme_id: 'source-scheme',
      field_key: 'platform_fee',
      field_name: 'Platform Fee',
      field_type: 'percent',
      unit: '%',
      applicable_categories: JSON.stringify(['游戏鼠标', '游戏键盘']),
      formula: '',
      formula_rules: '{}',
      display_format: 'percent',
      decimal_places: 3,
      sync_wac: 0,
      sort_order: 20,
      is_active: 1
    },
    {
      id: 'old-field-2',
      scheme_id: 'source-scheme',
      field_key: 'landing_cost',
      field_name: 'Landing Cost',
      field_type: 'amount',
      unit: 'IDR',
      applicable_categories: '[]',
      formula: '',
      formula_rules: '{}',
      display_format: 'amount',
      decimal_places: 2,
      sync_wac: 1,
      sort_order: 10,
      is_active: 1
    },
    {
      id: 'old-field-3',
      scheme_id: 'source-scheme',
      field_key: 'category_formula',
      field_name: 'Category Formula',
      field_type: 'formula',
      unit: '',
      applicable_categories: '[]',
      formula: '',
      formula_rules: JSON.stringify({ 游戏鼠标: 'srp*8%', 游戏键盘: 'srp*9%' }),
      display_format: 'number',
      decimal_places: 4,
      sync_wac: 0,
      sort_order: 30,
      is_active: 0
    }
  ];
  const generated = [];
  const rows = buildCopiedFieldRows(sourceFields, 'target-scheme', prefix => {
    const id = prefix + '-' + (generated.length + 1);
    generated.push(id);
    return id;
  });
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map(row => row.id), ['psf-1', 'psf-2', 'psf-3']);
  assert.ok(rows.every(row => row.scheme_id === 'target-scheme'));
  assert.ok(rows.every(row => !sourceFields.some(source => source.id === row.id)));
  assert.equal(rows[0].field_key, 'platform_fee');
  assert.deepEqual(JSON.parse(rows[0].applicable_categories), ['游戏鼠标', '游戏键盘']);
  assert.equal(rows[0].display_format, 'percent');
  assert.equal(rows[0].decimal_places, 3);
  assert.equal(rows[1].sync_wac, 1);
  assert.equal(rows[1].sort_order, 10);
  assert.deepEqual(JSON.parse(rows[2].formula_rules), { 游戏鼠标: 'srp*8%', 游戏键盘: 'srp*9%' });
  assert.equal(rows[2].is_active, 0);
});

test('does not carry SKU-specific price values or WAC links in copied field config', () => {
  const rows = buildCopiedFieldRows([{
    id: 'source-field',
    field_key: 'commission',
    field_name: 'Commission',
    field_type: 'percent',
    applicable_categories: '[]',
    formula_rules: '{}',
    value: 12,
    wac_history_id: 'old-wac-id'
  }], 'target', prefix => prefix + '-new');
  assert.equal(Object.prototype.hasOwnProperty.call(rows[0], 'value'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(rows[0], 'wac_history_id'), false);
});

test('handles empty or incomplete source field settings safely', () => {
  assert.deepEqual(buildCopiedFieldRows([], 'target', () => 'unused'), []);
  const rows = buildCopiedFieldRows([{ field_key: 'misc', field_name: 'Misc' }], 'target', () => 'new-field');
  assert.equal(rows[0].field_type, 'amount');
  assert.equal(rows[0].display_format, 'auto');
  assert.equal(rows[0].decimal_places, 2);
  assert.equal(rows[0].sync_wac, 0);
  assert.equal(rows[0].is_active, 1);
  assert.deepEqual(JSON.parse(rows[0].applicable_categories), []);
});
