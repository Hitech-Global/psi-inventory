(function (global) {
  'use strict';

  if (!global || typeof document === 'undefined') return;

  function canViewAmounts() {
    return typeof global.hasPermission === 'function' && global.hasPermission('ci_amount_view');
  }
  function tr(key, fallback) {
    return typeof global.t === 'function' ? global.t(key, fallback) : fallback;
  }
  function norm(v) {
    return String(v == null ? '' : v).replace(/\s+/g, '').replace(/[：:]/g, '').trim().toLowerCase();
  }
  function addLabel(set, value) {
    if (value) set.add(norm(value));
  }
  function moneyLabels() {
    var s = new Set();
    [
      'CI金额','PI总金额','金额差异','已抵扣定金','已付定金','应付尾款','已付尾款','进口关税',
      '总运费','运费占比','总货值','综合运费','运费/货值',
      '原单价','折扣','折后单价','金额','实际关税税率(%)',
      '总货款','导入历史已付','后续已付','抵扣','抹零','未结金额',
      '应付','实际付款','未结',
      'CI Amount','PI Total','Amount Difference','Paid Deposit','Payable Balance','Paid Balance',
      'Total Freight','Freight / Value','Cargo Value','Unit Price','Discount','Net Unit Price','Amount',
      'Total Goods Value','Historical Paid','Subsequent Paid','Deduction','Rounding','Outstanding',
      'Payable','Actual Paid'
    ].forEach(function (x) { addLabel(s, x); });
    [
      ['field.goods_amount','CI金额'],
      ['ci.detail.pi_total','PI总金额'],
      ['ci.detail.amount_diff','金额差异'],
      ['ci.detail.deposit','已抵扣定金'],
      ['ci.detail.balance','应付尾款'],
      ['ci.detail.bal_paid','已付尾款'],
      ['ci.detail.duty','进口关税'],
      ['field.original_unit_price','原单价'],
      ['field.discount','折扣'],
      ['field.net_unit_price','折后单价'],
      ['ci.col.amount','金额'],
      ['logistics.col.cargo_value','总货值'],
      ['logistics.col.freight','综合运费'],
      ['logistics.col.freight_ratio','运费/货值'],
      ['ci.payrec.payable','应付'],
      ['ci.payrec.actual_paid','实际付款'],
      ['ci.payrec.deduction','抵扣'],
      ['ci.payrec.rounding','抹零'],
      ['ci.payrec.outstanding','未结']
    ].forEach(function (p) { addLabel(s, tr(p[0], p[1])); });
    return s;
  }

  function stripMoneyColumns(html) {
    if (canViewAmounts() || !html || typeof html !== 'string') return html;
    var host = document.createElement('div');
    host.innerHTML = html;
    var labels = moneyLabels();
    host.querySelectorAll('table').forEach(function (table) {
      var headRow = table.querySelector('thead tr');
      if (!headRow) return;
      var indexes = [];
      Array.prototype.forEach.call(headRow.children, function (th, idx) {
        if (labels.has(norm(th.textContent))) indexes.push(idx);
      });
      indexes.sort(function (a, b) { return b - a; });
      table.querySelectorAll('tr').forEach(function (row) {
        indexes.forEach(function (idx) {
          if (row.children[idx]) row.removeChild(row.children[idx]);
        });
      });
    });
    return host.innerHTML;
  }

  function sanitizeCIDetailBody(body, title) {
    if (canViewAmounts() || !body || typeof body !== 'string') return body;
    var titleText = String(title || '');
    var isOperational = titleText.indexOf('CI/PL') !== -1;
    var isHistorical = body.indexOf('source_mode = historical') !== -1;
    if (!isOperational && !isHistorical) return body;

    var host = document.createElement('div');
    host.innerHTML = body;
    var labels = moneyLabels();

    host.querySelectorAll('.detail-item').forEach(function (item) {
      var label = item.querySelector('.detail-label');
      if (label && labels.has(norm(label.textContent))) item.remove();
    });

    host.innerHTML = stripMoneyColumns(host.innerHTML);

    if (isOperational) {
      host.querySelectorAll('.ci-attach-slot').forEach(function (slot) {
        var label = slot.querySelector('.ci-attach-label');
        var txt = norm(label && label.textContent);
        if (txt && txt.indexOf('ci') !== -1 && txt.indexOf('pl') === -1) slot.remove();
      });
    }
    if (isHistorical) {
      host.querySelectorAll('.detail-section').forEach(function (section) {
        var h = section.querySelector('h3,h4');
        var txt = norm(h && h.textContent);
        if (txt.indexOf('历史ci附件') !== -1 || txt.indexOf('historicalciattachment') !== -1) section.remove();
      });
    }
    return host.innerHTML;
  }

  function wrapHtmlFunction(name) {
    var original = global[name];
    if (typeof original !== 'function' || original.__ciAmountWrapped) return;
    function wrapped() {
      var html = original.apply(this, arguments);
      return stripMoneyColumns(html);
    }
    wrapped.__ciAmountWrapped = true;
    wrapped.__original = original;
    global[name] = wrapped;
  }

  function installOpenModalGuard() {
    var original = global.openModal;
    if (typeof original !== 'function' || original.__ciAmountWrapped) return;
    function wrapped(title, body, footer, size) {
      return original.call(this, title, sanitizeCIDetailBody(body, title), footer, size);
    }
    wrapped.__ciAmountWrapped = true;
    wrapped.__original = original;
    global.openModal = wrapped;
  }

  function installSummaryGuard() {
    var original = global.renderPurchaseAmountSummary;
    if (typeof original !== 'function' || original.__ciAmountWrapped) return;
    function wrapped(summary) {
      if (!canViewAmounts()) return '';
      return original.call(this, summary);
    }
    wrapped.__ciAmountWrapped = true;
    wrapped.__original = original;
    global.renderPurchaseAmountSummary = wrapped;
  }

  function safeSheetName(raw, used) {
    if (typeof global.sanitizeSheetName === 'function') return global.sanitizeSheetName(raw, used);
    var s = String(raw || 'PL').replace(/[\[\]:*?/\\]/g, '').slice(0, 31) || 'PL';
    var out = s, i = 2;
    while (used[out]) {
      var suffix = '~' + i++;
      out = s.slice(0, 31 - suffix.length) + suffix;
    }
    used[out] = true;
    return out;
  }

  function buildPLOnlyWorkbook(data) {
    var wb = global.XLSX.utils.book_new();
    var used = {};
    (data.pls || []).forEach(function (pl) {
      var rows = (pl.items || []).map(function (it) {
        return {
          'SKU': it.sku_code,
          '每箱数量': it.qty_per_carton || 0,
          '箱数': it.cartons || 0,
          '总数量': it.total_qty || 0,
          '总毛重': it.gross_weight || 0,
          '总净重': it.net_weight || 0,
          '总体积': it.cbm || 0,
          '备注': it.remark || '',
          'PL No.': pl.pl_no || ''
        };
      });
      var ws = global.XLSX.utils.json_to_sheet(rows);
      global.XLSX.utils.book_append_sheet(wb, ws, safeSheetName('PL_' + (pl.pl_no || pl.id), used));
    });
    return wb;
  }

  function installExportGuards() {
    global.exportBatchPL = async function (batchId) {
      try {
        var data = await global.api('/api/logistics-batches/' + batchId + '/export-data?scope=pl');
        if (data.export_blocked) {
          global.showToast(global.exportBlockReason(data), 'warning');
          return;
        }
        var wb = buildPLOnlyWorkbook(data);
        var ciNo = data.ci && data.ci.ci_no ? data.ci.ci_no : 'CI';
        var base = typeof global.sanitizeFileBase === 'function' ? global.sanitizeFileBase : function (v) { return String(v || 'batch').replace(/[\\/:*?"<>|]/g, '_'); };
        global.XLSX.writeFile(wb, 'PL_' + base(ciNo) + '_' + base(data.batch.batch_no) + '.xlsx');
      } catch (e) {
        global.showToast(e.message, 'danger');
      }
    };

    global.exportBatchCIAndPL = async function (batchId) {
      if (!canViewAmounts()) {
        global.showToast(tr('ci.amount.no_export_permission', '没有查看金额权限，不能导出CI&PL'), 'danger');
        return;
      }
      try {
        var data = await global.api('/api/logistics-batches/' + batchId + '/export-data?scope=ci_pl');
        if (data.export_blocked) {
          global.showToast(global.exportBlockReason(data), 'warning');
          return;
        }
        var wb = global.buildPLWorkbook(data, true);
        var base = typeof global.sanitizeFileBase === 'function' ? global.sanitizeFileBase : function (v) { return String(v || 'batch').replace(/[\\/:*?"<>|]/g, '_'); };
        global.XLSX.writeFile(wb, 'CI_PL_' + base(data.ci.ci_no) + '_' + base(data.batch.batch_no) + '.xlsx');
      } catch (e) {
        global.showToast(e.message, 'danger');
      }
    };

    var originalToggle = global.toggleBatchExportMenu;
    global.toggleBatchExportMenu = function (batchId) {
      if (canViewAmounts()) return originalToggle.call(this, batchId);
      var el = document.getElementById('ci-logi-export-' + batchId);
      if (!el) return;
      if (el.style.display !== 'none') {
        el.style.display = 'none';
        el.innerHTML = '';
        return;
      }
      el.style.display = 'block';
      el.innerHTML = '<button class="btn btn-secondary btn-sm" onclick="exportBatchPL(\'' + String(batchId).replace(/'/g, '&#39;') + '\')">' + tr('export.pl_only', '导出PL') + '</button>';
    };
  }

  function install() {
    installOpenModalGuard();
    installSummaryGuard();
    ['renderOperationalCITable','renderHistoricalCITable','renderCIItemsRows','renderCIPaymentRecords','renderCILogisticsTable'].forEach(wrapHtmlFunction);
    installExportGuards();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();

  global.canViewCIAmounts = canViewAmounts;
})(typeof window !== 'undefined' ? window : globalThis);
