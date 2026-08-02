#!/usr/bin/env node

/**
 * Checkpoint 2 integration/contract verifier.
 *
 * The SQLite run uses a disposable database in /private/tmp.  The PostgreSQL
 * run uses a deterministic in-memory DB contract double because this checkout
 * has no isolated PostgreSQL server.  The double executes the adapter's
 * staging/plan contract and counts every round trip; it never touches the
 * project database or a production connection.
 */

const assert = require('assert');
const fs = require('fs');

const dbPath = '/private/tmp/inventory-app-sales-import-checkpoint2.sqlite';
try { fs.unlinkSync(dbPath); } catch (_) {}
process.env.DB_PATH = dbPath;

const sqliteDb = require('../db-sqlite');
const {
  normalizeSalesRows,
  classifySalesRows,
  previewSalesImport,
  executeSalesImport,
  createSqliteSalesImportAdapter,
  createPostgresSalesImportAdapter
} = require('../sales-import-service');
const { _normalizeSql: normalizePgSql } = require('../db-pg');

const raw = sqliteDb.getDB();
raw.exec(`
  CREATE TABLE sales_records (
    id TEXT PRIMARY KEY,
    source_system TEXT NOT NULL DEFAULT '',
    order_no TEXT NOT NULL DEFAULT '',
    order_detail_id TEXT DEFAULT '',
    order_date TEXT,
    shop_platform TEXT DEFAULT '',
    brand TEXT DEFAULT '',
    sku_code TEXT NOT NULL DEFAULT '',
    quantity INTEGER DEFAULT 0,
    is_valid_order INTEGER DEFAULT 1,
    original_order_status TEXT DEFAULT '',
    remark TEXT DEFAULT '',
    import_batch_id TEXT DEFAULT '',
    created_at TEXT DEFAULT '',
    updated_at TEXT DEFAULT ''
  )
`);

const fields = [
  'id', 'source_system', 'order_no', 'order_detail_id', 'order_date',
  'shop_platform', 'brand', 'sku_code', 'quantity', 'is_valid_order',
  'original_order_status', 'remark', 'import_batch_id'
];

function stored(record) {
  return {
    id: String(record.id),
    source_system: record.source_system || '',
    order_no: record.order_no || '',
    order_detail_id: record.order_detail_id || '',
    order_date: record.order_date || null,
    shop_platform: record.shop_platform || '',
    brand: record.brand || '',
    sku_code: record.sku_code || '',
    quantity: record.quantity || 0,
    is_valid_order: record.is_valid_order === undefined ? 1 : record.is_valid_order,
    original_order_status: record.original_order_status || '',
    remark: record.remark || '',
    import_batch_id: record.import_batch_id || ''
  };
}

function snapshotSqlite() {
  return sqliteDb.query(`SELECT ${fields.join(', ')} FROM sales_records ORDER BY id`).rows.map(stored);
}

function resetSqlite(records) {
  raw.exec('DELETE FROM sales_records');
  for (const record of records.map(stored)) {
    sqliteDb.run(`INSERT INTO sales_records (${fields.join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`, fields.map(field => record[field]));
  }
}

function comparable(value) {
  return JSON.parse(JSON.stringify(value));
}

function sortedRecords(records) {
  return records.map(stored).sort((a, b) => a.id.localeCompare(b.id));
}

function assertNoBusinessDuplicates(records, label) {
  const keys = records.map(record => JSON.stringify([
    record.source_system || '', record.order_no || '', record.sku_code || '', record.shop_platform || ''
  ]));
  assert.strictEqual(new Set(keys).size, keys.length, `${label}: duplicate business key`);
}

function expectedFor(items, initial, importBatchId) {
  const rows = normalizeSalesRows(items);
  return classifySalesRows(rows, initial.map(stored), {
    importBatchId,
    idFactory: row => `legacy_sale_${row.input_order + 1}`
  });
}

