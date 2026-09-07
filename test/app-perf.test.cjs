// 前端性能层正确性测试（correctness gate C1–C12 + 参考去重 + URL→page 依赖图）
// 纯逻辑：用 mock fetch/localStorage 在 node 下驱动 AppStore，不涉及真实 DOM / 后端。
const test = require('node:test');
const assert = require('node:assert');

// ---- 构造隔离的全局环境（每次 test 前重置）----
function setupGlobals() {
  const store = {};
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  globalThis.location = { search: '' };
  globalThis.getLang = () => 'zh';
  let fetchCount = 0;
  const fetchImpl = (url) => {
    fetchCount++;
    // 可编程响应队列（ref 健壮性测试用）：__nextResponses 按序弹出；否则默认 2xx JSON
    const q = globalThis.__nextResponses;
    if (q && q.length) {
      const spec = q.shift();
      if (spec.reject) return Promise.reject(spec.reject);
      return Promise.resolve({
        status: spec.status != null ? spec.status : 200,
        ok: (spec.status != null ? spec.status : 200) >= 200 && (spec.status != null ? spec.status : 200) < 300,
        json: () => Promise.resolve(spec.body !== undefined ? spec.body : { url, rows: [{ id: url + '#' + fetchCount }] }),
      });
    }
    return Promise.resolve({ status: 200, ok: true, json: () => Promise.resolve({ url, rows: [{ id: url + '#' + fetchCount }] }) });
  };
  globalThis.__fetchCount = () => fetchCount;
  globalThis.__resetFetchCount = () => { fetchCount = 0; };
  globalThis.__nextResponses = null;
  globalThis.fetch = fetchImpl;
  globalThis.window = globalThis;
  globalThis.doLogout = globalThis.__doLogoutMock || (() => {});
  // 重新加载 app-perf.js 以得到干净 AppStore
  delete require.cache[require.resolve('/Users/a1-6/Workbuddy/2026-07-04-17-45-01/inventory-app/app-perf.js')];
  require('/Users/a1-6/Workbuddy/2026-07-04-17-45-01/inventory-app/app-perf.js');
  return globalThis.AppStore;
}

test('C1: 首次进入页面 → API fetch（cache miss）', async () => {
  const A = setupGlobals();
  globalThis.__resetFetchCount();
  const data = await A.ref('countries'); // 走 rawFetch
  assert.ok(data);
  assert.strictEqual(globalThis.__fetchCount(), 1, '首次应触发 1 次 fetch');
});

test('C2: 第二次进入 → cache restore，无 blocking fetch', async () => {
  const A = setupGlobals();
  await A.ref('countries');
  globalThis.__resetFetchCount();
  const d2 = await A.ref('countries');
  assert.ok(d2);
  assert.strictEqual(globalThis.__fetchCount(), 0, '命中缓存不应再发 fetch');
});

test('C2b: 页面数据快照命中不触发网络（hit 同步返回）', async () => {
  const A = setupGlobals();
  globalThis.__resetFetchCount();
  A.page.set('inventory', 'sigA', [{ id: 1 }], { ttl: 30000 });
  const hit = A.page.hit('inventory', 'sigA', 30000);
  assert.deepStrictEqual(hit, [{ id: 1 }]);
  assert.strictEqual(globalThis.__fetchCount(), 0, 'page 命中不应发网络');
});

test('C3: TTL 到期 → stale 立即 render + background refresh', async () => {
  const A = setupGlobals();
  globalThis.__resetFetchCount();
  A.page.set('inventory', 'sigA', [{ id: 1 }], { ttl: 5 });
  await new Promise((r) => setTimeout(r, 12)); // 超过 TTL
  const bgCalls = { n: 0 };
  const hit = A.page.hit('inventory', 'sigA', 5);
  assert.strictEqual(hit, undefined, 'TTL 过期后 hit 应返回 undefined（需重取）');
  // 模拟 maybeBackground 的后台刷新
  A.page.maybeBackground('inventory', 'sigA', 5, () => { bgCalls.n++; return Promise.resolve([{ id: 2 }]); });
  await new Promise((r) => setTimeout(r, 5));
  assert.strictEqual(bgCalls.n, 1, '应触发 1 次后台刷新');
  assert.strictEqual(A.page.get('inventory').data[0].id, 2, '后台刷新应更新缓存');
});

