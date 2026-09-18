'use strict';

const assert = require('assert');
const { median, diagnoseStoreSkus } = require('../src/store-sku-diagnosis');

assert.strictEqual(median([3, 1, 2]), 2);
assert.strictEqual(median([1, 3]), 2);
assert.strictEqual(median([]), null);

const result = diagnoseStoreSkus([
  {
    itemId: 1,
    hasProductCard: true,
    totalConversionRate: 0.10,
    totalSales: 1000,
    adExpense: 100,
    broadGmv: 200,
    broadOrders: 2,
    directOrders: 2,
    adSpendRatioToSales: 0.10,
    adGmvShareOfSales: 0.20,
    estimatedNaturalSales: 800,
  },
  {
    itemId: 2,
    hasProductCard: true,
    totalConversionRate: 0.04,
    totalSales: 1000,
    adExpense: 200,
    broadGmv: 900,
    broadOrders: 1,
    directOrders: 1,
    adSpendRatioToSales: 0.20,
    adGmvShareOfSales: 0.90,
    estimatedNaturalSales: 100,
  },
  {
    itemId: 3,
    hasProductCard: false,
    totalConversionRate: null,
    totalSales: null,
    adExpense: 50,
    broadGmv: 0,
    broadOrders: 0,
    directOrders: 0,
    adSpendRatioToSales: null,
    adGmvShareOfSales: null,
    estimatedNaturalSales: null,
  },
]);

assert.strictEqual(result.cvrMedian, 0.07);
assert(result.items[0].signals.some(row => row.code === 'NATURAL_LED_SALES'));
assert.strictEqual(result.items[1].primarySignal.code, 'ITEM_AD_SPEND_RATIO_OVER_LIMIT');
assert(result.items[1].primarySignal.action && result.items[1].primarySignal.action.length > 10);
assert(result.items[1].signals.some(row => row.code === 'CVR_BELOW_STORE_MEDIAN'));
assert.strictEqual(result.items[2].primarySignal.code, 'AD_SPEND_ZERO_ORDER');
assert(result.items[2].signals.some(row => row.code === 'PRODUCT_CARD_MISSING'));
assert.strictEqual(result.attentionCount, 2);

const mismatch = diagnoseStoreSkus([{
  itemId: 4,
  hasProductCard: true,
  totalConversionRate: 0.1,
  totalSales: 100,
  adExpense: 10,
  broadGmv: 150,
  directGmv: 120,
  directGmvShareOfSales: 1.2,
  estimatedNaturalSales: -20,
  adAttributionExceedsTotalSales: true,
  broadOrders: 1,
  directOrders: 1,
  adSpendRatioToSales: 0.1,
}]);
assert(
  mismatch.items[0].signals.some(row => row.code === 'DIRECT_ATTRIBUTION_EXCEEDS_ITEM_SALES'),
);

console.log('shopee store SKU diagnosis tests: ok');
