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

test('clicking a payable event opens details without triggering the date cell create action', () => {
  const { context } = calendarContext();
  const item = {
    id: 'pay-1', payable_date: '2026-11-10', currency: 'RMB',
    payable_amount: 1200, remaining_amount: 1200, payee_name_snapshot: 'Redragon'
  };
  context.renderFinancePaymentCalendarPage({
    today: '2026-11-04', items: [item], facets: {}, categories: [], payerEntities: [], currencies: []
  });
  const monthHtml = context.fcRenderMonthGrid([item]);
  assert.match(monthHtml, /onclick="fcOpenCreate\('2026-11-10'\)"/);
  assert.match(monthHtml, /class="fcal-day-add"[^>]*onclick="event\.stopPropagation\(\);fcOpenCreate\('2026-11-10'\)"/);

  const eventHtml = context.fcEventHTML(item);
  const handler = eventHtml.match(/onclick="([^"]+)"/);
  assert.ok(handler, 'payable event should have a click handler');
  let propagationStopped = false;
  let openedId = '';
  vm.runInNewContext(handler[1], {
    event: { stopPropagation: () => { propagationStopped = true; } },
    fcOpenDetail: id => { openedId = id; }
  });
  assert.equal(propagationStopped, true, 'event click must not bubble to the date cell');
  assert.equal(openedId, 'pay-1', 'event click must open the selected payable detail');
});

test('finance payment overview opens in month view with compact top filters and no sidebar/search', () => {
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
  assert.equal(vm.runInNewContext('_financeCalendarState.view', context), 'month');
  assert.match(root.innerHTML, /财务付款总览/);
  assert.match(root.innerHTML, /本月应付/);
  assert.match(root.innerHTML, /fcal-month-grid/);
  assert.match(root.innerHTML, /fcal-filter-bar/);
  assert.match(root.innerHTML, /fcal-month-picker/);
  const filterKeys = [...root.innerHTML.matchAll(/data-filter="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(filterKeys, ['country', 'currency', 'status', 'category']);
  assert.doesNotMatch(root.innerHTML, /id="fcal-keyword"|class="fcal-search-row"|class="fcal-mini-grid|class="fcal-sidebar|class="fcal-undated-button/);
  assert.ok(root.innerHTML.includes('1200.00'));
  assert.match(root.innerHTML, /RMB/);
  assert.match(root.innerHTML, /fcal-view-switch/);
  assert.doesNotMatch(root.innerHTML, /fcal-today-button|现金流预测/);

  context.fcToggleFilterValue('country', 'ID', true);
  assert.match(root.innerHTML, /value="ID" checked/);
  context.fcClearAllFilters();
  assert.doesNotMatch(root.innerHTML, /value="ID" checked/);
});

test('month selector changes the selected calendar month and keeps month view active', () => {
  const { context, root } = calendarContext();
  context.renderFinancePaymentCalendarPage({ today: '2026-11-04', items: [], facets: {}, categories: [], payerEntities: [], currencies: [] });
  context.fcSetMonth('2026-12');
  assert.equal(vm.runInNewContext('_financeCalendarState.currentDate', context), '2026-12-01');
  assert.equal(vm.runInNewContext('_financeCalendarState.view', context), 'month');
  assert.match(root.innerHTML, /2026年12月/);
});
test('yearly summary groups scheduled payables by year, month and original currency', () => {
  const { context } = calendarContext();
  const rows = [
    { id: 'rmb-nov', payable_date: '2026-11-05', currency: 'RMB', payable_amount: 100, settled_amount: 40, remaining_amount: 60 },
    { id: 'idr-jul', payable_date: '2026-07-03', currency: 'IDR', payable_amount: 700000, settled_amount: 0, remaining_amount: 700000 },
    { id: 'idr-dec', payable_date: '2026-12-01', currency: 'IDR', payable_amount: 500000, settled_amount: 500000, remaining_amount: 0 },
    { id: 'rmb-prior', payable_date: '2025-10-01', currency: 'RMB', payable_amount: 30, settled_amount: 20, remaining_amount: 10 },
    { id: 'undated', payable_date: '', currency: 'RMB', payable_amount: 900, settled_amount: 0, remaining_amount: 900 }
  ];
  const summary = context.fcYearlySummary(rows, '2026-11-04', '2026-11-04');
  assert.equal(summary.yearKey, '2026');
  assert.equal(summary.totals.RMB.gross, 100);
  assert.equal(summary.totals.RMB.settled, 40);
  assert.equal(summary.totals.RMB.outstanding, 60);
  assert.equal(summary.totals.IDR.gross, 1200000);
  assert.equal(summary.totals.IDR.settled, 500000);
  assert.equal(summary.totals.IDR.outstanding, 700000);
  assert.equal(summary.months[10].totals.RMB.count, 1);
  assert.equal(summary.months[6].overdue.IDR, 700000);
  assert.equal(summary.overdue.RMB, 10);
  assert.equal(summary.overdue.IDR, 700000);
  assert.equal(summary.months[11].overdue.IDR, undefined);
});

test('year view renders twelve monthly cards and switches back into the selected month', () => {
  const { context, root } = calendarContext();
  context.renderFinancePaymentCalendarPage({
    today: '2026-11-04',
    items: [
      { id: 'pay-nov', fee_no: 'PAY-NOV', payee_name_snapshot: 'Redragon Forwarder', currency: 'RMB', payable_amount: 1200, settled_amount: 200, remaining_amount: 1000, payable_date: '2026-11-10' },
      { id: 'pay-dec', fee_no: 'PAY-DEC', payee_name_snapshot: 'Netac', currency: 'IDR', payable_amount: 500000, settled_amount: 500000, remaining_amount: 0, payable_date: '2026-12-10' }
    ],
    facets: {}, categories: [], payerEntities: [], currencies: []
  });
  context.fcSetView('year');
  assert.match(root.innerHTML, /本年应付/);
  assert.match(root.innerHTML, /应付日期/);
  assert.doesNotMatch(root.innerHTML, /计划/);
  assert.match(root.innerHTML, /本年已结清/);
  assert.match(root.innerHTML, /本年待付款/);
  assert.match(root.innerHTML, /Redragon Forwarder|RMB/);
  assert.equal((root.innerHTML.match(/<button type="button" class="fcal-year-month-card/g) || []).length, 12);
  assert.doesNotMatch(root.innerHTML, /本月应付/);
  context.fcSetYearMonth(10);
  assert.equal(vm.runInNewContext('_financeCalendarState.view', context), 'month');
  assert.equal(vm.runInNewContext('_financeCalendarState.currentDate', context), '2026-11-01');
  assert.match(root.innerHTML, /本月应付/);
});

test('year navigation moves by twelve months while preserving the selected month and day', () => {
  const { context } = calendarContext();
  context.renderFinancePaymentCalendarPage({ today: '2026-11-04', items: [], facets: {}, categories: [], payerEntities: [], currencies: [] });
  context.fcSetView('year');
  context.fcNavigate(1);
  assert.equal(vm.runInNewContext('_financeCalendarState.currentDate', context), '2027-11-04');
  context.fcNavigate(-1);
  assert.equal(vm.runInNewContext('_financeCalendarState.currentDate', context), '2026-11-04');
});