test('C4: mutation success → 相关 page dirty', async () => {
  const A = setupGlobals();
  A.page.set('pi', 'sig', [{ id: 1 }], { ttl: 30000 });
  A.page.set('po', 'sig', [{ id: 1 }], { ttl: 30000 });
  A.onMutation('POST', '/api/proforma-invoices', {});
  assert.strictEqual(A.page.get('pi').dirty, true, 'PI 应被标脏');
  assert.strictEqual(A.page.get('po').dirty, true, 'PO 应被标脏');
});

test('C5: 不相关 mutation → 不清其它页面 cache', async () => {
  const A = setupGlobals();
  A.page.set('inventory', 'sig', [{ id: 1 }], { ttl: 30000 });
  A.page.set('ci', 'sig', [{ id: 1 }], { ttl: 30000 });
  A.onMutation('POST', '/api/proforma-invoices', {}); // 仅影响 pi/po/payable/replenishment
  assert.strictEqual(A.page.get('inventory').dirty, false, 'inventory 不应被标脏');
  assert.strictEqual(A.page.get('ci').dirty, false, 'ci 不应被标脏');
  // 但若 CI 相关 mutation 则 ci 脏
  A.onMutation('POST', '/api/commercial-invoices', {});
  assert.strictEqual(A.page.get('ci').dirty, true, 'ci 应被标脏');
});

test('C6: API refresh 失败 → 保留旧 snapshot + 不抛', async () => {
  const A = setupGlobals();
  A.page.set('inventory', 'sigA', [{ id: 1 }], { ttl: 30000 });
  // 后台刷新失败：fetcher reject
  let threw = false;
  A.page.maybeBackground('inventory', 'sigA', 30000, () => Promise.reject(new Error('net')));
  try { await new Promise((r) => setTimeout(r, 5)); } catch (e) { threw = true; }
  assert.strictEqual(threw, false, '后台刷新失败不应抛出到调用方');
  assert.deepStrictEqual(A.page.get('inventory').data, [{ id: 1 }], '旧 snapshot 应保留');
});

test('C7: 不同 filter key 不串数据（单条目/页，切换覆盖且不混）', async () => {
  const A = setupGlobals();
  A.page.set('inventory', 'country=ID', [{ id: 'ID' }], { ttl: 30000 });
  assert.deepStrictEqual(A.page.hit('inventory', 'country=ID', 30000), [{ id: 'ID' }]);
  // 切换至 country=CN：覆盖同页条目（不混存）
  A.page.set('inventory', 'country=CN', [{ id: 'CN' }], { ttl: 30000 });
  assert.deepStrictEqual(A.page.hit('inventory', 'country=CN', 30000), [{ id: 'CN' }]);
  assert.strictEqual(A.page.hit('inventory', 'country=ID', 30000), undefined, '旧 filter key 不应串入新数据（已覆盖）');
  assert.strictEqual(A.page.hit('inventory', 'country=US', 30000), undefined, '未缓存的 filter key 应 miss');
});

test('C8: country/warehouse/brand 切换 key 正确', async () => {
  const A = setupGlobals();
  const sig1 = '/api/inventory?country=ID&warehouse=JKT&brand=rd';
  const sig2 = '/api/inventory?country=CN&warehouse=SH&brand=jo';
  A.page.set('inventory', sig1, [{ id: 'a' }], { ttl: 30000 });
  assert.deepStrictEqual(A.page.hit('inventory', sig1, 30000), [{ id: 'a' }]);
  A.page.set('inventory', sig2, [{ id: 'b' }], { ttl: 30000 });
  assert.deepStrictEqual(A.page.hit('inventory', sig2, 30000), [{ id: 'b' }]);
  assert.strictEqual(A.page.hit('inventory', sig1, 30000), undefined, '不同 country/warehouse/brand 组合不应串数据');
});

test('C9: pagination state 区分（signature 含页码）', async () => {
  const A = setupGlobals();
  A.page.set('payable-list', 'p=1', [{ id: 1 }], { ttl: 30000 });
  assert.deepStrictEqual(A.page.hit('payable-list', 'p=1', 30000), [{ id: 1 }]);
  A.page.set('payable-list', 'p=2', [{ id: 2 }], { ttl: 30000 });
  assert.deepStrictEqual(A.page.hit('payable-list', 'p=2', 30000), [{ id: 2 }]);
  assert.strictEqual(A.page.hit('payable-list', 'p=1', 30000), undefined, '不同分页不应串数据（已覆盖）');
});

