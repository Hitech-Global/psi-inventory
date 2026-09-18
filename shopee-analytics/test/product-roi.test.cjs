'use strict';

const assert = require('assert');
const { normalizeModel } = require('../src/sync-product');
const { normalizeRecommendedRoi, buildReferenceId } = require('../src/sync-roi');

const model = normalizeModel({
  model_id: 7,
  model_name: 'Black',
  model_sku: 'H858-BK',
  price_info: [{ original_price: 699000, current_price: 629000 }],
  stock_info_v2: [{ current_stock: 4 }, { current_stock: 6 }],
});
assert.strictEqual(model.modelId, 7);
assert.strictEqual(model.currentPrice, 629000);
assert.strictEqual(model.stock, 10);

const roi = normalizeRecommendedRoi({
  response: {
    lower_bound: { value: 5.1, percentile: 80 },
    exact: { value: 7.2, percentile: 50 },
    upper_bound: { value: 8.7, percentile: 20 },
  },
});
assert.strictEqual(roi.exact.value, 7.2);
assert.strictEqual(roi.upper.percentile, 20);
assert.strictEqual(buildReferenceId({ shopId: 1, itemId: 2, date: '2026-09-18T00:00:00Z' }), 'analytics-1-2-20260918');

console.log('shopee product/roi tests: ok');
