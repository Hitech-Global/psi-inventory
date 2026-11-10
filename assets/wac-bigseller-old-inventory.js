(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.WacBigSellerOldInventory = api;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this), function () {
  "use strict";

  function normalizeText(value) {
    return String(value == null ? "" : value).replace(/\s+/g, " ").trim();
  }
  function normalizeHeader(value) {
    return normalizeText(value).replace(/[\s\u3000]+/g, "").toLowerCase();
  }
  function normalizeSku(value) {
    return normalizeText(value).toUpperCase();
  }
  function normalizeCountry(value) {
    var text = normalizeText(value).toLowerCase();
    if (!text) return "";
    if (/(?:indonesia|印尼|印度尼西亚)/i.test(text) || /(^|[\s/_-])id($|[\s/_-])/i.test(text)) return "Indonesia";
    if (/(?:malaysia|马来西亚|马来)/i.test(text) || /(^|[\s/_-])my($|[\s/_-])/i.test(text)) return "Malaysia";
    if (/(?:thailand|泰国)/i.test(text) || /(^|[\s/_-])th($|[\s/_-])/i.test(text)) return "Thailand";
    return "";
  }
  function findColumn(headers, aliases) {
    var normalized = (headers || []).map(normalizeHeader);
    for (var i = 0; i < aliases.length; i++) {
      var index = normalized.indexOf(normalizeHeader(aliases[i]));
      if (index >= 0) return index;
    }
    return -1;
  }
  function parseInteger(value) {
    if (value === null || value === undefined || normalizeText(value) === "") return { valid: false, value: null };
    var text = String(value).replace(/,/g, "").replace(/\s+/g, "").trim();
    var number = Number(text);
    return { valid: Number.isFinite(number) && Number.isInteger(number), value: Number.isFinite(number) ? number : null };
  }
  function formatDateTime(date) {
    return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" +
      String(date.getDate()).padStart(2, "0") + " " + String(date.getHours()).padStart(2, "0") + ":" +
      String(date.getMinutes()).padStart(2, "0") + ":" + String(date.getSeconds()).padStart(2, "0");
  }
  function normalizeDateTime(value) {
    if (value instanceof Date && !isNaN(value.getTime())) return formatDateTime(value);
    if (typeof value === "number" && Number.isFinite(value) && value > 20000 && value < 80000) {
      var date = new Date(Date.UTC(1899, 11, 30) + value * 86400000);
      return date.getUTCFullYear() + "-" + String(date.getUTCMonth() + 1).padStart(2, "0") + "-" +
        String(date.getUTCDate()).padStart(2, "0") + " " + String(date.getUTCHours()).padStart(2, "0") + ":" +
        String(date.getUTCMinutes()).padStart(2, "0") + ":" + String(date.getUTCSeconds()).padStart(2, "0");
    }
    return normalizeText(value).replace("T", " ");
  }
  function isBlankRow(row) {
    return !row || !row.some(function (cell) { return normalizeText(cell) !== ""; });
  }
  function getSheetRows(workbook, sheetName, XLSX) {
    var sheet = workbook && workbook.Sheets ? workbook.Sheets[sheetName] : null;
    if (!sheet || !XLSX || !XLSX.utils || typeof XLSX.utils.sheet_to_json !== "function") return [];
    return XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: "",
      raw: false,
      dateNF: "yyyy-mm-dd hh:mm:ss"
    });
  }
  function isInboundType(value) {
    var type = normalizeText(value).toLowerCase();
    return (type.indexOf("入库") >= 0 || /\binbound\b/.test(type)) &&
      type.indexOf("出库") < 0 && !/\boutbound\b/.test(type);
  }
  function parseBigSellerWorkbook(workbook, XLSX) {
    if (!workbook || !Array.isArray(workbook.SheetNames) || !workbook.SheetNames.length || !XLSX || !XLSX.utils) return null;
    var detected = null;
    var required = {
      sku: ["SKU编号", "SKU编码", "SKU", "sku_code"],
      time: ["时间", "变更时间", "操作时间", "time"],
      oldQty: ["原库存", "变更前库存", "变更前数量", "old_qty"],
      delta: ["变动", "变动数量", "变化数量", "change_qty"],
      newQty: ["新库存", "变更后库存", "变更后数量", "new_qty"],
      type: ["类型", "变更类型", "type"],
      documentNo: ["单据号", "单据编号", "document_no"],
      warehouse: ["仓库", "仓库名称", "warehouse"]
    };

    for (var s = 0; s < workbook.SheetNames.length && !detected; s++) {
      var sheetName = workbook.SheetNames[s];
      var rows = getSheetRows(workbook, sheetName, XLSX);
      var scanLimit = Math.min(rows.length, 10);
      for (var h = 0; h < scanLimit; h++) {
        var headers = rows[h] || [];
        var indexes = {};
        Object.keys(required).forEach(function (key) {
          indexes[key] = findColumn(headers, required[key]);
        });
        if (Object.keys(indexes).every(function (key) { return indexes[key] >= 0; })) {
          detected = { sheetName: sheetName, rows: rows, headerRowIndex: h, indexes: indexes };
          break;
        }
      }
    }
    if (!detected) return null;

    var groupsByKey = Object.create(null);
    var inboundRows = 0;
    var invalidRows = 0;
    var totalRows = 0;
    var rows = detected.rows.slice(detected.headerRowIndex + 1);

    rows.forEach(function (row, offset) {
      if (isBlankRow(row)) return;
      totalRows++;
      var rowNumber = detected.headerRowIndex + offset + 2;
      var ix = detected.indexes;
      var type = normalizeText(row[ix.type]);
      if (!isInboundType(type)) return;

      var skuCode = normalizeText(row[ix.sku]);
      var time = normalizeDateTime(row[ix.time]);
      var documentNo = normalizeText(row[ix.documentNo]);
      var warehouse = normalizeText(row[ix.warehouse]);
      var oldParsed = parseInteger(row[ix.oldQty]);
      var deltaParsed = parseInteger(row[ix.delta]);
      var newParsed = parseInteger(row[ix.newQty]);

      if (!skuCode || !deltaParsed.valid || deltaParsed.value <= 0) {
        invalidRows++;
        return;
      }
      inboundRows++;
      var rowValid = oldParsed.valid && newParsed.valid &&
        oldParsed.value >= 0 && newParsed.value >= 0 &&
        oldParsed.value + deltaParsed.value === newParsed.value;
      if (!rowValid) invalidRows++;

      var groupKey;
      if (documentNo) groupKey = "doc|" + warehouse + "|" + documentNo + "|" + type;
      else if (time) groupKey = "time|" + warehouse + "|" + time + "|" + type;
      else groupKey = "row|" + rowNumber;

      if (!groupsByKey[groupKey]) {
        groupsByKey[groupKey] = {
          key: groupKey,
          documentNo: documentNo,
          warehouse: warehouse,
          type: type,
          times: [],
          rows: [],
          rowsBySku: Object.create(null),
          sourceSheet: detected.sheetName
        };
      }
      var group = groupsByKey[groupKey];
      if (time && group.times.indexOf(time) < 0) group.times.push(time);
      var record = {
        rowNumber: rowNumber,
        skuCode: skuCode,
        skuKey: normalizeSku(skuCode),
        time: time,
        oldQty: oldParsed.value,
        deltaQty: deltaParsed.value,
        newQty: newParsed.value,
        valid: rowValid
      };
      group.rows.push(record);
      if (!group.rowsBySku[record.skuKey]) group.rowsBySku[record.skuKey] = [];
      group.rowsBySku[record.skuKey].push(record);
    });

    var groups = Object.keys(groupsByKey).map(function (key) {
      var group = groupsByKey[key];
      group.times.sort();
      group.firstTime = group.times[0] || "";
      group.lastTime = group.times[group.times.length - 1] || "";
      group.displayTime = group.firstTime === group.lastTime
        ? group.firstTime
        : group.firstTime + " ~ " + group.lastTime;
      group.skuCount = Object.keys(group.rowsBySku).length;
      group.rowCount = group.rows.length;
      return group;
    });
    groups.sort(function (a, b) {
      return String(b.lastTime || "").localeCompare(String(a.lastTime || ""));
    });

    return {
      recognized: true,
      sourceSystem: "BigSeller",
      // BigSeller inventory-change history currently belongs to Indonesia/Bekasi only.
      // Thailand and Malaysia use Zishucang and must use their own history source.
      sourceCountry: "Indonesia",
      sheetName: detected.sheetName,
      headerRowIndex: detected.headerRowIndex,
      totalRows: totalRows,
      inboundRows: inboundRows,
      invalidRows: invalidRows,
      groups: groups
    };
  }

  function dateDistanceDays(timestamp, arrivalDate) {
    var eventDate = String(timestamp || "").slice(0, 10);
    var targetDate = String(arrivalDate || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate) || !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) return Number.MAX_SAFE_INTEGER;
    var a = Date.parse(eventDate + "T00:00:00Z");
    var b = Date.parse(targetDate + "T00:00:00Z");
    return Number.isFinite(a) && Number.isFinite(b) ? Math.round(Math.abs(a - b) / 86400000) : Number.MAX_SAFE_INTEGER;
  }
  function matchCandidates(parsed, batchItems, arrivalDate, targetCountry) {
    var batchMap = Object.create(null);
    (batchItems || []).forEach(function (item) {
      var skuKey = normalizeSku(item && item.sku_code);
      if (!skuKey || batchMap[skuKey]) return;
      var qty = Number(item && item.batch_qty);
      batchMap[skuKey] = {
        sku_code: normalizeText(item.sku_code),
        batch_qty: Number.isFinite(qty) && Number.isInteger(qty) && qty >= 0 ? qty : null
      };
    });
    var batchSkus = Object.keys(batchMap);
    var sourceCountry = normalizeCountry(parsed && parsed.sourceCountry);
    var requestedCountry = normalizeCountry(targetCountry);
    // Fail closed: do not match a source whose country differs from the CI target country.
    if (!sourceCountry || !requestedCountry || sourceCountry !== requestedCountry) {
      return {
        candidates: [],
        batchSkuCount: batchSkus.length,
        autoCandidateIndex: -1,
        sourceCountry: sourceCountry,
        targetCountry: requestedCountry,
        countryMismatch: !!(sourceCountry && requestedCountry && sourceCountry !== requestedCountry),
        countryUnresolved: !sourceCountry || !requestedCountry
      };
    }
    var candidates = (parsed && parsed.groups ? parsed.groups : []).map(function (group) {
      var matched = [];
      var missing = [];
      var mismatch = [];
      var invalid = [];
      var duplicate = [];
      batchSkus.forEach(function (skuKey) {
        var expected = batchMap[skuKey];
        var entries = group.rowsBySku[skuKey] || [];
        if (!entries.length) {
          missing.push(expected.sku_code);
          return;
        }
        if (entries.length > 1) {
          duplicate.push(expected.sku_code);
          return;
        }
        var record = entries[0];
        if (!record.valid || expected.batch_qty === null) {
          invalid.push(expected.sku_code);
          return;
        }
        if (record.deltaQty !== expected.batch_qty) {
          mismatch.push(expected.sku_code);
          return;
        }
        matched.push(expected.sku_code);
      });
      var extra = Object.keys(group.rowsBySku).filter(function (skuKey) {
        return !Object.prototype.hasOwnProperty.call(batchMap, skuKey);
      }).map(function (skuKey) {
        return group.rowsBySku[skuKey][0].skuCode;
      });
      var candidate = Object.assign({}, group, {
        matchedSkuCount: matched.length,
        presentSkuCount: batchSkus.length - missing.length,
        exactQtyCount: matched.length,
        missingSkus: missing,
        mismatchSkus: mismatch,
        invalidSkus: invalid,
        duplicateSkus: duplicate,
        extraSkus: extra,
        batchSkuCount: batchSkus.length,
        dateDistanceDays: dateDistanceDays(group.firstTime, arrivalDate),
        exactMatch: batchSkus.length > 0 && matched.length === batchSkus.length &&
          missing.length === 0 && mismatch.length === 0 && invalid.length === 0 && duplicate.length === 0
      });
      return candidate;
    }).filter(function (candidate) {
      return candidate.matchedSkuCount > 0 || candidate.presentSkuCount > 0;
    });

    candidates.sort(function (a, b) {
      if (b.exactQtyCount !== a.exactQtyCount) return b.exactQtyCount - a.exactQtyCount;
      if (b.presentSkuCount !== a.presentSkuCount) return b.presentSkuCount - a.presentSkuCount;
      if (a.dateDistanceDays !== b.dateDistanceDays) return a.dateDistanceDays - b.dateDistanceDays;
      return String(b.lastTime || "").localeCompare(String(a.lastTime || ""));
    });
    var exactCandidates = candidates.filter(function (candidate) { return candidate.exactMatch; });
    return {
      candidates: candidates,
      batchSkuCount: batchSkus.length,
      autoCandidateIndex: exactCandidates.length === 1 ? candidates.indexOf(exactCandidates[0]) : -1,
      sourceCountry: sourceCountry,
      targetCountry: requestedCountry,
      countryMismatch: false,
      countryUnresolved: false
    };
  }

  function applyCandidate(candidate, batchItems) {
    var filled = [];
    var missing = [];
    var duplicate = [];
    var invalid = [];
    var seen = Object.create(null);
    (batchItems || []).forEach(function (item) {
      var skuCode = normalizeText(item && item.sku_code);
      var skuKey = normalizeSku(skuCode);
      if (!skuKey || seen[skuKey]) return;
      seen[skuKey] = true;
      var entries = candidate && candidate.rowsBySku ? (candidate.rowsBySku[skuKey] || []) : [];
      if (!entries.length) {
        missing.push(skuCode);
        return;
      }
      if (entries.length > 1) {
        duplicate.push(skuCode);
        return;
      }
      var record = entries[0];
      var expected = Number(item && item.batch_qty);
      if (!record.valid || !Number.isInteger(expected) || expected < 0 || record.deltaQty !== expected) {
        invalid.push(skuCode);
        return;
      }
      filled.push({ sku_code: skuCode, old_qty: record.oldQty, inbound_qty: record.deltaQty, new_qty: record.newQty });
    });
    return {
      filled: filled,
      matched: filled.map(function (item) { return item.sku_code; }),
      missing: missing,
      duplicate: duplicate,
      invalid: invalid
    };
  }

  return {
    normalizeHeader: normalizeHeader,
    parseInteger: parseInteger,
    normalizeDateTime: normalizeDateTime,
    normalizeCountry: normalizeCountry,
    parseBigSellerWorkbook: parseBigSellerWorkbook,
    matchCandidates: matchCandidates,
    applyCandidate: applyCandidate
  };
});