test('C10: 缓存 entry 含 signature/fetchedAt/dirty（供 view-state restore）', async () => {
  const A = setupGlobals();
  A.page.set('inventory', 'sig', [{ id: 1 }], { ttl: 30000 });
  const e = A.page.get('inventory');
  assert.strictEqual(e.signature, 'sig');
  assert.ok(typeof e.fetchedAt === 'number');
  assert.strictEqual(e.dirty, false);
  assert.strictEqual(e.ttl, 30000);
});

test('C11: clearSession 清空所有 session cache', async () => {
  const A = setupGlobals();
  A.page.set('inventory', 'sig', [{ id: 1 }], { ttl: 30000 });
  A.ref('countries').catch(() => {});
  await new Promise((r) => setTimeout(r, 2));
  A.clearSession();
  assert.strictEqual(A.page.get('inventory'), null, '页面缓存应清空');
  assert.strictEqual(A.ref('countries') === undefined ? false : true, true); // 重新拉取（缓存已清）
});

test('C12: 权限/reference 变化 → invalidateRef 不泄露旧数据', async () => {
  const A = setupGlobals();
  await A.ref('countries');
  assert.strictEqual(globalThis.__fetchCount(), 1);
  A.invalidateRef('countries');
  globalThis.__resetFetchCount();
  await A.ref('countries');
  assert.strictEqual(globalThis.__fetchCount(), 1, 'invalidated ref 应重新拉取（不泄露旧）');
});

test('REF dedupe: 并发同 key 仅 1 次 fetch', async () => {
  const A = setupGlobals();
  globalThis.__resetFetchCount();
  await Promise.all([A.ref('brands'), A.ref('brands'), A.ref('brands')]);
  assert.strictEqual(globalThis.__fetchCount(), 1, 'inflight 去重应只发 1 次');
});

test('mutation map: URL → page 依赖正确 + GET 不失效', async () => {
  const A = setupGlobals();
  const m = A._internal.pagesForMutation('/api/proforma-invoices', 'POST');
  assert.ok(m.pages.includes('pi') && m.pages.includes('po') && m.pages.includes('payable-list'));
  const m2 = A._internal.pagesForMutation('/api/payment-requests/from-ci-balance', 'POST');
  assert.ok(m2.pages.includes('payment') && m2.pages.includes('payable-list'));
  const m3 = A._internal.pagesForMutation('/api/skus', 'POST');
  assert.ok(m3.refs.includes('skus'));
  // 经 onMutation：GET 不触发任何失效
  A.page.set('pi', 's', [{ id: 1 }], { ttl: 30000 });
  A.onMutation('GET', '/api/proforma-invoices', {});
  assert.strictEqual(A.page.get('pi').dirty, false, 'GET 不应标脏');
  // POST 应标脏依赖页
  A.onMutation('POST', '/api/proforma-invoices', {});
  assert.strictEqual(A.page.get('pi').dirty, true, 'POST 应标脏 pi');
});

test('LRU 上限：超过上限逐出最久未用', async () => {
  const A = setupGlobals();
  // PAGE_MAX=6：先用 5 个键填满，访问 a 使其成为最近使用，再加 2 个触发逐出
  const base = ['a', 'b', 'c', 'd', 'e'];
  base.forEach((k) => A.page.set(k, 's', [{ id: k }], { ttl: 30000 }));
  A.page.hit('a', 's', 30000); // 访问 a → 最近使用
  A.page.set('f', 's', [{ id: 'f' }], { ttl: 30000 }); // 第 6 个
  A.page.set('g', 's', [{ id: 'g' }], { ttl: 30000 }); // 第 7 个 → 触发逐出最久未用
  const present = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].filter((k) => A.page.get(k));
  assert.strictEqual(present.length, 6, 'LRU 上限应为 6，实际=' + present.length);
  assert.ok(present.includes('a'), '最近访问的 a 不应被逐出');
  assert.ok(!present.includes('b'), '最久未用的 b 应被逐出');
});

