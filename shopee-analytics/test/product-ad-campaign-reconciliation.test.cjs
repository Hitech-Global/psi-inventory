'use strict';

const assert = require('assert');
const {
  compareCampaignMetric,
  evaluateProductAdCampaignReconciliation,
} = require('../src/product-ad-campaign-reconciliation');

const expected = {
  impressions: 697,
  clicks: 36,
  broadOrders: 1,
  directOrders: 1,
  broadUnits: 1,
  directUnits: 1,
  broadGmv: 98,
  directGmv: 98,
  expense: 21.89,
  ctr: 0.0516,
  broadCvr: 0.0278,
  directCvr: 0.0278,
  broadRoas: 4.48,
  directRoas: 4.48,
  addToCart: 2,
  addToCartRate: 2 / 36,
  costPerConversion: 21.89,
  costPerDirectConversion: 21.89,
  cpc: 21.89 / 36,
  broadAcos: 21.89 / 98,
  directAcos: 21.89 / 98,
};

const actual = {
  impressions: 697,
  clicks: 36,
  broadOrders: 1,
  directOrders: 1,
  broadUnits: 1,
  directUnits: 1,
  broadGmv: 98,
  directGmv: 98,
  expense: 21.89,
  ctr: 0.0516,
  broadCvr: 0.0278,
  directCvr: 0.0278,
  broadRoas: 4.48,
  directRoas: 4.48,
  addToCart: null,
  addToCartRate: null,
  costPerConversion: 21.89,
  costPerDirectConversion: 21.89,
  cpc: 21.89 / 36,
  broadAcos: 21.89 / 98,
  directAcos: 21.89 / 98,
};

const unavailable = compareCampaignMetric({
  key: 'addToCart',
  label: 'Add To Cart',
  actual: null,
  expected: 2,
  tolerance: 0,
});
assert.strictEqual(unavailable.status, 'UNAVAILABLE');
assert.strictEqual(unavailable.actual, null);
assert.strictEqual(unavailable.pass, null);

const report = evaluateProductAdCampaignReconciliation({ actual, expected });
assert.strictEqual(report.status, 'INCOMPLETE');
assert.strictEqual(report.pass, false);
assert.strictEqual(report.complete, false);
assert.strictEqual(report.failedCount, 0);
assert.strictEqual(report.unavailableCount, 2);
assert.strictEqual(report.checks.find(row => row.key === 'ctr').status, 'PASS');
assert.strictEqual(report.checks.find(row => row.key === 'broadCvr').status, 'PASS');
assert.strictEqual(report.checks.find(row => row.key === 'directCvr').status, 'PASS');
assert.strictEqual(report.checks.find(row => row.key === 'addToCart').status, 'UNAVAILABLE');
assert.strictEqual(report.checks.find(row => row.key === 'addToCartRate').status, 'UNAVAILABLE');

const badRatio = evaluateProductAdCampaignReconciliation({
  actual: { ...actual, ctr: 0.000516 },
  expected,
});
assert.strictEqual(badRatio.status, 'FAIL');
assert.strictEqual(badRatio.failedCount, 1);
assert.strictEqual(badRatio.checks.find(row => row.key === 'ctr').status, 'FAIL');

const full = evaluateProductAdCampaignReconciliation({
  actual: { ...actual, addToCart: 2, addToCartRate: 2 / 36 },
  expected,
});
assert.strictEqual(full.status, 'PASS');
assert.strictEqual(full.pass, true);
assert.strictEqual(full.complete, true);
assert.strictEqual(full.failedCount, 0);
assert.strictEqual(full.unavailableCount, 0);

console.log('Product Ad campaign reconciliation status contract: ok');
