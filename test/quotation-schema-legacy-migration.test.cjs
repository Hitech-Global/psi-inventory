'use strict';

const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const installQuotationManagement = require('../quotation-server');

const previousDriver = process.env.DB_DRIVER;
process.env.DB_DRIVER = 'sqlite';

const db = new Database(':memory:');
try {
  // Simulate the older production schema that existed before quote fields were added.
  db.exec(`
    CREATE TABLE quotation_prices (id TEXT PRIMARY KEY, sku_code TEXT NOT NULL);
    CREATE TABLE suppliers (id TEXT PRIMARY KEY, name TEXT, associated_brands TEXT);
    CREATE TABLE skus (sku_code TEXT, brand TEXT);
    INSERT INTO quotation_prices (id, sku_code) VALUES ('quote-1', 'RD-M724');
  `);

  const statements = [];
  const app = { get() {}, post() {} };
  const params = value => Array.isArray(value) ? value : (value == null ? [] : [value]);
  const deps = {
    app,
    query(sql, values) {
      return { rows: db.prepare(sql).all(...params(values)) };
    },
    queryOne(sql, values) {
      return db.prepare(sql).get(...params(values)) || null;
    },
    run(sql, values) {
      statements.push(sql);
      return db.prepare(sql).run(...params(values));
    },
    transaction(fn) { return fn; },
    genId() { return 'test-id'; },
    asyncHandler(fn) { return fn; },
    requireApiPermission() { return function permissionStub() {}; }
  };

  installQuotationManagement(deps);

  const columns = new Set(db.prepare('PRAGMA table_info(quotation_prices)').all().map(row => row.name));
  for (const name of [
    'brand', 'product_type', 'quote_price', 'currency', 'quote_date',
    'remark', 'import_batch_id', 'created_at', 'updated_at',
    'supplier_id', 'supplier_part_no', 'supplier_part_no_key',
    'psi_sku_code', 'match_status', 'model', 'spec', 'source_sheet', 'source_row'
  ]) {
    assert.ok(columns.has(name), 'legacy quotation_prices must be migrated with ' + name);
  }

  // The backfill SQL must execute on SQLite, not merely contain the expected column names.
  db.prepare("UPDATE quotation_prices SET brand='Redragon', match_status='matched' WHERE id='quote-1'").run();
  db.prepare("INSERT INTO suppliers (id,name,associated_brands) VALUES ('supplier-1','Redragon','Redragon')").run();
  db.prepare("INSERT INTO skus (sku_code,brand) VALUES ('RD-M724','Redragon')").run();

  const beforeSecondInstall = statements.length;
  installQuotationManagement(deps);
  const secondInstallAdds = statements.slice(beforeSecondInstall)
    .filter(sql => /^ALTER TABLE quotation_prices ADD COLUMN/i.test(sql));
  assert.equal(secondInstallAdds.length, 0, 'quotation schema migration must be idempotent');

  const migrated = db.prepare("SELECT supplier_id, psi_sku_code, match_status FROM quotation_prices WHERE id='quote-1'").get();
  assert.equal(migrated.supplier_id, 'supplier-1');
  assert.equal(migrated.psi_sku_code, 'RD-M724');
  assert.equal(migrated.match_status, 'matched');

  console.log('quotation legacy schema migration: PASS');
} finally {
  db.close();
  if (previousDriver === undefined) delete process.env.DB_DRIVER;
  else process.env.DB_DRIVER = previousDriver;
}
