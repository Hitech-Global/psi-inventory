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
    console,
    _masterCache: { suppliers: ['Old supplier'], countries: ['Old country'], brands: ['BOYA'], ts: Date.now(), TTL: 300000 }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'app-perf.js' });
  return { store: sandbox.AppStore, calls, masterCache: sandbox._masterCache };
}

test('SKU master mutation invalidates inventory brand options and shared brand reference', async () => {
  const { store, calls, masterCache } = createStore();
  store.page.set('inventory', '/api/inventory', [{ id: 'row-1' }], { ttl: 30000 });
  store.page.set('inv-filter-options', '/api/inventory/filter-options', { brands: ['BOYA'] }, { ttl: 300000 });

  const before = await store.ref('brands');
  assert.deepEqual(before.brands, ['GoPro']);
  assert.equal(calls.length, 1);

  store.onMutation('POST', '/api/skus/sku-gopro-001', { brand: 'GoPro' });

  assert.equal(masterCache.brands, null, 'SKU master changes must clear the separate PI master cache');
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

function sandboxMasterCache(store) {
  // AppStore is created in the same VM global as window._masterCache.
  return store._testMasterCache;
}

test('PO, PI and CI record create/edit invalidate brand references, but approval actions do not', async () => {
  const cases = [
    ['POST', '/api/purchase-orders'],
    ['PUT', '/api/purchase-orders/po-1'],
    ['POST', '/api/proforma-invoices'],
    ['PUT', '/api/proforma-invoices/pi-1'],
    ['POST', '/api/commercial-invoices'],
    ['PUT', '/api/commercial-invoices/ci-1']
  ];

  for (const [method, url] of cases) {
    const { store, calls, masterCache } = createStoreWithMasterCache();
    await store.ref('brands');
    assert.equal(masterCache.brands, ['BOYA']);
    store.onMutation(method, url, {});
    await store.ref('brands');
    assert.equal(calls.filter(x => x === '/api/brands/all').length, 2, url + ' should refresh the brand reference');
    assert.equal(masterCache.brands, null, url + ' should clear PI modal brand cache');
  }

  for (const [method, url] of [
    ['POST', '/api/purchase-orders/po-1/submit-approval'],
    ['POST', '/api/proforma-invoices/pi-1/approve'],
    ['POST', '/api/commercial-invoices/ci-1/ops-prep']
  ]) {
    const { store, masterCache } = createStoreWithMasterCache();
    store.onMutation(method, url, {});
    assert.deepEqual(masterCache.brands, ['BOYA'], url + ' must not clear the brand cache');
  }
});

test('supplier and country master mutations clear their matching PI session cache only', () => {
  const { store, masterCache } = createStoreWithMasterCache();
  store.onMutation('PUT', '/api/suppliers/supplier-1', {});
  assert.equal(masterCache.suppliers, null);
  assert.deepEqual(masterCache.countries, ['Old country']);
  assert.deepEqual(masterCache.brands, ['BOYA']);

  const second = createStoreWithMasterCache();
  second.store.onMutation('PUT', '/api/countries/country-1', {});
  assert.equal(second.masterCache.countries, null);
  assert.deepEqual(second.masterCache.suppliers, ['Old supplier']);
  assert.deepEqual(second.masterCache.brands, ['BOYA']);
});

function createStoreWithMasterCache() {
  const calls = [];
  const masterCache = { suppliers: ['Old supplier'], countries: ['Old country'], brands: ['BOYA'], ts: Date.now(), TTL: 300000 };
  const sandbox = {
    location: { search: '' },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    getLang: () => 'zh',
    fetch: async (url) => {
      calls.push(url);
      return { status: 200, ok: true, json: async () => ['GoPro'] };
    },
    setTimeout,
    clearTimeout,
    console,
    _masterCache: masterCache
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'app-perf.js' });
  return { store: sandbox.AppStore, calls, masterCache };
}
