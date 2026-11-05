'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const BigSeller = require('../assets/bigseller-inventory-import.js');

function fakeXlsx() {
  return { utils: { sheet_to_json: (sheet) => sheet.__rows || [] } };
}
function workbook(singleRows, combinationRows) {
  return {
    SheetNames: ['单个SKU', '组合SKU'],
    Sheets: {
      '单个SKU': { __rows: singleRows, '!ref': 'A1' },
      '组合SKU': { __rows: combinationRows || [['SKU编号'], ['COMBO-1'], ['COMBO-2']], '!ref': 'A1' }
    }
  };
}
const headers = ['Image URL', 'SKU编号', '名称', '整仓可用', '仓库', '一级分类', 'SKU类型', '加权成本价'];

test('reads only 单个SKU, skips 组合SKU, and maps SKU / available quantity / source warehouse', () => {
  const wb = workbook([
    headers,
    ['', 'RD-M724', 'RD-M724', '474', 'Redragon Warehouse', 'Redragon', 'Single SKU', '140.00'],
    ['', 'NT-SSD-1', 'NT-SSD-1', '0', 'Netac Warehouse', 'Netac', 'Single SKU', '99.00']
  ]);
  const parsed = BigSeller.parseBigSellerWorkbook(wb, '库存清单20261101144405972.xlsx', '2026-11-04', fakeXlsx());
  assert.ok(parsed);
  assert.equal(parsed.sheetName, '单个SKU');
  assert.equal(parsed.records.length, 2);
  assert.equal(parsed.skippedCombinationRows, 2);
  assert.equal(parsed.snapshotDate, '2026-11-01');
  assert.equal(parsed.records[0].sku_code, 'RD-M724');
  assert.equal(parsed.records[0].available_qty, 474);
  assert.equal(parsed.records[0]._sourceWarehouse, 'Redragon Warehouse');
  assert.equal(parsed.records[0].brand, '', 'BigSeller 一级分类 must not be authoritative brand');
  assert.equal(parsed.records[0].weighted_avg_cost, '', 'BigSeller cost must not overwrite PSI WAC');
  assert.equal(parsed.records[1].available_qty, 0, 'zero stock rows must be retained');
});

test('fractional and negative quantities are not silently truncated', () => {
  const parsed = BigSeller.parseBigSellerWorkbook(workbook([
    headers,
    ['', 'SKU-A', 'SKU-A', '1.5', 'Netac Warehouse', 'Netac', 'Single SKU', '0'],
    ['', 'SKU-B', 'SKU-B', '-2', 'Netac Warehouse', 'Netac', 'Single SKU', '0']
  ]), 'stock.xlsx', '2026-11-04', fakeXlsx());
  assert.equal(parsed.records[0].available_qty, 1.5);
  assert.ok(parsed.records[0]._errors.some(x => x.includes('非负整数')));
  assert.equal(parsed.records[1].available_qty, -2);
  assert.ok(parsed.records[1]._errors.some(x => x.includes('非负整数')));
});

test('ignores non-single rows even if they appear in 单个SKU sheet', () => {
  const parsed = BigSeller.parseBigSellerWorkbook(workbook([
    headers,
    ['', 'SKU-A', 'SKU-A', '5', 'Netac Warehouse', 'Netac', 'Single SKU', '0'],
    ['', 'COMBO-A', 'COMBO-A', '8', 'Netac Warehouse', 'Netac', 'Combination SKU', '0']
  ]), 'stock.xlsx', '2026-11-04', fakeXlsx());
  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.records[0].sku_code, 'SKU-A');
});


test('automatically maps every BigSeller source warehouse to the unique active Indonesia Bekasi Warehouse', () => {
  const warehouses = [
    { id: 'bekasi-actual-id', name: 'Bekasi Warehouse', country_name: '印度尼西亚', status: 'active' },
    { id: 'jakarta-id', name: 'Jakarta Warehouse', country_name: '印度尼西亚', status: 'active' },
    { id: 'kl-id', name: 'Bekasi Warehouse', country_name: '马来西亚', status: 'active' },
    { id: 'old-bekasi-id', name: 'Bekasi Warehouse', country_name: '印度尼西亚', status: 'inactive' }
  ];
  const result = BigSeller.buildBekasiSourceMap(
    ['Redragon Warehouse', 'Netac Warehouse', 'BOYA Warehouse', 'Joypeer Warehouse'],
    warehouses
  );
  assert.equal(result.warehouse.id, 'bekasi-actual-id');
  assert.equal(result.matchCount, 1);
  assert.equal(result.error, '');
  assert.equal(result.map['Redragon Warehouse'], 'bekasi-actual-id');
  assert.equal(result.map['Netac Warehouse'], 'bekasi-actual-id');
  assert.equal(result.map['BOYA Warehouse'], 'bekasi-actual-id');
  assert.equal(result.map['Joypeer Warehouse'], 'bekasi-actual-id');
});

test('Bekasi auto-mapping fails closed when no unique active Indonesia warehouse exists', () => {
  const noMatch = BigSeller.buildBekasiSourceMap(
    ['Netac Warehouse'],
    [{ id: 'inactive', name: 'Bekasi Warehouse', country_name: '印度尼西亚', status: 'inactive' }]
  );
  assert.equal(noMatch.warehouse, null);
  assert.equal(noMatch.matchCount, 0);
  assert.equal(noMatch.map['Netac Warehouse'], undefined);
  assert.ok(noMatch.error.includes('未找到'));

  const ambiguous = BigSeller.buildBekasiSourceMap(
    ['Netac Warehouse'],
    [
      { id: 'bekasi-1', name: 'Bekasi Warehouse', country_name: '印度尼西亚', status: 'active' },
      { id: 'bekasi-2', name: ' Bekasi   Warehouse ', country_name: '印度尼西亚', status: 'active' }
    ]
  );
  assert.equal(ambiguous.warehouse, null);
  assert.equal(ambiguous.matchCount, 2);
  assert.equal(ambiguous.map['Netac Warehouse'], undefined);
  assert.ok(ambiguous.error.includes('多个'));
});

