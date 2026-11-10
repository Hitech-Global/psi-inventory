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

function makeStatusSelect(field, savedValue, nextValue) {
  const attrs = {
    'data-ci-logi-status-field': field,
    'data-ci-logi-status-batch': 'batch-1',
    'data-ci-logi-status-ci': 'ci-1',
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

function setup({ canEdit = true, failPut = false, failRefresh = false, failStatusPut = false, failListingPost = false } = {}) {
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
    logistics_display_status: 'pending_shipment',
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
        if (payload.logistics_status !== undefined && failStatusPut) throw new Error('logistics status rejected');
        Object.assign(batch, payload);
        if (payload.logistics_status !== undefined) {
          const display = {
            pending: 'pending_shipment',
            in_transit: 'in_transit',
            customs: 'customs_clearing',
            delivering: 'awaiting_delivery',
            completed: 'warehouse_arrived'
          };
          batch.logistics_display_status = display[payload.logistics_status] || 'pending_shipment';
        }
        if (payload.actual_arrival_date !== undefined) batch.actual_transit_days = 10;
        return { success: true };
      }
      if (method === 'POST' && url === '/api/logistics-batches/batch-1/listing') {
        if (failListingPost) throw new Error('listing status rejected');
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
  assert.ok(x.body.innerHTML.includes('<td>10</td>'), 'transit days must be refreshed from the updated arrival date');
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



test('CI list renders both logistics statuses as permission-gated inline selects', async () => {
  const x = setup();
  await x.window.toggleCIListLogistics('ci-1', true);
  assert.match(x.body.innerHTML, /data-ci-logi-status-field="logistics_status"/);
  assert.match(x.body.innerHTML, /data-ci-logi-status-field="listing_status"/);
  assert.match(x.body.innerHTML, /onchange="updateCILogisticsStatusInline\(this\)"/);
  assert.match(x.body.innerHTML, /value="pending_shipment" selected/);
  assert.match(x.body.innerHTML, /value="pending_plan" selected/);
});

test('logistics status saves canonical raw status through the existing PUT endpoint', async () => {
  const x = setup();
  await x.window.toggleCIListLogistics('ci-1', true);
  const select = makeStatusSelect('logistics_status', 'pending_shipment', 'in_transit');
  await x.window.updateCILogisticsStatusInline(select);

  const put = x.calls.find(call => call.method === 'PUT');
  assert.equal(put.url, '/api/logistics-batches/batch-1');
  assert.equal(JSON.stringify(put.payload), JSON.stringify({ logistics_status: 'in_transit' }));
  assert.equal(select.getAttribute('data-saved-value'), 'in_transit');
  assert.equal(select.disabled, false);
  assert.match(x.body.innerHTML, /value="in_transit" selected/);
  assert.ok(x.toasts.some(item => item.type === 'success' && item.message === 'Logistics status updated'));
});

test('listing status saves through the dedicated audited listing endpoint', async () => {
  const x = setup();
  await x.window.toggleCIListLogistics('ci-1', true);
  const select = makeStatusSelect('listing_status', 'pending_plan', 'ready');
  await x.window.updateCILogisticsStatusInline(select);

  const post = x.calls.find(call => call.method === 'POST');
  assert.equal(post.url, '/api/logistics-batches/batch-1/listing');
  assert.equal(JSON.stringify(post.payload), JSON.stringify({ listing_status: 'ready' }));
  assert.equal(select.getAttribute('data-saved-value'), 'ready');
  assert.equal(select.disabled, false);
  assert.match(x.body.innerHTML, /value="ready" selected/);
  assert.ok(x.toasts.some(item => item.type === 'success' && item.message === 'Listing status updated'));
});

test('failed logistics status save restores the previous selection', async () => {
  const x = setup({ failStatusPut: true });
  const select = makeStatusSelect('logistics_status', 'pending_shipment', 'warehouse_arrived');
  await x.window.updateCILogisticsStatusInline(select);
  assert.equal(select.value, 'pending_shipment');
  assert.equal(select.getAttribute('data-saved-value'), 'pending_shipment');
  assert.equal(select.disabled, false);
  assert.ok(x.toasts.some(item => item.type === 'danger' && item.message === 'logistics status rejected'));
  assert.equal(x.calls.filter(call => call.method === 'GET').length, 0);
});

test('failed listing status save restores the previous selection', async () => {
  const x = setup({ failListingPost: true });
  const select = makeStatusSelect('listing_status', 'pending_plan', 'listed');
  await x.window.updateCILogisticsStatusInline(select);
  assert.equal(select.value, 'pending_plan');
  assert.equal(select.getAttribute('data-saved-value'), 'pending_plan');
  assert.equal(select.disabled, false);
  assert.ok(x.toasts.some(item => item.type === 'danger' && item.message === 'listing status rejected'));
});

test('users without logistics_edit permission cannot update either logistics status', async () => {
  const x = setup({ canEdit: false });
  const logistics = makeStatusSelect('logistics_status', 'pending_shipment', 'in_transit');
  const listing = makeStatusSelect('listing_status', 'pending_plan', 'ready');
  await x.window.updateCILogisticsStatusInline(logistics);
  await x.window.updateCILogisticsStatusInline(listing);
  assert.equal(logistics.value, 'pending_shipment');
  assert.equal(listing.value, 'pending_plan');
  assert.equal(x.calls.length, 0);
});

test('logistics status change keeps transit recalculation and notification behavior in the existing API', () => {
  const start = server.indexOf("app.put('/api/logistics-batches/:id'");
  assert.ok(start >= 0);
  const route = server.slice(start, start + 10000);
  assert.match(route, /'logistics_status'/);
  assert.match(route, /updateInventoryTransitDataAsync\(\)/);
  assert.match(route, /notifyListingStatusChanged\(id, existing\.logistics_status, d\.logistics_status, 'logistics'\)/);
});

test('listing status change uses the dedicated endpoint with validation, audit log and notification', () => {
  const start = server.indexOf("app.post('/api/logistics-batches/:id/listing'");
  assert.ok(start >= 0);
  const route = server.slice(start, start + 8000);
  assert.match(route, /requireApiPermission\('logistics_edit'\)/);
  assert.match(route, /LISTING_STATUSES\.includes\(newStatus\)/);
  assert.match(route, /operation_type: 'listing_status_change'/);
  assert.match(route, /notifyListingStatusChanged\(lb\.id, oldStatus, newStatus, 'listing'\)/);
});
