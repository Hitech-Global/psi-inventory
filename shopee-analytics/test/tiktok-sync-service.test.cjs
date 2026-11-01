'use strict';

/**
 * TikTok adapter 与同步服务测试。
 *
 * 重点覆盖口径正确性 —— 这是整个 TikTok 接入最容易出错的地方：
 *   1. GMV Max 的 GMV/订单/ROI **含自然流量**，必须标 platform_attributed；
 *   2. 整合报表是**纯付费**，必须标 paid_only；
 *   3. 订单侧**无流量来源**，channel 必须是 unknown；
 *   4. 三个 GMV 口径互不推导；
 *   5. 增量 GMV 的基线是滚动窗口，负增量如实保留；
 *   6. 报表时间窗不得超过 30 天。
 */

const assert = require('assert');
const {
  buildIncrementalFact,
  mapGmvMaxRow,
  mapIntegratedRow,
  mapOrder,
  mapStatementRow,
} = require('../src/platforms/tiktok-adapter');
const {
  ATTRIBUTION_BASES,
  CHANNELS,
  PLATFORMS,
  TikTokSyncService,
  daysInclusive,
  splitDateRange,
} = require('../src/tiktok-sync-service');

// ---- 订单映射 ----

const order = mapOrder({
  order: {
    currency: 'MYR',
    status: 'COMPLETED',
    payment: {
      total_amount: '120.00',
      sub_total: '100.00',
      shipping_fee: '20.00',
    },
    line_items: [
      { quantity: 2 },
      { quantity: 1 },
    ],
  },
});
assert.strictEqual(order.platform, PLATFORMS.TIKTOK);
assert.strictEqual(order.attributionBasis, ATTRIBUTION_BASES.ORDER_LEVEL);
assert.strictEqual(order.channel, CHANNELS.UNKNOWN, '订单级无流量来源，必须是 unknown');
assert.strictEqual(order.orders, 1);
assert.strictEqual(order.units, 3);
assert.strictEqual(order.gmvOrderTotal, 120);
assert.strictEqual(order.gmvSubtotal, 100);
assert.strictEqual(order.gmvSettled, null, '结算收入不来自订单');
assert.strictEqual(order.shipping, 20);
assert.strictEqual(order.currency, 'MYR');

// 已取消的订单要标记出来
assert.strictEqual(mapOrder({ order: { status: 'CANCELLED' } }).cancellations, 1);

// ---- GMV Max 映射：混合归因 ----

const gmvMax = mapGmvMaxRow({
  metrics: {
    cost: '100',
    orders: '10',
    gross_revenue: '600',
    roi: '6',
    product_impressions: '5000',
    product_clicks: '250',
  },
  dimensions: { currency: 'MYR' },
});
assert.strictEqual(gmvMax.attributionBasis, ATTRIBUTION_BASES.PLATFORM_ATTRIBUTED);
assert.strictEqual(gmvMax.spend, 100);
assert.strictEqual(gmvMax.gmvOrderTotal, 600);
assert.strictEqual(gmvMax.orders, 10);
assert.strictEqual(gmvMax.impressions, 5000);
assert.strictEqual(gmvMax.clicks, 250);
assert.strictEqual(gmvMax.currency, 'MYR');
// 混合归因的 GMV 绝不能标成订单级或纯付费
assert.notStrictEqual(gmvMax.attributionBasis, ATTRIBUTION_BASES.ORDER_LEVEL);
assert.notStrictEqual(gmvMax.attributionBasis, ATTRIBUTION_BASES.PAID_ONLY);

// ---- 整合报表映射：纯付费 ----

const integrated = mapIntegratedRow({
  metrics: { spend: '100', impressions: '5000', clicks: '250', conversions: '10' },
  dimensions: { currency: 'MYR' },
});
assert.strictEqual(integrated.attributionBasis, ATTRIBUTION_BASES.PAID_ONLY);
assert.strictEqual(integrated.spend, 100);
assert.strictEqual(integrated.clicks, 250);
assert.strictEqual(integrated.gmvOrderTotal, null, '纯付费报表没有 GMV');
assert.strictEqual(integrated.gmvSubtotal, null);
assert.strictEqual(integrated.gmvSettled, null);

// 两种口径的 spend 可以比较；跨来源混算必须被拒绝。
const { assertSameBasis } = require('../src/platform-model');
assert.doesNotThrow(() => assertSameBasis(integrated, integrated));
// 同源（GMV Max 报表内）：混合归因的 GMV ÷ 同表的花费 = 平台面板上的 ROI，成立
assert.doesNotThrow(
  () => assertSameBasis(gmvMax, { ...integrated, source: gmvMax.source }),
  '同一张 GMV Max 报表内的 ROI 计算必须允许',
);
// 跨来源：GMV Max 的 GMV ÷ 整合报表的 spend，两者覆盖不同广告活动，无意义
assert.throws(
  () => assertSameBasis(gmvMax, integrated),
  /different sources/,
  '跨报表混算必须被拒绝',
);
// 混合归因的 GMV 与结算净收益是两个不同事实（结算事实的定义在下方，断言放在那里）