test('BigSeller source labels stay traceable while all mapped stock lands in Bekasi', () => {
  const raw = [
    { sku_code: 'SKU-A', available_qty: 5, _sourceWarehouse: 'Netac Warehouse', _rowNum: 2, _baseErrors: [], _sourceRows: [2] },
    { sku_code: 'SKU-B', available_qty: 7, _sourceWarehouse: 'Redragon Warehouse', _rowNum: 3, _baseErrors: [], _sourceRows: [3] }
  ];
  const warehouses = [{ id: 'bekasi-id', name: 'Bekasi Warehouse', country_name: '印度尼西亚', status: 'active' }];
  const mapping = BigSeller.buildBekasiSourceMap(['Netac Warehouse', 'Redragon Warehouse'], warehouses);
  const built = BigSeller.buildMappedRecords(raw, mapping.map, warehouses, false);
  assert.equal(built.mappingReady, true);
  assert.equal(built.records[0].warehouse, 'Bekasi Warehouse');
  assert.equal(built.records[1].warehouse, 'Bekasi Warehouse');
  assert.match(built.records[0].remark, /Netac Warehouse/);
  assert.match(built.records[1].remark, /Redragon Warehouse/);
});

test('duplicate SKU rows are blocked by default for the same PSI destination', () => {
  const raw = [
    { sku_code: 'SKU-A', available_qty: 5, _sourceWarehouse: 'Netac Warehouse', _rowNum: 2, _baseErrors: [], _sourceRows: [2] },
    { sku_code: 'SKU-A', available_qty: 7, _sourceWarehouse: 'Redragon Warehouse', _rowNum: 3, _baseErrors: [], _sourceRows: [3] }
  ];
  const whs = [{ id: 'wh1', name: 'Bekasi Warehouse', country_name: '印度尼西亚', status: 'active' }];
  const mapped = BigSeller.buildMappedRecords(raw, { 'Netac Warehouse': 'wh1', 'Redragon Warehouse': 'wh1' }, whs, false);
  assert.equal(mapped.mappingReady, true);
  assert.equal(mapped.duplicateGroups.length, 1);
  assert.ok(mapped.records.every(r => r._errors.some(x => x.includes('重复'))));
});

test('duplicate quantities are summed only after explicit merge confirmation', () => {
  const raw = [
    { sku_code: 'SKU-A', available_qty: 5, _sourceWarehouse: 'Netac Warehouse', _rowNum: 2, _baseErrors: [], _sourceRows: [2] },
    { sku_code: 'SKU-A', available_qty: 7, _sourceWarehouse: 'Redragon Warehouse', _rowNum: 3, _baseErrors: [], _sourceRows: [3] }
  ];
  const whs = [{ id: 'wh1', name: 'Bekasi Warehouse', country_name: '印度尼西亚', status: 'active' }];
  const mapped = BigSeller.buildMappedRecords(raw, { 'Netac Warehouse': 'wh1', 'Redragon Warehouse': 'wh1' }, whs, true);
  assert.equal(mapped.records.length, 1);
  assert.equal(mapped.records[0].available_qty, 12);
  assert.deepEqual(mapped.records[0]._sourceRows, [2, 3]);
  assert.equal(mapped.records[0].country, '印度尼西亚');
  assert.equal(mapped.records[0].warehouse, 'Bekasi Warehouse');
  assert.equal(mapped.records[0]._errors.length, 0);
});

test('same SKU remains separate when mapped to different PSI warehouses', () => {
  const raw = [
    { sku_code: 'SKU-A', available_qty: 5, _sourceWarehouse: 'Netac Warehouse', _rowNum: 2, _baseErrors: [], _sourceRows: [2] },
    { sku_code: 'SKU-A', available_qty: 7, _sourceWarehouse: 'Redragon Warehouse', _rowNum: 3, _baseErrors: [], _sourceRows: [3] }
  ];
  const whs = [
    { id: 'wh1', name: 'Bekasi Warehouse', country_name: '印度尼西亚', status: 'active' },
    { id: 'wh2', name: 'KL Hub', country_name: '马来西亚', status: 'active' }
  ];
  const mapped = BigSeller.buildMappedRecords(raw, { 'Netac Warehouse': 'wh1', 'Redragon Warehouse': 'wh2' }, whs, false);
  assert.equal(mapped.mappingReady, true);
  assert.equal(mapped.duplicateGroups.length, 0);
  assert.equal(mapped.records.length, 2);
  assert.equal(mapped.records[0].warehouse, 'Bekasi Warehouse');
  assert.equal(mapped.records[1].warehouse, 'KL Hub');
});

test('unmapped source warehouse keeps import blocked', () => {
  const raw = [{ sku_code: 'SKU-A', available_qty: 5, _sourceWarehouse: 'Netac Warehouse', _rowNum: 2, _baseErrors: [], _sourceRows: [2] }];
  const mapped = BigSeller.buildMappedRecords(raw, {}, [{ id: 'wh1', name: 'Bekasi Warehouse', country_name: '印度尼西亚', status: 'active' }], false);
  assert.equal(mapped.mappingReady, false);
  assert.ok(mapped.records[0]._errors.length > 0);
});

test('date parser ignores invalid calendar dates', () => {
  assert.equal(BigSeller.dateFromFilename('stock_20261101_123456.xlsx'), '2026-11-01');
  assert.equal(BigSeller.dateFromFilename('stock_20261340.xlsx'), '');
});