'use strict';
// Focused test: SALES NAV ORDER — 订单预测 becomes the first sidebar item and the
// default landing page for the top-level 销售 module (same minimal pattern as the
// inventory reorder in 10499cc).
//
// Scope guard: this is a NAVIGATION-ONLY change. The test intentionally asserts
// (a) the new order, (b) permission-aware fallback still resolves via
//     "first permitted item" (no hardcoded showPage), and
// (c) the order-forecast warm-restore machinery is byte-identical / untouched
//     (snapshot reuse guard, filter-state restore, DOM view LRU, routing table).
//
// Does not load app.js (browser-coupled); parses the NAV_MODULES literal + asserts
// static invariants on the RP warm path.

const fs = require('fs');
const path = require('path');

const APP_JS = fs.readFileSync(path.resolve(__dirname, '..', 'app.js'), 'utf8');

let pass = 0, fail = 0;
function assert(name, cond) {
  if (cond) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name); }
}

// --- extract NAV_MODULES items (order-preserving) ---
function moduleItems(modId) {
  const m = new RegExp(
    "\\{id:'" + modId + "',[\\s\\S]*?items:\\[([\\s\\S]*?)\\]\\}"
  ).exec(APP_JS);
  if (!m) return null;
  return Array.from(m[1].matchAll(/\{id:'([^']+)'[\s\S]*?perm:'([^']+)'/g))
    .map((x) => ({ id: x[1], perm: x[2] }));
}

// mirror of switchModule(): "const first=mod.items.find(it=>hasPermission(it.perm))"
function firstPermitted(items, permitted) {
  return (items.find((it) => permitted.has(it.perm)) || {}).id;
}

console.log('\n=== SALES NAV ORDER ===');

const sales = moduleItems('sales');
assert('sales module found with 2 items', !!sales && sales.length === 2);
assert('S2 sidebar #1 = replenishment (订单预测)', sales[0].id === 'replenishment');
assert('S2 sidebar #2 = outbound (销售数据)', sales[1].id === 'outbound');
assert('replenishment keeps perm replenishment_view', sales[0].perm === 'replenishment_view');
assert('outbound keeps perm outbound_view', sales[1].perm === 'outbound_view');

console.log('\n=== S1 DEFAULT ENTRY = FIRST PERMITTED ITEM (no hardcode) ===');

const ALL = new Set(['replenishment_view', 'outbound_view']);
assert('S1 both perms -> 订单预测', firstPermitted(sales, ALL) === 'replenishment');
assert('S1 no replenishment_view -> fallback 销售数据',
  firstPermitted(sales, new Set(['outbound_view'])) === 'outbound');
assert('S1 no outbound_view -> 订单预测',
  firstPermitted(sales, new Set(['replenishment_view'])) === 'replenishment');
assert('S1 neither perm -> no auto page (module hidden by renderTopNav)',
  firstPermitted(sales, new Set()) === undefined);
assert('S1 no hardcoded showPage("replenishment") in switchModule',
  !/function switchModule\(modId\)\{[\s\S]{0,400}?showPage\(['"]replenishment['"]\)/.test(APP_JS));
assert('S1 switchModule still uses first-permitted resolution',
  /const first=mod\.items\.find\(it=>hasPermission\(it\.perm\)\);[\s\S]{0,60}if\(first\)showPage\(first\.id\)/.test(APP_JS));

console.log('\n=== NO REGRESSION: OTHER MODULES UNTOUCHED ===');

const inv = moduleItems('inventory');
assert('inventory #1 still 库存总表 (10499cc intact)', inv[0].id === 'inventory');
assert('inventory #2 still SKU主数据', inv[1].id === 'skus');
const proc = moduleItems('procurement');
assert('procurement #1 still po', proc[0].id === 'po');
const fin = moduleItems('finance');
assert('finance #1 still payable-cockpit', fin[0].id === 'payable-cockpit');

console.log('\n=== S3-S6 WARM RESTORE MACHINERY UNTOUCHED (static invariants) ===');

assert('S3 route table still maps replenishment -> renderReplenishment',
  /replenishment:renderReplenishment/.test(APP_JS));
assert('S4 snapshot warm guard intact (status ready -> no bootstrap GET)',
  /async function rpBootstrapSnapshot\(\)\{[\s\S]{0,200}?if\(s\.status==='ready'\) return true;/.test(APP_JS));
assert('S4 DOM view LRU intact (_rpCache.views + viewOrder)',
  /window\._rpCache=\{[\s\S]{0,200}?views:\{\}[\s\S]{0,80}?viewOrder:\[\]/.test(APP_JS));
assert('S4 filter-aware signature helper intact (rpSignature)',
  /function rpSignature\(/.test(APP_JS));
assert('S4 cached-view fast path intact (rpShowCachedViewOrLoad)',
  /async function rpShowCachedViewOrLoad\(\)\{[\s\S]{0,300}?var cached=rpGetViewNode\(viewKey\);/.test(APP_JS));
assert('S6 filter state restore intact (__rpFilterState -> __restoreRpFilterState)',
  /if\(typeof window\.__restoreRpFilterState==='function'\)\{[\s\S]{0,80}?window\.__restoreRpFilterState\(\);/.test(APP_JS));
assert('S6 rpTab / rpMode restored on re-entry (not clobbered to total)',
  /if\(s\.rpTab && typeof rpTab!=='undefined'\)\{\s*rpTab=s\.rpTab;/.test(APP_JS)
  && /if\(s\.rpMode && typeof rpMode!=='undefined'\)\{\s*rpMode=s\.rpMode;/.test(APP_JS));
assert('S7 manual override / reconcile path intact (rpReconcileEffectiveValues)',
  /function rpReconcileEffectiveValues\(/.test(APP_JS)
  && /rpReconcileEffectiveValues\(cached\.node\)/.test(APP_JS));
assert('S8 outbound route intact (outbound -> renderOutbound)',
  /outbound:renderOutbound/.test(APP_JS));

console.log('\n=== PERMISSION-GATED SIDEBAR RENDER ===');
assert('renderSidebar filters by hasPermission (order follows items array)',
  /const vis=mod\.items\.filter\(i=>hasPermission\(i\.perm\)\);/.test(APP_JS));
assert('renderTopNav hides module when no permitted item',
  /const hasAny=m\.items\.some\(it=>hasPermission\(it\.perm\)\);[\s\S]{0,60}?if\(!hasAny\)return;/.test(APP_JS));

console.log('\n----------------------------------------');
console.log('  PASS=' + pass + '  FAIL=' + fail);
console.log('----------------------------------------\n');
process.exit(fail === 0 ? 0 : 1);
