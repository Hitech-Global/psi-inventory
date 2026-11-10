/*
 * Zhisu sales import adapter.
 * Reads the native 至速仓 order export and converts it to the existing PSI
 * sales-import contract. It does not change the BigSeller or template paths.
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) {
    root.ZhisuSalesImport = api;
    if (root.document) api.install(root);
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  var SOURCE_SYSTEM = '至速仓';
  // Zhisu fulfillment is used only by Malaysia and Thailand.
  // Singapore (and every other warehouse) must never be inferred as Zhisu.
  var SOURCE_COUNTRIES = Object.freeze({
    '吉隆坡一号仓': '马来西亚',
    '泰国一号仓': '泰国'
  });

  function text(value) {
    return String(value == null ? '' : value).replace(/\u00a0/g, ' ').trim();
  }

  function normalizeHeader(value) {
    return text(value).replace(/[\uFEFF\s\u3000]+/g, '').toLowerCase();
  }

  function findColumn(headers, aliases) {
    var normalized = (headers || []).map(normalizeHeader);
    for (var i = 0; i < aliases.length; i++) {
      var index = normalized.indexOf(normalizeHeader(aliases[i]));
      if (index >= 0) return index;
    }
    return -1;
  }

  function normalizeOrderDate(value) {
    if (value instanceof Date) {
      if (isNaN(value.getTime())) return '';
      return value.getFullYear() + '-' +
        String(value.getMonth() + 1).padStart(2, '0') + '-' +
        String(value.getDate()).padStart(2, '0');
    }
    var raw = text(value);
    if (!raw) return '';
    var match = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (match) {
      var year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
      var date = new Date(year, month - 1, day);
      if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return '';
      return String(year).padStart(4, '0') + '-' +
        String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
    }
    if (/^\d+(?:\.\d+)?$/.test(raw)) {
      var serial = Number(raw);
      if (serial >= 20000 && serial <= 80000) {
        var excelDate = new Date(Math.floor((serial - 25569) * 86400000));
        if (!isNaN(excelDate.getTime())) {
          return excelDate.getUTCFullYear() + '-' +
            String(excelDate.getUTCMonth() + 1).padStart(2, '0') + '-' +
            String(excelDate.getUTCDate()).padStart(2, '0');
        }
      }
    }
    return '';
  }

  function parseQuantity(value) {
    var raw = text(value).replace(/,/g, '');
    if (!raw) return { value: '', valid: false };
    var number = Number(raw);
    return {
      value: Number.isFinite(number) ? number : value,
      valid: Number.isFinite(number) && Number.isInteger(number) && number > 0
    };
  }

  function countryFromWarehouse(value) {
    var warehouse = text(value);
    return Object.prototype.hasOwnProperty.call(SOURCE_COUNTRIES, warehouse)
      ? SOURCE_COUNTRIES[warehouse] : '';
  }

  function isUnpaidStatus(value) {
    return text(value) === '未支付';
  }

  function isFalseStatus(value) {
    var status = text(value);
    return status === '已取消' || status.indexOf('买方要求退回') === 0;
  }

  function isBlankRow(row) {
    return !row || !row.some(function (cell) { return text(cell) !== ''; });
  }

  function countDataRows(rows, headerRowIndex) {
    return (rows || []).slice(headerRowIndex + 1).filter(function (row) {
      return !isBlankRow(row);
    }).length;
  }

  function findZhisuSheet(workbook, XLSX) {
    if (!workbook || !Array.isArray(workbook.SheetNames) || !XLSX || !XLSX.utils) return null;
    for (var s = 0; s < workbook.SheetNames.length; s++) {
      var sheetName = workbook.SheetNames[s];
      var sheet = workbook.Sheets && workbook.Sheets[sheetName];
      if (!sheet) continue;
      var rows = XLSX.utils.sheet_to_json(sheet, {
        header: 1, defval: '', raw: false, dateNF: 'yyyy-mm-dd hh:mm:ss'
      });
      if (!rows || rows.length < 2) continue;

      var detected = null;
      var scanLimit = Math.min(rows.length, 10);
      for (var h = 0; h < scanLimit; h++) {
        var headers = rows[h] || [];
        var columns = {
          systemOrderNo: findColumn(headers, ['系统单号', '系统订单号']),
          platformOrderNo: findColumn(headers, ['平台单号', '平台订单号']),
          warehouse: findColumn(headers, ['仓库名称', '仓库']),
          orderDate: findColumn(headers, ['下单时间', '订单时间']),
          status: findColumn(headers, ['线上状态']),
          paymentMethod: findColumn(headers, ['支付方式']),
          sku: findColumn(headers, ['SKU', '商品SKU']),
          quantity: findColumn(headers, ['发货数量', '数量']),
          platform: findColumn(headers, ['平台编码', '平台']),
          store: findColumn(headers, ['店铺名称', '店铺']),
          packageNo: findColumn(headers, ['包裹编号', '包裹号']),
          waybill: findColumn(headers, ['运单号'])
        };
        if (columns.systemOrderNo >= 0 && columns.platformOrderNo >= 0 &&
            columns.warehouse >= 0 && columns.orderDate >= 0 &&
            columns.status >= 0 && columns.paymentMethod >= 0 &&
            columns.sku >= 0 && columns.quantity >= 0) {
          detected = { headerRowIndex: h, columns: columns };
          break;
        }
      }
      if (detected) {
        return {
          name: sheetName,
          rows: rows,
          headerRowIndex: detected.headerRowIndex,
          columns: detected.columns
        };
      }
    }
    return null;
  }

  function parseZhisuWorkbook(workbook, filename, XLSX) {
    var sheet = findZhisuSheet(workbook, XLSX);
    if (!sheet) return null;

    var rows = sheet.rows;
    var c = sheet.columns;
    var parsedRows = [];
    var exactSeen = Object.create(null);
    var warehouseCounts = Object.create(null);
    var countryCounts = Object.create(null);
    var stats = {
      sourceRows: countDataRows(rows, sheet.headerRowIndex),
      excludedBlankPaymentRows: 0,
      excludedUnpaidRows: 0,
      exactDuplicateRows: 0,
      duplicateOrderItemRows: 0,
      conflictGroups: 0,
      conflictRows: 0,
      validationErrorRows: 0,
      unknownWarehouseRows: 0,
      includedRows: 0,
      trueRows: 0,
      falseRows: 0,
      conflictDetails: []
    };

    for (var i = sheet.headerRowIndex + 1; i < rows.length; i++) {
      var row = rows[i] || [];
      if (isBlankRow(row)) continue;

      var paymentMethod = text(row[c.paymentMethod]);
      if (!paymentMethod) {
        stats.excludedBlankPaymentRows++;
        continue;
      }

      var status = text(row[c.status]);
      if (isUnpaidStatus(status)) {
        stats.excludedUnpaidRows++;
        continue;
      }

      var systemOrderNo = text(row[c.systemOrderNo]);
      var platformOrderNo = text(row[c.platformOrderNo]);
      var orderNo = platformOrderNo || systemOrderNo;
      var warehouse = text(row[c.warehouse]);
      var country = countryFromWarehouse(warehouse);
      var orderDateRaw = row[c.orderDate];
      var orderDate = normalizeOrderDate(orderDateRaw);
      var skuCode = text(row[c.sku]);
      var quantity = parseQuantity(row[c.quantity]);
      var platform = c.platform >= 0 ? text(row[c.platform]) : '';
      var store = c.store >= 0 ? text(row[c.store]) : '';
      var packageNo = c.packageNo >= 0 ? text(row[c.packageNo]) : '';
      var waybill = c.waybill >= 0 ? text(row[c.waybill]) : '';
      var validOrder = isFalseStatus(status) ? 0 : 1;

      if (warehouse) warehouseCounts[warehouse] = (warehouseCounts[warehouse] || 0) + 1;
      if (country) countryCounts[country] = (countryCounts[country] || 0) + 1;

      var remarkParts = ['来源=至速仓'];
      if (systemOrderNo) remarkParts.push('系统单号=' + systemOrderNo);
      if (platform) remarkParts.push('平台=' + platform);
      if (store) remarkParts.push('店铺=' + store);
      if (warehouse) remarkParts.push('仓库=' + warehouse);
      remarkParts.push('支付方式=' + paymentMethod);
      if (packageNo) remarkParts.push('包裹编号=' + packageNo);
      if (waybill) remarkParts.push('运单号=' + waybill);

      var errors = [];
      if (!orderNo) errors.push('平台单号和系统单号均为空');
      if (!orderDate) errors.push('下单时间格式无法识别：' + text(orderDateRaw));
      if (!skuCode) errors.push('SKU 为空，无法匹配 PSI SKU 主数据');
      if (!quantity.valid) errors.push('发货数量必须为正整数');
      if (!country) {
        stats.unknownWarehouseRows++;
        errors.push('无法根据仓库名称识别国家：' + (warehouse || '（空）'));
      }

      var record = {
        _rowNum: i + 1,
        _errors: errors,
        _sourceWarehouse: warehouse,
        _compareSignature: JSON.stringify([
          systemOrderNo, country, orderDate, skuCode, quantity.value,
          status, platform, store, paymentMethod, packageNo, waybill
        ]),
        source_system: SOURCE_SYSTEM,
        order_no: orderNo,
        order_detail_id: '',
        order_date: orderDate,
        country: country,
        shop_platform: '线上渠道',
        brand: '',
        sku_code: skuCode,
        quantity: quantity.value,
        is_valid_order: validOrder,
        original_order_status: status,
        remark: remarkParts.join('；')
      };

      var rawSignature = JSON.stringify(row.map(text));
      if (exactSeen[rawSignature]) {
        stats.exactDuplicateRows++;
        continue;
      }
      exactSeen[rawSignature] = true;
      parsedRows.push(record);
    }

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
      var signatures = Object.create(null);
      group.forEach(function (record) { signatures[record._compareSignature] = true; });
      if (Object.keys(signatures).length > 1) {
        stats.conflictGroups++;
        stats.conflictRows += group.length;
        var detail = group.map(function (record) {
          return {
            source_row: record._rowNum,
            system_order_no: (record.remark.match(/系统单号=([^；]+)/) || [])[1] || '',
            order_no: record.order_no,
            sku_code: record.sku_code,
            quantity: record.quantity,
            status: record.original_order_status,
            warehouse: record._sourceWarehouse
          };
        });
        stats.conflictDetails.push({
          order_no: group[0].order_no,
          sku_code: group[0].sku_code,
          records: detail
        });
        group.forEach(function (record) {
          record._errors.push('同一平台单号 + SKU 存在重复但内容不一致的记录，请核对源文件');
          records.push(record);
        });
        return;
      }
      stats.duplicateOrderItemRows += group.length - 1;
      records.push(group[0]);
    });

    records.forEach(function (record) {
      delete record._compareSignature;
      if (record._errors.length) {
        stats.validationErrorRows++;
      } else {
        stats.includedRows++;
        if (record.is_valid_order) stats.trueRows++;
        else stats.falseRows++;
      }
    });

    return {
      filename: text(filename),
      sheetName: sheet.name,
      records: records,
      stats: stats,
      warehouseCounts: warehouseCounts,
      countryCounts: countryCounts
    };
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
    });
  }

  function downloadConflictReport(win, stats) {
    if (!win || !win.XLSX || !stats || !Array.isArray(stats.conflictDetails) || !stats.conflictDetails.length) return;
    var rows = [['平台单号', 'SKU', '原始行号', '系统单号', '数量', '线上状态', '仓库']];
    stats.conflictDetails.forEach(function (group) {
      (group.records || []).forEach(function (record) {
        rows.push([
          group.order_no, group.sku_code, record.source_row, record.system_order_no,
          record.quantity, record.status, record.warehouse
        ]);
      });
    });
    var sheet = win.XLSX.utils.aoa_to_sheet(rows);
    var book = win.XLSX.utils.book_new();
    win.XLSX.utils.book_append_sheet(book, sheet, '至速仓订单冲突');
    win.XLSX.writeFile(book, '至速仓销售导入冲突明细.xlsx');
  }

  function renderSummary(win, stats, warehouseCounts, countryCounts) {
    var el = win.document && win.document.getElementById('sales-preview-stats');
    if (!el) return;
    var warehouses = Object.keys(warehouseCounts || {}).map(function (name) {
      return name + ' ' + Number(warehouseCounts[name] || 0);
    }).join('；');
    var countries = Object.keys(countryCounts || {}).map(function (name) {
      return name + ' ' + Number(countryCounts[name] || 0);
    }).join('；');
    var html = '<div style="margin-bottom:10px;padding:12px 14px;border:1px solid #d6e4ff;background:#f5f8ff;border-radius:10px;font-size:12px;color:#333">' +
      '<div style="font-weight:650;font-size:13px;margin-bottom:6px">已识别至速仓销售数据</div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:8px 16px;color:#555;margin-bottom:6px">' +
      '<span>仓库：' + escapeHtml(warehouses || '未识别') + '</span>' +
      '<span>国家：' + escapeHtml(countries || '未识别') + '</span>' +
      '<span>原始记录：' + Number(stats.sourceRows || 0).toLocaleString('en-US') + '</span>' +
      '<span>待导入：' + Number(stats.includedRows || 0).toLocaleString('en-US') + '</span>' +
      '<span>True：' + Number(stats.trueRows || 0).toLocaleString('en-US') + '</span>' +
      '<span>False：' + Number(stats.falseRows || 0).toLocaleString('en-US') + '</span>' +
      '</div>' +
      '<div style="color:#666">支付方式为空排除：' + Number(stats.excludedBlankPaymentRows || 0).toLocaleString('en-US') +
      ' 条；未支付排除：' + Number(stats.excludedUnpaidRows || 0).toLocaleString('en-US') +
      ' 条；完全重复去重：' + Number(stats.exactDuplicateRows || 0).toLocaleString('en-US') +
      ' 条；同订单商品去重：' + Number(stats.duplicateOrderItemRows || 0).toLocaleString('en-US') +
      ' 条；校验失败：' + Number(stats.validationErrorRows || 0).toLocaleString('en-US') + ' 条。</div>' +
      (Number(stats.conflictGroups || 0) ? '<div style="color:#b45309;margin-top:5px">重复订单冲突：' +
        Number(stats.conflictGroups || 0) + ' 组，共 ' + Number(stats.conflictRows || 0) +
        ' 行暂不导入。请下载异常明细核对。</div>' +
        '<button type="button" id="zhisu-sales-conflict-download" style="margin-top:7px;padding:5px 10px;border:1px solid #d1d5db;border-radius:7px;background:#fff;color:#333;cursor:pointer">下载冲突明细</button>' : '') +
      '<div style="color:#888;margin-top:4px">支付方式为空、线上状态为未支付的记录不导入；买方要求退回、已取消记为 False，其余状态记为 True。品牌由 PSI SKU 主数据匹配。</div>' +
      '</div>';
    el.innerHTML = '';
    el.insertAdjacentHTML('beforeend', html);
    var button = win.document.getElementById('zhisu-sales-conflict-download');
    if (button) button.addEventListener('click', function () { downloadConflictReport(win, stats); });
  }

  function install(win) {
    if (!win || win.__zhisuSalesImportInstalled) return;
    if (typeof win.handleSalesFile !== 'function' ||
        typeof win.openSalesBatchImport !== 'function' ||
        typeof win.requestSalesPreview !== 'function') return;

    win.__zhisuSalesImportInstalled = true;
    var originalHandleSalesFile = win.handleSalesFile;
    var originalOpenSalesBatchImport = win.openSalesBatchImport;
    var originalRequestSalesPreview = win.requestSalesPreview;

    function resetState() {
      win._salesImportSourceMode = 'template';
      win._salesImportZhisuStats = null;
      win._salesImportZhisuWarehouseCounts = null;
      win._salesImportZhisuCountryCounts = null;
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
      if (win._salesImportSourceMode === 'zhisu' && win._salesImportZhisuStats) {
        renderSummary(
          win,
          win._salesImportZhisuStats,
          win._salesImportZhisuWarehouseCounts,
          win._salesImportZhisuCountryCounts
        );
      }
      return result;
    };

    win.handleSalesFile = function (file) {
      if (!file) return;
      resetState();
      var ext = String(file.name || '').split('.').pop().toLowerCase();
      if (!['xlsx', 'xls'].includes(ext) || !win.FileReader || !win.XLSX) {
        return originalHandleSalesFile.apply(this, arguments);
      }

      var self = this;
      var reader = new win.FileReader();
      reader.onload = function (event) {
        try {
          var workbook = win.XLSX.read(new Uint8Array(event.target.result), {
            type: 'array', cellDates: true
          });
          var parsed = parseZhisuWorkbook(workbook, file.name, win.XLSX);
          if (!parsed) {
            resetState();
            originalHandleSalesFile.call(self, file);
            return;
          }

          win._salesImportSourceMode = 'zhisu';
          win._salesImportZhisuStats = parsed.stats;
          win._salesImportZhisuWarehouseCounts = parsed.warehouseCounts;
          win._salesImportZhisuCountryCounts = parsed.countryCounts;
          win._salesImportData = parsed.records;
          win.renderSalesPreview(parsed.records);
          var button = win.document.getElementById('sales-import-btn');
          if (button) button.disabled = true;
          if (!parsed.records.length && typeof win.showToast === 'function') {
            win.showToast('没有符合支付方式和线上状态规则的至速仓销售记录。', 'warning');
          }
          if ((parsed.stats.unknownWarehouseRows || 0) > 0 && typeof win.showToast === 'function') {
            win.showToast('部分至速仓订单无法根据仓库名称识别国家，相关行已阻止导入。', 'warning');
          }
        } catch (error) {
          if (typeof win.showToast === 'function') {
            win.showToast('至速仓销售文件解析失败：' + (error && error.message ? error.message : ''), 'danger');
          }
        }
      };
      reader.onerror = function () {
        if (typeof win.showToast === 'function') win.showToast('至速仓销售文件读取失败，请重新上传。', 'danger');
      };
      reader.readAsArrayBuffer(file);
    };
  }

  return {
    SOURCE_SYSTEM: SOURCE_SYSTEM,
    SOURCE_COUNTRIES: SOURCE_COUNTRIES,
    normalizeHeader: normalizeHeader,
    normalizeOrderDate: normalizeOrderDate,
    parseQuantity: parseQuantity,
    countryFromWarehouse: countryFromWarehouse,
    isUnpaidStatus: isUnpaidStatus,
    isFalseStatus: isFalseStatus,
    parseZhisuWorkbook: parseZhisuWorkbook,
    install: install
  };
});
