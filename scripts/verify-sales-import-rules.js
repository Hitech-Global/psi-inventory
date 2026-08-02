#!/usr/bin/env node

/**
 * Read-only Checkpoint 1 verifier.
 * It compares a small in-memory reproduction of the current formal route
 * with sales-import-service's shared classifier. No project database is used.
 */

const assert = require('assert');
const {
  normalizeSalesRows,
  classifySalesRows,
  buildSalesPreview
} = require('../sales-import-service');

function legacyFormalImport(items, initialRecords, importBatchId = 'baseline-batch') {
  const records = initialRecords.map(record => ({ ...record }));
  const result = { total: items.length, inserted: 0, updated: 0, skipped: 0, failed: 0, errors: [] };
  let nextId = 1;
  const idFactory = () => `legacy_sale_${nextId++}`;

  const findByDetail = item => item.order_detail_id && records.find(record =>
    (record.source_system || '') === item.source_system &&
    (record.order_detail_id || '') === item.order_detail_id
  );
  const findByBusiness = item => records.find(record =>
    (record.source_system || '') === (item.source_system || '') &&
    (record.order_no || '') === (item.order_no || '') &&
    (record.sku_code || '') === (item.sku_code || '') &&
    (record.shop_platform || '') === (item.shop_platform || '')
  );

  items.forEach((item, index) => {
    try {
      if (!item.sku_code) { result.failed++; result.errors.push({ row: index + 2, reason: 'SKU不能为空' }); return; }
      if (!item.source_system) { result.failed++; result.errors.push({ row: index + 2, reason: '来源系统不能为空' }); return; }
      if (!item.order_no) { result.failed++; result.errors.push({ row: index + 2, reason: '订单号不能为空' }); return; }
      const rows = normalizeSalesRows([item]);
      const row = rows[0];
      if (!row.order_date) {
        result.failed++;
        result.errors.push({ row: index + 2, reason: '下单日期格式无法识别：' + item.order_date });
        return;
      }
      const existing = findByDetail(item) || findByBusiness(item);
      if (existing) {
        const changed = existing.is_valid_order !== row.is_valid_order ||
          existing.quantity !== row.quantity ||
          (existing.shop_platform || '') !== row.shop_platform ||
          (existing.original_order_status || '') !== row.original_order_status ||
          (existing.brand || '') !== row.brand ||
          (existing.remark || '') !== row.remark;
        if (!changed) { result.skipped++; return; }
        const nextBusiness = [
          existing.source_system || '', item.order_no || '', existing.sku_code || item.sku_code || '', row.shop_platform
        ].join('\u0000');
        const conflict = records.some(record => record.id !== existing.id && [
          record.source_system || '', record.order_no || '', record.sku_code || '', record.shop_platform || ''
        ].join('\u0000') === nextBusiness);
        if (conflict) {
          result.skipped++;
          result.errors.push({ row: index + 2, reason: '重复记录（唯一约束）' });
          return;
        }
        existing.order_date = row.order_date;
        existing.shop_platform = row.shop_platform;
        existing.brand = row.brand;
        existing.quantity = row.quantity;
        existing.is_valid_order = row.is_valid_order;
        existing.original_order_status = row.original_order_status;
        existing.remark = row.remark;
        existing.import_batch_id = importBatchId;
        result.updated++;
      } else {
        records.push({
          id: idFactory(), source_system: row.source_system, order_no: row.order_no,
          order_detail_id: row.order_detail_id, order_date: row.order_date,
          shop_platform: row.shop_platform, brand: row.brand, sku_code: row.sku_code,
          quantity: row.quantity, is_valid_order: row.is_valid_order,
          original_order_status: row.original_order_status, remark: row.remark,
          import_batch_id: importBatchId
        });
        result.inserted++;
      }
    } catch (error) {
      result.failed++;
      result.errors.push({ row: index + 2, reason: error.message });
    }
  });
  return { result, records };
}

function comparable(value) {
  return JSON.parse(JSON.stringify(value));
}

