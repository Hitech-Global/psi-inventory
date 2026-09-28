'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'web', 'currency-format-v1.js'), 'utf8');
const sandbox = { window: {} };
vm.runInNewContext(source, sandbox);
const currency = sandbox.window.ShopeeCurrency;

assert(currency, 'currency formatter must be exposed');
assert.strictEqual(currency.resolveCurrency({ countryCode: 'ID' }), 'IDR');
assert.strictEqual(currency.resolveCurrency({ countryCode: 'MY' }), 'MYR');
assert.strictEqual(currency.resolveCurrency({ countryCode: 'TH' }), 'THB');
assert.strictEqual(currency.format(2594300, { countryCode: 'ID' }), 'Rp 2,594,300');
assert.strictEqual(currency.format(1234.5, { countryCode: 'MY' }), 'RM 1,234.50');
assert.strictEqual(currency.format(1234.5, { countryCode: 'TH' }), '฿ 1,234.50');

const payload = { shops: [{ countryCode: 'ID', currency: null }], groups: [{ countryCode: 'MY' }] };
currency.hydrate(payload);
assert.strictEqual(payload.shops[0].currency, 'IDR');
assert.strictEqual(payload.groups[0].currency, 'MYR');
console.log('local currency symbol fallback contract: ok');

const index = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.js'), 'utf8');
const productCard = fs.readFileSync(path.join(__dirname, '..', 'web', 'product-card-ui-v2.js'), 'utf8');
const styles = fs.readFileSync(path.join(__dirname, '..', 'web', 'styles.css'), 'utf8');
assert(index.indexOf('/currency-format-v1.js') < index.indexOf('/app.js'), 'currency helper must load before app.js');
assert(app.includes('ShopeeCurrency?.hydrate(payload)'), 'API payload currencies must be hydrated');
assert(productCard.includes('ShopeeCurrency?.format(value, selectedContext().shop'), 'Product Card money must use local currency');
assert(styles.includes('table thead th,table tbody td{text-align:left!important}'), 'all table fields and data must align left');
console.log('currency integration and left alignment contract: ok');
