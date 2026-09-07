/* ============================================================================
 * app-perf.js — 全系统页面切换性能层（SYSTEM-WIDE PAGE SWITCH PERFORMANCE）
 * ----------------------------------------------------------------------------
 * 纯前端数据生命周期优化，不改动任何后端业务口径 / PAY / WAC / Forecast 计算。
 *
 * 三层缓存：
 *   A. Reference Cache (AppStore.ref)    —— session-long 跨页共享 reference data + inflight 去重
 *   B. Page Data Cache  (AppStore.page)  —— 页面业务列表快照，signature 分键，stale-while-revalidate
 *   C. Ephemeral UI State                —— 滚动/筛选态，不进上述两层
 *
 * Mutation-aware invalidation：api() 成功非 GET 后按 URL→page 依赖图 markDirty。
 * 禁止 clearAllCaches()；仅 invalidation 受影响页面。
 *
 * 加载顺序：必须在 app.js 之前（index.html）。本文件加载时禁止触碰 document。
 * 所有网络/缓存操作均 try/catch 包裹，缓存层任何异常都降级为「透传网络」，绝不阻断业务。
 * ==========================================================================*/
(function (global) {
  'use strict';

  // ---------- 性能 instrumentation（默认关闭，不污染生产 console）----------
  // 开启：?perf=1 或 localStorage perf=1
  function perfEnabled() {
    try {
      if (/[?&]perf=1/.test((typeof location !== 'undefined' && location.search) || '')) return true;
      if (typeof localStorage !== 'undefined' && localStorage.getItem('psi_perf') === '1') return true;
    } catch (e) {}
    return false;
  }
  var PERF = perfEnabled();
  function perf(layer, key, event, extra) {
    if (!PERF) return;
    try {
      var tag = '[APP PERF] ' + layer + ' ' + (key || '') + ' ' + event;
      if (extra != null) tag += ' ' + (typeof extra === 'object' ? JSON.stringify(extra) : extra);
      // eslint-disable-next-line no-console
      console.log(tag);
    } catch (e) {}
  }

  function langHeader() {
    try { return (typeof global.getLang === 'function' && global.getLang()) || 'zh'; } catch (e) { return 'zh'; }
  }

  // 内部 raw fetch（不带缓存），供 background refresh 与 ref 使用
  function rawFetch(url, opts) {
    var h = { 'Content-Type': 'application/json', 'Accept-Language': langHeader() };
    return fetch(url, { method: (opts && opts.method) || 'GET', headers: h, credentials: 'same-origin', body: opts && opts.body ? JSON.stringify(opts.body) : null })
      .then(function (r) { return r.json(); });
  }

  // ==========================================================================
  // A. Reference Cache
  // ==========================================================================
  var REF_ENDPOINTS = {
    countries: '/api/countries',
    brands: '/api/brands/all',
    warehouses: '/api/warehouses',
    skus: '/api/skus',
    suppliers: '/api/suppliers',
    currencies: '/api/currencies',
    permissions: '/api/permissions',
    warehouseCountries: '/api/warehouses/countries'
  };
  var refCache = new Map();    // key -> data
  var refInflight = new Map(); // key -> Promise（inflight 去重）
  var refBooted = false;

  function ref(key) {
    var url = REF_ENDPOINTS[key];
    if (!url) return Promise.reject(new Error('AppStore.ref: unknown key ' + key));
    if (refCache.has(key)) { perf('ref', key, 'HIT'); return Promise.resolve(refCache.get(key)); }
    if (refInflight.has(key)) { perf('ref', key, 'INFLIGHT'); return refInflight.get(key); }
    perf('ref', key, 'MISS');
    var p = rawFetch(url).then(function (d) {
      try { refCache.set(key, d); } catch (e) {}
      refInflight.delete(key);
      return d;
    }).catch(function (e) {
      refInflight.delete(key);
      refCache.delete(key);
      throw e;
    });
    refInflight.set(key, p);
    return p;
  }
  function invalidateRef(key) {
    try {
      if (key) refCache.delete(key);
      else { refCache.clear(); refInflight.clear(); }
    } catch (e) {}
  }
  // 登录/startup 一次拉取跨页共享 reference data（fire-and-forget，不阻塞首屏）
  function bootstrapRefs() {
    if (refBooted) return;
    refBooted = true;
    var keys = ['countries', 'brands', 'warehouses', 'skus', 'suppliers', 'currencies', 'permissions', 'warehouseCountries'];
    keys.forEach(function (k) {
      ref(k).catch(function () { /* 单条失败不影响其它；页面仍可各自回退 api() */ });
    });
    perf('ref', 'bootstrap', 'START', keys.length);
  }

  // ==========================================================================
  // B. Page Data Cache（stale-while-revalidate）
  // ==========================================================================
  var PAGE_TTL_DEFAULT = 30000; // 30s
  var PAGE_MAX = 6;            // LRU 上限（无界 cache 禁止）
  var pageCache = new Map();   // pageKey -> { signature, data, fetchedAt, dirty, ttl }
  var pageOrder = [];          // LRU 顺序（最近使用在前）
  var revalidators = new Map();// pageKey -> fn() 后台刷新成功后重渲染当前页

  function nowMs() { return Date.now(); }

  function touch(pageKey) {
    pageOrder = pageOrder.filter(function (k) { return k !== pageKey; });
    pageOrder.unshift(pageKey);
    while (pageOrder.length > PAGE_MAX) {
      var evicted = pageOrder.pop();
      pageCache.delete(evicted);
      perf('page', evicted, 'LRU-EVICT');
    }
  }

  function peek(pageKey, signature) {
    if (!pageCache.has(pageKey)) return null;
    var e = pageCache.get(pageKey);
    if (e.signature !== signature) return null; // C7 不同 filter key 不串数据
    return e;
  }
  function isFresh(e, ttl) {
    if (!e || e.dirty) return false;
    return (nowMs() - e.fetchedAt) < (ttl || e.ttl || PAGE_TTL_DEFAULT);
  }
  function setPage(pageKey, signature, data, opts) {
    opts = opts || {};
    var ttl = opts.ttl || PAGE_TTL_DEFAULT;
    pageCache.set(pageKey, { signature: signature, data: data, fetchedAt: nowMs(), dirty: false, ttl: ttl });
    touch(pageKey); // LRU 维护（含逐出）
    perf('page', pageKey, 'SET', { ttl: ttl });
  }
  function markDirty(pageKey) {
    if (pageKey) {
      var e = pageCache.get(pageKey);
      if (e) { e.dirty = true; perf('page', pageKey, 'DIRTY'); }
    } else {
      pageCache.forEach(function (e, k) { e.dirty = true; perf('page', k, 'DIRTY'); });
    }
  }
  function getPage(pageKey) { return pageCache.get(pageKey) || null; }
  function onRefresh(pageKey, fn) { try { revalidators.set(pageKey, fn); } catch (e) {} }

  // 后台刷新：成功则更新 cache；若仍是当前可见页且 signature 未变，调 revalidator 重渲染
  function background(pageKey, signature, fetcher, ttl) {
    try {
      fetcher().then(function (d) {
        var cur = pageCache.get(pageKey);
        if (cur && cur.signature === signature) {
          setPage(pageKey, signature, d, { ttl: ttl });
          var rv = revalidators.get(pageKey);
          if (rv && typeof global.currentPage !== 'undefined' && global.currentPage === pageKey) {
            try { rv(); } catch (e) { perf('page', pageKey, 'REVALIDATE-ERR', String(e && e.message)); }
          }
        }
      }).catch(function (e) { perf('page', pageKey, 'BG-ERR', String(e && e.message)); });
    } catch (e) {}
  }

  // ==========================================================================
  // C. Mutation-aware invalidation（URL → page 依赖图）
  // ==========================================================================
  // 依赖图：成功 mutation 后只 dirty 受影响页面 + 失效相关 reference key。
  // 不相关 mutation 不会 clear 其它页面（C5）。
  function pagesForMutation(url, method) {
    var pages = [];
    var refs = [];
    var u = url || '';
    function has(p) { return u.indexOf(p) !== -1; }
    if (has('/api/inventory-imports')) { pages.push('inventory', 'replenishment', 'consignment', 'dashboard'); }
    if (has('/api/inventory') && method !== 'GET') { pages.push('inventory', 'replenishment'); }
    if (has('/api/proforma-invoices')) { pages.push('pi', 'po', 'payable-list', 'payable-cockpit', 'replenishment'); }
    if (has('/api/commercial-invoices')) { pages.push('ci', 'pi', 'payable-list', 'payable-cockpit', 'replenishment'); }
    if (has('/api/packing-lists')) { pages.push('ci', 'replenishment'); }
    if (has('/api/payment-requests')) { pages.push('payment', 'payable-list', 'payable-cockpit', 'ci', 'pi'); }
    if (has('/api/payable-items')) { pages.push('payable-list', 'payable-cockpit', 'payment'); }
    if (has('/api/purchase-orders')) { pages.push('po', 'pi'); }
    if (has('/api/consignment')) { pages.push('consignment', 'inventory'); }
    if (has('/api/skus')) { pages.push('skus', 'inventory', 'pi', 'ci'); refs.push('skus'); }
    if (has('/api/suppliers')) { refs.push('suppliers'); }
    if (has('/api/warehouses')) { refs.push('warehouses', 'warehouseCountries'); }
    if (has('/api/countries')) { refs.push('countries'); }
    if (has('/api/brands')) { refs.push('brands'); }
    if (has('/api/currencies')) { refs.push('currencies'); }
    if (has('/api/sales')) { pages.push('outbound', 'replenishment'); }
    return { pages: Array.from(new Set(pages)), refs: Array.from(new Set(refs)) };
  }
  function onMutation(method, url, body) {
    if (!method || method === 'GET') return;
    try {
      var m = pagesForMutation(url, method);
      m.pages.forEach(function (p) { markDirty(p); });
      m.refs.forEach(function (r) { invalidateRef(r); });
      perf('mutation', method, url, { pages: m.pages, refs: m.refs });
    } catch (e) {}
  }

  // ==========================================================================
  // 会话级清空（logout / 用户切换）
  // ==========================================================================
  function clearSession() {
    try {
      pageCache.clear(); pageOrder = []; revalidators.clear();
      refCache.clear(); refInflight.clear(); refBooted = false;
    } catch (e) {}
  }

  // 暴露 API（挂到全局，供 app.js 的 api() 与页面调用）
  global.AppStore = {
    ref: ref,
    invalidateRef: invalidateRef,
    bootstrapRefs: bootstrapRefs,
    clearSession: clearSession,
    perf: perf,
    onMutation: onMutation,
    page: {
      peek: peek,
      isFresh: isFresh,
      set: setPage,
      get: getPage,
      markDirty: markDirty,
      onRefresh: onRefresh,
      background: background,
      // 供 api() 使用：命中且新鲜则返回 data；否则返回 undefined（调用方走网络）
      hit: function (pageKey, signature, ttl) {
        var e = peek(pageKey, signature);
        if (isFresh(e, ttl)) { touch(pageKey); perf('page', pageKey, 'HIT'); return e.data; }
        return undefined;
      },
      // 供 api() 使用：命中但接近过期 → 后台刷新（不阻塞）
      maybeBackground: function (pageKey, signature, ttl, fetcher) {
        var e = peek(pageKey, signature);
        if (!e || e.dirty) return;
        var t = ttl || e.ttl || PAGE_TTL_DEFAULT;
        if ((nowMs() - e.fetchedAt) >= t * 0.8) background(pageKey, signature, fetcher, t);
      }
    },
    _internal: { pagesForMutation: pagesForMutation, REF_ENDPOINTS: REF_ENDPOINTS, rawFetch: rawFetch }
  };

  perf('init', 'app-perf', 'LOADED');
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
