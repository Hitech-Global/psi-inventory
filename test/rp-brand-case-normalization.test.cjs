'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

function section(startMarker, endMarker) {
  const start = app.indexOf(startMarker);
  const end = app.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, 'source section not found: ' + startMarker);
  return app.slice(start, end);
}

const helpers = section('function rpBrandKey(value){', 'async function rpGetWarehouseMaster()');
const countryChange = section('async function onRpCountryChange(skipDataReload){', '\n// RC-FILTER-PRESERVE');
const localRows = section('function rpLocalSnapshotRows(){', '\n// PUT 成功 / CAS stale');

function makeHarness() {
  const elements = {
    'rp-c': { value: '印度尼西亚' },
    'rp-w': { value: '' },
    'rp-b': { value: 'Boya', innerHTML: '' },
    'rp-status': { value: '' },
    'rp-lifecycle': { value: '' },
    'rp-s': { value: '' }
  };
  const master = {
    warehouseMaster: [{
      name: 'Bekasi Warehouse',
      country_name: '印度尼西亚',
      brands: 'BOYA,Netac,Redragon'
    }],
    salesOnlyRows: [{
      sku_code: '11002195',
      country: '印度尼西亚',
      brand: 'Boya',
      product_name: 'Legacy sales-only row',
      model: '',
      category: ''
    }]
  };
  const context = {
    window: {
      __rpFilterState: { brand: 'Boya' },
      _rpSnapshot: { rows: [], salesOnlyRows: master.salesOnlyRows }
    },
    document: { getElementById: id => elements[id] || null },
    rpGetWarehouseMaster: async () => master,
    rpVal: id => (elements[id] && elements[id].value) || '',
    rpTab: 'total',
    RP_PERF: false,
    esc: value => String(value),
    t: (_key, fallback, values) => values && values.v1 !== undefined
      ? fallback.replace('{v1}', values.v1)
      : fallback,
    console: { warn: () => {} },
    saveRpPreferences: () => {},
    loadRpSummary: () => {},
    rpShowCachedViewOrLoad: () => {}
  };
  vm.createContext(context);
  vm.runInContext(helpers + '\n' + countryChange + '\n' + localRows, context);
  return { context, elements, master };
}

test('brand options collapse case-only variants and preserve canonical warehouse spelling', async () => {
  const h = makeHarness();
  await h.context.onRpCountryChange(true);

  const html = h.elements['rp-b'].innerHTML;
  assert.equal((html.match(/value="BOYA"/g) || []).length, 1);
  assert.doesNotMatch(html, /value="Boya"/);
  assert.equal(h.elements['rp-b'].value, 'BOYA', 'saved Boya preference restores to canonical BOYA');
});

test('selecting BOYA matches and displays legacy Boya sales-only rows', async () => {
  const h = makeHarness();
  await h.context.onRpCountryChange(true);
  const rows = h.context.rpLocalSnapshotRows();

  assert.equal(rows.length, 1);
  assert.equal(rows[0].sku_code, '11002195');
  assert.equal(rows[0].brand, 'BOYA');
  assert.equal(h.context.rpBrandMatches('Boya', 'BOYA'), true);
});

test('warehouse-brand cascade compares complete brand names without case sensitivity', () => {
  const h = makeHarness();
  const rows = h.context.rpFilterWarehousesByCountryBrand([
    { name: 'W1', country_name: '印度尼西亚', brands: 'Boya,Netac' },
    { name: 'W2', country_name: '印度尼西亚', brands: 'Redragon' },
    { name: 'W3', country_name: '泰国', brands: 'BOYA' }
  ], '印度尼西亚', 'BOYA');

  assert.deepEqual(JSON.parse(JSON.stringify(rows.map(row => row.name))), ['W1']);
});
