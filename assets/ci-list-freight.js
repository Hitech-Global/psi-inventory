// CI list freight summary presentation patch.
// Adds "总运费 / 运费占比" immediately after CI amount for operational CI rows.
// Total freight = SUM(total_freight) across UNIQUE logistics batches linked by related_ci_id.
// Ratio = total freight / CI goods_amount. Cross-currency freight is never guessed or converted.
(function (global) {
  'use strict';
  if (!global || typeof document === 'undefined') return;

  var freightCache = { ts: 0, rows: null, inflight: null };
  var FREIGHT_TTL_MS = 30000;

  function clearFreightCache() {
    freightCache.ts = 0;
    freightCache.rows = null;
    freightCache.inflight = null;
  }

  function fetchFreightRows() {
    var now = Date.now();
    if (freightCache.rows && now - freightCache.ts < FREIGHT_TTL_MS) return Promise.resolve(freightCache.rows);
    if (freightCache.inflight) return freightCache.inflight;
    if (typeof global.api !== 'function') return Promise.reject(new Error('api unavailable'));
    freightCache.inflight = global.api('/api/logistics-batches').then(function (rows) {
      freightCache.rows = Array.isArray(rows) ? rows : [];
      freightCache.ts = Date.now();
      freightCache.inflight = null;
      return freightCache.rows;
    }, function (err) {
      freightCache.inflight = null;
      throw err;
    });
    return freightCache.inflight;
  }

  function ciRowsById() {
    var out = {};
    try {
      var entry = global.AppStore && global.AppStore.page && global.AppStore.page.get('ci');
      var opRows = entry && entry.data && Array.isArray(entry.data[0]) ? entry.data[0] : [];
      opRows.forEach(function (c) { if (c && c.id) out[String(c.id)] = c; });
    } catch (e) {}
    return out;
  }

  function aggregateByCI(rows) {
    var seenBatch = {};
    var byCI = {};
    (rows || []).forEach(function (b) {
      if (!b || !b.id || !b.related_ci_id || seenBatch[b.id]) return;
      seenBatch[b.id] = true; // old logistics list can duplicate one batch for multiple PLs
      var ciId = String(b.related_ci_id);
      var a = byCI[ciId];
      if (!a) a = byCI[ciId] = { hasBatch: true, total: 0, currencies: {}, unknownPositiveCurrency: false };
      var amount = Number(b.total_freight) || 0;
      a.total += amount;
      var cur = String(b.freight_currency || '').trim().toUpperCase();
      if (amount !== 0) {
        if (cur) a.currencies[cur] = true;
        else a.unknownPositiveCurrency = true;
      }
    });
    return byCI;
  }

  function parseCIId(row) {
    if (!row) return '';
    var raw = row.getAttribute('onclick') || '';
    var m = raw.match(/viewCI['"]?,?\s*['"]([^'"]+)['"]/);
    if (m) return m[1];
    var el = row.querySelector('[onclick*="viewCI"]');
    raw = el ? (el.getAttribute('onclick') || '') : '';
    m = raw.match(/viewCI\(\s*['"]([^'"]+)['"]\s*\)/);
    return m ? m[1] : '';
  }

  function isOperationalTable(table) {
    var row = table && table.querySelector('tbody tr');
    var raw = row ? (row.getAttribute('onclick') || '') : '';
    return raw.indexOf('viewCI') !== -1 && raw.indexOf('viewHistoricalCI') === -1;
  }

  function ensureColumnsAndCells() {
    var root = document.getElementById('ci-table');
    if (!root) return [];
    var ciMap = ciRowsById();
    var targets = [];
    Array.prototype.forEach.call(root.querySelectorAll('table'), function (table) {
      if (!isOperationalTable(table)) return;
      var heads = table.querySelectorAll('thead th');
      if (heads.length < 10) return;
      // Operational CI schema is stable: [CI号, CI类型, 关联PI, 供应商, 品牌, 国家, 仓库, 出货日期, 币种, CI金额, ...]
      var ciAmountIndex = 9;
      var headerRow = heads[ciAmountIndex].parentNode;
      if (!headerRow.querySelector('[data-ci-freight-head="total"]')) {
        var thTotal = document.createElement('th');
        thTotal.setAttribute('data-ci-freight-head', 'total');
        thTotal.textContent = '总运费';
        var thRatio = document.createElement('th');
        thRatio.setAttribute('data-ci-freight-head', 'ratio');
        thRatio.textContent = '运费占比';
        var nextHead = heads[ciAmountIndex].nextSibling;
        headerRow.insertBefore(thTotal, nextHead);
        headerRow.insertBefore(thRatio, nextHead);
      }
      Array.prototype.forEach.call(table.querySelectorAll('tbody tr'), function (row) {
        var id = parseCIId(row);
        var c = ciMap[id];
        if (!c) return;
        var cells = row.children;
        if (!row.querySelector('[data-ci-freight-cell="total"]')) {
          var tdTotal = document.createElement('td');
          tdTotal.className = 'text-right';
          tdTotal.setAttribute('data-ci-freight-cell', 'total');
          tdTotal.setAttribute('data-ci-id', id);
          tdTotal.textContent = '…';
          var tdRatio = document.createElement('td');
          tdRatio.className = 'text-right';
          tdRatio.setAttribute('data-ci-freight-cell', 'ratio');
          tdRatio.setAttribute('data-ci-id', id);
          tdRatio.textContent = '…';
          var anchor = cells[ciAmountIndex] && cells[ciAmountIndex].nextSibling;
          row.insertBefore(tdTotal, anchor);
          row.insertBefore(tdRatio, anchor);
        }
        targets.push({ id: id, ci: c, row: row });
      });
    });
    return targets;
  }

  function fillFreightCells(targets, logisticsRows) {
    var agg = aggregateByCI(logisticsRows);
    targets.forEach(function (x) {
      var totalCell = x.row.querySelector('[data-ci-freight-cell="total"]');
      var ratioCell = x.row.querySelector('[data-ci-freight-cell="ratio"]');
      if (!totalCell || !ratioCell) return;
      totalCell.removeAttribute('title');
      ratioCell.removeAttribute('title');
      var a = agg[x.id];
      if (!a || !a.hasBatch) {
        totalCell.textContent = '—';
        ratioCell.textContent = '—';
        return;
      }
      var currencies = Object.keys(a.currencies);
      if (a.unknownPositiveCurrency || currencies.length > 1) {
        totalCell.textContent = '—';
        ratioCell.textContent = '—';
        totalCell.title = '物流批次运费存在未知或多币种，未做汇率猜测';
        ratioCell.title = totalCell.title;
        return;
      }
      var freightCurrency = currencies.length === 1 ? currencies[0] : String(x.ci.currency || '').trim().toUpperCase();
      var fmtMoneyFn = typeof global.fmtMoney === 'function' ? global.fmtMoney : function (v, c) { return (c ? c + ' ' : '') + Number(v || 0).toFixed(2); };
      totalCell.textContent = fmtMoneyFn(a.total, freightCurrency);
      var ciCurrency = String(x.ci.currency || '').trim().toUpperCase();
      var goods = Number(x.ci.goods_amount) || 0;
      if (goods > 0 && freightCurrency && ciCurrency && freightCurrency === ciCurrency) {
        ratioCell.textContent = (a.total / goods * 100).toFixed(2) + '%';
      } else {
        ratioCell.textContent = '—';
        if (freightCurrency && ciCurrency && freightCurrency !== ciCurrency) ratioCell.title = '运费与CI金额币种不同，未做汇率换算';
      }
    });
  }

  function hydrateCIFreightColumns() {
    var modeEl = document.getElementById('ci-source-mode');
    var mode = modeEl ? modeEl.value : '';
    if (mode !== 'operational' && mode !== 'all') return;
    var targets = ensureColumnsAndCells();
    if (!targets.length) return;
    fetchFreightRows().then(function (rows) {
      if (!document.getElementById('ci-table')) return;
      fillFreightCells(targets, rows);
    }).catch(function () {
      targets.forEach(function (x) {
        var a = x.row.querySelector('[data-ci-freight-cell="total"]');
        var b = x.row.querySelector('[data-ci-freight-cell="ratio"]');
        if (a) a.textContent = '—';
        if (b) b.textContent = '—';
      });
    });
  }

  function install() {
    if (typeof global.loadCI === 'function' && !global.loadCI.__ciFreightWrapped) {
      var originalLoadCI = global.loadCI;
      var wrappedLoadCI = async function () {
        var result = await originalLoadCI.apply(this, arguments);
        hydrateCIFreightColumns();
        return result;
      };
      wrappedLoadCI.__ciFreightWrapped = true;
      global.loadCI = wrappedLoadCI;
    }
    try {
      if (global.AppStore && typeof global.AppStore.onMutation === 'function' && !global.AppStore.onMutation.__ciFreightWrapped) {
        var originalOnMutation = global.AppStore.onMutation;
        var wrappedMutation = function (method, url, body) {
          if (method && method !== 'GET' && String(url || '').indexOf('/api/logistics-batches') !== -1) clearFreightCache();
          return originalOnMutation.call(this, method, url, body);
        };
        wrappedMutation.__ciFreightWrapped = true;
        global.AppStore.onMutation = wrappedMutation;
      }
    } catch (e) {}
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
