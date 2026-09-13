'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { Client } = require('pg');
const M = require('../migrations/inventory-imports-latest-index');

const dsn = process.env.BULK1_PG_DSN || '';
let c;

before(async () => {
  if (!dsn) return;
  const u = new URL(dsn.replace(/^postgres:\/\//, 'postgresql://'));
  if (!['localhost', '127.0.0.1', '::1'].includes(u.hostname)) {
    throw new Error('BULK1-PG-GUARD: integration test only accepts a local PostgreSQL DSN');
  }
  c = new Client({ connectionString: dsn });
  await c.connect();
});

after(async () => {
  if (c) await c.end();
});

async function recreateTable() {
  await c.query('DROP TABLE IF EXISTS public.inventory_imports');
  await c.query(`CREATE TABLE public.inventory_imports (
    id text PRIMARY KEY,
    sku_code text NOT NULL,
    country text NOT NULL,
    warehouse text NOT NULL,
    import_date text NOT NULL
  )`);
}

async function indexState() {
  const r = await c.query(`
    SELECT i.indisvalid, i.indisready, pg_get_indexdef(idx.oid) AS indexdef
    FROM pg_class idx
    JOIN pg_namespace ns ON ns.oid = idx.relnamespace
    JOIN pg_index i ON i.indexrelid = idx.oid
    JOIN pg_class tbl ON tbl.oid = i.indrelid
    WHERE ns.nspname='public'
      AND tbl.relname='inventory_imports'
      AND idx.relname=$1`, [M.INDEX_NAME]);
  return r.rows;
}

test('PG guard: missing inventory_imports fails closed', { skip: !dsn }, async () => {
  await c.query('DROP TABLE IF EXISTS public.inventory_imports');
  await assert.rejects(c.query(M.PG_ENSURE_SQL), /inventory_imports.*不存在/i);
});

test('PG guard: small table creates the exact index and rerun is idempotent', { skip: !dsn }, async () => {
  await recreateTable();
  await c.query(`
    INSERT INTO public.inventory_imports (id, sku_code, country, warehouse, import_date)
    SELECT 'I'||g, 'SKU-'||(g % 20), 'Indonesia', 'Bekasi', '2026-09-13'
    FROM generate_series(1, 100) g`);

  await c.query(M.PG_ENSURE_SQL);
  let rows = await indexState();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].indisvalid, true);
  assert.equal(rows[0].indisready, true);
  assert.match(rows[0].indexdef, /\(sku_code, country, warehouse, import_date\)/);

  // Must be a true no-op on a healthy existing index.
  await c.query(M.PG_ENSURE_SQL);
  rows = await indexState();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].indisvalid, true);
  assert.equal(rows[0].indisready, true);
});

test('PG guard: stale/unknown reltuples cannot trick startup into ordinary CREATE INDEX on >250k rows', { skip: !dsn, timeout: 120000 }, async () => {
  await recreateTable();
  // Deliberately do not ANALYZE: freshly loaded tables commonly have reltuples=-1/stale-low.
  await c.query(`
    INSERT INTO public.inventory_imports (id, sku_code, country, warehouse, import_date)
    SELECT 'I'||g, 'SKU-'||(g % 5000), 'Indonesia', 'Bekasi', '2026-09-13'
    FROM generate_series(1, ${M.AUTO_CREATE_MAX_ROWS + 1}) g`);

  await assert.rejects(c.query(M.PG_ENSURE_SQL), /启动期拒绝普通 CREATE INDEX/i);
  const rows = await indexState();
  assert.equal(rows.length, 0, 'large-table guard must not create a blocking index');
});
