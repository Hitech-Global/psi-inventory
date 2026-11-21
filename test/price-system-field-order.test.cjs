'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { registerPriceSystemRoutes } = require('../price-system-api');

test('field order endpoint persists fee fields and built-in SRP order and versions the change', async () => {
  const routes = new Map();
  const runs = [];
  const feeFields = [
    { id: 'field-a', scheme_id: 'scheme-1', field_key: 'shipping', field_name: 'Shipping', field_type: 'amount', sort_order: 10, is_active: 1 },
    { id: 'field-b', scheme_id: 'scheme-1', field_key: 'platform_fee', field_name: 'Platform Fee', field_type: 'percent', sort_order: 20, is_active: 1 }
  ];
  const scheme = { id: 'scheme-1', country: 'Indonesia', brand: 'Netac', platform: 'Shopee', currency: 'IDR', status: 'active', srp_formula: 'landing_cost * 1.1', srp_sort_order: 999999 };
  const app = {
    get: (route, ...handlers) => routes.set('GET ' + route, handlers),
    post: (route, ...handlers) => routes.set('POST ' + route, handlers),
    put: (route, ...handlers) => routes.set('PUT ' + route, handlers),
    delete: (route, ...handlers) => routes.set('DELETE ' + route, handlers)
  };
  const query = (sql) => {
    if (sql.includes('SELECT id FROM price_system_fields WHERE scheme_id = ? AND is_active = 1')) return { rows: feeFields.map(field => ({ id: field.id })) };
    if (sql.includes('FROM price_system_fields WHERE scheme_id = ? AND is_active = 1 ORDER BY sort_order')) return { rows: feeFields.slice() };
    return { rows: [] };
  };
  const queryOne = (sql) => {
    if (sql.includes('SELECT * FROM price_system_schemes WHERE id = ?')) return scheme;
    if (sql.includes('MAX(version_no)')) return { max_version: 1 };
    return null;
  };
  const run = (sql, params = []) => {
    runs.push({ sql, params });
    if (sql.includes('UPDATE price_system_fields SET sort_order')) {
      const field = feeFields.find(item => item.id === params[1]);
      if (field) field.sort_order = params[0];
    }
    if (sql.includes('UPDATE price_system_schemes SET srp_sort_order')) scheme.srp_sort_order = params[0];
  };
  registerPriceSystemRoutes(app, {
    query, queryOne, run, transaction: fn => fn(), genId: prefix => prefix + '-' + (runs.length + 1),
    requireApiPermission: () => (req, res, next) => next(), asyncHandler: fn => fn,
    needsDataScopeFilter: () => false
  });

  async function invoke(method, route, body) {
    const handlers = routes.get(method + ' ' + route);
    assert.ok(handlers, 'route registered: ' + method + ' ' + route);
    const req = { params: { id: 'scheme-1' }, body: body || {}, currentUserPermissions: ['*'], currentUserId: 'tester', currentUserName: 'Tester' };
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
    for (const middleware of handlers.slice(0, -1)) await new Promise((resolve, reject) => { try { middleware(req, res, resolve); } catch (error) { reject(error); } });
    await handlers[handlers.length - 1](req, res, () => {});
    return res;
  }

  const saved = await invoke('PUT', '/api/price-system/schemes/:id/fields/order', { field_ids: ['field-b', 'builtin-srp', 'field-a'] });
  assert.equal(saved.statusCode, 200);
  assert.deepEqual(saved.body.field_ids, ['field-b', 'builtin-srp', 'field-a']);
  assert.equal(feeFields.find(field => field.id === 'field-b').sort_order, 10);
  assert.equal(scheme.srp_sort_order, 20);
  assert.equal(feeFields.find(field => field.id === 'field-a').sort_order, 30);
  const snapshotWrite = runs.find(item => item.sql.includes('INSERT INTO price_system_versions'));
  assert.ok(snapshotWrite, 'ordering change should create a version');
  assert.equal(JSON.parse(snapshotWrite.params[3]).scheme.srp_sort_order, 20);

  const writesBeforeInvalid = runs.filter(item => /UPDATE price_system_(fields|schemes) SET/.test(item.sql)).length;
  const invalid = await invoke('PUT', '/api/price-system/schemes/:id/fields/order', { field_ids: ['field-b', 'builtin-srp'] });
  assert.equal(invalid.statusCode, 400);
  assert.equal(runs.filter(item => /UPDATE price_system_(fields|schemes) SET/.test(item.sql)).length, writesBeforeInvalid);
});

test('scheme data returns SRP in its persisted position among fee columns', async () => {
  const routes = new Map();
  const fields = [
    { id: 'field-a', scheme_id: 'scheme-1', field_key: 'shipping', field_name: 'Shipping', field_type: 'amount', unit: 'IDR', applicable_categories: '[]', formula: '', sync_wac: 0, sort_order: 10, is_active: 1 },
    { id: 'field-b', scheme_id: 'scheme-1', field_key: 'platform_fee', field_name: 'Platform Fee', field_type: 'percent', unit: '%', applicable_categories: '[]', formula: '', sync_wac: 0, sort_order: 30, is_active: 1 }
  ];
  const scheme = { id: 'scheme-1', country: 'Indonesia', brand: 'Netac', currency: 'IDR', srp_formula: 'landing_cost * 1.1', srp_sort_order: 20 };
  const app = {
    get: (route, ...handlers) => routes.set('GET ' + route, handlers),
    post: (route, ...handlers) => routes.set('POST ' + route, handlers),
    put: (route, ...handlers) => routes.set('PUT ' + route, handlers),
    delete: (route, ...handlers) => routes.set('DELETE ' + route, handlers)
  };
  const query = (sql) => {
    if (sql.includes('FROM price_system_fields WHERE scheme_id = ? AND is_active = 1 ORDER BY sort_order')) return { rows: fields };
    if (sql.includes('FROM skus s LEFT JOIN')) return { rows: [] };
    return { rows: [] };
  };
  const queryOne = (sql) => sql.includes('SELECT * FROM price_system_schemes WHERE id = ?') ? scheme : null;
  registerPriceSystemRoutes(app, {
    query, queryOne, run: () => {}, transaction: fn => fn(), genId: prefix => prefix,
    requireApiPermission: () => (req, res, next) => next(), asyncHandler: fn => fn,
    needsDataScopeFilter: () => false
  });
  const handlers = routes.get('GET /api/price-system/schemes/:id/data');
  const req = { params: { id: 'scheme-1' }, currentUserPermissions: ['*'] };
  const res = { status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
  for (const middleware of handlers.slice(0, -1)) await new Promise((resolve, reject) => { try { middleware(req, res, resolve); } catch (error) { reject(error); } });
  await handlers[handlers.length - 1](req, res, () => {});
  assert.deepEqual(res.body.fields.map(field => field.id), ['field-a', 'builtin-srp', 'field-b']);
});

test('fee field manager exposes Mac-style cards and draggable order controls', () => {
  const ui = fs.readFileSync(path.join(__dirname, '..', 'assets', 'price-system.js'), 'utf8');
  assert.match(ui, /modal-price-fields/);
  assert.match(ui, /ps-field-row/);
  assert.match(ui, /ps-drag-handle/);
  assert.match(ui, /draggable=/);
  assert.match(ui, /psFieldDrop/);
  assert.match(ui, /fields\/order/);
  assert.match(ui, /ps-field-editor/);
});
