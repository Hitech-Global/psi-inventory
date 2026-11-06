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
  assert.equal(parsed.country, '印度尼西亚');
  assert.equal(parsed.stats.sourceRows, 9);
  assert.equal(parsed.stats.includedRows, 5);
  assert.equal(parsed.stats.excludedMarkerRows, 3);
  assert.equal(parsed.stats.excludedUnpaidRows, 1);
  assert.equal(parsed.stats.trueRows, 2);
  assert.equal(parsed.stats.falseRows, 3);
  assert.equal(parsed.records.length, 5);

  assert.equal(parsed.records[0].source_system, 'BigSeller');
  assert.equal(parsed.records[0].order_date, '2026-11-06');
  assert.equal(parsed.records[0].country, '印度尼西亚');
  assert.equal(parsed.records[0].shop_platform, '线上渠道');
  assert.equal(parsed.records[0].is_valid_order, 1);
  assert.equal(parsed.records[0].order_detail_id, '');
  assert.match(parsed.records[0].remark, /平台=Shopee/);
  assert.match(parsed.records[0].remark, /包裹号=PKG-1/);

  assert.equal(parsed.records[1].shop_platform, '线下渠道');
  assert.equal(parsed.records[1].is_valid_order, 1);
  assert.equal(parsed.records[2].shop_platform, '线下渠道');
  assert.equal(parsed.records[2].is_valid_order, 0);
  assert.equal(parsed.records[3].is_valid_order, 0);
  assert.equal(parsed.records[4].is_valid_order, 0);

  assert.equal(parsed.stats.excludedMarkers['Offline Order-Consignment'], 1);
  assert.equal(parsed.stats.excludedMarkers['测评订单'], 1);
  assert.equal(parsed.stats.excludedMarkers['Free Sample-Tiktok'], 1);
});

