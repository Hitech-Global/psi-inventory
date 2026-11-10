'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const start = source.indexOf('function renderInvCards(data, countryCurrency, countryFilter){');
const end = source.indexOf('\n}', start);
assert.ok(start >= 0 && end > start, 'renderInvCards should exist');
const renderSource = source.slice(start, end + 2);

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderCards(data, currencies, countryFilter) {
  const target = { innerHTML: '' };
  const sandbox = {
    document: { getElementById: function(id) { return id === 'inv-cards' ? target : null; } },
    t: function(key, fallback) { return fallback; },
    esc: escapeHtml
  };
  vm.runInNewContext(renderSource + '\nthis.renderInvCards = renderInvCards;', sandbox);
  sandbox.renderInvCards(data, currencies, countryFilter || '');
  return target.innerHTML;
}

const currencies = {
  Indonesia: { code: 'IDR', symbol: 'Rp', rate: 2700 },
  Thailand: { code: 'THB', symbol: '฿', rate: 5 },
  Malaysia: { code: 'MYR', symbol: 'RM', rate: 0.6 }
};

const rows = [
  { country: 'Indonesia', available_qty: 2, weighted_avg_cost: 1000, in_transit_qty: 0, pi_confirmed_unshipped_qty: 0 },
  { country: 'Thailand', available_qty: 3, weighted_avg_cost: 200, in_transit_qty: 0, pi_confirmed_unshipped_qty: 0 },
  { country: 'Malaysia', available_qty: 4, weighted_avg_cost: 50, in_transit_qty: 0, pi_confirmed_unshipped_qty: 0 }
];

test('on-hand KPI shows each selected local currency and the CNY equivalent', () => {
  const html = renderCards(rows, currencies, '');

  assert.match(html, /在库库存金额（本币）/);
  assert.match(html, /IDR/);
  assert.match(html, /Rp 2,000\.00/);
  assert.match(html, /THB/);
  assert.match(html, /฿ 600\.00/);
  assert.match(html, /MYR/);
  assert.match(html, /RM 200\.00/);
  assert.match(html, /在库库存金额（人民币）/);
  assert.match(html, /¥ 454\.07/);
});

test('on-hand KPI remains readable for a single-country filter', () => {
  const html = renderCards([rows[0]], currencies, 'Indonesia');

  assert.match(html, /IDR/);
  assert.match(html, /Rp 2,000\.00/);
  assert.doesNotMatch(html, /THB|MYR/);
  assert.match(html, /¥ 0\.74/);
});

test('inventory table continues to expose both local and CNY on-hand amount columns', () => {
  assert.match(source, /t\('inv\.col\.on_hand_amount_local'/);
  assert.match(source, /t\('inv\.col\.on_hand_amount_rmb'/);
});

test('inventory overview table aligns all data columns and headers left while keeping checkbox centered', () => {
  assert.match(source, /#inv-table \.inv-head-table thead th:not\(:first-child\),#inv-table \.inv-body-table tbody td:not\(:first-child\)\{text-align:left!important\}/);
  assert.match(source, /#inv-table \.inv-head-table thead th:first-child,#inv-table \.inv-body-table tbody td:first-child\{text-align:center!important\}/);
});

test('inventory overview starts core data request before waiting for filter options', () => {
  assert.match(source, /const initialInventoryLoad = loadInv\(savedFilters \|\| undefined\)/);
  assert.match(source, /async function loadInv\(filterOverride\)/);
  assert.match(source, /const ratePromise = api\('\/api\/inventory\/currency-rates'/);
  assert.match(source, /正在加载库存数据/);
});
