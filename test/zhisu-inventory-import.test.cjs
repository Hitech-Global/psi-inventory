"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const Zhisu = require("../assets/zhisu-inventory-import.js");

function fakeXlsx() {
  return {
    utils: {
      sheet_to_json: (sheet) => sheet.__rows || []
    }
  };
}
function workbook(rows, sheetName) {
  const name = sheetName || "数据";
  return {
    SheetNames: [name],
    Sheets: { [name]: { __rows: rows, "!ref": "A1" } }
  };
}
const headers = ["主键", "仓库名称", "商品名称", "规格名称", "库存数", "占用库存数", "可用库存数"];

test("detects the Zhisu export and reads SKU from 规格名称 and quantity from 可用库存数", () => {
  const parsed = Zhisu.parseZhisuWorkbook(workbook([
    headers,
    ["1", "吉隆坡一号仓", "K686 black", "K686WB-RGB-PRO-BS", "10", "2", "8"],
    ["2", "泰国一号仓", "K686 red", "K686WB-RGB-PRO-RS", "15", "4", "11"],
    ["3", "泰国一号仓", "Fake Order", "FO", "178", "0", "472"],
    ["4", "吉隆坡一号仓", "M724", "RDM724B", "10", "2", "8"],
    ["5", "吉隆坡一号仓", "M724 duplicate", "RDM724B", "0", "0", "0"]
  ]), "仓库库存商品表.xls", "2026-11-05", fakeXlsx());

  assert.ok(parsed);
  assert.equal(parsed.sheetName, "数据");
  assert.equal(parsed.totalRows, 5);
  assert.equal(parsed.records.length, 4);
  assert.equal(parsed.excludedRows.length, 1);
  assert.equal(parsed.sourceWarehouseCounts["吉隆坡一号仓"], 3);
  assert.equal(parsed.sourceWarehouseCounts["泰国一号仓"], 2);

  assert.equal(parsed.records[0].sku_code, "RDK686WBRGBPROBS");
  assert.equal(parsed.records[0].available_qty, 8);
  assert.equal(parsed.records[1].sku_code, "RDK686WBRGBPRORS");
  assert.equal(parsed.records[1].available_qty, 11);
  assert.equal(parsed.records[2].available_qty, 8);
  assert.equal(parsed.records[3].available_qty, 0, "zero available stock must be retained");

  assert.equal(parsed.records[0].brand, "", "brand must be resolved from PSI SKU master, not guessed from export");
  assert.equal(parsed.records[0].weighted_avg_cost, "", "Zhisu cost fields must not overwrite PSI WAC");
  assert.equal(parsed.records[0].country, "");
  assert.equal(parsed.records[0].warehouse, "");
  assert.equal(parsed.excludedRows[0].sku_code, "FO");
  assert.equal(parsed.excludedRows[0].available_qty, 472);
  assert.match(parsed.excludedRows[0].reason, /Fake Order/);
});

test("supports the two explicitly approved K686 SKU aliases only", () => {
  assert.equal(Zhisu.SKU_ALIASES["K686WB-RGB-PRO-BS"], "RDK686WBRGBPROBS");
  assert.equal(Zhisu.SKU_ALIASES["K686WB-RGB-PRO-RS"], "RDK686WBRGBPRORS");
  const parsed = Zhisu.parseZhisuWorkbook(workbook([
    headers,
    ["1", "泰国一号仓", "unknown", "K686WB-RGB-PRO-XX", "1", "0", "1"]
  ]), "stock.xls", "2026-11-05", fakeXlsx());
  assert.equal(parsed.records[0].sku_code, "K686WB-RGB-PRO-XX");
});

test("resolves the exact active Malaysia and Thailand 至速仓 destinations", () => {
  const warehouses = [
    { id: "wh-my", country_name: "马来西亚", name: "至速仓", status: "active" },
    { id: "wh-th", country_name: "泰国", name: "至速仓", status: "active" },
    { id: "wh-my-old", country_name: "马来西亚", name: "至速仓", status: "inactive" },
    { id: "wh-my-other", country_name: "马来西亚", name: "Bekasi Warehouse", status: "active" }
  ];
  const result = Zhisu.resolveZhisuDestinations(["吉隆坡一号仓", "泰国一号仓"], warehouses);
  assert.equal(result.ready, true);
  assert.deepEqual(result.errors, []);
  assert.equal(result.destinations["吉隆坡一号仓"].id, "wh-my");
  assert.equal(result.destinations["泰国一号仓"].id, "wh-th");
});

test("unknown source warehouse fails closed", () => {
  const result = Zhisu.resolveZhisuDestinations(
    ["吉隆坡一号仓", "未知仓库"],
    [
      { id: "wh-my", country_name: "马来西亚", name: "至速仓", status: "active" },
      { id: "wh-th", country_name: "泰国", name: "至速仓", status: "active" }
    ]
  );
  assert.equal(result.ready, false);
  assert.equal(result.destinations["未知仓库"], undefined);
  assert.ok(result.errors.some((error) => error.includes("未知仓库")));
});