test('marker matching follows the final channel rule, including Manual exclusion', () => {
  assert.equal(BigSeller.classifyOrderMarker('   ', 'Shopee'), '线上渠道');
  assert.equal(BigSeller.classifyOrderMarker('', 'TikTok'), '线上渠道');
  assert.equal(BigSeller.classifyOrderMarker('', 'Manual'), '');
  assert.equal(BigSeller.classifyOrderMarker('Reseller Order-Pay in Advance', 'Manual'), '线下渠道');
  assert.equal(BigSeller.classifyOrderMarker(' reseller order- credit ', 'Manual'), '线下渠道');
  assert.equal(BigSeller.classifyOrderMarker('pay in advance', 'Manual'), '');
  assert.equal(BigSeller.classifyOrderMarker('credit', 'Manual'), '');
  assert.equal(BigSeller.classifyOrderMarker('Offline Order-Consignment', 'Manual'), '');
  assert.equal(BigSeller.classifyOrderMarker('测评订单', 'Shopee'), '');
  assert.equal(BigSeller.classifyOrderMarker('Free Sample-Tiktok', 'TikTok'), '');
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

  assert.equal(parsed.records[0].country, '印度尼西亚');
  assert.equal(parsed.records[1].country, '印度尼西亚');
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


function createSalesImportDatabase(seedRecords) {
  const Database = require('better-sqlite3');
  const raw = new Database(':memory:');
  raw.exec(`
    CREATE TABLE skus (sku_code TEXT PRIMARY KEY, brand TEXT);
    INSERT INTO skus (sku_code, brand) VALUES ('M724', 'Redragon');
    CREATE TABLE sales_records (
      id TEXT PRIMARY KEY,
      source_system TEXT DEFAULT '',
      order_no TEXT DEFAULT '',
      order_detail_id TEXT DEFAULT '',
      order_date TEXT,
      shop_platform TEXT DEFAULT '',
      brand TEXT DEFAULT '',
      sku_code TEXT,
      quantity INTEGER DEFAULT 0,
      is_valid_order INTEGER DEFAULT 1,
      original_order_status TEXT DEFAULT '',
      remark TEXT DEFAULT '',
      import_batch_id TEXT DEFAULT '',
      country TEXT DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX idx_sales_records_unique
      ON sales_records(source_system, order_no, sku_code, COALESCE(shop_platform, ''));
  `);
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
  const SalesImport = require('../sales-import-service');
  return {
    raw,
    adapter: SalesImport.createSqliteSalesImportAdapter(db, { batchSize: 80 }),
    executeSalesImport: SalesImport.executeSalesImport
  };
}

test('BigSeller re-import updates only status and True/False while preserving original sales fields', async () => {
  const original = {
    id: 'sale-existing',
    source_system: 'BigSeller',
    order_no: 'ORDER-1',
    order_detail_id: '',
    order_date: '2026-11-01',
    shop_platform: '线上',
    brand: 'Redragon',
    sku_code: 'M724',
    quantity: 2,
    is_valid_order: 1,
    original_order_status: '待发货',
    remark: 'original remark',
    import_batch_id: 'first-import',
    country: '印尼'
  };
  const { raw, adapter, executeSalesImport } = createSalesImportDatabase([original]);
  try {
    const changedStatus = {
      source_system: 'BigSeller',
      order_no: 'ORDER-1',
      order_detail_id: '',
      order_date: '2026-11-06',
      country: '马来西亚',
      shop_platform: '线上',
      brand: 'Redragon',
      sku_code: 'M724',
      quantity: 4,
      is_valid_order: 1,
      original_order_status: '已完成',
      remark: 'new export remark'
    };
    const first = await executeSalesImport(adapter, [changedStatus], {
      importBatchId: 'second-import',
      idFactory: () => 'unexpected-new-row'
    });
    assert.equal(first.result.inserted, 0);
    assert.equal(first.result.updated, 1);
    assert.equal(first.result.skipped, 0);

    let stored = raw.prepare('SELECT * FROM sales_records WHERE id = ?').get('sale-existing');
    assert.equal(stored.original_order_status, '已完成');
    assert.equal(stored.is_valid_order, 1);
    assert.equal(stored.order_date, original.order_date);
    assert.equal(stored.sku_code, original.sku_code);
    assert.equal(stored.quantity, original.quantity);
    assert.equal(stored.brand, original.brand);
    assert.equal(stored.shop_platform, original.shop_platform);
    assert.equal(stored.country, original.country);
    assert.equal(stored.remark, original.remark);

    const returned = {
      ...changedStatus,
      order_date: '2026-11-07',
      quantity: 9,
      original_order_status: '退货退款',
      is_valid_order: 0
    };
    const second = await executeSalesImport(adapter, [returned], {
      importBatchId: 'third-import',
      idFactory: () => 'unexpected-new-row-2'
    });
    assert.equal(second.result.inserted, 0);
    assert.equal(second.result.updated, 1);
    stored = raw.prepare('SELECT * FROM sales_records WHERE id = ?').get('sale-existing');
    assert.equal(stored.original_order_status, '退货退款');
    assert.equal(stored.is_valid_order, 0);
    assert.equal(stored.order_date, original.order_date);
    assert.equal(stored.quantity, original.quantity);
    assert.equal(stored.remark, original.remark);

    const sameStatusButChangedQuantity = {
      ...returned,
      order_date: '2026-11-08',
      quantity: 12,
      remark: 'yet another remark'
    };
    const third = await executeSalesImport(adapter, [sameStatusButChangedQuantity], {
      importBatchId: 'fourth-import',
      idFactory: () => 'unexpected-new-row-3'
    });
    assert.equal(third.result.inserted, 0);
    assert.equal(third.result.updated, 0);
    assert.equal(third.result.skipped, 1);
    stored = raw.prepare('SELECT * FROM sales_records WHERE id = ?').get('sale-existing');
    assert.equal(stored.quantity, original.quantity);
    assert.equal(stored.order_date, original.order_date);
    assert.equal(stored.original_order_status, '退货退款');
    assert.equal(stored.is_valid_order, 0);

    const newOrder = {
      ...changedStatus,
      order_no: 'ORDER-NEW',
      order_date: '2026-11-06',
      quantity: 3,
      original_order_status: '待发货',
      is_valid_order: 1
    };
    const fourth = await executeSalesImport(adapter, [newOrder], {
      importBatchId: 'fifth-import',
      idFactory: () => 'sale-new-order'
    });
    assert.equal(fourth.result.inserted, 1);
    const inserted = raw.prepare('SELECT * FROM sales_records WHERE id = ?').get('sale-new-order');
    assert.equal(inserted.quantity, 3);
    assert.equal(inserted.original_order_status, '待发货');
    assert.equal(raw.prepare('SELECT COUNT(*) AS count FROM sales_records').get().count, 2);
  } finally {
    raw.close();
  }
});

test('non-BigSeller sales imports keep their existing quantity-update behavior', async () => {
  const original = {
    id: 'manual-existing',
    source_system: 'Manual',
    order_no: 'MANUAL-1',
    order_detail_id: '',
    order_date: '2026-11-01',
    shop_platform: '线下',
    brand: 'Redragon',
    sku_code: 'M724',
    quantity: 2,
    is_valid_order: 1,
    original_order_status: '待处理',
    remark: 'manual original',
    import_batch_id: 'first-import',
    country: '印尼'
  };
  const { raw, adapter, executeSalesImport } = createSalesImportDatabase([original]);
  try {
    const result = await executeSalesImport(adapter, [{
      source_system: 'Manual',
      order_no: 'MANUAL-1',
      order_detail_id: '',
      order_date: '2026-11-06',
      country: '印尼',
      shop_platform: '线下',
      brand: 'Redragon',
      sku_code: 'M724',
      quantity: 4,
      is_valid_order: 1,
      original_order_status: '已完成',
      remark: 'manual updated'
    }], { importBatchId: 'second-import' });
    assert.equal(result.result.updated, 1);
    const stored = raw.prepare('SELECT * FROM sales_records WHERE id = ?').get('manual-existing');
    assert.equal(stored.quantity, 4);
    assert.equal(stored.order_date, '2026-11-06');
    assert.equal(stored.original_order_status, '已完成');
  } finally {
    raw.close();
  }
});


test('BigSeller re-import matches legacy source-system capitalization', async () => {
  const original = {
    id: 'sale-legacy-case',
    source_system: 'Bigseller',
    order_no: 'ORDER-LEGACY',
    order_detail_id: '',
    order_date: '2026-10-30',
    shop_platform: '线上',
    brand: 'Redragon',
    sku_code: 'M724',
    quantity: 2,
    is_valid_order: 1,
    original_order_status: '待发货',
    remark: 'legacy remark',
    import_batch_id: 'legacy-import',
    country: '印尼'
  };
  const { raw, adapter, executeSalesImport } = createSalesImportDatabase([original]);
  try {
    const result = await executeSalesImport(adapter, [{
      source_system: 'BigSeller',
      order_no: 'ORDER-LEGACY',
      order_detail_id: '',
      order_date: '2026-11-06',
      country: '印尼',
      shop_platform: '线上',
      brand: 'Redragon',
      sku_code: 'M724',
      quantity: 7,
      is_valid_order: 1,
      original_order_status: '已完成',
      remark: 'new export remark'
    }], { importBatchId: 'new-import', idFactory: () => 'must-not-insert' });
    assert.equal(result.result.inserted, 0);
    assert.equal(result.result.updated, 1);
    assert.equal(result.result.skipped, 0);
    const stored = raw.prepare('SELECT * FROM sales_records WHERE id = ?').get('sale-legacy-case');
    assert.equal(stored.source_system, 'Bigseller');
    assert.equal(stored.original_order_status, '已完成');
    assert.equal(stored.quantity, 2);
    assert.equal(stored.order_date, '2026-10-30');
    assert.equal(stored.remark, 'legacy remark');
    assert.equal(raw.prepare('SELECT COUNT(*) AS count FROM sales_records').get().count, 1);
  } finally {
    raw.close();
  }
});


test('BigSeller brand is resolved from the PSI SKU master; missing SKU or empty master brand blocks import', async () => {
  const SalesImport = require('../sales-import-service');
  const parsed = BigSeller.parseBigSellerWorkbook(workbook([
    ['2026-11-06 18:18', 'ORDER-BRAND-1', '', '已完成', 'Redragon Warehouse', 'M724', '1', 'PKG-1', 'Shopee', 'Redragon Indonesia OS'],
    ['2026-11-06 18:08', 'ORDER-BRAND-2', '', '已完成', 'Redragon Warehouse', 'M995', '2', 'PKG-2', 'Shopee', 'Redragon Indonesia OS']
  ]), 'orders.xlsx', fakeXlsx());
  assert.ok(parsed);
  assert.deepEqual(parsed.records.map(record => record.brand), ['', '']);

  const rows = SalesImport.normalizeSalesRows(parsed.records);
  const masterAdapter = {
    loadSkuBrands: async () => new Map([
      ['M724', { sku_code: 'M724', brand: 'Redragon' }],
      ['M995', { sku_code: 'M995', brand: 'Redragon' }]
    ])
  };
  const valid = await SalesImport.validateSalesBrandRows(masterAdapter, rows);
  assert.equal(valid.failures.length, 0);
  assert.deepEqual(rows.map(record => record.brand), ['Redragon', 'Redragon']);

  const unknownRows = SalesImport.normalizeSalesRows([
    { ...parsed.records[0], sku_code: 'UNKNOWN-SKU' }
  ]);
  const unknown = await SalesImport.validateSalesBrandRows({
    loadSkuBrands: async () => new Map()
  }, unknownRows);
  assert.equal(unknown.failures.length, 1);
  assert.match(unknown.failures[0].reason, /SKU 主数据不存在/);

  const emptyBrandRows = SalesImport.normalizeSalesRows([
    { ...parsed.records[0], sku_code: 'M724' }
  ]);
  const emptyBrand = await SalesImport.validateSalesBrandRows({
    loadSkuBrands: async () => new Map([['M724', { sku_code: 'M724', brand: '' }]])
  }, emptyBrandRows);
  assert.equal(emptyBrand.failures.length, 1);
  assert.match(emptyBrand.failures[0].reason, /SKU 主数据品牌为空/);
});


test('same order with multiple SKUs stays as separate sales lines', () => {
  const parsed = BigSeller.parseBigSellerWorkbook(workbook([
    ['2026-11-06 10:00', 'ORDER-MULTI', '', '已完成', 'Redragon Warehouse', 'M724', '1', 'PKG-1', 'Shopee', 'Redragon Indonesia OS'],
    ['2026-11-06 10:00', 'ORDER-MULTI', '', '已完成', 'Redragon Warehouse', 'K617', '2', 'PKG-1', 'Shopee', 'Redragon Indonesia OS']
  ]), 'orders.xlsx', fakeXlsx());
  assert.equal(parsed.records.length, 2);
  assert.deepEqual(parsed.records.map(record => record.sku_code), ['M724', 'K617']);
  assert.equal(parsed.stats.conflictGroups, 0);
});

test('exact duplicate order-item rows are deduplicated without adding quantity', () => {
  const row = ['2026-11-06 10:00', 'ORDER-DUP', '', '已完成', 'Redragon Warehouse', 'M724', '2', 'PKG-1', 'Shopee', 'Redragon Indonesia OS'];
  const parsed = BigSeller.parseBigSellerWorkbook(workbook([row, row]), 'orders.xlsx', fakeXlsx());
  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.records[0].quantity, 2);
  assert.equal(parsed.stats.exactDuplicateRows, 1);
  assert.equal(parsed.stats.includedRows, 1);
});

test('quantity or package conflicts quarantine the entire same order-item group', () => {
  const parsed = BigSeller.parseBigSellerWorkbook(workbook([
    ['2026-11-06 10:00', 'ORDER-CONFLICT', '', '已完成', 'Redragon Warehouse', 'M724', '2', 'PKG-1', 'Shopee', 'Redragon Indonesia OS'],
    ['2026-11-06 10:01', 'ORDER-CONFLICT', '', '已完成', 'Redragon Warehouse', 'M724', '3', 'PKG-1', 'Shopee', 'Redragon Indonesia OS'],
    ['2026-11-06 10:02', 'ORDER-CONFLICT', '', '已完成', 'Redragon Warehouse', 'K617', '1', 'PKG-2', 'Shopee', 'Redragon Indonesia OS']
  ]), 'orders.xlsx', fakeXlsx());
  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.records[0].sku_code, 'K617');
  assert.equal(parsed.stats.conflictGroups, 1);
  assert.equal(parsed.stats.excludedConflictRows, 2);
  assert.equal(parsed.stats.conflictDetails[0].reason, '数量不同');
});

