(function (global) {
  'use strict';
  if (!global || typeof document === 'undefined' || global.__ciSharedFreightDisplayInstalled) return;
  global.__ciSharedFreightDisplayInstalled = true;

  var requestSequence = 0;

  function text(value) { return String(value == null ? '' : value).replace(/\s+/g, ' ').trim(); }
  function key(value) { return text(value).toLowerCase().replace(/[\s\u3000]+/g, ''); }
  function lang() {
    return typeof global.getLang === 'function'
      ? String(global.getLang() || 'zh').toLowerCase().slice(0, 2) : 'zh';
  }
  function label(value) {
    var mode = String(value || '').toLowerCase();
    var l = lang();
    var labels = {
      sea: { zh: '海运', en: 'Sea', id: 'Laut' },
      air: { zh: '空运', en: 'Air', id: 'Udara' }
    };
    return labels[mode] ? (labels[mode][l] || labels[mode].zh) : (value || '—');
  }
  function money(value, currency) {
    if (typeof global.fmtMoney === 'function') return global.fmtMoney(value, currency || 'RMB');
    return (currency || 'RMB') + ' ' + Number(value || 0).toLocaleString('en-US', {
      minimumFractionDigits: 2, maximumFractionDigits: 2
    });
  }
  function aliasesMatch(value, aliases) {
    var normalized = key(value);
    return aliases.some(function (item) { return normalized === key(item); });
  }
  function detailRoot() {
    var accordion = document.getElementById('ci-acc-items');
    if (accordion && accordion.closest) return accordion.closest('.modal-ci-create') || document.getElementById('modal-content');
    return document.getElementById('modal-content') || document;
  }
  function findDetailItem(grid, aliases) {
    var items = grid.querySelectorAll('.detail-item');
    for (var i = 0; i < items.length; i++) {
      var labelNode = items[i].querySelector('.detail-label');
      if (labelNode && aliasesMatch(labelNode.textContent, aliases)) return items[i];
    }
    return null;
  }
  function updateSummary(data) {
    var root = detailRoot();
    var grid = root && root.querySelector ? root.querySelector('.detail-grid') : null;
    if (!grid) return;

    var modes = Array.isArray(data.transport_modes) ? data.transport_modes : [];
    if (!modes.length && data.batch_totals_rmb) {
      modes = Object.keys(data.batch_totals_rmb).map(function (id) {
        return data.batch_totals_rmb[id] && data.batch_totals_rmb[id].transport_mode;
      }).filter(Boolean);
    }
    modes = Array.from(new Set(modes.map(function (m) { return String(m).toLowerCase(); })));
    var transportText = modes.length ? modes.map(label).join(' / ') : '—';
    var transportItem = findDetailItem(grid, ['运输方式', 'Transport Method', 'Transport Mode', 'Metode Transportasi']);
    if (transportItem) {
      var valueNode = transportItem.querySelector('.detail-value');
      if (valueNode) valueNode.textContent = transportText;
    }

    var freightItem = grid.querySelector('[data-ci-shared-freight-summary="1"]');
    if (!freightItem) {
      freightItem = document.createElement('div');
      freightItem.className = 'detail-item';
      freightItem.setAttribute('data-ci-shared-freight-summary', '1');
      var title = document.createElement('span');
      title.className = 'detail-label';
      title.textContent = lang() === 'en' ? 'Total Freight' : (lang() === 'id' ? 'Total Ongkos Angkut' : '总运费');
      var value = document.createElement('span');
      value.className = 'detail-value';
      freightItem.appendChild(title);
      freightItem.appendChild(value);
      if (transportItem && transportItem.parentNode) {
        transportItem.parentNode.insertBefore(freightItem, transportItem.nextSibling);
      } else {
        grid.appendChild(freightItem);
      }
    }
    var freightValue = freightItem.querySelector('.detail-value');
    var total = data.total_freight_rmb;
    if (total == null && data.batch_totals_rmb) {
      var entries = Object.keys(data.batch_totals_rmb).map(function (id) { return data.batch_totals_rmb[id]; });
      if (entries.every(function (item) { return item && item.total_minor != null; })) {
        total = entries.reduce(function (sum, item) { return sum + Number(item.total_minor || 0); }, 0) / 100;
      }
    }
    if (freightValue) {
      freightValue.textContent = total == null
        ? (lang() === 'en' ? 'Pending FX' : (lang() === 'id' ? 'Menunggu kurs' : '待折算'))
        : money(total, data.total_freight_currency || 'RMB');
      freightValue.title = (data.total_freight_errors || []).join('\n');
    }
  }

  function findColumn(headers, aliases) {
    for (var i = 0; i < headers.length; i++) {
      if (aliasesMatch(headers[i].textContent, aliases)) return i;
    }
    return -1;
  }
  function parseAmount(value) {
    var raw = text(value);
    var match = raw.match(/-?[\d,]+(?:\.\d+)?/);
    if (!match) return null;
    var amount = Number(match[0].replace(/,/g, ''));
    return Number.isFinite(amount) ? amount : null;
  }
  function updateBatchTable(data) {
    var body = document.getElementById('ci-acc-body-logi');
    if (!body || !body.querySelectorAll || !data.batch_totals_rmb) return;
    var batchMap = {};
    Object.keys(data.batch_totals_rmb).forEach(function (id) {
      var item = data.batch_totals_rmb[id] || {};
      if (item.batch_no) batchMap[key(item.batch_no)] = item;
    });
    var tables = body.querySelectorAll('table');
    for (var ti = 0; ti < tables.length; ti++) {
      var table = tables[ti];
      var headers = Array.prototype.slice.call(table.querySelectorAll('thead th'));
      if (!headers.length) continue;
      var modeIndex = findColumn(headers, ['运输方式', 'Transport Method', 'Transport Mode', 'Mode']);
      var freightIndex = findColumn(headers, ['综合运费', '总运费', 'Total Freight', 'Freight Total', 'Freight Cost']);
      var ratioIndex = findColumn(headers, ['运费/货值', '运费占比', 'Freight / Goods Value', 'Freight Ratio']);
      var goodsIndex = findColumn(headers, ['总货值', 'Total Value', 'Goods Value']);
      if (freightIndex < 0 && modeIndex < 0) continue;
      var rows = table.querySelectorAll('tbody tr');
      Array.prototype.forEach.call(rows, function (row) {
        var cells = row.children;
        if (!cells || !cells.length) return;
        var batchNo = key(cells[0].textContent);
        var item = batchMap[batchNo];
        if (!item) return;
        if (modeIndex >= 0 && cells[modeIndex]) cells[modeIndex].textContent = label(item.transport_mode);
        if (freightIndex >= 0 && cells[freightIndex]) {
          cells[freightIndex].textContent = item.total_minor == null
            ? (lang() === 'en' ? 'Pending FX' : (lang() === 'id' ? 'Menunggu kurs' : '待折算'))
            : money(Number(item.total_minor) / 100, 'RMB');
          cells[freightIndex].title = (item.errors || []).join('\n');
        }
        if (ratioIndex >= 0 && cells[ratioIndex]) {
          var goods = goodsIndex >= 0 && cells[goodsIndex] ? parseAmount(cells[goodsIndex].textContent) : null;
          var ciCurrency = String(data.ci_currency || '').toUpperCase();
          cells[ratioIndex].textContent = item.total_minor == null || !(goods > 0) || ciCurrency !== 'RMB'
            ? '—' : (Number(item.total_minor) / 100 / goods * 100).toFixed(2) + '%';
        }
      });
    }
  }

  async function hydrate(ciId, sequence) {
    if (typeof global.api !== 'function' || !ciId) return;
    var url = '/api/commercial-invoices/' + encodeURIComponent(ciId) + '/shared-logistics-fees?view=ci-summary';
    var data = await global.api(url);
    if (sequence !== requestSequence) return;
    var ctx = global.__ciDetailCtx || {};
    if (ctx.ciId && String(ctx.ciId) !== String(ciId)) return;
    updateSummary(data || {});
    updateBatchTable(data || {});
  }

  function install() {
    if (typeof global.loadCILogistics === 'function' && !global.loadCILogistics.__ciSharedFreightWrapped) {
      var original = global.loadCILogistics;
      var wrapped = async function (ciId) {
        var result = await original.apply(this, arguments);
        var sequence = ++requestSequence;
        try { await hydrate(ciId, sequence); }
        catch (error) {
          if (global.console && typeof global.console.warn === 'function') {
            global.console.warn('[CI shared freight display] failed to hydrate summary', error);
          }
        }
        return result;
      };
      wrapped.__ciSharedFreightWrapped = true;
      global.loadCILogistics = wrapped;
    }
  }

  install();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
