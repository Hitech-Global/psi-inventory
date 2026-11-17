/* CI-DATE-RANGE-FILTER-V1
 * Local date-range filtering for the unified CI list.
 * Reuses the CI list's existing cached rows; no extra list API request.
 */
(function (global) {
  'use strict';
  if (!global || global.__ciDateRangeFilterV1) return;
  global.__ciDateRangeFilterV1 = true;

  var latestOperational = [];
  var latestHistorical = [];
  var originalTableRenderer = null;
  var originalSummaryRenderer = null;

  function el(id) { return document.getElementById(id); }
  function value(id) { var node = el(id); return node ? String(node.value || '').trim() : ''; }
  function dateValue(row) {
    var raw = String(row && row.ci_date || '').trim();
    var match = /^(\d{4}-\d{2}-\d{2})/.exec(raw);
    return match ? match[1] : '';
  }
  function matchesDate(row, start, end) {
    if (!start && !end) return true;
    var date = dateValue(row);
    if (!date) return false;
    if (start && date < start) return false;
    if (end && date > end) return false;
    return true;
  }
  function filterRows(rows, start, end) {
    return (Array.isArray(rows) ? rows : []).filter(function (row) {
      return matchesDate(row, start, end);
    });
  }
  function money(value) {
    var n = Number(value || 0);
    return Number.isFinite(n) ? Math.round((n + Number.EPSILON) * 100) / 100 : 0;
  }
  function amountScope(rows, amountKey) {
    var byCurrency = {};
    var count = 0;
    (rows || []).forEach(function (row) {
      var currency = String(row.currency || '').trim() || 'UNKNOWN';
      byCurrency[currency] = money((byCurrency[currency] || 0) + money(row[amountKey]));
      count++;
    });
    var currencies = Object.keys(byCurrency).sort().map(function (currency) {
      return { currency: currency, amount: byCurrency[currency] };
    });
    return {
      count: count,
      by_currency: currencies,
      rmb_known_amount: byCurrency.RMB || 0,
      rmb_pending_count: (rows || []).filter(function (row) {
        return String(row.currency || '').trim() !== 'RMB';
      }).length
    };
  }
  function filteredSummary() {
    var op = latestOperational.filter(function (row) {
      return String(row.ci_status || '') !== 'cancelled';
    });
    var hist = latestHistorical.slice();
    var opScope = amountScope(op, 'goods_amount');
    var histScope = amountScope(hist, 'gross_goods_amount');
    var all = op.map(function (row) { return { currency: row.currency, amount: row.goods_amount }; })
      .concat(hist.map(function (row) { return { currency: row.currency, amount: row.gross_goods_amount }; }));
    return {
      operational: opScope,
      historical: histScope,
      total: amountScope(all, 'amount'),
      rmb_note: ''
    };
  }
  function renderSummaryFromLatest() {
    var target = el('ci-purchase-summary');
    if (!target || typeof originalSummaryRenderer !== 'function') return;
    target.innerHTML = originalSummaryRenderer(filteredSummary());
  }
  function currentRange() {
    return { start: value('ci-date-start'), end: value('ci-date-end') };
  }
  function syncFilteredRows(operational, historical) {
    var range = currentRange();
    latestOperational = filterRows(operational, range.start, range.end);
    latestHistorical = filterRows(historical, range.start, range.end);
    renderSummaryFromLatest();
    return { operational: latestOperational, historical: latestHistorical };
  }
  function addStyles() {
    if (el('ci-date-range-filter-styles')) return;
    var style = document.createElement('style');
    style.id = 'ci-date-range-filter-styles';
    style.textContent =
      '.ci-date-range-group{min-width:250px;max-width:340px}' +
      '.ci-date-range-fields{display:flex;align-items:center;gap:6px;min-width:0}' +
      '.ci-date-range-fields input{height:36px;min-width:0;width:132px;padding:5px 8px;border:1px solid #d2d2d7;border-radius:9px;background:#fff;color:#1d1d1f;font:inherit;font-size:12px;box-shadow:none}' +
      '.ci-date-range-fields input:focus{outline:none;border-color:#0071e3;box-shadow:0 0 0 3px rgba(0,113,227,.12)}' +
      '.ci-date-range-separator{color:#86868b;font-size:12px;flex:0 0 auto}' +
      '.ci-date-range-fields .btn{height:34px;min-height:34px;padding:5px 10px;border-radius:9px;font-size:12px}' +
      '.ci-date-error{display:block;min-height:15px;color:#d70015;font-size:11px;margin-top:2px}' +
      '@media(max-width:900px){.ci-date-range-group{min-width:220px}.ci-date-range-fields input{width:112px}}';
    document.head.appendChild(style);
  }
  function mount() {
    addStyles();
    var form = document.querySelector('.content-inner .filter-form');
    if (!form || !el('ci-source-mode') || el('ci-date-range')) return;
    var actions = form.querySelector('.filter-actions');
    var group = document.createElement('div');
    group.className = 'filter-group ci-date-range-group';
    group.id = 'ci-date-range';
    group.innerHTML =
      '<label for="ci-date-start">CI 日期</label>' +
      '<div class="ci-date-range-fields">' +
        '<input id="ci-date-start" type="date" aria-label="开始日期">' +
        '<span class="ci-date-range-separator">至</span>' +
        '<input id="ci-date-end" type="date" aria-label="结束日期">' +
        '<button id="ci-date-clear" type="button" class="btn btn-secondary btn-sm">清除</button>' +
      '</div>' +
      '<span id="ci-date-error" class="ci-date-error" role="status" aria-live="polite"></span>';
    if (actions) form.insertBefore(group, actions);
    else form.appendChild(group);
    group.addEventListener('change', function (event) {
      if (!event.target || (event.target.id !== 'ci-date-start' && event.target.id !== 'ci-date-end')) return;
      apply();
    });
    var clear = el('ci-date-clear');
    if (clear) clear.addEventListener('click', function () {
      var start = el('ci-date-start'), end = el('ci-date-end');
      if (start) start.value = '';
      if (end) end.value = '';
      var error = el('ci-date-error'); if (error) error.textContent = '';
      apply();
    });
  }
  function apply() {
    var range = currentRange();
    var error = el('ci-date-error');
    if (range.start && range.end && range.start > range.end) {
      if (error) error.textContent = '开始日期不能晚于结束日期';
      return;
    }
    if (error) error.textContent = '';
    if (typeof global.loadCI === 'function') global.loadCI();
  }

  if (typeof global.renderUnifiedCITable === 'function') {
    originalTableRenderer = global.renderUnifiedCITable;
    global.renderUnifiedCITable = function (operationalData, historicalData) {
      var filtered = syncFilteredRows(operationalData, historicalData);
      return originalTableRenderer.call(this, filtered.operational, filtered.historical);
    };
  }
  if (typeof global.renderPurchaseAmountSummary === 'function') {
    originalSummaryRenderer = global.renderPurchaseAmountSummary;
    global.renderPurchaseAmountSummary = function (summary) {
      // Preserve the existing permission gate; the filtered list must not expose amounts
      // when the server says the current user cannot view them.
      if (summary && summary.amount_view_allowed === false) return originalSummaryRenderer.call(this, summary);
      return originalSummaryRenderer.call(this, filteredSummary());
    };
  }

  function watch() {
    mount();
    var observer = new MutationObserver(function () { mount(); });
    observer.observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', watch, { once: true });
  } else {
    watch();
  }
})(typeof window !== 'undefined' ? window : this);
