'use strict';

const assert = require('assert');
const { productAdDiagnosis } = require('../src/product-ads-diagnosis');

const lowVolume = productAdDiagnosis({
  adType: 'manual',
  performance: { broad_order: 5, expense: 100, broad_gmv: 700, clicks: 100, impression: 1000 },
  days: 7,
  targetRoas: 6,
  breakEvenRoas: 4,
  weeklyOrderReference: 25,
  itemCount: 1,
});
assert.strictEqual(lowVolume.volumeState, 'LOW_VOLUME');
assert.strictEqual(lowVolume.primarySignal, '订单样本不足');
assert.strictEqual(lowVolume.performance.broadRoas, 7);

const belowBreakEven = productAdDiagnosis({
  adType: 'manual',
  performance: { broad_order: 30, expense: 100, broad_gmv: 300, clicks: 200, impression: 2000 },
  days: 7,
  targetRoas: 5,
  breakEvenRoas: 4,
  weeklyOrderReference: 25,
  itemCount: 1,
});
assert.strictEqual(belowBreakEven.volumeState, 'MATURE_VOLUME');
assert.strictEqual(belowBreakEven.profitabilityState, 'BELOW_BREAK_EVEN');
assert.strictEqual(belowBreakEven.primarySignal, 'ROAS低于保本');

const autoStable = productAdDiagnosis({
  adType: 'auto',
  performance: { broad_order: 30, expense: 100, broad_gmv: 700 },
  days: 7,
  targetRoas: 6,
  weeklyOrderReference: 25,
  itemCount: 12,
});
assert.strictEqual(autoStable.targetState, 'MEETS_TARGET');
assert.strictEqual(autoStable.primarySignal, '结构相对稳定');
assert.strictEqual(autoStable.itemCount, 12);

console.log('shopee product ads diagnosis tests: ok');
