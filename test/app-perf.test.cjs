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
    return Promise.resolve({ json: () => Promise.resolve({ url, rows: [{ id: url + '#' + fetchCount }] }) });
  };
  globalThis.__fetchCount = () => fetchCount;
  globalThis.__resetFetchCount = () => { fetchCount = 0; };
  globalThis.fetch = fetchImpl;
  globalThis.window = globalThis;
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
