'use strict';

const assert = require('assert');
const { sumPerformance } = require('../src/metrics');
const {
  normalizeSourceAwarePerformance,
  sumGmsPerformance,
  sumSourceAwarePerformance,
} = require('../src/source-aware-metrics');
const { buildAnalysisPackage } = require('../src/analysis-package');

const day1 = {
  event_date: new Date('2026-09-21T00:00:00.000Z'), impressions: '167', clicks: '6', expense: '0.800000',
  broad_gmv: '61.000000', broad_orders: '1', broad_units: '1', direct_gmv: null,
  direct_orders: '1', direct_units: '1', direct_roas: '76.570000',
  raw_json: { report: { impression: 167, clicks: 6, expense: 0.8, broad_gmv: 61,
    broad_order: 1, broad_order_amount: 1, direct_order: 1, direct_order_amount: 1,
    broad_roi: 76.57, direct_roi: 76.57, broad_cir: 0.01, direct_cir: 0.01,
    cr: 0.17, direct_cr: 0.17, cpc: 79664, cpdc: 79664 } },
};
const p1 = normalizeSourceAwarePerformance(day1);
assert.strictEqual(p1.sourceFamily, 'GMS');
assert.strictEqual(p1.costPerConversion, 0.79664);
assert(Math.abs(p1.broadAcos - (0.79664 / 61)) < 1e-12);
assert.strictEqual(p1.directRoas, 76.57);
assert.strictEqual(p1.directGmv, null);

const day2 = {
  event_date: new Date('2026-09-22T00:00:00.000Z'), impressions: '20', clicks: '1', expense: '0.200000',
  broad_gmv: '0', broad_orders: '0', broad_units: '0', direct_gmv: null,
  direct_orders: '0', direct_units: '0', direct_roas: '0',
  raw_json: { report: { impression: 20, clicks: 1, expense: 0.2, broad_gmv: 0,
    broad_order: 0, broad_order_amount: 0, direct_order: 0, direct_order_amount: 0,
    broad_roi: 0, direct_roi: 0, broad_cir: 0, direct_cir: 0,
    cr: 0, direct_cr: 0, cpc: 0, cpdc: 0 } },
};
const total = sumGmsPerformance([day1, day2]);
const preciseSpend = 0.79664 + 0.2;
assert(Math.abs(total.sourcePrecisionExpense - preciseSpend) < 1e-12);
assert(Math.abs(total.broadRoas - (61 / preciseSpend)) < 1e-12);
assert(Math.abs(total.directRoas - ((76.57 * 0.79664) / preciseSpend)) < 1e-12);
assert.strictEqual(total.directGmv, null);
assert.strictEqual(total.directAcos, null);
assert.strictEqual(total.directRoasSourceComplete, true);

const pkg = buildAnalysisPackage({
  shop: { shopId: 1 }, campaign: { campaignId: 7 }, campaignDaily: [day1, day2], itemDaily: [],
  startDate: '2026-09-21', endDate: '2026-09-22', dataCutoff: '2026-09-22',
});
assert(Number.isFinite(pkg.deterministicMetrics.campaign.directRoas7d));
assert(Number.isFinite(pkg.deterministicMetrics.campaign.directRoas14d));
assert.strictEqual(pkg.deterministicMetrics.campaign.directRoas14d, total.directRoas);

const genericRows = [{ impressions: 100, clicks: 10, expense: 5, broad_gmv: 25, broad_orders: 2, direct_gmv: 20, direct_orders: 1 }];
assert.deepStrictEqual(sumSourceAwarePerformance(genericRows), sumPerformance(genericRows));
console.log('shopee source-aware metrics tests: ok');
