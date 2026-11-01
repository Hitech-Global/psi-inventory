'use strict';

/**
 * 平台无关中间模型测试。
 *
 * 重点覆盖两件事：
 *   1. 口径标记本身的自洽性；
 *   2. 跨口径计算被拒绝 —— 这是防止把混合归因的分子配纯付费以外的分母、
 *      得出错误 ROAS 的结构性保障。
 */

const assert = require('assert');
const {
  ATTRIBUTION_BASES,
  ATTRIBUTION_BASIS_VALUES,
  CHANNELS,
  CHANNEL_VALUES,
  PLATFORMS,
  PLATFORM_VALUES,
  assertSameBasis,
  averageOrderValue,
  canDivideAcrossBases,
  createFact,
  createMetric,
  incrementalRoas,
  netProceeds,
  settledNetRoas,
} = require('../src/platform-model');

// 枚举完整性
assert.strictEqual(ATTRIBUTION_BASIS_VALUES.length, 6);
assert.ok(ATTRIBUTION_BASIS_VALUES.includes(ATTRIBUTION_BASES.PAID_ONLY));
assert.ok(ATTRIBUTION_BASIS_VALUES.includes(ATTRIBUTION_BASES.DERIVED_INCREMENTAL));
assert.strictEqual(CHANNEL_VALUES.length, 5);
assert.strictEqual(PLATFORM_VALUES.length, 2);

// createMetric
const paidSpend = createMetric({
  platform: PLATFORMS.TIKTOK,
  attributionBasis: ATTRIBUTION_BASES.PAID_ONLY,
  value: 100,
  channel: CHANNELS.UNKNOWN,
});
assert.strictEqual(paidSpend.value, 100);
assert.strictEqual(paidSpend.attributionBasis, ATTRIBUTION_BASES.PAID_ONLY);

assert.throws(
  () => createMetric({ platform: 'shopee', attributionBasis: 'not-a-basis' }),
  /unknown attribution basis/,
);
assert.throws(
  () => createMetric({ platform: 'unknown-platform', attributionBasis: ATTRIBUTION_BASES.UNKNOWN }),
  /unknown platform/,
);
assert.throws(
  () => createMetric({
    platform: PLATFORMS.TIKTOK,
    attributionBasis: ATTRIBUTION_BASES.UNKNOWN,
    channel: 'not-a-channel',
  }),
  /unknown channel/,
);

// 非有限数值被归一为 null
assert.strictEqual(
  createMetric({ platform: PLATFORMS.TIKTOK, attributionBasis: ATTRIBUTION_BASES.UNKNOWN, value: NaN }).value,
  null,
);
assert.strictEqual(
  createMetric({ platform: PLATFORMS.TIKTOK, attributionBasis: ATTRIBUTION_BASES.UNKNOWN, value: Infinity }).value,
  null,
);

// 跨口径计算：允许与拒绝
const platformGmv = createMetric({
  platform: PLATFORMS.TIKTOK,
  attributionBasis: ATTRIBUTION_BASES.PLATFORM_ATTRIBUTED,
  value: 500,
});
const platformCost = createMetric({
  platform: PLATFORMS.TIKTOK,
  attributionBasis: ATTRIBUTION_BASES.PLATFORM_ATTRIBUTED,
  value: 100,
});
const paidCost = createMetric({
  platform: PLATFORMS.TIKTOK,
  attributionBasis: ATTRIBUTION_BASES.PAID_ONLY,
  value: 100,
});
const netValue = createMetric({
  platform: PLATFORMS.TIKTOK,
  attributionBasis: ATTRIBUTION_BASES.DERIVED_NET,
  value: 300,
});

// 同口径允许
assert.doesNotThrow(() => assertSameBasis(platformGmv, platformCost));
// 平台归因 ÷ 纯付费：允许（TikTok 平台 ROI 的语义）
assert.doesNotThrow(() => assertSameBasis(platformGmv, paidCost));
// 平台归因 ÷ 结算净收益：拒绝 —— 两个不同事实，相除没有意义
assert.throws(
  () => assertSameBasis(platformGmv, netValue),
  /refusing to combine attribution bases: platform_attributed \/ derived_net/,
);
// 结算净收益 ÷ 纯付费：允许（结算净 ROAS）
assert.doesNotThrow(() => assertSameBasis(netValue, paidCost));
// 结算净收益 ÷ 平台归因：拒绝
assert.throws(
  () => assertSameBasis(netValue, platformGmv),
  /refusing to combine attribution bases/,
);