const fixtures = [
  {
    name: 'mixed_insert_update_skip_error',
    initial: [stored({ id: 'seed-1', source_system: 'S', order_no: 'O1', order_detail_id: 'D1', order_date: '2026-01-01', sku_code: 'A', quantity: 1, brand: 'B' })],
    items: [
      { source_system: 'S', order_no: 'O1', order_detail_id: 'D1', order_date: '2026-02-01', sku_code: 'A', quantity: 3, brand: 'B' },
      { source_system: 'S', order_no: 'O2', order_date: '2026-01-01', sku_code: 'A', quantity: 1, brand: 'B' },
      { source_system: 'S', order_no: 'O2', order_date: '2026-01-01', sku_code: 'A', quantity: 1, brand: 'B' },
      { source_system: 'S', order_no: 'O3', order_date: '2026-01-01', sku_code: '', quantity: 1 },
      { source_system: 'S', order_no: 'O1', order_detail_id: 'D1', order_date: '2026-03-01', sku_code: 'A', quantity: 4, brand: 'B' }
    ]
  },
  {
    name: 'same_detail_multiple_updates_last_wins',
    initial: [stored({ id: 'seed-2', source_system: 'S', order_no: 'O4', order_detail_id: 'D4', order_date: '2026-01-01', sku_code: 'A', quantity: 1, brand: 'B' })],
    items: [
      { source_system: 'S', order_no: 'O4', order_detail_id: 'D4', order_date: '2026-01-01', sku_code: 'A', quantity: 2, brand: 'B' },
      { source_system: 'S', order_no: 'O4', order_detail_id: 'D4', order_date: '2026-01-01', sku_code: 'A', quantity: 5, brand: 'B' },
      { source_system: 'S', order_no: 'O4', order_detail_id: 'D4', order_date: '2026-02-01', sku_code: 'A', quantity: 5, brand: 'B' }
    ]
  },
  {
    name: 'business_key_duplicate_and_new',
    initial: [],
    items: [
      { source_system: 'S', order_no: 'O5', order_date: '2026-01-01', sku_code: 'A', quantity: 1, brand: 'B' },
      { source_system: 'S', order_no: 'O5', order_date: '2026-01-01', sku_code: 'A', quantity: 4, brand: 'B' },
      { source_system: 'S', order_no: 'O6', order_detail_id: 'D6', order_date: '2026-01-01', sku_code: 'A', quantity: 2, brand: 'B' }
    ]
  }
];

async function runSqliteFixture(fixture) {
  const batchId = `checkpoint2-${fixture.name}`;
  resetSqlite(fixture.initial);
  const expected = expectedFor(fixture.items, fixture.initial, batchId);
  const before = snapshotSqlite();

  resetSqlite(fixture.initial);
  const previewAdapter = createSqliteSalesImportAdapter(sqliteDb, { batchSize: 80 });
  const preview = await previewSalesImport(previewAdapter, fixture.items, { importBatchId: batchId, idFactory: row => `legacy_sale_${row.input_order + 1}` });
  assert.deepStrictEqual(comparable(preview.classification.result), comparable(expected.result), `${fixture.name}: preview result`);
  assert.deepStrictEqual(preview.preview.map(item => item.action), expected.classified.map(item => item.action), `${fixture.name}: preview actions`);
  assert.deepStrictEqual(snapshotSqlite(), before.length ? before : fixture.initial.map(stored), `${fixture.name}: preview must not write sales_records`);

  resetSqlite(fixture.initial);
  const applyAdapter = createSqliteSalesImportAdapter(sqliteDb, { batchSize: 80 });
  const applied = await executeSalesImport(applyAdapter, fixture.items, { importBatchId: batchId, idFactory: row => `legacy_sale_${row.input_order + 1}` });
  assert.deepStrictEqual(comparable(applied.result), comparable(expected.result), `${fixture.name}: apply result`);
  assert.deepStrictEqual(comparable(preview.preview), comparable(applied.preview), `${fixture.name}: preview/apply rows and errors`);
  assert.deepStrictEqual(snapshotSqlite(), sortedRecords(expected.records), `${fixture.name}: final records`);
  assertNoBusinessDuplicates(snapshotSqlite(), `${fixture.name}: SQLite`);
  assert.strictEqual(applied.metrics.queryOne, 0, `${fixture.name}: queryOne must be zero`);
  return { name: fixture.name, result: applied.result, timings: applied.timings, metrics: applied.metrics };
}

class FakePostgresDb {
  constructor(records) {
    this.records = records.map(stored);
    this.stage = [];
    this.plan = [];
    this.calls = [];
  }

  async transaction(fn) { return fn(); }

