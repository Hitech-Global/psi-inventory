'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Zhisu = require('../assets/zhisu-sales-import.js');
const SalesImport = require('../sales-import-service');

function fakeXlsx() {
  return { utils: { sheet_to_json: sheet => sheet.__rows || [] } };
}

const headers = [
  '系统单号', '商家编码', '平台单号', '订单来源', '平台编码', '店铺名称',
  '仓库名称', '下单时间', '付款时间', '最晚发货时间（订单）',
  '物流渠道（订单）', '线上状态', '仓储状态', '收货地址', '支付方式',
  '包裹编号', '运单号', '物流状态', '模型ID', '商品编码', '商品名称',
  '商品类型', 'SKU', '规格属性', '商品货号', '发货数量'
];

function workbook(dataRows) {
  return {
    SheetNames: ['Sheet1'],
    Sheets: { Sheet1: { __rows: [headers].concat(dataRows || []) } }
  };
}

function row(overrides) {
  return Object.assign([
    'EC-MY-20261101000001', 'ZS00058', 'MY-ORDER-1', '订单', 'SHOPEE',
    'Redragon Malaysia OS(MY)', '吉隆坡一号仓', '2026-11-01T10:00:00',
    '2026-11-01T10:01:00', '2026-11-02T23:59:59', 'SPX Express',
    '已完成', '已发货', '****', 'Credit / Debit Card', 'PKG-1',
    'WB-1', '已发货', 'MODEL-1', 'PRODUCT-1', 'M724', '非自定义商品',
    'M724', '', '', 1
  ], overrides || []);
}

test('detects the native Zhisu export and maps its columns into PSI sales records', () => {
  const parsed = Zhisu.parseZhisuWorkbook(workbook([row()]), '订单导出.xlsx', fakeXlsx());
  assert.ok(parsed);
  assert.equal(parsed.sheetName, 'Sheet1');
  assert.equal(parsed.records.length, 1);
  const record = parsed.records[0];
  assert.equal(record.source_system, '至速仓');
  assert.equal(record.order_no, 'MY-ORDER-1');
  assert.equal(record.order_date, '2026-11-01');
  assert.equal(record.country, '马来西亚');
  assert.equal(record.shop_platform, '线上渠道');
  assert.equal(record.sku_code, 'M724');
  assert.equal(record.quantity, 1);
  assert.equal(record.is_valid_order, 1);
  assert.equal(record.brand, '');
  assert.match(record.remark, /系统单号=EC-MY-20261101000001/);
  assert.match(record.remark, /仓库=吉隆坡一号仓/);
  assert.match(record.remark, /支付方式=Credit \/ Debit Card/);
});

test('blank payment method and unpaid status are excluded before import', () => {
  const parsed = Zhisu.parseZhisuWorkbook(workbook([
    row(),
    row({ 2: 'MY-ORDER-BLANK-PAY', 14: '' }),
    row({ 2: 'MY-ORDER-UNPAID', 11: '未支付' })
  ]), 'orders.xlsx', fakeXlsx());
  assert.equal(parsed.stats.sourceRows, 3);
  assert.equal(parsed.stats.excludedBlankPaymentRows, 1);
  assert.equal(parsed.stats.excludedUnpaidRows, 1);
  assert.equal(parsed.records.length, 1);
});

test('maps cancelled and buyer-return statuses to False; every other status is True', () => {
  const parsed = Zhisu.parseZhisuWorkbook(workbook([
    row({ 2: 'ORDER-CANCEL', 11: '已取消' }),
    row({ 2: 'ORDER-RETURN', 11: '买方要求退回，系统处理中' }),
    row({ 2: 'ORDER-COMPLETE', 11: '已完成' }),
    row({ 2: 'ORDER-SHIPPED', 11: '已发货' }),
    row({ 2: 'ORDER-DELIVERED', 11: '已送达' })
  ]), 'orders.xlsx', fakeXlsx());
  assert.deepEqual(parsed.records.map(record => record.is_valid_order), [0, 0, 1, 1, 1]);
  assert.equal(parsed.stats.falseRows, 2);
  assert.equal(parsed.stats.trueRows, 3);
});

