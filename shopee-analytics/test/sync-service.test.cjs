'use strict';

const assert = require('assert');
const { ShopeeSyncService, requireRole } = require('../src/sync-service');

assert.throws(() => requireRole({}, 'ADS'), /Missing configured Shopee role client/);

const promotionWrites = [];
const rawWrites = [];
const roleClients = {
  STORE_OPS: {
    accessToken: 'token',
    client: {
      async shopRequest(req) {
        if (req.path.includes('get_voucher_list')) {
          return { response: { more: false, voucher_list: [{ voucher_id: 10 }] } };
        }
        if (req.path.endsWith('/get_voucher')) {
          return { response: { voucher_id: 10, voucher_name: 'Test', item_id_list: [101] } };
        }
        if (req.path.includes('get_discount_list')) {
          return { response: { more: false, discount_list: [{ discount_id: 20 }] } };
        }
        if (req.path.endsWith('/get_discount')) {
          return {
            response: {
              discount_id: 20,
              discount_name: 'D',
              status: 'ongoing',
              more: false,
              item_list: [{ item_id: 101, item_promotion_price: 100 }],
            },
          };
        }
        throw new Error(`unexpected path: ${req.path}`);
      },
    },
  },
};

const service = new ShopeeSyncService({
  shopId: 1,
  roleClients,
  rawRepository: {
    async insertRawSnapshot(input) { rawWrites.push(input); },
  },
  promotionRepository: {
    async upsertVoucher(input) { promotionWrites.push({ type: 'voucher', ...input }); },
    async upsertDiscount(input) { promotionWrites.push({ type: 'discount', ...input }); },
  },
});

(async () => {
  const result = await service.syncPromotions();
  assert.deepStrictEqual(result, { voucherCount: 1, discountCount: 1 });
  assert.strictEqual(promotionWrites.length, 2);
  assert(rawWrites.length >= 4);
  console.log('shopee sync service tests: ok');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
