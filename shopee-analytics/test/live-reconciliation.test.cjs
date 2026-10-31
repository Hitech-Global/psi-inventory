'use strict';

const assert = require('assert');
const {
  relativeDelta,
  compareMetric,
  evaluateSellerCentreReconciliation,
} = require('../src/live-reconciliation');

assert.strictEqual(relativeDelta(101, 100), 0.01);
assert.strictEqual(relativeDelta(0, 0), 0);
assert.strictEqual(relativeDelta(1, 0), null);

assert.strictEqual(compareMetric({
  key: 'sales', label: 'Sales', actual: 100.5, expected: 100, tolerance: 0.01,
}).pass, true);

const ok = evaluateSellerCentreReconciliation({
  actual: { sales: 1000, orders: 100, adExpense: 150, broadGmv: 800 },
  expected: { sales: 1000, orders: 100, adExpense: 150, broadGmv: 800 },
});
assert.strictEqual(ok.pass, true);
assert.strictEqual(ok.checkCount, 4);

const bad = evaluateSellerCentreReconciliation({
  actual: { sales: 900, orders: 100 },
  expected: { sales: 1000, orders: 100 },
});
assert.strictEqual(bad.pass, false);
assert.strictEqual(bad.failedCount, 1);

console.log('shopee live reconciliation tests: ok');
