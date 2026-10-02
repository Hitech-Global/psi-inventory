'use strict';

const assert = require('assert');
const { normalizeVoucherDetail } = require('../src/sync-voucher');
const { normalizeDiscountDetail } = require('../src/sync-discount');

const voucher = normalizeVoucherDetail({
  response: {
    voucher_id: 10,
    voucher_code: 'TENOFF',
    voucher_name: '10 percent',
    voucher_type: 2,
    reward_type: 2,
    percentage: 10,
    max_price: 30000,
    min_basket_price: 500000,
    item_id_list: [101, 102],
  },
});
assert.strictEqual(voucher.voucherId, 10);
assert.deepStrictEqual(voucher.itemIds, [101, 102]);
assert.strictEqual(voucher.percentage, 10);

const discount = normalizeDiscountDetail({
  response: {
    discount_id: 20,
    discount_name: '3 day test',
    status: 'ongoing',
    item_list: [{
      item_id: 101,
      item_original_price: 699000,
      item_promotion_price: 629000,
      model_list: [
        { model_id: 1, model_original_price: 699000, model_promotion_price: 619000 },
        { model_id: 2, model_original_price: 699000, model_promotion_price: 629000 },
      ],
    }],
  },
});
assert.strictEqual(discount.discountId, 20);
assert.strictEqual(discount.itemRows.length, 2);
assert.strictEqual(discount.itemRows[0].promotionPrice, 619000);

console.log('shopee promotion normalization tests: ok');
