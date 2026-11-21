'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ensurePriceSystemSchema } = require('../migrations/price-system');

test('creates all price system tables and indexes idempotently through IF NOT EXISTS', () => {
  const statements = [];
  ensurePriceSystemSchema(sql => statements.push(sql), true);
  const joined = statements.join('\n');
  for (const table of ['price_system_schemes','price_system_fields','price_system_values','price_system_versions','price_system_landing_costs','price_system_srp_values']) {
    assert.match(joined, new RegExp('CREATE TABLE IF NOT EXISTS ' + table));
  }
  assert.match(joined, /UNIQUE \(country, brand, platform, shop_name\)/);
  assert.match(joined, /sync_wac INTEGER NOT NULL DEFAULT 0/);
  assert.match(joined, /formula_rules TEXT NOT NULL DEFAULT '\{\}'/);
  assert.match(joined, /ALTER TABLE price_system_fields ADD COLUMN formula_rules/);
  assert.match(joined, /srp_sort_order INTEGER NOT NULL DEFAULT 999999/);
  assert.match(joined, /ALTER TABLE price_system_schemes ADD COLUMN srp_sort_order/);
  assert.match(joined, /ALTER TABLE price_system_fields ADD COLUMN sync_wac/);
  assert.match(joined, /UNIQUE \(scheme_id, sku_code, field_key\)/);
  assert.match(joined, /CREATE INDEX IF NOT EXISTS idx_price_system_values_scheme_sku/);
  assert.match(joined, /CREATE INDEX IF NOT EXISTS idx_price_system_landing_costs_scheme_sku/);
  assert.match(joined, /CREATE INDEX IF NOT EXISTS idx_price_system_srp_values_scheme_sku/);
});

test('uses SQLite-compatible timestamp defaults on local database', () => {
  const statements = [];
  ensurePriceSystemSchema(sql => statements.push(sql), false);
  assert.ok(statements.some(sql => sql.includes("DEFAULT (datetime('now'))")));
  assert.ok(statements.every(sql => !sql.includes('DEFAULT NOW()')));
});