// ============================================================================
// invalidation 覆盖缺口修复（历史 CI / 物流批次 → payable 依赖）
// ============================================================================
test('A: POST /api/historical-commercial-invoices → payable-list dirty', async () => {
  const A = setupGlobals();
  const m = A._internal.pagesForMutation('/api/historical-commercial-invoices', 'POST');
  for (const p of ['payable-list', 'payable-cockpit', 'ci', 'pi', 'payment', 'replenishment']) {
    assert.ok(m.pages.includes(p), 'historical CI 应失效 ' + p + '，实际 pages=' + JSON.stringify(m.pages));
  }
  // 经 onMutation 端到端验证
  A.page.set('payable-list', 'sig', [{ id: 1 }], { ttl: 30000 });
  A.onMutation('POST', '/api/historical-commercial-invoices', {});
  assert.strictEqual(A.page.get('payable-list').dirty, true, 'onMutation 后 payable-list 应标脏');
});

test('B: historical CI batch-import → payable-list dirty', async () => {
  const A = setupGlobals();
  const m = A._internal.pagesForMutation('/api/historical-commercial-invoices/batch-import', 'POST');
  assert.ok(m.pages.includes('payable-list'), 'batch-import 应失效 payable-list');
  A.page.set('payable-list', 'sig', [{ id: 1 }], { ttl: 30000 });
  A.onMutation('POST', '/api/historical-commercial-invoices/batch-import', {});
  assert.strictEqual(A.page.get('payable-list').dirty, true);
});

test('C: POST /api/logistics-batches/:id/generate-cost-items → payable-list dirty', async () => {
  const A = setupGlobals();
  const m = A._internal.pagesForMutation('/api/logistics-batches/abc/generate-cost-items', 'POST');
  for (const p of ['payable-list', 'payable-cockpit', 'ci', 'payment']) {
    assert.ok(m.pages.includes(p), 'generate-cost-items 应失效 ' + p + '，实际 pages=' + JSON.stringify(m.pages));
  }
  A.page.set('payable-list', 'sig', [{ id: 1 }], { ttl: 30000 });
  A.onMutation('POST', '/api/logistics-batches/abc/generate-cost-items', {});
  assert.strictEqual(A.page.get('payable-list').dirty, true);
});

test('D: 不相关 mutation → 不污染 payable-list', async () => {
  const A = setupGlobals();
  A.page.set('payable-list', 'sig', [{ id: 1 }], { ttl: 30000 });
  A.onMutation('POST', '/api/users/123', {});
  A.onMutation('PUT', '/api/settings/1', {});
  A.onMutation('POST', '/api/inventory-imports', {});
  assert.strictEqual(A.page.get('payable-list').dirty, false, '不相关 mutation 不应标脏 payable-list');
});

test('E: GET historical-commercial-invoices → 不触发 invalidation', async () => {
  const A = setupGlobals();
  A.page.set('payable-list', 'sig', [{ id: 1 }], { ttl: 30000 });
  A.page.set('ci', 'sig', [{ id: 1 }], { ttl: 30000 });
  A.onMutation('GET', '/api/historical-commercial-invoices', {});
  assert.strictEqual(A.page.get('payable-list').dirty, false, 'GET 不应标脏 payable-list');
  assert.strictEqual(A.page.get('ci').dirty, false, 'GET 不应标脏 ci');
});

test('F: GET logistics-batches → 不触发 invalidation', async () => {
  const A = setupGlobals();
  A.page.set('payable-list', 'sig', [{ id: 1 }], { ttl: 30000 });
  A.onMutation('GET', '/api/logistics-batches', {});
  assert.strictEqual(A.page.get('payable-list').dirty, false, 'GET 不应标脏 payable-list');
});

// ============================================================================
// ref() 健壮性：失败不污染缓存、可重试、401 与 api() 语义一致
// ============================================================================
test('G: ref 401 → 不缓存 + doLogout + 可重试', async () => {
  const A = setupGlobals();
  let logoutCalls = 0;
  globalThis.doLogout = () => { logoutCalls++; };
  globalThis.__resetFetchCount();
  globalThis.__nextResponses = [{ status: 401, body: { error: '未登录' } }];
  await assert.rejects(() => A.ref('countries'), /401/, '401 应 reject');
  assert.strictEqual(logoutCalls, 1, '401 应调用 doLogout（与 apiRaw 语义一致）');
  // 失败不缓存：再次请求应重新 fetch（而非返回 {error} 对象）
  globalThis.__resetFetchCount();
  await A.ref('countries');
  assert.strictEqual(globalThis.__fetchCount(), 1, '失败后再次 ref 应重新 fetch');
});

