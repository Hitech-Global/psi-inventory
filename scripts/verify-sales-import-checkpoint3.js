#!/usr/bin/env node

/**
 * Checkpoint 3 verifier.  It uses only disposable SQLite and embedded PG
 * databases.  No production connection, application database, or inventory
 * data is touched.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const {
  executeSalesImport,
  createSqliteSalesImportAdapter,
  createPostgresSalesImportAdapter,
  createSalesImportRunStore
} = require('../sales-import-service');

const NODE_TMP = '/private/tmp';
const sqlitePath = path.join(NODE_TMP, `sales-import-checkpoint3-${process.pid}.sqlite`);
try { fs.unlinkSync(sqlitePath); } catch (_) {}
process.env.DB_PATH = sqlitePath;
const sqliteDb = require('../db-sqlite');

const pgPort = Number(process.env.PG_PORT || 5435);
const connectionString = process.env.DATABASE_URL || `postgres://postgres@127.0.0.1:${pgPort}/postgres`;
process.env.DATABASE_URL = connectionString;
const pgDb = require('../db-pg');

const phases = ['validating', 'staging', 'matching', 'writing', 'committing', 'inventory_recalc', 'completed'];
const terminal = new Set(['completed', 'failed_uncommitted', 'unknown_pending_reconcile', 'sales_committed_recalc_failed']);

function schemaSqlite() {
  sqliteDb.run(`CREATE TABLE sales_records (
    id TEXT PRIMARY KEY, source_system TEXT NOT NULL DEFAULT '', order_no TEXT NOT NULL DEFAULT '',
    order_detail_id TEXT DEFAULT '', order_date TEXT NOT NULL, shop_platform TEXT DEFAULT '', brand TEXT DEFAULT '',
    sku_code TEXT NOT NULL DEFAULT '', quantity INTEGER DEFAULT 0, is_valid_order INTEGER DEFAULT 1,
    original_order_status TEXT DEFAULT '', remark TEXT DEFAULT '', import_batch_id TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
  )`);
  sqliteDb.run("CREATE UNIQUE INDEX idx_sales_records_unique ON sales_records(source_system, order_no, sku_code, COALESCE(shop_platform, ''))");
  sqliteDb.run(`CREATE TABLE sales_import_runs (
    import_id TEXT PRIMARY KEY, status TEXT NOT NULL, phase TEXT NOT NULL DEFAULT '', percent INTEGER,
    processed_count INTEGER NOT NULL DEFAULT 0, total_count INTEGER NOT NULL DEFAULT 0,
    inserted INTEGER NOT NULL DEFAULT 0, updated INTEGER NOT NULL DEFAULT 0, skipped INTEGER NOT NULL DEFAULT 0,
    failed INTEGER NOT NULL DEFAULT 0, errors_json TEXT NOT NULL DEFAULT '[]', timings_json TEXT NOT NULL DEFAULT '{}',
    metrics_json TEXT NOT NULL DEFAULT '{}', result_json TEXT NOT NULL DEFAULT '{}',
    commit_state TEXT NOT NULL DEFAULT 'uncommitted', recalc_status TEXT NOT NULL DEFAULT 'pending',
    request_fingerprint TEXT NOT NULL DEFAULT '', created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
  )`);
}

async function schemaPg(client) {
  await client.query('DROP TABLE IF EXISTS sales_import_runs');
  await client.query('DROP TABLE IF EXISTS sales_records');
  await client.query(`CREATE TABLE sales_records (
    id TEXT PRIMARY KEY, source_system TEXT NOT NULL DEFAULT '', order_no TEXT NOT NULL DEFAULT '',
    order_detail_id TEXT DEFAULT '', order_date TEXT NOT NULL, shop_platform TEXT DEFAULT '', brand TEXT DEFAULT '',
    sku_code TEXT NOT NULL DEFAULT '', quantity INTEGER DEFAULT 0, is_valid_order INTEGER DEFAULT 1,
    original_order_status TEXT DEFAULT '', remark TEXT DEFAULT '', import_batch_id TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  await client.query("CREATE UNIQUE INDEX idx_sales_records_unique ON sales_records(source_system, order_no, sku_code, COALESCE(shop_platform, ''))");
  await client.query(`CREATE TABLE sales_import_runs (
    import_id TEXT PRIMARY KEY, status TEXT NOT NULL, phase TEXT NOT NULL DEFAULT '', percent INTEGER,
    processed_count INTEGER NOT NULL DEFAULT 0, total_count INTEGER NOT NULL DEFAULT 0,
    inserted INTEGER NOT NULL DEFAULT 0, updated INTEGER NOT NULL DEFAULT 0, skipped INTEGER NOT NULL DEFAULT 0,
    failed INTEGER NOT NULL DEFAULT 0, errors_json TEXT NOT NULL DEFAULT '[]', timings_json TEXT NOT NULL DEFAULT '{}',
    metrics_json TEXT NOT NULL DEFAULT '{}', result_json TEXT NOT NULL DEFAULT '{}',
    commit_state TEXT NOT NULL DEFAULT 'uncommitted', recalc_status TEXT NOT NULL DEFAULT 'pending',
    request_fingerprint TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
  )`);
}

function rowsFor(count, prefix = 'cp3') {
  return Array.from({ length: count }, (_, i) => ({
    source_system: 'S', order_no: `${prefix}-order-${i}`, order_detail_id: `${prefix}-detail-${i}`,
    order_date: '2026-07-01', shop_platform: 'online', brand: 'B', sku_code: `SKU-${i % 200}`,
    quantity: (i % 9) + 1, is_valid_order: 1, original_order_status: 'Completed', remark: ''
  }));
}

async function runImport(db, adapterFactory, importId, items) {
  const store = createSalesImportRunStore(db);
  await store.create({ import_id: importId, status: 'validating', phase: 'validating', total_count: items.length, request_fingerprint: importId });
  const observed = [];
  const progress = state => {
    observed.push(state.status);
    return store.update(importId, {
      ...state, total_count: items.length,
      result: { total: items.length, inserted: state.inserted || 0, updated: state.updated || 0,
        skipped: state.skipped || 0, failed: state.failed || 0, errors: state.errors || [] }
    });
  };
  const started = Date.now();
  const applied = await executeSalesImport(adapterFactory(), items, {
    importBatchId: importId, idFactory: row => `${importId}-sale-${row.input_order}`,
    progress
  });
  const recalcStart = Date.now();
  await progress({ status: 'inventory_recalc', phase: 'inventory_recalc', percent: 95,
    processed_count: items.length, total_count: items.length, inserted: applied.result.inserted,
    updated: applied.result.updated, skipped: applied.result.skipped, failed: applied.result.failed,
    errors: applied.result.errors, timings: { ...applied.timings }, metrics: applied.metrics,
    commit_state: 'committed', recalc_status: 'running' });
  // This isolated fixture has no inventory table. The real route measures its
  // existing synchronous recalc here; the verifier only records the hook.
  const timings = { ...applied.timings, inventory_recalc_ms: Date.now() - recalcStart };
  timings.total_ms = Date.now() - started;
  observed.push('completed');
  const completed = await store.update(importId, {
    status: 'completed', phase: 'completed', percent: 100, processed_count: items.length,
    total_count: items.length, inserted: applied.result.inserted, updated: applied.result.updated,
    skipped: applied.result.skipped, failed: applied.result.failed, errors: applied.result.errors,
    timings, metrics: applied.metrics, result: applied.result,
    commit_state: 'committed', recalc_status: 'completed'
  });
  assert.strictEqual(completed.status, 'completed');
  assert.strictEqual(completed.inserted, applied.result.inserted);
  assert.ok(phases.every(phase => observed.includes(phase)), `missing phases: ${phases.filter(p => !observed.includes(p)).join(',')}`);
  return { applied, completed, observed, elapsed_ms: Date.now() - started };
}

async function countRows(db) {
  const result = await db.query('SELECT COUNT(*)::int AS n FROM sales_records');
  return Number(result.rows[0].n);
}

async function main() {
  schemaSqlite();
  const sqliteRun = await runImport(sqliteDb, () => createSqliteSalesImportAdapter(sqliteDb, { batchSize: 80 }), 'cp3-sqlite-small', rowsFor(24, 'sqlite'));
  const sqliteStore = createSalesImportRunStore(sqliteDb);
  const sqliteTerminal = await sqliteStore.get('cp3-sqlite-small');
  assert.ok(terminal.has(sqliteTerminal.status));
  const sqliteRows = sqliteDb.query('SELECT * FROM sales_records ORDER BY id').rows;

  const pgClient = new Client({ connectionString });
  await pgClient.connect();
  await schemaPg(pgClient);
  const pgRun = await runImport(pgDb, () => createPostgresSalesImportAdapter(pgDb, { batchSize: 1000 }), 'cp3-pg-small', rowsFor(24, 'sqlite'));
  const pgRows = (await pgClient.query('SELECT * FROM sales_records ORDER BY id')).rows;
  assert.strictEqual(pgRows.length, sqliteRows.length);
  assert.strictEqual(pgRun.completed.inserted, sqliteRun.completed.inserted);
  assert.strictEqual(pgRun.completed.updated, sqliteRun.completed.updated);
  assert.strictEqual(pgRun.completed.skipped, sqliteRun.completed.skipped);
  assert.strictEqual(pgRun.completed.failed, sqliteRun.completed.failed);

  // Three terminal outcomes are persisted and queryable without touching sales rows.
  const outcomeStore = createSalesImportRunStore(pgDb);
  for (const [id, status, commitState, recalcStatus] of [
    ['cp3-failed', 'failed_uncommitted', 'uncommitted', 'not_started'],
    ['cp3-unknown', 'unknown_pending_reconcile', 'unknown', 'not_started'],
    ['cp3-recalc', 'sales_committed_recalc_failed', 'committed', 'failed']
  ]) {
    await outcomeStore.create({ import_id: id, status, phase: status, commit_state: commitState, recalc_status: recalcStatus });
    const row = await outcomeStore.get(id);
    assert.strictEqual(row.status, status);
    assert.strictEqual(row.commit_state, commitState);
    assert.strictEqual(row.recalc_status, recalcStatus);
  }

  // 30k x3 PG runs, while a separate connection probes ordinary DB/API work.
  const large = [];
  for (let runNo = 1; runNo <= 3; runNo++) {
    await pgClient.query('TRUNCATE sales_records');
    const items = rowsFor(30000, `pg30k-${runNo}`);
    let probeCount = 0; let maxProbeMs = 0; let probing = true;
    const probe = (async () => {
      while (probing) {
        const t = Date.now();
        await pgClient.query('SELECT 1');
        maxProbeMs = Math.max(maxProbeMs, Date.now() - t);
        probeCount++;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
    })();
    const run = await runImport(pgDb, () => createPostgresSalesImportAdapter(pgDb, { batchSize: 1000 }), `cp3-pg-30k-${runNo}`, items);
    probing = false; await probe;
    large.push({ run: runNo, rows: 30000, result: run.completed.result, elapsed_ms: run.elapsed_ms,
      timings: run.completed.timings, metrics: run.completed.metrics, probe_count: probeCount, max_probe_ms: maxProbeMs,
      duplicate_rows: (await countRows(pgDb)) - 30000 });
    assert.strictEqual(large[large.length - 1].duplicate_rows, 0);
  }

  await pgClient.query('DROP TABLE IF EXISTS sales_import_runs');
  await pgClient.query('DROP TABLE IF EXISTS sales_records');
  await pgClient.end();
  try { sqliteDb.getDB().close(); } catch (_) {}
  try { fs.unlinkSync(sqlitePath); } catch (_) {}
  console.log(JSON.stringify({ checkpoint: '3-progress-idempotency-and-scale', passed: true,
    sqlite: { result: sqliteRun.completed.result, phases: sqliteRun.observed, rows: sqliteRows.length },
    postgres: { result: pgRun.completed.result, phases: pgRun.observed, rows: pgRows.length },
    outcomes: ['failed_uncommitted', 'unknown_pending_reconcile', 'sales_committed_recalc_failed'],
    scale_30k: large
  }, null, 2));
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
