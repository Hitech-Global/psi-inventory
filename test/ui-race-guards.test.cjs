'use strict';
/**
 * Regression coverage for two UI races:
 * 1) concurrent multi-PI detail responses must never reuse CI row ids;
 * 2) a GET owned by an old page render must not continue into the new page DOM.
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

function extractFn(src, name) {
  const re = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\(');
  const m = re.exec(src);
  if (!m) throw new Error('function not found: ' + name);
  let i = src.indexOf('{', m.index), depth = 0, j = i;
  for (; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) break;
  }
  return src.slice(m.index, j + 1);
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

async function testNavigationRace() {
  console.log('\n=== page navigation GET race guard ===');
  let active;
  const sandbox = {
    window: { AppStore: null },
    apiRaw: () => active.promise,
    rpWarmInvalidateForMutation: () => {},
    console
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext([
    "const PAGE_NAV_CANCELLED='__PAGE_NAV_CANCELLED__';let _pageNavSeq=0;",
    extractFn(SRC, 'pageNavigationTokenForMethod'),
    extractFn(SRC, 'assertPageNavigationCurrent'),
    extractFn(SRC, 'isPageNavigationCancelledMessage'),
    extractFn(SRC, 'api')
  ].join('\n'), sandbox);

  active = deferred();
  const staleGet = sandbox.api('/api/slow-page');
  vm.runInContext('_pageNavSeq+=1', sandbox);
  active.resolve({ ok: true });
  let staleGetError;
  try { await staleGet; } catch (e) { staleGetError = e; }
  assert('old-page GET success is converted to PAGE_NAV_CANCELLED', staleGetError && staleGetError.code === 'PAGE_NAV_CANCELLED');

  active = deferred();
  const staleFailure = sandbox.api('/api/slow-page-error');
  vm.runInContext('_pageNavSeq+=1', sandbox);
  active.reject(new Error('server failed'));
  let staleFailureError;
  try { await staleFailure; } catch (e) { staleFailureError = e; }
  assert('old-page GET failure is also silenced as navigation cancellation', staleFailureError && staleFailureError.code === 'PAGE_NAV_CANCELLED');

  active = deferred();
  const mutation = sandbox.api('/api/commercial-invoices', 'POST', { ci_no: 'CI-1' });
  vm.runInContext('_pageNavSeq+=1', sandbox);
  active.resolve({ id: 'ci-1' });
  const mutationResult = await mutation;
  assert('navigation never cancels a POST business write', mutationResult && mutationResult.id === 'ci-1');
  assert('wrapped cancellation text is recognized by toast/flash guard', sandbox.isPageNavigationCancelledMessage('Error: __PAGE_NAV_CANCELLED__'));
  assert('normal business errors are not hidden', !sandbox.isPageNavigationCancelledMessage('数量超过可出货数量'));
}

function testMultiPiRace() {
  console.log('\n=== CI multi-PI concurrent response guard ===');
  const sandbox = {
    window: { _ciLoadEpoch: 7, _ciR: 0, _ciAllItems: [], _ciSelectedPiIds: { pi1: true, pi2: true, pi3: true } },
    console
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(extractFn(SRC, 'appendLoadedCIPiItems'), sandbox);

  // Resolve PI 2 before PI 1 to model out-of-order network completion.
  sandbox.appendLoadedCIPiItems({ id: 'pi2', pi_no: 'PI-2', currency: 'USD', items: [
    { sku_code: 'B', unshipped_qty: 7, unit_price: 2 }
  ] }, 7);
  sandbox.appendLoadedCIPiItems({ id: 'pi1', pi_no: 'PI-1', currency: 'USD', items: [
    { sku_code: 'A', unshipped_qty: 5, unit_price: 1 },
    { sku_code: 'C', unshipped_qty: 11, unit_price: 3 }
  ] }, 7);

  const rows = sandbox.window._ciAllItems;
  assert('both PI responses contribute all shippable rows', rows.length === 3);
  assert('out-of-order PI responses still receive unique row ids', new Set(rows.map((r) => r.idx)).size === rows.length);
  assert('combined quantity includes both linked PIs', rows.reduce((n, r) => n + r.unshipped_qty, 0) === 23);

  sandbox.appendLoadedCIPiItems({ id: 'pi1', pi_no: 'PI-1', items: [{ sku_code: 'A', unshipped_qty: 5 }] }, 7);
  assert('duplicate in-flight response for the same PI is ignored', sandbox.window._ciAllItems.length === 3);

  // Removing a PI must not rewind the row-id allocator; a later PI gets a fresh id.
  sandbox.window._ciAllItems = sandbox.window._ciAllItems.filter((r) => r.pi_id !== 'pi2');
  sandbox.appendLoadedCIPiItems({ id: 'pi3', pi_no: 'PI-3', currency: 'USD', items: [
    { sku_code: 'D', unshipped_qty: 13, unit_price: 4 }
  ] }, 7);
  const remaining = sandbox.window._ciAllItems;
  assert('remove/re-add flow keeps row ids collision-free', new Set(remaining.map((r) => r.idx)).size === remaining.length && remaining.some((r) => r.idx === 3));

  sandbox.window._ciSelectedPiIds.pi4 = true;
  const before = remaining.length;
  sandbox.appendLoadedCIPiItems({ id: 'pi4', pi_no: 'PI-4', items: [{ sku_code: 'E', unshipped_qty: 99 }] }, 6);
  assert('response from an older CI modal/supplier epoch is ignored', sandbox.window._ciAllItems.length === before);
}

(async function main() {
  await testNavigationRace();
  testMultiPiRace();

  console.log('\n=== source wiring ===');
  assert('showPage advances the page render generation', /function showPage\(page\)[\s\S]*?_pageNavSeq\+=1;/.test(SRC));
  assert('toast and flash suppress only navigation cancellation sentinel', /function showToast\([^)]*\)\{if\(isPageNavigationCancelledMessage\(msg\)\)return;/.test(SRC)
    && /function showFlash\([^)]*\)\{if\(isPageNavigationCancelledMessage\(msg\)\)return;/.test(SRC));
  assert('CI selection passes the modal epoch into the async loader', /loadMultiPIItems\(added,removed,window\._ciLoadEpoch\)/.test(SRC));
  assert('CI removal does not rewind the monotonic row id', !/window\._ciR=window\._ciAllItems\.length/.test(SRC));

  console.log(`\nui-race-guards: ${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
