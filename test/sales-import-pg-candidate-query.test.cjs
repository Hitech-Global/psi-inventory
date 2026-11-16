'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPostgresSalesImportAdapter } = require('../sales-import-service');

test('PostgreSQL sales candidate matching analyzes staging rows and uses set-based joins', async () => {
  const calls = [];
  const db = {
    async run(sql, params = []) {
      calls.push({ type: 'run', sql, params });
      return { rowCount: 1 };
    },
    async query(sql, params = []) {
      calls.push({ type: 'query', sql, params });
      return { rows: [] };
    }
  };
  const adapter = createPostgresSalesImportAdapter(db, { batchSize: 1000 });
  await adapter.stageRows([{
    source_row_no: 2,
    input_order: 0,
    source_system: 'BigSeller',
    order_no: 'ORDER-1',
    order_detail_id: 'DETAIL-1',
    order_date: '2026-11-16',
    shop_platform: 'Shopee',
    brand: 'Redragon',
    sku_code: 'M724',
    quantity: 1,
    is_valid_order: 1,
    original_order_status: 'Completed',
    remark: '',
    country: '印度尼西亚',
    errors: []
  }]);
  await adapter.loadCandidates();

  const analyzeIndex = calls.findIndex(call => call.type === 'run' && /^ANALYZE\s+/i.test(call.sql.trim()));
  const matchIndex = calls.findIndex(call => call.type === 'query');
  assert.ok(analyzeIndex >= 0, 'staging table must be analyzed after bulk load');
  assert.ok(matchIndex > analyzeIndex, 'candidate lookup must run after ANALYZE');

  const sql = calls[matchIndex].sql;
  assert.match(sql, /WITH matched_ids AS/i);
  assert.match(sql, /UNION/i);
  assert.match(sql, /JOIN\s+"?sales_import_stage_/i);
  assert.match(sql, /FROM\s+sales_records\s+sr/i);
  assert.match(sql, /CASE WHEN lower\(sr\.source_system\)='bigseller'/i);
  assert.match(sql, /CASE WHEN lower\(s\.source_system\)='bigseller'/i);
  assert.match(sql, /WHERE sr\.id IN \(SELECT id FROM matched_ids\)/i);
  assert.doesNotMatch(sql, /EXISTS\s*\(/i, 'avoid correlated EXISTS scans over the full sales table');
  assert.doesNotMatch(sql, /\)\s*OR\s*EXISTS/i);
});