// canDivideAcrossBases 与 assertSameBasis 判定一致
assert.strictEqual(canDivideAcrossBases(ATTRIBUTION_BASES.PAID_ONLY, ATTRIBUTION_BASES.PAID_ONLY), true);
assert.strictEqual(canDivideAcrossBases(ATTRIBUTION_BASES.DERIVED_NET, ATTRIBUTION_BASES.PLATFORM_ATTRIBUTED), false);

// 缺少度量或口径非法时报错
assert.throws(() => assertSameBasis(null, paidCost), /numerator metric is required/);
assert.throws(() => assertSameBasis(paidSpend, null), /denominator metric is required/);
assert.throws(
  () => assertSameBasis({ attributionBasis: 'nope' }, paidCost),
  /unknown attribution basis on numerator/,
);

// createFact：三个 GMV 口径各自独立
const tiktokFact = createFact({
  platform: PLATFORMS.TIKTOK,
  attributionBasis: ATTRIBUTION_BASES.PLATFORM_ATTRIBUTED,
  orders: 10,
  units: 12,
  gmvOrderTotal: 1200,
  gmvSubtotal: 1000,
  gmvSettled: 700,
  commission: 200,
  shipping: 100,
  refunds: 50,
  spend: 300,
  currency: 'USD',
});
assert.strictEqual(tiktokFact.gmvOrderTotal, 1200);
assert.strictEqual(tiktokFact.gmvSubtotal, 1000);
assert.strictEqual(tiktokFact.gmvSettled, 700);
assert.strictEqual(tiktokFact.currency, 'USD');

// 客单价用货款小计（不含运费），分子分母同源
assert.strictEqual(averageOrderValue(tiktokFact), 100);
assert.strictEqual(averageOrderValue({ orders: 0, gmvSubtotal: 100 }), null);
assert.strictEqual(averageOrderValue({ orders: 5 }), null);

// 净收益 = 结算收入 − 佣金 − 物流 − 退款
assert.strictEqual(netProceeds(tiktokFact), 700 - 200 - 100 - 50);
assert.strictEqual(netProceeds({ gmvSettled: null }), null);

// 结算净 ROAS = 净收益 / 广告费
assert.strictEqual(settledNetRoas(tiktokFact), (700 - 200 - 100 - 50) / 300);
assert.strictEqual(settledNetRoas({ gmvSettled: 100, spend: 0 }), null);

// 增量 ROAS = 增量 GMV / 纯付费花费
const incrementalFact = createFact({
  platform: PLATFORMS.TIKTOK,
  attributionBasis: ATTRIBUTION_BASES.DERIVED_INCREMENTAL,
  spend: 300,
  baselineNaturalGmv: 800,
  incrementalGmv: 250,
});
assert.strictEqual(incrementalRoas(incrementalFact), 250 / 300);
// 广告挤占自然量时增量为负，必须如实保留
const negativeFact = createFact({
  platform: PLATFORMS.TIKTOK,
  attributionBasis: ATTRIBUTION_BASES.DERIVED_INCREMENTAL,
  spend: 300,
  baselineNaturalGmv: 900,
  incrementalGmv: -120,
});
assert.strictEqual(incrementalRoas(negativeFact), -120 / 300);
// 没有增量数据时返回 null，而不是假装为 0
assert.strictEqual(incrementalRoas(tiktokFact), null);

// Shopee 侧保持兼容：直接与 broad 语义对应
const shopeeFact = createFact({
  platform: PLATFORMS.SHOPEE,
  attributionBasis: ATTRIBUTION_BASES.ORDER_LEVEL,
  channel: CHANNELS.BROAD,
  orders: 20,
  gmvSubtotal: 2000,
  spend: 500,
});
assert.strictEqual(averageOrderValue(shopeeFact), 100);

console.log('platform model tests passed');
