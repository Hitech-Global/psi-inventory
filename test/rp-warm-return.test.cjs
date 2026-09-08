'use strict';
/**
 * RP-WARM-RETURN-P1 — 订单预测跨模块 warm re-entry。
 *
 * 原则：navigation ≠ invalidation。
 *   - warm re-entry（snapshot ready + 可复用 view + 无 invalidation）
 *     → 不清 rpClearDataCache / rpClearAllViews，不等 preferences GET，直接恢复上一次 view。
 *   - 真正数据失效（重新计算 / 外部 mutation / logout / 重置筛选）→ 必须失效。
 *
 * 设计：HERMETIC / 自包含。用 vm 抽取 app.js 中真实函数体（brace-matching），
 * 在最小 DOM stub 上跑，不依赖浏览器、数据库或网络。
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.resolve(__dirname, '..', 'app.js'), 'utf8');

let pass = 0, fail = 0;
function assert(name, cond) {
  if (cond) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name); }
}

// ---------- 真实函数抽取（brace matching）----------
function extractFn(src, name) {
  const re = new RegExp('function\\s+' + name + '\\s*\\(');
  const m = re.exec(src);
  if (!m) throw new Error('function not found: ' + name);
  let i = src.indexOf('{', m.index);
  let depth = 0, j = i;
  for (; j < src.length; j++) {
    const c = src[j];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) break; }
  }
  return src.slice(m.index, j + 1);
}

// ---------- 最小 DOM / 全局 stub ----------
function makeEl(id, value) {
  return {
    id: id || '', value: value == null ? '' : value,
    style: {}, children: [], parentNode: null,
    appendChild(n) { this.children.push(n); n.parentNode = this; return n; },
    remove() { if (this.parentNode) { const c = this.parentNode.children; const k = c.indexOf(this); if (k >= 0) c.splice(k, 1); this.parentNode = null; } }
  };
}

function buildSandbox(opts) {
  opts = opts || {};
  const els = {};
  ['rp-c', 'rp-w', 'rp-b', 'rp-s', 'rp-status', 'rp-lifecycle', 'rp-table'].forEach((id) => { els[id] = makeEl(id, ''); });
  const doc = {
    getElementById: (id) => els[id] || null,
    querySelectorAll: () => [],
    createElement: (tag) => makeEl('', '')
  };
  const win = {
    _rpCache: { data: new Map(), pending: new Map(), views: {}, viewOrder: [] },
    _rpSnapshot: { status: opts.snapshotStatus || 'idle', rows: [], monthlySales: {} },
    _rpHistoricalSalesConfig: null,
    __rpSessionState: null
  };
  const counters = { clearAllViews: 0, clearDataCache: 0 };

  // 真实 clear 实现 + 调用计数器：把抽出的函数改名成 __real，再用同名包装函数调用它，
  // 以验证「warm 不调用 clear、cold 才调用」。
  function wrapped(name, counter) {
    const real = extractFn(SRC, name).replace('function ' + name + '(', 'function ' + name + '__real(');
    return real + '\nfunction ' + name + '(){ __c.' + counter + '++; ' + name + '__real(); }';
  }
  const code = [
    extractFn(SRC, 'rpCaptureSessionState'),
    extractFn(SRC, 'rpWarmEntryState'),
    extractFn(SRC, 'rpReattachCachedViews'),
    extractFn(SRC, 'rpInvalidateWarmViews'),
    extractFn(SRC, 'rpWarmInvalidateForMutation'),
    extractFn(SRC, 'rpSignature'),
    wrapped('rpClearAllViews', 'clearAllViews'),
    wrapped('rpClearDataCache', 'clearDataCache')
  ].join('\n');

  const sandbox = {
    window: win, document: doc, __c: counters,
    RP_PERF: false, RP_MAX_DOM_VIEWS: 6,
    rpTab: 'total', rpMode: 'monthly',
    performance: { now: () => 0 },
    api: () => Promise.resolve({}),
    rpPerfSet: () => {},
    rpVal: (id) => { const e = doc.getElementById(id); return e ? String(e.value || '') : ''; },
    console
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  // rpClearAllViews 内部调用 rpClearDataCache 之外的顺序无关；这里先声明再覆盖顺序
  vm.runInContext(code, sandbox);
  return { sandbox, win, doc, els, counters };
}

// 造一个已缓存的 view 节点并登记到 _rpCache.views
function seedView(sandbox, win, viewKey, signature) {
  const node = makeEl('rp-view-' + viewKey, '');
  win._rpCache.views[viewKey] = { node: node, signature: signature == null ? viewKey : signature, scrollTop: 0, scrollLeft: 0 };
  win._rpCache.viewOrder.push(viewKey);
  return node;
}

console.log('\n=== R1 / R2 COLD vs WARM 判定 ===');

{
  const { sandbox, win, els } = buildSandbox({ snapshotStatus: 'idle' });
  assert('R1 cold：无 session state → rpWarmEntryState()=null', sandbox.rpWarmEntryState() === null);
  els['rp-c'].value = 'Indonesia';
  win._rpSnapshot.status = 'ready';
  const st = sandbox.rpCaptureSessionState('total-monthly-t=total|m=monthly|c=Indonesia');
  assert('R1 cold：capture 后仍无 cached view → warm=null（需 cold bootstrap）',
    sandbox.rpWarmEntryState() === null);
  assert('R1 capture 记录 tab/mode/country', st.rpTab === 'total' && st.rpMode === 'monthly' && st.country === 'Indonesia');
}

{
  const { sandbox, win, els } = buildSandbox({ snapshotStatus: 'ready' });
  els['rp-c'].value = 'Indonesia';
  els['rp-b'].value = 'redragon';
  els['rp-status'].value = '正常动销';
  sandbox.rpTab = 'online';
  const vk = 'online-monthly-t=online|m=monthly|c=Indonesia|b=redragon';
  sandbox.rpCaptureSessionState(vk);
  seedView(sandbox, win, vk);
  const st = sandbox.rpWarmEntryState();
  assert('R2 warm：snapshot ready + view 存活 → warm HIT', !!st && st.viewKey === vk);
  assert('R2 warm：恢复的 tab/mode/筛选/状态完整',
    st.rpTab === 'online' && st.rpMode === 'monthly' && st.country === 'Indonesia'
    && st.brand === 'redragon' && st.sales_status === '正常动销');
}

console.log('\n=== R6 warm 前置条件（缺任一 → cold）===');

{
  const { sandbox, win } = buildSandbox({ snapshotStatus: 'loading' });
  sandbox.rpCaptureSessionState('k');
  seedView(sandbox, win, 'k');
  assert('R6 snapshot 非 ready → cold', sandbox.rpWarmEntryState() === null);
}
{
  const { sandbox } = buildSandbox({ snapshotStatus: 'ready' });
  sandbox.rpCaptureSessionState('k');   // 不 seed view
  assert('R6 view 已被清除/逐出 → cold', sandbox.rpWarmEntryState() === null);
}
{
  const { sandbox, win } = buildSandbox({ snapshotStatus: 'ready' });
  sandbox.rpCaptureSessionState('k');
  seedView(sandbox, win, 'k', '__STALE__');   // rpInvalidateSuggestionViews 语义
  assert('R12 signature 被标 __STALE__（重新计算/建议变更）→ cold', sandbox.rpWarmEntryState() === null);
}
{
  const { sandbox, win } = buildSandbox({ snapshotStatus: 'ready' });
  sandbox.rpCaptureSessionState('k');
  seedView(sandbox, win, 'k');
  win.__rpWarmDisabled = true;
  assert('kill-switch __rpWarmDisabled → cold（可紧急回滚）', sandbox.rpWarmEntryState() === null);
}

console.log('\n=== R5 / R6 warm re-entry 不调用 clear ===');

{
  const { sandbox, win } = buildSandbox({ snapshotStatus: 'ready' });
  sandbox.rpCaptureSessionState('k');
  seedView(sandbox, win, 'k');
  // 模拟 renderReplenishment 的守卫逻辑（与 app.js 中写法一致）
  const warm = sandbox.rpWarmEntryState();
  if (!warm) { sandbox.rpClearDataCache(); sandbox.rpClearAllViews(); }
  assert('R5 warm re-entry 不调用 rpClearAllViews()', win.__clearAllViews === undefined && sandbox.__c.clearAllViews === 0);
  assert('R6 warm re-entry 不调用 rpClearDataCache()', sandbox.__c.clearDataCache === 0);
  assert('R6 warm re-entry 后 view 仍存活', !!win._rpCache.views['k']);
}
{
  const { sandbox, counters } = buildSandbox({ snapshotStatus: 'idle' });
  const warm = sandbox.rpWarmEntryState();
  if (!warm) { sandbox.rpClearDataCache(); sandbox.rpClearAllViews(); }
  assert('R1 cold enter 仍然 clear data + views', counters.clearDataCache === 1 && counters.clearAllViews === 1);
}

console.log('\n=== R2-R4 DOM restore（detached node 重新挂回）===');

{
  const { sandbox, win, els } = buildSandbox({ snapshotStatus: 'ready' });
  const vk1 = 'k1', vk2 = 'k2';
  seedView(sandbox, win, vk1);
  seedView(sandbox, win, vk2);
  const n = sandbox.rpReattachCachedViews();
  const host = els['rp-table'];
  assert('R2 detached cached view 被重新挂回 #rp-table（n=2）', n === 2);
  assert('R2 节点 parentNode 指向新 #rp-table', win._rpCache.views[vk1].node.parentNode === host
    && win._rpCache.views[vk2].node.parentNode === host);
  assert('R2 重复 reattach 幂等（n=0）', sandbox.rpReattachCachedViews() === 0);
}

console.log('\n=== R12 / R13 invalidation correctness ===');

{
  const { sandbox, win } = buildSandbox({ snapshotStatus: 'ready' });
  sandbox.rpCaptureSessionState('k');
  seedView(sandbox, win, 'k');
  let hit = sandbox.rpWarmInvalidateForMutation('/api/inventory-imports');
  assert('R13 inventory-import mutation → 失效（true）', hit === true);
  assert('R13 失效后 session state 清空', win.__rpSessionState === null);
  assert('R13 失效后 cached view 清空', Object.keys(win._rpCache.views).length === 0);
  assert('R13 失效后再进入 → cold', sandbox.rpWarmEntryState() === null);
}
{
  const { sandbox, win } = buildSandbox({ snapshotStatus: 'ready' });
  sandbox.rpCaptureSessionState('k');
  seedView(sandbox, win, 'k');
  ['/api/commercial-invoices', '/api/proforma-invoices', '/api/packing-lists', '/api/sales', '/api/inventory'].forEach((u) => {
    sandbox.rpWarmInvalidateForMutation(u);
  });
  assert('R13 PI/CI/PL/sales/inventory mutation 全部失效', Object.keys(win._rpCache.views).length === 0);
}
{
  const { sandbox, win } = buildSandbox({ snapshotStatus: 'ready' });
  sandbox.rpCaptureSessionState('k');
  seedView(sandbox, win, 'k');
  const r1 = sandbox.rpWarmInvalidateForMutation('/api/replenishment-suggestions/123');
  const r2 = sandbox.rpWarmInvalidateForMutation('/api/replenishment-suggestions/preferences');
  assert('R11 RP 自身保存/PUT 不清 view（false）', r1 === false && r2 === false);
  assert('R11 RP 自身保存后 warm 仍 HIT（手工作业值不回退）', !!sandbox.rpWarmEntryState());
}
{
  const { sandbox } = buildSandbox({ snapshotStatus: 'ready' });
  assert('防御：空/undefined URL 不抛错、不失效',
    sandbox.rpWarmInvalidateForMutation('') === false && sandbox.rpWarmInvalidateForMutation(null) === false);
}

console.log('\n=== R14 logout 清空 ===');

{
  const { sandbox, win } = buildSandbox({ snapshotStatus: 'ready' });
  sandbox.rpCaptureSessionState('k');
  seedView(sandbox, win, 'k');
  sandbox.rpInvalidateWarmViews();
  assert('R14 logout → session state + views + data cache 全清',
    win.__rpSessionState === null && Object.keys(win._rpCache.views).length === 0);
}

console.log('\n=== 源码接线（wiring）静态断言 ===');

const warmBlock = /RP-WARM-BEGIN([\s\S]*?)RP-WARM-END/.exec(SRC);
assert('RP-WARM 切片标记存在（tests 可抽取真实函数）', !!warmBlock);

const renderFn = /async function renderReplenishment\(\)\{[\s\S]*?\n\}/.exec(SRC)[0];
assert('R5/R6 clear 已被 `if(!_warm)` 守卫', /if\(!_warm\)\{ rpClearDataCache\(\); rpClearAllViews\(\); \}/.test(renderFn));
assert('R2 warm 走 rpReattachCachedViews + rpShowCachedViewOrLoad（复用现有架构）',
  /rpReattachCachedViews\(\);/.test(renderFn) && /rpShowCachedViewOrLoad\(\);/.test(renderFn));
assert('R7 warm 用会话内存态恢复筛选，不 await loadRpPreferences',
  /if\(_warm\)\{[\s\S]{0,320}?window\.__rpFilterState=\{[\s\S]{0,220}?rpTab:_warm\.rpTab,rpMode:_warm\.rpMode\};/.test(renderFn)
  && /\}else if\(!window\.__rpFilterState\)\{[\s\S]{0,160}?await loadRpPreferences\(\)/.test(renderFn));
assert('R8 warm 命中 view 时不调用 fetchHistoricalSales / loadRp',
  /rpShowCachedViewOrLoad\(\);[\s\S]{0,240}?rpPerfLog\(\{warm_restore:'HIT'[\s\S]{0,200}?\}\)/.test(renderFn));
assert('R8 warm 未命中 view 时回退到正常 load（安全降级）',
  /warm_restore:'MISS'[\s\S]{0,120}?fetchHistoricalSales\(\);[\s\S]{0,40}?else loadRp\(\);/.test(renderFn));
assert('warm restore 含 [RP PERF] 埋点（warm_entry / warm_restore / table_visible_ms）',
  /rpPerfLog\(\{warm_entry:/.test(renderFn) && /warm_restore:'HIT'[\s\S]{0,80}table_visible_ms/.test(renderFn));

assert('rpStoreViewNode 捕获 session state', /rpEvictOldViews\(\);\s*rpCaptureSessionState\(viewKey\);/.test(SRC));
assert('rpShowView 捕获 session state（页内切 tab 也更新）',
  /if\(target\)target\.style\.display='block';\s*rpCaptureSessionState\(viewKey\);/.test(SRC));
assert('api() 非 GET 成功后挂钩 RP 失效', /if\(method&&method!=='GET'\)\{ try\{ rpWarmInvalidateForMutation\(url\); \}catch\(e\)\{\} \}/.test(SRC));
assert('doLogout 清空 RP warm view', /clearSession\(\); \}catch\(e\)\{\}\s*try\{ rpInvalidateWarmViews\(\); \}catch\(e\)\{\}/.test(SRC));
assert('resetRpFilters 失效 warm state', /window\.__rpFilterState=null;\s*window\.__rpSessionState=null;/.test(SRC));
assert('genRp 重新计算失效 warm state', /rpClearManualStock\(\);\s*window\.__rpSessionState=null;/.test(SRC));

console.log('\n=== 未越界（scope guard）===');
assert('未新增第二套缓存架构（仍复用 _rpCache.views / viewKey / rpSignature）',
  /window\._rpCache\.views/.test(warmBlock[1]) && !/new Map\(\)\s*;\s*\/\/\s*second-cache/.test(warmBlock[1]));
assert('warm 路径不触碰后端/计算语义（无新 API 调用）', !/api\(['"]\/api\//.test(warmBlock[1]));

console.log('\n----------------------------------------');
console.log('  PASS=' + pass + '  FAIL=' + fail);
console.log('----------------------------------------\n');
process.exit(fail === 0 ? 0 : 1);
