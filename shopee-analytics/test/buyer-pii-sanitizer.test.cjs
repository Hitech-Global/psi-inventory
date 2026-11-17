'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeBuyerPii, sanitizeReturnRaw, sanitizeOrderRaw, sanitizeShopOrderReturnSnapshot } = require('../src/buyer-pii-sanitizer');
const { recordSnapshot } = require('../src/raw-snapshot');

test('removes buyer PII and return address while preserving commercial metrics', () => {
  const input = {
    response: {
      order_list: [{
        order_sn: 'ORDER-1', total_amount: 125, order_status: 'COMPLETED',
        buyer_username: 'secret-buyer', recipient_address: { name: 'SECRET', phone: '123', full_address: 'PRIVATE' },
        item_list: [{ item_name: 'Gaming Headphone', item_sku: 'SKU-1', model_quantity_purchased: 2 }],
      }],
      return: [{
        return_sn: 'RETURN-1', refund_amount: 20,
        user: { email: 'secret@example.com', username: 'secret-buyer' },
        return_address: { name: 'SECRET', phone: '123' },
        return_pickup_address: { whs_id: 100, address: 'PRIVATE' },
      }],
    },
  };
  const before = JSON.stringify(input);
  const safe = sanitizeBuyerPii(input);
  const serialized = JSON.stringify(safe);
  for (const secret of ['secret-buyer', 'secret@example.com', 'SECRET', 'PRIVATE']) {
    assert.equal(serialized.includes(secret), false);
  }
  assert.equal(safe.response.order_list[0].order_sn, 'ORDER-1');
  assert.equal(safe.response.order_list[0].total_amount, 125);
  assert.equal(safe.response.order_list[0].item_list[0].item_name, 'Gaming Headphone');
  assert.equal(safe.response.return[0].refund_amount, 20);
  assert.equal(JSON.stringify(input), before, 'original response must not be mutated');
});

test('raw snapshot persistence receives sanitized response and request', async () => {
  let saved;
  await recordSnapshot({
    repository: { async insertRawSnapshot(row) { saved = row; } },
    appRole: 'ERP', endpointKey: 'returnDetail', shopId: 123,
    requestJson: { return_sn: 'R-1', buyerPhone: '123456' },
    responseJson: { response: { user: { email: 'secret@example.com' }, refund_amount: 22 } },
  });
  assert.ok(saved);
  assert.equal(saved.requestJson.buyerPhone, undefined);
  assert.equal(saved.responseJson.response.user, undefined);
  assert.equal(saved.responseJson.response.refund_amount, 22);
});

test('allowlists remove free-form return text and retain refund figures', () => {
  const raw = { return_sn: 'R-1', refund_amount: 55, status: 'ACCEPTED',
    text_reason: 'please call me at 123456', user: { email: 'private@example.com' },
    return_pickup_address: { name: 'Buyer', phone: '123456' },
    item: [{ item_id: 8, name: 'Gaming Headset', item_price: 55, comment: 'private text' }] };
  const safe = sanitizeReturnRaw(raw);
  assert.equal(safe.refund_amount, 55);
  assert.equal(safe.item[0].name, 'Gaming Headset');
  assert.equal(JSON.stringify(safe).includes('123456'), false);
  assert.equal(JSON.stringify(safe).includes('private'), false);
});

test('allowlists strip buyer data from order and return API snapshots', () => {
  const order = sanitizeShopOrderReturnSnapshot('orderDetail', {
    response: { order_list: [{ order_sn: 'A', total_amount: 100,
      buyer_username: 'secret', message_to_seller: 'call private',
      item_list: [{ item_sku: 'SKU', model_quantity_purchased: 3 }] }] }
  });
  assert.equal(order.response.order_list[0].total_amount, 100);
  assert.equal(order.response.order_list[0].item_list[0].item_sku, 'SKU');
  assert.equal(JSON.stringify(order).includes('private'), false);
  const ret = sanitizeShopOrderReturnSnapshot('returnDetail', {
    response: { return_sn: 'R', refund_amount: 3, user: { email: 'secret@example.com' },
      text_reason: 'my phone is 123456' }
  });
  assert.equal(ret.response.refund_amount, 3);
  assert.equal(JSON.stringify(ret).includes('secret'), false);
  assert.equal(JSON.stringify(ret).includes('123456'), false);
  assert.equal(sanitizeOrderRaw({ order_sn: 'A', buyer_username: 'secret' }).buyer_username, undefined);
});

test('Shopee client strips PII before returning order/return API payloads', async () => {
  const { ShopeeClient } = require('../src/shopee-client');
  const response = {
    error: '',
    response: { return: [{
      return_sn: 'RETURN-2', refund_amount: 17,
      user: { email: 'private@example.com', username: 'buyer-secret' },
      return_pickup_address: { name: 'Buyer', phone: '1234567890' },
      item: [{ item_id: 1, name: 'Keyboard', amount: 1 }]
    }] }
  };
  const client = new ShopeeClient({
    partnerId: 123, partnerKey: 'test-key',
    fetchImpl: async () => ({
      ok: true, status: 200, text: async () => JSON.stringify(response),
      headers: { get: () => null },
    })
  });
  const result = await client.shopRequest({
    path: '/api/v2/returns/get_return_list', shopId: 1,
    accessToken: 'test-token',
  });
  assert.equal(result.response.return[0].refund_amount, 17);
  assert.equal(result.response.return[0].item[0].name, 'Keyboard');
  assert.equal(JSON.stringify(result).includes('buyer-secret'), false);
  assert.equal(JSON.stringify(result).includes('private@example.com'), false);
  assert.equal(JSON.stringify(result).includes('1234567890'), false);
});

test('Account Health source events never retain buyer contacts', () => {
  const { sanitizeHealthEventRaw } = require('../src/buyer-pii-sanitizer');
  const row = { order_sn: 'O-123', preparation_days: 2, buyer_username: 'secret',
    contact: { phone: '555' }, text_reason: 'email private@example.com' };
  const safe = sanitizeHealthEventRaw(row);
  assert.deepEqual(safe, { order_sn: 'O-123', preparation_days: 2 });
});
