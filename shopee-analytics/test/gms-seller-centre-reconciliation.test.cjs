'use strict';

const assert = require('assert');
const {
  parseGmsSellerCentreFile,
  reconcileGmsCampaign,
} = require('../src/gms-seller-centre-reconciliation');

const csv = `商店全站推广\n用户名称,tester\n商店名称,Test Shop\n商店ID,1770037299\n报告创建时间,2026/09/27 13:41\n时间,2026/09/21 - 2026/09/21\n\n排序,商品名称,商品编号,展示次数,点击数,点击率,转化,直接转化,转化率,直接转化率,每转化成本,每一直接转化的成本,商品已出售,直接已售商品,销售金额,直接销售金额,花费,广告支出回报率,直接广告支出回报率,广告销售成本,直接广告销售成本,Voucher Amount,Vouchered Sales\n1,商店全站推广,-,100,10,10.00%,2,1,20.00%,10.00%,10.00,20.00,2,1,200.00,100.00,20.00,10.00,5.00,10.00%,20.00%,5.00,100.00\n2,Item A,11,60,6,10.00%,1,1,16.67%,16.67%,10.00,10.00,1,1,100.00,100.00,10.00,10.00,10.00,10.00%,10.00%,5.00,100.00\n3,Item B,22,40,4,10.00%,1,0,25.00%,0.00%,10.00,0.00,1,0,100.00,0.00,10.00,10.00,0.00,10.00%,0.00%,0.00,0.00\n`;

const seller = parseGmsSellerCentreFile({ buffer: Buffer.from(csv), filename: 'gms.csv' });
assert.strictEqual(seller.shopId, 1770037299);
assert.strictEqual(seller.eventDate, '2026-09-21');
assert.strictEqual(seller.items.length, 2);
assert.strictEqual(seller.summary.impressions, 100);
assert.strictEqual(seller.summary.directGmv, 100);
assert.strictEqual(seller.summary.ctr, 0.1);
assert(seller.childSumChecks.every(row => row.status === 'PASS'));

const apiCampaign = {
  impressions: 100,
  clicks: 10,
  expense: 20,
  broad_gmv: 200,
  broad_orders: 2,
  broad_units: 2,
  direct_gmv: null,
  direct_roas: 5,
  direct_orders: 1,
  direct_units: 1,
  broad_roas: 10,
};
const apiItems = [
  { item_id: 11, impressions: 60, clicks: 6, broad_orders: 1, direct_orders: 1, broad_units: 1, direct_units: 1, broad_gmv: 100, direct_gmv: 100, expense: 10, direct_roas: 10 },
  { item_id: 22, impressions: 40, clicks: 4, broad_orders: 1, direct_orders: 0, broad_units: 1, direct_units: 0, broad_gmv: 100, direct_gmv: 0, expense: 10, direct_roas: 0 },
];

const result = reconcileGmsCampaign({ sellerReport: seller, apiCampaign, apiItems });
assert.strictEqual(result.status, 'INCOMPLETE', 'Voucher metrics are not present in the GMS Ads API contract');
assert.strictEqual(result.itemCoverage.status, 'PASS');
assert.strictEqual(result.itemCoverage.apiCount, 2);
assert.strictEqual(result.itemDirectGmvAggregate.available, true);
assert.strictEqual(result.itemDirectGmvAggregate.value, 100);
assert(result.itemChecks.every(row => row.status === 'PASS'));
const directGmv = result.checks.find(row => row.field === 'directGmv');
assert.strictEqual(directGmv.status, 'PASS');
assert.strictEqual(directGmv.provenance, 'GMS_ITEM_API_AGGREGATE');
const voucher = result.checks.find(row => row.field === 'voucherAmount');
assert.strictEqual(voucher.status, 'SOURCE_UNAVAILABLE');

const wrongItems = apiItems.map(row => ({ ...row }));
wrongItems[0].clicks = 5;
const wrong = reconcileGmsCampaign({ sellerReport: seller, apiCampaign, apiItems: wrongItems });
assert.strictEqual(wrong.status, 'FAIL');
assert.strictEqual(wrong.itemChecks.find(row => row.itemId === 11).status, 'FAIL');

const incompleteItems = apiItems.map(row => ({ ...row }));
incompleteItems[1].direct_gmv = null;
const incomplete = reconcileGmsCampaign({ sellerReport: seller, apiCampaign, apiItems: incompleteItems });
assert.strictEqual(incomplete.status, 'INCOMPLETE');
assert.strictEqual(incomplete.itemDirectGmvAggregate.available, false);
assert.strictEqual(incomplete.checks.find(row => row.field === 'directGmv').status, 'SOURCE_UNAVAILABLE');

assert.throws(
  () => parseGmsSellerCentreFile({
    buffer: Buffer.from(csv.replace('3,Item B,22,40,4', '3,Item B,22,39,4')),
    filename: 'bad.csv',
  }),
  /child rows do not reconcile/,
);

console.log('shopee GMS Seller Centre reconciliation tests: ok');