  async run(sql, params = []) {
    this.calls.push({ type: 'run', sql });
    if (/jsonb_to_recordset/.test(sql)) {
      const rows = JSON.parse(params[0] || '[]');
      if (rows.length && Object.prototype.hasOwnProperty.call(rows[0], 'action')) this.plan.push(...rows);
      else this.stage.push(...rows);
      return { rowCount: rows.length };
    }
    if (/UPDATE sales_records/.test(sql)) {
      const importBatchId = params[0] || '';
      for (const p of this.plan.filter(item => item.action === 'update')) {
        const target = this.records.find(record => String(record.id) === String(p.existing_id));
        if (!target) continue;
        Object.assign(target, {
          order_date: p.order_date || null, shop_platform: p.shop_platform || '', brand: p.brand || '',
          quantity: p.quantity || 0, is_valid_order: p.is_valid_order === undefined ? 1 : p.is_valid_order,
          original_order_status: p.original_order_status || '', remark: p.remark || '', import_batch_id: importBatchId
        });
      }
      return { rowCount: this.plan.filter(item => item.action === 'update').length };
    }
    if (/INSERT INTO sales_records/.test(sql)) {
      const importBatchId = params[0] || '';
      for (const p of this.plan.filter(item => item.action === 'insert')) {
        this.records.push(stored({ ...p, import_batch_id: importBatchId }));
      }
      return { rowCount: this.plan.filter(item => item.action === 'insert').length };
    }
    return { rowCount: 0 };
  }

  async query(sql) {
    this.calls.push({ type: 'query', sql });
    const rows = this.records.filter(record => this.stage.some(stageRow => {
      const hasDetail = stageRow.order_detail_id && stageRow.source_system === record.source_system && stageRow.order_detail_id === record.order_detail_id;
      return hasDetail || (stageRow.source_system === record.source_system && stageRow.order_no === record.order_no && stageRow.sku_code === record.sku_code && (stageRow.shop_platform || '') === (record.shop_platform || ''));
    }));
    return { rows };
  }
}

async function runPostgresContract(fixture) {
  const batchId = `checkpoint2-pg-${fixture.name}`;
  const expected = expectedFor(fixture.items, fixture.initial, batchId);
  const fake = new FakePostgresDb(fixture.initial);
  const preview = await previewSalesImport(createPostgresSalesImportAdapter(fake, { batchSize: 1000 }), fixture.items, { importBatchId: batchId, idFactory: row => `legacy_sale_${row.input_order + 1}` });
  assert.deepStrictEqual(preview.preview.map(item => item.action), expected.classified.map(item => item.action), `${fixture.name}: PG preview actions`);
  assert.deepStrictEqual(fake.records, fixture.initial.map(stored), `${fixture.name}: PG preview must not write`);
  const applied = await executeSalesImport(createPostgresSalesImportAdapter(fake, { batchSize: 1000 }), fixture.items, { importBatchId: batchId, idFactory: row => `legacy_sale_${row.input_order + 1}` });
  for (const call of fake.calls) assert.ok(!normalizePgSql(call.sql).includes('?'), `${fixture.name}: PG SQL has unnormalized placeholder`);
  assert.deepStrictEqual(comparable(applied.result), comparable(expected.result), `${fixture.name}: PG result`);
  assert.deepStrictEqual(comparable(preview.preview), comparable(applied.preview), `${fixture.name}: PG preview/apply rows and errors`);
  assert.deepStrictEqual(sortedRecords(fake.records), sortedRecords(expected.records), `${fixture.name}: PG final records`);
  assertNoBusinessDuplicates(fake.records, `${fixture.name}: PG`);
  assert.strictEqual(applied.metrics.queryOne, 0, `${fixture.name}: PG queryOne must be zero`);
  return { name: fixture.name, result: applied.result, timings: applied.timings, metrics: applied.metrics };
}

