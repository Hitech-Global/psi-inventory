'use strict';

const assert = require('assert');
const {
  buildDailyAllocation,
  consecutiveOrderDays,
  leaderSwitchCount,
  buildAnalysisPackage,
} = require('../src/analysis-package');

const itemDaily = [
  { date:'2026-09-18', item_id:1, impression:60, clicks:12, expense:60, direct_order:2, direct_gmv:200 },
  { date:'2026-09-18', item_id:2, impression:40, clicks:8, expense:40, direct_order:1, direct_gmv:80 },
  { date:'2026-09-19', item_id:1, impression:70, clicks:14, expense:70, direct_order:3, direct_gmv:330 },
  { date:'2026-09-19', item_id:2, impression:30, clicks:6, expense:30, direct_order:1, direct_gmv:80 },
  { date:'2026-09-20', item_id:1, impression:75, clicks:15, expense:75, direct_order:3, direct_gmv:360 },
  { date:'2026-09-20', item_id:2, impression:25, clicks:5, expense:25, direct_order:0, direct_gmv:0 },
];
const allocation = buildDailyAllocation(itemDaily);
assert.strictEqual(allocation.length, 6);
assert.strictEqual(allocation.find(r => r.date === '2026-09-20' && r.itemId === '1').spendShare, 0.75);
assert.strictEqual(allocation.find(r => r.date === '2026-09-20' && r.itemId === '1').directOrderShare, 1);
assert.strictEqual(consecutiveOrderDays(itemDaily.filter(r => r.item_id === 1), '2026-09-20'), 3);
assert.strictEqual(leaderSwitchCount(allocation), 0);

const campaignDaily = [
  { date:'2026-09-18', clicks:20, expense:100, direct_order:3, direct_gmv:280 },
  { date:'2026-09-19', clicks:20, expense:100, direct_order:4, direct_gmv:410 },
  { date:'2026-09-20', clicks:20, expense:100, direct_order:3, direct_gmv:360 },
];
const pkg = buildAnalysisPackage({
  shop:{ shopId:'s1', timezone:'Asia/Jakarta', country:'ID', brand:'Redragon', currency:'IDR' },
  campaign:{ campaignId:'c1', targetRoas:7 },
  campaignDaily,
  itemDaily,
  operations:[],
  startDate:'2026-09-18',
  endDate:'2026-09-20',
  dataCutoff:'2026-09-20T23:59:59+07:00',
  triggerType:'DAILY_AUTO',
});
assert.strictEqual(pkg.schemaVersion, '1.0');
assert.strictEqual(pkg.trigger.type, 'DAILY_AUTO');
assert.strictEqual(pkg.deterministicMetrics.campaign.directOrders7d, 10);
assert.strictEqual(pkg.deterministicMetrics.campaign.leaderSwitchCount, 0);
assert.strictEqual(pkg.items.find(x => x.itemId === '1').consecutiveOrderDays, 3);
assert.strictEqual(pkg.items.find(x => x.itemId === '1').gmvPerDirectOrder, 890 / 8);
assert(pkg.deterministicMetrics.dailyAllocation.every(x => 'clickShare' in x && 'impressionShare' in x));

console.log('shopee analysis package tests: ok');
