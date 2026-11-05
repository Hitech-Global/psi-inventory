'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'app-perf.js'), 'utf8');

function createStore() {
  const calls = [];
  const sandbox = {
    location: { search: '' },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    getLang: () => 'zh',
    fetch: async (url) => {
      calls.push(url);
      return { status: 200, ok: true, json: async () => ({ url, brands: ['GoPro'] }) };
    },
    setTimeout,
    clearTimeout,
    console
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'app-perf.js' });
  return { store: sandbox.AppStore, calls };
}

test('SKU master mutation invalidates inventory brand options and shared brand reference', async () => {
  const { store, calls } = createStore();
  store.page.set('inventory', '/api/inventory', [{ id: 'row-1' }], { ttl: 30000 });
  store.page.set('inv-filter-options', '/api/inventory/filter-options', { brands: ['BOYA'] }, { ttl: 300000 });

  const before = await store.ref('brands');
  assert.deepEqual(before.brands, ['GoPro']);
  assert.equal(calls.length, 1);

  store.onMutation('POST', '/api/skus/sku-gopro-001', { brand: 'GoPro' });

  assert.equal(store.page.get('inventory').dirty, true);
  assert.equal(store.page.get('inv-filter-options').dirty, true);

  const after = await store.ref('brands');
  assert.deepEqual(after.brands, ['GoPro']);
  assert.equal(calls.length, 2, 'SKU changes must force a fresh /api/brands/all request');
});

test('inventory, inventory import, warehouse and consignment mutations invalidate inventory filter options', () => {
  const { store } = createStore();
  const mutations = [
    ['POST', '/api/inventory-imports/bulk-import'],
    ['PUT', '/api/inventory/row-1'],
    ['PUT', '/api/warehouses/wh-bekasi'],
    ['POST', '/api/consignment/lots']
  ];

  mutations.forEach(([method, url], index) => {
    const key = 'filter-signature-' + index;
    store.page.set('inv-filter-options', key, { brands: ['BOYA'] }, { ttl: 300000 });
    store.onMutation(method, url, {});
    assert.equal(store.page.get('inv-filter-options').dirty, true, url + ' should invalidate brand filter options');
  });
});

test('unrelated finance mutations do not invalidate inventory filter options', () => {
  const { store } = createStore();
  store.page.set('inv-filter-options', 'filters', { brands: ['BOYA'] }, { ttl: 300000 });
  store.onMutation('POST', '/api/payment-requests', {});
  assert.equal(store.page.get('inv-filter-options').dirty, false);
});