test("missing or ambiguous target warehouse fails closed", () => {
  const missing = Zhisu.resolveZhisuDestinations(
    ["吉隆坡一号仓"],
    [{ id: "wh-th", country_name: "泰国", name: "至速仓", status: "active" }]
  );
  assert.equal(missing.ready, false);
  assert.ok(missing.errors[0].includes("马来西亚 / 至速仓"));

  const ambiguous = Zhisu.resolveZhisuDestinations(
    ["吉隆坡一号仓"],
    [
      { id: "wh-my-1", country_name: "马来西亚", name: "至速仓", status: "active" },
      { id: "wh-my-2", country_name: "马来西亚", name: " 至速仓 ", status: "active" }
    ]
  );
  assert.equal(ambiguous.ready, false);
  assert.ok(ambiguous.errors[0].includes("多个"));
});

test("duplicate SKU rows in one country and warehouse are blocked by default", () => {
  const destinations = {
    "吉隆坡一号仓": { id: "wh-my", country_name: "马来西亚", name: "至速仓", status: "active" },
    "泰国一号仓": { id: "wh-th", country_name: "泰国", name: "至速仓", status: "active" }
  };
  const raw = [
    { sku_code: "RDBM4051", available_qty: 54, _sourceWarehouse: "吉隆坡一号仓", _rowNum: 2, _sourceRows: [2], _baseErrors: [] },
    { sku_code: "RDBM4051", available_qty: 0, _sourceWarehouse: "吉隆坡一号仓", _rowNum: 3, _sourceRows: [3], _baseErrors: [] },
    { sku_code: "RDBM4051", available_qty: 7, _sourceWarehouse: "泰国一号仓", _rowNum: 4, _sourceRows: [4], _baseErrors: [] }
  ];
  const built = Zhisu.buildZhisuRecords(raw, destinations, false);
  assert.equal(built.duplicateGroups.length, 1);
  assert.equal(built.duplicateGroups[0].country, "马来西亚");
  assert.ok(built.records[0]._errors.some((error) => error.includes("重复")));
  assert.ok(built.records[1]._errors.some((error) => error.includes("重复")));
  assert.equal(built.records[2]._errors.length, 0, "same SKU in Thailand is a separate inventory key");
});

test("duplicate quantities are summed only after explicit confirmation", () => {
  const destinations = {
    "吉隆坡一号仓": { id: "wh-my", country_name: "马来西亚", name: "至速仓", status: "active" },
    "泰国一号仓": { id: "wh-th", country_name: "泰国", name: "至速仓", status: "active" }
  };
  const raw = [
    { sku_code: "RDBM2995", available_qty: 41, _sourceWarehouse: "吉隆坡一号仓", _rowNum: 2, _sourceRows: [2], _baseErrors: [] },
    { sku_code: "RDBM2995", available_qty: 0, _sourceWarehouse: "吉隆坡一号仓", _rowNum: 3, _sourceRows: [3], _baseErrors: [] },
    { sku_code: "RDBM2995", available_qty: 9, _sourceWarehouse: "泰国一号仓", _rowNum: 4, _sourceRows: [4], _baseErrors: [] }
  ];
  const built = Zhisu.buildZhisuRecords(raw, destinations, true);
  assert.equal(built.duplicateGroups.length, 1);
  assert.equal(built.records.length, 2);
  const malaysia = built.records.find((row) => row.country === "马来西亚");
  const thailand = built.records.find((row) => row.country === "泰国");
  assert.equal(malaysia.available_qty, 41);
  assert.deepEqual(malaysia._sourceRows, [2, 3]);
  assert.match(malaysia.remark, /至速重复 SKU 合并/);
  assert.equal(malaysia._errors.length, 0);
  assert.equal(thailand.available_qty, 9);
});

test("invalid quantities are retained for preview but marked as blocking errors", () => {
  const parsed = Zhisu.parseZhisuWorkbook(workbook([
    headers,
    ["1", "吉隆坡一号仓", "invalid decimal", "RDBM4051", "10", "0", "1.5"],
    ["2", "吉隆坡一号仓", "negative", "RDBM4051", "10", "0", "-2"]
  ]), "stock.xls", "2026-11-05", fakeXlsx());
  assert.equal(parsed.records[0].available_qty, 1.5);
  assert.equal(parsed.records[1].available_qty, -2);
  assert.ok(parsed.records.every((row) => row._errors.some((error) => error.includes("非负整数"))));
});

test("non-Zhisu workbook is not captured by this adapter", () => {
  const parsed = Zhisu.parseZhisuWorkbook(workbook([
    ["SKU编号", "整仓可用", "仓库"],
    ["SKU-A", "10", "Netac Warehouse"]
  ], "单个SKU"), "bigseller.xlsx", "2026-11-05", fakeXlsx());
  assert.equal(parsed, null);
});

