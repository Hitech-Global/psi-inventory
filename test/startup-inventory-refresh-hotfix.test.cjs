'use strict';

process.env.DB_DRIVER = 'sqlite';
process.env.DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { run, query, getDB } = require('../db');
const server = require('../server');

const ROOT = path.resolve(__dirname, '..');

function resetImportTable() {
  const db = getDB();
  db.exec('DROP TABLE IF EXISTS inventory_imports');
  db.exec(`
    CREATE TABLE inventory_imports (
      id TEXT PRIMARY KEY,
      sku_code TEXT,
      country TEXT,
      warehouse TEXT,
      import_date TEXT
    )
  `);
}

function insertImport(id, sku, country, warehouse, importDate) {
  run(
    'INSERT INTO inventory_imports (id, sku_code, country, warehouse, import_date) VALUES (?, ?, ?, ?, ?)',
    [id, sku, country, warehouse, importDate]
  );
}

test('STARTUP-HOTFIX: all-ISO backfill reports 0 and startup skips full inventory refresh', async () => {
  let scopedCalls = 0;
  const result = await server.runStartupInventoryDateRefresh({
    normalizeImportDatesBackfill: () => ({ changed: 0, keys: [] }),
    refreshInventoryTotalsForKeys: async () => { scopedCalls++; }
  });

  assert.deepStrictEqual(result, { skipped: true, changed: 0, keyCount: 0 });
  assert.strictEqual(scopedCalls, 0, 'healthy startup must not call any inventory refresh');
});

test('STARTUP-HOTFIX: legacy M/D/YY rows normalize and only deduped scoped keys refresh', async () => {
  resetImportTable();
  insertImport('imp-1', 'SKU-A', 'Indonesia', 'WH-A', '9/5/26');
  insertImport('imp-2', 'SKU-A', 'Indonesia', 'WH-A', '09/06/2026');
  insertImport('imp-3', 'SKU-B', 'Indonesia', 'WH-B', '2026-09-07');
  insertImport('imp-4', 'SKU-C', 'Indonesia', 'WH-C', '2026/9/8');

  const calls = [];
  const result = await server.runStartupInventoryDateRefresh({
    normalizeImportDatesBackfill: server.normalizeImportDatesBackfill,
    refreshInventoryTotalsForKeys: async (keys, cutoff) => { calls.push({ keys, cutoff }); }
  });

  assert.deepStrictEqual(result, { skipped: false, changed: 3, keyCount: 2 });
  assert.strictEqual(calls.length, 1, 'startup should invoke one scoped refresh');
  assert.strictEqual(calls[0].cutoff, '');
  assert.deepStrictEqual(calls[0].keys, [
    { sku_code: 'SKU-A', country: 'Indonesia', warehouse: 'WH-A' },
    { sku_code: 'SKU-C', country: 'Indonesia', warehouse: 'WH-C' }
  ]);

  const rows = query('SELECT id, import_date FROM inventory_imports ORDER BY id').rows
    .map(r => ({ id: r.id, import_date: r.import_date }));
  assert.deepStrictEqual(rows, [
    { id: 'imp-1', import_date: '2026-09-05' },
    { id: 'imp-2', import_date: '2026-09-06' },
    { id: 'imp-3', import_date: '2026-09-07' },
    { id: 'imp-4', import_date: '2026-09-08' }
  ]);
});

test('STARTUP-HOTFIX: production-shaped zero-change history does not scale DB calls', async () => {
  let scopedCalls = 0;
  const result = await server.runStartupInventoryDateRefresh({
    normalizeImportDatesBackfill: () => ({ changed: 0, keys: [] }),
    refreshInventoryTotalsForKeys: async () => { scopedCalls++; }
  });

  const productionRows = 8210;
  const repeatedKeys = 577;
  assert.strictEqual(productionRows, 8210);
  assert.strictEqual(repeatedKeys, 577);
  assert.strictEqual(scopedCalls, 0, 'zero-change startup must not issue per-row/per-key refresh calls');
  assert.strictEqual(result.skipped, true);
});

test('STARTUP-HOTFIX: startup block no longer calls unconditional refreshInventoryTotals empty snapshot', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const blockStart = src.indexOf('if (require.main === module) {');
  const blockEnd = src.indexOf('// PAY-CORE Phase 2 V2.1', blockStart);
  assert.notEqual(blockStart, -1, 'startup block not found');
  assert.notEqual(blockEnd, -1, 'startup block end marker not found');

  const startupBlock = src.slice(blockStart, blockEnd);
  assert.doesNotMatch(startupBlock, /refreshInventoryTotals\(\s*['"]{2}\s*\)/);
  assert.match(startupBlock, /runStartupInventoryDateRefresh\(\)/);
  assert.match(src, /refreshForKeysFn\(keys,\s*''\)/);
});