test('warehouse country identifies Zhisu only for Malaysia and Thailand', () => {
  const parsed = Zhisu.parseZhisuWorkbook(workbook([
    row({ 2: 'MY-1', 6: '吉隆坡一号仓' }),
    row({ 2: 'TH-1', 6: '泰国一号仓', 0: 'EC-TH-1' }),
    row({ 2: 'SG-1', 6: '新加坡仓', 0: 'EC-SG-1' })
  ]), 'orders.xlsx', fakeXlsx());
  assert.deepEqual(parsed.records.map(record => record.country), ['马来西亚', '泰国', '']);
  assert.ok(parsed.records[2]._errors.some(error => error.includes('无法根据仓库名称识别国家')));
  assert.equal(parsed.stats.unknownWarehouseRows, 1);
});

test('multiple SKUs under one order remain separate sales lines', () => {
  const parsed = Zhisu.parseZhisuWorkbook(workbook([
    row({ 2: 'ORDER-MULTI', 22: 'M724' }),
    row({ 2: 'ORDER-MULTI', 22: 'K617', 0: 'EC-MY-20261101000002', 19: 'PRODUCT-2' })
  ]), 'orders.xlsx', fakeXlsx());
  assert.equal(parsed.records.length, 2);
  assert.deepEqual(parsed.records.map(record => record.sku_code), ['M724', 'K617']);
});

test('exact duplicate source rows are deduplicated and conflicting duplicate order items are blocked', () => {
  const exact = row({ 2: 'ORDER-EXACT' });
  const conflictA = row({ 2: 'ORDER-CONFLICT', 22: 'K617' });
  const conflictB = row({ 2: 'ORDER-CONFLICT', 22: 'K617', 25: 2 });
  const parsed = Zhisu.parseZhisuWorkbook(workbook([
    exact, exact.slice(),
    conflictA, conflictB
  ]), 'orders.xlsx', fakeXlsx());
  assert.equal(parsed.stats.exactDuplicateRows, 1);
  assert.equal(parsed.stats.conflictGroups, 1);
  assert.equal(parsed.stats.conflictRows, 2);
  assert.equal(parsed.records.length, 3);
  assert.ok(parsed.records.filter(record => record.order_no === 'ORDER-CONFLICT')
    .every(record => record._errors.some(error => error.includes('内容不一致'))));
});

test('unknown warehouse, missing SKU and invalid quantity remain visible as blocking row errors', () => {
  const parsed = Zhisu.parseZhisuWorkbook(workbook([
    row({ 2: 'ORDER-UNKNOWN-WH', 6: '未知仓库' }),
    row({ 2: 'ORDER-NO-SKU', 22: '' }),
    row({ 2: 'ORDER-NO-QTY', 25: '' })
  ]), 'orders.xlsx', fakeXlsx());
  assert.equal(parsed.stats.unknownWarehouseRows, 1);
  assert.equal(parsed.stats.validationErrorRows, 3);
  assert.ok(parsed.records[0]._errors.some(error => error.includes('无法根据仓库名称识别国家')));
  assert.ok(parsed.records[1]._errors.some(error => error.includes('SKU 为空')));
  assert.ok(parsed.records[2]._errors.some(error => error.includes('发货数量')));
});

test('brand is resolved by the existing PSI SKU-master validation, not source category text', async () => {
  const parsed = Zhisu.parseZhisuWorkbook(workbook([
    row({ 2: 'ORDER-BRAND', 22: 'M724' })
  ]), 'orders.xlsx', fakeXlsx());
  const rows = SalesImport.normalizeSalesRows(parsed.records);
  assert.equal(rows[0].brand, '');
  const result = await SalesImport.validateSalesBrandRows({
    loadSkuBrands: async () => new Map([
      ['M724', { sku_code: 'M724', brand: 'Redragon' }]
    ])
  }, rows);
  assert.equal(result.failures.length, 0);
  assert.equal(rows[0].brand, 'Redragon');
});