test('same order item status snapshots keep one quantity and use latest status', () => {
  const parsed = BigSeller.parseBigSellerWorkbook(workbook([
    ['2026-11-06 10:00', 'ORDER-STATUS', '', '平台处理中', 'Redragon Warehouse', 'M724', '2', 'PKG-1', 'Shopee', 'Redragon Indonesia OS'],
    ['2026-11-06 10:05', 'ORDER-STATUS', '', '退货退款', 'Redragon Warehouse', 'M724', '2', 'PKG-1', 'Shopee', 'Redragon Indonesia OS']
  ]), 'orders.xlsx', fakeXlsx());
  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.records[0].quantity, 2);
  assert.equal(parsed.records[0].original_order_status, '退货退款');
  assert.equal(parsed.records[0].is_valid_order, 0);
  assert.equal(parsed.stats.snapshotDuplicateRows, 1);
});

test('same timestamp with different statuses is quarantined for manual review', () => {
  const parsed = BigSeller.parseBigSellerWorkbook(workbook([
    ['2026-11-06 10:00', 'ORDER-STATUS-CONFLICT', '', '平台处理中', 'Redragon Warehouse', 'M724', '2', 'PKG-1', 'Shopee', 'Redragon Indonesia OS'],
    ['2026-11-06 10:00', 'ORDER-STATUS-CONFLICT', '', '已完成', 'Redragon Warehouse', 'M724', '2', 'PKG-1', 'Shopee', 'Redragon Indonesia OS']
  ]), 'orders.xlsx', fakeXlsx());
  assert.equal(parsed.records.length, 0);
  assert.equal(parsed.stats.conflictGroups, 1);
  assert.equal(parsed.stats.conflictDetails[0].reason, '相同时间存在不同订单状态');
});