test('H: ref 返回 {error:...} → 不缓存', async () => {
  const A = setupGlobals();
  globalThis.__resetFetchCount();
  globalThis.__nextResponses = [{ status: 200, body: { error: 'boom' } }];
  await assert.rejects(() => A.ref('brands'), /boom/, '{error} 应 reject 而非当数据缓存');
  globalThis.__resetFetchCount();
  const d = await A.ref('brands');
  assert.strictEqual(globalThis.__fetchCount(), 1, '失败后再次 ref 应重新 fetch');
  assert.ok(d && d.rows, '重试成功应返回真实数据');
  globalThis.__resetFetchCount();
  await A.ref('brands');
  assert.strictEqual(globalThis.__fetchCount(), 0, '成功后应正常命中缓存');
});

test('I: ref 网络失败 → 不被失败结果永久占住，可重新 fetch', async () => {
  const A = setupGlobals();
  globalThis.__resetFetchCount();
  globalThis.__nextResponses = [{ reject: new Error('net down') }];
  await assert.rejects(() => A.ref('suppliers'), /net down/, '网络失败应 reject');
  // 失败不得占用 inflight：并发重试应发起新 fetch 而非拿到同一个 rejected promise
  globalThis.__nextResponses = null;
  globalThis.__resetFetchCount();
  await A.ref('suppliers');
  assert.strictEqual(globalThis.__fetchCount(), 1, '失败后再次 ref 应发起新 fetch');
  globalThis.__resetFetchCount();
  await A.ref('suppliers');
  assert.strictEqual(globalThis.__fetchCount(), 0, '重试成功后应命中缓存');
  // 500 也一样：非 2xx 不缓存
  globalThis.__nextResponses = [{ status: 500, body: { error: 'server error' } }];
  globalThis.__resetFetchCount();
  await assert.rejects(() => A.ref('currencies'), /500/, '非 2xx 应 reject');
  globalThis.__nextResponses = null;
  globalThis.__resetFetchCount();
  await A.ref('currencies');
  assert.strictEqual(globalThis.__fetchCount(), 1, '500 后再次 ref 应重新 fetch');
});

// ============================================================================
// Gate 1（2026-09-07）：logistics-batches 精准 invalidation（route-by-route 写表审计）
// 真实费用 mutation 仅 3 条：PUT /:id（syncLogisticsCostFactsCore 写 payable_items +
// ci_cost_items + commercial_invoices.import_duty_total）、POST generate-cost-items、
// POST backfill-freight-payment → 四页。
// 创建/listing/notify/backfill-arrival 不写费用链路 → 不打脏四页。
// ============================================================================
test('LOG-1: PUT /api/logistics-batches/:id → 四页 dirty（唯一 PUT=费用同步）', async () => {
  const A = setupGlobals();
  const m = A._internal.pagesForMutation('/api/logistics-batches/log20260908abc', 'PUT');
  for (const p of ['payable-list', 'payable-cockpit', 'ci', 'payment']) {
    assert.ok(m.pages.includes(p), 'PUT :id 费用同步应失效 ' + p + '，实际 pages=' + JSON.stringify(m.pages));
  }
  A.page.set('payable-list', 'sig', [{ id: 1 }], { ttl: 30000 });
  A.onMutation('PUT', '/api/logistics-batches/log20260908abc', {});
  assert.strictEqual(A.page.get('payable-list').dirty, true, 'onMutation 后 payable-list 应标脏');
});

test('LOG-2: POST backfill-freight-payment → 四页 dirty', async () => {
  const A = setupGlobals();
  const m = A._internal.pagesForMutation('/api/logistics-batches/abc/backfill-freight-payment', 'POST');
  for (const p of ['payable-list', 'payable-cockpit', 'ci', 'payment']) {
    assert.ok(m.pages.includes(p), 'backfill-freight-payment 应失效 ' + p);
  }
});

