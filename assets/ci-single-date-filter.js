/* CI-SINGLE-DATE-FILTER-01
 * Adds one compact single-day filter to the existing CI filter row.
 * Filters the already-loaded CI rows locally and keeps the procurement
 * summary in sync with exactly the rows shown in the table.
 */
(function (global) {
  'use strict';

  if (!global || global.__ciSingleDateFilterV1) return;

  var doc = global.document;
  var originalTableRenderer = global.renderUnifiedCITable;
  var originalSummaryRenderer = global.renderPurchaseAmountSummary;
  var originalRenderCI = global.renderCI;
  var latestRows = null;
  var amountPermission = null;
  var lastServerSummary = null;
  var currentForm = null;
  var STYLE_ID = 'ci-single-date-filter-style';

  function selectedDate() {
    var input = doc && doc.getElementById('ci-date-filter-input');
    return input ? String(input.value || '').trim() : '';
  }

  function rowDate(row) {
    var raw = String(row && row.ci_date || '').trim();
    var match = /^(\d{4}-\d{2}-\d{2})/.exec(raw);
    return match ? match[1] : '';
  }

  function filterRows(rows) {
    var date = selectedDate();
    var source = Array.isArray(rows) ? rows : [];
    if (!date) return source.slice();
    return source.filter(function (row) {
      return rowDate(row) === date;
    });
  }

  function roundMoney(value) {
    var number = Number(value || 0);
    if (!Number.isFinite(number)) return 0;
    return Math.round((number + Number.EPSILON) * 100) / 100;
  }

  function amountScope(rows, amountKey) {
    var byCurrency = Object.create(null);
    var count = 0;
    var source = Array.isArray(rows) ? rows : [];
    source.forEach(function (row) {
      var currency = String(row && row.currency || '').trim() || 'UNKNOWN';
      byCurrency[currency] = roundMoney((byCurrency[currency] || 0) + roundMoney(row && row[amountKey]));
      count++;
    });
    return {
      count: count,
      by_currency: Object.keys(byCurrency).sort().map(function (currency) {
        return { currency: currency, amount: byCurrency[currency] };
      }),
      rmb_known_amount: byCurrency.RMB || 0,
      rmb_pending_count: source.filter(function (row) {
        return String(row && row.currency || '').trim() !== 'RMB';
      }).length
    };
  }

  function buildSummary(operationalRows, historicalRows) {
    var operational = filterRows(operationalRows).filter(function (row) {
      // Match the existing purchase-amount-summary endpoint: cancelled CI is excluded.
      return row && row.ci_status != null && String(row.ci_status) !== 'cancelled';
    });
    var historical = filterRows(historicalRows);
    var totalRows = operational.map(function (row) {
      return { currency: row.currency, amount: row.goods_amount };
    }).concat(historical.map(function (row) {
      return { currency: row.currency, amount: row.gross_goods_amount };
    }));

    return {
      operational: amountScope(operational, 'goods_amount'),
      historical: amountScope(historical, 'gross_goods_amount'),
      total: amountScope(totalRows, 'amount'),
      operationalRows: operational,
      historicalRows: historical,
      rmb_note: lastServerSummary && lastServerSummary.rmb_note || ''
    };
  }

  function updateSummary() {
    if (amountPermission !== true || !latestRows || typeof originalSummaryRenderer !== 'function') return;
    var target = doc && doc.getElementById('ci-purchase-summary');
    if (!target) return;
    target.innerHTML = originalSummaryRenderer.call(global, buildSummary(latestRows.operational, latestRows.historical));
  }

  function renderLatest() {
    if (!latestRows) {
      if (typeof global.loadCI === 'function') global.loadCI();
      return;
    }
    var html = global.renderUnifiedCITable(latestRows.operational, latestRows.historical);
    var table = doc && doc.getElementById('ci-table');
    if (table) table.innerHTML = html;
  }

  if (typeof originalRenderCI === 'function') {
    global.renderCI = function () {
      // Reset the cached CI rows before the page rebuilds; loadCI may render synchronously from cache.
      latestRows = null;
      amountPermission = null;
      lastServerSummary = null;
      currentForm = null;
      return originalRenderCI.apply(this, arguments);
    };
  }

  if (typeof originalTableRenderer === 'function') {
    global.renderUnifiedCITable = function (operationalData, historicalData) {
      latestRows = {
        operational: Array.isArray(operationalData) ? operationalData.slice() : [],
        historical: Array.isArray(historicalData) ? historicalData.slice() : []
      };
      var filteredOperational = filterRows(latestRows.operational);
      var filteredHistorical = filterRows(latestRows.historical);
      var html = originalTableRenderer.call(this, filteredOperational, filteredHistorical);
      updateSummary();
      return html;
    };
  }

  if (typeof originalSummaryRenderer === 'function') {
    global.renderPurchaseAmountSummary = function (summary, historicalRows) {
      if (Array.isArray(summary) && Array.isArray(historicalRows)) {
        amountPermission = true;
        latestRows = { operational: summary.slice(), historical: historicalRows.slice() };
        return originalSummaryRenderer.call(this, buildSummary(latestRows.operational, latestRows.historical));
      }
      if (summary && summary.amount_view_allowed === false) {
        amountPermission = false;
        lastServerSummary = null;
        return '';
      }
      if (summary && summary.operational && summary.historical && summary.total) {
        amountPermission = true;
        lastServerSummary = summary;
      }
      if (amountPermission === true && latestRows) {
        return originalSummaryRenderer.call(this, buildSummary(latestRows.operational, latestRows.historical));
      }
      return originalSummaryRenderer.call(this, summary);
    };
  }
  function translate(key, fallback) {
    try {
      return typeof global.t === 'function' ? global.t(key, fallback) : fallback;
    } catch (error) {
      return fallback;
    }
  }

  function ensureStyle() {
    if (!doc || doc.getElementById(STYLE_ID)) return;
    var style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '.ci-date-filter-group{width:130px;min-width:118px;max-width:130px;flex:0 0 auto;}',
      '.ci-date-filter-control{position:relative;width:100%;height:30px;}',
      '.ci-date-filter-trigger{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;height:30px;box-sizing:border-box;padding:4px 8px;border:1px solid var(--border);border-radius:6px;background:var(--card-bg);color:var(--text,#1d1d1f);font-family:inherit;font-size:12px;font-weight:400;line-height:20px;text-align:left;white-space:nowrap;overflow:hidden;box-shadow:none;cursor:pointer;}',
      '.ci-date-filter-trigger:focus-visible{outline:2px solid rgba(0,122,255,.35);outline-offset:1px;}',
      '.ci-date-filter-value{overflow:hidden;text-overflow:ellipsis;}',
      '.ci-date-filter-icon{display:block;flex:0 0 14px;width:14px;height:14px;color:var(--text-secondary,#86868b);}',
      '.ci-date-filter-input{position:absolute!important;left:0!important;bottom:0!important;width:1px!important;height:1px!important;margin:0!important;padding:0!important;border:0!important;opacity:0!important;pointer-events:none!important;z-index:-1!important;}'
    ].join('\n');
    doc.head.appendChild(style);
  }

  function mount() {
    if (!doc || !doc.body) return;
    var mode = doc.getElementById('ci-source-mode');
    var form = mode && mode.closest ? mode.closest('.filter-form') : doc.querySelector('#content-inner .filter-form');
    if (!form || !mode) {
      currentForm = null;
      return;
    }
    if (form !== currentForm) {
      currentForm = form;
    }
    if (form.querySelector('#ci-date-filter-group')) return;

    ensureStyle();
    var group = doc.createElement('div');
    group.className = 'filter-group ci-date-filter-group';
    group.id = 'ci-date-filter-group';
    group.innerHTML =
      '<label for="ci-date-filter-input">' + translate('field.ci_date', 'CI日期') + '</label>' +
      '<div class="ci-date-filter-control">' +
        '<button class="ci-date-filter-trigger" id="ci-date-filter-trigger" type="button" aria-label="' + translate('field.ci_date', 'CI日期') + '" title="选择日期；按 Backspace 或 Delete 清除">' +
          '<span class="ci-date-filter-value" id="ci-date-filter-value">' + translate('common.all', '全部') + '</span>' +
          '<svg class="ci-date-filter-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
            '<rect x="2.5" y="3.5" width="11" height="10" rx="1.5" stroke="currentColor" stroke-width="1.2"/>' +
            '<path d="M5 2.5v3M11 2.5v3M2.5 6.5h11" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>' +
          '</svg>' +
        '</button>' +
        '<input class="ci-date-filter-input" id="ci-date-filter-input" type="date" aria-label="' + translate('field.ci_date', 'CI日期') + '" title="选择日期；按 Backspace 或 Delete 清除">' +
      '</div>';

    var actions = form.querySelector('.filter-actions');
    if (actions) form.insertBefore(group, actions);
    else form.appendChild(group);

    var input = group.querySelector('#ci-date-filter-input');
    var trigger = group.querySelector('#ci-date-filter-trigger');
    var value = group.querySelector('#ci-date-filter-value');
    function syncLabel() {
      if (value) value.textContent = input && input.value ? input.value : translate('common.all', '全部');
    }
    function onDateChanged() {
      syncLabel();
      renderLatest();
    }
    function openDatePicker() {
      if (!input) return;
      try {
        if (typeof input.showPicker === 'function') {
          input.showPicker();
          return;
        }
      } catch (error) {}
      try {
        input.focus();
        input.click();
      } catch (error) {}
    }
    if (trigger) {
      trigger.addEventListener('click', openDatePicker);
      trigger.addEventListener('keydown', function (event) {
        if ((event.key === 'Backspace' || event.key === 'Delete') && input && input.value) {
          event.preventDefault();
          input.value = '';
          onDateChanged();
        }
      });
    }
    if (input) {
      input.addEventListener('change', onDateChanged);
      input.addEventListener('keydown', function (event) {
        if ((event.key === 'Backspace' || event.key === 'Delete') && input.value) {
          event.preventDefault();
          input.value = '';
          onDateChanged();
        }
      });
    }
    syncLabel();
  }

  global.__ciSingleDateFilterV1 = {
    filterRows: filterRows,
    amountScope: amountScope,
    buildSummary: buildSummary,
    renderLatest: renderLatest
  };

  function start() {
    if (!doc || !doc.body) return;
    mount();
    if (typeof global.MutationObserver === 'function') {
      var observer = new global.MutationObserver(function () { mount(); });
      observer.observe(doc.body, { childList: true, subtree: true });
    }
  }

  if (doc && doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})(typeof window !== 'undefined' ? window : this);
