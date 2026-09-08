'use strict';
// Focused test: secondary-endpoint page-cache mechanism used by inventory warm restore.
// Proves that adding cacheKey to inventory-specific GETs (currency-rates, filter-options)
// yields a cache HIT with ZERO network on warm re-entry — the exact root-cause fix for
// INVENTORY-WARM-CACHE-P1 (secondary API blocking on inventory warm return).
//
// Does NOT load app.js (browser-coupled); it loads app-perf.js directly and mirrors the
// api() GET+cacheKey path (app.js:182-199) with a tiny simApi wrapper.

const path = require('path');

// --- minimal browser globals ---
let fetchCount = 0;
const callLog = [];
globalThis.location = { search: '' };
globalThis.localStorage = (function () {
  const m = {};
  return {
    getItem: (k) => (k in m ? m[k] : null),
    setItem: (k, v) => { m[k] = String(v); },
    removeItem: (k) => { delete m[k]; }
  };
})();
globalThis.getLang = () => 'zh';
globalThis.fetch = function (url) {
  fetchCount++;
  callLog.push(url);
  return Promise.resolve({ json: () => Promise.resolve({ url: url, ok: true }) });
};

// load app-perf.js (IIFE attaches to globalThis.AppStore)
require(path.resolve(__dirname, '..', 'app-perf.js'));
const AppStore = globalThis.AppStore;

// mirror api() GET+cacheKey path: hit -> return cached; miss -> fetch + set
function simApi(url, cacheKey, ttl) {
  const hit = AppStore.page.hit(cacheKey, url, ttl);
  if (hit !== undefined) return Promise.resolve(hit);
  return globalThis.fetch(url).then((r) => r.json()).then((d) => {
    AppStore.page.set(cacheKey, url, d, { ttl: ttl });
    return d;
  });
}

let pass = 0, fail = 0;
function assert(name, cond) {
  if (cond) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name); }
}

(async function () {
  const TTL = 300000;
  const FX = '/api/inventory/currency-rates';
  const FO = '/api/inventory/filter-options?country=&warehouse=&brand=';
  const FO2 = '/api/inventory/filter-options?country=ID&warehouse=Bekasi&brand=redragon';

  // 1) first call -> network
  fetchCount = 0;
  let d1 = await simApi(FX, 'inv-currency-rates', TTL);
  assert('FX first call hits network', fetchCount === 1 && d1.url === FX);

  // 2) warm return (same cacheKey+signature) -> 0 network
  let d2 = await simApi(FX, 'inv-currency-rates', TTL);
  assert('FX warm return = 0 blocking GET', fetchCount === 1 && d2.url === FX);

  // 3) filter-options first call -> network (independent cacheKey)
  let f1 = await simApi(FO, 'inv-filter-options', TTL);
  assert('filter-options first call hits network', fetchCount === 2 && f1.url === FO);

  // 4) filter-options warm return -> 0 network
  let f2 = await simApi(FO, 'inv-filter-options', TTL);
  assert('filter-options warm return = 0 blocking GET', fetchCount === 2 && f2.url === FO);

  // 5) different signature same cacheKey -> miss (fresh fetch, no data mingling)
  let f3 = await simApi(FO2, 'inv-filter-options', TTL);
  assert('filter-options different filter = miss (correct, no data mingling)', fetchCount === 3 && f3.url === FO2);

  // 6) no cross-key pollution: FX still cache-hit
  let d3 = await simApi(FX, 'inv-currency-rates', TTL);
  assert('FX still cache-hit despite filter-options activity', fetchCount === 3 && d3.url === FX);

  console.log('\nRESULT: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail === 0 ? 0 : 1);
})();
