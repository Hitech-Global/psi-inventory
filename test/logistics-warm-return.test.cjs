'use strict';

/**
 * LOGISTICS-WARM-RETURN-P1 — 前端缓存失效依赖图测试（TEST L9 / L10 / L11）
 *
 * 验证 app-perf.js 的 pagesForMutation：
 *   - 任何 /api/logistics-batches 写操作（新增/编辑/生成费用/补录运费/Listing/到货）都必须打脏 'logistics' 页缓存
 *     （L10 真实 mutation → invalidation；对齐需求 Section VI「修改时效/到货状态必须 invalidate」）。
 *   - 例外：notify 为纯通知（不改列表任何展示列）→ 不打脏 logistics（避免无效刷新）。
 *   - 非物流 mutation（如 payment-requests）不得打脏 'logistics'（L9 负向：navigation 类变更不连坐）。
 *   - logout/clearSession 清掉 logistics 缓存（L11 由 AppStore.clearSession 实现）。
 *
 * 纯逻辑测试：直接加载 app-perf.js（IIFE 挂到 globalThis.AppStore），不涉及浏览器/DOM/后端。
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

require('../app-perf'); // 挂到 globalThis.AppStore
const AppStore = globalThis.AppStore;
const pagesForMutation = AppStore._internal.pagesForMutation;

// 必须打脏 logistics 的物流批次写操作（notify 为纯通知，例外，单独负向断言）
const LOGI_MUTATIONS = [
  ['POST', '/api/logistics-batches'],
  ['POST', '/api/logistics-batches/create-with-pl'],
  ['PUT', '/api/logistics-batches/abc-123'],
  ['POST', '/api/logistics-batches/abc-123/generate-cost-items'],
  ['POST', '/api/logistics-batches/abc-123/backfill-freight-payment'],
  ['POST', '/api/logistics-batches/abc-123/listing'],
  ['POST', '/api/logistics-batches/abc-123/backfill-arrival'],
];

test('L10：物流批次写操作（notify 除外）均打脏 logistics 页缓存', () => {
  for (const [m, u] of LOGI_MUTATIONS) {
    const { pages } = pagesForMutation(u, m);
    assert.ok(pages.includes('logistics'), `${m} ${u} 必须打脏 logistics（实际 pages=${JSON.stringify(pages)}）`);
  }
});

test('L10-negative：notify 为纯通知，不打脏 logistics（避免无效刷新）', () => {
  const { pages } = pagesForMutation('/api/logistics-batches/abc-123/notify', 'POST');
  assert.ok(!pages.includes('logistics'), `notify 不应打脏 logistics（实际 pages=${JSON.stringify(pages)}）`);
});

test('L9：非物流 mutation 不得打脏 logistics（navigation 类变更不连坐）', () => {
  const nonLogi = [
    ['PUT', '/api/payment-requests/pr-1'],
    ['POST', '/api/payment-requests'],
    ['PUT', '/api/proforma-invoices/pi-1'],
    ['POST', '/api/commercial-invoices'],
  ];
  for (const [m, u] of nonLogi) {
    const { pages } = pagesForMutation(u, m);
    assert.ok(!pages.includes('logistics'), `非物流 ${m} ${u} 不应打脏 logistics（实际 pages=${JSON.stringify(pages)}）`);
  }
});

test('L11：AppStore.clearSession 清空 page 缓存（logout/用户切换）', () => {
  AppStore.clearSession();
  AppStore.page.set('logistics', 'log:', [{ id: 'x' }], { ttl: 30000 });
  assert.ok(AppStore.page.get('logistics'), 'set 后应有 logistics 缓存');
  AppStore.clearSession();
  assert.equal(AppStore.page.get('logistics'), null, 'clearSession 后 logistics 缓存应被清空');
});

test('L5：命中且新鲜的 logistics 缓存同步返回、不触发网络（page.hit 契约）', () => {
  AppStore.clearSession();
  const data = [{ id: 'a', batch_no: 'B1' }];
  AppStore.page.set('logistics', 'log:in_transit', data, { ttl: 30000 });
  const hit = AppStore.page.hit('logistics', 'log:in_transit', 30000);
  assert.notEqual(hit, undefined, '命中且新鲜应返回缓存数据（非 undefined）');
  assert.deepEqual(hit, data, 'hit 返回的数据应与缓存一致');
});

test('L5：dirty 的 logistics 缓存 hit 返回 undefined（强制 cold reload）', () => {
  AppStore.clearSession();
  AppStore.page.set('logistics', 'log:', [{ id: 'b' }], { ttl: 30000 });
  AppStore.page.markDirty('logistics');
  const hit = AppStore.page.hit('logistics', 'log:', 30000);
  assert.equal(hit, undefined, 'dirty 后 hit 必须返回 undefined 以触发重新拉取');
});
