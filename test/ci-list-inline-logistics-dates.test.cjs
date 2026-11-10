'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const feature = fs.readFileSync(path.join(root, 'ci-list-inline-logistics.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

function makeInput(field, savedValue, nextValue) {
  const attrs = {
    'data-ci-logi-date-field': field,
    'data-ci-logi-date-batch': 'batch-1',
    'data-ci-logi-date-ci': 'ci-1',
    'data-saved-value': savedValue
  };
  const classes = new Set();
  return {
    value: nextValue,
    disabled: false,
    getAttribute(name) { return attrs[name] == null ? null : attrs[name]; },
    setAttribute(name, value) { attrs[name] = String(value); },
    classList: {
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); },
      contains(name) { return classes.has(name); }
    }
  };
}

function setup({ canEdit = true, failPut = false, failRefresh = false } = {}) {
  const calls = [];
  const toasts = [];
  let batch = {
    id: 'batch-1',
    batch_no: 'LOG-TEST-001',
    forwarder_name: 'Test Forwarder',
    transport_mode: 'sea',
    eta_date: '2026-11-12',
    actual_arrival_date: '2026-11-15',
    actual_transit_days: 5,
    total_cartons: 1,
    total_cbm: 1,
    pls: [],
    logistics_status: 'pending',
    listing_status: 'pending_plan'
  };
  const row = { hidden: true };
  const body = { innerHTML: '' };
  const caret = { textContent: '▶' };
  const count = { textContent: '' };
  const nodes = {
    'ci-list-logi-row-ci-1': row,
    'ci-list-logi-body-ci-1': body,
    'ci-list-logi-caret-ci-1': caret,
    'ci-list-logi-count-ci-1': count
  };
  const listeners = {};
  const document = {
    getElementById(id) { return nodes[id] || null; },
    createElement() { return { id: '', textContent: '' }; },
    head: { appendChild() {} },
    addEventListener(name, callback) { listeners[name] = callback; }
  };
  const window = {
    getLang: () => 'en',
    t: (_key, fallback) => fallback,
    hasPermission: permission => canEdit && permission === 'logistics_edit',
    fmtDate: value => value || '',
    fmtMoney: (value, currency) => String(currency || '') + ' ' + Number(value || 0).toFixed(2),
    logisticsStatusLabelByKey: value => value || '—',
    showToast: (message, type) => toasts.push({ message, type }),
    api: async (url, method, payload) => {
      calls.push({ url, method, payload });
      if (method === 'PUT') {
        if (failPut) throw new Error('date update rejected');
        Object.assign(batch, payload);
        return { success: true };
      }
      if (url === '/api/commercial-invoices/ci-1/logistics-batches') {
        if (failRefresh) throw new Error('refresh failed');
        return [Object.assign({}, batch)];
      }
      throw new Error('unexpected request: ' + url);
    }
  };

  vm.runInNewContext(feature, {
    window, document, Date, Number, String, Array, Promise, Map,
    Object, encodeURIComponent, console
  });

  return { window, calls, toasts, row, body, caret, count, listeners };
}

test('CI list renders both logistics dates as permission-gated native date inputs', async () => {
  const x = setup();
  await x.window.toggleCIListLogistics('ci-1', true);
  assert.match(x.body.innerHTML, /data-ci-logi-date-field="eta_date"/);
  assert.match(x.body.innerHTML, /data-ci-logi-date-field="actual_arrival_date"/);
  assert.match(x.body.innerHTML, /type="date"/);
  assert.match(x.body.innerHTML, /onchange="updateCILogisticsDateInline\(this\)"/);
});

test('ETA date saves through the existing logistics batch API and refreshes the expanded panel', async () => {
  const x = setup();
  await x.window.toggleCIListLogistics('ci-1', true);
  const input = makeInput('eta_date', '2026-11-12', '2026-11-18');
  await x.window.updateCILogisticsDateInline(input);

  const put = x.calls.find(call => call.method === 'PUT');
  assert.equal(put.url, '/api/logistics-batches/batch-1');
  assert.equal(JSON.stringify(put.payload), JSON.stringify({ eta_date: '2026-11-18' }));
  assert.equal(input.getAttribute('data-saved-value'), '2026-11-18');
  assert.equal(input.disabled, false);
  assert.match(x.body.innerHTML, /value="2026-11-18"/);
  assert.ok(x.toasts.some(item => item.type === 'success' && item.message === 'Estimated arrival date updated'));
});

test('actual arrival date saves independently and refreshes derived transit days', async () => {
  const x = setup();
  await x.window.toggleCIListLogistics('ci-1', true);
  const input = makeInput('actual_arrival_date', '2026-11-15', '2026-11-20');
  await x.window.updateCILogisticsDateInline(input);

  const put = x.calls.find(call => call.method === 'PUT');
  assert.equal(JSON.stringify(put.payload), JSON.stringify({ actual_arrival_date: '2026-11-20' }));
  assert.equal(input.getAttribute('data-saved-value'), '2026-11-20');
  assert.match(x.body.innerHTML, /value="2026-11-20"/);
});

test('clearing a logistics date persists an empty value', async () => {
  const x = setup();
  const input = makeInput('eta_date', '2026-11-12', '');
  await x.window.updateCILogisticsDateInline(input);
  const put = x.calls.find(call => call.method === 'PUT');
  assert.equal(JSON.stringify(put.payload), JSON.stringify({ eta_date: '' }));
  assert.equal(input.getAttribute('data-saved-value'), '');
});

test('failed inline date save restores the previous value and reports an error', async () => {
  const x = setup({ failPut: true });
  const input = makeInput('eta_date', '2026-11-12', '2026-11-18');
  await x.window.updateCILogisticsDateInline(input);
  assert.equal(input.value, '2026-11-12');
  assert.equal(input.getAttribute('data-saved-value'), '2026-11-12');
  assert.equal(input.disabled, false);
  assert.ok(x.toasts.some(item => item.type === 'danger' && item.message === 'date update rejected'));
  assert.equal(x.calls.filter(call => call.method !== 'PUT').length, 0);
});

test('users without logistics_edit permission cannot update logistics dates', async () => {
  const x = setup({ canEdit: false });
  const input = makeInput('eta_date', '2026-11-12', '2026-11-18');
  await x.window.updateCILogisticsDateInline(input);
  assert.equal(input.value, '2026-11-12');
  assert.equal(x.calls.length, 0);
});

test('existing logistics batch PUT endpoint allows both date fields and enforces logistics_edit', () => {
  const start = server.indexOf("app.put('/api/logistics-batches/:id'");
  assert.ok(start >= 0, 'logistics batch update endpoint must exist');
  const route = server.slice(start, start + 10000);
  assert.match(route, /requireApiPermission\('logistics_edit'\)/);
  const allowed = route.match(/const allowed = \[([^\]]+)\]/);
  assert.ok(allowed, 'logistics update allowlist must exist');
  assert.match(allowed[1], /'eta_date'/);
  assert.match(allowed[1], /'actual_arrival_date'/);
});