test('Manual blank-marker rows are excluded while Pay in Advance and Credit remain offline', () => {
  const parsed = BigSeller.parseBigSellerWorkbook(workbook([
    ['2026-11-06 10:00', 'ORDER-MANUAL-BLANK', '', '已完成', 'Warehouse', 'M724', '1', 'PKG-1', 'Manual', 'Netac Official Store'],
    ['2026-11-06 10:01', 'ORDER-PA', 'Reseller Order-Pay in Advance', '已完成', 'Warehouse', 'M995', '1', 'PKG-2', 'Manual', 'Netac Official Store'],
    ['2026-11-06 10:02', 'ORDER-CREDIT', 'Reseller Order- Credit', '已完成', 'Warehouse', 'K617', '1', 'PKG-3', 'Manual', 'Netac Official Store']
  ]), 'orders.xlsx', fakeXlsx());
  assert.equal(parsed.records.length, 2);
  assert.deepEqual(parsed.records.map(record => record.shop_platform), ['线下渠道', '线下渠道']);
  assert.equal(parsed.stats.excludedMarkerRows, 1);
  assert.equal(parsed.stats.excludedMarkers['（Manual + 空白订单标记）'], 1);
});


test('BigSeller parser validation errors and original Excel row numbers reach the sales import classifier', () => {
  const SalesImport = require('../sales-import-service');
  const parsed = BigSeller.parseBigSellerWorkbook(workbook([
    ['2026-11-06 10:00', 'ORDER-VALIDATION', '', '已完成', 'Redragon Warehouse', 'M724', '0', 'PKG-1', 'Shopee', 'Redragon Indonesia OS']
  ]), 'orders.xlsx', fakeXlsx());
  const rows = SalesImport.normalizeSalesRows(parsed.records);
  assert.equal(rows[0].source_row_no, 2);
  assert.ok(rows[0].errors.some(reason => reason.includes('数量必须为正整数')));
});