// ---- 结算流水映射 ----

const statement = mapStatementRow({
  row: {
    revenue_amount: '700',
    commission: '200',
    affiliate_commission: '50',
    shipping_fee: '100',
    refund_amount: '30',
    currency: 'MYR',
  },
});
assert.strictEqual(statement.attributionBasis, ATTRIBUTION_BASES.DERIVED_NET);
assert.strictEqual(statement.gmvSettled, 700);
assert.strictEqual(statement.commission, 250, '平台佣金与达人佣金都要扣');
assert.strictEqual(statement.shipping, 100);
assert.strictEqual(statement.refunds, 30);

// 净收益 = 结算收入 − 佣金 − 物流 − 退款 = 700 − 250 − 100 − 30 = 320
const { netProceeds } = require('../src/platform-model');
assert.strictEqual(netProceeds(statement), 320);

// 混合归因的 GMV 与结算净收益是两个不同事实，相除没有意义
assert.throws(
  () => assertSameBasis(gmvMax, statement),
  /refusing to combine attribution bases/,
);

// ---- 增量 GMV ----

// 基线序列的均值
const incremental = buildIncrementalFact({
  attributedGmv: 600,
  baselineSeries: [400, 500, 600],
  windowSize: 14,
});
assert.strictEqual(incremental.attributionBasis, ATTRIBUTION_BASES.DERIVED_INCREMENTAL);
assert.strictEqual(incremental.baselineNaturalGmv, 500);
assert.strictEqual(incremental.incrementalGmv, 100);

// 只取最近 windowSize 天
const windowed = buildIncrementalFact({
  attributedGmv: 600,
  baselineSeries: [100, 200, 300, 400, 500, 600],
  windowSize: 3,
});
assert.strictEqual(windowed.baselineNaturalGmv, 500, '基线只用最近 3 天');
assert.strictEqual(windowed.incrementalGmv, 100);

// 负增量必须如实保留（广告挤占自然量）
// 基线 = (900+800+700)/3 = 800，增量 = 300 − 800 = −500
const negative = buildIncrementalFact({
  attributedGmv: 300,
  baselineSeries: [900, 800, 700],
});
assert.strictEqual(negative.baselineNaturalGmv, 800);
assert.strictEqual(negative.incrementalGmv, -500);
assert.ok(negative.incrementalGmv < 0, '负增量不得被抹平');

// 没有基线时不得编造增量
const noBaseline = buildIncrementalFact({ attributedGmv: 600, baselineSeries: [] });
assert.strictEqual(noBaseline.baselineNaturalGmv, null);
assert.strictEqual(noBaseline.incrementalGmv, null);

// ---- 时间窗拆分 ----

assert.strictEqual(daysInclusive('2026-11-01', '2026-11-01'), 1);
assert.strictEqual(daysInclusive('2026-11-01', '2026-11-30'), 30);
assert.strictEqual(daysInclusive('2026-11-30', '2026-11-01'), 0);

const withinLimit = splitDateRange('2026-11-01', '2026-11-30', 30);
assert.strictEqual(withinLimit.length, 1);
assert.strictEqual(withinLimit[0].startDate, '2026-11-01');
assert.strictEqual(withinLimit[0].endDate, '2026-11-30');

// 超过 30 天必须拆窗，每窗不超过 30 天
// 2026-10-01 .. 2026-11-30 共 61 天 → 30 + 30 + 1 = 3 窗
const windows = splitDateRange('2026-10-01', '2026-11-30', 30);
assert.strictEqual(windows.length, 3);
for (const window of windows) {
  assert.ok(daysInclusive(window.startDate, window.endDate) <= 30, '每窗不得超过 30 天');
}
assert.strictEqual(windows[0].startDate, '2026-10-01');
assert.strictEqual(windows[0].endDate, '2026-10-30');
assert.strictEqual(windows[1].startDate, '2026-10-31');
assert.strictEqual(windows[1].endDate, '2026-11-29');
assert.strictEqual(windows[2].startDate, '2026-11-30');
assert.strictEqual(windows[2].endDate, '2026-11-30');
// 拆窗后不能有空洞或重叠
assert.strictEqual(
  windows.reduce((sum, w) => sum + daysInclusive(w.startDate, w.endDate), 0),
  daysInclusive('2026-10-01', '2026-11-30'),
);

// ---- 同步服务：区域组 ----

const service = new TikTokSyncService({
  pool: { async query() { return { rows: [] }; } },
  env: { TIKTOK_REGION_GROUP: 'ROW' },
});
assert.strictEqual(service.regionGroup(), 'ROW');
assert.throws(
  () => new TikTokSyncService({
    pool: { async query() { return { rows: [] }; } },
    env: { TIKTOK_REGION_GROUP: 'EU' },
  }).regionGroup(),
  /must be ROW or US/,
);

console.log('tiktok adapter and sync service tests passed');
