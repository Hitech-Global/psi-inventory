'use strict';

/**
 * 增量 GMV 基线采集测试。
 *
 * 重点覆盖三个现实问题：
 *   1. 自然 GMV 会波动 → 基线用滚动窗口均值，不是当天值；
 *   2. 广告挤占自然量时增量为负 → 必须如实保留；
 *   3. 直播 GMV 无法按商品拆分 → 有直播的日子该商品基线标为不可用，而不是猜分配比例。
 */

const assert = require('assert');
const {
  DEFAULT_BASELINE_WINDOW_DAYS,
  LIVE_PERFORMANCE_PATH,
  SKU_PERFORMANCE_PATH,
  TikTokBaselineCollector,
  buildBaselineSeries,
  computeIncrementalByProduct,
  computeNonLiveGmv,
  extractLiveGmv,
  extractSkuGmv,
  readAmount,
  readCurrency,
} = require('../src/tiktok-baseline-collector');

// ---- 金额读取：两种形态都要支持 ----

assert.strictEqual(readAmount('135.42'), 135.42);
assert.strictEqual(readAmount(135.42), 135.42);
assert.strictEqual(readAmount({ amount: '135.42', currency: 'USD' }), 135.42);
assert.strictEqual(readAmount({ amount: '' }), null);
assert.strictEqual(readAmount(null), null);
assert.strictEqual(readAmount('abc'), null);
assert.strictEqual(readCurrency({ amount: '1', currency: 'MYR' }), 'MYR');
assert.strictEqual(readCurrency(null), null);

// ---- SKU 级 GMV 提取 ----

const skuExtracted = extractSkuGmv({
  skus: [
    { id: 1, product_id: 100, gmv: { amount: '100.00', currency: 'MYR' }, sku_orders: 2, units_sold: 3 },
    { id: 2, product_id: 100, gmv: { amount: '50.00', currency: 'MYR' }, sku_orders: 1, units_sold: 1 },
    { id: 3, product_id: 200, gmv: { amount: '80.00', currency: 'MYR' }, sku_orders: 1, units_sold: 1 },
  ],
});
// 同一商品的多个 SKU 要累加
assert.strictEqual(skuExtracted.skuGmvByProduct.get('100'), 150);
assert.strictEqual(skuExtracted.skuGmvByProduct.get('200'), 80);
assert.strictEqual(skuExtracted.skuOrdersByProduct.get('100'), 3);
assert.strictEqual(skuExtracted.currency, 'MYR');

// 缺 product_id 的记录要跳过（无法归属到商品）
const skipped = extractSkuGmv({ skus: [{ id: 1, gmv: { amount: '10' } }] });
assert.strictEqual(skipped.skuGmvByProduct.size, 0);

// ---- 直播 GMV 提取 ----

const liveExtracted = extractLiveGmv({
  live_stream_sessions: [
    { sales_performance: { live_gmv: { amount: '300.00', currency: 'MYR' }, live_attributed_orders: 5 } },
    { sales_performance: { live_gmv: { amount: '200.00', currency: 'MYR' }, live_attributed_orders: 3 } },
  ],
});
assert.strictEqual(liveExtracted.liveGmv, 500);
assert.strictEqual(liveExtracted.liveOrders, 8);
assert.strictEqual(liveExtracted.currency, 'MYR');

// 没有直播场次 → liveGmv 为 null（不是 0，避免"没直播"与"直播GMV为0"混淆）
assert.strictEqual(extractLiveGmv({ live_stream_sessions: [] }).liveGmv, null);
assert.strictEqual(extractLiveGmv({}).liveGmv, null);

// ---- 非直播 GMV 计算 ----

// 无直播：SKU GMV 全部是非直播的
const noLive = computeNonLiveGmv({
  skuGmvByProduct: new Map([['100', 150]]),
  liveGmv: null,
});
assert.strictEqual(noLive.hasLive, false);
assert.strictEqual(noLive.byProduct.get('100'), 150);

// 有直播：直播 GMV 无法拆到商品 → 该商品基线不可用
const withLive = computeNonLiveGmv({
  skuGmvByProduct: new Map([['100', 150]]),
  liveGmv: 300,
});
assert.strictEqual(withLive.hasLive, true);
assert.strictEqual(withLive.byProduct.size, 0, '有直播时不得猜商品级分配');
assert.strictEqual(withLive.liveGmv, 300);

// ---- 基线序列 ----

