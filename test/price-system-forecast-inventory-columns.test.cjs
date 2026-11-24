'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildForecastMetricMap } = require('../price-system-api');

test('total forecast metrics aggregate live available stock and keep the monthly average per SKU', () => {
  const metrics = buildForecastMetricMap([
    { sku_code: 'SKU-A', avg_sales_period: 20, available_qty: 10 },
    { sku_code: 'SKU-A', avg_sales_period: 20, available_qty: 20 },
    { sku_code: 'SKU-B', avg_sales_period: 0, available_qty: 7 }
  ]);

  assert.deepEqual(metrics.get('SKU-A'), {
    avg_sales_period: 20,
    available_qty: 30,
    available_turnover: 1.5
  });
  assert.deepEqual(metrics.get('SKU-B'), {
    avg_sales_period: 0,
    available_qty: 7,
    available_turnover: null
  });
});

test('price system data reads forecast average sales and latest inventory inbound age', () => {
  const api = fs.readFileSync(path.join(__dirname, '..', 'price-system-api.js'), 'utf8');
  assert.match(api, /MAX\(last_inbound_date\) AS last_inbound_date/);
  assert.match(api, /FROM replenishment_suggestions rs LEFT JOIN inventory i ON/);
  assert.match(api, /rs\.avg_sales_period/);
  assert.match(api, /days_since_last_inbound/);
  assert.match(api, /forecast_stats_days/);
});

test('price system places forecast average before stock and available turnover after stock', () => {
  const ui = fs.readFileSync(path.join(__dirname, '..', 'assets', 'price-system.js'), 'utf8');
  assert.match(ui, /tr\('category'\).*tr\('sku'\).*forecastAverageLabel\(\).*tr\('stock'\).*tr\('availableTurnover'\)/s);
  assert.match(ui, /class="ps-stock-meta"/);
  assert.match(ui, /r\.forecast_avg_sales/);
  assert.match(ui, /r\.available_turnover/);
  assert.match(ui, /r\.days_since_last_inbound/);
  assert.match(ui, /tr\('daysSinceInboundUnknown'\)/);
});

test('Excel export includes the new forecast and stock-age columns', () => {
  const ui = fs.readFileSync(path.join(__dirname, '..', 'assets', 'price-system.js'), 'utf8');
  assert.match(ui, /forecastAverageLabel\(\),tr\('daysSinceInboundHeader'\),tr\('availableTurnover'\)/);
  assert.match(ui, /c:6\+index/);
});