const fixtures = [
  {
    name: 'insert',
    initial: [],
    items: [{ source_system: 'S', order_no: 'O1', order_detail_id: 'D1', order_date: '2026-01-01', sku_code: 'A', quantity: 1, brand: 'B' }]
  },
  {
    name: 'existing_exact_skip',
    initial: [{ id: 'seed-1', source_system: 'S', order_no: 'O2', order_detail_id: 'D2', order_date: '2026-01-01', shop_platform: '', brand: 'B', sku_code: 'A', quantity: 1, is_valid_order: 1, original_order_status: '', remark: '' }],
    items: [{ source_system: 'S', order_no: 'O2', order_detail_id: 'D2', order_date: '2026-01-01', sku_code: 'A', quantity: 1, brand: 'B' }]
  },
  {
    name: 'existing_mutable_update',
    initial: [{ id: 'seed-2', source_system: 'S', order_no: 'O3', order_detail_id: 'D3', order_date: '2026-01-01', shop_platform: '', brand: 'B', sku_code: 'A', quantity: 1, is_valid_order: 1, original_order_status: '', remark: '' }],
    items: [{ source_system: 'S', order_no: 'O3', order_detail_id: 'D3', order_date: '2026-01-01', sku_code: 'A', quantity: 3, brand: 'B' }]
  },
  {
    name: 'date_only_is_skip',
    initial: [{ id: 'seed-3', source_system: 'S', order_no: 'O4', order_detail_id: 'D4', order_date: '2026-01-01', shop_platform: '', brand: 'B', sku_code: 'A', quantity: 1, is_valid_order: 1, original_order_status: '', remark: '' }],
    items: [{ source_system: 'S', order_no: 'O4', order_detail_id: 'D4', order_date: '2026-02-01', sku_code: 'A', quantity: 1, brand: 'B' }]
  },
  {
    name: 'same_detail_insert_then_update',
    initial: [],
    items: [
      { source_system: 'S', order_no: 'O5', order_detail_id: 'D5', order_date: '2026-01-01', sku_code: 'A', quantity: 1, brand: 'B' },
      { source_system: 'S', order_no: 'O5', order_detail_id: 'D5', order_date: '2026-01-01', sku_code: 'A', quantity: 2, brand: 'B' }
    ]
  },
  {
    name: 'same_business_key_exact_duplicate',
    initial: [],
    items: [
      { source_system: 'S', order_no: 'O6', order_date: '2026-01-01', sku_code: 'A', quantity: 1, brand: 'B' },
      { source_system: 'S', order_no: 'O6', order_date: '2026-01-01', sku_code: 'A', quantity: 1, brand: 'B' }
    ]
  },
  {
    name: 'same_business_key_changed_value',
    initial: [],
    items: [
      { source_system: 'S', order_no: 'O7', order_date: '2026-01-01', sku_code: 'A', quantity: 1, brand: 'B' },
      { source_system: 'S', order_no: 'O7', order_date: '2026-01-01', sku_code: 'A', quantity: 4, brand: 'B' }
    ]
  },
  {
    name: 'invalid_does_not_block_next_valid',
    initial: [],
    items: [
      { source_system: 'S', order_no: 'O8', order_date: '2026-01-01', sku_code: '', quantity: 1 },
      { source_system: 'S', order_no: 'O9', order_date: '2026-01-01', sku_code: 'A', quantity: 1 }
    ]
  },
  {
    name: 'detail_identity_does_not_rewrite_business_identity',
    initial: [{ id: 'seed-9', source_system: 'S', order_no: 'O9', order_detail_id: 'D9', order_date: '2026-01-01', shop_platform: '', brand: 'B', sku_code: 'A', quantity: 1, is_valid_order: 1, original_order_status: '', remark: '' }],
    items: [{ source_system: 'S', order_no: 'O9-new', order_detail_id: 'D9', order_date: '2026-01-01', sku_code: 'A-new', quantity: 2, brand: 'B' }]
  }
];

const output = [];
for (const fixture of fixtures) {
  const legacy = legacyFormalImport(fixture.items, fixture.initial);
  const rows = normalizeSalesRows(fixture.items);
  let modernId = 0;
  const modern = classifySalesRows(rows, fixture.initial, {
    importBatchId: 'baseline-batch',
    idFactory: () => `legacy_sale_${++modernId}`
  });
  assert.deepStrictEqual(comparable(modern.result), comparable(legacy.result), fixture.name + ' result');
  assert.deepStrictEqual(comparable(modern.records), comparable(legacy.records), fixture.name + ' records');
  const preview = buildSalesPreview(rows, modern);
  assert.deepStrictEqual(preview.map(item => item.action), modern.classified.map(item => item.action), fixture.name + ' preview/apply actions');
  output.push({
    name: fixture.name,
    result: modern.result,
    actions: modern.classified.map(item => ({ row: item.row.source_row_no, action: item.action })),
    final_records: modern.records
  });
}

console.log(JSON.stringify({ checkpoint: '1-rule-equivalence', passed: true, fixtures: output }, null, 2));
