/*
 * BigSeller inventory import adapter.
 * Reads only the "单个SKU" sheet, maps SKU / available quantity, resolves brands
 * from PSI SKU master data, and automatically routes every source warehouse to the
 * single active Indonesia / Bekasi Warehouse in the PSI warehouse master.
 * Existing PSI template import remains unchanged.
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) {
    root.BigSellerInventoryImport = api;
    if (root.document) api.install(root);
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  function normalizeHeader(value) {
    return String(value == null ? '' : value).replace(/[\s\u3000]+/g, '').toLowerCase();
  }
  function localDate(value) {
    var d = value instanceof Date ? value : new Date(value || Date.now());
    if (isNaN(d.getTime())) d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function dateFromFilename(filename) {
    var m = String(filename || '').match(/(?:^|[^0-9])(20\d{2})(0[1-9]|1[0-2])([0-2]\d|3[01])(?:[0-9]{6,})?(?=[^0-9]|$)/);
    if (!m) return '';
    var y = Number(m[1]), mo = Number(m[2]), day = Number(m[3]);
    var d = new Date(y, mo - 1, day);
    return d.getFullYear() === y && d.getMonth() === mo - 1 && d.getDate() === day
      ? m[1] + '-' + m[2] + '-' + m[3] : '';
  }
  function expandWorksheetRange(ws, XLSX) {
    if (!ws || !XLSX || !XLSX.utils || !XLSX.utils.decode_cell || !XLSX.utils.encode_range) return;
    var keys = Object.keys(ws).filter(function (k) { return /^[A-Z]+[1-9][0-9]*$/.test(k); });
    if (!keys.length) return;
    var maxR = 0, maxC = 0;
    keys.forEach(function (key) {
      var cell = XLSX.utils.decode_cell(key);
      maxR = Math.max(maxR, cell.r);
      maxC = Math.max(maxC, cell.c);
    });
    var range = { s: { r: 0, c: 0 }, e: { r: maxR, c: maxC } };
    if (ws['!ref'] && XLSX.utils.decode_range) {
      try {
        var old = XLSX.utils.decode_range(ws['!ref']);
        range.s.r = Math.min(range.s.r, old.s.r);
        range.s.c = Math.min(range.s.c, old.s.c);
        range.e.r = Math.max(range.e.r, old.e.r);
        range.e.c = Math.max(range.e.c, old.e.c);
      } catch (_) {}
    }
    ws['!ref'] = XLSX.utils.encode_range(range);
  }
  function getSheetRows(workbook, sheetName, XLSX) {
    var ws = workbook && workbook.Sheets ? workbook.Sheets[sheetName] : null;
    if (!ws) return [];
    expandWorksheetRange(ws, XLSX);
    return XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false, dateNF: 'yyyy-mm-dd' });
  }
  function findColumn(headers, aliases) {
    var normalized = headers.map(normalizeHeader);
    for (var i = 0; i < aliases.length; i++) {
      var idx = normalized.indexOf(normalizeHeader(aliases[i]));
      if (idx >= 0) return idx;
    }
    return -1;
  }
  function parseQuantity(raw) {
    if (raw === null || raw === undefined || String(raw).trim() === '') {
      return { value: raw == null ? '' : raw, valid: false };
    }
    var value = Number(String(raw).replace(/,/g, '').trim());
    return { value: Number.isFinite(value) ? value : raw, valid: Number.isFinite(value) && Number.isInteger(value) && value >= 0 };
  }
  function countDataRows(rows) {
    return (rows || []).slice(1).filter(function (row) {
      return row && row.some(function (cell) { return String(cell == null ? '' : cell).trim() !== ''; });
    }).length;
  }

  function parseBigSellerWorkbook(workbook, filename, importDate, XLSX) {
    if (!workbook || !Array.isArray(workbook.SheetNames) || !workbook.SheetNames.length || !XLSX || !XLSX.utils) return null;
    var sheetName = workbook.SheetNames.find(function (name) { return normalizeHeader(name) === normalizeHeader('单个SKU'); });
    if (!sheetName) {
      sheetName = workbook.SheetNames.find(function (name) {
        var rows = getSheetRows(workbook, name, XLSX);
        var headers = rows[0] || [];
        var typeIdx = findColumn(headers, ['SKU类型', 'SKU Type', 'sku_type']);
        return rows.length > 1 &&
          findColumn(headers, ['SKU编号', 'SKU 编号', 'sku_code', 'SKU Code', 'SKU']) >= 0 &&
          findColumn(headers, ['整仓可用', '可用库存', '可用数量', 'Available Stock', 'available_qty']) >= 0 &&
          (typeIdx < 0 || rows.slice(1).some(function (r) { return String(r[typeIdx] || '').trim().toLowerCase() === 'single sku'; }));
      });
    }
    if (!sheetName) return null;

    var rows = getSheetRows(workbook, sheetName, XLSX);
    if (rows.length < 2) return null;
    var headers = (rows[0] || []).map(function (h) { return String(h == null ? '' : h).trim(); });
    var skuIdx = findColumn(headers, ['SKU编号', 'SKU 编号', 'sku_code', 'SKU Code', 'SKU']);
    var qtyIdx = findColumn(headers, ['整仓可用', '可用库存', '可用数量', 'Available Stock', 'available_qty']);
    var sourceWarehouseIdx = findColumn(headers, ['仓库', 'warehouse', 'Warehouse Name']);
    var skuTypeIdx = findColumn(headers, ['SKU类型', 'SKU Type', 'sku_type']);
    if (skuIdx < 0 || qtyIdx < 0) return null;

    var sourceWarehouseCounts = Object.create(null);
    var records = [];
    for (var i = 1; i < rows.length; i++) {
      var row = rows[i] || [];
      if (!row.some(function (cell) { return String(cell == null ? '' : cell).trim() !== ''; })) continue;
      var skuType = skuTypeIdx >= 0 ? String(row[skuTypeIdx] == null ? '' : row[skuTypeIdx]).trim().toLowerCase() : '';
      if (skuType && skuType !== 'single sku' && skuType !== '单个sku') continue;

      var skuCode = String(row[skuIdx] == null ? '' : row[skuIdx]).trim();
      var qty = parseQuantity(row[qtyIdx]);
      var sourceWarehouse = sourceWarehouseIdx >= 0 ? String(row[sourceWarehouseIdx] == null ? '' : row[sourceWarehouseIdx]).trim() : '';
      var errors = [];
      if (!skuCode) errors.push('SKU 编号不能为空');
      if (!qty.valid) errors.push('整仓可用必须为非负整数');
      if (!sourceWarehouse) errors.push('BigSeller 源仓库为空，无法映射 PSI 目标仓库');
      if (sourceWarehouse) sourceWarehouseCounts[sourceWarehouse] = (sourceWarehouseCounts[sourceWarehouse] || 0) + 1;

      records.push({
        sku_code: skuCode,
        brand: '', // BigSeller 一级分类不是权威品牌；由 PSI SKU 主数据回填
        import_date: importDate || localDate(),
        country: '',
        warehouse: '',
        channel: '',
        available_qty: qty.value,
        weighted_avg_cost: '', // 不导入 BigSeller 成本，避免覆盖 PSI WAC
        last_inbound_date: '',
        remark: sourceWarehouse ? ('BigSeller 源仓库：' + sourceWarehouse) : 'BigSeller 库存导入',
        _rowNum: i + 1,
        _sourceWarehouse: sourceWarehouse,
        _sourceRows: [i + 1],
        _baseErrors: errors.slice(),
        _errors: errors.slice()
      });
    }

    var combinationSheet = workbook.SheetNames.find(function (name) { return normalizeHeader(name) === normalizeHeader('组合SKU'); });
    return {
      sheetName: sheetName,
      records: records,
      sourceWarehouses: Object.keys(sourceWarehouseCounts),
      sourceWarehouseCounts: sourceWarehouseCounts,
      skippedCombinationRows: combinationSheet ? countDataRows(getSheetRows(workbook, combinationSheet, XLSX)) : 0,
      snapshotDate: dateFromFilename(filename)
    };
  }


  function normalizeWarehouseName(value) {
    return String(value == null ? '' : value).replace(/\\s+/g, ' ').trim().toLowerCase();
  }

  // The BigSeller export is always the Bekasi stock snapshot for this workflow.
  // Resolve by exact business identity, never by a hard-coded database ID or fuzzy name.
  function resolveBekasiWarehouse(warehouseMaster) {
    var matches = (warehouseMaster || []).filter(function (w) {
      var country = String(w && w.country_name || '').trim();
      return !!w &&
        w.status === 'active' &&
        normalizeWarehouseName(w.name) === 'bekasi warehouse' &&
        (country === '印度尼西亚' || country.toLowerCase() === 'indonesia');
    });
    return {
      warehouse: matches.length === 1 ? matches[0] : null,
      matchCount: matches.length,
      error: matches.length === 1 ? '' : (matches.length
        ? 'PSI 仓库主数据中存在多个启用的印度尼西亚 / Bekasi Warehouse，无法安全导入。'
        : '未找到启用的印度尼西亚 / Bekasi Warehouse，无法安全导入。')
    };
  }

  function buildBekasiSourceMap(sourceWarehouses, warehouseMaster) {
    var resolved = resolveBekasiWarehouse(warehouseMaster);
    var map = Object.create(null);
    if (resolved.warehouse) {
      (sourceWarehouses || []).forEach(function (source) {
        if (String(source == null ? '' : source).trim()) {
          map[String(source)] = String(resolved.warehouse.id);
        }
      });
    }
    return {
      map: map,
      warehouse: resolved.warehouse,
      matchCount: resolved.matchCount,
      error: resolved.error
    };
  }

  function duplicateGroups(records) {
    var groups = new Map();
    (records || []).forEach(function (record) {
      if (!record || !record.sku_code || !record.country || !record.warehouse) return;
      var key = [record.sku_code, record.country, record.warehouse].join('\u0000');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(record);
    });
    var out = [];
    groups.forEach(function (items) {
      if (items.length > 1) out.push({ sku_code: items[0].sku_code, country: items[0].country, warehouse: items[0].warehouse, items: items });
    });
    return out;
  }

  function buildMappedRecords(rawRecords, sourceMap, warehouseMaster, mergeDuplicates) {
    var warehouseById = new Map((warehouseMaster || []).map(function (w) { return [String(w.id), w]; }));
    var mapped = (rawRecords || []).map(function (raw) {
      var record = Object.assign({}, raw);
      record._errors = (raw._baseErrors || raw._errors || []).slice();
      var targetId = sourceMap ? sourceMap[raw._sourceWarehouse] : '';
      var target = targetId ? warehouseById.get(String(targetId)) : null;
      if (target && target.status === 'active') {
        record.country = String(target.country_name || '').trim();
        record.warehouse = String(target.name || '').trim();
        if (!record.country || !record.warehouse) record._errors.push('PSI 目标仓库缺少国家或仓库名称');
      } else {
        record.country = '';
        record.warehouse = '';
        record._errors.push('BigSeller 源仓库「' + (raw._sourceWarehouse || '(空)') + '」尚未映射 PSI 目标仓库');
      }
      record.remark = 'BigSeller 源仓库：' + (raw._sourceWarehouse || '(空)') + '；原始行：' + (raw._sourceRows || [raw._rowNum]).join(', ');
      return record;
    });

    var duplicates = duplicateGroups(mapped);
    var mappingReady = (rawRecords || []).length > 0 && (rawRecords || []).every(function (r) {
      return !!(sourceMap && sourceMap[r._sourceWarehouse] && warehouseById.has(String(sourceMap[r._sourceWarehouse])));
    });
    if (!duplicates.length) return { records: mapped, duplicateGroups: [], mappingReady: mappingReady };

    if (!mergeDuplicates) {
      duplicates.forEach(function (group) {
        var sources = group.items.map(function (r) { return r._sourceWarehouse + ' (' + r.available_qty + ')'; }).join('、');
        group.items.forEach(function (r) { r._errors.push('同一 SKU 在同一 PSI 目标仓库重复（' + sources + '）；请调整映射或确认合并数量'); });
      });
      return { records: mapped, duplicateGroups: duplicates, mappingReady: mappingReady };
    }

    var duplicateKeySet = new Set();
    duplicates.forEach(function (g) { duplicateKeySet.add([g.sku_code, g.country, g.warehouse].join('\u0000')); });
    var emitted = new Set(), merged = [];
    mapped.forEach(function (record) {
      var key = [record.sku_code, record.country, record.warehouse].join('\u0000');
      if (!duplicateKeySet.has(key)) { merged.push(record); return; }
      if (emitted.has(key)) return;
      emitted.add(key);
      var group = duplicates.find(function (g) { return [g.sku_code, g.country, g.warehouse].join('\u0000') === key; });
      var canMerge = group.items.every(function (r) {
        return (!r._errors || r._errors.length === 0) && Number.isInteger(Number(r.available_qty)) && Number(r.available_qty) >= 0;
      });
      if (!canMerge) {
        group.items.forEach(function (r) { r._errors.push('重复 SKU 含有格式错误，无法安全合并'); merged.push(r); });
        return;
      }
      var first = Object.assign({}, group.items[0]);
      first.available_qty = group.items.reduce(function (sum, r) { return sum + Number(r.available_qty); }, 0);
      first._sourceRows = group.items.reduce(function (all, r) { return all.concat(r._sourceRows || [r._rowNum]); }, []);
      first._sourceWarehouse = group.items.map(function (r) { return r._sourceWarehouse; }).filter(Boolean).join(' / ');
      first._errors = [];
      first.remark = 'BigSeller 合并源仓库：' + first._sourceWarehouse + '；原始行：' + first._sourceRows.join(', ');
      merged.push(first);
    });
    return { records: merged, duplicateGroups: duplicates, mappingReady: mappingReady };
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
    });
  }
  function tr(win, key, fallback, vars) {
    return win && typeof win.t === 'function' ? win.t(key, fallback, vars) : fallback;
  }
  function installTranslations(win) {
    var dict = win.I18N && win.I18N.dict;
    if (!dict) return;
    var en = {
      'inv.bigseller.detected': 'BigSeller export detected. Only the “单个SKU” sheet will be imported; the “组合SKU” sheet will be skipped.',
      'inv.bigseller.summary': '{n} single-SKU rows detected; {c} combination-SKU rows skipped.',
      'inv.bigseller.source_warehouse': 'BigSeller source warehouse',
      'inv.bigseller.target_warehouse': 'PSI destination country / warehouse',
      'inv.bigseller.choose_target': 'Select a PSI destination warehouse',
      'inv.bigseller.apply_all': 'Apply to all',
      'inv.bigseller.apply_all_placeholder': 'Select one destination for all source warehouses',
      'inv.bigseller.mapping_hint': 'All BigSeller source warehouse labels are automatically routed to the existing Indonesia / Bekasi Warehouse. Source labels are retained for traceability.',
      'inv.bigseller.mapping_missing': 'The fixed Bekasi destination could not be resolved. Import is blocked until exactly one active warehouse is found.',
      'inv.bigseller.mapping_loaded': 'All source warehouses are automatically routed to Indonesia / Bekasi Warehouse.',
      'inv.bigseller.bekasi_target_error': 'PSI warehouse master must contain exactly one active Indonesia / Bekasi Warehouse; found {n}. Import is blocked for safety.',
      'inv.bigseller.fixed_destination': 'Fixed PSI destination',
      'inv.bigseller.duplicate_title': 'Duplicate SKU rows map to the same PSI destination',
      'inv.bigseller.duplicate_hint': 'Import is blocked by default. If these source warehouses represent stock in the same PSI warehouse, explicitly confirm that their “整仓可用” quantities should be added together.',
      'inv.bigseller.merge_duplicates': 'I confirm: sum available quantities for duplicate SKUs in the same PSI warehouse',
      'inv.bigseller.import_source_note': 'Brand is resolved from PSI SKU master data. BigSeller “一级分类” is ignored. BigSeller cost fields are not imported; PSI WAC rules remain authoritative.',
      'inv.bigseller.warehouse_load_failed': 'Could not load PSI warehouse master data. Import is disabled for safety.',
      'inv.bigseller.no_warehouse_options': 'No active PSI warehouses are available.',
      'inv.bigseller.file_parse_failed': 'Could not read this BigSeller file: {message}'
    };
    var id = {
      'inv.bigseller.detected': 'Format ekspor BigSeller terdeteksi. Hanya sheet “单个SKU” yang diimpor; sheet “组合SKU” akan dilewati.',
      'inv.bigseller.summary': '{n} baris SKU tunggal terdeteksi; {c} baris SKU kombinasi dilewati.',
      'inv.bigseller.source_warehouse': 'Gudang sumber BigSeller',
      'inv.bigseller.target_warehouse': 'Negara / gudang tujuan PSI',
      'inv.bigseller.choose_target': 'Pilih gudang tujuan PSI',
      'inv.bigseller.apply_all': 'Terapkan ke semua',
      'inv.bigseller.apply_all_placeholder': 'Pilih satu tujuan untuk semua gudang sumber',
      'inv.bigseller.mapping_hint': 'Semua nama gudang sumber BigSeller otomatis diarahkan ke Bekasi Warehouse Indonesia yang sudah ada. Nama sumber tetap disimpan untuk pelacakan.',
      'inv.bigseller.mapping_missing': 'Tujuan Bekasi tetap tidak dapat ditentukan. Impor diblokir sampai tepat satu gudang aktif ditemukan.',
      'inv.bigseller.mapping_loaded': 'Semua gudang sumber otomatis diarahkan ke Indonesia / Bekasi Warehouse.',
      'inv.bigseller.bekasi_target_error': 'Data master gudang PSI harus memiliki tepat satu Indonesia / Bekasi Warehouse aktif; ditemukan {n}. Impor diblokir demi keamanan.',
      'inv.bigseller.fixed_destination': 'Gudang tujuan PSI tetap',
      'inv.bigseller.duplicate_title': 'Baris SKU duplikat dipetakan ke tujuan PSI yang sama',
      'inv.bigseller.duplicate_hint': 'Impor diblokir secara default. Jika gudang sumber tersebut memang merupakan stok di gudang PSI yang sama, Anda dapat mengonfirmasi penjumlahan kuantitas “整仓可用”.',
      'inv.bigseller.merge_duplicates': 'Saya konfirmasi: jumlahkan kuantitas tersedia untuk SKU duplikat di gudang PSI yang sama',
      'inv.bigseller.import_source_note': 'Merek diambil dari data master SKU PSI. Kolom “一级分类” BigSeller diabaikan. Biaya BigSeller tidak diimpor; aturan WAC PSI tetap menjadi acuan.',
      'inv.bigseller.warehouse_load_failed': 'Data master gudang PSI gagal dimuat. Impor dinonaktifkan demi keamanan.',
      'inv.bigseller.no_warehouse_options': 'Tidak ada gudang PSI aktif.',
      'inv.bigseller.file_parse_failed': 'Gagal membaca file BigSeller ini: {message}'
    };
    Object.keys(en).forEach(function (k) { dict.en[k] = en[k]; });
    Object.keys(id).forEach(function (k) { dict.id[k] = id[k]; });
  }

  function install(win) {
    if (!win || win.__bigSellerInventoryImportInstalled) return;
    if (typeof win.handleInvFile !== 'function' || typeof win.openInvBatchImport !== 'function' || typeof win.runInvPrecheck !== 'function') return;
    win.__bigSellerInventoryImportInstalled = true;
    installTranslations(win);

    var originalHandleInvFile = win.handleInvFile;
    var originalOpenInvBatchImport = win.openInvBatchImport;
    var originalRunInvPrecheck = win.runInvPrecheck;

    function resetAdapterState() {
      win._invImportSourceMode = 'template';
      win._invBigSellerRawRecords = [];
      win._invBigSellerSourceWarehouses = [];
      win._invBigSellerSourceWarehouseCounts = {};
      win._invBigSellerWarehouseMaster = [];
      win._invBigSellerWarehouseTarget = null;
      win._invBigSellerWarehouseTargetError = '';
      win._invBigSellerWarehouseTargetMatchCount = 0;
      win._invBigSellerWarehouseMap = Object.create(null);
      win._invBigSellerMergeDuplicates = false;
      win._invBigSellerMappingReady = false;
      var box = win.document && win.document.getElementById('inv-source-warehouse-mapping');
      if (box) box.innerHTML = '';
    }

    win.openInvBatchImport = function () {
      resetAdapterState();
      return originalOpenInvBatchImport.apply(this, arguments);
    };

    function ensureMappingBox() {
      var box = win.document.getElementById('inv-source-warehouse-mapping');
      if (box) return box;
      var status = win.document.getElementById('inv-status');
      var drop = win.document.getElementById('inv-drop-zone');
      if (!status || !drop || !drop.parentNode) return null;
      box = win.document.createElement('div');
      box.id = 'inv-source-warehouse-mapping';
      box.style.marginTop = '12px';
      drop.parentNode.insertBefore(box, status);
      return box;
    }

    function renderMapping(parsedResult) {
      var box = ensureMappingBox();
      if (!box) return;
      var sources = win._invBigSellerSourceWarehouses || [];
      var target = win._invBigSellerWarehouseTarget || null;
      var targetError = win._invBigSellerWarehouseTargetError || '';
      var matchCount = Number(win._invBigSellerWarehouseTargetMatchCount || 0);
      var targetLabel = target
        ? String(target.country_name || '') + ' / ' + String(target.name || '')
        : '';

      var html = '<div style="padding:12px 14px;border:1px solid #d6e4ff;background:#f5f8ff;border-radius:10px;font-size:12px;color:#333">' +
        '<div style="font-weight:650;font-size:13px;margin-bottom:5px">' + escapeHtml(tr(win, 'inv.bigseller.detected', '已识别 BigSeller 库存导出：只读取「单个SKU」工作表，自动忽略「组合SKU」工作表。')) + '</div>' +
        '<div style="color:#666;margin-bottom:8px">' + escapeHtml(tr(win, 'inv.bigseller.summary', '已识别 {n} 条单个 SKU；忽略 {c} 条组合 SKU。', { n: (win._invBigSellerRawRecords || []).length, c: win._invBigSellerSkippedCombinationRows || 0 })) + '</div>' +
        '<div style="color:#666;margin-bottom:10px">' + escapeHtml(tr(win, 'inv.bigseller.import_source_note', '品牌从 SKU 主数据匹配；不读取 BigSeller 一级分类。成本字段不导入，继续使用 PSI 的 WAC 规则。')) + '</div>' +
        '<div style="color:#666;margin-bottom:10px">' + escapeHtml(tr(win, 'inv.bigseller.mapping_hint', '所有 BigSeller 源仓库统一归入现有的印度尼西亚 / Bekasi Warehouse；保留源仓库名称用于追溯。')) + '</div>';

      if (!target) {
        html += '<div style="padding:8px 10px;background:#fff1f0;color:#a8071a;border-radius:6px">' +
          escapeHtml(tr(win, 'inv.bigseller.bekasi_target_error', '必须且只能找到一个启用的「印度尼西亚 / Bekasi Warehouse」，当前找到 {n} 个。为避免导错仓，已阻止导入。', { n: matchCount })) +
          (targetError ? '<div style="margin-top:4px">' + escapeHtml(targetError) + '</div>' : '') +
          '</div>';
      } else {
        html += '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px">' +
          '<span style="color:#666">' + escapeHtml(tr(win, 'inv.bigseller.fixed_destination', '固定 PSI 目标仓库')) + '：</span>' +
          '<strong style="padding:5px 9px;border:1px solid #b7eb8f;background:#f6ffed;border-radius:7px;color:#237804">' + escapeHtml(targetLabel) + '</strong>' +
          '</div>';
        html += '<div class="table-container" style="max-height:180px;overflow:auto;box-shadow:none;border:1px solid #e5e7eb;background:#fff"><table class="data-table"><thead><tr>' +
          '<th>' + escapeHtml(tr(win, 'inv.bigseller.source_warehouse', 'BigSeller 源仓库')) + '</th><th>SKU 数量</th><th>' + escapeHtml(tr(win, 'inv.bigseller.fixed_destination', '固定 PSI 目标仓库')) + '</th></tr></thead><tbody>';
        sources.forEach(function (source) {
          html += '<tr><td>' + escapeHtml(source) + '</td><td>' + Number((win._invBigSellerSourceWarehouseCounts || {})[source] || 0) + '</td><td>' + escapeHtml(targetLabel) + '</td></tr>';
        });
        html += '</tbody></table></div>';
      }

      var built = parsedResult || buildMappedRecords(win._invBigSellerRawRecords || [], win._invBigSellerWarehouseMap || {}, win._invBigSellerWarehouseMaster || [], !!win._invBigSellerMergeDuplicates);
      if (built.duplicateGroups && built.duplicateGroups.length) {
        html += '<div style="margin-top:10px;padding:10px 12px;background:#fff7e6;border:1px solid #ffd591;border-radius:8px">' +
          '<div style="font-weight:650;color:#ad6800;margin-bottom:4px">' + escapeHtml(tr(win, 'inv.bigseller.duplicate_title', '发现同一 SKU 在 Bekasi 目标仓库存在重复记录')) + '（' + built.duplicateGroups.length + '）</div>' +
          '<div style="color:#805b16;margin-bottom:8px">' + escapeHtml(tr(win, 'inv.bigseller.duplicate_hint', '默认阻止导入。请先核对源仓库明细；确认这些数量分别代表 Bekasi 的库存组成后，再勾选合并。')) + '</div>';
        built.duplicateGroups.slice(0, 30).forEach(function (g) {
          var detail = g.items.map(function (r) { return r._sourceWarehouse + ': ' + r.available_qty; }).join('；');
          html += '<div style="padding:5px 0;border-top:1px solid rgba(173,104,0,.12)"><b>' + escapeHtml(g.sku_code) + '</b> · ' + escapeHtml(g.country + ' / ' + g.warehouse) + '<div style="color:#805b16">' + escapeHtml(detail) + '</div></div>';
        });
        html += '<label style="display:flex;gap:8px;align-items:flex-start;margin-top:8px;color:#805b16"><input type="checkbox" id="inv-bigseller-merge-duplicates" ' + (win._invBigSellerMergeDuplicates ? 'checked' : '') + ' style="margin-top:2px">' + escapeHtml(tr(win, 'inv.bigseller.merge_duplicates', '确认将同一 Bekasi 仓库下重复 SKU 的整仓可用数量相加')) + '</label></div>';
      }
      html += '<div style="margin-top:8px;color:' + (win._invBigSellerMappingReady ? '#237804' : '#ad6800') + '">' +
        escapeHtml(win._invBigSellerMappingReady
          ? tr(win, 'inv.bigseller.mapping_loaded', '所有 BigSeller 源仓库已自动归入印度尼西亚 / Bekasi Warehouse。')
          : tr(win, 'inv.bigseller.mapping_missing', '无法唯一确认 Bekasi 目标仓库，导入已阻止。')) +
        '</div></div>';
      box.innerHTML = html;

      var mergeBox = box.querySelector('#inv-bigseller-merge-duplicates');
      if (mergeBox) mergeBox.addEventListener('change', function () {
        win._invBigSellerMergeDuplicates = !!mergeBox.checked;
        applyMappings();
      });
    }

    function applyMappings() {
      var built = buildMappedRecords(
        win._invBigSellerRawRecords || [],
        win._invBigSellerWarehouseMap || {},
        win._invBigSellerWarehouseMaster || [],
        !!win._invBigSellerMergeDuplicates
      );
      win._invImportData = built.records;
      win._invBigSellerMappingReady = !!built.mappingReady;
      win._invPrecheck = null;
      win._invPassedFingerprint = null;
      win._invPrecheckError = false;
      win._invPrecheckSeq = (Number(win._invPrecheckSeq) || 0) + 1;
      renderMapping(built);
      if (typeof win.renderInvPreview === 'function') win.renderInvPreview(win._invImportData);
      if (typeof win.renderInvStatus === 'function') win.renderInvStatus();
      if (typeof win.updateInvImportBtnState === 'function') win.updateInvImportBtnState();
      var hasLocalError = win._invImportData.some(function (r) { return r._errors && r._errors.length; });
      if (win._invBigSellerMappingReady && !hasLocalError) win.runInvPrecheck();
    }

    win.runInvPrecheck = async function () {
      if (win._invImportSourceMode === 'bigseller') {
        if (!win._invBigSellerMappingReady) return;
        if ((win._invImportData || []).some(function (r) { return r._errors && r._errors.length; })) return;
      }
      var result = await originalRunInvPrecheck.apply(this, arguments);
      if (win._invImportSourceMode === 'bigseller') {
        var records = win._invImportData || [];
        var precheck = win._invPrecheck || {};
        var resolved = new Map((precheck.resolved_skus || []).map(function (r) {
          return [String(r.sku_code), String(r.brand == null ? '' : r.brand)];
        }));
        records.forEach(function (record) {
          var masterBrand = resolved.get(String(record.sku_code || '').trim());
          if (masterBrand && !record.brand) record.brand = masterBrand;
        });
        if (precheck.ok === true && (!precheck.blocking || precheck.blocking.length === 0) && win.InvImportRules) {
          win._invPassedFingerprint = win.InvImportRules.computeInvImportFingerprint(records, win._invSnapshotDate || '');
        } else {
          win._invPassedFingerprint = null;
        }
        if (typeof win.renderInvPreview === 'function') win.renderInvPreview(records);
        if (typeof win.renderInvStatus === 'function') win.renderInvStatus();
        if (typeof win.updateInvImportBtnState === 'function') win.updateInvImportBtnState();
      }
      return result;
    };

    function handleBigSellerFile(file) {
      var ext = String(file.name || '').split('.').pop().toLowerCase();
      if (ext !== 'xlsx') return Promise.resolve(false);
      return new Promise(function (resolve) {
        var reader = new win.FileReader();
        reader.onload = async function (event) {
          try {
            var workbook = win.XLSX.read(new Uint8Array(event.target.result), { type: 'array', cellDates: true });
            var parsed = parseBigSellerWorkbook(workbook, file.name, localDate(), win.XLSX);
            if (!parsed) { resetAdapterState(); originalHandleInvFile(file); resolve(true); return; }

            win._invImportSourceMode = 'bigseller';
            win._invBigSellerRawRecords = parsed.records;
            win._invBigSellerSourceWarehouses = parsed.sourceWarehouses;
            win._invBigSellerSourceWarehouseCounts = parsed.sourceWarehouseCounts;
            win._invBigSellerWarehouseMap = Object.create(null);
            win._invBigSellerWarehouseTarget = null;
            win._invBigSellerWarehouseTargetError = '';
            win._invBigSellerWarehouseTargetMatchCount = 0;
            win._invBigSellerMergeDuplicates = false;
            win._invBigSellerSkippedCombinationRows = parsed.skippedCombinationRows;
            win._invBigSellerMappingReady = false;
            win._invImportData = [];
            win._invPrecheck = null;
            win._invPassedFingerprint = null;
            win._invPrecheckError = false;
            win._invPrecheckSeq = (Number(win._invPrecheckSeq) || 0) + 1;

            if (parsed.snapshotDate && !win._invSnapshotDate) {
              win._invSnapshotDate = parsed.snapshotDate;
              var dateInput = win.document.getElementById('inv-snapshot-cutoff');
              if (dateInput) dateInput.value = parsed.snapshotDate;
            }
            try {
              var warehouseRows = await win.api('/api/warehouses');
              win._invBigSellerWarehouseMaster = (warehouseRows || []).filter(function (w) { return w && w.status === 'active'; });
              var bekasiMapping = buildBekasiSourceMap(parsed.sourceWarehouses, win._invBigSellerWarehouseMaster);
              win._invBigSellerWarehouseTarget = bekasiMapping.warehouse;
              win._invBigSellerWarehouseTargetError = bekasiMapping.error;
              win._invBigSellerWarehouseTargetMatchCount = bekasiMapping.matchCount;
              win._invBigSellerWarehouseMap = bekasiMapping.map;
            } catch (warehouseError) {
              win._invBigSellerWarehouseMaster = [];
              win._invBigSellerWarehouseTarget = null;
              win._invBigSellerWarehouseTargetError = '无法读取 PSI 仓库主数据。';
              win._invBigSellerWarehouseTargetMatchCount = 0;
              if (typeof win.showToast === 'function') win.showToast(tr(win, 'inv.bigseller.warehouse_load_failed', '无法读取 PSI 仓库主数据，无法安全导入。'), 'danger');
            }
            ensureMappingBox();
            applyMappings();
            resolve(true);
          } catch (error) {
            if (typeof win.showToast === 'function') win.showToast(tr(win, 'inv.bigseller.file_parse_failed', 'BigSeller 文件解析失败：{message}', { message: error && error.message ? error.message : '' }), 'danger');
            resolve(true);
          }
        };
        reader.onerror = function () {
          if (typeof win.showToast === 'function') win.showToast('BigSeller 文件读取失败，请重新上传。', 'danger');
          resolve(true);
        };
        reader.readAsArrayBuffer(file);
      });
    }

    win.handleInvFile = function (file) {
      if (!file) return;
      return handleBigSellerFile(file).then(function (handled) {
        if (!handled) {
          resetAdapterState();
          return originalHandleInvFile(file);
        }
      });
    };
  }

  return {
    normalizeHeader: normalizeHeader,
    dateFromFilename: dateFromFilename,
    parseQuantity: parseQuantity,
    parseBigSellerWorkbook: parseBigSellerWorkbook,
    duplicateGroups: duplicateGroups,
    resolveBekasiWarehouse: resolveBekasiWarehouse,
    buildBekasiSourceMap: buildBekasiSourceMap,
    buildMappedRecords: buildMappedRecords,
    install: install
  };
});