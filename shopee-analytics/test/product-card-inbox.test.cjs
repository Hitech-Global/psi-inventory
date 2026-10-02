'use strict';

const assert = require('assert');
const {
  parseInboxFileName,
  isProductCardFile,
} = require('../src/product-card-inbox');

assert.deepStrictEqual(
  parseInboxFileName('shop-1101364305__Product_Card.20260801_20260812.xlsx'),
  {
    shopId: 1101364305,
    startDate: '2026-08-01',
    endDate: '2026-08-12',
  },
);
assert.strictEqual(
  parseInboxFileName('Product_Card.20260801_20260812.xlsx'),
  null,
);
assert.strictEqual(isProductCardFile('a.xlsx'), true);
assert.strictEqual(isProductCardFile('a.XLS'), true);
assert.strictEqual(isProductCardFile('a.csv'), false);

console.log('shopee Product Card inbox tests: ok');
