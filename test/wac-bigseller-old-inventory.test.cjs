"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const BigSellerOld = require("../assets/wac-bigseller-old-inventory.js");

function fakeXlsx() {
  return { utils: { sheet_to_json: (sheet) => sheet.__rows || [] } };
}
function workbook(rows, sheetName) {
  const name = sheetName || "库存更新记录";
  return {
    SheetNames: [name],
    Sheets: { [name]: { __rows: rows, "!ref": "A1" } }
  };
}
const headers = ["SKU编号", "时间", "原库存", "变动", "新库存", "类型", "单据号", "仓库"];

test("recognizes BigSeller inventory history and groups inbound rows by document, warehouse and type", () => {
  const parsed = BigSellerOld.parseBigSellerWorkbook(workbook([
    headers,
    ["SKU-A", "2026-11-07 09:10", "10", "+ 100", "110", "入库 / 手动入库", "IN-001", "Redragon Warehouse"],
    ["SKU-B", "2026-11-07 09:10", "0", "+ 40", "40", "入库 / 手动入库", "IN-001", "Redragon Warehouse"],
    ["SKU-A", "2026-11-07 09:11", "110", "- 1", "109", "出库 / 销售出库", "ORDER-1", "Redragon Warehouse"],
    ["SKU-A", "2026-11-07 10:00", "109", "+ 20", "129", "入库 / 手动入库", "IN-002", "Redragon Warehouse"]
  ]), fakeXlsx());

  assert.ok(parsed);
  assert.equal(parsed.recognized, true);
  assert.equal(parsed.inboundRows, 3);
  assert.equal(parsed.groups.length, 2);
  assert.equal(parsed.groups[0].documentNo, "IN-002");
  assert.equal(parsed.groups[1].documentNo, "IN-001");
  assert.equal(parsed.groups[1].skuCount, 2);
  assert.equal(parsed.groups[1].rowsBySku["SKU-A"][0].oldQty, 10);
  assert.equal(parsed.groups[1].rowsBySku["SKU-A"][0].deltaQty, 100);
});

test("auto-selects the unique event whose inbound SKU quantities exactly match the current WAC batch", () => {
  const parsed = BigSellerOld.parseBigSellerWorkbook(workbook([
    headers,
    ["SKU-A", "2026-11-07 09:10", "10", "+ 100", "110", "入库 / 手动入库", "IN-001", "Redragon Warehouse"],
    ["SKU-B", "2026-11-07 09:10", "0", "+ 40", "40", "入库 / 手动入库", "IN-001", "Redragon Warehouse"],
    ["SKU-A", "2026-11-08 10:00", "110", "+ 20", "130", "入库 / 手动入库", "IN-002", "Redragon Warehouse"],
    ["SKU-B", "2026-11-08 10:00", "40", "+ 40", "80", "入库 / 手动入库", "IN-002", "Redragon Warehouse"]
  ]), fakeXlsx());
  const matched = BigSellerOld.matchCandidates(parsed, [
    { sku_code: "SKU-A", batch_qty: 100 },
    { sku_code: "SKU-B", batch_qty: 40 }
  ], "2026-11-07");

  assert.equal(matched.autoCandidateIndex, 0);
  assert.equal(matched.candidates[0].documentNo, "IN-001");
  assert.equal(matched.candidates[0].exactMatch, true);
  const applied = BigSellerOld.applyCandidate(matched.candidates[0], [
    { sku_code: "SKU-A", batch_qty: 100 },
    { sku_code: "SKU-B", batch_qty: 40 }
  ]);
  assert.deepEqual(applied.matched, ["SKU-A", "SKU-B"]);
  assert.deepEqual(applied.missing, []);
  assert.deepEqual(applied.invalid, []);
  assert.equal(applied.filled[0].old_qty, 10);
  assert.equal(applied.filled[1].old_qty, 0, "zero original inventory is valid");
});