test('invalid source rows are not counted as pending import rows', () => {
  const parsed = BigSeller.parseBigSellerWorkbook(workbook([
    ['2026-11-06 10:00', 'ORDER-INVALID', '', '已完成', 'Redragon Warehouse', 'M724', '0', 'PKG-1', 'Shopee', 'Redragon Indonesia OS']
  ]), 'orders.xlsx', fakeXlsx());
  assert.equal(parsed.records.length, 1, 'keep invalid row visible for row-level correction');
  assert.equal(parsed.stats.includedRows, 0, 'invalid row must not inflate pending import count');
  assert.equal(parsed.stats.validationErrorRows, 1);
});

test('opening a new import clears stale file data and preview state', () => {
  const stats = { innerHTML: 'old summary', insertAdjacentHTML(position, html) { this.innerHTML += html; } };
  const button = { disabled: false };
  const win = {
    document: { getElementById(id) { return id === 'sales-preview-stats' ? stats : id === 'sales-import-btn' ? button : null; } },
    handleSalesFile() {}, openSalesBatchImport() {}, requestSalesPreview: async () => ({}),
    renderSalesPreview(rows) { this.lastRenderedRows = rows; }
  };
  BigSeller.install(win);
  win._salesImportData = [{ order_no: 'OLD' }];
  win._salesImportPreviewReady = true;
  win._lastSalesImportErrors = [{ row: 2, reason: 'old error' }];
  win.openSalesBatchImport();
  assert.deepEqual(win._salesImportData, []);
  assert.equal(win._salesImportPreviewReady, false);
  assert.deepEqual(win._lastSalesImportErrors, []);
  assert.equal(stats.innerHTML, '');
  assert.equal(button.disabled, true);
  assert.deepEqual(win.lastRenderedRows, []);
});

test('repeated BigSeller preview replaces its summary instead of stacking duplicates', async () => {
  const stats = { innerHTML: '', insertAdjacentHTML(position, html) { this.innerHTML += html; } };
  const button = { disabled: false };
  const win = {
    document: { getElementById(id) { return id === 'sales-preview-stats' ? stats : id === 'sales-import-btn' ? button : null; } },
    handleSalesFile() {}, openSalesBatchImport() {}, requestSalesPreview: async () => ({}), renderSalesPreview() {}
  };
  BigSeller.install(win);
  win._salesImportSourceMode = 'bigseller';
  win._salesImportSkippedStats = { sourceRows: 1, includedRows: 1, trueRows: 1, falseRows: 0 };
  win._salesImportCountry = '印度尼西亚';
  await win.requestSalesPreview();
  await win.requestSalesPreview();
  assert.equal((stats.innerHTML.match(/已识别 BigSeller 销售数据/g) || []).length, 1);
});
