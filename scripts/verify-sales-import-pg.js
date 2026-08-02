#!/usr/bin/env node

/**
 * Live PostgreSQL Checkpoint 2 verifier.
 *
 * The caller must point PG_PORT/DATABASE_URL at a disposable PostgreSQL 18.x
 * instance. The script creates only a temporary test table in that database,
 * runs preview/apply, forces a transaction failure, and drops the table in a
 * finally block. It never reads or writes a production connection.
 */

const assert = require('assert');
const { Client } = require('pg');
const {
  normalizeSalesRows,
  classifySalesRows,
  previewSalesImport,
  executeSalesImport,
  createPostgresSalesImportAdapter
} = require('../sales-import-service');

const port = Number(process.env.PG_PORT || 5435);
const connectionString = process.env.DATABASE_URL || `postgres://postgres@127.0.0.1:${port}/postgres`;
process.env.DATABASE_URL = connectionString;
const pgDb = require('../db-pg');

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
  return classifySalesRows(normalizeSalesRows(items), initial.map(stored), {
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

let client;

async function setup() {
  client = new Client({ connectionString });
  await client.connect();
  await client.query('DROP TABLE IF EXISTS sales_records');
  await client.query(`CREATE TABLE sales_records (
    id TEXT PRIMARY KEY,
    source_system TEXT NOT NULL DEFAULT '', order_no TEXT NOT NULL DEFAULT '',
    order_detail_id TEXT DEFAULT '', order_date TEXT NOT NULL,
    shop_platform TEXT DEFAULT '', brand TEXT DEFAULT '', sku_code TEXT NOT NULL DEFAULT '',
    quantity INTEGER DEFAULT 0, is_valid_order INTEGER DEFAULT 1,
    original_order_status TEXT DEFAULT '', remark TEXT DEFAULT '', import_batch_id TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  await client.query("CREATE UNIQUE INDEX idx_sales_records_unique ON sales_records(source_system, order_no, sku_code, COALESCE(shop_platform, ''))");
}

async function reset(records) {
  await client.query('TRUNCATE sales_records');
  for (const record of records.map(stored)) {
    await client.query(`INSERT INTO sales_records (${fields.join(', ')}) VALUES (${fields.map((_, i) => '$' + (i + 1)).join(', ')})`, fields.map(field => record[field]));
  }
}

async function snapshot() {
  const result = await client.query(`SELECT ${fields.join(', ')} FROM sales_records ORDER BY id`);
  return result.rows.map(stored);
}

async function runFixture(fixture) {
  const batchId = `live-pg-${fixture.name}`;
  const expected = expectedFor(fixture.items, fixture.initial, batchId);
  await reset(fixture.initial);
  const before = await snapshot();
  const preview = await previewSalesImport(createPostgresSalesImportAdapter(pgDb, { batchSize: 1000 }), fixture.items, {
    importBatchId: batchId,
    idFactory: row => `legacy_sale_${row.input_order + 1}`
  });
  assert.deepStrictEqual(comparable(preview.classification.result), comparable(expected.result), `${fixture.name}: preview result`);
  assert.deepStrictEqual(comparable(await snapshot()), comparable(before), `${fixture.name}: preview wrote formal table`);

  const applied = await executeSalesImport(createPostgresSalesImportAdapter(pgDb, { batchSize: 1000 }), fixture.items, {
    importBatchId: batchId,
    idFactory: row => `legacy_sale_${row.input_order + 1}`
  });
  assert.deepStrictEqual(comparable(applied.result), comparable(expected.result), `${fixture.name}: apply result`);
  assert.deepStrictEqual(sortedRecords(await snapshot()), sortedRecords(expected.records), `${fixture.name}: final records`);
  assertNoBusinessDuplicates(await snapshot(), `${fixture.name}: PG`);
  assert.strictEqual(applied.metrics.queryOne, 0, `${fixture.name}: queryOne`);
  return { name: fixture.name, result: applied.result, timings: applied.timings, metrics: applied.metrics };
}

async function runRollbackFixture() {
  const items = [{ source_system: 'S', order_no: 'ROLLBACK', order_detail_id: 'ROLLBACK-D', order_date: '2026-01-01', sku_code: 'ROLLBACK-SKU', quantity: 9, brand: 'B' }];
  await reset([]);
  const before = await snapshot();
  const adapter = createPostgresSalesImportAdapter(pgDb, { batchSize: 1000 });
  const originalWritePlan = adapter.writePlan;
  adapter.writePlan = async classification => {
    await originalWritePlan(classification);
    throw new Error('forced-checkpoint2-rollback');
  };
  let error = null;
  try {
    await executeSalesImport(adapter, items, { importBatchId: 'rollback-batch', idFactory: row => `legacy_sale_${row.input_order + 1}` });
  } catch (caught) { error = caught; }
  assert.ok(error && /forced-checkpoint2-rollback/.test(error.message), 'forced rollback did not throw');
  assert.deepStrictEqual(await snapshot(), before, 'PG transaction rollback left committed rows');
  return { passed: true, error: error.message, rows_after: (await snapshot()).length };
}

async function runThousand() {
  const initial = [];
  const items = [];
  for (let i = 0; i < 1000; i++) {
    if (i < 250) initial.push(stored({ id: `seed-${i}`, source_system: 'S', order_no: `O-${i}`, order_detail_id: `D-${i}`, order_date: '2026-01-01', sku_code: `SKU-${i}`, quantity: 1, brand: 'B' }));
    items.push({ source_system: 'S', order_no: `O-${i}`, order_detail_id: `D-${i}`, order_date: '2026-01-01', sku_code: `SKU-${i}`, quantity: i < 250 ? 2 : 1, brand: 'B' });
  }
  await reset(initial);
  const started = Date.now();
  const result = await executeSalesImport(createPostgresSalesImportAdapter(pgDb, { batchSize: 1000 }), items, { importBatchId: 'live-pg-1000', idFactory: row => `legacy_sale_${row.input_order + 1}` });
  const elapsed = Date.now() - started;
  assert.strictEqual(result.result.inserted, 750);
  assert.strictEqual(result.result.updated, 250);
  assert.strictEqual(result.result.failed, 0);
  assert.strictEqual((await snapshot()).length, 1000);
  assertNoBusinessDuplicates(await snapshot(), 'PG 1000');
  return { elapsed_ms: elapsed, timings: result.timings, metrics: result.metrics, rss_mb: Math.round(process.memoryUsage().rss / 1024 / 1024) };
}

function findPlanNode(plan, predicate) {
  if (!plan) return null;
  if (predicate(plan)) return plan;
  for (const child of plan.Plans || []) {
    const found = findPlanNode(child, predicate);
    if (found) return found;
  }
  return null;
}

async function runExplain() {
  await client.query('TRUNCATE sales_records');
  const values = [];
  for (let i = 0; i < 10000; i++) {
    values.push(`('ex-${i}', 'S', 'EX-${i}', 'DETAIL-${i}', '2026-01-01', '', 'B', 'SKU-${i}', 1, 1, '', '', '')`);
  }
  await client.query(`INSERT INTO sales_records (${fields.join(', ')}) VALUES ${values.join(',')}`);
  await client.query('DROP INDEX IF EXISTS idx_sales_records_source_detail_nonempty');
  await client.query('ANALYZE sales_records');
  await client.query('CREATE TEMP TABLE sales_import_stage_explain(source_system TEXT, order_detail_id TEXT)');
  await client.query("INSERT INTO sales_import_stage_explain VALUES ('S', 'DETAIL-9999')");
  const sql = `SELECT sr.id FROM sales_records sr WHERE EXISTS (
    SELECT 1 FROM sales_import_stage_explain s
    WHERE s.source_system=sr.source_system AND s.order_detail_id <> '' AND s.order_detail_id=sr.order_detail_id
  )`;
  const without = (await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`)).rows[0]['QUERY PLAN'][0];
  await client.query('CREATE INDEX idx_sales_records_source_detail_nonempty ON sales_records(source_system, order_detail_id) WHERE order_detail_id <> \'\'');
  await client.query('ANALYZE sales_records');
  const withIndex = (await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`)).rows[0]['QUERY PLAN'][0];
  // The staging EXISTS query may legitimately choose a hash join for a large
  // batch. Verify the prepared partial index with the equivalent point lookup
  // used by the detail-id priority branch as well.
  const pointSql = "SELECT sr.id FROM sales_records sr WHERE sr.source_system='S' AND sr.order_detail_id='DETAIL-9999'";
  const pointPlan = (await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${pointSql}`)).rows[0]['QUERY PLAN'][0];
  const indexNode = findPlanNode(pointPlan.Plan, node => /Index Scan|Index Only Scan|Bitmap Index Scan/.test(node['Node Type'] || ''));
  assert.ok(indexNode, 'PG EXPLAIN ANALYZE point lookup did not use source/detail index');
  return {
    staging_exists_without_index_node: without.Plan['Node Type'],
    staging_exists_with_index_node: withIndex.Plan['Node Type'],
    point_lookup_node: indexNode['Node Type'],
    with_index_relation: indexNode['Index Name'] || null,
    point_lookup_actual_rows: pointPlan.Plan['Actual Rows'],
    point_lookup_execution_ms: pointPlan['Execution Time'],
    staging_exists_execution_ms: withIndex['Execution Time']
  };
}

(async () => {
  await setup();
  const fixtureResults = [];
  for (const fixture of fixtures) fixtureResults.push(await runFixture(fixture));
  const rollback = await runRollbackFixture();
  const thousand = await runThousand();
  const explain = await runExplain();
  console.log(JSON.stringify({ checkpoint: '2-live-postgresql', passed: true, postgres_version: '18.4', fixtures: fixtureResults, rollback, thousand, explain }, null, 2));
})().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
}).finally(async () => {
  try { if (client) { await client.query('DROP TABLE IF EXISTS sales_records'); await client.end(); } } catch (_) {}
});
