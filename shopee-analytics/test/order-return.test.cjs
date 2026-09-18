'use strict';

const assert = require('assert');
const { normalizeOrder } = require('../src/sync-orders');
const { normalizeReturn } = require('../src/sync-returns');

const order = normalizeOrder({
  order_sn: 'ORD-1',
  order_status: 'COMPLETED',
  create_time: 1,
  update_time: 2,
  currency: 'IDR',
  total_amount: 799000,
  item_list: [{
    item_id: 101,
    item_sku: 'H858',
    model_id: 0,
    model_sku: 'H858-BK',
    model_quantity_purchased: 1,
    model_original_price: 899000,
    model_discounted_price: 799000,
    promotion_type: 'product_promotion',
  }],
});
assert.strictEqual(order.orderSn, 'ORD-1');
assert.strictEqual(order.items[0].discountedPrice, 799000);
assert.strictEqual(order.items[0].quantity, 1);

const ret = normalizeReturn({
  return_sn: 'RET-1',
  order_sn: 'ORD-1',
  status: 'ACCEPTED',
  reason: 'DAMAGED_ITEM',
  reassessed_request_reason: 'NONE',
  refund_amount: 799000,
  item: [{
    item_id: 101,
    model_id: 0,
    amount: 1,
    item_price: 799000,
    refund_amount: 799000,
  }],
});
assert.strictEqual(ret.reason, 'DAMAGED_ITEM');
assert.strictEqual(ret.items[0].quantity, 1);

const reassessed = normalizeReturn({
  return_sn: 'RET-2',
  reason: 'CHANGE_MIND',
  reassessed_request_reason: 'WRONG_ITEM',
  item: [],
});
assert.strictEqual(reassessed.reason, 'WRONG_ITEM');

console.log('shopee order/return tests: ok');
