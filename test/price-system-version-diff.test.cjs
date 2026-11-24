'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildPriceSystemVersionDiff
} = require('../price-system-api');

function field(overrides = {}) {
  return Object.assign({
    field_key: 'final_profit_rate',
    field_name: 'Final Profit Rate',
    field_type: 'formula',
    unit: '%',
    applicable_categories: '["Mouse"]',
    formula: 'profit / srp',
    formula_rules: '{}',
    display_format: 'percent',
    decimal_places: 2,
    sync_wac: 0,
    sync_quotation: 0,
    sort_order: 10,
    is_active: 1
  }, overrides);
}

function snapshot(overrides = {}) {
  return Object.assign({
    scheme: { currency: 'IDR', srp_formula: 'landing_cost * 1.1', srp_sort_order: 99, status: 'active' },
    fields: [field()],
    values: [{ sku_code: 'SKU-1', field_key: 'shipping', value: 100, currency: 'IDR' }],
    landingCosts: [{ sku_code: 'SKU-1', value: 500, currency: 'IDR', ci_no: 'CI-001', warehouse: 'Bekasi', version_no: 3, last_inbound_date: '2026-11-20' }],
    srpValues: [{ sku_code: 'SKU-1', value: 1000 }]
  }, overrides);
}

test('version diff identifies field formula changes with exact before and after values', () => {
  const before = snapshot();
  const after = snapshot({ fields: [field({ formula: 'profit / srp * 100', decimal_places: 3 })] });
  const diff = buildPriceSystemVersionDiff(after, before, { hasPrevious: true, canViewQuotation: true });
  assert.equal(diff.field_changes.length, 2);
  assert.deepEqual(diff.field_changes.map(item => [item.property_key, item.old_value, item.new_value]), [
    ['formula', 'profit / srp', 'profit / srp * 100'],
    ['decimal_places', 2, 3]
  ]);
});

test('version diff records changes to cross-channel reference sources', () => {
  const before = snapshot({ fields: [field({ field_type: 'reference', source_scheme_id: 'scheme-shopee', source_field_key: 'fob' })] });
  const after = snapshot({ fields: [field({ field_type: 'reference', source_scheme_id: 'scheme-offline', source_field_key: 'landing_cost' })] });
  const diff = buildPriceSystemVersionDiff(after, before, { hasPrevious: true, canViewQuotation: true });
  assert.deepEqual(diff.field_changes.map(item => [item.property_key, item.old_value, item.new_value]), [
    ['source_scheme_id', 'scheme-shopee', 'scheme-offline'],
    ['source_field_key', 'fob', 'landing_cost']
  ]);
});

test('version diff identifies SKU manual fee, SRP, and WAC changes', () => {
  const before = snapshot();
  const after = snapshot({
    values: [{ sku_code: 'SKU-1', field_key: 'shipping', value: 125, currency: 'IDR' }],
    landingCosts: [{ sku_code: 'SKU-1', value: 550, currency: 'IDR', ci_no: 'CI-002', warehouse: 'Bekasi', version_no: 4, last_inbound_date: '2026-11-22' }],
    srpValues: [{ sku_code: 'SKU-1', value: 1200 }]
  });
  const diff = buildPriceSystemVersionDiff(after, before, { hasPrevious: true, canViewQuotation: true });
  assert.equal(diff.sku_changes.length, 3);
  const byType = Object.fromEntries(diff.sku_changes.map(item => [item.change_type, item]));
  assert.deepEqual(byType.manual_value.old_value, { value: 100, currency: 'IDR' });
  assert.deepEqual(byType.manual_value.new_value, { value: 125, currency: 'IDR' });
  assert.equal(byType.srp_value.old_value.value, 1000);
  assert.equal(byType.srp_value.new_value.value, 1200);
  assert.equal(byType.landing_cost.old_value.ci_no, 'CI-001');
  assert.equal(byType.landing_cost.new_value.ci_no, 'CI-002');
});

test('version diff includes added and removed fields and records field ordering changes', () => {
  const before = snapshot();
  const after = snapshot({
    fields: [
      field({ sort_order: 1 }),
      field({ field_key: 'new_fee', field_name: 'New Fee', field_type: 'amount', formula: '', sort_order: 2 })
    ]
  });
  const diff = buildPriceSystemVersionDiff(after, before, { hasPrevious: true, canViewQuotation: true });
  assert.ok(diff.field_changes.some(item => item.field_key === 'final_profit_rate' && item.property_key === 'sort_order' && item.old_value === 10 && item.new_value === 1));
  assert.ok(diff.field_changes.some(item => item.field_key === 'new_fee' && item.action === 'added'));
});

test('version diff does not expose quotation-synced fields or values without quotation permission', () => {
  const before = snapshot({
    fields: [field({ field_key: 'latest_quote', field_name: 'Latest Quote', sync_quotation: 1 })],
    values: [{ sku_code: 'SKU-1', field_key: 'latest_quote', value: 200, currency: 'USD' }]
  });
  const after = snapshot({
    fields: [field({ field_key: 'latest_quote', field_name: 'Latest Quote', sync_quotation: 1, formula: 'srp * 0.1' })],
    values: [{ sku_code: 'SKU-1', field_key: 'latest_quote', value: 250, currency: 'USD' }]
  });
  const hidden = buildPriceSystemVersionDiff(after, before, { hasPrevious: true, canViewQuotation: false });
  assert.equal(hidden.field_changes.length, 0);
  assert.equal(hidden.sku_changes.length, 0);
  const visible = buildPriceSystemVersionDiff(after, before, { hasPrevious: true, canViewQuotation: true });
  assert.equal(visible.field_changes.length, 1);
  assert.equal(visible.sku_changes.length, 1);
});

test('first version treats its saved configuration and values as additions', () => {
  const diff = buildPriceSystemVersionDiff(snapshot(), {}, { hasPrevious: false, canViewQuotation: true });
  assert.equal(diff.has_previous, false);
  assert.ok(diff.field_changes.some(item => item.field_key === 'final_profit_rate' && item.action === 'added'));
  assert.equal(diff.sku_changes.length, 3);
});

test('history UI exposes a view-changes action and paginates the detailed diff', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const ui = fs.readFileSync(path.join(__dirname, '..', 'assets', 'price-system.js'), 'utf8');
  assert.match(ui, /psViewVersionDiff/);
  assert.match(ui, /\/diff\?page=/);
  assert.match(ui, /previousPage/);
  assert.match(ui, /nextPage/);
  assert.match(ui, /ps-version-diff-table/);
});