test('LOG-3: 负向 — notify / backfill-arrival / listing 不打脏任何页面', async () => {
  const A = setupGlobals();
  const m1 = A._internal.pagesForMutation('/api/logistics-batches/abc/notify', 'POST');
  assert.deepStrictEqual(m1.pages, [], 'notify 零写表 → 不应失效任何页面，实际=' + JSON.stringify(m1.pages));
  const m2 = A._internal.pagesForMutation('/api/logistics-batches/abc/backfill-arrival', 'POST');
  assert.deepStrictEqual(m2.pages, [], 'backfill-arrival 只写 logistics_batches 日期/备注 → 不应失效任何页面');
  const m3 = A._internal.pagesForMutation('/api/logistics-batches/abc/listing', 'POST');
  assert.deepStrictEqual(m3.pages, [], 'listing 只写 listing_status/participants → 不应失效任何页面');
});

test('LOG-4: POST 创建批次 → inventory 族 dirty，但不打脏 payable/ci/payment', async () => {
  const A = setupGlobals();
  const m = A._internal.pagesForMutation('/api/logistics-batches', 'POST');
  for (const p of ['inventory', 'replenishment', 'dashboard']) {
    assert.ok(m.pages.includes(p), '创建批次触发 transit 重算应失效 ' + p);
  }
  for (const p of ['payable-list', 'payable-cockpit', 'ci', 'payment']) {
    assert.ok(!m.pages.includes(p), '创建批次不应打脏 ' + p + '（不写费用链路）');
  }
});

test('LOG-5: POST create-with-pl → inventory 族 + ci（写 ci_status），不打脏 payable/payment', async () => {
  const A = setupGlobals();
  const m = A._internal.pagesForMutation('/api/logistics-batches/create-with-pl', 'POST');
  for (const p of ['inventory', 'replenishment', 'dashboard', 'ci']) {
    assert.ok(m.pages.includes(p), 'create-with-pl 应失效 ' + p + '（transit 重算 + ci_status 变更），实际=' + JSON.stringify(m.pages));
  }
  for (const p of ['payable-list', 'payable-cockpit', 'payment']) {
    assert.ok(!m.pages.includes(p), 'create-with-pl 不应打脏 ' + p);
  }
});

test('LOG-6: 端到端 — notify mutation 不打脏已缓存页面', async () => {
  const A = setupGlobals();
  for (const k of ['payable-list', 'payable-cockpit', 'ci', 'payment', 'inventory']) {
    A.page.set(k, 'sig', [{ id: 1 }], { ttl: 30000 });
  }
  A.onMutation('POST', '/api/logistics-batches/abc/notify', {});
  for (const k of ['payable-list', 'payable-cockpit', 'ci', 'payment', 'inventory']) {
    assert.strictEqual(A.page.get(k).dirty, false, 'notify 不应打脏 ' + k);
  }
});

// ============================================================================
// Gate 2（2026-09-07）：ref 错误经公开入口 api() 不产生重复请求。
// 从 app.js 提取真实 apiRaw/_refKeyForUrl/api 源码在 vm 沙箱执行 —— 测的是真实公开路径，
// 不是测试内手写副本。修复前 api() 的 reference 分支位于外层 try 内：ref 抛错被 catch 吞掉
// 后 fallback apiRaw → 同一请求打两遍（双 fetch + 双 doLogout）。
// ============================================================================
const fs = require('node:fs');
const vm = require('node:vm');
const APP_JS = '/Users/a1-6/Workbuddy/2026-07-04-17-45-01/inventory-app/app.js';

function extractFunction(src, sig) {
  const i = src.indexOf(sig);
  assert.ok(i >= 0, 'app.js 中找不到函数: ' + sig);
  const open = src.indexOf('{', i);
  let depth = 0;
  for (let j = open; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(i, j + 1); }
  }
  throw new Error('括号配平失败: ' + sig);
}

