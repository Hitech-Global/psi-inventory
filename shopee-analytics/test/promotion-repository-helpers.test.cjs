'use strict';

const assert = require('assert');
const {
  comparableVoucher,
  voucherChangedFields,
  comparableDiscountHeader,
  groupDiscountRows,
  discountHeaderChanged,
} = require('../src/promotion-repository');

const beforeVoucher = comparableVoucher({
  voucher_id: 1,
  voucher_type: 2,
  reward_type: 1,
  start_time: 100,
  end_time: 200,
  percentage: '10',
  min_basket_price: '100000',
}, [11, 22]);
const afterVoucher = comparableVoucher({
  voucherId: 1,
  voucherType: 2,
  rewardType: 1,
  startTime: 100,
  endTime: 200,
  percentage: 12,
  minBasketPrice: 100000,
}, [11, 33]);
assert.deepStrictEqual(
  voucherChangedFields(beforeVoucher, afterVoucher),
  ['percentage', 'itemIds'],
);

const beforeHeader = comparableDiscountHeader({
  discount_id: 8,
  discount_name: 'Payday',
  start_time: 100,
  end_time: 200,
  source: 0,
});
const afterHeader = comparableDiscountHeader({
  discountId: 8,
  discountName: 'Payday',
  startTime: 100,
  endTime: 300,
  source: 0,
});
assert.strictEqual(discountHeaderChanged(beforeHeader, afterHeader), true);

const grouped = groupDiscountRows([
  { item_id: 10, model_id: 2, original_price: 100, promotion_price: 90 },
  { item_id: 10, model_id: 1, original_price: 100, promotion_price: 80 },
  { item_id: 20, model_id: 0, original_price: 50, promotion_price: 45 },
]);
assert.strictEqual(grouped.get('10').length, 2);
assert.strictEqual(grouped.get('10')[0].modelId, 1);

console.log('shopee promotion repository helper tests: ok');
