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

  function isMarketplacePlatform(value) {
    var platformName = normalizeMarker(value);
    // Be deliberately allow-listed: an absent or unfamiliar platform must
    // never turn a blank order marker into an online sales record.
    return [
      'shopee', 'shopeemall',
      'tiktok', 'tiktokshop',
      'tokopedia'
    ].indexOf(platformName) >= 0;
  }

  function classifyOrderMarker(value, platform) {
    var marker = normalizeMarker(value);
    var platformName = normalizeMarker(platform);
    // Blank markers are online only when the source explicitly identifies a
    // supported marketplace. Manual, missing, and unknown platforms are out.
    if (!marker) return isMarketplacePlatform(platformName) ? '线上渠道' : '';
    // These are the only two allowed offline order markers.
    if (marker === 'resellerorder-payinadvance') return '线下渠道';
    if (marker === 'resellerorder-credit') return '线下渠道';
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
    // Match the country master labels used by PSI sales_records.
    if (raw.indexOf('indonesia') >= 0 || raw.indexOf('印尼') >= 0 || raw.indexOf('印度尼西亚') >= 0) return '印度尼西亚';
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
        platform: findColumn(headers, ['平台', '销售平台', '平台名称', '平台类型', '店铺平台', '渠道', 'platform', 'sales platform', 'marketplace']),
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

  function orderTimestampValue(value) {
    if (value instanceof Date) return isNaN(value.getTime()) ? null : value.getTime();
    var raw = text(value);
    if (!raw) return null;
    var match = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
    if (match) {
      return Date.UTC(
        Number(match[1]), Number(match[2]) - 1, Number(match[3]),
        Number(match[4] || 0), Number(match[5] || 0), Number(match[6] || 0)
      );
    }
    if (/^\d+(?:\.\d+)?$/.test(raw)) {
      var serial = Number(raw);
      if (serial >= 20000 && serial <= 80000) return Math.floor((serial - 25569) * 86400000);
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
    var parsedRows = [];
    var exactSeen = Object.create(null);
    var stats = {
      sourceRows: rawRows,
      includedRows: 0,
      excludedMarkerRows: 0,
      excludedUnpaidRows: 0,
      exactDuplicateRows: 0,
      snapshotDuplicateRows: 0,
      conflictGroups: 0,
      excludedConflictRows: 0,
      trueRows: 0,
      falseRows: 0,
      excludedMarkers: Object.create(null),
      unresolvedCountryRows: 0,
      validationErrorRows: 0,
      conflictDetails: []
    };

    for (var i = 1; i < rows.length; i++) {
      var row = rows[i] || [];
      if (!row.some(function (cell) { return text(cell) !== ''; })) continue;

      var rawMarker = text(row[c.marker]);
      var platform = c.platform >= 0 ? text(row[c.platform]) : '';
      var channel = classifyOrderMarker(rawMarker, platform);
      if (!channel) {
        stats.excludedMarkerRows++;
        var markerLabel = rawMarker || (normalizeMarker(platform) === 'manual'
          ? '（Manual + 空白订单标记）' : '（空白）');
        stats.excludedMarkers[markerLabel] = (stats.excludedMarkers[markerLabel] || 0) + 1;
        continue;
      }

      var status = text(row[c.status]);
      if (isUnpaidStatus(status)) {
        stats.excludedUnpaidRows++;
        continue;
      }

      // Only exact source-row duplicates are removed automatically. Rows that
      // share an order item key but disagree on quantity/package are quarantined.
      var rawSignature = JSON.stringify(row.map(text));
      if (exactSeen[rawSignature]) {
        stats.exactDuplicateRows++;
        continue;
      }
      exactSeen[rawSignature] = true;

      var orderDateRaw = row[c.orderDate];
      var orderDate = normalizeOrderDate(orderDateRaw);
      var orderNo = text(row[c.orderNo]);
      var skuCode = text(row[c.sku]);
      var quantity = parseQuantity(row[c.quantity]);
      var store = c.store >= 0 ? text(row[c.store]) : '';
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
      if (!orderDate) errors.push('下单时间格式无法识别：' + text(orderDateRaw));
      if (!skuCode) errors.push('商品SKU不能为空');
      if (!quantity.valid) errors.push('数量必须为正整数');
      if (!country) {
        stats.unresolvedCountryRows++;
        errors.push('无法从 BigSeller 店铺名称识别国家');
      }

      parsedRows.push({
        _rowNum: i + 1,
        _errors: errors,
        _sourceTimestamp: orderTimestampValue(orderDateRaw),
        _packageNo: packageNo,
        _rawOrderDate: text(orderDateRaw),
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
    }

    // PSI's business identity includes SKU and channel. Therefore multiple
    // SKUs under one order remain separate sales lines.
    var grouped = Object.create(null);
    var groupOrder = [];
    parsedRows.forEach(function (record) {
      if (!record.order_no || !record.sku_code) {
        groupOrder.push({ key: null, records: [record] });
        return;
      }
      var key = JSON.stringify([record.order_no, record.sku_code, record.shop_platform]);
      if (!grouped[key]) {
        grouped[key] = [];
        groupOrder.push({ key: key, records: grouped[key] });
      }
      grouped[key].push(record);
    });

    var records = [];
    groupOrder.forEach(function (entry) {
      var group = entry.records;
      if (group.length === 1) {
        records.push(group[0]);
        return;
      }

      var quantities = Object.create(null);
      var packages = Object.create(null);
      group.forEach(function (record) {
        quantities[String(record.quantity)] = true;
        packages[String(record._packageNo)] = true;
      });
      var quantityConflict = Object.keys(quantities).length > 1;
      var packageConflict = Object.keys(packages).length > 1;
      if (quantityConflict || packageConflict) {
        var reason = quantityConflict && packageConflict ? '数量和包裹号不同'
          : (quantityConflict ? '数量不同' : '包裹号不同');
        stats.conflictGroups++;
        stats.excludedConflictRows += group.length;
        stats.conflictDetails.push({
          order_no: group[0].order_no,
          sku_code: group[0].sku_code,
          channel: group[0].shop_platform,
          reason: reason,
          records: group.map(function (record) {
            return {
              source_row: record._rowNum,
              order_date: record._rawOrderDate,
              quantity: record.quantity,
              package_no: record._packageNo,
              status: record.original_order_status
            };
          })
        });
        return;
      }

      // Same order item, same quantity and package: keep one sales line.
      // Preserve the earliest source date, but use the latest unambiguous
      // status snapshot so an in-file status change is not lost.
      var timedRows = group.filter(function (record) { return record._sourceTimestamp != null; });
      var latestTimestamp = null;
      var latestRows = group;
      if (timedRows.length) {
        latestTimestamp = timedRows.reduce(function (latest, record) {
          return latest == null || record._sourceTimestamp > latest ? record._sourceTimestamp : latest;
        }, null);
        latestRows = timedRows.filter(function (record) { return record._sourceTimestamp === latestTimestamp; });
      }
      var latestStatuses = Object.create(null);
      latestRows.forEach(function (record) { latestStatuses[record.original_order_status] = true; });
      if (Object.keys(latestStatuses).length > 1) {
        stats.conflictGroups++;
        stats.excludedConflictRows += group.length;
        stats.conflictDetails.push({
          order_no: group[0].order_no,
          sku_code: group[0].sku_code,
          channel: group[0].shop_platform,
          reason: '相同时间存在不同订单状态',
          records: group.map(function (record) {
            return {
              source_row: record._rowNum,
              order_date: record._rawOrderDate,
              quantity: record.quantity,
              package_no: record._packageNo,
              status: record.original_order_status
            };
          })
        });
        return;
      }

      var kept = group[0];
      var latest = latestRows[latestRows.length - 1];
      kept.original_order_status = latest.original_order_status;
      kept.is_valid_order = latest.is_valid_order;
      stats.snapshotDuplicateRows += group.length - 1;
      records.push(kept);
    });

    records.forEach(function (record) {
      delete record._sourceTimestamp;
      delete record._packageNo;
      delete record._rawOrderDate;
      if (Array.isArray(record._errors) && record._errors.length) stats.validationErrorRows++;
      else stats.includedRows++;
      if (record.is_valid_order) stats.trueRows++;
      else stats.falseRows++;
    });

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

  function downloadConflictReport(win, stats) {
    if (!win || !win.XLSX || !stats || !Array.isArray(stats.conflictDetails) || !stats.conflictDetails.length) return;
    var rows = [[
      '订单号', 'SKU', '渠道', '冲突原因', '原始行号', '下单时间', '数量', '包裹号', '订单状态'
    ]];
    stats.conflictDetails.forEach(function (group) {
      (group.records || []).forEach(function (record) {
        rows.push([
          group.order_no, group.sku_code, group.channel, group.reason,
          record.source_row, record.order_date, record.quantity,
          record.package_no, record.status
        ]);
      });
    });
    var sheet = win.XLSX.utils.aoa_to_sheet(rows);
    var book = win.XLSX.utils.book_new();
    win.XLSX.utils.book_append_sheet(book, sheet, '冲突订单明细');
    win.XLSX.writeFile(book, 'BigSeller销售导入异常明细.xlsx');
  }

  function renderSummary(win, stats, country) {
    var el = win.document && win.document.getElementById('sales-preview-stats');
    if (!el) return;
    var countryLabel = country || '国家未识别';
    var conflictGroups = Number(stats.conflictGroups || 0);
    var html = '<div style="margin-bottom:10px;padding:12px 14px;border:1px solid #d6e4ff;background:#f5f8ff;border-radius:10px;font-size:12px;color:#333">' +
      '<div style="font-weight:650;font-size:13px;margin-bottom:6px">已识别 BigSeller 销售数据</div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:8px 16px;color:#555;margin-bottom:6px">' +
      '<span>国家：' + escapeHtml(countryLabel) + '</span>' +
      '<span>原始记录：' + Number(stats.sourceRows || 0).toLocaleString('en-US') + '</span>' +
      '<span>待导入：' + Number(stats.includedRows || 0).toLocaleString('en-US') + '</span>' +
      '<span>True：' + Number(stats.trueRows || 0).toLocaleString('en-US') + '</span>' +
      '<span>False：' + Number(stats.falseRows || 0).toLocaleString('en-US') + '</span>' +
      '</div>' +
      '<div style="color:#666">订单标记排除：' + Number(stats.excludedMarkerRows || 0).toLocaleString('en-US') +
      ' 条；未付款排除：' + Number(stats.excludedUnpaidRows || 0).toLocaleString('en-US') +
      ' 条；完全重复去重：' + Number(stats.exactDuplicateRows || 0).toLocaleString('en-US') +
      ' 条；同订单商品快照合并：' + Number(stats.snapshotDuplicateRows || 0).toLocaleString('en-US') +
      ' 条；校验失败：' + Number(stats.validationErrorRows || 0).toLocaleString('en-US') + ' 条。</div>' +
      (conflictGroups ? '<div style="color:#b45309;margin-top:5px">冲突订单：' + conflictGroups +
        ' 组，共 ' + Number(stats.excludedConflictRows || 0) + ' 条已暂不导入。请下载异常明细人工核对。</div>' +
        '<button type="button" id="bigseller-sales-conflict-download" style="margin-top:7px;padding:5px 10px;border:1px solid #d1d5db;border-radius:7px;background:#fff;color:#333;cursor:pointer">下载冲突明细</button>' : '') +
      '<div style="color:#888;margin-top:4px">仅导入：非 Manual 平台的空白订单标记，以及 Pay in Advance、Credit；其他标记和 Manual 空白订单均排除。</div>' +
      '</div>';
    // Replace the previous summary instead of stacking another copy after each preview.
    el.innerHTML = '';
    el.insertAdjacentHTML('beforeend', html);
    var button = win.document.getElementById('bigseller-sales-conflict-download');
    if (button) button.addEventListener('click', function () { downloadConflictReport(win, stats); });
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
      win._salesImportData = [];
      win._salesImportPreviewReady = false;
      win._lastSalesImportErrors = [];
      var stats = win.document && win.document.getElementById('sales-preview-stats');
      if (stats) stats.innerHTML = '';
      var button = win.document && win.document.getElementById('sales-import-btn');
      if (button) button.disabled = true;
      if (typeof win.renderSalesPreview === 'function') win.renderSalesPreview([]);
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
      // Clear the previous file immediately, before the asynchronous FileReader starts.
      // Otherwise the old preview can remain importable while the new file is loading.
      resetState();
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