const dailyRecords = [
  { date: '2026-10-20', byProduct: new Map([['100', 100]]) },
  { date: '2026-10-21', byProduct: new Map([['100', 200]]) },
  { date: '2026-10-22', byProduct: new Map([['100', 300]]) },
];
const series = buildBaselineSeries({ dailyRecords, windowDays: 14 });
assert.strictEqual(series.get('100').length, 3);
assert.strictEqual(series.get('100').join(','), '100,200,300');

// 窗口只保留最近 N 天
const windowed = buildBaselineSeries({ dailyRecords, windowDays: 2 });
assert.strictEqual(windowed.get('100').length, 2);
assert.strictEqual(windowed.get('100').join(','), '200,300', '窗口应保留最近的天数');

// ---- 增量计算 ----

// 基线均值 = (100+200+300)/3 = 200，归因 500 → 增量 300
const incremental = computeIncrementalByProduct({
  attributedGmvByProduct: new Map([['100', 500]]),
  baselineSeries: series,
});
assert.strictEqual(incremental.length, 1);
assert.strictEqual(incremental[0].productId, '100');
assert.strictEqual(incremental[0].baselineNaturalGmv, 200);
assert.strictEqual(incremental[0].incrementalGmv, 300);
assert.strictEqual(incremental[0].baselineSampleDays, 3);

// 负增量必须保留（广告挤占自然量）
const negative = computeIncrementalByProduct({
  attributedGmvByProduct: new Map([['100', 100]]),
  baselineSeries: series,
});
assert.strictEqual(negative[0].incrementalGmv, -100);
assert.ok(negative[0].incrementalGmv < 0, '负增量不得被抹平');

// 没有基线时不得编造增量
const noBaseline = computeIncrementalByProduct({
  attributedGmvByProduct: new Map([['999', 500]]),
  baselineSeries: series,
});
assert.strictEqual(noBaseline[0].baselineNaturalGmv, null);
assert.strictEqual(noBaseline[0].incrementalGmv, null);
assert.strictEqual(noBaseline[0].baselineSampleDays, 0);

// ---- 采集器 ----

assert.strictEqual(DEFAULT_BASELINE_WINDOW_DAYS, 14);
assert.strictEqual(SKU_PERFORMANCE_PATH, '/analytics/202509/shop_skus/performance');
assert.strictEqual(LIVE_PERFORMANCE_PATH, '/analytics/202609/shop_lives/performance');

(async () => {
  const calls = [];
  const fakeClient = {
    async request({ path, query }) {
      calls.push({ path, query });
      if (path === SKU_PERFORMANCE_PATH) {
        return {
          skus: [
            { id: 1, product_id: 100, gmv: { amount: '400.00', currency: 'MYR' }, sku_orders: 4 },
          ],
          next_page_token: '',
        };
      }
      if (path === LIVE_PERFORMANCE_PATH) {
        return {
          live_stream_sessions: [
            { sales_performance: { live_gmv: { amount: '0.00', currency: 'MYR' } } },
          ],
        };
      }
      throw new Error(`unexpected path ${path}`);
    },
  };

  const collector = new TikTokBaselineCollector({ client: fakeClient });
  const daily = await collector.collectDailyNonLiveGmv({
    accessToken: 'T', shopCipher: 'C', date: '2026-11-01',
  });
  assert.strictEqual(daily.date, '2026-11-01');
  assert.strictEqual(daily.byProduct.get('100'), 400);
  assert.strictEqual(daily.hasLive, false);
  assert.strictEqual(daily.currency, 'MYR');

  // 端点参数：左闭右开，且带 shop_cipher
  const skuCall = calls.find(call => call.path === SKU_PERFORMANCE_PATH);
  assert.strictEqual(skuCall.query.start_date_ge, '2026-11-01');
  assert.strictEqual(skuCall.query.end_date_lt, '2026-11-02', '左闭右开：次日为右边界');

  // 采集窗口：按日期倒序逐日采集，最后一天是 endDate
  calls.length = 0;
  const collected = await collector.collectBaseline({
    accessToken: 'T', shopCipher: 'C', endDate: '2026-11-02', windowDays: 3,
  });
  assert.strictEqual(collected.dailyRecords.length, 3);
  assert.strictEqual(collected.dailyRecords[0].date, '2026-10-31');
  assert.strictEqual(collected.dailyRecords[2].date, '2026-11-02');
  assert.strictEqual(collected.series.get('100').length, 3);

  console.log('tiktok baseline collector tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
