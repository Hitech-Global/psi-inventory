'use strict';

const assert = require('assert');
const { normalizeShopBiDetail, fetchShopBiDay } = require('../src/sync-shop-bi');

const normalized = normalizeShopBiDetail({
  shop_id: 1,
  shop_name: 'Redragon',
  shop_region_code: 'ID',
  currency: 'IDR',
  sales: 1000,
  orders: 5,
  units_sold: 6,
  product_clicks: 100,
  product_views: 80,
  unique_visitors: 70,
  item_conversion_rate: 0.075,
  order_conversion_rate: 0.05,
  voucher_sales: 300,
  voucher_buyers: 2,
  voucher_usage_rate: 0.1,
  voucher_cir: 0.03,
  voucher_cost: 9,
});
assert.strictEqual(normalized.productClicks, 100);
assert.strictEqual(normalized.voucherCost, 9);

let request;
const client = {
  async shopRequest(req) {
    request = req;
    return { response: { details: [{ shop_id: 1, sales: 1000 }] } };
  },
};

(async () => {
  const result = await fetchShopBiDay({
    client,
    shopId: 1,
    accessToken: 'token',
    date: '2026-09-17',
    timezone: 'GMT+7',
  });
  assert.strictEqual(request.method, 'POST');
  assert.strictEqual(request.body.granularity, 'day');
  assert.deepStrictEqual(request.body.shop_list, [{ shop_id: 1, currency: 'LOCAL' }]);
  assert.strictEqual(result.details[0].sales, 1000);
  console.log('shopee shop BI tests: ok');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
