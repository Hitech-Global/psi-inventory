(function (global) {
  'use strict';

  function sharedFreightDisplayForBatch(batch, summary) {
    var id = String(batch && batch.id || '');
    var totals = summary && summary.batch_totals_rmb && typeof summary.batch_totals_rmb === 'object'
      ? summary.batch_totals_rmb : {};
    var item = totals[id];
    if (!item) {
      return { status: 'missing', amount: null, currency: 'RMB', ratio: null, error: 'No allocated freight result for this batch' };
    }
    if (item.total_minor == null || !Number.isFinite(Number(item.total_minor))) {
      return {
        status: 'pending_fx', amount: null, currency: 'RMB', ratio: null,
        error: Array.isArray(item.errors) ? item.errors.join('\\n') : ''
      };
    }
    var amount = Number(item.total_minor) / 100;
    var ciCurrency = String(summary && summary.ci_currency || batch && batch.ci_currency || '').trim().toUpperCase();
    if (ciCurrency === 'CNY') ciCurrency = 'RMB';
    var goodsValue = Number(batch && batch.cargo_value) || 0;
    return {
      status: 'ok',
      amount: amount,
      currency: 'RMB',
      ratio: ciCurrency === 'RMB' && goodsValue > 0 ? amount / goodsValue * 100 : null,
      error: ''
    };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { sharedFreightDisplayForBatch: sharedFreightDisplayForBatch };
  }

  if (!global || typeof document === 'undefined') return;
  if (global.__ciListInlineLogisticsInstalled) return;
  global.__ciListInlineLogisticsInstalled = true;

  var state = { openId: null, reqSeq: 0 };

  function esc(v) {
    if (typeof global.esc === 'function') return global.esc(v);
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function tr(key, fallback) {
    return typeof global.t === 'function' ? global.t(key, fallback) : fallback;
  }
  function fmtDate(v) {
    return typeof global.fmtDate === 'function' ? global.fmtDate(v) : (v || '');
  }
  function fmtMoney(v, c) {
    return typeof global.fmtMoney === 'function'
      ? global.fmtMoney(v, c)
      : ((c ? c + ' ' : '') + Number(v || 0).toFixed(2));
  }
  function hasPermission(p) {
    return typeof global.hasPermission === 'function' ? global.hasPermission(p) : false;
  }
  function canViewAmounts() {
    return hasPermission('ci_amount_view');
  }
  function logisticsStatusLabel(value) {
    if (typeof global.logisticsStatusLabelByKey === 'function') return global.logisticsStatusLabelByKey(value);
    return value || '—';
  }
  function listingStatusLabel(value) {
    var key = value || 'pending_plan';
    return tr('logistics.listing_status.' + key, key);
  }

  function wacUiText(key) {
    var lang = typeof global.getLang === 'function' ? String(global.getLang() || 'zh').toLowerCase().slice(0, 2) : 'zh';
    var labels = {
      pending: { zh: '待确认', en: 'Pending', id: 'Menunggu' },
      not_ready: { zh: '暂不可计算', en: 'Not ready', id: 'Belum siap' },
      confirm: { zh: '确认 WAC', en: 'Confirm WAC', id: 'Konfirmasi WAC' },
      skip: { zh: '无需计算', en: 'Skip WAC', id: 'Lewati WAC' },
      confirmed: { zh: '已确认', en: 'Confirmed', id: 'Dikonfirmasi' },
      excluded: { zh: '无需计算', en: 'Skipped', id: 'Dilewati' },
      restore: { zh: '恢复待确认', en: 'Restore', id: 'Pulihkan' },
      cc: { zh: 'CC', en: 'CC', id: 'CC' },
      view: { zh: '查看原因', en: 'View reason', id: 'Lihat alasan' },
      loading: { zh: '加载中…', en: 'Loading…', id: 'Memuat…' },
      status: { zh: 'WAC 状态', en: 'WAC Status', id: 'Status WAC' },
      notReadyReason: { zh: '该批次尚未进入 WAC 待确认阶段；请查看物流批次详情及 PL 数量。', en: 'This batch is not yet eligible for WAC confirmation. Check the logistics batch details and PL quantity.', id: 'Batch ini belum siap dikonfirmasi untuk WAC. Periksa detail logistik dan jumlah PL.' }
    };
    return (labels[key] && (labels[key][lang] || labels[key].zh)) || key;
  }

  function wacStatusCellHtml(batch) {
    var status = String(batch && batch.wac_status || 'not_ready');
    var labels = {
      pending: ['pending', 'pending'],
      confirmed: ['confirmed', 'confirmed'],
      excluded: ['excluded', 'excluded'],
      not_ready: ['not_ready', 'not-ready']
    };
    var item = labels[status] || labels.not_ready;
    var title = status === 'not_ready'
      ? wacUiText('notReadyReason')
      : '';
    return '<td class="ci-list-wac-status-cell" title="' + esc(title) + '">' +
      '<span class="ci-list-wac-badge ci-list-wac-badge-' + item[1] + '">' +
      esc(wacUiText(item[0])) + '</span></td>';
  }

  function wacActionsHtml(batch, ciId) {
    var status = String(batch && batch.wac_status || 'not_ready');
    var id = esc(batch && batch.id || '');
    var batchNo = esc(batch && batch.batch_no || '');
    if (status === 'pending') {
      if (!hasPermission('ci_edit')) return '<span class="ci-list-wac-no-action">—</span>';
      return '<button type="button" class="btn btn-primary btn-sm ci-list-wac-action" data-ci-logi-wac-confirm="' + id + '" data-ci-id="' + esc(ciId) + '" data-batch-no="' + batchNo + '">' + esc(wacUiText('confirm')) + '</button>' +
        '<button type="button" class="btn btn-secondary btn-sm ci-list-wac-action" data-ci-logi-wac-exclude="' + id + '" data-ci-id="' + esc(ciId) + '" data-batch-no="' + batchNo + '">' + esc(wacUiText('skip')) + '</button>';
    }
    if (status === 'confirmed') {
      return hasPermission('ci_edit')
        ? '<button type="button" class="btn btn-secondary btn-sm ci-list-wac-action" data-ci-logi-wac-cc="' + id + '" data-ci-id="' + esc(ciId) + '" data-batch-no="' + batchNo + '">' + esc(wacUiText('cc')) + '</button>'
        : '<span class="ci-list-wac-no-action">—</span>';
    }
    if (status === 'excluded') {
      return hasPermission('ci_edit')
        ? '<button type="button" class="btn btn-secondary btn-sm ci-list-wac-action" data-ci-logi-wac-restore="' + id + '" data-ci-id="' + esc(ciId) + '" data-batch-no="' + batchNo + '">' + esc(wacUiText('restore')) + '</button>'
        : '<span class="ci-list-wac-no-action">—</span>';
    }
    return '<button type="button" class="btn btn-secondary btn-sm ci-list-wac-action" data-ci-logi-wac-view="' + id + '" data-ci-id="' + esc(ciId) + '" data-batch-no="' + batchNo + '">' + esc(wacUiText('view')) + '</button>';
  }

  var LOGISTICS_INLINE_STATUS_OPTIONS = [
    { value: 'pending_shipment', raw: 'pending', labelKey: 'logistics.status.pending_shipment', fallback: '待出运' },
    { value: 'in_transit', raw: 'in_transit', labelKey: 'logistics.status.in_transit', fallback: '运输中' },
    { value: 'customs_clearing', raw: 'customs', labelKey: 'logistics.status.customs_clearing', fallback: '清关中' },
    { value: 'awaiting_delivery', raw: 'delivering', labelKey: 'logistics.status.awaiting_delivery', fallback: '待派送' },
    { value: 'warehouse_arrived', raw: 'completed', labelKey: 'logistics.status.warehouse_arrived', fallback: '已到仓' }
  ];

  var LISTING_INLINE_STATUS_OPTIONS = [
    'pending_plan', 'preparing', 'ready', 'listed'
  ];

  function logisticsDisplayStatusValue(batch) {
    var display = String((batch && batch.logistics_display_status) || '').trim();
    if (LOGISTICS_INLINE_STATUS_OPTIONS.some(function (option) { return option.value === display; })) return display;
    var raw = String((batch && batch.logistics_status) || '').trim();
    var map = {
      pending: 'pending_shipment',
      picked_up: 'pending_shipment',
      in_transit: 'in_transit',
      arrived: 'customs_clearing',
      customs: 'customs_clearing',
      cleared: 'awaiting_delivery',
      delivering: 'awaiting_delivery',
      completed: 'warehouse_arrived'
    };
    return map[raw] || 'pending_shipment';
  }

  function statusCellHtml(batch, field, ciId) {
    var isLogistics = field === 'logistics_status';
    var value = isLogistics
      ? logisticsDisplayStatusValue(batch)
      : String((batch && batch.listing_status) || 'pending_plan');
    var label = isLogistics
      ? tr('logistics.col.status', '状态')
      : tr('logistics.col.listing_status', 'Listing状态');
    var options = isLogistics
      ? LOGISTICS_INLINE_STATUS_OPTIONS.map(function (option) {
          return { value: option.value, label: tr(option.labelKey, option.fallback) };
        })
      : LISTING_INLINE_STATUS_OPTIONS.map(function (key) {
          return { value: key, label: listingStatusLabel(key) };
        });

    if (!hasPermission('logistics_edit')) {
      var displayLabel = isLogistics
        ? logisticsStatusLabel(value)
        : listingStatusLabel(value);
      return '<td>' + esc(displayLabel || '—') + '</td>';
    }

    var optionHtml = options.map(function (option) {
      return '<option value="' + esc(option.value) + '"' +
        (option.value === value ? ' selected' : '') + '>' + esc(option.label) + '</option>';
    }).join('');

    return '<td><select class="ci-list-logi-status-inline" data-ci-logi-status-field="' + esc(field) +
      '" data-ci-logi-status-batch="' + esc(batch && batch.id || '') +
      '" data-ci-logi-status-ci="' + esc(ciId) +
      '" data-saved-value="' + esc(value) +
      '" data-original-value="' + esc(value) +
      '" aria-label="' + esc(label) + '" title="' + esc(label) +
      '" onclick="event.stopPropagation()" onchange="updateCILogisticsStatusInline(this)">' +
      optionHtml + '</select></td>';
  }

  function statusToastText(field, success) {
    var lang = typeof global.getLang === 'function' ? String(global.getLang() || 'zh').toLowerCase().slice(0, 2) : 'zh';
    var labels = {
      logistics_status: { zh: '物流状态', en: 'Logistics status', id: 'Status logistik' },
      listing_status: { zh: '上架状态', en: 'Listing status', id: 'Status listing' }
    };
    var label = (labels[field] || labels.logistics_status)[lang] || (labels[field] || labels.logistics_status).zh;
    if (success) {
      if (lang === 'en') return label + ' updated';
      if (lang === 'id') return label + ' diperbarui';
      return label + '已更新';
    }
    if (lang === 'en') return 'Failed to save ' + label.toLowerCase();
    if (lang === 'id') return 'Gagal menyimpan ' + label.toLowerCase();
    return label + '保存失败';
  }

  function normalizeDateValue(value) {
    var raw = String(value == null ? '' : value).trim();
    var match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
    return match ? match[1] : '';
  }

  function dateCellHtml(batch, field, ciId) {
    var value = normalizeDateValue(batch && batch[field]);
    var label = field === 'eta_date'
      ? tr('logistics.col.eta', '预计到港')
      : tr('logistics.col.arrival', '到货日期');
    if (!hasPermission('logistics_edit')) {
      return '<td class="cell-date">' + esc(fmtDate(value) || '—') + '</td>';
    }
    return '<td class="cell-date"><input type="date" class="ci-list-logi-date-inline" value="' + esc(value) +
      '" data-ci-logi-date-field="' + esc(field) +
      '" data-ci-logi-date-batch="' + esc(batch && batch.id || '') +
      '" data-ci-logi-date-ci="' + esc(ciId) +
      '" data-saved-value="' + esc(value) +
      '" data-original-value="' + esc(value) +
      '" aria-label="' + esc(label) + '" title="' + esc(label) +
      '" onclick="event.stopPropagation()" onchange="updateCILogisticsDateInline(this)"></td>';
  }

  function dateToastText(field, success) {
    var lang = typeof global.getLang === 'function' ? String(global.getLang() || 'zh').toLowerCase().slice(0, 2) : 'zh';
    var labels = {
      eta_date: { zh: '预计到港日期', en: 'Estimated arrival date', id: 'Tanggal perkiraan tiba' },
      actual_arrival_date: { zh: '到货日期', en: 'Actual arrival date', id: 'Tanggal kedatangan aktual' }
    };
    var label = (labels[field] || labels.eta_date)[lang] || (labels[field] || labels.eta_date).zh;
    if (success) {
      if (lang === 'en') return label + ' updated';
      if (lang === 'id') return label + ' diperbarui';
      return label + '已更新';
    }
    if (lang === 'en') return 'Failed to save ' + label.toLowerCase();
    if (lang === 'id') return 'Gagal menyimpan ' + label.toLowerCase();
    return label + '保存失败';
  }
  function isModalOpen() {
    if (typeof global.isModalOpen === 'function') return global.isModalOpen();
    var ov = document.getElementById('modal-overlay');
    return !!(ov && ov.classList.contains('show'));
  }

  function logisticsCount(c) {
    var raw = String((c && c.related_logistics_batch_nos) || '').trim();
    if (!raw || raw === '—') return 0;
    return raw.split(',').map(function (x) { return x.trim(); }).filter(Boolean).length;
  }

  function injectStyle() {
    if (document.getElementById('ci-list-inline-logistics-style')) return;
    var style = document.createElement('style');
    style.id = 'ci-list-inline-logistics-style';
    style.textContent = [
      '.content-inner:has(#ci-source-mode) #ci-table .ci-list-logi-toggle{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;margin-right:5px;padding:0;border:0;border-radius:6px;background:transparent;color:#6e6e73;font-size:10px;vertical-align:middle;cursor:pointer;box-shadow:none}',
      '.content-inner:has(#ci-source-mode) #ci-table .ci-list-logi-toggle:hover{background:#ececf0;color:#1d1d1f}',
      '.content-inner:has(#ci-source-mode) #ci-table .ci-list-logi-row[hidden]{display:none!important}',
      '.content-inner:has(#ci-source-mode) #ci-table .ci-list-logi-row>td{padding:0!important;background:#f8f8fa!important;border-bottom:1px solid #e5e5ea!important;white-space:normal!important}',
      '.content-inner:has(#ci-source-mode) #ci-table .ci-list-logi-panel{margin:8px 10px 12px;padding:0;background:#fff;border:1px solid #e1e1e6;border-radius:14px;overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,.025)}',
      '.content-inner:has(#ci-source-mode) #ci-table .ci-list-logi-panel-head{display:flex;align-items:center;justify-content:space-between;padding:11px 13px;border-bottom:1px solid #ededf0;background:#fbfbfc}',
      '.content-inner:has(#ci-source-mode) #ci-table .ci-list-logi-title{font-size:13px;font-weight:650;color:#1d1d1f}',
      '.content-inner:has(#ci-source-mode) #ci-table .ci-list-logi-count{color:#86868b;font-weight:500}',
      '.content-inner:has(#ci-source-mode) #ci-table .ci-list-logi-collapse{display:flex;align-items:center;justify-content:center;width:28px;height:26px;padding:0;border:1px solid #e5e5ea;border-radius:8px;background:#fff;color:#6e6e73;cursor:pointer}',
      '.content-inner:has(#ci-source-mode) #ci-table .ci-list-logi-collapse:hover{background:#f2f2f4;color:#1d1d1f}',
      '.content-inner:has(#ci-source-mode) #ci-table .ci-list-logi-body{padding:10px 12px 12px}',
      '.content-inner:has(#ci-source-mode) #ci-table .ci-list-logi-table-wrap{margin:0;border:1px solid #e5e5ea;border-radius:10px!important;overflow:auto;background:#fff;box-shadow:none!important}',
      '.content-inner:has(#ci-source-mode) #ci-table .ci-list-logi-table{min-width:1320px;font-size:12px;background:#fff}',
      '.content-inner:has(#ci-source-mode) #ci-table .ci-list-logi-table th{padding:8px 9px!important;background:#f2f2f4!important;color:#6e6e73!important;font-size:11px!important;font-weight:650!important;text-align:left!important;white-space:nowrap!important}',
      '.content-inner:has(#ci-source-mode) #ci-table .ci-list-logi-table td{padding:8px 9px!important;background:#fff!important;color:#3a3a3c!important;text-align:left!important;white-space:nowrap!important;border-bottom:1px solid #ededf0!important}',
      '.content-inner:has(#ci-source-mode) #ci-table .ci-list-logi-table .text-right{text-align:left!important}',
      ".content-inner:has(#ci-source-mode) #ci-table .ci-list-logi-date-inline{appearance:none;-webkit-appearance:none;box-sizing:border-box;width:132px;min-width:132px;height:28px;padding:0 8px;border:1px solid transparent;border-radius:8px;background:#f2f2f7;color:#1d1d1f;font:500 12px -apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;cursor:pointer;color-scheme:light;transition:background .15s,border-color .15s,box-shadow .15s}",
      ".content-inner:has(#ci-source-mode) #ci-table .ci-list-logi-date-inline:hover{background:#e9e9ef;border-color:#d2d2d7}",
      ".content-inner:has(#ci-source-mode) #ci-table .ci-list-logi-date-inline:focus{background:#fff;border-color:#007aff;box-shadow:0 0 0 3px rgba(0,122,255,.12);outline:none}",
      ".content-inner:has(#ci-source-mode) #ci-table .ci-list-logi-date-inline:disabled{opacity:.65;cursor:not-allowed}",
      ".content-inner:has(#ci-source-mode) #ci-table .ci-list-logi-date-inline.is-saving{opacity:.65;cursor:wait}",
      ".content-inner:has(#ci-source-mode) #ci-table .ci-list-logi-status-inline{box-sizing:border-box;min-width:132px;height:28px;padding:0 25px 0 8px;border:1px solid transparent;border-radius:8px;background-color:#f2f2f7;color:#1d1d1f;font:500 12px -apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;cursor:pointer;transition:background .15s,border-color .15s,box-shadow .15s}",
      ".content-inner:has(#ci-source-mode) #ci-table .ci-list-logi-status-inline[data-ci-logi-status-field=\"listing_status\"]{min-width:168px}",
      ".content-inner:has(#ci-source-mode) #ci-table .ci-list-logi-status-inline:hover{background-color:#e9e9ef;border-color:#d2d2d7}",
      ".content-inner:has(#ci-source-mode) #ci-table .ci-list-logi-status-inline:focus{background-color:#fff;border-color:#007aff;box-shadow:0 0 0 3px rgba(0,122,255,.12);outline:none}",
      ".content-inner:has(#ci-source-mode) #ci-table .ci-list-logi-status-inline:disabled{opacity:.65;cursor:not-allowed}",
      ".content-inner:has(#ci-source-mode) #ci-table .ci-list-logi-status-inline.is-saving{opacity:.65;cursor:wait}",
      '.content-inner:has(#ci-source-mode) #ci-table .ci-list-logi-table tbody tr:hover td{background:#fafafa!important}',
      '.content-inner:has(#ci-source-mode) #ci-table .ci-list-logi-table tbody tr.ci-list-logi-clickable-row{cursor:pointer}',
      '.content-inner:has(#ci-source-mode) #ci-table .ci-list-logi-table tbody tr.ci-list-logi-clickable-row:hover td{background:#f3f6fb!important}',
      '.content-inner:has(#ci-source-mode) #ci-table .ci-list-wac-badge{display:inline-flex;align-items:center;min-height:22px;padding:2px 7px;border-radius:7px;font-size:10px;font-weight:650;white-space:nowrap}',
      '.content-inner:has(#ci-source-mode) #ci-table .ci-list-wac-badge-pending{background:#fff4e5;color:#9a5b00}',
      '.content-inner:has(#ci-source-mode) #ci-table .ci-list-wac-badge-confirmed{background:#eaf7ef;color:#217a43}',
      '.content-inner:has(#ci-source-mode) #ci-table .ci-list-wac-badge-excluded{background:#f1f1f4;color:#62626a}',
      '.content-inner:has(#ci-source-mode) #ci-table .ci-list-wac-badge-not-ready{background:#fff1f0;color:#a33b32}',
      '.content-inner:has(#ci-source-mode) #ci-table .ci-list-wac-no-action{color:#a1a1a6;font-size:12px}',
      '.content-inner:has(#ci-source-mode) #ci-table .ci-list-wac-status-cell{min-width:104px}',
      '.content-inner:has(#ci-source-mode) #ci-table .ci-list-wac-action{min-height:25px;padding:3px 8px;border-radius:7px;font-size:10px;white-space:nowrap}',
      '.content-inner:has(#ci-source-mode) #ci-table .ci-list-wac-action:disabled{opacity:.55;cursor:wait}',
      '.content-inner:has(#ci-source-mode) #ci-table .ci-list-logi-owners{max-width:220px;overflow:hidden;text-overflow:ellipsis}',
      '.content-inner:has(#ci-source-mode) #ci-table .ci-list-logi-table .cell-actions{position:sticky;right:0;background:#fff!important;box-shadow:-6px 0 10px rgba(0,0,0,.04)}',
      '.content-inner:has(#ci-source-mode) #ci-table .ci-list-logi-actions{padding-top:10px}',
      '.content-inner:has(#ci-source-mode) #ci-table .ci-list-logi-create{min-height:32px;padding:5px 11px;border-radius:8px;background:#1d1d1f;border-color:#1d1d1f;color:#fff;font-size:12px;font-weight:650;box-shadow:none}',
      '.content-inner:has(#ci-source-mode) #ci-table .ci-list-logi-create:hover{background:#000;border-color:#000}',
      '.content-inner:has(#ci-source-mode) #ci-table .ci-list-logi-export-actions{display:flex;gap:5px;align-items:center;white-space:nowrap}',
      '.content-inner:has(#ci-source-mode) #ci-table .ci-list-logi-loading{display:flex;align-items:center;gap:11px;min-height:82px;padding:15px 16px;background:#fafafa;border:1px solid #ededf0;border-radius:10px;color:#1d1d1f}',
      '.content-inner:has(#ci-source-mode) #ci-table .ci-list-logi-spinner{width:18px;height:18px;flex:0 0 18px;border:2px solid #d2d2d7;border-top-color:#1d1d1f;border-radius:50%;animation:ciListLogiSpin .75s linear infinite}',
      '@keyframes ciListLogiSpin{to{transform:rotate(360deg)}}',
      '.content-inner:has(#ci-source-mode) #ci-table .ci-list-logi-loading-title{font-size:13px;font-weight:650;color:#1d1d1f}',
      '.content-inner:has(#ci-source-mode) #ci-table .ci-list-logi-loading-sub{margin-top:3px;font-size:11px;color:#86868b}',
      '.content-inner:has(#ci-source-mode) #ci-table .ci-list-logi-empty,.content-inner:has(#ci-source-mode) #ci-table .ci-list-logi-error{padding:18px 14px;background:#fafafa;border:1px solid #ededf0;border-radius:10px;color:#86868b;font-size:12px}',
      '.content-inner:has(#ci-source-mode) #ci-table .ci-list-logi-error{color:#b45309}'
    ].join('\n');
    document.head.appendChild(style);
  }

  function buildShell(c, colCount) {
    var trEl = document.createElement('tr');
    trEl.className = 'ci-list-logi-row';
    trEl.id = 'ci-list-logi-row-' + c.id;
    trEl.hidden = true;

    var td = document.createElement('td');
    td.colSpan = Math.max(colCount || 1, 1);
    td.innerHTML =
      '<div class="ci-list-logi-panel">' +
        '<div class="ci-list-logi-panel-head">' +
          '<div class="ci-list-logi-title">🚚 ' + esc(tr('logistics.title', '物流批次')) +
            ' <span class="ci-list-logi-count" id="ci-list-logi-count-' + esc(c.id) + '">(' + logisticsCount(c) + ')</span></div>' +
          '<button type="button" class="ci-list-logi-collapse" data-ci-logi-collapse="' + esc(c.id) + '" title="' + esc(tr('common.close', '收起')) + '">⌃</button>' +
        '</div>' +
        '<div class="ci-list-logi-body" id="ci-list-logi-body-' + esc(c.id) + '"></div>' +
      '</div>';
    trEl.appendChild(td);
    return trEl;
  }

  function decorateOperationalHtml(html, data) {
    if (!Array.isArray(data) || !data.length || typeof html !== 'string') return html;
    var host = document.createElement('div');
    host.innerHTML = html;
    var table = host.querySelector('table.data-table');
    var tbody = table && table.tBodies && table.tBodies[0];
    if (!table || !tbody) return html;

    var rows = Array.prototype.slice.call(tbody.rows);
    data.forEach(function (c, idx) {
      var row = rows[idx];
      if (!row || !row.cells || !row.cells.length) return;

      var firstCell = row.cells[0];
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ci-list-logi-toggle';
      btn.setAttribute('data-ci-logi-toggle', c.id);
      btn.title = tr('logistics.title', '物流批次') + '（' + logisticsCount(c) + '）';
      btn.innerHTML = '<span id="ci-list-logi-caret-' + esc(c.id) + '">▶</span>';
      firstCell.insertBefore(btn, firstCell.firstChild);

      var shell = buildShell(c, row.cells.length);
      tbody.insertBefore(shell, row.nextSibling);
    });
    return host.innerHTML;
  }

  function cacheEntry(ciId) {
    try {
      if (typeof __ciLogiCache !== 'undefined' && __ciLogiCache.has(ciId)) return __ciLogiCache.get(ciId);
    } catch (e) {}
    return null;
  }
  function setCache(ciId, data) {
    try {
      if (typeof __ciLogiCache !== 'undefined') __ciLogiCache.set(ciId, { ts: Date.now(), data: data });
    } catch (e) {}
  }
  function invalidateCache(ciId) {
    try {
      if (typeof global.invalidateCILogistics === 'function') global.invalidateCILogistics(ciId);
      else if (typeof __ciLogiCache !== 'undefined') __ciLogiCache.delete(ciId);
    } catch (e) {}
  }

  function closePanel(ciId) {
    if (!ciId) return;
    var row = document.getElementById('ci-list-logi-row-' + ciId);
    if (row) row.hidden = true;
    var caret = document.getElementById('ci-list-logi-caret-' + ciId);
    if (caret) caret.textContent = '▶';
    if (state.openId === ciId) state.openId = null;
  }

  function loadingHtml() {
    return '<div class="ci-list-logi-loading">' +
      '<span class="ci-list-logi-spinner" aria-hidden="true"></span>' +
      '<div><div class="ci-list-logi-loading-title">' + esc(tr('logistics.list.loading', '正在加载物流批次…')) + '</div>' +
      '<div class="ci-list-logi-loading-sub">' + esc(tr('logistics.list.loading_hint', '正在读取该 CI 的物流批次信息，请稍候')) + '</div></div>' +
      '</div>';
  }

  function renderPanel(batches, ciId) {
    var list = Array.isArray(batches) ? batches : [];
    var showAmounts = canViewAmounts();
    var rowsHtml = '';

    if (list.length) {
      rowsHtml = list.map(function (b) {
        var cbmFromPl = (b.pls || []).reduce(function (s, p) { return s + (Number(p.total_cbm) || 0); }, 0);
        var cbm = cbmFromPl > 0 ? cbmFromPl : (Number(b.total_cbm) || 0);
        var cargoCur = b.ci_currency || b.freight_currency || '';
        return '<tr class="ci-list-logi-clickable-row" data-ci-logi-row="' + esc(b.id || '') + '" data-ci-id="' + esc(ciId) + '" data-batch-no="' + esc(b.batch_no || '') + '" data-wac-status="' + esc(b.wac_status || 'not_ready') + '" data-wac-exclusion-reason="' + esc(b.wac_exclusion_reason || '') + '" title="' + esc(tr('common.view', '查看详情')) + '">' +
          '<td class="cell-id">' + esc(b.batch_no || '') + '</td>' +
          '<td>' + esc(b.forwarder_name || '—') + '</td>' +
          '<td>' + esc(tr('logistics.mode.' + (b.transport_mode || ''), b.transport_mode || '—')) + '</td>' +
          dateCellHtml(b, 'eta_date', ciId) +
          dateCellHtml(b, 'actual_arrival_date', ciId) +
          '<td>' + (b.actual_transit_days != null ? esc(b.actual_transit_days) : '—') + '</td>' +
          '<td>' + (b.total_cartons != null ? esc(b.total_cartons) : '0') + '</td>' +
          '<td>' + cbm.toFixed(2) + '</td>' +
          (showAmounts
            ? '<td>' + esc(fmtMoney(b.cargo_value || 0, cargoCur)) + '</td>' +
              '<td data-ci-logi-freight="1">…</td>' +
              '<td data-ci-logi-freight-ratio="1">…</td>'
            : '') +
          statusCellHtml(b, 'logistics_status', ciId) +
          statusCellHtml(b, 'listing_status', ciId) +
          '<td class="ci-list-logi-owners">' + (b.listing_owner_names && b.listing_owner_names.length ? esc(b.listing_owner_names.join('、')) : '—') + '</td>' +
          wacStatusCellHtml(b) +
          '<td class="cell-actions"><div class="ci-list-logi-export-actions">' +
            (hasPermission('logistics_edit') ? '<button class="action-btn" data-ci-logi-edit="' + esc(b.id) + '" data-ci-id="' + esc(ciId) + '" title="' + esc(tr('common.edit', '编辑')) + '">✏️</button> ' : '') +
            wacActionsHtml(b, ciId) +
            '<button class="btn btn-secondary btn-sm" data-ci-logi-export-pl="' + esc(b.id) + '">' + esc(tr('export.pl_only', '导出PL')) + '</button>' +
            '<button class="btn btn-secondary btn-sm" data-ci-logi-export-ci-pl="' + esc(b.id) + '">' + esc(tr('export.ci_and_pl', '导出CI&PL')) + '</button>' +
          '</div></td>' +
        '</tr>';
      }).join('');
    }

    var tableHtml = list.length
      ? '<div class="table-container ci-list-logi-table-wrap"><table class="data-table ci-list-logi-table"><thead><tr>' +
          '<th>' + esc(tr('logistics.col.batch_no', '物流单号')) + '</th>' +
          '<th>' + esc(tr('logistics.col.forwarder', '货代')) + '</th>' +
          '<th>' + esc(tr('logistics.col.transport', '运输方式')) + '</th>' +
          '<th>' + esc(tr('logistics.col.eta', '预计到港')) + '</th>' +
          '<th>' + esc(tr('logistics.col.arrival', '到货日期')) + '</th>' +
          '<th>' + esc(tr('logistics.col.transit_days', '运输时效')) + '</th>' +
          '<th>' + esc(tr('logistics.col.cartons', '箱数')) + '</th>' +
          '<th>' + esc(tr('logistics.col.cbm', 'CBM')) + '</th>' +
          (showAmounts
            ? '<th>' + esc(tr('logistics.col.cargo_value', '总货值')) + '</th>' +
              '<th>' + esc(tr('logistics.col.freight', '综合运费')) + '</th>' +
              '<th>' + esc(tr('logistics.col.freight_ratio', '运费/货值')) + '</th>'
            : '') +
          '<th>' + esc(tr('logistics.col.status', '状态')) + '</th>' +
          '<th>' + esc(tr('logistics.col.listing_status', 'Listing状态')) + '</th>' +
          '<th>' + esc(tr('logistics.col.owners', '负责人')) + '</th>' +
          '<th>' + esc(wacUiText('status')) + '</th>' +
          '<th>' + esc(tr('common.actions', '操作')) + '</th>' +
        '</tr></thead><tbody>' + rowsHtml + '</tbody></table></div>'
      : '<div class="ci-list-logi-empty">' + esc(tr('logistics.no_batch', '该CI暂无关联物流批次')) + '</div>';

    var createBtn = hasPermission('logistics_create')
      ? '<div class="ci-list-logi-actions"><button class="btn btn-primary btn-sm ci-list-logi-create" data-ci-logi-create="' + esc(ciId) + '">+ ' + esc(tr('logistics.new_batch', '新建物流批次')) + '</button></div>'
      : '';

    var countEl = document.getElementById('ci-list-logi-count-' + ciId);
    if (countEl) countEl.textContent = '(' + list.length + ')';

    return tableHtml + createBtn;
  }

  function freightUiText(key) {
    var lang = typeof global.getLang === 'function'
      ? String(global.getLang() || 'zh').toLowerCase().slice(0, 2) : 'zh';
    var labels = {
      pending: { zh: '待折算', en: 'Pending FX', id: 'Menunggu kurs' },
      unavailable: { zh: '—', en: '—', id: '—' },
      loadFailed: { zh: '综合运费加载失败，请刷新重试', en: 'Failed to load allocated freight. Refresh and retry.', id: 'Gagal memuat alokasi ongkos. Muat ulang dan coba lagi.' },
      ratioCurrency: { zh: 'CI货值不是人民币，暂不计算运费占比', en: 'CI goods value is not denominated in RMB; freight ratio is unavailable.', id: 'Nilai barang CI bukan RMB; rasio ongkos tidak tersedia.' },
      allocated: { zh: '按合并费用分摊结果计算', en: 'Calculated from shared freight allocations', id: 'Dihitung dari alokasi biaya gabungan' }
    };
    return (labels[key] && labels[key][lang]) || (labels[key] && labels[key].zh) || '';
  }

  async function hydrateSharedFreight(ciId, batches, token) {
    if (!canViewAmounts() || typeof global.api !== 'function' || !ciId) return;
    var body = document.getElementById('ci-list-logi-body-' + ciId);
    if (!body) return;
    try {
      var summary = await global.api('/api/commercial-invoices/' + encodeURIComponent(ciId) + '/shared-logistics-fees?view=ci-summary');
      if (state.openId !== ciId || (token != null && token !== state.reqSeq)) return;
      var byId = {};
      (Array.isArray(batches) ? batches : []).forEach(function (batch) {
        if (batch && batch.id) byId[String(batch.id)] = batch;
      });
      Array.prototype.forEach.call(body.querySelectorAll('tr[data-ci-logi-row]'), function (row) {
        var batchId = String(row.getAttribute('data-ci-logi-row') || '');
        var batch = byId[batchId];
        var totalCell = row.querySelector('[data-ci-logi-freight]');
        var ratioCell = row.querySelector('[data-ci-logi-freight-ratio]');
        if (!batch || !totalCell || !ratioCell) return;
        var display = sharedFreightDisplayForBatch(batch, summary || {});
        totalCell.removeAttribute('title');
        ratioCell.removeAttribute('title');
        if (display.status === 'missing') {
          totalCell.textContent = freightUiText('unavailable');
          ratioCell.textContent = '—';
          totalCell.title = display.error || freightUiText('loadFailed');
          ratioCell.title = totalCell.title;
          return;
        }
        if (display.status !== 'ok') {
          totalCell.textContent = freightUiText('pending');
          ratioCell.textContent = '—';
          totalCell.title = display.error || freightUiText('pending');
          ratioCell.title = totalCell.title;
          return;
        }
        totalCell.textContent = fmtMoney(display.amount, 'RMB');
        totalCell.title = freightUiText('allocated');
        if (display.ratio == null) {
          ratioCell.textContent = '—';
          ratioCell.title = freightUiText('ratioCurrency');
        } else {
          ratioCell.textContent = Number(display.ratio).toFixed(2) + '%';
        }
      });
    } catch (error) {
      if (state.openId !== ciId || (token != null && token !== state.reqSeq)) return;
      Array.prototype.forEach.call(body.querySelectorAll('[data-ci-logi-freight],[data-ci-logi-freight-ratio]'), function (cell) {
        cell.textContent = '—';
        cell.title = freightUiText('loadFailed');
      });
      if (global.console && typeof global.console.warn === 'function') {
        global.console.warn('[CI list shared freight] failed to hydrate batch allocations', error);
      }
    }
  }

  function patchCachedBatchFields(ciId, batchId, fields) {
    var cached = cacheEntry(ciId);
    if (!cached || !Array.isArray(cached.data)) return null;
    var patched = cached.data.map(function (batch) {
      if (!batch || String(batch.id) !== String(batchId)) return batch;
      var copy = Object.assign({}, batch);
      Object.keys(fields || {}).forEach(function (field) { copy[field] = fields[field]; });
      return copy;
    });
    setCache(ciId, patched);
    return patched;
  }

  function patchCachedBatchDate(ciId, batchId, field, value) {
    var patch = {};
    patch[field] = value;
    return patchCachedBatchFields(ciId, batchId, patch);
  }

  async function refreshInlineDatePanel(ciId, fallbackRows) {
    if (!ciId) return;
    invalidateCache(ciId);
    try {
      var rows = await global.api('/api/commercial-invoices/' + encodeURIComponent(ciId) + '/logistics-batches');
      setCache(ciId, rows);
      if (state.openId === ciId) {
        var body = document.getElementById('ci-list-logi-body-' + ciId);
        if (body) {
          body.innerHTML = renderPanel(rows || [], ciId);
          hydrateSharedFreight(ciId, rows || [], state.reqSeq);
        }
      }
    } catch (e) {
      if (Array.isArray(fallbackRows)) {
        setCache(ciId, fallbackRows);
        if (state.openId === ciId) {
          var fallbackBody = document.getElementById('ci-list-logi-body-' + ciId);
          if (fallbackBody) {
            fallbackBody.innerHTML = renderPanel(fallbackRows, ciId);
            hydrateSharedFreight(ciId, fallbackRows, state.reqSeq);
          }
        }
      }
    }
  }

  global.updateCILogisticsDateInline = async function (input) {
    if (!input || input.disabled) return;
    var field = input.getAttribute('data-ci-logi-date-field') || '';
    var batchId = input.getAttribute('data-ci-logi-date-batch') || '';
    var ciId = input.getAttribute('data-ci-logi-date-ci') || '';
    if (!batchId || !ciId || (field !== 'eta_date' && field !== 'actual_arrival_date')) return;

    var oldValue = normalizeDateValue(input.getAttribute('data-saved-value'));
    var nextValue = normalizeDateValue(input.value);
    if (nextValue === oldValue) return;
    if (!hasPermission('logistics_edit')) {
      input.value = oldValue;
      return;
    }

    input.disabled = true;
    if (input.classList) input.classList.add('is-saving');
    try {
      var payload = {};
      payload[field] = nextValue;
      await global.api('/api/logistics-batches/' + encodeURIComponent(batchId), 'PUT', payload);
      input.setAttribute('data-saved-value', nextValue);
      input.setAttribute('data-original-value', nextValue);
      if (input.classList) input.classList.remove('is-saving');
      input.disabled = !hasPermission('logistics_edit');

      var fallbackRows = patchCachedBatchDate(ciId, batchId, field, nextValue);
      if (typeof global.showToast === 'function') global.showToast(dateToastText(field, true), 'success');
      await refreshInlineDatePanel(ciId, fallbackRows);
    } catch (e) {
      input.value = oldValue;
      if (input.classList) input.classList.remove('is-saving');
      input.disabled = !hasPermission('logistics_edit');
      if (typeof global.showToast === 'function') {
        global.showToast((e && e.message) || dateToastText(field, false), 'danger');
      }
    }
  };

  global.updateCILogisticsStatusInline = async function (select) {
    if (!select || select.disabled) return;
    var field = select.getAttribute('data-ci-logi-status-field') || '';
    var batchId = select.getAttribute('data-ci-logi-status-batch') || '';
    var ciId = select.getAttribute('data-ci-logi-status-ci') || '';
    if (!batchId || !ciId || (field !== 'logistics_status' && field !== 'listing_status')) return;

    var oldValue = String(select.getAttribute('data-saved-value') || '');
    var nextValue = String(select.value || '');
    if (nextValue === oldValue) return;
    if (!hasPermission('logistics_edit')) {
      select.value = oldValue;
      return;
    }

    select.disabled = true;
    if (select.classList) select.classList.add('is-saving');
    try {
      var fallbackRows;
      if (field === 'logistics_status') {
        var option = LOGISTICS_INLINE_STATUS_OPTIONS.filter(function (item) {
          return item.value === nextValue;
        })[0];
        if (!option) throw new Error('Invalid logistics status');
        await global.api('/api/logistics-batches/' + encodeURIComponent(batchId), 'PUT', {
          logistics_status: option.raw
        });
        fallbackRows = patchCachedBatchFields(ciId, batchId, {
          logistics_status: option.raw,
          logistics_display_status: option.value
        });
      } else {
        await global.api('/api/logistics-batches/' + encodeURIComponent(batchId) + '/listing', 'POST', {
          listing_status: nextValue
        });
        fallbackRows = patchCachedBatchFields(ciId, batchId, { listing_status: nextValue });
      }

      select.setAttribute('data-saved-value', nextValue);
      select.setAttribute('data-original-value', nextValue);
      if (select.classList) select.classList.remove('is-saving');
      select.disabled = !hasPermission('logistics_edit');
      if (typeof global.showToast === 'function') global.showToast(statusToastText(field, true), 'success');
      await refreshInlineDatePanel(ciId, fallbackRows);
    } catch (e) {
      select.value = oldValue;
      if (select.classList) select.classList.remove('is-saving');
      select.disabled = !hasPermission('logistics_edit');
      if (typeof global.showToast === 'function') {
        global.showToast((e && e.message) || statusToastText(field, false), 'danger');
      }
    }
  };

  async function togglePanel(ciId, forceOpen) {
    var row = document.getElementById('ci-list-logi-row-' + ciId);
    if (!row) return;

    if (state.openId && state.openId !== ciId) closePanel(state.openId);

    var shouldOpen = forceOpen === true || row.hidden;
    if (!shouldOpen) {
      closePanel(ciId);
      return;
    }

    row.hidden = false;
    state.openId = ciId;
    var caret = document.getElementById('ci-list-logi-caret-' + ciId);
    if (caret) caret.textContent = '▼';

    var body = document.getElementById('ci-list-logi-body-' + ciId);
    if (!body) return;

    var token = ++state.reqSeq;
    var cached = cacheEntry(ciId);
    if (cached) {
      body.innerHTML = renderPanel(cached.data || [], ciId);
      hydrateSharedFreight(ciId, cached.data || [], token);
      return;
    }

    body.innerHTML = loadingHtml();

    try {
      var data = await global.api('/api/commercial-invoices/' + ciId + '/logistics-batches');
      setCache(ciId, data);
      if (token !== state.reqSeq || state.openId !== ciId) return;
      var liveBody = document.getElementById('ci-list-logi-body-' + ciId);
      if (liveBody) {
        liveBody.innerHTML = renderPanel(data || [], ciId);
        hydrateSharedFreight(ciId, data || [], token);
      }
    } catch (e) {
      if (token !== state.reqSeq || state.openId !== ciId) return;
      var errBody = document.getElementById('ci-list-logi-body-' + ciId);
      if (errBody) {
        errBody.innerHTML = '<div class="ci-list-logi-error">' +
          esc((e && e.message) || tr('common.load_fail', '加载失败')) +
          ' <button class="btn btn-secondary btn-sm" data-ci-logi-retry="' + esc(ciId) + '">' + esc(tr('common.retry', '重试')) + '</button></div>';
      }
    }
  }

  async function openCreate(ciId) {
    if (typeof global.createLogFromCI !== 'function') return;
    await global.createLogFromCI(ciId);
    if (global.__logiCtx && global.__logiCtx.source === 'ci-detail' && global.__logiCtx.ciId === ciId && isModalOpen()) {
      global.__logiCtx = { source: 'ci-list', ciId: ciId };
      var back = document.querySelector('#modal-content .ci-logi-back');
      if (back) back.remove();
    }
  }

  async function openEdit(batchId, ciId) {
    if (typeof global.editLogFromCI !== 'function') return;
    await global.editLogFromCI(batchId, ciId);
    if (global.__logiCtx && global.__logiCtx.source === 'ci-detail' && global.__logiCtx.ciId === ciId && isModalOpen()) {
      global.__logiCtx = { source: 'ci-list', ciId: ciId };
      var back = document.querySelector('#modal-content .ci-logi-back');
      if (back) back.remove();
    }
  }

  async function refreshAfterMutation(ciId) {
    invalidateCache(ciId);
    if (document.getElementById('ci-source-mode') && document.getElementById('ci-table') && typeof global.loadCI === 'function') {
      await global.loadCI();
      await togglePanel(ciId, true);
    }
  }

  function wrapSave(name) {
    var original = global[name];
    if (typeof original !== 'function' || original.__ciListWrapped) return;

    async function wrapped() {
      var ctx = global.__logiCtx && global.__logiCtx.source === 'ci-list'
        ? { source: 'ci-list', ciId: global.__logiCtx.ciId }
        : null;

      if (!ctx) return original.apply(this, arguments);

      var originalLoadLog = global.loadLog;
      if (typeof originalLoadLog === 'function') {
        global.loadLog = function () { return Promise.resolve(); };
      }

      var result;
      try {
        result = await original.apply(this, arguments);
      } finally {
        if (typeof originalLoadLog === 'function') global.loadLog = originalLoadLog;
      }

      if (!isModalOpen()) {
        global.__logiCtx = null;
        await refreshAfterMutation(ctx.ciId);
      }
      return result;
    }

    wrapped.__ciListWrapped = true;
    wrapped.__original = original;
    global[name] = wrapped;
  }

  function installRenderWrapper() {
    var original = global.renderOperationalCITable;
    if (typeof original !== 'function' || original.__ciListInlineWrapped) return;

    function wrapped(data) {
      state.openId = null;
      var html = original.apply(this, arguments);
      return decorateOperationalHtml(html, data);
    }
    wrapped.__ciListInlineWrapped = true;
    wrapped.__original = original;
    global.renderOperationalCITable = wrapped;
  }

  function runWacDetailAction(el, batchId, ciId, status, reason) {
    if (!el || el.disabled || el.getAttribute('data-wac-loading') === '1') return;
    var originalText = el.textContent;
    el.disabled = true;
    el.setAttribute('data-wac-loading', '1');
    el.setAttribute('aria-busy', 'true');
    el.textContent = wacUiText('loading');

    var task;
    try {
      task = global.viewLogWacDetail(batchId, ciId, status, reason);
    } catch (error) {
      task = Promise.reject(error);
    }
    Promise.resolve(task).catch(function (error) {
      if (typeof global.showToast === 'function') {
        global.showToast(error && error.message || 'WAC详情加载失败', 'danger');
      }
    }).finally(function () {
      if (!el.isConnected) return;
      el.disabled = false;
      el.removeAttribute('data-wac-loading');
      el.removeAttribute('aria-busy');
      el.textContent = originalText;
    });
  }

  document.addEventListener('click', function (event) {
    var el = event.target.closest('[data-ci-logi-toggle],[data-ci-logi-collapse],[data-ci-logi-create],[data-ci-logi-edit],[data-ci-logi-retry],[data-ci-logi-export-pl],[data-ci-logi-export-ci-pl],[data-ci-logi-wac-confirm],[data-ci-logi-wac-view],[data-ci-logi-wac-exclude],[data-ci-logi-wac-restore],[data-ci-logi-wac-cc]');
    if (!el) return;

    event.preventDefault();
    event.stopPropagation();

    if (el.hasAttribute('data-ci-logi-toggle')) return void togglePanel(el.getAttribute('data-ci-logi-toggle'));
    if (el.hasAttribute('data-ci-logi-collapse')) return void closePanel(el.getAttribute('data-ci-logi-collapse'));
    if (el.hasAttribute('data-ci-logi-retry')) return void togglePanel(el.getAttribute('data-ci-logi-retry'), true);
    if (el.hasAttribute('data-ci-logi-create')) return void openCreate(el.getAttribute('data-ci-logi-create'));
    if (el.hasAttribute('data-ci-logi-edit')) return void openEdit(el.getAttribute('data-ci-logi-edit'), el.getAttribute('data-ci-id'));
    if (el.hasAttribute('data-ci-logi-wac-confirm') && typeof global.viewLogWacDetail === 'function') {
      return void runWacDetailAction(el, el.getAttribute('data-ci-logi-wac-confirm'), el.getAttribute('data-ci-id'), 'pending');
    }
    if (el.hasAttribute('data-ci-logi-wac-view') && typeof global.viewLogWacDetail === 'function') {
      return void runWacDetailAction(el, el.getAttribute('data-ci-logi-wac-view'), el.getAttribute('data-ci-id'), 'not_ready');
    }
    if (el.hasAttribute('data-ci-logi-wac-exclude') && typeof global.openCIWacExclude === 'function') return void global.openCIWacExclude(el.getAttribute('data-ci-logi-wac-exclude'), el.getAttribute('data-ci-id'), el.getAttribute('data-batch-no'));
    if (el.hasAttribute('data-ci-logi-wac-restore') && typeof global.openCIWacRestore === 'function') return void global.openCIWacRestore(el.getAttribute('data-ci-logi-wac-restore'), el.getAttribute('data-ci-id'), el.getAttribute('data-batch-no'));
    if (el.hasAttribute('data-ci-logi-wac-cc') && typeof global.openWacCcFromCI === 'function') return void global.openWacCcFromCI(el.getAttribute('data-ci-logi-wac-cc'), el.getAttribute('data-ci-id'), el.getAttribute('data-batch-no'));
    if (el.hasAttribute('data-ci-logi-export-pl') && typeof global.exportBatchPL === 'function') return void global.exportBatchPL(el.getAttribute('data-ci-logi-export-pl'));
    if (el.hasAttribute('data-ci-logi-export-ci-pl') && typeof global.exportBatchCIAndPL === 'function') return void global.exportBatchCIAndPL(el.getAttribute('data-ci-logi-export-ci-pl'));
  });

  // Clicking any non-control area of a logistics batch row opens the combined logistics + WAC detail.
  document.addEventListener('click', function (event) {
    var row = event.target.closest('[data-ci-logi-row]');
    if (!row) return;
    if (event.target.closest('button,input,select,textarea,a,label,[data-ci-logi-inline-ignore]')) return;
    if (typeof global.viewLogWacDetail !== 'function') return;
    event.preventDefault();
    event.stopPropagation();
    global.viewLogWacDetail(
      row.getAttribute('data-ci-logi-row'),
      row.getAttribute('data-ci-id'),
      row.getAttribute('data-wac-status'),
      row.getAttribute('data-wac-exclusion-reason')
    );
  });

  injectStyle();
  installRenderWrapper();
  wrapSave('saveLogWithPL');
  wrapSave('saveEditLog');

  global.toggleCIListLogistics = togglePanel;
  global.refreshCIListLogistics = function (ciId) {
    if (!ciId) return Promise.resolve();
    invalidateCache(ciId);
    return togglePanel(ciId, true);
  };
})(typeof window !== 'undefined' ? window : globalThis);
