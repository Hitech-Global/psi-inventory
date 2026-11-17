'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repoRoot = path.join(__dirname, '..');
const script = fs.readFileSync(path.join(repoRoot, 'assets/ci-single-date-filter.js'), 'utf8');
const index = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');

function makeContext() {
  const fields = {
    'ci-date-filter-input': { value: '' },
    'ci-purchase-summary': { innerHTML: '' },
    'ci-table': { innerHTML: '' }
  };
  const context = {
    document: {
      readyState: 'loading',
      getElementById(id) { return fields[id] || null; },
      addEventListener() {}
    },
    renderUnifiedCITable(operational, historical) {
      context.lastTableArgs = { operational, historical };
      return 'rendered:' + operational.length + '/' + historical.length;
    },
    renderPurchaseAmountSummary(summary) {
      context.lastSummary = summary;
      return 'summary';
    },
    loadCI() {}
  };
  context.window = context;
  vm.runInNewContext(script, context);
  return { context, fields };
}

test('CI list gets one compact single-date control without changing existing layout rules', () => {
  assert.match(index, /assets\/ci-single-date-filter\.js\?v=20261117-3/);
  assert.match(script, /type="date"/);
  assert.match(script, /ci-date-filter-group/);
  assert.match(script, /translate\('common\.all', '全部'\)/);
  assert.match(script, /width:130px/);
  assert.match(script, /height:30px/);
  assert.match(script, /pointer-events:none/);
  assert.match(script, /input\\.showPicker\\(\\)/);
  assert.match(script, /trigger\\.addEventListener\\('click', openDatePicker\\)/);
  assert.doesNotMatch(script, /aria-hidden=\\"true\\"/);
  assert.doesNotMatch(script, /ci-date-start|ci-date-end|date-range/);
  assert.doesNotMatch(script, /\.filter-form\s*\{|\.filter-group\s*\{/);
});

test('single date filters operational and historical CI rows by CI date', () => {
  const { context, fields } = makeContext();
  const operational = [
    { id: 'op-1', ci_date: '2026-11-05', currency: 'RMB', goods_amount: 100, ci_status: 'completed' },
    { id: 'op-2', ci_date: '2026-11-06', currency: 'RMB', goods_amount: 300, ci_status: 'completed' },
    { id: 'op-3', ci_date: '2026-11-05T12:00:00Z', currency: 'USD', goods_amount: 20, ci_status: 'completed' },
    { id: 'op-4', ci_date: '2026-11-05', currency: 'RMB', goods_amount: 999, ci_status: 'cancelled' },
    { id: 'op-5', ci_date: '', currency: 'RMB', goods_amount: 50, ci_status: 'completed' }
  ];
  const historical = [
    { id: 'hist-1', ci_date: '2026-11-05', currency: 'USD', gross_goods_amount: 40 },
    { id: 'hist-2', ci_date: '2026-11-06', currency: 'RMB', gross_goods_amount: 60 }
  ];

  context.renderUnifiedCITable(operational, historical);
  context.renderPurchaseAmountSummary({ operational: {}, historical: {}, total: {} });
  assert.equal(context.lastSummary.total.count, 6);

  fields['ci-date-filter-input'].value = '2026-11-05';
  context.__ciSingleDateFilterV1.renderLatest();

  assert.deepEqual(Array.from(context.lastTableArgs.operational, row => row.id), ['op-1', 'op-3', 'op-4']);
  assert.deepEqual(Array.from(context.lastTableArgs.historical, row => row.id), ['hist-1']);
  assert.equal(context.lastSummary.operational.count, 2);
  assert.deepEqual(
    Array.from(context.lastSummary.operational.by_currency, item => [item.currency, item.amount]),
    [['RMB', 100], ['USD', 20]]
  );
  assert.equal(context.lastSummary.historical.count, 1);
  assert.equal(context.lastSummary.historical.by_currency[0].amount, 40);
  assert.equal(context.lastSummary.total.count, 3);
  assert.deepEqual(
    Array.from(context.lastSummary.total.by_currency, item => [item.currency, item.amount]),
    [['RMB', 100], ['USD', 60]]
  );
  assert.equal(context.lastSummary.total.rmb_pending_count, 2);
});

test('clearing the single date restores all currently loaded CI rows and totals', () => {
  const { context, fields } = makeContext();
  const operational = [
    { id: 'op-1', ci_date: '2026-11-05', currency: 'RMB', goods_amount: 100, ci_status: 'completed' },
    { id: 'op-2', ci_date: '2026-11-06', currency: 'RMB', goods_amount: 300, ci_status: 'completed' }
  ];
  const historical = [
    { id: 'hist-1', ci_date: '2026-11-05', currency: 'USD', gross_goods_amount: 40 }
  ];
  context.renderUnifiedCITable(operational, historical);
  context.renderPurchaseAmountSummary({ operational: {}, historical: {}, total: {} });

  fields['ci-date-filter-input'].value = '2026-11-05';
  context.__ciSingleDateFilterV1.renderLatest();
  assert.equal(context.lastSummary.total.count, 2);

  fields['ci-date-filter-input'].value = '';
  context.__ciSingleDateFilterV1.renderLatest();
  assert.deepEqual(Array.from(context.lastTableArgs.operational, row => row.id), ['op-1', 'op-2']);
  assert.deepEqual(Array.from(context.lastTableArgs.historical, row => row.id), ['hist-1']);
  assert.equal(context.lastSummary.total.count, 3);
  assert.deepEqual(
    Array.from(context.lastSummary.total.by_currency, item => [item.currency, item.amount]),
    [['RMB', 400], ['USD', 40]]
  );
});



test('visible CI date control opens the native picker and date selection filters rows', () => {
  const listeners = {};
  const input = {
    value: '',
    addEventListener(name, callback) { listeners['input:' + name] = callback; },
    showPickerCalls: 0,
    showPicker() { this.showPickerCalls++; },
    focus() {},
    click() {}
  };
  const trigger = {
    addEventListener(name, callback) { listeners['trigger:' + name] = callback; },
    click() { listeners['trigger:click'](); }
  };
  const value = { textContent: '' };
  const group = {
    className: '',
    id: '',
    innerHTML: '',
    querySelector(selector) {
      if (selector === '#ci-date-filter-input') return input;
      if (selector === '#ci-date-filter-trigger') return trigger;
      if (selector === '#ci-date-filter-value') return value;
      return null;
    }
  };
  const actions = {};
  const summaryTarget = { innerHTML: '' };
  const tableTarget = { innerHTML: '' };
  const form = {
    inserted: null,
    querySelector(selector) {
      if (selector === '#ci-date-filter-group') return this.inserted;
      if (selector === '.filter-actions') return actions;
      return null;
    },
    insertBefore(node) { this.inserted = node; },
    appendChild(node) { this.inserted = node; }
  };
  const mode = { closest() { return form; } };
  let domReady;
  const context = {
    document: {
      readyState: 'loading',
      body: {},
      head: { appendChild() {} },
      getElementById(id) {
        if (id === 'ci-source-mode') return mode;
        if (id === 'ci-date-filter-input' && form.inserted) return input;
        if (id === 'ci-purchase-summary') return summaryTarget;
        if (id === 'ci-table') return tableTarget;
        if (id === 'ci-date-filter-style') return null;
        return null;
      },
      createElement(tag) { return tag === 'style' ? { id: '', textContent: '' } : group; },
      addEventListener(name, callback) { if (name === 'DOMContentLoaded') domReady = callback; }
    },
    renderUnifiedCITable(operational, historical) {
      context.lastRows = { operational, historical };
      return 'table';
    },
    renderPurchaseAmountSummary(summary) {
      context.lastSummary = summary;
      return 'summary';
    },
    loadCI() {}
  };
  context.window = context;
  vm.runInNewContext(script, context);
  domReady();

  const operational = [
    { id: 'op-1', ci_date: '2026-11-05', currency: 'RMB', goods_amount: 100, ci_status: 'completed' },
    { id: 'op-2', ci_date: '2026-11-06', currency: 'RMB', goods_amount: 300, ci_status: 'completed' }
  ];
  context.renderUnifiedCITable(operational, []);
  context.renderPurchaseAmountSummary({ operational: {}, historical: {}, total: {} });

  trigger.click();
  assert.equal(input.showPickerCalls, 1, 'clicking the visible date control must open the native picker');

  input.value = '2026-11-05';
  listeners['input:change']();
  assert.deepEqual(Array.from(context.lastRows.operational, row => row.id), ['op-1']);
  assert.equal(context.lastSummary.total.count, 1);
  assert.equal(value.textContent, '2026-11-05');
});

test('amount visibility permission is preserved', () => {
  const { context, fields } = makeContext();
  context.renderUnifiedCITable(
    [{ ci_date: '2026-11-05', currency: 'RMB', goods_amount: 100, ci_status: 'completed' }],
    []
  );
  const result = context.renderPurchaseAmountSummary({ amount_view_allowed: false });
  assert.equal(result, '');
  const prior = context.lastSummary;
  fields['ci-date-filter-input'].value = '2026-11-05';
  context.__ciSingleDateFilterV1.renderLatest();
  assert.equal(context.lastSummary, prior);
});
