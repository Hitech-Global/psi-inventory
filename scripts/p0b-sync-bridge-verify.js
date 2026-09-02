#!/usr/bin/env node
/**
 * P0-B SYNC BRIDGE VERIFY (STATIC)
 *
 * Validates SQL shape of the 3 PG SQL statements + JSONB field type parity.
 * Confirms date columns use text (matching schema TEXT), NOT date/timestamp.
 *
 * SCHEMA FACTS (from db-pg.js L1016-1043):
 *   inventory.last_import_date      TEXT DEFAULT ''
 *   inventory.snapshot_cutoff_date  TEXT DEFAULT ''
 *   inventory.last_inbound_date     TEXT DEFAULT ''
 *   inventory.first_inbound_date    TEXT DEFAULT ''
 *   inventory.available_qty         INTEGER DEFAULT 0
 *   inventory.weighted_avg_cost      NUMERIC(18,4) DEFAULT 0
 *   inventory.inventory_value        NUMERIC(18,4) DEFAULT 0
 */

const fs = require('fs');
const path = require('path');

console.log('P0-B SYNC-BRIDGE VERIFY (STATIC MODE — SQL text assertions)');
console.log('(PG runtime requires DB_DRIVER=pg + DATABASE_URL + disposable schema)');
console.log('');

const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

function extractTagged(name) {
  const m = SERVER.match(new RegExp('const ' + name + ' = `([^`]+)`'));
  if (!m) throw new Error(name + ' SQL not found');
  return m[1];
}
const snaps = extractTagged('pgSnapshotSql');
const upds  = extractTagged('pgBatchUpdateSql');
const inss  = extractTagged('pgBatchInsertSql');

// Extract jsonb_to_recordset AS xxx(...) blocks to check for date/timestamp types
function extractRecordsetTypes(sql) {
  const blocks = [];
  const re = /jsonb_to_recordset\([^)]+\)\s*AS\s*\w+\(([^)]+)\)/gs;
  let m;
  while ((m = re.exec(sql)) !== null) {
    blocks.push(m[1]);
  }
  return blocks;
}

