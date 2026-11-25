'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { calculateLiveExchangeRate } = require('../price-system-api');
const { BUILTIN_PRICE_VARIABLES, evaluateFormula } = require('../price-system-formula');

test('derives USD to IDR from the inventory summary RMB-base rates', () => {
  const result = calculateLiveExchangeRate('USD', 'IDR', {
    rates: {
      USD: { rate: 0.138, date: '2026-11-25', source: 'realtime' },
      IDR: { rate: 2732.24, date: '2026-11-25', source: 'db_today' }
    }
  });
  assert.equal(result.from_currency, 'USD');
  assert.equal(result.to_currency, 'IDR');
  assert.ok(Math.abs(result.rate - (2732.24 / 0.138)) < 1e-9);
  assert.equal(result.used_fallback, false);
});

test('supports RMB base and same-currency conversions', () => {
  const rates = { rates: { IDR: { rate: 2732.24, date: '2026-11-25', source: 'db_today' } } };
  assert.equal(calculateLiveExchangeRate('RMB', 'IDR', rates).rate, 2732.24);
  assert.equal(calculateLiveExchangeRate('IDR', 'IDR', rates).rate, 1);
  assert.equal(calculateLiveExchangeRate('CNY', 'IDR', rates).rate, 2732.24);
});

test('fails closed when either side of the live currency pair is unavailable', () => {
  assert.throws(() => calculateLiveExchangeRate('USD', 'IDR', { rates: { IDR: { rate: 2732.24 } } }), /实时汇率暂不可用/);
  assert.throws(() => calculateLiveExchangeRate('', 'IDR', { rates: {} }), /缺少来源币种/);
});

test('live exchange rate is available to formula validation and evaluation', () => {
  assert.ok(BUILTIN_PRICE_VARIABLES.includes('exchange_rate'));
  assert.equal(evaluateFormula('fob * exchange_rate', { fob: 4.38, exchange_rate: 18200 }), 79716);
  assert.throws(() => evaluateFormula('fob * exchange_rate', { fob: 4.38 }), /实时汇率暂不可用/);
});

test('price system reuses the inventory currency resolver and exposes the compact pair in the column header', () => {
  const root = path.resolve(__dirname, '..');
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  const api = fs.readFileSync(path.join(root, 'price-system-api.js'), 'utf8');
  const ui = fs.readFileSync(path.join(root, 'assets/price-system.js'), 'utf8');
  assert.match(server, /resolveInventoryCurrencyRates, fetchImpl: fetch/);
  assert.match(api, /await resolveInventoryCurrencyRates/);
  assert.match(api, /formula_exchange_rates/);
  assert.match(ui, /\{key:'exchange_rate',label:'liveExchangeRate'\}/);
  assert.match(ui, /formulaExchangeRateLabel/);
  assert.match(ui, /ps-fx-unit/);
});
