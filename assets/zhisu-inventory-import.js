/*
 * Zhisu warehouse inventory import adapter.
 * Supports the direct .xls/.xlsx export from 至速仓:
 *   - warehouse name determines the country
 *   - SKU is read from 规格名称, with only the two approved K686 aliases
 *   - quantity is read from 可用库存数
 *   - brand is resolved only by the PSI SKU master precheck
 *   - Fake Order / FO is excluded
 *   - duplicate SKU rows in the same country/warehouse are blocked unless explicitly merged
 * Existing template and BigSeller imports remain unchanged.
 */
(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) {
    root.ZhisuInventoryImport = api;
    if (root.document) api.install(root);
  }
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this), function () {
  "use strict";

  var SKU_ALIASES = Object.freeze({
    "K686WB-RGB-PRO-BS": "RDK686WBRGBPROBS",
    "K686WB-RGB-PRO-RS": "RDK686WBRGBPRORS"
  });
  var SOURCE_COUNTRIES = Object.freeze({
    "吉隆坡一号仓": "马来西亚",
    "泰国一号仓": "泰国"
  });
  var TARGET_WAREHOUSE_NAME = "至速仓";
  var FO_SKU = "FO";

  function normalizeHeader(value) {
    return String(value == null ? "" : value).replace(/[\s\u3000]+/g, "").toLowerCase();
  }
  function normalizeText(value) {
    return String(value == null ? "" : value).replace(/\s+/g, " ").trim();
  }
  function localDate(value) {
    var d = value instanceof Date ? value : new Date(value || Date.now());
    if (isNaN(d.getTime())) d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function dateFromFilename(filename) {
    var name = String(filename || "");
    var m = name.match(/(?:^|[^0-9])(20\d{2})[-_.]?([01]\d)[-_.]?([0-3]\d)(?:[^0-9]|$)/);
    if (!m) return "";
    var y = Number(m[1]), mo = Number(m[2]), day = Number(m[3]);
    var d = new Date(y, mo - 1, day);
    return d.getFullYear() === y && d.getMonth() === mo - 1 && d.getDate() === day
      ? m[1] + "-" + m[2] + "-" + m[3] : "";
  }
  function findColumn(headers, aliases) {
    var normalized = (headers || []).map(normalizeHeader);
    for (var i = 0; i < aliases.length; i++) {
      var idx = normalized.indexOf(normalizeHeader(aliases[i]));
      if (idx >= 0) return idx;
    }
    return -1;
  }
  function parseQuantity(raw) {
    if (raw === null || raw === undefined || String(raw).trim() === "") {
      return { value: raw == null ? "" : raw, valid: false };
    }
    var value = Number(String(raw).replace(/,/g, "").trim());
    return { value: Number.isFinite(value) ? value : raw, valid: Number.isFinite(value) && Number.isInteger(value) && value >= 0 };
  }
  function getSheetRows(workbook, sheetName, XLSX) {
    var ws = workbook && workbook.Sheets ? workbook.Sheets[sheetName] : null;
    if (!ws || !XLSX || !XLSX.utils || typeof XLSX.utils.sheet_to_json !== "function") return [];
    return XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: false, dateNF: "yyyy-mm-dd" });
  }
  function isBlankRow(row) {
    return !row || !row.some(function (cell) { return String(cell == null ? "" : cell).trim() !== ""; });
  }

  function parseZhisuWorkbook(workbook, filename, importDate, XLSX) {
    if (!workbook || !Array.isArray(workbook.SheetNames) || !workbook.SheetNames.length || !XLSX || !XLSX.utils) return null;
    var detected = null;
    for (var s = 0; s < workbook.SheetNames.length && !detected; s++) {
      var sheetName = workbook.SheetNames[s];
      var rows = getSheetRows(workbook, sheetName, XLSX);
      var headerRowIndex = -1, warehouseIdx = -1, skuIdx = -1, qtyIdx = -1, productNameIdx = -1;
      var scanLimit = Math.min(rows.length, 10);
      for (var h = 0; h < scanLimit; h++) {
        var headers = rows[h] || [];
        var w = findColumn(headers, ["仓库名称", "仓库", "warehouse name"]);
        var k = findColumn(headers, ["规格名称", "SKU", "SKU编码", "sku_code"]);
        var q = findColumn(headers, ["可用库存数", "可用库存", "可用数量", "available_qty"]);
        if (w >= 0 && k >= 0 && q >= 0) {
          headerRowIndex = h;
          warehouseIdx = w;
          skuIdx = k;
          qtyIdx = q;
          productNameIdx = findColumn(headers, ["商品名称", "产品名称", "product name"]);
          break;
        }
      }
      if (headerRowIndex >= 0) {
        detected = {
          sheetName: sheetName,
          rows: rows,
          headerRowIndex: headerRowIndex,
          warehouseIdx: warehouseIdx,
          skuIdx: skuIdx,
          qtyIdx: qtyIdx,
          productNameIdx: productNameIdx
        };
      }
    }
    if (!detected) return null;

    var records = [];
    var excludedRows = [];
    var sourceWarehouseCounts = Object.create(null);
    var sourceWarehouses = [];
    var totalRows = 0;
    var dataRows = detected.rows.slice(detected.headerRowIndex + 1);

    dataRows.forEach(function (row, offset) {
      if (isBlankRow(row)) return;
      totalRows++;
      var rowNum = detected.headerRowIndex + offset + 2;
      var sourceWarehouse = normalizeText(row[detected.warehouseIdx]);
      var rawSku = normalizeText(row[detected.skuIdx]);
      var productName = detected.productNameIdx >= 0 ? normalizeText(row[detected.productNameIdx]) : "";
      var qty = parseQuantity(row[detected.qtyIdx]);

      if (sourceWarehouse) {
        if (!Object.prototype.hasOwnProperty.call(sourceWarehouseCounts, sourceWarehouse)) {
          sourceWarehouseCounts[sourceWarehouse] = 0;
          sourceWarehouses.push(sourceWarehouse);
        }
        sourceWarehouseCounts[sourceWarehouse]++;
      }

      if (rawSku.toUpperCase() === FO_SKU) {
        excludedRows.push({
          rowNum: rowNum,
          sku_code: rawSku,
          product_name: productName,
          sourceWarehouse: sourceWarehouse,
          available_qty: qty.value,
          reason: "Fake Order（FO）不是实际库存 SKU，自动排除"
        });
        return;
      }

      var skuCode = Object.prototype.hasOwnProperty.call(SKU_ALIASES, rawSku) ? SKU_ALIASES[rawSku] : rawSku;
      var errors = [];
      if (!skuCode) errors.push("规格名称（SKU）不能为空");
      if (!qty.valid) errors.push("可用库存数必须为非负整数");
      if (!sourceWarehouse) errors.push("仓库名称为空，无法识别国家和 PSI 目标仓库");

      records.push({
        sku_code: skuCode,
        brand: "",
        import_date: importDate || localDate(),
        country: "",
        warehouse: "",
        channel: "",
        available_qty: qty.value,
        weighted_avg_cost: "",
        last_inbound_date: "",
        remark: "至速源仓：" + (sourceWarehouse || "(空)") + "；原始行：" + rowNum,
        _rowNum: rowNum,
        _sourceWarehouse: sourceWarehouse,
        _sourceRows: [rowNum],
        _rawSku: rawSku,
        _productName: productName,
        _baseErrors: errors.slice(),
        _errors: errors.slice()
      });
    });

    return {
      sheetName: detected.sheetName,
      records: records,
      excludedRows: excludedRows,
      totalRows: totalRows,
      sourceWarehouses: sourceWarehouses,
      sourceWarehouseCounts: sourceWarehouseCounts,
      snapshotDate: dateFromFilename(filename)
    };
  }

  function resolveZhisuDestinations(sourceWarehouses, warehouseMaster) {
    var destinations = Object.create(null);
    var errors = [];
    var warehouses = Array.isArray(warehouseMaster) ? warehouseMaster : [];
    (sourceWarehouses || []).forEach(function (source) {
      var country = SOURCE_COUNTRIES[source];
      if (!country) {
        errors.push("无法识别至速源仓「" + source + "」对应的国家，已阻止导入。");
        return;
      }
      var matches = warehouses.filter(function (w) {
        return !!w &&
          w.status === "active" &&
          normalizeText(w.country_name) === country &&
          normalizeText(w.name) === TARGET_WAREHOUSE_NAME;
      });
      if (matches.length !== 1) {
        errors.push(matches.length
          ? "PSI 仓库主数据中存在多个启用的「" + country + " / " + TARGET_WAREHOUSE_NAME + "」，已阻止导入。"
          : "未找到启用的「" + country + " / " + TARGET_WAREHOUSE_NAME + "」，已阻止导入。");
        return;
      }
      destinations[source] = matches[0];
    });
    return {
      destinations: destinations,
      errors: errors,
      ready: (sourceWarehouses || []).length > 0 && errors.length === 0 &&
        (sourceWarehouses || []).every(function (source) { return !!destinations[source]; })
    };
  }

  function duplicateGroups(records) {
    var groups = new Map();
    (records || []).forEach(function (record) {
      if (!record || !record.sku_code || !record.country || !record.warehouse) return;
      var key = [record.sku_code, record.country, record.warehouse].join("\u0000");
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(record);
    });
    var out = [];
    groups.forEach(function (items) {
      if (items.length > 1) {
        out.push({
          sku_code: items[0].sku_code,
          country: items[0].country,
          warehouse: items[0].warehouse,
          items: items
        });
      }
    });
    return out;
  }

  function buildZhisuRecords(rawRecords, destinations, mergeDuplicates) {
    var mapped = (rawRecords || []).map(function (raw) {
      var record = Object.assign({}, raw);
      record._errors = (raw._baseErrors || raw._errors || []).slice();
      var target = destinations ? destinations[raw._sourceWarehouse] : null;
      if (target && target.status === "active") {
        record.country = normalizeText(target.country_name);
        record.warehouse = normalizeText(target.name);
        if (!record.country || !record.warehouse) record._errors.push("PSI 目标仓库缺少国家或仓库名称");
      } else {
        record.country = "";
        record.warehouse = "";
        record._errors.push("至速源仓「" + (raw._sourceWarehouse || "(空)") + "」无法映射到 PSI 目标仓库");
      }
      record.remark = "至速源仓：" + (raw._sourceWarehouse || "(空)") + "；原始行：" + (raw._sourceRows || [raw._rowNum]).join(", ");
      return record;
    });

    var duplicates = duplicateGroups(mapped);
    if (!duplicates.length) {
      return {
        records: mapped,
        duplicateGroups: [],
        mappingReady: (rawRecords || []).length > 0 && mapped.every(function (r) { return !!r.country && !!r.warehouse; })
      };
    }

    if (!mergeDuplicates) {
      duplicates.forEach(function (group) {
        var detail = group.items.map(function (r) { return "第 " + r._rowNum + " 行（" + r._sourceWarehouse + "：" + r.available_qty + "）"; }).join("、");
        group.items.forEach(function (r) {
          r._errors.push("同一 SKU 在同一国家 / 仓库重复（" + detail + "）；请核对后勾选合并数量");
        });
      });
      return {
        records: mapped,
        duplicateGroups: duplicates,
        mappingReady: (rawRecords || []).length > 0 && mapped.every(function (r) { return !!r.country && !!r.warehouse; })
      };
    }

    var duplicateKeySet = new Set();
    duplicates.forEach(function (group) {
      duplicateKeySet.add([group.sku_code, group.country, group.warehouse].join("\u0000"));
    });
    var emitted = new Set();
    var merged = [];
    mapped.forEach(function (record) {
      var key = [record.sku_code, record.country, record.warehouse].join("\u0000");
      if (!duplicateKeySet.has(key)) {
        merged.push(record);
        return;
      }
      if (emitted.has(key)) return;
      emitted.add(key);
      var group = duplicates.find(function (g) {
        return [g.sku_code, g.country, g.warehouse].join("\u0000") === key;
      });
      var canMerge = group.items.every(function (r) {
        return (!r._errors || r._errors.length === 0) &&
          Number.isInteger(Number(r.available_qty)) &&
          Number(r.available_qty) >= 0;
      });
      if (!canMerge) {
        group.items.forEach(function (r) {
          r._errors.push("重复 SKU 含有格式或仓库错误，无法安全合并");
          merged.push(r);
        });
        return;
      }
      var first = Object.assign({}, group.items[0]);
      first.available_qty = group.items.reduce(function (sum, r) { return sum + Number(r.available_qty); }, 0);
      first._sourceRows = group.items.reduce(function (all, r) {
        return all.concat(r._sourceRows || [r._rowNum]);
      }, []);
      first._sourceWarehouse = group.items.map(function (r) { return r._sourceWarehouse; }).filter(Boolean).join(" / ");
      first._errors = [];
      first.remark = "至速重复 SKU 合并；源仓：" + first._sourceWarehouse + "；原始行：" + first._sourceRows.join(", ");
      merged.push(first);
    });
    return {
      records: merged,
      duplicateGroups: duplicates,
      mappingReady: (rawRecords || []).length > 0 && mapped.every(function (r) { return !!r.country && !!r.warehouse; })
    };
  }

  function normalizeWacCountry(value) {
    var text = normalizeText(value).toLowerCase();
    if (/(?:malaysia|马来西亚|马来)/i.test(text) || /(^|[\\s/_-])my($|[\\s/_-])/i.test(text)) return "马来西亚";
    if (/(?:thailand|泰国)/i.test(text) || /(^|[\\s/_-])th($|[\\s/_-])/i.test(text)) return "泰国";
    if (/(?:indonesia|印尼|印度尼西亚)/i.test(text) || /(^|[\\s/_-])id($|[\\s/_-])/i.test(text)) return "印尼";
    return "";
  }

  // Derive WAC pre-inbound stock from the latest Zhisu available-stock export.
  // Business rule: old_qty = max(current available_qty - this CI batch_qty, 0).
  // A SKU absent from a complete country warehouse snapshot is treated as zero current stock.
  function deriveWacOriginalStock(parsed, batchItems, targetCountry) {
    if (!parsed || !Array.isArray(parsed.records)) return { recognized: false };
    var country = normalizeWacCountry(targetCountry);
    if (!country) {
      return { recognized: true, countryUnresolved: true, filled: [], matched: [], unresolved: (batchItems || []).map(function (it) { return normalizeText(it && it.sku_code); }).filter(Boolean), clampedSkus: [] };
    }
    if (country !== "马来西亚" && country !== "泰国") {
      return { recognized: true, countryUnsupported: true, targetCountry: country, filled: [], matched: [], unresolved: (batchItems || []).map(function (it) { return normalizeText(it && it.sku_code); }).filter(Boolean), clampedSkus: [] };
    }
    var sourceWarehouse = country === "马来西亚" ? "吉隆坡一号仓" : "泰国一号仓";
    var sourceWarehouses = (parsed.sourceWarehouses || []).map(normalizeText).filter(Boolean);
    var knownSourceCountries = sourceWarehouses.map(function (name) { return SOURCE_COUNTRIES[name] || ""; }).filter(Boolean);
    if (sourceWarehouses.indexOf(sourceWarehouse) < 0) {
      var knownOther = knownSourceCountries.some(function (name) { return name !== country; });
      var unresolvedRows = (batchItems || []).map(function (it) { return normalizeText(it && it.sku_code); }).filter(Boolean);
      return {
        recognized: true,
        targetCountry: country,
        sourceWarehouses: sourceWarehouses,
        sourceWarehouse: "",
        expectedSourceWarehouse: sourceWarehouse,
        countryMismatch: knownOther,
        sourceWarehouseUnresolved: !knownOther,
        filled: [],
        matched: [],
        unresolved: unresolvedRows,
        clampedSkus: []
      };
    }

    var rowsBySku = Object.create(null);
    (parsed.records || []).forEach(function (record) {
      if (!record || normalizeText(record._sourceWarehouse) !== sourceWarehouse) return;
      var sku = normalizeText(record.sku_code).toUpperCase();
      if (!sku) return;
      if (!rowsBySku[sku]) rowsBySku[sku] = [];
      rowsBySku[sku].push(record);
    });

    var filled = [];
    var matched = [];
    var unresolved = [];
    var duplicate = [];
    var invalid = [];
    var clampedSkus = [];
    (batchItems || []).forEach(function (item) {
      var sku = normalizeText(item && item.sku_code).toUpperCase();
      var batchQty = Number(item && item.batch_qty);
      if (!sku || !Number.isFinite(batchQty) || !Number.isInteger(batchQty) || batchQty < 0) {
        if (sku) { invalid.push(sku); unresolved.push(sku); }
        return;
      }
      var entries = rowsBySku[sku] || [];
      if (entries.length > 1) {
        duplicate.push(sku);
        unresolved.push(sku);
        return;
      }
      var currentQty = 0;
      if (entries.length === 1) {
        var record = entries[0];
        var errors = Array.isArray(record._errors) ? record._errors : [];
        var parsedQty = Number(record.available_qty);
        if (errors.length || !Number.isFinite(parsedQty) || !Number.isInteger(parsedQty) || parsedQty < 0) {
          invalid.push(sku);
          unresolved.push(sku);
          return;
        }
        currentQty = parsedQty;
      }
      var oldQty = Math.max(currentQty - batchQty, 0);
      var clamped = currentQty < batchQty;
      if (clamped) clampedSkus.push(sku);
      filled.push({
        sku_code: sku,
        current_qty: currentQty,
        batch_qty: batchQty,
        old_qty: oldQty,
        clamped_to_zero: clamped,
        missing_from_snapshot: entries.length === 0
      });
      matched.push(sku);
    });

    return {
      recognized: true,
      targetCountry: country,
      sourceWarehouse: sourceWarehouse,
      snapshotDate: parsed.snapshotDate || "",
      sourceRows: (parsed.records || []).filter(function (record) {
        return normalizeText(record && record._sourceWarehouse) === sourceWarehouse;
      }).length,
      filled: filled,
      matched: matched,
      unresolved: unresolved.filter(function (sku, index, all) { return all.indexOf(sku) === index; }),
      duplicate: duplicate.filter(function (sku, index, all) { return all.indexOf(sku) === index; }),
      invalid: invalid.filter(function (sku, index, all) { return all.indexOf(sku) === index; }),
      clampedSkus: clampedSkus.filter(function (sku, index, all) { return all.indexOf(sku) === index; }),
      missingSnapshotSkus: filled.filter(function (row) { return row.missing_from_snapshot; }).map(function (row) { return row.sku_code; })
    };
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[ch];
    });
  }
  function tr(win, key, fallback, vars) {
    return win && typeof win.t === "function" ? win.t(key, fallback, vars) : fallback;
  }
  function installTranslations(win) {
    var dict = win.I18N && win.I18N.dict;
    if (!dict) return;
    var en = {
      "inv.zhisu.detected": "Zhisu stock export detected: sheet “{sheet}” will be read.",
      "inv.zhisu.summary": "{total} source rows; {valid} rows ready for import; {excluded} Fake Order rows excluded.",
      "inv.zhisu.source_warehouse": "Zhisu source warehouse",
      "inv.zhisu.destination": "PSI destination",
      "inv.zhisu.import_note": "SKU is read from 规格名称; quantity is read from 可用库存数. Brand comes from the PSI SKU master. Other stock, sales and cost fields are ignored.",
      "inv.zhisu.mapping_error": "The source warehouse or its active PSI destination could not be resolved. Import is blocked.",
      "inv.zhisu.duplicate_title": "Duplicate SKU rows found in the same country / warehouse",
      "inv.zhisu.duplicate_hint": "Import is blocked by default. Check the source rows, then explicitly confirm that their available quantities should be added together.",
      "inv.zhisu.merge_duplicates": "I confirm: sum available quantities for duplicate SKUs in the same country / warehouse",
      "inv.zhisu.excluded_title": "Automatically excluded Fake Order rows",
      "inv.zhisu.excluded_reason": "Fake Order is not a real inventory SKU and will not be imported.",
      "inv.zhisu.warehouse_load_failed": "Could not load PSI warehouse master data. Import is blocked for safety.",
      "inv.zhisu.file_parse_failed": "Could not read this Zhisu stock file: {message}",
      "wac.zhisu.title": "Zhisu current inventory recognized",
      "wac.zhisu.desc": "Original stock = max(current available stock − CI inbound quantity, 0). A SKU absent from this country warehouse export is treated as zero current stock.",
      "wac.zhisu.summary": "Warehouse: {warehouse} · Snapshot: {snapshot} · Auto-filled: {matched} SKUs",
      "wac.zhisu.clamped": "{count} SKU(s) had current stock below this CI quantity; original stock was set to 0: {skus}",
      "wac.zhisu.unresolved": "Could not auto-fill {count} SKU(s) because their source rows are duplicated or invalid. Enter those quantities manually or use the template: {skus}",
      "wac.zhisu.country_mismatch": "The CI country does not match the Zhisu warehouse in this file. Malaysia uses 吉隆坡一号仓; Thailand uses 泰国一号仓.",
      "wac.zhisu.country_unsupported": "Zhisu stock derivation is supported only for Malaysia and Thailand.",
      "wac.zhisu.country_unresolved": "The CI target country could not be identified. Automatic calculation was blocked.",
      "wac.zhisu.source_unresolved": "The source warehouse in this file could not be matched to the CI country.",
      "wac.zhisu.success": "Zhisu stock recognized. Original quantities derived for {count} SKUs.",
      "wac.zhisu.partial": "Zhisu stock recognized. {matched} SKU(s) were derived; {missing} need manual review.",
      "wac.old_qty_hint": "For Indonesia, import BigSeller inventory-change history. For Malaysia/Thailand, import the current Zhisu stock export to derive original stock as max(current stock − CI inbound quantity, 0). You can also use the manual template."
    };
    var id = {
      "inv.zhisu.detected": "Ekspor stok Zhisu terdeteksi: sheet “{sheet}” akan dibaca.",
      "inv.zhisu.summary": "{total} baris sumber; {valid} baris siap diimpor; {excluded} baris Fake Order dikecualikan.",
      "inv.zhisu.source_warehouse": "Gudang sumber Zhisu",
      "inv.zhisu.destination": "Gudang tujuan PSI",
      "inv.zhisu.import_note": "SKU dibaca dari 规格名称; kuantitas dibaca dari 可用库存数. Merek diambil dari master SKU PSI. Kolom stok, penjualan, dan biaya lainnya diabaikan.",
      "inv.zhisu.mapping_error": "Gudang sumber atau tujuan PSI aktif tidak dapat ditentukan. Impor diblokir.",
      "inv.zhisu.duplicate_title": "SKU duplikat ditemukan di negara / gudang yang sama",
      "inv.zhisu.duplicate_hint": "Impor diblokir secara default. Periksa baris sumber, lalu konfirmasikan secara eksplisit jika kuantitas tersedia harus dijumlahkan.",
      "inv.zhisu.merge_duplicates": "Saya konfirmasi: jumlahkan kuantitas tersedia untuk SKU duplikat di negara / gudang yang sama",
      "inv.zhisu.excluded_title": "Baris Fake Order otomatis dikecualikan",
      "inv.zhisu.excluded_reason": "Fake Order bukan SKU persediaan nyata dan tidak akan diimpor.",
      "inv.zhisu.warehouse_load_failed": "Data master gudang PSI gagal dimuat. Impor diblokir demi keamanan.",
      "inv.zhisu.file_parse_failed": "Gagal membaca file stok Zhisu ini: {message}",
      "wac.zhisu.title": "Stok saat ini dari gudang Zhisu terdeteksi",
      "wac.zhisu.desc": "Stok awal = max(stok tersedia saat ini − jumlah masuk CI, 0). SKU yang tidak ada di ekspor gudang negara ini dianggap memiliki stok saat ini nol.",
      "wac.zhisu.summary": "Gudang: {warehouse} · Snapshot: {snapshot} · Terisi otomatis: {matched} SKU",
      "wac.zhisu.clamped": "{count} SKU memiliki stok saat ini di bawah jumlah CI; stok awal ditetapkan 0: {skus}",
      "wac.zhisu.unresolved": "{count} SKU tidak dapat diisi otomatis karena baris sumber duplikat atau tidak valid. Isi manual atau gunakan template: {skus}",
      "wac.zhisu.country_mismatch": "Negara CI tidak cocok dengan gudang Zhisu di file ini. Malaysia menggunakan 吉隆坡一号仓; Thailand menggunakan 泰国一号仓.",
      "wac.zhisu.country_unsupported": "Perhitungan stok Zhisu hanya didukung untuk Malaysia dan Thailand.",
      "wac.zhisu.country_unresolved": "Negara tujuan CI tidak dapat dikenali. Perhitungan otomatis diblokir.",
      "wac.zhisu.source_unresolved": "Gudang sumber dalam file tidak dapat dicocokkan dengan negara CI.",
      "wac.zhisu.success": "Stok Zhisu dikenali. Stok awal berhasil dihitung untuk {count} SKU.",
      "wac.zhisu.partial": "Stok Zhisu dikenali. {matched} SKU berhasil dihitung; {missing} perlu diperiksa manual.",
      "wac.old_qty_hint": "Untuk Indonesia, impor riwayat perubahan stok BigSeller. Untuk Malaysia/Thailand, impor ekspor stok Zhisu saat ini untuk menghitung stok awal = max(stok saat ini − jumlah masuk CI, 0). Template manual juga tetap tersedia."
    };
    Object.keys(en).forEach(function (key) { dict.en[key] = en[key]; });
    Object.keys(id).forEach(function (key) { dict.id[key] = id[key]; });
  }

  function ensurePanel(win) {
    var panel = win.document.getElementById("inv-zhisu-import-summary");
    if (panel) return panel;
    var status = win.document.getElementById("inv-status");
    var drop = win.document.getElementById("inv-drop-zone");
    if (!status || !drop || !drop.parentNode) return null;
    panel = win.document.createElement("div");
    panel.id = "inv-zhisu-import-summary";
    panel.style.marginTop = "12px";
    drop.parentNode.insertBefore(panel, status);
    return panel;
  }

  function renderPanel(win, built) {
    var panel = ensurePanel(win);
    if (!panel) return;
    var state = win._invZhisuState || {};
    var sourceWarehouses = state.sourceWarehouses || [];
    var counts = state.sourceWarehouseCounts || {};
    var destinations = state.destinations || {};
    var errors = state.mappingErrors || [];
    var rawRecords = state.rawRecords || [];
    var excludedRows = state.excludedRows || [];
    var validCount = rawRecords.length;
    var totalRows = Number(state.totalRows || (validCount + excludedRows.length));
    var html = "<div style=\"padding:12px 14px;border:1px solid #d6e4ff;background:#f5f8ff;border-radius:10px;font-size:12px;color:#333\">";
    html += "<div style=\"font-weight:650;font-size:13px;margin-bottom:5px\">" +
      escapeHtml(tr(win, "inv.zhisu.detected", "已识别至速库存导出：读取工作表「{sheet}」。", { sheet: state.sheetName || "" })) + "</div>";
    html += "<div style=\"color:#666;margin-bottom:8px\">" +
      escapeHtml(tr(win, "inv.zhisu.summary", "共 {total} 条原始记录；有效导入 {valid} 条；自动排除 {excluded} 条 Fake Order。", {
        total: totalRows, valid: validCount, excluded: excludedRows.length
      })) + "</div>";
    html += "<div style=\"color:#666;margin-bottom:10px\">" +
      escapeHtml(tr(win, "inv.zhisu.import_note", "SKU 读取「规格名称」，数量读取「可用库存数」，品牌从 PSI SKU 主数据匹配；其他库存、销量和成本字段不导入。")) + "</div>";

    html += "<div class=\"table-container\" style=\"max-height:160px;overflow:auto;box-shadow:none;border:1px solid #e5e7eb;background:#fff\"><table class=\"data-table\"><thead><tr>" +
      "<th>" + escapeHtml(tr(win, "inv.zhisu.source_warehouse", "至速源仓")) + "</th><th>原始行数</th><th>" +
      escapeHtml(tr(win, "inv.zhisu.destination", "PSI 目标仓库")) + "</th></tr></thead><tbody>";
    sourceWarehouses.forEach(function (source) {
      var target = destinations[source];
      var targetLabel = target ? (normalizeText(target.country_name) + " / " + normalizeText(target.name)) : "—";
      html += "<tr><td>" + escapeHtml(source) + "</td><td>" + Number(counts[source] || 0) + "</td><td>" + escapeHtml(targetLabel) + "</td></tr>";
    });
    html += "</tbody></table></div>";

    if (errors.length) {
      html += "<div style=\"margin-top:10px;padding:9px 11px;background:#fff1f0;border:1px solid #ffa39e;border-radius:8px;color:#a8071a\">" +
        "<b>" + escapeHtml(tr(win, "inv.zhisu.mapping_error", "源仓库或 PSI 目标仓库无法唯一匹配，已阻止导入。")) + "</b><ul style=\"margin:6px 0 0 18px\">" +
        errors.map(function (error) { return "<li>" + escapeHtml(error) + "</li>"; }).join("") + "</ul></div>";
    }

    if (built && built.duplicateGroups && built.duplicateGroups.length) {
      html += "<div style=\"margin-top:10px;padding:10px 12px;background:#fff7e6;border:1px solid #ffd591;border-radius:8px\">" +
        "<div style=\"font-weight:650;color:#ad6800;margin-bottom:4px\">" +
        escapeHtml(tr(win, "inv.zhisu.duplicate_title", "发现同一国家 / 仓库下的重复 SKU")) + "（" + built.duplicateGroups.length + "）</div>" +
        "<div style=\"color:#805b16;margin-bottom:8px\">" +
        escapeHtml(tr(win, "inv.zhisu.duplicate_hint", "默认阻止导入。请核对源行，确认后再勾选合并数量。")) + "</div>";
      built.duplicateGroups.forEach(function (group) {
        var details = group.items.map(function (record) {
          return "第 " + record._rowNum + " 行 " + record._sourceWarehouse + "：" + record.available_qty;
        }).join("；");
        html += "<div style=\"padding:5px 0;border-top:1px solid rgba(173,104,0,.12)\"><b>" +
          escapeHtml(group.sku_code) + "</b> · " + escapeHtml(group.country + " / " + group.warehouse) +
          "<div style=\"color:#805b16\">" + escapeHtml(details) + "</div></div>";
      });
      html += "<label style=\"display:flex;gap:8px;align-items:flex-start;margin-top:8px;color:#805b16\">" +
        "<input type=\"checkbox\" id=\"inv-zhisu-merge-duplicates\" " + (win._invZhisuMergeDuplicates ? "checked" : "") +
        " style=\"margin-top:2px\">" +
        escapeHtml(tr(win, "inv.zhisu.merge_duplicates", "我确认将同一国家 / 仓库下重复 SKU 的可用库存数量相加")) +
        "</label></div>";
    }

    if (excludedRows.length) {
      html += "<div style=\"margin-top:10px;padding:10px 12px;background:#fafafa;border:1px solid #e5e7eb;border-radius:8px\">" +
        "<div style=\"font-weight:650;margin-bottom:4px\">" +
        escapeHtml(tr(win, "inv.zhisu.excluded_title", "自动排除的 Fake Order 记录")) + "（" + excludedRows.length + "）</div>" +
        "<div style=\"color:#666;margin-bottom:6px\">" +
        escapeHtml(tr(win, "inv.zhisu.excluded_reason", "Fake Order 不属于真实库存 SKU，不会导入。")) + "</div>";
      excludedRows.forEach(function (row) {
        html += "<div style=\"color:#666;padding:3px 0\">第 " + Number(row.rowNum) + " 行 · " +
          escapeHtml(row.sourceWarehouse || "未知仓库") + " · FO · 可用库存数 " + escapeHtml(row.available_qty) + "</div>";
      });
      html += "</div>";
    }
    html += "</div>";
    panel.innerHTML = html;

    var mergeBox = panel.querySelector("#inv-zhisu-merge-duplicates");
    if (mergeBox) {
      mergeBox.addEventListener("change", function () {
        win._invZhisuMergeDuplicates = !!mergeBox.checked;
        applyZhisuRecords(win);
      });
    }
  }

  function applyZhisuRecords(win) {
    var state = win._invZhisuState || {};
    var built = buildZhisuRecords(state.rawRecords || [], state.destinations || {}, !!win._invZhisuMergeDuplicates);
    win._invZhisuDuplicateGroups = built.duplicateGroups;
    win._invZhisuMappingReady = !!state.mappingReady && built.mappingReady;
    win._invImportData = built.records;
    win._invPrecheck = null;
    win._invPassedFingerprint = null;
    win._invPrecheckError = false;
    win._invPrecheckSeq = (Number(win._invPrecheckSeq) || 0) + 1;

    renderPanel(win, built);
    if (typeof win.renderInvStatus === "function") win.renderInvStatus();
    if (typeof win.renderInvPreview === "function") win.renderInvPreview(win._invImportData);
    if (typeof win.updateInvImportBtnState === "function") win.updateInvImportBtnState();

    var hasLocalError = win._invImportData.some(function (record) {
      return record._errors && record._errors.length > 0;
    });
    if (win._invZhisuMappingReady && !hasLocalError && win._invImportData.length && typeof win.runInvPrecheck === "function") {
      win.runInvPrecheck();
    }
  }

  function resetAdapterState(win) {
    if (win._invImportSourceMode === "zhisu") win._invImportSourceMode = "template";
    win._invZhisuState = null;
    win._invZhisuRawRecords = [];
    win._invZhisuExcludedRows = [];
    win._invZhisuMergeDuplicates = false;
    win._invZhisuDuplicateGroups = [];
    win._invZhisuMappingReady = false;
    var panel = win.document && win.document.getElementById("inv-zhisu-import-summary");
    if (panel) panel.innerHTML = "";
  }

  function install(win) {
    if (!win || win.__zhisuInventoryImportInstalled) return;
    if (typeof win.handleInvFile !== "function" || typeof win.openInvBatchImport !== "function" || typeof win.runInvPrecheck !== "function") return;
    win.__zhisuInventoryImportInstalled = true;
    installTranslations(win);

    var originalHandleInvFile = win.handleInvFile;
    var originalOpenInvBatchImport = win.openInvBatchImport;
    var originalRunInvPrecheck = win.runInvPrecheck;

    function setInventoryFileProgress(message, percent, state) {
      var target = win.document && win.document.getElementById("inv-status");
      if (!target) return;
      var box = win.document.getElementById("inv-file-progress");
      if (!box) {
        box = win.document.createElement("div");
        box.id = "inv-file-progress";
        box.style.cssText = "margin:0 0 10px;padding:10px 13px;border:1px solid #dbeafe;background:#f8fbff;border-radius:9px";
        target.parentNode.insertBefore(box, target);
      }
      var color = state === "error" ? "#dc2626" : state === "blocked" ? "#d97706" : state === "done" ? "#15803d" : "#2563eb";
      var p = Math.max(0, Math.min(100, Number(percent) || 0));
      box.innerHTML = '<div style="display:flex;justify-content:space-between;gap:10px;margin-bottom:7px;font-size:12px">' +
        '<span style="font-weight:600;color:' + color + '">' + escapeHtml(message) + '</span>' +
        '<strong style="font-variant-numeric:tabular-nums">' + p + '%</strong></div>' +
        '<div role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + p + '" style="height:6px;overflow:hidden;background:#e5e7eb;border-radius:99px">' +
        '<div style="height:100%;width:' + p + '%;background:' + color + ';border-radius:99px;transition:width .25s ease"></div></div>';
    }

    win.openInvBatchImport = function () {
      resetAdapterState(win);
      var progress = win.document && win.document.getElementById("inv-file-progress");
      if (progress) progress.remove();
      return originalOpenInvBatchImport.apply(this, arguments);
    };

    win.runInvPrecheck = async function () {
      var isZhisu = win._invImportSourceMode === "zhisu";
      if (isZhisu) setInventoryFileProgress("正在校验 SKU 与品牌主数据…", 82);
      var result = await originalRunInvPrecheck.apply(this, arguments);
      if (win._invImportSourceMode === "zhisu") {
        var records = win._invImportData || [];
        var precheck = win._invPrecheck || {};
        var resolved = new Map((precheck.resolved_skus || []).map(function (row) {
          return [String(row.sku_code), String(row.brand == null ? "" : row.brand)];
        }));
        records.forEach(function (record) {
          var masterBrand = resolved.get(String(record.sku_code || "").trim());
          if (masterBrand !== undefined) record.brand = masterBrand;
        });
        if (precheck.ok === true && (!precheck.blocking || precheck.blocking.length === 0) && win.InvImportRules) {
          win._invPassedFingerprint = win.InvImportRules.computeInvImportFingerprint(records, win._invSnapshotDate || "");
        } else {
          win._invPassedFingerprint = null;
        }
        if (typeof win.renderInvPreview === "function") win.renderInvPreview(records);
        if (typeof win.renderInvStatus === "function") win.renderInvStatus();
        if (typeof win.updateInvImportBtnState === "function") win.updateInvImportBtnState();
        var passed = precheck.ok === true && (!precheck.blocking || precheck.blocking.length === 0);
        setInventoryFileProgress(passed ? "SKU / 品牌校验完成，可以开始导入。" : "SKU / 品牌校验未通过，请先处理异常。", 100, passed ? "done" : "blocked");
      }
      return result;
    };

    function handleZhisuFile(file) {
      var ext = String(file && file.name || "").split(".").pop().toLowerCase();
      if (ext !== "xls" && ext !== "xlsx") return Promise.resolve(false);
      return new Promise(function (resolve) {
        var reader = new win.FileReader();
        setInventoryFileProgress("正在读取至速仓库存文件…", 3);
        reader.onprogress = function (event) {
          var p = event && event.lengthComputable && event.total > 0 ? 5 + Math.round(event.loaded / event.total * 28) : 18;
          setInventoryFileProgress("正在读取至速仓库存文件…", p);
        };
        reader.onload = async function (event) {
          try {
            setInventoryFileProgress("文件读取完成，正在解析 Excel 与识别 SKU…", 40);
            await new Promise(function (resolvePaint) { setTimeout(resolvePaint, 0); });
            var workbook = win.XLSX.read(new Uint8Array(event.target.result), { type: "array", cellDates: true });
            var parsed = parseZhisuWorkbook(workbook, file.name, localDate(), win.XLSX);
            if (!parsed) {
              resetAdapterState(win);
              resolve(false);
              return;
            }

            setInventoryFileProgress("SKU 识别完成，正在匹配国家与目标仓库…", 62);
            win._invImportSourceMode = "zhisu";
            win._invZhisuMergeDuplicates = false;
            win._invZhisuRawRecords = parsed.records;
            win._invZhisuExcludedRows = parsed.excludedRows;
            win._invZhisuState = {
              sheetName: parsed.sheetName,
              rawRecords: parsed.records,
              excludedRows: parsed.excludedRows,
              totalRows: parsed.totalRows,
              sourceWarehouses: parsed.sourceWarehouses,
              sourceWarehouseCounts: parsed.sourceWarehouseCounts,
              destinations: Object.create(null),
              mappingErrors: [],
              mappingReady: false
            };
            win._invImportData = [];
            win._invPrecheck = null;
            win._invPassedFingerprint = null;
            win._invPrecheckError = false;
            win._invPrecheckSeq = (Number(win._invPrecheckSeq) || 0) + 1;

            if (parsed.snapshotDate && !win._invSnapshotDate) {
              win._invSnapshotDate = parsed.snapshotDate;
              var dateInput = win.document.getElementById("inv-snapshot-cutoff");
              if (dateInput) dateInput.value = parsed.snapshotDate;
            }

            try {
              var warehouseRows = await win.api("/api/warehouses");
              var mapping = resolveZhisuDestinations(parsed.sourceWarehouses, warehouseRows || []);
              win._invZhisuState.destinations = mapping.destinations;
              win._invZhisuState.mappingErrors = mapping.errors;
              win._invZhisuState.mappingReady = mapping.ready;
            } catch (warehouseError) {
              win._invZhisuState.mappingErrors = [tr(win, "inv.zhisu.warehouse_load_failed", "无法读取 PSI 仓库主数据，已阻止导入。")];
              win._invZhisuState.mappingReady = false;
              if (typeof win.showToast === "function") {
                win.showToast(tr(win, "inv.zhisu.warehouse_load_failed", "无法读取 PSI 仓库主数据，已阻止导入。"), "danger");
              }
            }
            applyZhisuRecords(win);
            if (!win._invZhisuMappingReady) setInventoryFileProgress("仓库映射未完成，请先处理映射问题。", 100, "blocked");
            else setInventoryFileProgress("数据识别完成，正在进行后台校验…", 78);
            resolve(true);
          } catch (error) {
            setInventoryFileProgress("至速仓库存文件解析失败。", 100, "error");
            resetAdapterState(win);
            if (typeof win.showToast === "function") {
              win.showToast(tr(win, "inv.zhisu.file_parse_failed", "至速库存文件解析失败：{message}", { message: error.message || "unknown error" }), "danger");
            }
            resolve(true);
          }
        };
        reader.onerror = function () {
          setInventoryFileProgress("至速仓库存文件读取失败，请重新上传。", 100, "error");
          resetAdapterState(win);
          if (typeof win.showToast === "function") {
            win.showToast(tr(win, "inv.zhisu.file_parse_failed", "至速库存文件读取失败：{message}", { message: "FileReader error" }), "danger");
          }
          resolve(true);
        };
        reader.readAsArrayBuffer(file);
      });
    }

    win.handleInvFile = function (file) {
      if (!file) return;
      var self = this;
      return handleZhisuFile(file).then(function (handled) {
        if (!handled) {
          resetAdapterState(win);
          return originalHandleInvFile.call(self, file);
        }
      });
    };
  }

  return {
    SKU_ALIASES: SKU_ALIASES,
    SOURCE_COUNTRIES: SOURCE_COUNTRIES,
    TARGET_WAREHOUSE_NAME: TARGET_WAREHOUSE_NAME,
    normalizeHeader: normalizeHeader,
    parseQuantity: parseQuantity,
    dateFromFilename: dateFromFilename,
    parseZhisuWorkbook: parseZhisuWorkbook,
    resolveZhisuDestinations: resolveZhisuDestinations,
    duplicateGroups: duplicateGroups,
    buildZhisuRecords: buildZhisuRecords,
    normalizeWacCountry: normalizeWacCountry,
    deriveWacOriginalStock: deriveWacOriginalStock,
    install: install
  };
});
