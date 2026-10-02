'use strict';

const assert = require('assert');
const {
  comparableModel,
  priceChanged,
} = require('../src/product-repository');

const before = comparableModel({
  model_id: 11,
  model_sku: 'H888-BLK',
  current_price: '399000',
  original_price: '499000',
  stock: 10,
});
const same = comparableModel({
  modelId: 11,
  modelSku: 'H888-BLK',
  currentPrice: 399000,
  originalPrice: 499000,
  stock: 3,
});
const changed = comparableModel({
  modelId: 11,
  modelSku: 'H888-BLK',
  currentPrice: 379000,
  originalPrice: 499000,
  stock: 3,
});

assert.strictEqual(priceChanged(before, same), false);
assert.strictEqual(priceChanged(before, changed), true);

console.log('shopee product repository helper tests: ok');
