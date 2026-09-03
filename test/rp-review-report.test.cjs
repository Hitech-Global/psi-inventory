/**
 * 「订单预测 → 库存周转复盘报告 V1」回归测试
 *
 * 设计：HERMETIC / 自包含（不依赖 DOM、数据库、网络、server.js）。
 *   - fixture 严格镜像 app.js 页面视图模型的构造式（loadRp 的 _totalC /
 *     loadRpChannelMonthly 的 _channelC），确保「报告 = 页面」同源断言有意义。
 *   - 覆盖 18 项验收清单 + 关键红线（无 AI、无重算、无副作用、趋势不回流）。
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const R = require('../assets/rp-review-report');

// ==================== 视图模型 fixture（镜像 app.js，不改算法，只复刻构造式）====================
// 镜像 app.js:7353-7383 loadRp() 的 _totalC 构造
function makeTotalC(o) {
  const avail = o.available_qty || 0;
  const transit = o.in_transit_qty || 0;
  const piUnshipped = o.pi_confirmed_unshipped_qty || 0;
  const pool = (o.total_inventory_pool != null) ? o.total_inventory_pool : (avail + transit + piUnshipped);
  const taPeriod = o.avg_sales_period || 0;
  const sq = o.suggested_qty || 0;
  const po = o.po_unconfirmed_pi_qty || 0;
  const c = {};
  c.oaPeriod = o.online_avg_sales_period || 0;
  c.ofaPeriod = o.offline_avg_sales_period || 0;
  c.taPeriod = taPeriod;
  c.pool = pool;
  c.ct = taPeriod > 0 ? Math.round(pool / taPeriod * 10) / 10 : 0;
  c.ot = o.online_target_turnover != null ? o.online_target_turnover : 2;
  c.oft = o.offline_target_turnover != null ? o.offline_target_turnover : 2;
  c.os = o.online_target_stock || 0;
  c.ofs = o.offline_target_stock || 0;
  c.ots = o.other_target_stock || 0;
  c.sq = sq;
  c.po = po;
  c.availTurnover = taPeriod > 0 ? Math.round(avail / taPeriod * 10) / 10 : null;
  c.transitTurnover = taPeriod > 0 ? Math.round((avail + transit) / taPeriod * 10) / 10 : null;
  c.afterOrderTurnover = taPeriod > 0 ? Math.round((pool + po + sq) / taPeriod * 10) / 10 : null;
  c.piUnshipped = piUnshipped;
  c.monthly = {};
  return c;
}

// 镜像 app.js:8240-8336 loadRpChannelMonthly() 的 _channelC 构造
function makeChannelC(o, isOnline, effectiveQtyOverride) {
  const c = {};
  c.salesM1 = isOnline ? (o.online_sales_m1 || 0) : (o.offline_sales_m1 || 0);
  c.salesM2 = isOnline ? (o.online_sales_m2 || 0) : (o.offline_sales_m2 || 0);
  c.salesM3 = isOnline ? (o.online_sales_m3 || 0) : (o.offline_sales_m3 || 0);
  c.salesM4 = isOnline ? (o.online_sales_m4 || 0) : (o.offline_sales_m4 || 0);
  c.avgSalesPeriod = isOnline ? (o.online_avg_sales_period || 0) : (o.offline_avg_sales_period || 0);
  c.targetTurn = isOnline
    ? (o.online_target_turnover != null ? o.online_target_turnover : 2)
    : (o.offline_target_turnover != null ? o.offline_target_turnover : 2);
  c.targetStock = isOnline ? (o.online_target_stock || 0) : (o.offline_target_stock || 0);
  // 渠道分摊库存池（测试直接给定，等价于页面 poolAllocatedPeriod）
  c.poolAllocatedPeriod = o.pool_allocated_period != null ? o.pool_allocated_period : 0;
  c.suggestedQty = isOnline ? (o.online_suggested_qty || 0) : (o.offline_suggested_qty || 0);
  const effQty = (effectiveQtyOverride !== undefined) ? effectiveQtyOverride : c.suggestedQty;
  c.currentTurn = c.avgSalesPeriod > 0
    ? Math.round(c.poolAllocatedPeriod / c.avgSalesPeriod * 10) / 10
    : '无销量';
  // 镜像 app.js:7208 rpComputeChannelAfterOrderTurnover
  c.afterOrderTurnover = c.avgSalesPeriod > 0
    ? Math.round((c.poolAllocatedPeriod + effQty) / c.avgSalesPeriod * 10) / 10
    : null;
  return c;
}

function makeRow(o) {
  const row = {
    id: o.id || 'rs-1',
    sku_code: o.sku_code || 'SKU-A',
    model: o.model || 'M1',
    brand: o.brand || 'Redragon',
    country: o.country || 'Indonesia',
    target_warehouse: o.target_warehouse || 'Jakarta',
    // inventory / pool
    available_qty: o.available_qty || 0,
    in_transit_qty: o.in_transit_qty || 0,
    pi_confirmed_unshipped_qty: o.pi_confirmed_unshipped_qty || 0,
    po_unconfirmed_pi_qty: o.po_unconfirmed_pi_qty || 0,
    total_inventory_pool: o.total_inventory_pool != null ? o.total_inventory_pool : null,
    // sales
    sales_m1: o.sales_m1 || 0, sales_m2: o.sales_m2 || 0,
    sales_m3: o.sales_m3 || 0, sales_m4: o.sales_m4 || 0,
    avg_sales_period: o.avg_sales_period || 0,
    online_avg_sales_period: o.online_avg_sales_period || 0,
    offline_avg_sales_period: o.offline_avg_sales_period || 0,
    online_sales_m1: o.online_sales_m1 || 0, online_sales_m2: o.online_sales_m2 || 0,
    online_sales_m3: o.online_sales_m3 || 0, online_sales_m4: o.online_sales_m4 || 0,
    offline_sales_m1: o.offline_sales_m1 || 0, offline_sales_m2: o.offline_sales_m2 || 0,
    offline_sales_m3: o.offline_sales_m3 || 0, offline_sales_m4: o.offline_sales_m4 || 0,
    // suggestion
    suggested_qty: o.suggested_qty || 0,
    online_suggested_qty: o.online_suggested_qty || 0,
    offline_suggested_qty: o.offline_suggested_qty || 0,
    // targets
    // 目标周转：DIM 命中时 online/offline 由同一条规则的两个字段同时给出。
    // 夹具默认二者同源（未显式指定 offline 时跟随 online），需要构造 split 场景的用例
    // 必须同时显式传入 offline_target_turnover。
    online_target_turnover: o.online_target_turnover != null ? o.online_target_turnover : null,
    offline_target_turnover: o.offline_target_turnover != null
      ? o.offline_target_turnover
      : (o.online_target_turnover != null ? o.online_target_turnover : null),
    online_target_stock: o.online_target_stock || 0,
    offline_target_stock: o.offline_target_stock || 0,
    // status
    sales_status: o.sales_status || '正常动销',
    risk_tags: o.risk_tags || '',
    action: o.action || '按目标周转正常补货',
    suggestion: o.suggestion || ''
  };
  if (row.total_inventory_pool == null) {
    row.total_inventory_pool = row.available_qty + row.in_transit_qty + row.pi_confirmed_unshipped_qty;
  }
  const chSrc = Object.assign({}, o, row);   // 保留 fixture 私有字段（pool_allocated_period 等）
  row._totalC = makeTotalC(row);
  row._channelC = {};
  row._channelC.online = makeChannelC(chSrc, true, o.effective_online_qty);
  row._channelC.offline = makeChannelC(chSrc, false, o.effective_offline_qty);
  return row;
}

// 测试夹具：模拟 app.js 既有 shouldBlockReplenish 的注入（生产由 app.js 传入，模块自身不判断）
function fixtureBlocked(row) {
  const tags = R.parseRiskTags(row.risk_tags);
  const st = row.sales_status || '';
  if (['清仓', '停采/停产', '无有效销售', '呆滞', '慢销'].indexOf(st) >= 0) return true;
  if (tags.indexOf('高库存严重') >= 0 || tags.indexOf('高库存关注') >= 0 || tags.indexOf('高库龄风险') >= 0) return true;
  if (tags.indexOf('新品无销量') >= 0) return true;
  return false;
}

function build(rows, opts) {
  return R.rpReviewBuildReport(Object.assign({
    rows: rows,
    tab: 'total',
    filters: {},
    blockedFn: fixtureBlocked
  }, opts || {}));
}

// ==================== 1. 当前筛选条件正确传入报告 ====================
test('1. 筛选条件完整透传进报告 meta（国家/仓库/品牌/维度/关键词/状态）', () => {
  const row = makeRow({ sku_code: 'SKU-A', avg_sales_period: 10, available_qty: 100 });
  const rep = build([row], {
    tab: 'online',
    filters: {
      country: 'Indonesia', warehouse: 'Bekasi', brand: 'Redragon',
      keyword: 'K5', salesStatus: '慢销', lifecycleStatus: 'stable'
    }
  });
  assert.strictEqual(rep.meta.country, 'Indonesia');
  assert.strictEqual(rep.meta.warehouse, 'Bekasi');
  assert.strictEqual(rep.meta.brand, 'Redragon');
  assert.strictEqual(rep.meta.keyword, 'K5');
  assert.strictEqual(rep.meta.salesStatus, '慢销');
  assert.strictEqual(rep.meta.lifecycleStatus, 'stable');
  assert.strictEqual(rep.meta.tab, 'online');
  assert.strictEqual(rep.meta.tabLabel, '线上预测');
  assert.strictEqual(rep.meta.skuTotal, 1);
  // 维度决定取哪个视图模型：online → 用 _channelC.online
  assert.strictEqual(rep.rows[0].pool, row._channelC.online.poolAllocatedPeriod);
});

// ==================== 2. 空数据 ====================
test('2. 空数据：不抛错，计数全 0，摘要给出空态提示，Excel 仍可导出', () => {
  const rep = build([]);
  assert.strictEqual(rep.meta.skuTotal, 0);
  assert.strictEqual(rep.health.skuTotal, 0);
  assert.strictEqual(rep.health.purchaseCount, 0);
  assert.strictEqual(rep.health.overstockCount, 0);
  assert.strictEqual(rep.health.blockedCount, 0);
  assert.strictEqual(rep.health.noSalesCount, 0);
  assert.strictEqual(rep.purchase.length, 0);
  assert.strictEqual(rep.overstock.length, 0);
  assert.strictEqual(rep.noSales.length, 0);
  assert.strictEqual(rep.actions.length, 0);
  assert.ok(rep.summary.headline.indexOf('没有可复盘') >= 0, '空态文案缺失');
  assert.ok(rep.summary.highlights.length >= 1);
  const sheets = R.rpReviewSheets(rep);
  assert.strictEqual(sheets.length, 5);
  const txt = R.rpReviewText(rep);
  assert.ok(txt.indexOf('SKU总数：0') >= 0);
});

// ==================== 3. 单 SKU ====================
test('3. 单 SKU：分区唯一、计数自洽、行动清单最多 1 条', () => {
  const row = makeRow({
    sku_code: 'SOLO-1', avg_sales_period: 10, available_qty: 20,
    online_target_turnover: 4, suggested_qty: 20,
    online_suggested_qty: 12, offline_suggested_qty: 8
  });
  const rep = build([row]);
  assert.strictEqual(rep.meta.skuTotal, 1);
  assert.strictEqual(rep.purchase.length, 1);
  assert.strictEqual(rep.purchase[0].sku, 'SOLO-1');
  // 分区互斥且可加总：以分区桶长度为准（blockedCount 是独立维度，不参与加总）
  const sum = rep.purchase.length + rep.overstock.length + rep.blocked.length
    + rep.noSales.length + rep.normal.length;
  assert.strictEqual(sum, 1, '分区计数不可加总');
  assert.ok(rep.actions.length <= 1);
  assert.strictEqual(rep.actions[0].priority, 'P0');
});

// ==================== 4. avg_sales_period = 0（不得展示为 99）====================
test('4. avg_sales_period=0：当前周转=无销量(null)，归类 noSales，文本/Excel 均不出现 99', () => {
  const row = makeRow({
    sku_code: 'NO-SALE-1', avg_sales_period: 0, available_qty: 500,
    sales_m1: 0, sales_m2: 0, sales_m3: 0, sales_m4: 0,
    online_target_turnover: 4, suggested_qty: 0
  });
  const rep = build([row]);
  const d = rep.rows[0];
  assert.strictEqual(d.currentTurnover, null, '无销量必须为 null，不能是 99');
  assert.strictEqual(d.category, R.CATEGORY.NO_SALES);
  assert.strictEqual(rep.noSales.length, 1);
  assert.strictEqual(rep.health.noSalesCount, 1);
  assert.strictEqual(R.rpReviewTurnText(d.currentTurnover), '无销量');
  const txt = R.rpReviewText(rep);
  assert.ok(txt.indexOf('99') < 0, '复制文本出现 99，违反无销量展示口径');
  const sheets = R.rpReviewSheets(rep);
  const noSalesSheet = sheets.find(s => s.name === 'No Sales');
  assert.strictEqual(noSalesSheet.rows[0][4], '无销量');
  // 行动清单：无销量固定建议
  const act = rep.actions.find(a => a.sku === 'NO-SALE-1');
  assert.strictEqual(act.priority, 'P2');
  assert.ok(act.action.indexOf('停采') >= 0 && act.action.indexOf('新品') >= 0);
});

// ==================== 5. m1-m4 全 0 ====================
test('5. m1~m4 全 0：trend=none（无销量），trendRate=null', () => {
  const tr = R.rpReviewTrend(0, 0, 0, 0);
  assert.strictEqual(tr.recentAvg, 0);
  assert.strictEqual(tr.previousAvg, 0);
  assert.strictEqual(tr.trendRate, null);
  assert.strictEqual(tr.trend, R.TREND.NONE);
  assert.strictEqual(R.rpReviewTrendLabel(tr), '无销量');
});

// ==================== 6. previousAvg = 0 且 recentAvg > 0 ====================
test('6. previousAvg=0 且 recentAvg>0：trend=new（新增/恢复销量），rate=null', () => {
  const tr = R.rpReviewTrend(30, 10, 0, 0);
  assert.strictEqual(tr.previousAvg, 0);
  assert.strictEqual(tr.recentAvg, 20);
  assert.strictEqual(tr.trendRate, null);
  assert.strictEqual(tr.trend, R.TREND.NEW);
  assert.ok(R.rpReviewTrendLabel(tr).indexOf('新增') >= 0);
});

// ==================== 7/8/9. 上涨 / 下滑 / 稳定 ====================
test('7. 销量上涨：recentAvg 高于 previousAvg 超过 +10% → up', () => {
  const tr = R.rpReviewTrend(60, 60, 40, 40);   // recent=60, prev=40 → +50%
  assert.strictEqual(tr.trend, R.TREND.UP);
  assert.ok(tr.trendRate > R.TREND_UP_THRESHOLD);
  assert.strictEqual(R.rpReviewTrendRateText(tr), '+50.0%');
});

test('8. 销量下滑：recentAvg 低于 previousAvg 超过 -10% → down', () => {
  const tr = R.rpReviewTrend(20, 20, 40, 40);   // recent=20, prev=40 → -50%
  assert.strictEqual(tr.trend, R.TREND.DOWN);
  assert.ok(tr.trendRate < R.TREND_DOWN_THRESHOLD);
  assert.strictEqual(R.rpReviewTrendRateText(tr), '-50.0%');
});

test('9. 销量稳定：-10% ~ +10% 区间 → flat（含两个边界）', () => {
  const exactUp = R.rpReviewTrend(44, 44, 40, 40);   // +10.0% 边界，非严格大于 → flat
  assert.strictEqual(exactUp.trend, R.TREND.FLAT);
  const exactDown = R.rpReviewTrend(36, 36, 40, 40); // -10.0% 边界，非严格小于 → flat
  assert.strictEqual(exactDown.trend, R.TREND.FLAT);
  const mid = R.rpReviewTrend(41, 41, 40, 40);       // +2.5%
  assert.strictEqual(mid.trend, R.TREND.FLAT);
  assert.ok(mid.trendRate <= R.TREND_UP_THRESHOLD && mid.trendRate >= R.TREND_DOWN_THRESHOLD);
});

// ==================== 10. suggested_qty > 0 ====================
test('10. suggested_qty>0：归入建议采购，行动清单 P0，合计数量正确', () => {
  const rows = [
    makeRow({ id: 'r1', sku_code: 'BUY-1', avg_sales_period: 50, available_qty: 40, online_target_turnover: 4, suggested_qty: 160, online_suggested_qty: 100, offline_suggested_qty: 60 }),
    makeRow({ id: 'r2', sku_code: 'BUY-2', avg_sales_period: 10, available_qty: 5, online_target_turnover: 4, suggested_qty: 35, online_suggested_qty: 20, offline_suggested_qty: 15 })
  ];
  const rep = build(rows);
  assert.strictEqual(rep.health.purchaseCount, 2);
  assert.strictEqual(rep.health.purchaseQty, 195);
  assert.strictEqual(rep.purchase.length, 2);
  rep.actions.forEach(a => assert.strictEqual(a.priority, 'P0'));
  const a1 = rep.actions.find(a => a.sku === 'BUY-1');
  assert.ok(a1.issue.indexOf('建议采购 160') >= 0, 'P0 文案未带建议采购数量');
});

// ==================== 11. blocked SKU ====================
test('11. blocked SKU：归入 blocked/高库存分区，行动清单 P1，沿用系统动作文案', () => {
  const row = makeRow({
    sku_code: 'BLOCK-1', avg_sales_period: 10, available_qty: 90,
    online_target_turnover: 4,           // 周转 9 > 4*2 → 系统判「慢销」+ 高库存严重
    sales_status: '慢销', risk_tags: '高库存严重',
    action: '谨慎补货，先消化库存', suggested_qty: 0
  });
  const rep = build([row]);
  const d = rep.rows[0];
  assert.strictEqual(d.blocked, true);
  // 命中「高库存严重」→ 优先归入高库存分区（比通用 blocked 更可执行）
  assert.strictEqual(d.category, R.CATEGORY.OVERSTOCK);
  assert.strictEqual(rep.health.overstockCount, 1);
  const act = rep.actions.find(a => a.sku === 'BLOCK-1');
  assert.strictEqual(act.priority, 'P1');
  assert.strictEqual(act.action, '谨慎补货，先消化库存', '未优先复用系统权威动作文案');
  // blockedCount 是独立维度（含高库存命中项），blockedOnlyCount 是分区残差
  assert.strictEqual(rep.health.blockedCount, 1);
  assert.strictEqual(rep.health.blockedOnlyCount, 0);
  assert.strictEqual(rep.health.blockedOverlapCount, 1, '该 SKU 同时命中高库存与被拦截');
});

test('11c. Blocked 为独立维度：高库存与 Blocked 重叠时不得被分区口径算成 0', () => {
  // 真实数据形态：一个被判高库存的 SKU 通常同时被 shouldBlockReplenish 拦截
  const rows = [
    makeRow({ id: 'b1', sku_code: 'OV-BLK-1', avg_sales_period: 10, available_qty: 90, online_target_turnover: 4, suggested_qty: 0, sales_status: '呆滞', risk_tags: '高库存严重', action: '暂停补货，先清库存' }),
    makeRow({ id: 'b2', sku_code: 'OV-BLK-2', avg_sales_period: 10, available_qty: 80, online_target_turnover: 4, suggested_qty: 0, sales_status: '慢销', risk_tags: '高库存关注', action: '谨慎补货，先消化库存' })
  ];
  const rep = build(rows);
  assert.strictEqual(rep.health.overstockCount, 2, '两个 SKU 都应归入高库存');
  assert.strictEqual(rep.health.blockedCount, 2, 'Blocked 为独立维度，不得因分区口径被算成 0');
  assert.strictEqual(rep.health.blockedOnlyCount, 0);
  assert.strictEqual(rep.health.blockedOverlapCount, 2);
  // 摘要句必须把重叠说清楚，不能让四个数字看起来互斥
  assert.ok(rep.summary.headline.indexOf('另有 2 个被系统标记为拦截补货') >= 0, rep.summary.headline);
  assert.ok(rep.summary.headline.indexOf('存在重叠') >= 0);
  // 摘要句前四项为分区计数，可加总
  assert.ok(rep.summary.headline.indexOf('其中 0 个需要补货，2 个库存偏高，0 个无销量，0 个周转正常') >= 0,
    rep.summary.headline);
});

test('11b. 纯 blocked（无高库存信号）：归入 blocked 分区且 P1', () => {
  const row = makeRow({
    sku_code: 'STOP-1', avg_sales_period: 10, available_qty: 20,
    online_target_turnover: 4, sales_status: '停采/停产',
    action: '停止采购，不参与补货', suggested_qty: 0
  });
  const rep = build([row]);
  assert.strictEqual(rep.rows[0].category, R.CATEGORY.BLOCKED);
  assert.strictEqual(rep.health.blockedCount, 1);
  const act = rep.actions.find(a => a.sku === 'STOP-1');
  assert.strictEqual(act.priority, 'P1');
  assert.strictEqual(act.action, '停止采购，不参与补货');
});

// ==================== 12. 高周转 SKU ====================
test('12. 高周转 SKU：周转超目标且无建议采购 → 高库存分区，动作含「消化库存」', () => {
  const row = makeRow({
    sku_code: 'HIGH-1', avg_sales_period: 10, available_qty: 70,   // 周转 7 > 目标 4
    online_target_turnover: 4, suggested_qty: 0,
    sales_status: '正常动销', risk_tags: '',
    sales_m1: 12, sales_m2: 12, sales_m3: 8, sales_m4: 8
  });
  const rep = build([row]);
  assert.strictEqual(rep.rows[0].category, R.CATEGORY.OVERSTOCK);
  assert.strictEqual(rep.overstock.length, 1);
  const act = rep.actions.find(a => a.sku === 'HIGH-1');
  assert.strictEqual(act.priority, 'P2', '未下滑的一般性高库存应为 P2');
  const oa = R.rpReviewOverstockAction(rep.rows[0]);
  assert.ok(oa.indexOf('消化库存') >= 0, '高库存动作文案异常：' + oa);
});

test('12b. 高周转 + 销量下滑 → 升级为 P1 且建议促销/分销', () => {
  const row = makeRow({
    sku_code: 'HIGH-DOWN', avg_sales_period: 10, available_qty: 90, // 周转 9 >= 4*1.5
    online_target_turnover: 4, suggested_qty: 0,
    sales_status: '正常动销', risk_tags: '',
    sales_m1: 4, sales_m2: 4, sales_m3: 20, sales_m4: 20            // 近两月大幅下滑
  });
  const rep = build([row]);
  const act = rep.actions.find(a => a.sku === 'HIGH-DOWN');
  assert.strictEqual(act.priority, 'P1');
  assert.ok(act.action.indexOf('促销') >= 0, '显著偏高+下滑应给出促销/分销建议：' + act.action);
  assert.ok(act.issue.indexOf('下滑') >= 0);
});

// ==================== 13. online / offline suggested qty 汇总 ====================
test('13. 总预测：suggested_qty = online + offline + other 恒等式成立并全部展示', () => {
  const row = makeRow({
    sku_code: 'SPLIT-1', avg_sales_period: 30, available_qty: 20,
    online_target_turnover: 4, suggested_qty: 628,
    online_suggested_qty: 400, offline_suggested_qty: 228
  });
  const rep = build([row]);
  const d = rep.rows[0];
  assert.strictEqual(d.suggestedQty, 628);
  assert.strictEqual(d.onlineQty, 400);
  assert.strictEqual(d.offlineQty, 228);
  assert.strictEqual(d.otherQty, 0);
  assert.strictEqual(d.splitOk, true, 'suggested = online + offline + other 恒等式被破坏');
  const sheets = R.rpReviewSheets(rep);
  const ps = sheets.find(s => s.name === 'Purchase Suggestions');
  const headers = ps.headers;
  assert.ok(headers.indexOf('online_suggested_qty') >= 0, '总预测必须展示 online_suggested_qty');
  assert.ok(headers.indexOf('offline_suggested_qty') >= 0, '总预测必须展示 offline_suggested_qty');
  assert.ok(headers.indexOf('other_suggested_qty') >= 0, '总预测必须展示 other_suggested_qty');
  const r = ps.rows[0];
  assert.strictEqual(r[headers.indexOf('online_suggested_qty')], 400);
  assert.strictEqual(r[headers.indexOf('offline_suggested_qty')], 228);
  assert.strictEqual(r[headers.indexOf('建议采购数量')], 628);
  assert.strictEqual(r[headers.indexOf('other_suggested_qty')], 0);
});

// ==================== 14. manual suggested qty 不被报告重新计算覆盖 ====================
test('14. 线上视图手工 override：报告取手工值，不回退/不重算系统值', () => {
  const row = makeRow({
    sku_code: 'MANUAL-1', avg_sales_period: 10,
    online_avg_sales_period: 6, pool_allocated_period: 30,
    online_target_turnover: 4,
    online_suggested_qty: 24,       // 系统落库值
    offline_suggested_qty: 0,
    suggested_qty: 24
  });
  // 用户在页面把线上建议采购手工改成 100（页面 rpGetEffectiveSuggestedQty 行为）
  const manualMap = { 'MANUAL-1': 100 };
  const rep = build([row], {
    tab: 'online',
    effectiveQtyFn: (tab, r) => (manualMap[r.sku_code] !== undefined ? manualMap[r.sku_code] : null)
  });
  const d = rep.rows[0];
  assert.strictEqual(d.suggestedQty, 100, '手工 override 被系统值覆盖');
  assert.notStrictEqual(d.suggestedQty, row.online_suggested_qty);
  // 采购后周转随手工值联动，公式与页面 rpComputeChannelAfterOrderTurnover 一致
  assert.strictEqual(d.afterOrderTurnover, Math.round((30 + 100) / 6 * 10) / 10);
  // 原始行不被改写
  assert.strictEqual(row.online_suggested_qty, 24);
  assert.strictEqual(row._channelC.online.suggestedQty, 24);
});

test('14b. 手工填入 0：不得被系统非零值覆盖', () => {
  const row = makeRow({
    sku_code: 'MANUAL-0', avg_sales_period: 10,
    online_avg_sales_period: 5, pool_allocated_period: 20,
    online_target_turnover: 4, online_suggested_qty: 30, suggested_qty: 30
  });
  const rep = build([row], { tab: 'online', effectiveQtyFn: () => 0 });
  assert.strictEqual(rep.rows[0].suggestedQty, 0);
  assert.strictEqual(rep.rows[0].afterOrderTurnover, 4); // (20+0)/5
});

// ==================== 15. 报告周转与订单预测原始数据一致 ====================
test('15. 报告当前周转 / 库存池 / 月均 / 建议采购 与页面视图模型逐字段一致', () => {
  const rows = [
    makeRow({ id: 'a', sku_code: 'PARITY-1', avg_sales_period: 37, available_qty: 120, in_transit_qty: 30, pi_confirmed_unshipped_qty: 10, online_target_turnover: 4, suggested_qty: 88, online_suggested_qty: 50, offline_suggested_qty: 38 }),
    makeRow({ id: 'b', sku_code: 'PARITY-2', avg_sales_period: 0, available_qty: 999, online_target_turnover: 4 }),
    makeRow({ id: 'c', sku_code: 'PARITY-3', avg_sales_period: 3.33, available_qty: 17, online_target_turnover: 2 })
  ];
  // --- 总预测 ---
  const repT = build(rows, { tab: 'total' });
  rows.forEach((row, i) => {
    const d = repT.rows[i];
    const c = row._totalC;
    assert.strictEqual(d.pool, c.pool, '总预测库存池不一致');
    assert.strictEqual(d.avgSales, c.taPeriod, '总预测月均销量不一致');
    assert.strictEqual(d.suggestedQty, c.sq, '总预测建议采购不一致');
    assert.strictEqual(d.afterOrderTurnover, c.afterOrderTurnover, '总预测采购后周转不一致');
    if (c.taPeriod > 0) {
      assert.strictEqual(d.currentTurnover, c.ct, '总预测当前周转与页面 c.ct 不一致');
      assert.strictEqual(d.currentTurnover, Math.round(c.pool / c.taPeriod * 10) / 10);
    } else {
      assert.strictEqual(d.currentTurnover, null, '无销量应为 null（页面 c.ct=0 是展示哨兵，不得透传为 0）');
    }
  });
  // --- 线上 / 线下 ---
  ['online', 'offline'].forEach(tab => {
    const repC = build(rows, { tab });
    rows.forEach((row, i) => {
      const d = repC.rows[i];
      const c = row._channelC[tab];
      assert.strictEqual(d.pool, c.poolAllocatedPeriod, tab + ' 库存池不一致');
      assert.strictEqual(d.avgSales, c.avgSalesPeriod, tab + ' 月均销量不一致');
      assert.strictEqual(d.targetTurn, c.targetTurn, tab + ' 目标周转不一致');
      assert.strictEqual(d.suggestedQty, c.suggestedQty, tab + ' 建议采购不一致');
      if (c.avgSalesPeriod > 0) {
        assert.strictEqual(d.currentTurnover, c.currentTurn, tab + ' 当前周转与页面 c.currentTurn 不一致');
      } else {
        assert.strictEqual(d.currentTurnover, null, tab + ' 无销量应为 null，不得展示页面「无销量」字符串');
      }
    });
  });
});

test('15b. 报告不修改输入行（非变异）', () => {
  const row = makeRow({ sku_code: 'IMMUT-1', avg_sales_period: 10, available_qty: 50, online_target_turnover: 4, suggested_qty: 10 });
  const before = JSON.stringify(row);
  build([row]);
  R.rpReviewSheets(build([row]));
  R.rpReviewText(build([row]));
  assert.strictEqual(JSON.stringify(row), before, '报告构建过程修改了输入行对象');
});

// ==================== 16. Excel 导出 ====================
test('16. Excel Sheet：5 张表、表头固定、数值与报告完全一致', () => {
  const rows = [
    makeRow({ id: 'x1', sku_code: 'EX-BUY', avg_sales_period: 20, available_qty: 10, online_target_turnover: 4, suggested_qty: 70, online_suggested_qty: 40, offline_suggested_qty: 30, sales_m1: 25, sales_m2: 25, sales_m3: 10, sales_m4: 10 }),
    makeRow({ id: 'x2', sku_code: 'EX-HIGH', avg_sales_period: 10, available_qty: 90, online_target_turnover: 4, suggested_qty: 0, sales_status: '正常动销' }),
    makeRow({ id: 'x3', sku_code: 'EX-NOSALE', avg_sales_period: 0, available_qty: 300, online_target_turnover: 4, suggested_qty: 0, sales_status: '无有效销售' })
  ];
  const rep = build(rows);
  const sheets = R.rpReviewSheets(rep);
  const names = sheets.map(s => s.name);
  assert.deepStrictEqual(names, ['Summary', 'Purchase Suggestions', 'Overstock', 'No Sales', 'Action List']);
  sheets.forEach(s => {
    assert.ok(Array.isArray(s.headers) && s.headers.length > 0, s.name + ' 缺表头');
    assert.ok(Array.isArray(s.rows), s.name + ' 缺数据行');
  });
  // Purchase 行与报告对象一致
  const ps = sheets.find(s => s.name === 'Purchase Suggestions');
  assert.strictEqual(ps.rows.length, rep.purchase.length);
  const skuIdx = ps.headers.indexOf('SKU');
  const poolIdx = ps.headers.indexOf('当前库存池');
  const turnIdx = ps.headers.indexOf('当前周转');
  rep.purchase.forEach((d, i) => {
    assert.strictEqual(ps.rows[i][skuIdx], d.sku);
    assert.strictEqual(ps.rows[i][poolIdx], Math.round(d.pool));
    assert.strictEqual(ps.rows[i][turnIdx], String(d.currentTurnover));
  });
  // Overstock 行与报告一致
  const os = sheets.find(s => s.name === 'Overstock');
  assert.strictEqual(os.rows.length, rep.overstock.length);
  assert.strictEqual(os.rows[0][os.headers.indexOf('SKU')], 'EX-HIGH');
  assert.strictEqual(os.rows[0][os.headers.indexOf('当前周转')], String(rep.overstock[0].currentTurnover));
  // No Sales：周转列恒为「无销量」
  const ns = sheets.find(s => s.name === 'No Sales');
  ns.rows.forEach(r => assert.strictEqual(r[ns.headers.indexOf('当前周转')], '无销量'));
  // Action List：与报告 actions 同源
  const al = sheets.find(s => s.name === 'Action List');
  assert.strictEqual(al.rows.length, rep.actions.length);
  rep.actions.forEach((a, i) => {
    assert.strictEqual(al.rows[i][0], a.priority);
    assert.strictEqual(al.rows[i][1], a.sku);
    assert.strictEqual(al.rows[i][5], a.action);
  });
  // Summary 含关键指标
  const sm = sheets.find(s => s.name === 'Summary');
  const flat = sm.rows.map(r => String(r[0]) + '|' + String(r[1])).join('\n');
  assert.ok(flat.indexOf('SKU 总数|3') >= 0, 'Summary 缺 SKU 总数：' + flat);
  assert.ok(flat.indexOf('建议采购数量合计|70') >= 0, 'Summary 缺建议采购合计');
});

// ==================== 17. 复制报告文本 ====================
test('17. 复制文本：只含管理摘要 + 分级行动清单，不含完整表格', () => {
  const rows = [];
  // 造 12 个 P0，验证复制文本做条数截断（不复制几百行）
  for (let i = 0; i < 12; i++) {
    rows.push(makeRow({
      id: 'p' + i, sku_code: 'COPY-P0-' + i, avg_sales_period: 10 + i,
      available_qty: 5, online_target_turnover: 4, suggested_qty: 35 + i,
      online_suggested_qty: 20, offline_suggested_qty: 15 + i
    }));
  }
  rows.push(makeRow({
    id: 'q1', sku_code: 'COPY-HIGH', avg_sales_period: 10, available_qty: 90,
    online_target_turnover: 4, suggested_qty: 0, sales_status: '正常动销',
    sales_m1: 3, sales_m2: 3, sales_m3: 20, sales_m4: 20
  }));
  rows.push(makeRow({
    id: 'q2', sku_code: 'COPY-NOSALE', avg_sales_period: 0, available_qty: 400,
    online_target_turnover: 4, suggested_qty: 0, sales_status: '无有效销售'
  }));
  const rep = build(rows, { filters: { country: 'Indonesia', brand: 'Redragon' } });
  const txt = R.rpReviewText(rep);
  // 标题行
  assert.ok(txt.indexOf('库存周转复盘｜Indonesia / Redragon') >= 0, '标题行缺失：\n' + txt.slice(0, 200));
  assert.ok(txt.indexOf('SKU总数：14') >= 0);
  assert.ok(txt.indexOf('建议采购：12') >= 0);
  assert.ok(txt.indexOf('高库存：1') >= 0);
  assert.ok(txt.indexOf('无销量：1') >= 0);
  assert.ok(txt.indexOf('重点问题：') >= 0);
  // P0 / P1 / P2 分段
  assert.ok(/\nP0：\n/.test(txt), '缺 P0 段');
  assert.ok(/\nP1：\n/.test(txt), '缺 P1 段');
  assert.ok(/\nP2：\n/.test(txt), '缺 P2 段');
  // 截断：P0 有 12 条，只复制 5 条 + 提示
  const p0Block = txt.split('\nP0：\n')[1].split('\nP1：')[0];
  assert.strictEqual((p0Block.match(/^\* /gm) || []).length, R.COPY_ACTION_LIMIT_PER_PRIORITY,
    'P0 未按常量截断');
  assert.ok(p0Block.indexOf('另有 7 条') >= 0, '缺截断提示');
  // 行动项结构：SKU / 核心数据 / 建议动作
  assert.ok(/\* COPY-HIGH：/.test(txt));
  assert.ok(/→ /.test(txt), '缺建议动作箭头行');
  // 不复制完整表格
  assert.ok(txt.indexOf('当前库存池') < 0, '复制文本不应包含表格表头');
  assert.ok(txt.length < 6000, '复制文本过长，疑似包含完整表格');
});

// ==================== 18. 不改动订单预测原有行为 / 报告层无任何副作用 ====================
test('18. 报告层为纯读模块：无网络/DB/写库调用，且不依赖 AI 接口', () => {
  // 只扫描「代码」：先剥离注释，避免文档措辞（如「不接 OpenAI」）造成误报
  const raw = fs.readFileSync(path.join(__dirname, '..', 'assets', 'rp-review-report.js'), 'utf8');
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const forbidden = [
    'fetch(', 'XMLHttpRequest', 'openai', 'OpenAI', 'require(\'../db', 'require(\'./db',
    'localStorage', 'sessionStorage', 'window.api(', 'api(\'/api/',
    'INSERT ', 'UPDATE ', 'DELETE ', 'DROP '
  ];
  forbidden.forEach(tok => {
    assert.strictEqual(src.indexOf(tok), -1, '报告层出现禁止的副作用/外部调用：' + tok);
  });
});

test('18b. 趋势计算绝不回流到建议采购 / 分类 / 周转（同一 SKU 仅趋势不同）', () => {
  function mk(m1, m2, m3, m4) {
    return makeRow({
      sku_code: 'TREND-ISO', avg_sales_period: 10, available_qty: 50,
      online_target_turnover: 4, suggested_qty: 0, sales_status: '正常动销',
      sales_m1: m1, sales_m2: m2, sales_m3: m3, sales_m4: m4
    });
  }
  const up = build([mk(60, 60, 20, 20)]);
  const down = build([mk(20, 20, 60, 60)]);
  assert.strictEqual(up.rows[0].trend.trend, R.TREND.UP);
  assert.strictEqual(down.rows[0].trend.trend, R.TREND.DOWN);
  // 关键断言：趋势不同 → 建议采购 / 当前周转 / 库存池 / 月均 / 分类 全部不变
  ['suggestedQty', 'currentTurnover', 'pool', 'avgSales', 'targetTurn', 'category'].forEach(k => {
    assert.strictEqual(up.rows[0][k], down.rows[0][k], '趋势影响了 ' + k);
  });
  // 仅「建议动作」措辞可随趋势变化（展示层）
  assert.notStrictEqual(
    R.rpReviewOverstockAction(up.rows[0]),
    R.rpReviewOverstockAction(down.rows[0])
  );
});

test('18c. 未提供 blockedFn 时模块不自行判断 blocked（禁止复制一套拦截算法）', () => {
  const row = makeRow({
    sku_code: 'NOBLOCK-1', avg_sales_period: 10, available_qty: 90,
    online_target_turnover: 4, sales_status: '慢销', risk_tags: '高库存严重', suggested_qty: 0
  });
  const rep = R.rpReviewBuildReport({ rows: [row], tab: 'total', filters: {} });
  assert.strictEqual(rep.rows[0].blocked, false, '模块自行判定了 blocked（应由调用方注入权威结果）');
});

// ==================== 附加：分区互斥 + 目标周转多档处理 ====================
test('19. 分区互斥：任意组合下五类计数之和恒等于 SKU 总数', () => {
  const rows = [
    makeRow({ id: 's1', sku_code: 'MIX-1', avg_sales_period: 10, available_qty: 5, online_target_turnover: 4, suggested_qty: 35 }),
    makeRow({ id: 's2', sku_code: 'MIX-2', avg_sales_period: 10, available_qty: 90, online_target_turnover: 4, suggested_qty: 0, sales_status: '正常动销' }),
    makeRow({ id: 's3', sku_code: 'MIX-3', avg_sales_period: 0, available_qty: 400, online_target_turnover: 4, suggested_qty: 0, sales_status: '无有效销售' }),
    makeRow({ id: 's4', sku_code: 'MIX-4', avg_sales_period: 10, available_qty: 20, online_target_turnover: 4, suggested_qty: 0, sales_status: '停采/停产', action: '停止采购，不参与补货' }),
    makeRow({ id: 's5', sku_code: 'MIX-5', avg_sales_period: 10, available_qty: 40, online_target_turnover: 4, suggested_qty: 0, sales_status: '正常动销' })  // 周转 4 = 目标 4 → 正常
  ];
  const rep = build(rows);
  const h = rep.health;
  // 分区计数（互斥、可加总）：以分区桶长度为准
  assert.strictEqual(
    rep.purchase.length + rep.overstock.length + rep.blocked.length
    + rep.noSales.length + rep.normal.length,
    h.skuTotal
  );
  assert.strictEqual(h.skuTotal, 5);
  assert.strictEqual(rep.purchase.length, 1);
  assert.strictEqual(rep.overstock.length, 1);
  assert.strictEqual(rep.noSales.length, 1);
  assert.strictEqual(rep.blocked.length, 1);
  assert.strictEqual(rep.normal.length, 1);
  // 摘要句包含 SKU 总数
  assert.ok(rep.summary.headline.indexOf('共 5 个 SKU') >= 0, rep.summary.headline);
  assert.ok(rep.summary.highlights.length >= 2 && rep.summary.highlights.length <= 4,
    '重点结论必须为 2~4 条，实际 ' + rep.summary.highlights.length);
});

test('20. 目标周转：单一档位显示具体月数；多档位显示「多档」+ 品牌明细', () => {
  const one = build([
    makeRow({ id: 't1', sku_code: 'T-1', avg_sales_period: 10, available_qty: 40, online_target_turnover: 4 }),
    makeRow({ id: 't2', sku_code: 'T-2', avg_sales_period: 10, available_qty: 40, online_target_turnover: 4 })
  ]);
  assert.strictEqual(one.health.targetTurnover, 4);
  assert.strictEqual(one.health.targetTurnoverText, '4 个月');

  const multi = build([
    makeRow({ id: 'm1', sku_code: 'M-1', brand: 'Redragon', avg_sales_period: 10, available_qty: 40, online_target_turnover: 4 }),
    makeRow({ id: 'm2', sku_code: 'M-2', brand: 'Netac', avg_sales_period: 10, available_qty: 40, online_target_turnover: 2 })
  ]);
  assert.strictEqual(multi.health.targetTurnover, null);
  assert.ok(multi.health.targetTurnoverText.indexOf('多档') >= 0);
  assert.strictEqual(multi.health.targetTurnoverByBrand.length, 2);
  const rd = multi.health.targetTurnoverByBrand.find(b => b.brand === 'Redragon');
  const nt = multi.health.targetTurnoverByBrand.find(b => b.brand === 'Netac');
  assert.strictEqual(rd.target, 4);
  assert.strictEqual(nt.target, 2);
  // 多档时 Summary sheet 附品牌明细
  const sm = R.rpReviewSheets(multi).find(s => s.name === 'Summary');
  const flat = sm.rows.map(r => String(r[0]) + '|' + String(r[1])).join('\n');
  assert.ok(flat.indexOf('Redragon|4') >= 0, '多档目标周转缺品牌明细：' + flat);
  assert.ok(flat.indexOf('Netac|2') >= 0);
});

test('21. 报告常量：趋势阈值为 ±10%，且被趋势函数实际引用（无 magic number 漂移）', () => {
  assert.strictEqual(R.TREND_UP_THRESHOLD, 0.10);
  assert.strictEqual(R.TREND_DOWN_THRESHOLD, -0.10);
  // 边界外一点点即切换分类
  assert.strictEqual(R.rpReviewTrend(100, 100, 90, 90).trend, R.TREND.UP);    // +11.1% → up
  assert.strictEqual(R.rpReviewTrend(90, 90, 100, 100).trend, R.TREND.FLAT);  // 正好 -10.0% 边界 → flat
  assert.strictEqual(R.rpReviewTrend(89, 89, 100, 100).trend, R.TREND.DOWN);  // -11% → down
  assert.strictEqual(R.rpReviewTrend(110, 110, 100, 100).trend, R.TREND.FLAT); // 正好 +10.0% 边界 → flat
});

// ==================== 22. 总预测目标周转权威链路（FINAL REVIEW 新增）====================
// 总预测页面（loadRp / _totalC）没有单一「目标周转」列，而是两个并列列：
//   c.ot  = r.online_target_turnover → 页面列「线上目标周转」
//   c.oft = r.offline_target_turnover → 页面列「线下目标周转」
// 后端 DIM 规则两个字段可独立配置（app.js dim 规则 online_turnover / offline_turnover），
// 因此二者允许不相等。报告必须严格读取 view model，禁止用 online 单值冒充「总目标周转」，
// 也禁止新增任何品牌 hardcode 配置。

test('22-A. 总预测：report.targetTurn 与页面 view model _totalC.ot 逐行同源', () => {
  // 覆盖 online===offline 与 online!==offline 两种情形
  const rows = [
    makeRow({ id: 't1', sku_code: 'T-1', avg_sales_period: 10, available_qty: 100, online_target_turnover: 4, offline_target_turnover: 4 }),
    makeRow({ id: 't2', sku_code: 'T-2', avg_sales_period: 10, available_qty: 100, online_target_turnover: 2, offline_target_turnover: 5 }),
    makeRow({ id: 't3', sku_code: 'T-3', avg_sales_period: 10, available_qty: 100, online_target_turnover: 3, offline_target_turnover: 3 })
  ];
  const rep = build(rows);
  rep.rows.forEach(d => {
    const src = rows.find(r => r.id === d.id);
    assert.strictEqual(d.targetTurn, src._totalC.ot,
      `SKU ${d.sku}: report.targetTurn !== view model _totalC.ot`);
    assert.strictEqual(d.onlineTargetTurn, src._totalC.ot,
      `SKU ${d.sku}: report.onlineTargetTurn !== view model _totalC.ot`);
    assert.strictEqual(d.offlineTargetTurn, src._totalC.oft,
      `SKU ${d.sku}: report.offlineTargetTurn !== view model _totalC.oft`);
  });
  // split 标记与两个列的实际相等性严格一致
  assert.strictEqual(rep.rows.find(d => d.id === 't1').targetTurnSplit, false);
  assert.strictEqual(rep.rows.find(d => d.id === 't2').targetTurnSplit, true);
  assert.strictEqual(rep.rows.find(d => d.id === 't3').targetTurnSplit, false);
});

test('22-B. 总预测：线上/线下目标周转不等时，不得对外给出单一「目标周转」数值', () => {
  const rows = [
    makeRow({ id: 's1', sku_code: 'S-1', avg_sales_period: 10, available_qty: 100, online_target_turnover: 4, offline_target_turnover: 2 }),
    makeRow({ id: 's2', sku_code: 'S-2', avg_sales_period: 10, available_qty: 100, online_target_turnover: 4, offline_target_turnover: 2 })
  ];
  const rep = build(rows);
  // 单一值必须为 null（否则就是把 online 单值冒充总目标周转）
  assert.strictEqual(rep.health.targetTurnover, null,
    'online/offline 目标周转不等时 targetTurnover 必须为 null');
  // 文案必须并列展示两个值
  assert.ok(rep.health.targetTurnoverText.indexOf('4') >= 0
    && rep.health.targetTurnoverText.indexOf('2') >= 0,
    '文案未并列展示线上/线下目标周转：' + rep.health.targetTurnoverText);
  // 品牌档位也必须标记 split 且 target 为 null
  const b = rep.health.targetTurnoverByBrand[0];
  assert.strictEqual(b.split, true);
  assert.strictEqual(b.target, null);
  assert.strictEqual(b.onlineTarget, 4);
  assert.strictEqual(b.offlineTarget, 2);
});

test('22-C. 总预测：线上/线下目标周转相等时，单一目标周转 = 该唯一值', () => {
  const rows = [
    makeRow({ id: 'e1', sku_code: 'E-1', avg_sales_period: 10, available_qty: 100, online_target_turnover: 4, offline_target_turnover: 4 })
  ];
  const rep = build(rows);
  assert.strictEqual(rep.health.targetTurnover, 4);
  assert.strictEqual(rep.health.onlineTargetTurnover, 4);
  assert.strictEqual(rep.health.offlineTargetTurnover, 4);
  assert.ok(rep.health.targetTurnoverText.indexOf('4') >= 0, rep.health.targetTurnoverText);
  // 不出现 split 文案
  assert.ok(rep.health.targetTurnoverText.indexOf('线上') < 0, rep.health.targetTurnoverText);
});

test('22-D. 报告目标周转不得来自任何品牌 hardcode：改 view model 即改报告（无品牌名分支）', () => {
  // 同一品牌 Netac 在不同国家/仓库命中不同 DIM 规则 → 目标周转不同。
  // 若报告内部有品牌 hardcode，两个 SKU 会被强制成同一值。
  const rows = [
    makeRow({ id: 'h1', sku_code: 'H-1', brand: 'Netac', country: 'ID', avg_sales_period: 10, available_qty: 100, online_target_turnover: 7, offline_target_turnover: 7 }),
    makeRow({ id: 'h2', sku_code: 'H-2', brand: 'Netac', country: 'PH', avg_sales_period: 10, available_qty: 100, online_target_turnover: 1, offline_target_turnover: 1 })
  ];
  const rep = build(rows);
  assert.strictEqual(rep.rows.find(d => d.id === 'h1').targetTurn, 7);
  assert.strictEqual(rep.rows.find(d => d.id === 'h2').targetTurn, 1);
  // 两个 SKU 各自等于自己的 view model，绝不互相污染
  rep.rows.forEach(d => {
    const src = rows.find(r => r.id === d.id);
    assert.strictEqual(d.targetTurn, src._totalC.ot);
  });
  // 源码层面：模块内不得出现品牌名常量
  const src = fs.readFileSync(path.join(__dirname, '..', 'assets', 'rp-review-report.js'), 'utf8');
  ['Redragon', 'Netac', 'redragon', 'netac'].forEach(brand => {
    assert.strictEqual(src.indexOf(brand), -1, `模块内出现品牌 hardcode: ${brand}`);
  });
});

test('22-E. 分类判定基准 = 系统 classifySkuState 的 target_months 口径（DIM online_turnover）', () => {
  // 后端：classifyTarget = dimHit.online_turnover（server.js:6663）→ classifySkuState 的 target_months
  // 报告：高库存补充判定 `当前周转 > targetTurn` 必须用同一基准，否则与系统销售状态自相矛盾。
  const rows = [
    // 高库存：pool/avg=12 > online_target 4，且无销量下滑 → 应归入高库存
    makeRow({ id: 'k1', sku_code: 'K-1', avg_sales_period: 10, available_qty: 120, online_target_turnover: 4, offline_target_turnover: 4, sales_status: '正常动销', risk_tags: '', suggested_qty: 0 })
  ];
  const rep = build(rows);
  assert.strictEqual(rep.health.overstockCount, 1, '未按 online_target_turnover 判定高库存');
  const d = rep.overstock[0];
  assert.strictEqual(d.targetTurn, rows[0]._totalC.ot);
  assert.strictEqual(d.currentTurnover, 12);
  assert.ok(d.currentTurnover > d.targetTurn);
});

test('22-F. Excel 与前端表格共用同一目标周转展示函数（split 时并列、否则单值）', () => {
  const rows = [
    makeRow({ id: 'x1', sku_code: 'X-1', avg_sales_period: 10, available_qty: 120, online_target_turnover: 4, offline_target_turnover: 2, sales_status: '正常动销', risk_tags: '', suggested_qty: 0 }),
    makeRow({ id: 'x2', sku_code: 'X-2', avg_sales_period: 10, available_qty: 120, online_target_turnover: 3, offline_target_turnover: 3, sales_status: '正常动销', risk_tags: '', suggested_qty: 0 })
  ];
  const rep = build(rows);
  const sheets = R.rpReviewSheets(rep);
  const os = sheets.find(s => s.name === 'Overstock');
  const hdr = os.headers.indexOf('目标周转');
  assert.ok(hdr >= 0, 'Overstock sheet 缺「目标周转」列');
  os.rows.forEach((r, i) => {
    const d = rep.overstock[i];
    assert.strictEqual(String(r[hdr]), R.rpReviewTargetText(d),
      `Excel 目标周转与 rpReviewTargetText 不一致: ${r[hdr]}`);
  });
  // split 行显示并列值，非 split 行显示单值
  const texts = os.rows.map(r => String(r[hdr]));
  assert.ok(texts.indexOf('4 / 2') >= 0, 'split 行未并列展示：' + JSON.stringify(texts));
  assert.ok(texts.indexOf('3') >= 0, '非 split 行未显示单值：' + JSON.stringify(texts));
  // Summary sheet 目标周转与 health 文案一致
  const sm = sheets.find(s => s.name === 'Summary');
  const tgtRow = sm.rows.find(r => String(r[0]).indexOf('目标周转') === 0);
  assert.strictEqual(String(tgtRow[1]), rep.health.targetTurnoverText);
});

// ==================== 23. 空报告（筛选无匹配）不得报错 ====================
test('23. 空数据集：生成空报告而非抛错，且各模块均为空、目标周转不显示误导文案', () => {
  const rep = build([]);
  assert.strictEqual(rep.meta.skuTotal, 0);
  assert.strictEqual(rep.health.skuTotal, 0);
  assert.strictEqual(rep.health.targetTurnover, null);
  assert.strictEqual(rep.health.targetTurnoverText, '-', '空报告目标周转应显示 "-"：' + rep.health.targetTurnoverText);
  assert.strictEqual(rep.purchase.length, 0);
  assert.strictEqual(rep.overstock.length, 0);
  assert.strictEqual(rep.noSales.length, 0);
  assert.strictEqual(rep.actions.length, 0);
  assert.strictEqual(rep.health.purchaseQty, 0);
  // 摘要给出明确空态提示，而不是「所有 SKU 周转正常」这类误导结论
  assert.ok(rep.summary.headline.indexOf('没有可复盘的 SKU') >= 0, rep.summary.headline);
  assert.strictEqual(rep.summary.highlights.length, 1);
  assert.ok(rep.summary.highlights[0].indexOf('筛选条件') >= 0, rep.summary.highlights[0]);
  // Excel / 复制文本在空报告下同样可用
  const sheets = R.rpReviewSheets(rep);
  assert.strictEqual(sheets.length, 5);
  ['Purchase Suggestions', 'Overstock', 'No Sales', 'Action List'].forEach(n => {
    const s = sheets.find(x => x.name === n);
    assert.strictEqual(s.rows.length, 0, `${n} 应为空`);
  });
  const text = R.rpReviewText(rep);
  assert.ok(text.indexOf('SKU总数：0') >= 0, text);
});

test('23-B. 筛选后行数严格等于报告 SKU 数（报告不做任何额外过滤/补全）', () => {
  const all = [
    makeRow({ id: 'f1', sku_code: 'M916', avg_sales_period: 10, available_qty: 100 }),
    makeRow({ id: 'f2', sku_code: 'M917', avg_sales_period: 10, available_qty: 100 }),
    makeRow({ id: 'f3', sku_code: 'M918', avg_sales_period: 10, available_qty: 100 }),
    makeRow({ id: 'f4', sku_code: 'K500', avg_sales_period: 0, available_qty: 100 })
  ];
  // 模拟「搜索 M91」后服务端只返回 3 行
  const filtered = all.filter(r => r.sku_code.indexOf('M91') === 0);
  assert.strictEqual(filtered.length, 3);
  const rep = build(filtered);
  assert.strictEqual(rep.meta.skuTotal, 3);
  assert.strictEqual(rep.rows.length, 3);
  // 报告内不残留未匹配 SKU
  const skus = rep.rows.map(d => d.sku).sort();
  assert.deepStrictEqual(skus, ['M916', 'M917', 'M918']);
  // 各分类之和 = 筛选后 SKU 数
  assert.strictEqual(
    rep.health.purchaseCount + rep.health.overstockCount
    + rep.health.blockedOnlyCount + rep.health.noSalesCount + rep.health.normalCount, 3);
});
