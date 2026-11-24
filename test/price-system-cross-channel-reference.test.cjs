'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildPriceSystemReferenceLookup } = require('../price-system-api');

const root = path.join(__dirname, '..');
const ui = fs.readFileSync(path.join(root, 'assets', 'price-system.js'), 'utf8');
const api = fs.readFileSync(path.join(root, 'price-system-api.js'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'migrations', 'price-system.js'), 'utf8');

test('reference values are matched by exact SKU and missing source values stay blank', () => {
  const lookup = buildPriceSystemReferenceLookup([
    { sku_code: 'NT01', values: { fob: 100 }, value_currencies: { fob: 'USD' } },
    { sku_code: 'NT02', values: { fob: null }, value_currencies: {} },
    { sku_code: 'NT03', values: { fob: 0 }, value_currencies: {} }
  ], 'fob', 'IDR', true);

  assert.equal(lookup.valuesBySku.get('NT01'), 100);
  assert.equal(lookup.valuesBySku.get('NT02'), null);
  assert.equal(lookup.valuesBySku.get('NT03'), 0);
  assert.equal(lookup.valuesBySku.has('NT04'), false);
  assert.equal(lookup.currenciesBySku.get('NT01'), 'USD');
  assert.equal(lookup.currenciesBySku.get('NT02'), 'IDR');
});

test('reference currency metadata is only produced when the source field is quotation-synced', () => {
  const lookup = buildPriceSystemReferenceLookup([
    { sku_code: 'NT01', values: { fob: 100 }, value_currencies: { fob: 'USD' } }
  ], 'fob', 'IDR', false);
  assert.equal(lookup.valuesBySku.get('NT01'), 100);
  assert.equal(lookup.currenciesBySku.size, 0);
});

test('sales channels can be switched without removing the top price-scheme selector', () => {
  assert.match(ui, /onchange="psSelectScheme\(this\.value\)"/);
  assert.match(ui, /ps-channel-switcher/);
  assert.match(ui, /ps-channel-button/);
  assert.match(ui, /sales_channel\|\|s\.platform/);
  assert.match(ui, /id="ps-channel"/);
  assert.match(ui, /psOpenChannelSchemeModal/);
});

test('reference field configuration stays inside the existing fee-field editor', () => {
  assert.match(ui, /id="ps-reference-scheme"/);
  assert.match(ui, /id="ps-reference-field"/);
  assert.match(ui, /psReferenceSourceChanged/);
  assert.match(ui, /psReferenceFieldChanged/);
  assert.match(ui, /field_type==='reference'/);
  assert.match(ui, /field_type==='formula'\|\|f\.field_type==='reference'/);
});

test('reference source is restricted to the same country and brand and cycles are rejected', () => {
  assert.match(api, /只能引用同一国家、同一品牌下其他销售渠道方案的字段/);
  assert.match(api, /referenceChainReachesScheme\(sourceScheme\.id, scheme\.id\)/);
  assert.match(api, /价格方案之间存在循环引用/);
  assert.match(api, /source_scheme_id = \?/);
  assert.match(migration, /source_scheme_id TEXT NOT NULL DEFAULT ''/);
  assert.match(migration, /source_field_key TEXT NOT NULL DEFAULT ''/);
});
