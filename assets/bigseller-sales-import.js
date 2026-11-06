/*
 * BigSeller sales import adapter.
 * Reads the native Order-Goods export and converts only the explicitly allowed
 * order markers into the existing PSI sales-import contract.
 *
 * Allowed order markers:
 *   - blank                         -> 线上
 *   - Reseller Order-Pay in Advance -> 线下
 *   - Reseller Order- Credit        -> 线下
 * Every other non-blank marker is excluded from import.
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) {
    root.BigSellerSalesImport = api;
    if (root.document) api.install(root);
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  function text(value) {
    return String(value == null ? '' : value).replace(/\u00a0/g, ' ').trim();
  }

  function normalizeHeader(value) {
    return text(value).replace(/[\uFEFF\s\u3000]+/g, '').toLowerCase();
  }

  function findColumn(headers, aliases) {
    var normalized = (headers || []).map(normalizeHeader);
    for (var i = 0; i < aliases.length; i++) {
      var idx = normalized.indexOf(normalizeHeader(aliases[i]));
      if (idx >= 0) return idx;
    }
    return -1;
  }

  function validDate(year, month, day) {
    var y = Number(year), m = Number(month), d = Number(day);
    if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return '';
    var date = new Date(y, m - 1, d);
    if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return '';
    return String(y).padStart(4, '0') + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  }

  function normalizeOrderDate(value) {
    if (value instanceof Date) {
      if (isNaN(value.getTime())) return '';
      return value.getFullYear() + '-' + String(value.getMonth() + 1).padStart(2, '0') + '-' + String(value.getDate()).padStart(2, '0');
    }
    var raw = text(value);
    if (!raw) return '';
    // BigSeller exports a timestamp such as "2026-11-06 18:18"; PSI stores the date.
    var match = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (match) return validDate(match[1], match[2], match[3]);
    // Also accept Excel serial dates (including a fractional time component).
    if (/^\d+(?:\.\d+)?$/.test(raw)) {
      var serial = Number(raw);
      if (serial >= 20000 && serial <= 80000) {
        var date = new Date(Math.floor((serial - 25569) * 86400000));
        if (!isNaN(date.getTime())) {
          return date.getUTCFullYear() + '-' + String(date.getUTCMonth() + 1).padStart(2, '0') + '-' + String(date.getUTCDate()).padStart(2, '0');
        }
      }
    }
    return '';
  }

  function parseQuantity(value) {
    var raw = text(value).replace(/,/g, '');
    if (!raw) return { value: '', valid: false };
    var number = Number(raw);
    return { value: Number.isFinite(number) ? number : value, valid: Number.isFinite(number) && Number.isInteger(number) && number > 0 };
  }

  function normalizeMarker(value) {
    return text(value).replace(/[\s\u3000]+/g, '').toLowerCase();
  }

  function classifyOrderMarker(value) {
    var marker = normalizeMarker(value);
    if (!marker) return '线上';
    if (marker === 'resellerorder-payinadvance') return '线下';
    if (marker === 'resellerorder-credit') return '线下';
    return '';
  }

  function isUnpaidStatus(value) {
    return text(value) === '未付款';
  }

  function isFalseStatus(value) {
    return ['取消申请', '已取消', '退货退款'].indexOf(text(value)) >= 0;
  }

  function countryFromText(value) {
    var raw = text(value).toLowerCase();
    if (!raw) return '';
    if (raw.indexOf('indonesia') >= 0 || raw.indexOf('印尼') >= 0 || raw.indexOf('印度尼西亚') >= 0) return '印尼';
    if (raw.indexOf('malaysia') >= 0 || raw.indexOf('马来西亚') >= 0) return '马来西亚';
    if (raw.indexOf('thailand') >= 0 || raw.indexOf('泰国') >= 0) return '泰国';
    return '';
  }

  function inferFileCountry(rows, storeIdx) {
    var found = Object.create(null);
    if (storeIdx < 0) return '';
    (rows || []).forEach(function (row) {
      var country = countryFromText(row && row[storeIdx]);
      if (country) found[country] = true;
    });
    var countries = Object.keys(found);
    return countries.length === 1 ? countries[0] : '';
  }

  function countDataRows(rows) {
    return (rows || []).slice(1).filter(function (row) {
      return row && row.some(function (cell) { return text(cell) !== ''; });
    }).length;
  }

  function findBigSellerSheet(workbook, XLSX) {
    if (!workbook || !Array.isArray(workbook.SheetNames) || !XLSX || !XLSX.utils) return null;
    for (var s = 0; s < workbook.SheetNames.length; s++) {
      var name = workbook.SheetNames[s];
      var sheet = workbook.Sheets && workbook.Sheets[name];
      if (!sheet) continue;
      var rows = XLSX.utils.sheet_to_json(sheet, {
        header: 1, defval: '', raw: false, dateNF: 'yyyy-mm-dd hh:mm'
      });
      if (!rows || rows.length < 2) continue;
      var headers = rows[0] || [];
      var columns = {
        orderDate: findColumn(headers, ['下单时间', '订单时间', 'order time', 'order date']),
        orderNo: findColumn(headers, ['订单号', 'order no', 'order number']),
        marker: findColumn(headers, ['订单标记', 'order tag', 'order marker']),
        status: findColumn(headers, ['订单状态', 'order status', 'status']),
        sku: findColumn(headers, ['商品SKU', '商品 SKU', 'sku', 'sku code']),
        quantity: findColumn(headers, ['数量', '商品数量', 'quantity', 'qty']),
        packageNo: findColumn(headers, ['包裹号', '包裹编号', 'package no', 'package number']),
        platform: findColumn(headers, ['平台', 'platform']),
        store: findColumn(headers, ['平台店铺', '店铺', 'platform shop', 'shop name']),
        warehouse: findColumn(headers, ['发货仓库', '仓库', 'warehouse'])
      };
      if (columns.orderDate >= 0 && columns.orderNo >= 0 && columns.marker >= 0 &&
          columns.status >= 0 && columns.sku >= 0 && columns.quantity >= 0) {
        return { name: name, rows: rows, columns: columns };
      }
    }
    return null;
  }

  function parseBigSellerWorkbook(workbook, filename, XLSX) {
    var sheet = findBigSellerSheet(workbook, XLSX);
    if (!sheet) return null;

    var rows = sheet.rows;
    var c = sheet.columns;
    var rawRows = countDataRows(rows);
    var fileCountry = inferFileCountry(rows, c.store);
    var records = [];
    var stats = {
      sourceRows: rawRows,
      includedRows: 0,
      excludedMarkerRows: 0,
      excludedUnpaidRows: 0,
      trueRows: 0,
      falseRows: 0,
      excludedMarkers: Object.create(null),
      unresolvedCountryRows: 0
    };

    for (var i = 1; i < rows.length; i++) {
      var row = rows[i] || [];
      if (!row.some(function (cell) { return text(cell) !== ''; })) continue;

      var rawMarker = text(row[c.marker]);
      var channel = classifyOrderMarker(rawMarker);
      if (!channel) {
        stats.excludedMarkerRows++;
        var markerLabel = rawMarker || '（空白）';
        stats.excludedMarkers[markerLabel] = (stats.excludedMarkers[markerLabel] || 0) + 1;
        continue;
      }

      var status = text(row[c.status]);
      if (isUnpaidStatus(status)) {
        stats.excludedUnpaidRows++;
        continue;
      }

      var orderDate = normalizeOrderDate(row[c.orderDate]);
      var orderNo = text(row[c.orderNo]);
      var skuCode = text(row[c.sku]);
      var quantity = parseQuantity(row[c.quantity]);
      var store = c.store >= 0 ? text(row[c.store]) : '';
      var platform = c.platform >= 0 ? text(row[c.platform]) : '';
      var packageNo = c.packageNo >= 0 ? text(row[c.packageNo]) : '';
      var warehouse = c.warehouse >= 0 ? text(row[c.warehouse]) : '';
      var country = countryFromText(store) || fileCountry;
      var validOrder = isFalseStatus(status) ? 0 : 1;

      var remarkParts = [];
      if (platform) remarkParts.push('平台=' + platform);
      if (store) remarkParts.push('店铺=' + store);
      if (warehouse) remarkParts.push('发货仓库=' + warehouse);
      if (packageNo) remarkParts.push('包裹号=' + packageNo);
      if (rawMarker) remarkParts.push('订单标记=' + rawMarker);

      var errors = [];
      if (!orderNo) errors.push('订单号不能为空');
      if (!orderDate) errors.push('下单时间格式无法识别：' + text(row[c.orderDate]));
      if (!skuCode) errors.push('商品SKU不能为空');
      if (!quantity.valid) errors.push('数量必须为正整数');
      if (!country) {
        stats.unresolvedCountryRows++;
        errors.push('无法从 BigSeller 店铺名称识别国家');
      }

      records.push({
        _rowNum: i + 1,
        _errors: errors,
        source_system: 'BigSeller',
        order_no: orderNo,
        order_detail_id: '',
        order_date: orderDate,
        country: country,
        shop_platform: channel,
        brand: '',
        sku_code: skuCode,
        quantity: quantity.value,
        is_valid_order: validOrder,
        original_order_status: status,
        remark: remarkParts.join('；')
      });

      stats.includedRows++;
      if (validOrder) stats.trueRows++;
      else stats.falseRows++;
    }

    return {
      filename: text(filename),
      sheetName: sheet.name,
      country: fileCountry,
      records: records,
      stats: stats
    };
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
    });
  }

  function renderSummary(win, stats, country) {
    var el = win.document && win.document.getElementById('sales-preview-stats');
    if (!el) return;
    var countryLabel = country || '国家未识别';
    var html = '<div style="margin-bottom:10px;padding:12px 14px;border:1px solid #d6e4ff;background:#f5f8ff;border-radius:10px;font-size:12px;color:#333">' +
      '<div style="font-weight:650;font-size:13px;margin-bottom:6px">已识别 BigSeller 销售数据</div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:8px 16px;color:#555;margin-bottom:6px">' +
      '<span>国家：' + escapeHtml(countryLabel) + '</span>' +
      '<span>原始记录：' + Number(stats.sourceRows || 0).toLocaleString('en-US') + '</span>' +
      '<span>待导入：' + Number(stats.includedRows || 0).toLocaleString('en-US') + '</span>' +
      '<span>True：' + Number(stats.trueRows || 0).toLocaleString('en-US') + '</span>' +
      '<span>False：' + Number(stats.falseRows || 0).toLocaleString('en-US') + '</span>' +
      '</div>' +
      '<div style="color:#666">其他订单标记排除：' + Number(stats.excludedMarkerRows || 0).toLocaleString('en-US') +
      ' 条；未付款排除：' + Number(stats.excludedUnpaidRows || 0).toLocaleString('en-US') + ' 条。</div>' +
      '<div style="color:#888;margin-top:4px">仅导入订单标记为空白、Pay in Advance、Credit 的订单；其他标记不会进入系统。</div>' +
      '</div>';
    el.insertAdjacentHTML('afterbegin', html);
  }

  function install(win) {
    if (!win || win.__bigSellerSalesImportInstalled) return;
    if (typeof win.handleSalesFile !== 'function' ||
        typeof win.openSalesBatchImport !== 'function' ||
        typeof win.requestSalesPreview !== 'function') return;

    win.__bigSellerSalesImportInstalled = true;
    var originalHandleSalesFile = win.handleSalesFile;
    var originalOpenSalesBatchImport = win.openSalesBatchImport;
    var originalRequestSalesPreview = win.requestSalesPreview;

    function resetState() {
      win._salesImportSourceMode = 'template';
      win._salesImportSkippedStats = null;
      win._salesImportCountry = '';
    }

    win.openSalesBatchImport = function () {
      resetState();
      return originalOpenSalesBatchImport.apply(this, arguments);
    };

    win.requestSalesPreview = async function () {
      var result = await originalRequestSalesPreview.apply(this, arguments);
      if (win._salesImportSourceMode === 'bigseller' && win._salesImportSkippedStats) {
        renderSummary(win, win._salesImportSkippedStats, win._salesImportCountry);
      }
      return result;
    };

    win.handleSalesFile = function (file) {
      if (!file) return;
      var ext = String(file.name || '').split('.').pop().toLowerCase();
      if (!['xlsx', 'xls', 'csv'].includes(ext) || !win.FileReader || !win.XLSX) {
        resetState();
        return originalHandleSalesFile.apply(this, arguments);
      }

      var reader = new win.FileReader();
      reader.onload = function (event) {
        try {
          var workbook = win.XLSX.read(new Uint8Array(event.target.result), {
            type: 'array', cellDates: true
          });
          var parsed = parseBigSellerWorkbook(workbook, file.name, win.XLSX);
          if (!parsed) {
            resetState();
            originalHandleSalesFile.call(win, file);
            return;
          }

          win._salesImportSourceMode = 'bigseller';
          win._salesImportSkippedStats = parsed.stats;
          win._salesImportCountry = parsed.country || '';
          win._salesImportData = parsed.records;
          win.renderSalesPreview(parsed.records);
          var button = win.document.getElementById('sales-import-btn');
          if (button) button.disabled = true;
          if (parsed.stats.unresolvedCountryRows > 0 && typeof win.showToast === 'function') {
            win.showToast('部分 BigSeller 订单无法识别国家，已阻止这些行导入，请检查店铺名称。', 'warning');
          }
          if (parsed.records.length === 0 && typeof win.showToast === 'function') {
            win.showToast('没有符合指定订单标记和订单状态规则的销售记录。', 'warning');
          }
        } catch (error) {
          if (typeof win.showToast === 'function') {
            win.showToast('BigSeller 销售文件解析失败：' + (error && error.message ? error.message : ''), 'danger');
          }
        }
      };
      reader.onerror = function () {
        if (typeof win.showToast === 'function') win.showToast('BigSeller 销售文件读取失败，请重新上传。', 'danger');
      };
      reader.readAsArrayBuffer(file);
    };
  }

  return {
    normalizeHeader: normalizeHeader,
    normalizeOrderDate: normalizeOrderDate,
    classifyOrderMarker: classifyOrderMarker,
    isUnpaidStatus: isUnpaidStatus,
    isFalseStatus: isFalseStatus,
    countryFromText: countryFromText,
    parseBigSellerWorkbook: parseBigSellerWorkbook,
    install: install
  };
});
