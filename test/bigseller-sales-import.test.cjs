'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const BigSeller = require('../assets/bigseller-sales-import.js');

function fakeXlsx() {
  return { utils: { sheet_to_json: (sheet) => sheet.__rows || [] } };
}

const headers = [
  '下单时间', '订单号', '订单标记', '订单状态', '发货仓库',
  '商品SKU', '数量', '包裹号', '平台', '平台店铺'
];

function workbook(dataRows) {
  return {
    SheetNames: ['sheet1'],
    Sheets: { sheet1: { __rows: [headers].concat(dataRows || []) } }
  };
}

test('BigSeller parser imports only blank / Pay in Advance / Credit markers', () => {
  const parsed = BigSeller.parseBigSellerWorkbook(workbook([
    ['2026-11-06 18:18', 'ORDER-1', '', '已完成', 'Redragon Warehouse', 'RD-M724', '1', 'PKG-1', 'Shopee', 'Redragon Indonesia OS'],
    ['2026-11-06 18:08', 'ORDER-2', 'Reseller Order-Pay in Advance', '待处理', 'Netac Warehouse', 'NT-SSD-1', '2', 'PKG-2', 'Manual', 'Netac Official Store'],
    ['2026-11-05 10:00', 'ORDER-3', 'Reseller Order- Credit', '取消申请', 'Netac Warehouse', 'NT-SSD-2', '1', 'PKG-3', 'Manual', 'Netac Official Store'],
    ['2026-11-05 09:00', 'ORDER-4', '', '已取消', 'Redragon Warehouse', 'RD-K617', '1', 'PKG-4', 'Shopee', 'Redragon Official Store'],
    ['2026-11-05 08:00', 'ORDER-5', '', '退货退款', 'Redragon Warehouse', 'RD-K719', '1', 'PKG-5', 'TikTok', 'redragonindonesia'],
    ['2026-11-05 07:00', 'ORDER-6', '', '未付款', 'Redragon Warehouse', 'RD-GS520', '1', 'PKG-6', 'TikTok', 'redragonindonesia'],
    ['2026-11-05 06:00', 'ORDER-7', 'Offline Order-Consignment', '已完成', 'Redragon Warehouse', 'RD-M995', '1', 'PKG-7', 'Manual', 'Redragon Indonesia OS'],
    ['2026-11-05 05:00', 'ORDER-8', '测评订单', '已完成', 'Redragon Warehouse', 'RD-M816', '1', 'PKG-8', 'Shopee', 'Redragon Indonesia OS'],
    ['2026-11-05 04:00', 'ORDER-9', 'Free Sample-Tiktok', '已完成', 'Redragon Warehouse', 'RD-H888', '1', 'PKG-9', 'TikTok', 'redragonindonesia']
  ]), 'Order-Goods-all.xlsx', fakeXlsx());

  assert.ok(parsed);
  assert.equal(parsed.country, '印尼');
  assert.equal(parsed.stats.sourceRows, 9);
  assert.equal(parsed.stats.includedRows, 5);
  assert.equal(parsed.stats.excludedMarkerRows, 3);
  assert.equal(parsed.stats.excludedUnpaidRows, 1);
  assert.equal(parsed.stats.trueRows, 2);
  assert.equal(parsed.stats.falseRows, 3);
  assert.equal(parsed.records.length, 5);

  assert.equal(parsed.records[0].source_system, 'BigSeller');
  assert.equal(parsed.records[0].order_date, '2026-11-06');
  assert.equal(parsed.records[0].country, '印尼');
  assert.equal(parsed.records[0].shop_platform, '线上');
  assert.equal(parsed.records[0].is_valid_order, 1);
  assert.equal(parsed.records[0].order_detail_id, '');
  assert.match(parsed.records[0].remark, /平台=Shopee/);
  assert.match(parsed.records[0].remark, /包裹号=PKG-1/);

  assert.equal(parsed.records[1].shop_platform, '线下');
  assert.equal(parsed.records[1].is_valid_order, 1);
  assert.equal(parsed.records[2].shop_platform, '线下');
  assert.equal(parsed.records[2].is_valid_order, 0);
  assert.equal(parsed.records[3].is_valid_order, 0);
  assert.equal(parsed.records[4].is_valid_order, 0);

  assert.equal(parsed.stats.excludedMarkers['Offline Order-Consignment'], 1);
  assert.equal(parsed.stats.excludedMarkers['测评订单'], 1);
  assert.equal(parsed.stats.excludedMarkers['Free Sample-Tiktok'], 1);
});