test("date parser accepts valid filename snapshot dates and rejects invalid dates", () => {
  assert.equal(Zhisu.dateFromFilename("stock_20261105_123456.xls"), "2026-11-05");
  assert.equal(Zhisu.dateFromFilename("stock_2026-11-05.xls"), "2026-11-05");
  assert.equal(Zhisu.dateFromFilename("stock_20261340.xls"), "");
});


test("derives WAC original stock from Thailand Zhisu post-inbound available stock and this batch quantity", () => {
  const parsed = Zhisu.parseZhisuWorkbook(workbook([
    headers,
    ["1", "泰国一号仓", "M724", "RDM724B", "150", "0", "150"],
    ["2", "泰国一号仓", "new SKU", "RDM916AKPRO", "40", "0", "40"],
    ["3", "吉隆坡一号仓", "same SKU in Malaysia", "RDM724B", "999", "0", "999"],
    ["4", "泰国一号仓", "unrelated SKU", "OTHER-SKU", "77", "0", "77"]
  ]), "zhisu_stock_20261110.xls", "2026-11-10", fakeXlsx());

  const result = Zhisu.deriveWacOldQtyFromZhisu(parsed, {
    country: "泰国",
    warehouse: "至速仓",
    actualArrivalDate: "2026-11-07",
    items: [
      { sku_code: "RDM724B", batch_qty: 40 },
      { sku_code: "RDM916AKPRO", batch_qty: 40 }
    ]
  });

  assert.equal(result.ready, true);
  assert.equal(result.sourceWarehouse, "泰国一号仓");
  assert.equal(result.snapshotDate, "2026-11-10");
  assert.deepEqual(result.rows.map(row => [row.sku_code, row.post_inbound_qty, row.batch_qty, row.old_qty]), [
    ["RDM724B", 150, 40, 110],
    ["RDM916AKPRO", 40, 40, 0]
  ]);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.negative, []);
});

test("blocks WAC Zhisu derivation when post-inbound stock is less than this batch quantity", () => {
  const parsed = Zhisu.parseZhisuWorkbook(workbook([
    headers,
    ["1", "泰国一号仓", "M724", "RDM724B", "39", "0", "39"]
  ]), "zhisu_stock_20261110.xls", "2026-11-10", fakeXlsx());
  const result = Zhisu.deriveWacOldQtyFromZhisu(parsed, {
    country: "泰国",
    warehouse: "至速仓",
    actualArrivalDate: "2026-11-07",
    items: [{ sku_code: "RDM724B", batch_qty: 40 }]
  });
  assert.equal(result.ready, false);
  assert.deepEqual(result.negative, ["RDM724B（快照库存 39 < 本批到货 40）"]);
});

test("blocks WAC Zhisu derivation for missing and duplicate batch SKUs", () => {
  const parsed = Zhisu.parseZhisuWorkbook(workbook([
    headers,
    ["1", "泰国一号仓", "duplicate 1", "RDM724B", "150", "0", "150"],
    ["2", "泰国一号仓", "duplicate 2", "RDM724B", "151", "0", "151"]
  ]), "zhisu_stock_20261110.xls", "2026-11-10", fakeXlsx());
  const result = Zhisu.deriveWacOldQtyFromZhisu(parsed, {
    country: "泰国",
    warehouse: "至速仓",
    actualArrivalDate: "2026-11-07",
    items: [
      { sku_code: "RDM724B", batch_qty: 40 },
      { sku_code: "RDM916AKPRO", batch_qty: 40 }
    ]
  });
  assert.equal(result.ready, false);
  assert.deepEqual(result.duplicate, ["RDM724B"]);
  assert.deepEqual(result.missing, ["RDM916AKPRO"]);
});

test("blocks WAC Zhisu derivation when stock snapshot predates actual arrival", () => {
  const parsed = Zhisu.parseZhisuWorkbook(workbook([
    headers,
    ["1", "泰国一号仓", "M724", "RDM724B", "150", "0", "150"]
  ]), "zhisu_stock_20261106.xls", "2026-11-10", fakeXlsx());
  const result = Zhisu.deriveWacOldQtyFromZhisu(parsed, {
    country: "泰国",
    warehouse: "至速仓",
    actualArrivalDate: "2026-11-07",
    items: [{ sku_code: "RDM724B", batch_qty: 40 }]
  });
  assert.equal(result.ready, false);
  assert.match(result.errors[0], /早于本批次实际到货日期/);
});

test("blocks WAC Zhisu derivation when the current WAC target is not the matching Zhisu warehouse", () => {
  const parsed = Zhisu.parseZhisuWorkbook(workbook([
    headers,
    ["1", "泰国一号仓", "M724", "RDM724B", "150", "0", "150"]
  ]), "zhisu_stock_20261110.xls", "2026-11-10", fakeXlsx());
  const result = Zhisu.deriveWacOldQtyFromZhisu(parsed, {
    country: "印度尼西亚",
    warehouse: "Bekasi Warehouse",
    actualArrivalDate: "2026-11-07",
    items: [{ sku_code: "RDM724B", batch_qty: 40 }]
  });
  assert.equal(result.ready, false);
  assert.match(result.errors[0], /目标仓库不是至速仓/);
});