function createSalesImportDatabase(seedRecords) {
  const Database = require('better-sqlite3');
  const raw = new Database(':memory:');
  raw.exec(
    'CREATE TABLE skus (sku_code TEXT PRIMARY KEY, brand TEXT);' +
    "INSERT INTO skus (sku_code, brand) VALUES ('M724', 'Redragon');" +
    'CREATE TABLE sales_records (' +
      'id TEXT PRIMARY KEY, source_system TEXT DEFAULT "", order_no TEXT DEFAULT "", ' +
      'order_detail_id TEXT DEFAULT "", order_date TEXT, shop_platform TEXT DEFAULT "", ' +
      'brand TEXT DEFAULT "", sku_code TEXT, quantity INTEGER DEFAULT 0, ' +
      'is_valid_order INTEGER DEFAULT 1, original_order_status TEXT DEFAULT "", ' +
      'remark TEXT DEFAULT "", import_batch_id TEXT DEFAULT "", country TEXT DEFAULT "", ' +
      'created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP' +
    ');' +
    "CREATE UNIQUE INDEX idx_sales_records_unique ON sales_records(source_system, order_no, sku_code, COALESCE(shop_platform, ''));"
  );
  const columns = [
    'id', 'source_system', 'order_no', 'order_detail_id', 'order_date',
    'shop_platform', 'brand', 'sku_code', 'quantity', 'is_valid_order',
    'original_order_status', 'remark', 'import_batch_id', 'country'
  ];
  const insert = raw.prepare(
    'INSERT INTO sales_records (' + columns.join(', ') + ') VALUES (' +
    columns.map(() => '?').join(', ') + ')'
  );
  for (const record of seedRecords || []) {
    insert.run(...columns.map(column => record[column] === undefined ? '' : record[column]));
  }
  const db = {
    getDB: () => raw,
    query: (sql, params = []) => ({ rows: raw.prepare(sql).all(...params) }),
    run: (sql, params = []) => raw.prepare(sql).run(...params)
  };
  return {
    raw,
    adapter: SalesImport.createSqliteSalesImportAdapter(db, { batchSize: 80 }),
    executeSalesImport: SalesImport.executeSalesImport
  };
}

test('Zhisu re-import updates only status and True/False, preserving original date and quantity', async () => {
  const original = {
    id: 'zhisu-existing',
    source_system: '至速仓',
    order_no: 'ORDER-REIMPORT',
    order_detail_id: '',
    order_date: '2026-11-01',
    shop_platform: '线上渠道',
    brand: 'Redragon',
    sku_code: 'M724',
    quantity: 2,
    is_valid_order: 1,
    original_order_status: '已发货',
    remark: 'original remark',
    import_batch_id: 'first-import',
    country: '马来西亚'
  };
  const { raw, adapter, executeSalesImport } = createSalesImportDatabase([original]);
  try {
    const result = await executeSalesImport(adapter, [{
      source_system: '至速仓',
      order_no: 'ORDER-REIMPORT',
      order_detail_id: '',
      order_date: '2026-11-08',
      country: '泰国',
      shop_platform: '线上渠道',
      brand: 'Redragon',
      sku_code: 'M724',
      quantity: 9,
      is_valid_order: 0,
      original_order_status: '已取消',
      remark: 'new export remark'
    }], {
      importBatchId: 'second-import',
      idFactory: () => 'must-not-insert'
    });
    assert.equal(result.result.inserted, 0);
    assert.equal(result.result.updated, 1);
    const stored = raw.prepare('SELECT * FROM sales_records WHERE id = ?').get('zhisu-existing');
    assert.equal(stored.original_order_status, '已取消');
    assert.equal(stored.is_valid_order, 0);
    assert.equal(stored.order_date, '2026-11-01');
    assert.equal(stored.quantity, 2);
    assert.equal(stored.country, '马来西亚');
    assert.equal(stored.remark, 'original remark');
    assert.equal(raw.prepare('SELECT COUNT(*) AS count FROM sales_records').get().count, 1);
  } finally {
    raw.close();
  }
});
