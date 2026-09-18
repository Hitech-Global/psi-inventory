(function (global) {
  'use strict';

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
      '.content-inner:has(#ci-source-mode) #ci-table .ci-list-logi-table tbody tr:hover td{background:#fafafa!important}',
      '.content-inner:has(#ci-source-mode) #ci-table .ci-list-logi-owners{max-width:220px;overflow:hidden;text-overflow:ellipsis}',
      '.content-inner:has(#ci-source-mode) #ci-table .ci-list-logi-table .cell-actions{position:relative}',
      '.content-inner:has(#ci-source-mode) #ci-table .ci-list-logi-actions{padding-top:10px}',
      '.content-inner:has(#ci-source-mode) #ci-table .ci-list-logi-create{min-height:32px;padding:5px 11px;border-radius:8px;background:#1d1d1f;border-color:#1d1d1f;color:#fff;font-size:12px;font-weight:650;box-shadow:none}',
      '.content-inner:has(#ci-source-mode) #ci-table .ci-list-logi-create:hover{background:#000;border-color:#000}',
      '.content-inner:has(#ci-source-mode) #ci-table .ci-list-logi-export{position:absolute;z-index:8;margin-top:5px;padding:6px;background:#fff;border:1px solid #e5e5ea;border-radius:9px;box-shadow:0 8px 24px rgba(0,0,0,.12);white-space:nowrap}',
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
    var rowsHtml = '';

    if (list.length) {
      rowsHtml = list.map(function (b) {
        var cbmFromPl = (b.pls || []).reduce(function (s, p) { return s + (Number(p.total_cbm) || 0); }, 0);
        var cbm = cbmFromPl > 0 ? cbmFromPl : (Number(b.total_cbm) || 0);
        var ratio = b.freight_value_ratio == null ? '—' : (Number(b.freight_value_ratio).toFixed(2) + '%');
        var cargoCur = b.ci_currency || b.freight_currency || '';
        return '<tr>' +
          '<td class="cell-id">' + esc(b.batch_no || '') + '</td>' +
          '<td>' + esc(b.forwarder_name || '—') + '</td>' +
          '<td>' + esc(b.transport_mode || '—') + '</td>' +
          '<td class="cell-date">' + esc(fmtDate(b.eta_date) || '—') + '</td>' +
          '<td class="cell-date">' + esc(fmtDate(b.actual_arrival_date) || '—') + '</td>' +
          '<td>' + (b.actual_transit_days != null ? esc(b.actual_transit_days) : '—') + '</td>' +
          '<td>' + (b.total_cartons != null ? esc(b.total_cartons) : '0') + '</td>' +
          '<td>' + cbm.toFixed(2) + '</td>' +
          '<td>' + esc(fmtMoney(b.cargo_value || 0, cargoCur)) + '</td>' +
          '<td>' + esc(fmtMoney(b.total_freight || 0, b.freight_currency)) + '</td>' +
          '<td>' + esc(ratio) + '</td>' +
          '<td>' + esc(b.logistics_display_status || b.logistics_status || '—') + '</td>' +
          '<td>' + esc(b.listing_status || 'pending_plan') + '</td>' +
          '<td class="ci-list-logi-owners">' + (b.listing_owner_names && b.listing_owner_names.length ? esc(b.listing_owner_names.join('、')) : '—') + '</td>' +
          '<td class="cell-actions">' +
            '<button class="action-btn" data-ci-logi-edit="' + esc(b.id) + '" data-ci-id="' + esc(ciId) + '" title="' + esc(tr('common.edit', '编辑')) + '">✏️</button> ' +
            '<button class="action-btn" data-ci-logi-export="' + esc(b.id) + '" title="' + esc(tr('common.export', '导出')) + '">⬇️</button>' +
            '<div id="ci-list-logi-export-' + esc(b.id) + '" class="ci-list-logi-export" style="display:none"></div>' +
          '</td>' +
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
          '<th>' + esc(tr('logistics.col.cargo_value', '总货值')) + '</th>' +
          '<th>' + esc(tr('logistics.col.freight', '综合运费')) + '</th>' +
          '<th>' + esc(tr('logistics.col.freight_ratio', '运费/货值')) + '</th>' +
          '<th>' + esc(tr('logistics.col.status', '状态')) + '</th>' +
          '<th>' + esc(tr('logistics.col.listing_status', 'Listing状态')) + '</th>' +
          '<th>' + esc(tr('logistics.col.owners', '负责人')) + '</th>' +
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

    var cached = cacheEntry(ciId);
    if (cached) {
      body.innerHTML = renderPanel(cached.data || [], ciId);
      return;
    }

    var token = ++state.reqSeq;
    body.innerHTML = loadingHtml();

    try {
      var data = await global.api('/api/commercial-invoices/' + ciId + '/logistics-batches');
      setCache(ciId, data);
      if (token !== state.reqSeq || state.openId !== ciId) return;
      var liveBody = document.getElementById('ci-list-logi-body-' + ciId);
      if (liveBody) liveBody.innerHTML = renderPanel(data || [], ciId);
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

  function toggleExport(batchId) {
    var el = document.getElementById('ci-list-logi-export-' + batchId);
    if (!el) return;
    if (el.style.display !== 'none') {
      el.style.display = 'none';
      el.innerHTML = '';
      return;
    }
    el.style.display = 'block';
    el.innerHTML =
      '<button class="btn btn-secondary btn-sm" data-ci-logi-export-pl="' + esc(batchId) + '">' + esc(tr('export.pl_only', '导出PL')) + '</button> ' +
      '<button class="btn btn-secondary btn-sm" data-ci-logi-export-ci-pl="' + esc(batchId) + '">' + esc(tr('export.ci_and_pl', '导出CI&PL')) + '</button>';
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
    if (global.currentPage === 'ci' && typeof global.loadCI === 'function') {
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

  document.addEventListener('click', function (event) {
    var el = event.target.closest('[data-ci-logi-toggle],[data-ci-logi-collapse],[data-ci-logi-create],[data-ci-logi-edit],[data-ci-logi-export],[data-ci-logi-retry],[data-ci-logi-export-pl],[data-ci-logi-export-ci-pl]');
    if (!el) return;

    event.preventDefault();
    event.stopPropagation();

    if (el.hasAttribute('data-ci-logi-toggle')) return void togglePanel(el.getAttribute('data-ci-logi-toggle'));
    if (el.hasAttribute('data-ci-logi-collapse')) return void closePanel(el.getAttribute('data-ci-logi-collapse'));
    if (el.hasAttribute('data-ci-logi-retry')) return void togglePanel(el.getAttribute('data-ci-logi-retry'), true);
    if (el.hasAttribute('data-ci-logi-create')) return void openCreate(el.getAttribute('data-ci-logi-create'));
    if (el.hasAttribute('data-ci-logi-edit')) return void openEdit(el.getAttribute('data-ci-logi-edit'), el.getAttribute('data-ci-id'));
    if (el.hasAttribute('data-ci-logi-export')) return void toggleExport(el.getAttribute('data-ci-logi-export'));
    if (el.hasAttribute('data-ci-logi-export-pl') && typeof global.exportBatchPL === 'function') return void global.exportBatchPL(el.getAttribute('data-ci-logi-export-pl'));
    if (el.hasAttribute('data-ci-logi-export-ci-pl') && typeof global.exportBatchCIAndPL === 'function') return void global.exportBatchCIAndPL(el.getAttribute('data-ci-logi-export-ci-pl'));
  });

  injectStyle();
  installRenderWrapper();
  wrapSave('saveLogWithPL');
  wrapSave('saveEditLog');

  global.toggleCIListLogistics = togglePanel;
})(typeof window !== 'undefined' ? window : globalThis);