const checks = [
  // --- snapshot SQL shape ---
  ['snapshot uses jsonb_to_recordset (1 bind param)', /jsonb_to_recordset\(\$1::jsonb\)/.test(snaps)],
  ['snapshot has LEFT JOIN LATERAL inventory input-key scoped', /LEFT JOIN LATERAL \(\s*SELECT\s*i\.id[\s\S]*?FROM inventory i\s*WHERE i\.sku_code = inp\.sku_code/.test(snaps)],
  ['snapshot wac_history mirrors latestConfirmedWac WHERE/ORDER/LIMIT', /LEFT JOIN LATERAL \(\s*SELECT w\.id, w\.new_avg_cost AS cost[\s\S]*?confirmation_status = 'confirmed'\s*AND w\.is_locked = 1\s*ORDER BY w\.version_no DESC\s*LIMIT 1/.test(snaps)],
  ['snapshot has COUNT(*) OVER() as inventory_match_count', /COUNT\(\*\) OVER\(\) AS inventory_match_count/.test(snaps)],
  ['snapshot ends with ORDER BY inp.ord', /ORDER BY inp\.ord\s*$/.test(snaps.trim())],

  // --- UPDATE SQL shape ---
  ['UPDATE JSONB: 8 SET cols + WHERE id', /UPDATE inventory i SET\s*available_qty\s*=\s*src\.available_qty::integer,[\s\S]*?WHERE i\.id = src\.id::text/.test(upds)],
  ['UPDATE uses jsonb_to_recordset($1::jsonb) (1 param)', /FROM jsonb_to_recordset\(\$1::jsonb\) AS src\(/.test(upds)],

  // --- INSERT SQL shape ---
  ['INSERT column set matches OLD 11 cols', /INSERT INTO inventory \(\s*id, sku_code, country, warehouse,\s*available_qty, weighted_avg_cost, inventory_value,\s*last_import_date, snapshot_cutoff_date,\s*last_inbound_date, first_inbound_date\s*\)/.test(inss)],
  ['INSERT uses jsonb_to_recordset($1::jsonb) (1 param)', /FROM jsonb_to_recordset\(\$1::jsonb\) AS j\(/.test(inss)],
  ['INSERT id::text for genId("inv") TEXT ids', /id::text, sku_code::text/.test(inss)],

  // --- JSONB field type assertions: date columns MUST be text, NOT date/timestamp ---
  ['UPDATE recordset: last_import_date declared as text', /last_import_date\s+text/.test(upds) && !/last_import_date\s+date/.test(upds) && !/last_import_date\s+timestamp/.test(upds)],
  ['UPDATE recordset: snapshot_cutoff_date declared as text', /snapshot_cutoff_date\s+text/.test(upds) && !/snapshot_cutoff_date\s+date/.test(upds) && !/snapshot_cutoff_date\s+timestamp/.test(upds)],
  ['UPDATE recordset: last_inbound_date declared as text', /last_inbound_date\s+text/.test(upds) && !/last_inbound_date\s+date/.test(upds) && !/last_inbound_date\s+timestamp/.test(upds)],
  ['UPDATE recordset: first_inbound_date declared as text', /first_inbound_date\s+text/.test(upds) && !/first_inbound_date\s+date/.test(upds) && !/first_inbound_date\s+timestamp/.test(upds)],

  ['INSERT recordset: last_import_date declared as text', /last_import_date\s+text/.test(inss) && !/last_import_date\s+date/.test(inss) && !/last_import_date\s+timestamp/.test(inss)],
  ['INSERT recordset: snapshot_cutoff_date declared as text', /snapshot_cutoff_date\s+text/.test(inss) && !/snapshot_cutoff_date\s+date/.test(inss) && !/snapshot_cutoff_date\s+timestamp/.test(inss)],
  ['INSERT recordset: last_inbound_date declared as text', /last_inbound_date\s+text/.test(inss) && !/last_inbound_date\s+date/.test(inss) && !/last_inbound_date\s+timestamp/.test(inss)],
  ['INSERT recordset: first_inbound_date declared as text', /first_inbound_date\s+text/.test(inss) && !/first_inbound_date\s+date/.test(inss) && !/first_inbound_date\s+timestamp/.test(inss)],

  // --- UPDATE SET casts: date columns cast to ::text ---
  ['UPDATE SET: last_import_date = src.last_import_date::text', /last_import_date\s*=\s*src\.last_import_date::text/.test(upds)],
  ['UPDATE SET: snapshot_cutoff_date = src.snapshot_cutoff_date::text', /snapshot_cutoff_date\s*=\s*src\.snapshot_cutoff_date::text/.test(upds)],
  ['UPDATE SET: last_inbound_date = src.last_inbound_date::text', /last_inbound_date\s*=\s*src\.last_inbound_date::text/.test(upds)],
  ['UPDATE SET: first_inbound_date = src.first_inbound_date::text', /first_inbound_date\s*=\s*src\.first_inbound_date::text/.test(upds)],

  // --- INSERT SELECT casts: date columns cast to ::text ---
  ['INSERT SELECT: last_import_date::text', /last_import_date::text/.test(inss)],
  ['INSERT SELECT: snapshot_cutoff_date::text', /snapshot_cutoff_date::text/.test(inss)],
  ['INSERT SELECT: last_inbound_date::text', /last_inbound_date::text/.test(inss)],
  ['INSERT SELECT: first_inbound_date::text', /first_inbound_date::text/.test(inss)],

  // --- No date/timestamp TYPE inside jsonb_to_recordset AS blocks ---
  // CURRENT_TIMESTAMP in updated_at is a function, not a type declaration.
  ['NO date/timestamp TYPE in any jsonb_to_recordset AS block',
    (() => {
      const allSql = snaps + upds + inss;
      const blocks = extractRecordsetTypes(allSql);
      for (const block of blocks) {
        if (/\bdate\b(?!\w)/i.test(block) || /\btimestamp\b/i.test(block)) return false;
      }
      return true;
    })()],
];

let ok = 0;
for (const [label, pass] of checks) {
  if (pass) ok++;
  console.log('  ' + (pass ? '\u2713' : '\u2717') + ' ' + label);
}
console.log('');
console.log(`\u2500\u2500 static SQL-shape + JSONB-type gate: ${ok}/${checks.length} passed`);
if (ok !== checks.length) process.exit(1);
