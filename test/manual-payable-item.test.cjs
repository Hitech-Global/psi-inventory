'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

function manualRouteHarness(overrides) {
  const options = overrides || {};
  const routeStart = server.indexOf("app.post('/api/payable-items/manual'");
  const routeEnd = server.indexOf('// 应付费用详情', routeStart);
  assert.ok(routeStart >= 0 && routeEnd > routeStart, 'manual payable route must exist');
  let handler = null;
  let status = 200;
  let body = null;
  let created = null;
  const permissions = [];
  const ctx = {
    app: { post(url, ...fns) { assert.equal(url, '/api/payable-items/manual'); handler = fns[fns.length - 1]; } },
    requireApiPermission(permission) { permissions.push(permission); return function () {}; },
    asyncHandler(fn) { return fn; },
    queryOne(sql, args) {
      if (options.queryOne) return options.queryOne(sql, args);
      if (sql.includes('FROM payer_entities')) return { entity_key: 'id_hitech', entity_name: 'Hitech Indonesia', status: 'active', country_name: '印度尼西亚' };
      if (sql.includes('FROM currencies')) return { code: 'IDR', status: 'active' };
      if (sql.includes('FROM payment_subcategory_sources')) return { category_code: 'warehouse_arrival', subcategory_code: 'other_local', payee_type_default: 'service_provider', fee_type: 'other_local' };
      throw new Error('Unexpected queryOne: ' + sql);
    },
    genId(prefix) { return prefix + '-source-1'; },
    createPayableItemFromSource(params) {
      created = params;
      return { id: 'payitem-1', fee_no: 'PAY-ITEM-2026-000001', lifecycle_status: 'active', payable_amount_minor: 12550 };
    }
  };
  vm.runInNewContext(server.slice(routeStart, routeEnd), ctx);
  return {
    permissions,
    getCreated: () => created,
    run(bodyInput) {
      status = 200;
      body = null;
      const req = { body: bodyInput, currentUserId: 'user-1' };
      const res = {
        status(value) { status = value; return this; },
        json(value) { body = value; return this; }
      };
      handler(req, res);
      return { status, body };
    }
  };
}

const validBody = {
  payee_name: 'Forwarder ABC',
  payer_entity_key: 'id_hitech',
  subcategory_id: 'sub-warehouse-other',
  fee_type: 'other_local',
  currency: 'IDR',
  amount: 125.5,
  payable_date: '2026-11-10'
};

test('manual payable creation is permission-guarded and uses the existing payable ledger helper', () => {
  const h = manualRouteHarness();
  const result = h.run(validBody);
  assert.deepEqual(h.permissions, ['payment_create']);
  assert.equal(result.status, 201);
  assert.equal(result.body.success, true);
  assert.equal(result.body.item.source_type, 'manual');
  assert.equal(result.body.item.payable_date, '2026-11-10');
  assert.equal(result.body.item.payable_amount_minor, 12550);
  assert.equal(h.getCreated().sourceType, 'manual');
  assert.equal(h.getCreated().payerEntityKey, 'id_hitech');
  assert.equal(h.getCreated().payerName, 'Hitech Indonesia');
  assert.equal(h.getCreated().payeeName, 'Forwarder ABC');
  assert.equal(h.getCreated().payableAmount, 125.5);
});

test('manual payable creation rejects invalid date and non-positive amount before writing', () => {
  const badDate = manualRouteHarness();
  assert.equal(badDate.run({ ...validBody, payable_date: '2026-02-30' }).status, 400);
  assert.equal(badDate.getCreated(), null);
  const badAmount = manualRouteHarness();
  assert.equal(badAmount.run({ ...validBody, amount: 0 }).status, 400);
  assert.equal(badAmount.getCreated(), null);
});

test('manual payable creation rejects a disabled or missing category mapping', () => {
  const h = manualRouteHarness({
    queryOne(sql) {
      if (sql.includes('FROM payer_entities')) return { entity_key: 'id_hitech', entity_name: 'Hitech Indonesia', status: 'active', country_name: '印度尼西亚' };
      if (sql.includes('FROM currencies')) return { code: 'IDR', status: 'active' };
      if (sql.includes('FROM payment_subcategory_sources')) return null;
      throw new Error('Unexpected queryOne: ' + sql);
    }
  });
  const result = h.run(validBody);
  assert.equal(result.status, 400);
  assert.equal(h.getCreated(), null);
});

test('manual payable source resolves its country from the active payer entity', () => {
  const start = server.indexOf('function payableItemSourceExpenseCountry(item) {');
  const end = server.indexOf('function commonPayableItemsExpenseCountry', start);
  assert.ok(start >= 0 && end > start, 'payable source country resolver must exist');
  const calls = [];
  class TestSettlementError extends Error {
    constructor(status, message) { super(message); this.status = status; }
  }
  const ctx = {
    queryOne(sql, args) {
      calls.push({ sql, args });
      return { source_no: 'id_hitech', country: '印度尼西亚' };
    },
    SettlementError: TestSettlementError,
    activeExpenseCountry: value => value
  };
  vm.runInNewContext(server.slice(start, end), ctx);
  assert.equal(ctx.payableItemSourceExpenseCountry({
    id: 'payitem-1', fee_no: 'PAY-1', source_type: 'manual', payer_entity_key: 'id_hitech'
  }), '印度尼西亚');
  assert.ok(calls[0].sql.includes('payer_entities'));
  assert.equal(calls[0].args[0], 'id_hitech');
});

test('multi-expense payment request loads payer_entity_key for manual payable country validation', () => {
  const routeStart = server.indexOf("app.post('/api/payment-requests/multi-expense'");
  const queryStart = server.indexOf('SELECT id, fee_no, source_type, source_id, source_no, source_ci_id', routeStart);
  const queryEnd = server.indexOf('FROM payable_items', queryStart);
  assert.ok(routeStart >= 0 && queryStart > routeStart && queryEnd > queryStart);
  assert.match(server.slice(queryStart, queryEnd), /payer_entity_key/);
});
