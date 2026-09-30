'use strict';

const assert = require('assert');
const {
  buildDailyAllocation,
  consecutiveOrderDays,
  classifyLearningOperation,
  buildLearningTimeline,
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
assert.strictEqual(leaderSwitchCount([]), null);

const sellerRoasReset = classifyLearningOperation({
  operationType:'CAMPAIGN_SETTING_CHANGE', actorType:'SELLER',
  before:{ targetRoas:8, campaignBudget:100 }, after:{ targetRoas:7, campaignBudget:100 },
  effectiveFrom:'2026-09-20T10:00:00Z',
});
assert.strictEqual(sellerRoasReset.eventType, 'TARGET_ROAS_CHANGE');
assert.strictEqual(sellerRoasReset.resetClass, 'CONFIRMED_RESET');
const systemBudgetChange = classifyLearningOperation({
  operationType:'CAMPAIGN_SETTING_CHANGE', actorType:'SHOPEE_SYSTEM',
  before:{ targetRoas:7, campaignBudget:100 }, after:{ targetRoas:7, campaignBudget:120 },
  effectiveFrom:'2026-09-21T10:00:00Z',
});
assert.strictEqual(systemBudgetChange.resetClass, 'SYSTEM_OPTIMIZATION');
const unknownRoasChange = classifyLearningOperation({
  operationType:'CAMPAIGN_SETTING_CHANGE',
  before:{ targetRoas:7 }, after:{ targetRoas:6.5 }, effectiveFrom:'2026-09-22T10:00:00Z',
});
assert.strictEqual(unknownRoasChange.resetClass, 'RESET_CANDIDATE');
const timeline = buildLearningTimeline([
  { operationType:'CAMPAIGN_SETTING_CHANGE', actorType:'SELLER', before:{ targetRoas:8 }, after:{ targetRoas:7 }, effectiveFrom:'2026-09-20T10:00:00Z' },
  { operationType:'CAMPAIGN_SETTING_CHANGE', actorType:'SHOPEE_SYSTEM', before:{ campaignBudget:100 }, after:{ campaignBudget:120 }, effectiveFrom:'2026-09-21T10:00:00Z' },
  { operationType:'CAMPAIGN_SETTING_CHANGE', before:{ targetRoas:7 }, after:{ targetRoas:6.5 }, effectiveFrom:'2026-09-22T10:00:00Z' },
]);
assert.strictEqual(timeline.latestConfirmedReset.resetClass, 'CONFIRMED_RESET');
assert.strictEqual(timeline.requiresSourceDisambiguation, true);

const campaignDaily = [
  { date:'2026-09-18', impression:200, clicks:20, expense:100, direct_order:3, direct_gmv:280 },
  { date:'2026-09-19', impression:200, clicks:20, expense:100, direct_order:4, direct_gmv:410 },
  { date:'2026-09-20', impression:200, clicks:20, expense:100, direct_order:3, direct_gmv:360 },
];
const comparisonCampaignDaily = [
  { date:'2026-09-15', impression:180, clicks:18, expense:90, direct_order:2, direct_gmv:180 },
  { date:'2026-09-16', impression:180, clicks:18, expense:90, direct_order:2, direct_gmv:180 },
  { date:'2026-09-17', impression:180, clicks:18, expense:90, direct_order:2, direct_gmv:180 },
];
const pkg = buildAnalysisPackage({
  shop:{ shopId:'s1', timezone:'Asia/Jakarta', country:'ID', brand:'Redragon', currency:'IDR' },
  campaign:{ campaignId:'c1', targetRoas:7, adSpendRatioLimit:0.15 },
  campaignDaily,
  comparisonCampaignDaily,
  comparisonPeriod:{ startDate:'2026-09-15', endDate:'2026-09-17', days:3 },
  itemDaily,
  itemBreakEvenMap:new Map([['1', 3.5], ['2', 4.5]]),
  recommendedRoiMap:new Map([['1', { exact:{ value:6.8, percentile:50 } }]]),
  weeklyOrderReference:25,
  operations:[],
  startDate:'2026-09-18',
  endDate:'2026-09-20',
  dataCutoff:'2026-09-20T23:59:59+07:00',
  triggerType:'DAILY_AUTO',
});
assert.strictEqual(pkg.schemaVersion, '1.0');
assert.strictEqual(pkg.trigger.type, 'DAILY_AUTO');
assert.strictEqual(pkg.deterministicMetrics.campaign.directOrders7d, 16);
assert.strictEqual(pkg.deterministicMetrics.maturity.observedDays7d, 6);
assert.strictEqual(pkg.deterministicMetrics.maturity.weeklyOrderReference, 25);
assert.strictEqual(pkg.deterministicMetrics.maturity.sampleMature, false);
assert.strictEqual(pkg.deterministicMetrics.campaign.leaderSwitchCount, 0);
assert.strictEqual(pkg.deterministicMetrics.campaign.currentWindow.directOrders, 10);
assert.strictEqual(pkg.deterministicMetrics.campaign.previousWindow.directOrders, 6);
assert.strictEqual(pkg.deterministicMetrics.campaign.windowComparison.changes.directOrders.absolute, 4);
assert.strictEqual(pkg.deterministicMetrics.campaign.economics.directRoasVsTarget, 'BELOW');
assert.strictEqual(pkg.deterministicMetrics.campaign.economics.requiredBroadRoasForSpendLimit, 1 / 0.15);
assert.strictEqual(pkg.items.find(x => x.itemId === '1').consecutiveOrderDays, 3);
assert.strictEqual(pkg.items.find(x => x.itemId === '1').gmvPerDirectOrder, 890 / 8);
assert.strictEqual(pkg.items.find(x => x.itemId === '1').breakEvenRoas, 3.5);
assert.strictEqual(pkg.items.find(x => x.itemId === '1').roasVsBreakEven, 'ABOVE');
assert.strictEqual(pkg.items.find(x => x.itemId === '1').recommendedRoas.exact.value, 6.8);
assert.strictEqual(pkg.items.find(x => x.itemId === '1').shares.directOrderShare, 0.8);
assert(pkg.deterministicMetrics.dailyAllocation.every(x => 'clickShare' in x && 'impressionShare' in x));
const noItemPkg = buildAnalysisPackage({
  shop:{ shopId:'s1', timezone:'Asia/Jakarta', country:'ID', brand:'Redragon', currency:'IDR' },
  campaign:{ campaignId:'c2', targetRoas:7 },
  campaignDaily,
  itemDaily:[],
  operations:[],
  startDate:'2026-09-18',
  endDate:'2026-09-20',
  dataCutoff:'2026-09-20T23:59:59+07:00',
  triggerType:'MANUAL',
});
assert.strictEqual(noItemPkg.deterministicMetrics.campaign.leaderSwitchCount, null);
assert.deepStrictEqual(noItemPkg.deterministicMetrics.dailyAllocation, []);

console.log('shopee analysis package tests: ok');
