'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'assets', 'finance-payment-calendar.js'), 'utf8');

function calendarContext() {
  const root = { innerHTML: '' };
  const listeners = [];
  const context = {
    document: {
      getElementById: id => id === 'content-inner' ? root : null,
      addEventListener: (name, fn) => listeners.push({ name, fn }),
      querySelectorAll: () => []
    },
    window: {},
    getLang: () => 'zh',
    esc: value => String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    fmtMoney: value => Number(value || 0).toFixed(2),
    hasPermission: () => true,
    showToast: () => {},
    api: async () => ({ items: [], total: 0 })
  };
  vm.runInNewContext(source, context);
  return { context, root, listeners };
}

test('month grid starts on Sunday and always contains six calendar weeks', () => {
  const { context } = calendarContext();
  const dates = context.fcBuildMonthDates('2026-11-04');
  assert.equal(dates.length, 42);
  assert.equal(new Date(dates[0] + 'T12:00:00').getDay(), 0);
  assert.equal(dates[dates.length - 1], '2026-12-12');
});

test('monthly summary keeps currencies separate and includes settlement components', () => {
  const { context } = calendarContext();
  const rows = [
    { id: 'rmb-1', payable_date: '2026-11-05', currency: 'RMB', payable_amount: 100, settled_amount: 40, remaining_amount: 60 },
    { id: 'idr-1', payable_date: '2026-11-08', currency: 'IDR', payable_amount: 500000, settled_amount: 500000, remaining_amount: 0 },
    { id: 'rmb-old', payable_date: '2026-10-01', currency: 'RMB', payable_amount: 30, settled_amount: 20, remaining_amount: 10 }
  ];
  const summary = context.fcMonthlySummary(rows, '2026-11-04', '2026-11-04');
  assert.equal(summary.totals.RMB.gross, 100);
  assert.equal(summary.totals.RMB.settled, 40);
  assert.equal(summary.totals.RMB.outstanding, 60);
  assert.equal(summary.totals.IDR.gross, 500000);
  assert.equal(summary.overdue.RMB, 10);
  assert.equal(summary.monthRows.length, 2);
});

test('event state distinguishes overdue, partial, reserved and settled items', () => {
  const { context } = calendarContext();
  assert.equal(context.fcStatusKey({ payable_date: '2026-11-03', payable_amount: 10, remaining_amount: 10 }, '2026-11-04'), 'overdue');
  assert.equal(context.fcStatusKey({ payable_date: '2026-11-03', payable_amount: 10, remaining_amount: 0 }, '2026-11-04'), 'settled');
  assert.equal(context.fcStatusKey({ payable_date: '2026-11-05', payable_amount: 10, remaining_amount: 4, paid_amount: 6 }, '2026-11-04'), 'partial');
  assert.equal(context.fcStatusKey({ payable_date: '2026-11-05', payable_amount: 10, remaining_amount: 10, lifecycle_status: 'reserved' }, '2026-11-04'), 'reserved');
});

test('finance payment overview renders the calendar, monthly totals and payable events', () => {
  const { context, root } = calendarContext();
  context.renderFinancePaymentCalendarPage({
    today: '2026-11-04',
    items: [{
      id: 'pay-1', fee_no: 'PAY-1', source_type: 'manual', category_code: 'warehouse_arrival',
      payee_name_snapshot: 'Redragon Forwarder', currency: 'RMB', payable_amount: 1200,
      settled_amount: 200, remaining_amount: 1000, paid_amount: 200, payable_date: '2026-11-10',
      lifecycle_status: 'partially_paid', payment_state: 'partial', payer_entity_key: 'id_hitech',
      payer_name_snapshot: 'Hitech Indonesia', country_code: 'ID', country_display: '印度尼西亚', brand: 'Redragon'
    }],
    facets: { countries: [{ code: 'ID', name: '印度尼西亚' }], brands: ['Redragon'] },
    categories: [{ code: 'warehouse_arrival', name: '物流 / 到仓', subcategories: [] }],
    payerEntities: [{ entity_key: 'id_hitech', entity_name: 'Hitech Indonesia', status: 'active', default_currency: 'IDR' }],
    currencies: [{ code: 'IDR', status: 'active' }, { code: 'RMB', status: 'active' }]
  });
  assert.match(root.innerHTML, /财务付款总览/);
  assert.match(root.innerHTML, /本月计划应付/);
  assert.match(root.innerHTML, /fcal-month-grid/);
  assert.match(root.innerHTML, /Redragon Forwarder/);
  assert.match(root.innerHTML, /RMB/);
  assert.doesNotMatch(root.innerHTML, /现金流预测/);
});