test('marker matching is strict after whitespace and case normalization', () => {
  assert.equal(BigSeller.classifyOrderMarker('   '), '线上');
  assert.equal(BigSeller.classifyOrderMarker('Reseller Order-Pay in Advance'), '线下');
  assert.equal(BigSeller.classifyOrderMarker(' reseller order- credit '), '线下');
  assert.equal(BigSeller.classifyOrderMarker('pay in advance'), '线下');
  assert.equal(BigSeller.classifyOrderMarker('credit'), '线下');
  assert.equal(BigSeller.classifyOrderMarker('Offline Order-Consignment'), '');
  assert.equal(BigSeller.classifyOrderMarker('测评订单'), '');
  assert.equal(BigSeller.classifyOrderMarker('Free Sample-Tiktok'), '');
});

test('only the three specified statuses are false; unpaid is excluded separately', () => {
  assert.equal(BigSeller.isFalseStatus('取消申请'), true);
  assert.equal(BigSeller.isFalseStatus('已取消'), true);
  assert.equal(BigSeller.isFalseStatus('退货退款'), true);
  assert.equal(BigSeller.isFalseStatus('已完成'), false);
  assert.equal(BigSeller.isFalseStatus('待处理'), false);
  assert.equal(BigSeller.isUnpaidStatus('未付款'), true);
  assert.equal(BigSeller.isUnpaidStatus('待处理'), false);
});

test('generic store labels inherit the unique country inferred from other stores in the same file', () => {
  const parsed = BigSeller.parseBigSellerWorkbook(workbook([
    ['2026-11-06 18:18', 'ORDER-1', '', '已完成', 'Redragon Warehouse', 'RD-M724', '1', 'PKG-1', 'Shopee', 'Redragon Indonesia OS'],
    ['2026-11-06 18:08', 'ORDER-2', '', '已完成', 'Netac Warehouse', 'NT-SSD-1', '1', 'PKG-2', 'Shopee', 'Netac Official Store']
  ]), 'orders.xlsx', fakeXlsx());

  assert.equal(parsed.records[0].country, '印尼');
  assert.equal(parsed.records[1].country, '印尼');
  assert.equal(parsed.stats.unresolvedCountryRows, 0);
});

test('unrecognized country does not silently default to a potentially wrong country', () => {
  const parsed = BigSeller.parseBigSellerWorkbook(workbook([
    ['2026-11-06 18:18', 'ORDER-1', '', '已完成', 'Warehouse', 'SKU-1', '1', 'PKG-1', 'Shopee', 'Official Store']
  ]), 'orders.xlsx', fakeXlsx());

  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.records[0].country, '');
  assert.ok(parsed.records[0]._errors.some(error => error.includes('无法从 BigSeller 店铺名称识别国家')));
  assert.equal(parsed.stats.unresolvedCountryRows, 1);
});

test('non-BigSeller template files fall back to the existing sales import parser', () => {
  const template = {
    SheetNames: ['销售数据'],
    Sheets: { '销售数据': { __rows: [['来源系统', '订单号', '下单日期', '国家', 'SKU', '数量']] } }
  };
  assert.equal(BigSeller.parseBigSellerWorkbook(template, 'sales-template.xlsx', fakeXlsx()), null);
});

test('BigSeller date-time and Excel serial dates normalize to YYYY-MM-DD', () => {
  assert.equal(BigSeller.normalizeOrderDate('2026-11-06 18:18'), '2026-11-06');
  assert.equal(BigSeller.normalizeOrderDate('2026/11/06 18:18'), '2026-11-06');
  assert.equal(BigSeller.normalizeOrderDate('not-a-date'), '');
});