async function runThousandRowBenchmark() {
  const initial = [];
  const items = [];
  for (let i = 0; i < 1000; i++) {
    if (i < 250) initial.push(stored({ id: `seed-${i}`, source_system: 'S', order_no: `O-${i}`, order_detail_id: `D-${i}`, order_date: '2026-01-01', sku_code: `SKU-${i}`, quantity: 1, brand: 'B' }));
    items.push({ source_system: 'S', order_no: `O-${i}`, order_detail_id: `D-${i}`, order_date: '2026-01-01', sku_code: `SKU-${i}`, quantity: i < 250 ? 2 : 1, brand: 'B' });
  }
  resetSqlite(initial);
  const adapter = createSqliteSalesImportAdapter(sqliteDb, { batchSize: 80 });
  const started = Date.now();
  const result = await executeSalesImport(adapter, items, { importBatchId: 'checkpoint2-1000', idFactory: row => `legacy_sale_${row.input_order + 1}` });
  const elapsed = Date.now() - started;
  assert.strictEqual(result.result.inserted, 750, '1000 inserted count');
  assert.strictEqual(result.result.updated, 250, '1000 updated count');
  assert.strictEqual(result.result.skipped, 0, '1000 skipped count');
  assert.strictEqual(result.result.failed, 0, '1000 failed count');
  assert.strictEqual(result.metrics.queryOne, 0, '1000 queryOne must be zero');
  assert.ok(result.metrics.query < 100, `1000 query count unexpectedly high: ${result.metrics.query}`);
  assert.ok(result.metrics.run < 100, `1000 run count unexpectedly high: ${result.metrics.run}`);
  assert.strictEqual(snapshotSqlite().length, 1000, '1000 final row count');
  assertNoBusinessDuplicates(snapshotSqlite(), '1000 SQLite');
  return { elapsed_ms: elapsed, timings: result.timings, metrics: result.metrics, rss_mb: Math.round(process.memoryUsage().rss / 1024 / 1024) };
}

async function runPostgresContractBenchmark() {
  const initial = [];
  const items = [];
  for (let i = 0; i < 1000; i++) {
    if (i < 250) initial.push(stored({ id: `seed-pg-${i}`, source_system: 'S', order_no: `PO-${i}`, order_detail_id: `PD-${i}`, order_date: '2026-01-01', sku_code: `PGSKU-${i}`, quantity: 1, brand: 'B' }));
    items.push({ source_system: 'S', order_no: `PO-${i}`, order_detail_id: `PD-${i}`, order_date: '2026-01-01', sku_code: `PGSKU-${i}`, quantity: i < 250 ? 2 : 1, brand: 'B' });
  }
  const fake = new FakePostgresDb(initial);
  const started = Date.now();
  const result = await executeSalesImport(createPostgresSalesImportAdapter(fake, { batchSize: 1000 }), items, {
    importBatchId: 'checkpoint2-pg-1000',
    idFactory: row => `legacy_sale_${row.input_order + 1}`
  });
  for (const call of fake.calls) assert.ok(!normalizePgSql(call.sql).includes('?'), 'PG 1000 SQL has unnormalized placeholder');
  const elapsed = Date.now() - started;
  assert.strictEqual(result.result.inserted, 750, 'PG 1000 inserted count');
  assert.strictEqual(result.result.updated, 250, 'PG 1000 updated count');
  assert.strictEqual(result.result.failed, 0, 'PG 1000 failed count');
  assert.strictEqual(result.metrics.queryOne, 0, 'PG 1000 queryOne must be zero');
  assert.strictEqual(fake.records.length, 1000, 'PG 1000 final row count');
  assertNoBusinessDuplicates(fake.records, '1000 PG');
  return { elapsed_ms: elapsed, timings: result.timings, metrics: result.metrics, rss_mb: Math.round(process.memoryUsage().rss / 1024 / 1024) };
}

(async () => {
  const sqliteFixtures = [];
  for (const fixture of fixtures) sqliteFixtures.push(await runSqliteFixture(fixture));
  const postgresFixtures = [];
  for (const fixture of fixtures) postgresFixtures.push(await runPostgresContract(fixture));
  const benchmark = await runThousandRowBenchmark();
  const postgresBenchmark = await runPostgresContractBenchmark();
  console.log(JSON.stringify({
    checkpoint: '2-database-equivalence-and-performance',
    passed: true,
    live_postgres: false,
    sqlite_fixtures: sqliteFixtures,
    postgres_contract_fixtures: postgresFixtures,
    benchmark_1000: benchmark,
    postgres_contract_benchmark_1000: postgresBenchmark,
    note: 'PostgreSQL adapter contract was exercised with an in-memory double; no isolated PostgreSQL server is available in this checkout.'
  }, null, 2));
})().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
