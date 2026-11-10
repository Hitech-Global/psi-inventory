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
  assert.match(record.remark, /仓库=至速仓/);
  assert.match(record.remark, /源文件仓库=吉隆坡一号仓/);
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

test('storefront determines sales country and Singapore can ship via Malaysia Zhisu', () => {
  const parsed = Zhisu.parseZhisuWorkbook(workbook([
    row({ 2: 'MY-1', 6: '吉隆坡一号仓' }),
    row({ 2: 'TH-1', 5: 'Redragon TH OS(TH)', 6: '泰国一号仓', 0: 'EC-TH-1' }),
    row({ 2: 'SG-VIA-MY', 5: 'Shopee Redragon Store SG(SG)', 6: '吉隆坡一号仓', 0: 'EC-SG-1' }),
    row({ 2: 'SG-LOGICAL-WH', 5: 'Shopee Redragon Store SG(SG)', 6: '新加坡仓', 0: 'EC-SG-2' }),
    row({ 2: 'UNKNOWN-WH', 5: 'Unknown Store', 6: '未知仓库', 0: 'EC-UNKNOWN-1' })
  ]), 'orders.xlsx', fakeXlsx());
  assert.deepEqual(parsed.records.map(record => record.country), ['马来西亚', '泰国', '新加坡', '新加坡', '']);
  assert.equal(parsed.records[2].source_system, '至速仓');
  assert.equal(parsed.records[2].shop_platform, '线上渠道');
  assert.match(parsed.records[2].remark, /仓库=至速仓/);
  assert.match(parsed.records[2].remark, /源文件仓库=吉隆坡一号仓/);
  assert.match(parsed.records[3].remark, /源文件仓库=新加坡仓/);
  assert.ok(parsed.records[4]._errors.some(error => error.includes('无法识别至速仓发货仓库与销售国家')));
  assert.equal(parsed.stats.unknownWarehouseRows, 1);
  assert.equal(parsed.warehouseCounts['至速仓'], 5);
  assert.equal(parsed.countryCounts['马来西亚'], 1);
  assert.equal(parsed.countryCounts['泰国'], 1);
  assert.equal(parsed.countryCounts['新加坡'], 2);
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

test('blank SKU rows are excluded; unknown warehouse and invalid quantity remain blocking errors', () => {
  const parsed = Zhisu.parseZhisuWorkbook(workbook([
    row({ 2: 'ORDER-UNKNOWN-WH', 6: '未知仓库' }),
    row({ 2: 'ORDER-NO-SKU', 22: '' }),
    row({ 2: 'ORDER-NO-QTY', 25: '' }),
    row({ 2: 'ORDER-NO-SKU-OR-QTY', 22: '', 25: '' })
  ]), 'orders.xlsx', fakeXlsx());
  assert.equal(parsed.stats.sourceRows, 4);
  assert.equal(parsed.stats.excludedBlankSkuRows, 2);
  assert.equal(parsed.stats.unknownWarehouseRows, 1);
  assert.equal(parsed.stats.validationErrorRows, 2);
  assert.equal(parsed.records.length, 2);
  assert.ok(parsed.records[0]._errors.some(error => error.includes('无法识别至速仓发货仓库与销售国家')));
  assert.ok(parsed.records[1]._errors.some(error => error.includes('发货数量')));
  assert.ok(parsed.records.every(record => record.sku_code));
  assert.ok(parsed.records.every(record => !record._errors.some(error => error.includes('SKU 为空'))));
});

test('FO SKU rows are excluded and Zhisu K686WB aliases normalize to PSI master SKUs', async () => {
  const parsed = Zhisu.parseZhisuWorkbook(workbook([
    row({ 2: 'ORDER-FO-UPPER', 22: 'FO' }),
    row({ 2: 'ORDER-FO-LOWER', 22: 'fo', 0: 'EC-MY-FO-2' }),
    row({ 2: 'ORDER-K686-RS', 22: 'K686WB-RGB-PRO-RS', 0: 'EC-MY-RS' }),
    row({ 2: 'ORDER-K686-BS', 22: 'K686WB-RGB-PRO-BS', 0: 'EC-MY-BS' })
  ]), 'orders.xlsx', fakeXlsx());

  assert.equal(parsed.stats.sourceRows, 4);
  assert.equal(parsed.stats.excludedFoSkuRows, 2);
  assert.equal(parsed.stats.includedRows, 2);
  assert.equal(parsed.records.length, 2);
  assert.deepEqual(parsed.records.map(record => record.sku_code), [
    'RDK686WBRGBPRORS',
    'RDK686WBRGBPROBS'
  ]);

  const rows = SalesImport.normalizeSalesRows(parsed.records);
  const result = await SalesImport.validateSalesBrandRows({
    loadSkuBrands: async () => new Map([
      ['RDK686WBRGBPRORS', { sku_code: 'RDK686WBRGBPRORS', brand: 'Redragon' }],
      ['RDK686WBRGBPROBS', { sku_code: 'RDK686WBRGBPROBS', brand: 'Redragon' }]
    ])
  }, rows);

  assert.equal(result.failures.length, 0);
  assert.deepEqual(rows.map(record => record.brand), ['Redragon', 'Redragon']);
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


function createZhisuUiHarness(precheck) {
  const inserted = [];
  const statsElement = {
    innerHTML: '<div id="server-precheck-result">原始后台预检查结果：UNKNOWN-SKU</div>',
    querySelector: () => null,
    insertAdjacentHTML(position, html) {
      inserted.push({ position, html });
      this.innerHTML = position === 'afterbegin' ? html + this.innerHTML : this.innerHTML + html;
    }
  };
  const importButton = { disabled: true };
  const win = {
    handleSalesFile() {},
    openSalesBatchImport() {},
    showToast() {},
    document: {
      getElementById(id) {
        if (id === 'sales-preview-stats') return statsElement;
        if (id === 'sales-import-btn') return importButton;
        return null;
      }
    },
    _salesImportSourceMode: 'zhisu',
    _salesImportZhisuStats: {
      sourceRows: 10,
      includedRows: 8,
      trueRows: 7,
      falseRows: 1,
      excludedBlankPaymentRows: 1,
      excludedUnpaidRows: 0,
      excludedBlankSkuRows: 1,
      exactDuplicateRows: 0,
      duplicateOrderItemRows: 0,
      validationErrorRows: 0,
      conflictGroups: 0
    },
    _salesImportZhisuWarehouseCounts: { '至速仓': 8 },
    _salesImportZhisuCountryCounts: { '新加坡': 1, '马来西亚': 7 },
    requestSalesPreview: async function () {
      if (precheck.error) {
        win.showToast(precheck.error, 'danger');
        win._salesImportPreviewReady = false;
        win._salesImportBlocking = [];
        return;
      }
      win._salesImportPreviewReady = precheck.ready;
      win._salesImportBlocking = precheck.blocking || [];
      win._lastSalesImportErrors = (precheck.blocking || []).map(item => ({
        row: item.row, reason: item.reason
      }));
    }
  };
  Zhisu.install(win);
  return { win, statsElement, importButton, inserted };
}

test('Zhisu preview keeps backend SKU/brand blockers visible and keeps import disabled', async () => {
  const harness = createZhisuUiHarness({
    ready: false,
    blocking: [{ row: 17, sku_code: 'UNKNOWN-SKU', reason: 'SKU 主数据不存在：UNKNOWN-SKU' }]
  });
  await harness.win.requestSalesPreview();
  assert.equal(harness.importButton.disabled, true);
  assert.ok(harness.statsElement.innerHTML.includes('原始后台预检查结果'));
  assert.ok(harness.statsElement.innerHTML.includes('SKU / 品牌后台预检查未通过：1 条'));
  assert.ok(harness.statsElement.innerHTML.includes('UNKNOWN-SKU'));
  assert.equal(harness.inserted[0].position, 'afterbegin');
});

test('Zhisu preview enables import only after backend SKU/brand precheck passes', async () => {
  const harness = createZhisuUiHarness({ ready: true, blocking: [] });
  await harness.win.requestSalesPreview();
  assert.equal(harness.importButton.disabled, false);
  assert.ok(harness.statsElement.innerHTML.includes('SKU / 品牌后台预检查通过'));
  assert.ok(harness.statsElement.innerHTML.includes('原始后台预检查结果'));
});

test('Zhisu preview displays backend preview request failures instead of hiding them', async () => {
  const harness = createZhisuUiHarness({ error: '预览失败: HTTP 500' });
  await harness.win.requestSalesPreview();
  assert.equal(harness.importButton.disabled, true);
  assert.ok(harness.statsElement.innerHTML.includes('SKU / 品牌后台预检查请求失败'));
  assert.ok(harness.statsElement.innerHTML.includes('HTTP 500'));
});
