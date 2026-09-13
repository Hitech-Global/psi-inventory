'use strict';

// Local-only reproducible index comparison. Uses session TEMP tables exclusively.
// BULK1_PG_DSN=postgres://...@127.0.0.1:PORT/postgres node scripts/benchmark-bulk1-v2.cjs
const { Client } = require('pg');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

async function main() {
  const dsn = process.env.BULK1_PG_DSN;
  if (!dsn || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(dsn).hostname)) {
    throw new Error('BULK1_PG_DSN must explicitly identify a local test PostgreSQL instance');
  }
  // Evaluate the actual pure SQL factory without loading app startup or DB configuration.
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const start = src.indexOf('function latestImportsSqlForKeySet()');
  const end = src.indexOf('\n// ===========================================================================', start);
  assert.ok(start >= 0 && end > start);
  const sql = vm.runInNewContext(src.slice(start, end) + '\nlatestImportsSqlForKeySet()', {
    process: { env: { DB_DRIVER: 'pg' } }
  });
  const c = new Client({connectionString: dsn});
  await c.connect();
  try {
    await c.query("SET work_mem='4MB'; SET statement_timeout='120s'");
    await c.query(`CREATE TEMP TABLE inventory_imports (
      id text PRIMARY KEY, sku_code text, country text, warehouse text,
      import_date text, created_at text, available_qty integer,
      snapshot_cutoff_date text, weighted_avg_cost numeric(18,4),
      last_inbound_date text, first_inbound_date text
    ); CREATE TEMP TABLE inventory_delete_tombstones (
      sku_code text, country text, warehouse text, UNIQUE(sku_code,country,warehouse)
    )`);
    // 100 events/key: 5 calendar days, 20 repeated events on each day.
    await c.query(`INSERT INTO inventory_imports
      SELECT k||'-'||e, 'SKU-'||k, 'Indonesia', 'Bekasi',
        '2026-09-'||lpad((1+(e-1)/20)::text,2,'0'),
        '2026-09-13 '||lpad(((e-1)%20)::text,2,'0')||':00:00', e,
        '2026-09-01', 12.5, '', ''
      FROM generate_series(1,5000) k CROSS JOIN generate_series(1,100) e`);
    await c.query('ANALYZE inventory_imports; ANALYZE inventory_delete_tombstones');
    const payload = JSON.stringify(Array.from({length:5000}, (_,i) => ({
      sku_code:'SKU-'+(i+1), country:'Indonesia', warehouse:'Bekasi'
    })));
    const result = {postgres: (await c.query('SELECT version() AS v')).rows[0].v,
      rows:500000, keys:5000, work_mem:'4MB', variants:[]};
    // Alternating repeated builds/runs reduce ordering and cache bias.
    for (const columns of [4,5,5,4]) {
      await c.query('DROP INDEX IF EXISTS pg_temp.bulk1_bench_idx');
      const before = performance.now();
      await c.query('CREATE INDEX bulk1_bench_idx ON inventory_imports ' +
        '(sku_code,country,warehouse,import_date' + (columns === 5 ? ',created_at' : '') + ')');
      const buildMs = performance.now()-before;
      await c.query('ANALYZE inventory_imports');
      const size = (await c.query("SELECT pg_relation_size('pg_temp.bulk1_bench_idx') AS bytes")).rows[0].bytes;
      const rows = (await c.query(sql, [payload])).rows; // warmup + correctness
      assert.equal(rows.length,5000);
      assert.ok(rows.every(r => r.available_qty === 100));
      const plans = [];
      for (let run=0; run<3; run++) {
        const p = (await c.query('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) '+sql,[payload])).rows[0]['QUERY PLAN'][0];
        assert.equal(p.Plan['Actual Rows'],5000);
        plans.push(p);
      }
      const entry = {columns, buildMs, indexBytes:Number(size), plans};
      result.variants.push(entry);
      console.error(JSON.stringify({columns, buildMs, indexBytes:Number(size),
        executionMs:plans.map(p=>p['Execution Time'])}));
    }
    console.log(JSON.stringify(result,null,2));
  } finally { await c.end(); }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