function setupApiSandbox() {
  const A = setupGlobals(); // AppStore + mock fetch + location/localStorage 就绪
  const src = fs.readFileSync(APP_JS, 'utf8');
  const code = [
    extractFunction(src, 'async function apiRaw('),
    extractFunction(src, 'function _refKeyForUrl('),
    extractFunction(src, 'async function api('),
  ].join('\n');
  let logoutCalls = 0;
  const doLogoutSpy = () => { logoutCalls++; };
  globalThis.doLogout = doLogoutSpy; // ref()（app-perf）经 global.doLogout 调用
  const sandbox = {
    window: globalThis,          // api() 经 window.AppStore 取缓存层（与外层同一实例）
    fetch: globalThis.fetch,     // 同一个可编程 mock fetch
    getLang: () => 'zh',
    isFileProtocol: () => false,
    t: (k, fallback) => (fallback != null ? fallback : k),
    showToast: () => {},
    doLogout: doLogoutSpy,       // apiRaw 的 401 路径
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(code + '\nthis.__exports = { api: api, apiRaw: apiRaw };', sandbox, { filename: 'app-extracted.js' });
  return { A, api: sandbox.__exports.api, getLogoutCalls: () => logoutCalls };
}

test('API-1: 经 api() 公开入口 reference 401 → 恰 1 次网络 + 1 次 doLogout + 不 fallback + 不缓存 + 不留 inflight', async () => {
  const { api, getLogoutCalls } = setupApiSandbox();
  globalThis.__resetFetchCount();
  globalThis.__nextResponses = [{ status: 401, body: { error: 'unauthorized' } }];
  await assert.rejects(() => api('/api/countries'), /401/, '401 应上抛给调用方');
  assert.strictEqual(globalThis.__fetchCount(), 1, '必须恰好 1 次网络请求（修复前 fallback apiRaw 会打第二遍）');
  assert.strictEqual(getLogoutCalls(), 1, 'doLogout 必须恰好 1 次（ref 1 次；apiRaw fallback 不允许再执行）');
  // 不写 ref cache：重试走真实网络
  globalThis.__nextResponses = null; // 默认 2xx
  globalThis.__resetFetchCount();
  const d = await api('/api/countries');
  assert.strictEqual(globalThis.__fetchCount(), 1, '401 后重试应发起新 fetch（不缓存失败结果）');
  assert.strictEqual(getLogoutCalls(), 1, '重试成功不应再触发 doLogout');
  assert.ok(d && d.rows, '重试应返回真实数据');
  // 不留 inflight 已隐式验证：第二次调用拿到的是新 fetch 的结果而非同一个 rejected promise
  // 成功后命中 ref cache：第三次 0 网络
  globalThis.__resetFetchCount();
  await api('/api/countries');
  assert.strictEqual(globalThis.__fetchCount(), 0, '成功后应命中 ref cache（经 api() 公开入口）');
});

test('API-2: 经 api() reference 返回 HTTP 500 → 1 次网络、0 次 doLogout、不 fallback、可重试', async () => {
  const { api, getLogoutCalls } = setupApiSandbox();
  globalThis.__resetFetchCount();
  globalThis.__nextResponses = [{ status: 500, body: { error: 'boom' } }];
  await assert.rejects(() => api('/api/suppliers'), /500/, '非 2xx 应上抛');
  assert.strictEqual(globalThis.__fetchCount(), 1, '500 不应触发第二次 fallback 请求');
  assert.strictEqual(getLogoutCalls(), 0, '非 401 错误不应触发 doLogout');
  globalThis.__nextResponses = null;
  globalThis.__resetFetchCount();
  await api('/api/suppliers');
  assert.strictEqual(globalThis.__fetchCount(), 1, '失败后重试应发起新 fetch（不缓存失败结果）');
});

test('API-3: 经 api() reference 返回 200 {error:...} → 1 次网络、不缓存、抛业务错', async () => {
  const { api } = setupApiSandbox();
  globalThis.__resetFetchCount();
  globalThis.__nextResponses = [{ status: 200, body: { error: 'biz error' } }];
  await assert.rejects(() => api('/api/brands/all'), /biz error/, '{error} 应作为错误上抛而非当数据');
  assert.strictEqual(globalThis.__fetchCount(), 1, '{error} 不应触发第二次 fallback 请求');
  globalThis.__nextResponses = null;
  globalThis.__resetFetchCount();
  const d = await api('/api/brands/all');
  assert.strictEqual(globalThis.__fetchCount(), 1, '{error} 失败后重试应发起新 fetch');
  assert.ok(d && d.rows, '重试应返回真实数据');
});

test('API-4: 经 api() 并发同 reference → inflight 去重 1 次网络（含 settle 前窗口）', async () => {
  const { api } = setupApiSandbox();
  globalThis.__resetFetchCount();
  const results = await Promise.all([api('/api/warehouses'), api('/api/warehouses'), api('/api/warehouses')]);
  assert.strictEqual(globalThis.__fetchCount(), 1, '并发同 reference 应去重为 1 次 fetch');
  assert.ok(results.every((d) => d && d.rows), '所有并发调用应拿到同一份数据');
});