test("does not auto-select when multiple inbound documents both exactly match", () => {
  const parsed = BigSellerOld.parseBigSellerWorkbook(workbook([
    headers,
    ["SKU-A", "2026-11-07 09:10", "10", "+ 100", "110", "入库 / 手动入库", "IN-001", "Redragon Warehouse"],
    ["SKU-B", "2026-11-07 09:10", "0", "+ 40", "40", "入库 / 手动入库", "IN-001", "Redragon Warehouse"],
    ["SKU-A", "2026-11-08 10:00", "110", "+ 100", "210", "入库 / 手动入库", "IN-002", "Redragon Warehouse"],
    ["SKU-B", "2026-11-08 10:00", "40", "+ 40", "80", "入库 / 手动入库", "IN-002", "Redragon Warehouse"]
  ]), fakeXlsx());
  const matched = BigSellerOld.matchCandidates(parsed, [
    { sku_code: "SKU-A", batch_qty: 100 },
    { sku_code: "SKU-B", batch_qty: 40 }
  ], "2026-11-07");
  assert.equal(matched.autoCandidateIndex, -1);
  assert.equal(matched.candidates.filter((candidate) => candidate.exactMatch).length, 2);
});

test("only fills exact quantity matches; missing and quantity-mismatched SKUs remain unresolved", () => {
  const parsed = BigSellerOld.parseBigSellerWorkbook(workbook([
    headers,
    ["SKU-A", "2026-11-07 09:10", "10", "+ 100", "110", "入库 / 手动入库", "IN-001", "Redragon Warehouse"],
    ["SKU-B", "2026-11-07 09:10", "5", "+ 30", "35", "入库 / 手动入库", "IN-001", "Redragon Warehouse"]
  ]), fakeXlsx());
  const matched = BigSellerOld.matchCandidates(parsed, [
    { sku_code: "SKU-A", batch_qty: 100 },
    { sku_code: "SKU-B", batch_qty: 40 },
    { sku_code: "SKU-C", batch_qty: 15 }
  ], "2026-11-07");
  const applied = BigSellerOld.applyCandidate(matched.candidates[0], [
    { sku_code: "SKU-A", batch_qty: 100 },
    { sku_code: "SKU-B", batch_qty: 40 },
    { sku_code: "SKU-C", batch_qty: 15 }
  ]);
  assert.deepEqual(applied.matched, ["SKU-A"]);
  assert.deepEqual(applied.missing, ["SKU-C"]);
  assert.deepEqual(applied.invalid, ["SKU-B"]);
  assert.equal(applied.filled.length, 1);
});

test("duplicate SKU rows in one inbound document are not auto-filled", () => {
  const parsed = BigSellerOld.parseBigSellerWorkbook(workbook([
    headers,
    ["SKU-A", "2026-11-07 09:10", "10", "+ 50", "60", "入库 / 手动入库", "IN-001", "Redragon Warehouse"],
    ["SKU-A", "2026-11-07 09:10", "60", "+ 50", "110", "入库 / 手动入库", "IN-001", "Redragon Warehouse"]
  ]), fakeXlsx());
  const matched = BigSellerOld.matchCandidates(parsed, [{ sku_code: "SKU-A", batch_qty: 100 }], "2026-11-07");
  assert.equal(matched.autoCandidateIndex, -1);
  const applied = BigSellerOld.applyCandidate(matched.candidates[0], [{ sku_code: "SKU-A", batch_qty: 100 }]);
  assert.deepEqual(applied.duplicate, ["SKU-A"]);
  assert.deepEqual(applied.filled, []);
});

test("invalid before/after arithmetic blocks the row from matching", () => {
  const parsed = BigSellerOld.parseBigSellerWorkbook(workbook([
    headers,
    ["SKU-A", "2026-11-07 09:10", "10", "+ 100", "111", "入库 / 手动入库", "IN-001", "Redragon Warehouse"]
  ]), fakeXlsx());
  const matched = BigSellerOld.matchCandidates(parsed, [{ sku_code: "SKU-A", batch_qty: 100 }], "2026-11-07");
  assert.equal(matched.autoCandidateIndex, -1);
  const applied = BigSellerOld.applyCandidate(matched.candidates[0], [{ sku_code: "SKU-A", batch_qty: 100 }]);
  assert.deepEqual(applied.invalid, ["SKU-A"]);
});

test("non-BigSeller workbook is not captured", () => {
  const parsed = BigSellerOld.parseBigSellerWorkbook(workbook([
    ["SKU", "原库存数量", "备注"],
    ["SKU-A", "10", ""]
  ]), fakeXlsx());
  assert.equal(parsed, null);
});
