#!/usr/bin/env node
'use strict';

/**
 * P0-B ISOLATED PG RUNTIME VERIFICATION
 *
 * Tests the real refreshInventoryTotals() from server.js against a disposable
 * Neon PostgreSQL schema (p0b_test). Verifies:
 *   - 20 fixtures: OLD loop vs NEW fast-path parity (warnings + inventory rows)
 *   - 6 DB-call scenarios: constant application DB calls (query/queryOne/run)
 *   - JSONB/NULL/NUMERIC: NULL preservation, TEXT not normalized, NUMERIC scale
 *   - ROLLBACK: transaction atomicity on INSERT failure
 *
 * Architecture:
 *   1. Admin Pool (direct pg.Pool) -> CREATE SCHEMA + ALTER DATABASE + CREATE TABLES
 *   2. Set process.env.DB_DRIVER='pg', DATABASE_URL
 *   3. require('./db') -> instrument query/queryOne/run/transaction -> require('./server')
 *      (server.js destructures at require-time, so wrapping BEFORE require works)
 *
 * Usage: /Users/a1-6/.workbuddy/binaries/node/versions/22.22.2/bin/node scripts/p0b-neon-runtime.js
 */

const { Pool } = require('pg');
const path = require('path');

// ==================== SECURITY GATE: ENV + NEON-ONLY ====================

const rawUrl = process.env.P0B_NEON_DATABASE_URL;

if (!rawUrl) {
  process.stderr.write('[P0B-NEON][FATAL] process.env.P0B_NEON_DATABASE_URL is required.\n');
  process.stderr.write('Set it to a disposable Neon test DB. NEVER use production credentials.\n');
  process.exit(2);
}

let _parsedDbUrl;
try {
  _parsedDbUrl = new URL(rawUrl);
} catch (e) {
  process.stderr.write('[P0B-NEON][FATAL] P0B_NEON_DATABASE_URL is not a valid URL: ' + e.message + '\n');
  process.exit(2);
}

if (!_parsedDbUrl.hostname.endsWith('.neon.tech')) {
  process.stderr.write('[P0B-NEON][FATAL] P0-B runtime verification only allows isolated Neon PostgreSQL.\n');
  process.stderr.write('Got hostname: ' + _parsedDbUrl.hostname + ' (must end in .neon.tech)\n');
  process.exit(2);
}

// Reject obvious production markers (Render / Supabase patterns).
const _prohibitedHosts = ['.render.com', 'supabase.co', '.compute.amazonaws.com'];
for (const h of _prohibitedHosts) {
  if (_parsedDbUrl.hostname.endsWith(h)) {
    process.stderr.write('[P0B-NEON][FATAL] Host pattern ' + h + ' is PROHIBITED in P0-B.\n');
    process.exit(2);
  }
}

// Extract database name from URL path (e.g., "/neondb" -> "neondb").
function _dbNameFromUrl(u) {
  let p = u.pathname || '';
  p = p.replace(/^\/+/, '');
  if (p === '') return 'postgres';
  return p;
}

const DB_URL = rawUrl;
const SCHEMA = 'p0b_test';
const DB_NAME = _dbNameFromUrl(_parsedDbUrl);
const TAG = '[P0B-NEON]';

console.log(TAG + ' === SECURITY GATE ===');
console.log(TAG + ' target host: ' + _parsedDbUrl.hostname + ' (.neon.tech=PASS)');
console.log(TAG + ' target db:   ' + DB_NAME);
console.log(TAG + ' test schema: ' + SCHEMA);
console.log(TAG + ' credential mode: P0B_NEON_DATABASE_URL env-only (no hardcode)');

// ==================== TABLE DDLs (all in p0b_test schema) ====================

const TABLE_DDLS = [
  'CREATE TABLE IF NOT EXISTS inventory_imports (id TEXT PRIMARY KEY, import_date TEXT NOT NULL, country TEXT DEFAULT \'\', warehouse TEXT DEFAULT \'\', channel TEXT DEFAULT \'\', sku_code TEXT DEFAULT \'\', available_qty INTEGER DEFAULT 0, last_inbound_date TEXT DEFAULT \'\', first_inbound_date TEXT DEFAULT \'\', remark TEXT DEFAULT \'\', snapshot_cutoff_date TEXT DEFAULT \'\', brand TEXT DEFAULT \'\', weighted_avg_cost NUMERIC(18,4) DEFAULT 0, created_at TEXT DEFAULT NOW())',
  'CREATE TABLE IF NOT EXISTS inventory (id TEXT PRIMARY KEY, sku_code TEXT NOT NULL, country TEXT DEFAULT \'\', warehouse TEXT DEFAULT \'\', available_qty INTEGER DEFAULT 0, in_transit_qty INTEGER DEFAULT 0, pi_confirmed_unshipped_qty INTEGER DEFAULT 0, po_unconfirmed_pi_qty INTEGER DEFAULT 0, after_sales_defective_qty INTEGER DEFAULT 0, mdf_outbound_qty INTEGER DEFAULT 0, weighted_avg_cost NUMERIC(18,4) DEFAULT 0, inventory_value NUMERIC(18,4) DEFAULT 0, last_import_date TEXT DEFAULT \'\', last_inbound_date TEXT DEFAULT \'\', first_inbound_date TEXT DEFAULT \'\', last_outbound_date TEXT DEFAULT \'\', turnover_months DOUBLE PRECISION DEFAULT 0, inventory_status TEXT DEFAULT \'normal\', is_focused INTEGER DEFAULT 0, safety_stock INTEGER DEFAULT 0, target_turnover_months DOUBLE PRECISION DEFAULT 0, replenishment_rule TEXT DEFAULT \'\', inventory_remark TEXT DEFAULT \'\', snapshot_cutoff_date TEXT DEFAULT \'\', updated_at TEXT DEFAULT NOW())',
  'CREATE TABLE IF NOT EXISTS wac_history (id TEXT PRIMARY KEY, version_no INTEGER NOT NULL, ci_id TEXT DEFAULT \'\', ci_no TEXT DEFAULT \'\', po_id TEXT DEFAULT \'\', po_no TEXT DEFAULT \'\', pi_id TEXT DEFAULT \'\', pi_no TEXT DEFAULT \'\', sku_code TEXT NOT NULL, model TEXT DEFAULT \'\', brand TEXT DEFAULT \'\', country TEXT DEFAULT \'\', warehouse TEXT DEFAULT \'\', original_qty NUMERIC(18,4) DEFAULT 0, original_avg_cost NUMERIC(18,4) DEFAULT 0, original_inventory_value NUMERIC(18,4) DEFAULT 0, inbound_qty NUMERIC(18,4) DEFAULT 0, unit_landing_cost NUMERIC(18,4) DEFAULT 0, inbound_total_cost NUMERIC(18,4) DEFAULT 0, new_avg_cost NUMERIC(18,4) DEFAULT 0, settlement_date TEXT DEFAULT \'\', confirmation_status TEXT DEFAULT \'confirmed\', is_locked INTEGER DEFAULT 1, confirmed_by TEXT DEFAULT \'\', confirmed_at TEXT DEFAULT \'\', logistics_batch_id TEXT, created_at TEXT DEFAULT NOW())',
  'CREATE TABLE IF NOT EXISTS purchase_orders (id TEXT PRIMARY KEY, po_no TEXT NOT NULL UNIQUE, supplier_id TEXT DEFAULT \'\', supplier_name TEXT DEFAULT \'\', brand TEXT DEFAULT \'\', country TEXT DEFAULT \'\', target_warehouse TEXT DEFAULT \'\', po_date TEXT NOT NULL, expected_delivery TEXT DEFAULT \'\', currency TEXT DEFAULT \'USD\', total_amount NUMERIC(18,4) DEFAULT 0, created_by TEXT DEFAULT \'\', created_by_name TEXT DEFAULT \'\', approver_id TEXT DEFAULT \'\', approver_name TEXT DEFAULT \'\', po_status TEXT DEFAULT \'draft\', approval_status TEXT DEFAULT \'pending\', from_suggestion INTEGER DEFAULT 0, attachment TEXT DEFAULT \'\', remark TEXT DEFAULT \'\', created_at TEXT DEFAULT NOW(), updated_at TEXT DEFAULT NOW())',
  'CREATE TABLE IF NOT EXISTS purchase_order_items (id TEXT PRIMARY KEY, po_id TEXT NOT NULL, po_no TEXT DEFAULT \'\', sku_code TEXT NOT NULL, po_qty INTEGER DEFAULT 0, unit_price NUMERIC(18,4) DEFAULT 0, po_amount NUMERIC(18,4) DEFAULT 0, transferred_pi_qty INTEGER DEFAULT 0, untransferred_pi_qty INTEGER DEFAULT 0, forecast_turnover_months DOUBLE PRECISION DEFAULT 0, remark TEXT DEFAULT \'\', created_at TEXT DEFAULT NOW())',
  'CREATE TABLE IF NOT EXISTS proforma_invoices (id TEXT PRIMARY KEY, pi_no TEXT NOT NULL UNIQUE, related_po_id TEXT DEFAULT \'\', related_po_no TEXT DEFAULT \'\', supplier_id TEXT DEFAULT \'\', supplier_name TEXT DEFAULT \'\', brand TEXT DEFAULT \'\', country TEXT DEFAULT \'\', target_warehouse TEXT DEFAULT \'\', pi_date TEXT NOT NULL, currency TEXT DEFAULT \'USD\', total_amount NUMERIC(18,4) DEFAULT 0, payment_terms TEXT DEFAULT \'\', need_deposit INTEGER DEFAULT 1, deposit_ratio DOUBLE PRECISION DEFAULT 0, balance_ratio DOUBLE PRECISION DEFAULT 100, payable_deposit NUMERIC(18,4) DEFAULT 0, paid_deposit NUMERIC(18,4) DEFAULT 0, deducted_deposit NUMERIC(18,4) DEFAULT 0, available_deduct_deposit NUMERIC(18,4) DEFAULT 0, shipped_amount NUMERIC(18,4) DEFAULT 0, unshipped_amount NUMERIC(18,4) DEFAULT 0, deposit_payment_status TEXT DEFAULT \'unpaid\', goods_payment_status TEXT DEFAULT \'unpaid\', pi_status TEXT DEFAULT \'pending\', expected_delivery TEXT DEFAULT \'\', attachment TEXT DEFAULT \'\', remark TEXT DEFAULT \'\', payment_term_id TEXT DEFAULT \'\', created_at TEXT DEFAULT NOW(), updated_at TEXT DEFAULT NOW())',
  'CREATE TABLE IF NOT EXISTS proforma_invoice_items (id TEXT PRIMARY KEY, pi_id TEXT NOT NULL, pi_no TEXT DEFAULT \'\', po_no TEXT DEFAULT \'\', sku_code TEXT NOT NULL, po_qty INTEGER DEFAULT 0, pi_confirmed_qty INTEGER DEFAULT 0, unit_price NUMERIC(18,4) DEFAULT 0, pi_amount NUMERIC(18,4) DEFAULT 0, shipped_qty INTEGER DEFAULT 0, unshipped_qty INTEGER DEFAULT 0, discount DOUBLE PRECISION DEFAULT 0, created_at TEXT DEFAULT NOW())',
  'CREATE TABLE IF NOT EXISTS commercial_invoices (id TEXT PRIMARY KEY, ci_no TEXT NOT NULL UNIQUE, related_po_id TEXT DEFAULT \'\', related_po_no TEXT DEFAULT \'\', related_pi_id TEXT DEFAULT \'\', related_pi_no TEXT DEFAULT \'\', supplier_id TEXT DEFAULT \'\', supplier_name TEXT DEFAULT \'\', brand TEXT DEFAULT \'\', country TEXT DEFAULT \'\', target_warehouse TEXT DEFAULT \'\', ci_date TEXT NOT NULL, shipment_batch INTEGER DEFAULT 1, currency TEXT DEFAULT \'USD\', goods_amount NUMERIC(18,4) DEFAULT 0, pi_total_amount NUMERIC(18,4) DEFAULT 0, amount_difference NUMERIC(18,4) DEFAULT 0, difference_reason TEXT DEFAULT \'\', ci_status TEXT DEFAULT \'draft\', should_deduct_deposit NUMERIC(18,4) DEFAULT 0, actual_deducted_deposit NUMERIC(18,4) DEFAULT 0, created_at TEXT DEFAULT NOW(), updated_at TEXT DEFAULT NOW())',
  'CREATE TABLE IF NOT EXISTS commercial_invoice_items (id TEXT PRIMARY KEY, ci_id TEXT NOT NULL, ci_no TEXT DEFAULT \'\', pi_no TEXT DEFAULT \'\', sku_code TEXT NOT NULL, shipped_qty INTEGER DEFAULT 0, unit_price NUMERIC(18,4) DEFAULT 0, discount NUMERIC(18,4) DEFAULT 0, net_unit_price NUMERIC(18,4) DEFAULT 0, ci_amount NUMERIC(18,4) DEFAULT 0, actual_customs_rate NUMERIC(18,8) DEFAULT NULL, inbound_qty INTEGER DEFAULT 0, uninbound_qty INTEGER DEFAULT 0, created_at TEXT DEFAULT NOW())',
  'CREATE TABLE IF NOT EXISTS packing_lists (id TEXT PRIMARY KEY, pl_no TEXT NOT NULL UNIQUE, related_po_id TEXT DEFAULT \'\', related_po_no TEXT DEFAULT \'\', related_pi_id TEXT DEFAULT \'\', related_pi_no TEXT DEFAULT \'\', related_ci_id TEXT DEFAULT \'\', related_ci_no TEXT DEFAULT \'\', supplier_id TEXT DEFAULT \'\', supplier_name TEXT DEFAULT \'\', brand TEXT DEFAULT \'\', country TEXT DEFAULT \'\', target_warehouse TEXT DEFAULT \'\', pl_date TEXT DEFAULT \'\', total_qty INTEGER DEFAULT 0, total_cartons INTEGER DEFAULT 0, total_gross_weight DOUBLE PRECISION DEFAULT 0, total_net_weight DOUBLE PRECISION DEFAULT 0, total_cbm DOUBLE PRECISION DEFAULT 0, attachment TEXT DEFAULT \'\', remark TEXT DEFAULT \'\', created_at TEXT DEFAULT NOW())',
  'CREATE TABLE IF NOT EXISTS packing_list_items (id TEXT PRIMARY KEY, pl_id TEXT NOT NULL, pl_no TEXT DEFAULT \'\', ci_no TEXT DEFAULT \'\', sku_code TEXT NOT NULL, cartons INTEGER DEFAULT 0, qty_per_carton INTEGER DEFAULT 0, total_qty INTEGER DEFAULT 0, gross_weight DOUBLE PRECISION DEFAULT 0, net_weight DOUBLE PRECISION DEFAULT 0, cbm DOUBLE PRECISION DEFAULT 0, remark TEXT DEFAULT \'\', created_at TEXT DEFAULT NOW())',
  'CREATE TABLE IF NOT EXISTS logistics_batches (id TEXT PRIMARY KEY, batch_no TEXT NOT NULL UNIQUE, related_ci_id TEXT DEFAULT \'\', related_ci_no TEXT DEFAULT \'\', forwarder_id TEXT DEFAULT \'\', forwarder_name TEXT DEFAULT \'\', transport_mode TEXT DEFAULT \'sea\', origin_port TEXT DEFAULT \'\', dest_port TEXT DEFAULT \'\', target_country TEXT DEFAULT \'\', target_warehouse TEXT DEFAULT \'\', pickup_date TEXT DEFAULT \'\', depart_date TEXT DEFAULT \'\', eta_date TEXT DEFAULT \'\', actual_arrival_date TEXT DEFAULT \'\', customs_start_date TEXT DEFAULT \'\', customs_end_date TEXT DEFAULT \'\', delivery_date TEXT DEFAULT \'\', inbound_complete_date TEXT DEFAULT \'\', logistics_status TEXT DEFAULT \'pending\', total_cartons INTEGER DEFAULT 0, total_weight DOUBLE PRECISION DEFAULT 0, total_cbm DOUBLE PRECISION DEFAULT 0, freight_currency TEXT DEFAULT \'USD\', international_freight NUMERIC(18,4) DEFAULT 0, local_charges NUMERIC(18,4) DEFAULT 0, customs_service_fee NUMERIC(18,4) DEFAULT 0, delivery_fee NUMERIC(18,4) DEFAULT 0, total_freight NUMERIC(18,4) DEFAULT 0, customs_duty NUMERIC(18,4) DEFAULT 0, created_at TEXT DEFAULT NOW(), updated_at TEXT DEFAULT NOW())'
];
const MIGRATION_DDLS = [
  "ALTER TABLE packing_lists ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'draft'",
  "ALTER TABLE packing_lists ADD COLUMN IF NOT EXISTS logistics_batch_id TEXT DEFAULT ''",
  "ALTER TABLE packing_lists ADD COLUMN IF NOT EXISTS updated_at TEXT DEFAULT NOW()",
  "ALTER TABLE packing_list_items ADD COLUMN IF NOT EXISTS gross_weight_per_carton DOUBLE PRECISION DEFAULT 0",
  "ALTER TABLE packing_list_items ADD COLUMN IF NOT EXISTS net_weight_per_carton DOUBLE PRECISION DEFAULT 0",
  "ALTER TABLE packing_list_items ADD COLUMN IF NOT EXISTS cbm_per_carton DOUBLE PRECISION DEFAULT 0",
  "ALTER TABLE packing_list_items ADD COLUMN IF NOT EXISTS length DOUBLE PRECISION DEFAULT 0",
  "ALTER TABLE packing_list_items ADD COLUMN IF NOT EXISTS width DOUBLE PRECISION DEFAULT 0",
  "ALTER TABLE packing_list_items ADD COLUMN IF NOT EXISTS height DOUBLE PRECISION DEFAULT 0",
  "ALTER TABLE commercial_invoices ADD COLUMN IF NOT EXISTS related_pi_ids TEXT DEFAULT ''",
  "ALTER TABLE commercial_invoices ADD COLUMN IF NOT EXISTS related_pi_nos TEXT DEFAULT ''",
  "ALTER TABLE commercial_invoices ADD COLUMN IF NOT EXISTS shipping_attachments TEXT NOT NULL DEFAULT '[]'",
  "ALTER TABLE commercial_invoice_items ADD COLUMN IF NOT EXISTS pi_id TEXT DEFAULT ''",
  "ALTER TABLE commercial_invoice_items ADD COLUMN IF NOT EXISTS discount DOUBLE PRECISION DEFAULT 0",
  "ALTER TABLE commercial_invoice_items ADD COLUMN IF NOT EXISTS net_unit_price NUMERIC(18,4) DEFAULT 0"
];

const ALL_TABLES = [
  'inventory_imports', 'inventory', 'wac_history',
  'purchase_orders', 'purchase_order_items',
  'proforma_invoices', 'proforma_invoice_items',
  'commercial_invoices', 'commercial_invoice_items',
  'packing_lists', 'packing_list_items',
  'logistics_batches'
];

// ==================== ADMIN POOL HELPERS ====================

function stripSslParams(connStr) {
  try {
    const u = new URL(connStr);
    u.searchParams.delete('sslmode');
    u.searchParams.delete('sslcert');
    u.searchParams.delete('sslkey');
    u.searchParams.delete('sslrootcert');
    u.searchParams.delete('channel_binding');
    return u.toString();
  } catch (e) {
    return connStr;
  }
}

function makeAdminPoolConfig() {
  return {
    connectionString: stripSslParams(DB_URL),
    ssl: { rejectUnauthorized: false },
    max: 3,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 15000
  };
}

async function setup() {
  const adminPool = new Pool(makeAdminPoolConfig());
  const client = await adminPool.connect();
  try {
    await client.query('CREATE SCHEMA IF NOT EXISTS ' + SCHEMA);
    await client.query('ALTER DATABASE ' + DB_NAME + ' SET search_path TO ' + SCHEMA + ', public');
    await client.query('SET search_path TO ' + SCHEMA + ', public');
    for (const ddl of TABLE_DDLS) {
      await client.query(ddl);
    }
    for (const ddl of MIGRATION_DDLS) {
      await client.query(ddl);
    }
    console.log(TAG + ' === SETUP ===');
    console.log(TAG + ' schema: created');
    console.log(TAG + ' tables: created');
    console.log(TAG + ' search_path: set');
  } finally {
    client.release();
  }
  await adminPool.end();
}

async function cleanup() {
  const adminPool = new Pool(makeAdminPoolConfig());
  const client = await adminPool.connect();
  let ok = true;
  try {
    await client.query('DROP SCHEMA IF EXISTS ' + SCHEMA + ' CASCADE');
    await client.query('ALTER DATABASE ' + DB_NAME + ' SET search_path TO public');
    await client.query('ALTER DATABASE ' + DB_NAME + ' RESET search_path');
    console.log(TAG + ' === CLEANUP ===');
    console.log(TAG + ' schema dropped: PASS');
  } catch (e) {
    ok = false;
    console.log(TAG + ' schema dropped: FAIL (' + e.message + ')');
  } finally {
    client.release();
  }
  await adminPool.end();
  return ok;
}

// ==================== MAIN ====================

async function main() {
  let fail = false;

  // --- Phase 1: Setup (admin pool) ---
  await setup();

  // --- Phase 2: Set env + require db + instrument + require server ---
  process.env.NODE_ENV = 'development';
  process.env.DB_DRIVER = 'pg';
  process.env.DATABASE_URL = DB_URL;

  const db = require(path.join(__dirname, '..', 'db'));

  let callCount = { query: 0, queryOne: 0, run: 0, transaction: 0 };
  let callLog = [];
  const origQuery = db.query;
  const origQueryOne = db.queryOne;
  const origRun = db.run;
  const origTransaction = db.transaction;
  db.query = function () { for (var _len = arguments.length, a = new Array(_len), _k = 0; _k < _len; _k++) { a[_k] = arguments[_k]; } callCount.query++; callLog.push('query'); return origQuery.apply(db, a); };
  db.queryOne = function () { for (var _len2 = arguments.length, a = new Array(_len2), _k2 = 0; _k2 < _len2; _k2++) { a[_k2] = arguments[_k2]; } callCount.queryOne++; callLog.push('queryOne'); return origQueryOne.apply(db, a); };
  db.run = function () { for (var _len3 = arguments.length, a = new Array(_len3), _k3 = 0; _k3 < _len3; _k3++) { a[_k3] = arguments[_k3]; } callCount.run++; callLog.push('run'); return origRun.apply(db, a); };
  db.transaction = function () { for (var _len4 = arguments.length, a = new Array(_len4), _k4 = 0; _k4 < _len4; _k4++) { a[_k4] = arguments[_k4]; } callCount.transaction++; callLog.push('transaction'); return origTransaction.apply(db, a); };
  function resetCounters() {
    callCount = { query: 0, queryOne: 0, run: 0, transaction: 0 };
    callLog = [];
  }

  const server = require(path.join(__dirname, '..', 'server'));

  // --- Phase 3: Helpers (sync bridge) ---

  var LATEST_IMPORTS_SQL = 'SELECT sku_code, country, warehouse, available_qty, import_date, snapshot_cutoff_date, weighted_avg_cost, last_inbound_date, first_inbound_date FROM inventory_imports i1 WHERE i1.import_date IS NOT NULL AND i1.import_date <> \'\' AND i1.import_date::date = (SELECT MAX(i2.import_date::date) FROM inventory_imports i2 WHERE i2.sku_code = i1.sku_code AND i2.country = i1.country AND i2.warehouse = i1.warehouse AND i2.import_date IS NOT NULL AND i2.import_date <> \'\')';

  function resetAll() {
    db.transaction(function () {
      var tbls = ALL_TABLES.slice().reverse();
      db.run('TRUNCATE ' + tbls.join(', ') + ' RESTART IDENTITY CASCADE');
    });
  }

  function insertImports(rows) {
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      db.run('INSERT INTO inventory_imports (id, import_date, country, warehouse, sku_code, available_qty, snapshot_cutoff_date, weighted_avg_cost, last_inbound_date, first_inbound_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [r.id, r.import_date || '', r.country || '', r.warehouse || '', r.sku_code || '', r.available_qty || 0, r.snapshot_cutoff_date || '', r.weighted_avg_cost !== undefined ? r.weighted_avg_cost : 0, r.last_inbound_date !== undefined ? r.last_inbound_date : '', r.first_inbound_date !== undefined ? r.first_inbound_date : '']);
    }
  }

  function insertInventory(rows) {
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      db.run('INSERT INTO inventory (id, sku_code, country, warehouse, available_qty, weighted_avg_cost, inventory_value, last_import_date, snapshot_cutoff_date, last_inbound_date, first_inbound_date, after_sales_defective_qty, mdf_outbound_qty, last_outbound_date, turnover_months, inventory_status, is_focused, safety_stock, target_turnover_months, replenishment_rule, inventory_remark) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [r.id, r.sku_code, r.country || '', r.warehouse || '', r.available_qty || 0, r.weighted_avg_cost || 0, r.inventory_value || 0, r.last_import_date || '', r.snapshot_cutoff_date || '', r.last_inbound_date !== undefined ? r.last_inbound_date : '', r.first_inbound_date !== undefined ? r.first_inbound_date : '', r.after_sales_defective_qty || 0, r.mdf_outbound_qty || 0, r.last_outbound_date || '', r.turnover_months || 0, r.inventory_status || 'normal', r.is_focused || 0, r.safety_stock || 0, r.target_turnover_months || 0, r.replenishment_rule || '', r.inventory_remark || '']);
    }
  }

  function insertWacHistory(rows) {
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      db.run('INSERT INTO wac_history (id, version_no, sku_code, country, warehouse, new_avg_cost, confirmation_status, is_locked) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [r.id, r.version_no, r.sku_code, r.country || '', r.warehouse || '', r.new_avg_cost !== undefined ? r.new_avg_cost : 0, r.confirmation_status || 'confirmed', r.is_locked !== undefined ? r.is_locked : 1]);
    }
  }

  function captureInventory() {
    return db.query('SELECT * FROM inventory ORDER BY sku_code, country, warehouse').rows;
  }

  var BUSINESS_FIELDS = ['sku_code', 'country', 'warehouse', 'available_qty', 'weighted_avg_cost', 'inventory_value', 'last_import_date', 'snapshot_cutoff_date', 'last_inbound_date', 'first_inbound_date'];
  var NON_REFRESH_FIELDS = ['after_sales_defective_qty', 'mdf_outbound_qty', 'last_outbound_date', 'turnover_months', 'inventory_status', 'is_focused', 'safety_stock', 'target_turnover_months', 'replenishment_rule', 'inventory_remark'];

  function valuesEqual(a, b) {
    if (a === b) return true;
    if (a === null || a === undefined) return b === null || b === undefined;
    if (b === null || b === undefined) return false;
    if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-9;
    return String(a) === String(b);
  }

  function compareInventory(oldRows, newRows) {
    var oldMap = {};
    for (var i = 0; i < oldRows.length; i++) {
      var r = oldRows[i];
      oldMap[r.sku_code + '\0' + r.country + '\0' + r.warehouse] = r;
    }
    if (oldRows.length !== newRows.length) return 'row count mismatch: old=' + oldRows.length + ' new=' + newRows.length;
    for (var j = 0; j < newRows.length; j++) {
      var nr = newRows[j];
      var k = nr.sku_code + '\0' + nr.country + '\0' + nr.warehouse;
      var or = oldMap[k];
      if (!or) return 'new row ' + k + ' not found in old';
      var isExisting = or.id === nr.id;
      for (var fi = 0; fi < BUSINESS_FIELDS.length; fi++) {
        var f = BUSINESS_FIELDS[fi];
        if (!valuesEqual(or[f], nr[f])) return 'field ' + f + ' mismatch for ' + k + ': old=' + JSON.stringify(or[f]) + ' new=' + JSON.stringify(nr[f]);
      }
      if (isExisting) {
        if (or.id !== nr.id) return 'id mismatch for ' + k + ': old=' + or.id + ' new=' + nr.id;
        for (var gi = 0; gi < NON_REFRESH_FIELDS.length; gi++) {
          var gf = NON_REFRESH_FIELDS[gi];
          if (!valuesEqual(or[gf], nr[gf])) return 'non-refresh field ' + gf + ' mismatch for ' + k + ': old=' + JSON.stringify(or[gf]) + ' new=' + JSON.stringify(nr[gf]);
        }
      }
    }
    return null;
  }

  function loadFixture(fx) {
    resetAll();
    insertImports(fx.imports);
    insertInventory(fx.inventory);
    insertWacHistory(fx.wacHistory);
  }

  // --- Fixture data builders ---
  function imp(id, sku, country, wh, qty, date, opts) {
    opts = opts || {};
    return { id: id, sku_code: sku, country: country, warehouse: wh, available_qty: qty, import_date: date, snapshot_cutoff_date: opts.cutoff || '', weighted_avg_cost: opts.wac !== undefined ? opts.wac : 0, last_inbound_date: opts.li !== undefined ? opts.li : '', first_inbound_date: opts.fi !== undefined ? opts.fi : '' };
  }
  function inv(id, sku, country, wh, opts) {
    opts = opts || {};
    return { id: id, sku_code: sku, country: country, warehouse: wh, available_qty: opts.qty || 0, weighted_avg_cost: opts.wac || 0, inventory_value: opts.iv || 0, last_import_date: opts.lid || '', snapshot_cutoff_date: opts.cutoff || '', last_inbound_date: opts.li, first_inbound_date: opts.fi, after_sales_defective_qty: opts.asd || 0, mdf_outbound_qty: opts.mdf || 0, last_outbound_date: opts.lod || '', turnover_months: opts.tom || 0, inventory_status: opts.status || 'normal', is_focused: opts.focused || 0, safety_stock: opts.ss || 0, target_turnover_months: opts.ttm || 0, replenishment_rule: opts.rr || '', inventory_remark: opts.remark || '' };
  }
  function wac(id, sku, country, wh, version, newAvgCost, opts) {
    opts = opts || {};
    return { id: id, version_no: version, sku_code: sku, country: country, warehouse: wh, new_avg_cost: newAvgCost, confirmation_status: opts.status || 'confirmed', is_locked: opts.locked !== undefined ? opts.locked : 1 };
  }

  // --- 20 FIXTURES ---
  var fixtures = [
    { name: 'confirmed-wac', desc: 'SKU-A confirmed WAC=12.50', cutoff: '', imports: [imp('f01i', 'SKU-A', 'CN', 'WH1', 100, '2025-07-01', { li: '2025-06-15', fi: '2025-01-10' })], inventory: [inv('f01v', 'SKU-A', 'CN', 'WH1', { qty: 50, wac: 10, iv: 500, lid: '2025-06-01', li: '2025-05-01', fi: '2025-01-01' })], wacHistory: [wac('f01w', 'SKU-A', 'CN', 'WH1', 2, 12.50)] },
    { name: 'existing-wac-fallback', desc: 'SKU-B existing WAC=8.00 fallback', cutoff: '', imports: [imp('f02i', 'SKU-B', 'US', 'WH2', 50, '2025-07-01')], inventory: [inv('f02v', 'SKU-B', 'US', 'WH2', { wac: 8.00, iv: 400 })], wacHistory: [] },
    { name: 'opening-wac-fallback', desc: 'SKU-C opening WAC=5.50 no warning', cutoff: '', imports: [imp('f03i', 'SKU-C', 'DE', 'WH3', 200, '2025-07-01', { wac: 5.50 })], inventory: [], wacHistory: [] },
    { name: 'no-wac-high-warning', desc: 'SKU-D no WAC high warning', cutoff: '', imports: [imp('f04i', 'SKU-D', 'JP', 'WH4', 10, '2025-07-01')], inventory: [], wacHistory: [] },
    { name: 'confirmed-null-wac', desc: 'SKU-E confirmed NULL new_avg_cost', cutoff: '', imports: [imp('f05i', 'SKU-E', 'CN', 'WH1', 100, '2025-07-01', { wac: 1 })], inventory: [inv('f05v', 'SKU-E', 'CN', 'WH1', { wac: 99, iv: 9900 })], wacHistory: [wac('f05w', 'SKU-E', 'CN', 'WH1', 1, null)] },
    { name: 'existing-last-inbound-null', desc: 'SKU-F last_inbound NULL preserved', cutoff: '', imports: [imp('f06i', 'SKU-F', 'UK', 'WH5', 100, '2025-07-01', { li: '' })], inventory: [inv('f06v', 'SKU-F', 'UK', 'WH5', { wac: 15, iv: 1500, li: null, fi: '2025-01-01' })], wacHistory: [wac('f06w', 'SKU-F', 'UK', 'WH5', 1, 15)] },
    { name: 'existing-first-inbound-null', desc: 'SKU-G first_inbound NULL preserved', cutoff: '', imports: [imp('f07i', 'SKU-G', 'FR', 'WH6', 100, '2025-07-01', { fi: '' })], inventory: [inv('f07v', 'SKU-G', 'FR', 'WH6', { wac: 15, iv: 1500, li: '2025-01-01', fi: null })], wacHistory: [wac('f07w', 'SKU-G', 'FR', 'WH6', 1, 15)] },
    { name: 'row-cutoff-priority', desc: 'SKU-H row cutoff wins over arg', cutoff: '2025-05-01', imports: [imp('f08i', 'SKU-H', 'CN', 'WH1', 100, '2025-07-01', { cutoff: '2025-06-01' })], inventory: [inv('f08v', 'SKU-H', 'CN', 'WH1', { wac: 10, iv: 1000 })], wacHistory: [wac('f08w', 'SKU-H', 'CN', 'WH1', 1, 10)] },
    { name: 'func-cutoff-fallback', desc: 'SKU-I arg cutoff fallback', cutoff: '2025-05-01', imports: [imp('f09i', 'SKU-I', 'US', 'WH2', 100, '2025-07-01', { cutoff: '' })], inventory: [inv('f09v', 'SKU-I', 'US', 'WH2', { wac: 10, iv: 1000 })], wacHistory: [wac('f09w', 'SKU-I', 'US', 'WH2', 1, 10)] },
    { name: 'manual-fields-preserved', desc: 'SKU-J manual fields unchanged', cutoff: '', imports: [imp('f10i', 'SKU-J', 'CN', 'WH1', 200, '2025-07-01')], inventory: [inv('f10v', 'SKU-J', 'CN', 'WH1', { wac: 10, iv: 1000, asd: 5, mdf: 3, status: 'locked', focused: 1, ss: 100, ttm: 6, rr: 'manual', remark: 'important' })], wacHistory: [wac('f10w', 'SKU-J', 'CN', 'WH1', 1, 10)] },
    { name: 'all-existing', desc: '3 SKUs K,L,M all existing', cutoff: '', imports: [imp('f11ia', 'SKU-K', 'CN', 'WH1', 100, '2025-07-01'), imp('f11ib', 'SKU-L', 'CN', 'WH1', 200, '2025-07-01'), imp('f11ic', 'SKU-M', 'CN', 'WH1', 300, '2025-07-01')], inventory: [inv('f11va', 'SKU-K', 'CN', 'WH1', { wac: 10, iv: 1000 }), inv('f11vb', 'SKU-L', 'CN', 'WH1', { wac: 20, iv: 4000 }), inv('f11vc', 'SKU-M', 'CN', 'WH1', { wac: 30, iv: 9000 })], wacHistory: [wac('f11wa', 'SKU-K', 'CN', 'WH1', 1, 10), wac('f11wb', 'SKU-L', 'CN', 'WH1', 1, 20), wac('f11wc', 'SKU-M', 'CN', 'WH1', 1, 30)] },
    { name: 'all-missing', desc: '3 SKUs N,O,P all missing', cutoff: '', imports: [imp('f12ia', 'SKU-N', 'US', 'WH2', 100, '2025-07-01', { wac: 5 }), imp('f12ib', 'SKU-O', 'US', 'WH2', 200, '2025-07-01', { wac: 6 }), imp('f12ic', 'SKU-P', 'US', 'WH2', 300, '2025-07-01', { wac: 7 })], inventory: [], wacHistory: [] },
    { name: 'mixed-existing-missing', desc: '4 SKUs Q,R existing; S,T missing', cutoff: '', imports: [imp('f13ia', 'SKU-Q', 'CN', 'WH1', 100, '2025-07-01'), imp('f13ib', 'SKU-R', 'CN', 'WH1', 200, '2025-07-01'), imp('f13ic', 'SKU-S', 'CN', 'WH1', 300, '2025-07-01', { wac: 8 }), imp('f13id', 'SKU-T', 'CN', 'WH1', 400, '2025-07-01', { wac: 9 })], inventory: [inv('f13va', 'SKU-Q', 'CN', 'WH1', { wac: 10, iv: 1000 }), inv('f13vb', 'SKU-R', 'CN', 'WH1', { wac: 20, iv: 4000 })], wacHistory: [wac('f13wa', 'SKU-Q', 'CN', 'WH1', 1, 10), wac('f13wb', 'SKU-R', 'CN', 'WH1', 1, 20)] },
    { name: 'warning-order-mixed', desc: '3 SKUs U(confirmed) V(existing) W(no-wac)', cutoff: '', imports: [imp('f14ia', 'SKU-U', 'CN', 'WH1', 100, '2025-07-01'), imp('f14ib', 'SKU-V', 'US', 'WH2', 200, '2025-07-01'), imp('f14ic', 'SKU-W', 'JP', 'WH3', 300, '2025-07-01')], inventory: [inv('f14va', 'SKU-U', 'CN', 'WH1', { wac: 5, iv: 500 }), inv('f14vb', 'SKU-V', 'US', 'WH2', { wac: 7, iv: 1400 })], wacHistory: [wac('f14wa', 'SKU-U', 'CN', 'WH1', 1, 11)] },
    { name: 'empty-latestimports', desc: 'No imports, transit still runs', cutoff: '', imports: [], inventory: [inv('f15v', 'SKU-LEFTOVER', 'CN', 'WH1', { wac: 5, iv: 500 })], wacHistory: [] },
    { name: 'multi-country', desc: 'SKU-X in CN,US,DE', cutoff: '', imports: [imp('f16ia', 'SKU-X', 'CN', 'WH1', 100, '2025-07-01'), imp('f16ib', 'SKU-X', 'US', 'WH1', 200, '2025-07-01'), imp('f16ic', 'SKU-X', 'DE', 'WH1', 300, '2025-07-01')], inventory: [inv('f16va', 'SKU-X', 'CN', 'WH1', { wac: 10, iv: 1000 }), inv('f16vb', 'SKU-X', 'US', 'WH1', { wac: 20, iv: 4000 }), inv('f16vc', 'SKU-X', 'DE', 'WH1', { wac: 30, iv: 9000 })], wacHistory: [wac('f16wa', 'SKU-X', 'CN', 'WH1', 1, 10), wac('f16wb', 'SKU-X', 'US', 'WH1', 1, 20), wac('f16wc', 'SKU-X', 'DE', 'WH1', 1, 30)] },
    { name: 'multi-warehouse', desc: 'SKU-Y in CN/WH1,WH2,WH3', cutoff: '', imports: [imp('f17ia', 'SKU-Y', 'CN', 'WH1', 100, '2025-07-01'), imp('f17ib', 'SKU-Y', 'CN', 'WH2', 200, '2025-07-01'), imp('f17ic', 'SKU-Y', 'CN', 'WH3', 300, '2025-07-01')], inventory: [inv('f17va', 'SKU-Y', 'CN', 'WH1', { wac: 10, iv: 1000 }), inv('f17vb', 'SKU-Y', 'CN', 'WH2', { wac: 20, iv: 4000 }), inv('f17vc', 'SKU-Y', 'CN', 'WH3', { wac: 30, iv: 9000 })], wacHistory: [wac('f17wa', 'SKU-Y', 'CN', 'WH1', 1, 10), wac('f17wb', 'SKU-Y', 'CN', 'WH2', 1, 20), wac('f17wc', 'SKU-Y', 'CN', 'WH3', 1, 30)] },
    { name: 'same-sku-different-loc', desc: 'SKU-Z in CN/WH1, US/WH2, JP/WH3', cutoff: '', imports: [imp('f18ia', 'SKU-Z', 'CN', 'WH1', 100, '2025-07-01'), imp('f18ib', 'SKU-Z', 'US', 'WH2', 200, '2025-07-01'), imp('f18ic', 'SKU-Z', 'JP', 'WH3', 300, '2025-07-01')], inventory: [inv('f18va', 'SKU-Z', 'CN', 'WH1', { wac: 10, iv: 1000 }), inv('f18vb', 'SKU-Z', 'US', 'WH2', { wac: 20, iv: 4000 }), inv('f18vc', 'SKU-Z', 'JP', 'WH3', { wac: 30, iv: 9000 })], wacHistory: [wac('f18wa', 'SKU-Z', 'CN', 'WH1', 1, 10), wac('f18wb', 'SKU-Z', 'US', 'WH2', 1, 20), wac('f18wc', 'SKU-Z', 'JP', 'WH3', 1, 30)] },
    { name: 'large-numeric', desc: 'SKU-BIG qty=1M wac=123456.789', cutoff: '', imports: [imp('f19i', 'SKU-BIG', 'CN', 'WH1', 1000000, '2025-07-01')], inventory: [], wacHistory: [wac('f19w', 'SKU-BIG', 'CN', 'WH1', 1, 123456.7890)] },
    { name: 'production-like-batch', desc: '5 SKUs mixed scenarios', cutoff: '2025-07-01', imports: [imp('f20ia', 'SKU-P1', 'CN', 'WH1', 100, '2025-07-01'), imp('f20ib', 'SKU-P2', 'CN', 'WH1', 200, '2025-07-01'), imp('f20ic', 'SKU-P3', 'CN', 'WH1', 300, '2025-07-01', { wac: 5.50 }), imp('f20id', 'SKU-P4', 'CN', 'WH1', 400, '2025-07-01'), imp('f20ie', 'SKU-P5', 'CN', 'WH1', 500, '2025-07-01', { wac: 7 })], inventory: [inv('f20va', 'SKU-P1', 'CN', 'WH1', { wac: 10, iv: 1000 }), inv('f20vb', 'SKU-P2', 'CN', 'WH1', { wac: 8, iv: 1600 })], wacHistory: [wac('f20wa', 'SKU-P1', 'CN', 'WH1', 1, 12.50)] }
  ];

  // --- Run 20 parity fixtures ---
  console.log(TAG + ' === FIXTURES ===');
  var fixturePass = 0;
  for (var idx = 0; idx < fixtures.length; idx++) {
    var fx = fixtures[idx];
    var num = String(idx + 1).padStart(2, '0');
    var pass = true;
    var reason = '';
    try {
      loadFixture(fx);
      resetCounters();
      var oldLatestImports = db.query(LATEST_IMPORTS_SQL).rows;
      var oldWarnings = [];
      origTransaction(function () {
        server.runOriginalInventoryTotalsLoop(oldLatestImports, fx.cutoff, oldWarnings);
      });
      var oldState = captureInventory();

      loadFixture(fx);
      resetCounters();
      var newResult = await server.refreshInventoryTotals(fx.cutoff);
      var newState = captureInventory();
      var newWarnings = newResult.warnings || [];

      var invCmp = compareInventory(oldState, newState);
      if (invCmp) { pass = false; reason = 'inventory: ' + invCmp; }
      if (pass && JSON.stringify(oldWarnings) !== JSON.stringify(newWarnings)) {
        pass = false; reason = 'warnings mismatch: old=' + JSON.stringify(oldWarnings) + ' new=' + JSON.stringify(newWarnings);
      }
    } catch (e) {
      pass = false; reason = e.message;
    }
    if (pass) fixturePass++;
    console.log(TAG + ' F' + num + ' ' + fx.name + ': ' + (pass ? 'PASS' : 'FAIL' + (reason ? ' - ' + reason : '')));
  }
  if (fixturePass !== fixtures.length) fail = true;
  console.log(TAG + ' fixtures: ' + fixturePass + '/' + fixtures.length + ' PASS');

  // --- 6 DB-CALL SCENARIOS ---
  console.log(TAG + ' === DB-CALL SCENARIOS ===');

  var scenarioFixtures = {
    A: { desc: 'all-existing', cutoff: '', imports: [imp('sA1', 'SKU-CA', 'CN', 'WH1', 100, '2025-07-01'), imp('sA2', 'SKU-CB', 'CN', 'WH1', 200, '2025-07-01'), imp('sA3', 'SKU-CC', 'CN', 'WH1', 300, '2025-07-01')], inventory: [inv('sAi1', 'SKU-CA', 'CN', 'WH1', { wac: 10, iv: 1000 }), inv('sAi2', 'SKU-CB', 'CN', 'WH1', { wac: 20, iv: 4000 }), inv('sAi3', 'SKU-CC', 'CN', 'WH1', { wac: 30, iv: 9000 })], wacHistory: [wac('sAw1', 'SKU-CA', 'CN', 'WH1', 1, 10), wac('sAw2', 'SKU-CB', 'CN', 'WH1', 1, 20), wac('sAw3', 'SKU-CC', 'CN', 'WH1', 1, 30)], expect: { query: 2, queryOne: 0, run: 7, total: 9 } },
    B: { desc: 'all-missing', cutoff: '', imports: [imp('sB1', 'SKU-CD', 'CN', 'WH1', 100, '2025-07-01', { wac: 5 }), imp('sB2', 'SKU-CE', 'CN', 'WH1', 200, '2025-07-01', { wac: 6 }), imp('sB3', 'SKU-CF', 'CN', 'WH1', 300, '2025-07-01', { wac: 7 })], inventory: [], wacHistory: [], expect: { query: 2, queryOne: 0, run: 7, total: 9 } },
    C: { desc: 'mixed', cutoff: '', imports: [imp('sC1', 'SKU-CG', 'CN', 'WH1', 100, '2025-07-01'), imp('sC2', 'SKU-CH', 'CN', 'WH1', 200, '2025-07-01', { wac: 5 })], inventory: [inv('sCi1', 'SKU-CG', 'CN', 'WH1', { wac: 10, iv: 1000 })], wacHistory: [wac('sCw1', 'SKU-CG', 'CN', 'WH1', 1, 10)], expect: { query: 2, queryOne: 0, run: 8, total: 10 } },
    D: { desc: 'empty', cutoff: '', imports: [], inventory: [], wacHistory: [], expect: { query: 1, queryOne: 0, run: 6, total: 7 } },
    E: { desc: 'dup-import N=3', cutoff: '', imports: [imp('sE1', 'SKU-CI', 'CN', 'WH1', 100, '2025-07-01'), imp('sE2', 'SKU-CI', 'CN', 'WH1', 200, '2025-07-01'), imp('sE3', 'SKU-CI', 'CN', 'WH1', 300, '2025-07-01')], inventory: [inv('sEi1', 'SKU-CI', 'CN', 'WH1', { wac: 10, iv: 1000 })], wacHistory: [wac('sEw1', 'SKU-CI', 'CN', 'WH1', 1, 10)], expect: { query: 1, queryOne: 6, run: 9, total: 16 } },
    F: { desc: 'dup-inventory N=3', cutoff: '', imports: [imp('sF1', 'SKU-CJ', 'CN', 'WH1', 100, '2025-07-01'), imp('sF2', 'SKU-CK', 'CN', 'WH1', 200, '2025-07-01'), imp('sF3', 'SKU-CL', 'CN', 'WH1', 300, '2025-07-01')], inventory: [inv('sFi1', 'SKU-CJ', 'CN', 'WH1', { wac: 10, iv: 1000 }), inv('sFi2', 'SKU-CJ', 'CN', 'WH1', { wac: 10, iv: 1000 })], wacHistory: [wac('sFw1', 'SKU-CJ', 'CN', 'WH1', 1, 10)], expect: { query: 2, queryOne: 6, run: 9, total: 17 } }
  };

  var scenarioPass = 0;
  var scenarioKeys = ['A', 'B', 'C', 'D', 'E', 'F'];
  for (var si = 0; si < scenarioKeys.length; si++) {
    var key = scenarioKeys[si];
    var sf = scenarioFixtures[key];
    var spass = true;
    var sreason = '';
    try {
      loadFixture(sf);
      resetCounters();
      await server.refreshInventoryTotals(sf.cutoff);
      var actual = { query: callCount.query, queryOne: callCount.queryOne, run: callCount.run, total: callCount.query + callCount.queryOne + callCount.run };
      var exp = sf.expect;
      var sok = actual.query === exp.query && actual.queryOne === exp.queryOne && actual.run === exp.run && actual.total === exp.total;
      if (!sok) { spass = false; sreason = 'expected q=' + exp.query + ' qo=' + exp.queryOne + ' r=' + exp.run + ' t=' + exp.total + ' got q=' + actual.query + ' qo=' + actual.queryOne + ' r=' + actual.run + ' t=' + actual.total; }
    } catch (e) {
      spass = false; sreason = e.message;
    }
    if (spass) scenarioPass++;
    console.log(TAG + ' ' + key + ' ' + sf.desc + ': query=' + callCount.query + ' queryOne=' + callCount.queryOne + ' run=' + callCount.run + ' total=' + (callCount.query + callCount.queryOne + callCount.run) + ' ' + (spass ? 'PASS' : 'FAIL - ' + sreason));
  }
  if (scenarioPass !== scenarioKeys.length) fail = true;
  console.log(TAG + ' db-calls: ' + scenarioPass + '/' + scenarioKeys.length + ' PASS');

  // --- JSONB/NULL/NUMERIC TESTS ---
  console.log(TAG + ' === JSONB/NULL/NUMERIC ===');
  var jsonbPass = true;

  // NULL last_inbound preserved (fixture 6)
  try {
    loadFixture(fixtures[5]);
    await server.refreshInventoryTotals(fixtures[5].cutoff);
    var r6 = db.queryOne("SELECT last_inbound_date, last_inbound_date IS NULL as is_null FROM inventory WHERE sku_code = 'SKU-F'");
    var ok6 = r6 && r6.is_null === true;
    if (!ok6) jsonbPass = false;
    console.log(TAG + ' NULL last_inbound_date preserved: ' + (ok6 ? 'PASS' : 'FAIL (got ' + JSON.stringify(r6) + ')'));
  } catch (e) { jsonbPass = false; console.log(TAG + ' NULL last_inbound_date preserved: FAIL (' + e.message + ')'); }

  // NULL first_inbound preserved (fixture 7)
  try {
    loadFixture(fixtures[6]);
    await server.refreshInventoryTotals(fixtures[6].cutoff);
    var r7 = db.queryOne("SELECT first_inbound_date, first_inbound_date IS NULL as is_null FROM inventory WHERE sku_code = 'SKU-G'");
    var ok7 = r7 && r7.is_null === true;
    if (!ok7) jsonbPass = false;
    console.log(TAG + ' NULL first_inbound_date preserved: ' + (ok7 ? 'PASS' : 'FAIL (got ' + JSON.stringify(r7) + ')'));
  } catch (e) { jsonbPass = false; console.log(TAG + ' NULL first_inbound_date preserved: FAIL (' + e.message + ')'); }

  // TEXT not normalized (fixture 1)
  try {
    loadFixture(fixtures[0]);
    await server.refreshInventoryTotals(fixtures[0].cutoff);
    var r1 = db.queryOne("SELECT last_import_date FROM inventory WHERE sku_code = 'SKU-A'");
    var ok1 = r1 && r1.last_import_date === '2025-07-01';
    if (!ok1) jsonbPass = false;
    console.log(TAG + " TEXT not normalized (last_import_date='2025-07-01'): " + (ok1 ? 'PASS' : 'FAIL (got ' + JSON.stringify(r1) + ')'));
  } catch (e) { jsonbPass = false; console.log(TAG + ' TEXT not normalized: FAIL (' + e.message + ')'); }

  // NUMERIC scale preserved (fixture 1: wac=12.50, invValue=1250)
  try {
    var r1n = db.queryOne("SELECT weighted_avg_cost::text as wac_text, inventory_value::text as iv_text FROM inventory WHERE sku_code = 'SKU-A'");
    var wacOk = r1n && r1n.wac_text === '12.5000';
    var ivOk = r1n && r1n.iv_text === '1250.0000';
    var ok1n = wacOk && ivOk;
    if (!ok1n) jsonbPass = false;
    console.log(TAG + ' NUMERIC scale preserved (wac=12.5000, iv=1250.0000): ' + (ok1n ? 'PASS' : 'FAIL (got wac=' + (r1n && r1n.wac_text) + ' iv=' + (r1n && r1n.iv_text) + ')'));
  } catch (e) { jsonbPass = false; console.log(TAG + ' NUMERIC scale preserved: FAIL (' + e.message + ')'); }

  // Large numeric (fixture 19)
  try {
    loadFixture(fixtures[18]);
    await server.refreshInventoryTotals(fixtures[18].cutoff);
    var r19 = db.queryOne("SELECT weighted_avg_cost::text as wac_text, inventory_value::text as iv_text FROM inventory WHERE sku_code = 'SKU-BIG'");
    var ok19 = r19 && r19.wac_text === '123456.7890' && r19.iv_text === '123456789000.0000';
    if (!ok19) jsonbPass = false;
    console.log(TAG + ' Large NUMERIC (wac=123456.7890, iv=123456789000.0000): ' + (ok19 ? 'PASS' : 'FAIL (got wac=' + (r19 && r19.wac_text) + ' iv=' + (r19 && r19.iv_text) + ')'));
  } catch (e) { jsonbPass = false; console.log(TAG + ' Large NUMERIC: FAIL (' + e.message + ')'); }

  if (!jsonbPass) fail = true;
  console.log(TAG + ' jsonb-null: ' + (jsonbPass ? 'PASS' : 'FAIL'));

  // --- ROLLBACK TEST ---
  console.log(TAG + ' === ROLLBACK ===');
  var rollbackPass = true;
  try {
    var rbFx = {
      cutoff: '',
      imports: [imp('rbi1', 'SKU-RB-EXIST', 'CN', 'WH1', 100, '2025-07-01'), imp('rbi2', 'SKU-RB-MISS', 'CN', 'WH1', 2000000000, '2025-07-01')],
      inventory: [inv('rbv1', 'SKU-RB-EXIST', 'CN', 'WH1', { wac: 10, iv: 1000 })],
      wacHistory: [wac('rbw1', 'SKU-RB-EXIST', 'CN', 'WH1', 1, 10), wac('rbw2', 'SKU-RB-MISS', 'CN', 'WH1', 1, 99999999.9999)]
    };
    loadFixture(rbFx);
    var beforeState = db.queryOne("SELECT * FROM inventory WHERE sku_code = 'SKU-RB-EXIST'");

    var threw = false;
    try {
      resetCounters();
      await server.refreshInventoryTotals(rbFx.cutoff);
    } catch (e) { threw = true; }

    if (!threw) {
      rollbackPass = false;
      console.log(TAG + ' rollback test: FAIL (expected error but none thrown)');
    } else {
      var afterState = db.queryOne("SELECT * FROM inventory WHERE sku_code = 'SKU-RB-EXIST'");
      var checkFields = ['id', 'sku_code', 'country', 'warehouse', 'available_qty', 'weighted_avg_cost', 'inventory_value', 'last_import_date', 'last_inbound_date', 'first_inbound_date', 'inventory_status', 'is_focused', 'safety_stock', 'after_sales_defective_qty', 'mdf_outbound_qty'];
      var unchanged = true;
      var diffField = '';
      for (var ci = 0; ci < checkFields.length; ci++) {
        var cf = checkFields[ci];
        if (!valuesEqual(beforeState[cf], afterState[cf])) { unchanged = false; diffField = cf + ': before=' + JSON.stringify(beforeState[cf]) + ' after=' + JSON.stringify(afterState[cf]); break; }
      }
      var missRow = db.queryOne("SELECT id FROM inventory WHERE sku_code = 'SKU-RB-MISS'");
      var notInserted = !missRow;
      if (unchanged && notInserted) {
        console.log(TAG + ' rollback test: PASS');
      } else {
        rollbackPass = false;
        console.log(TAG + ' rollback test: FAIL (unchanged=' + unchanged + ' notInserted=' + notInserted + (diffField ? ' ' + diffField : '') + ')');
      }
    }
  } catch (e) {
    rollbackPass = false;
    console.log(TAG + ' rollback test: FAIL (' + e.message + ')');
  }
  if (!rollbackPass) fail = true;
  console.log(TAG + ' rollback: ' + (rollbackPass ? 'PASS' : 'FAIL'));

  // --- CLEANUP ---
  await cleanup();

  // --- SUMMARY ---
  console.log(TAG + ' === SUMMARY ===');
  console.log(TAG + ' fixtures: ' + fixturePass + '/' + fixtures.length + ' PASS');
  console.log(TAG + ' db-calls: ' + scenarioPass + '/' + scenarioKeys.length + ' PASS');
  console.log(TAG + ' jsonb-null: ' + (jsonbPass ? 'PASS' : 'FAIL'));
  console.log(TAG + ' rollback: ' + (rollbackPass ? 'PASS' : 'FAIL'));

  process.exit(fail ? 1 : 0);
}

main().catch(function (e) {
  console.error(TAG + ' FATAL: ' + e.message);
  console.error(e.stack);
  process.exit(1);
});
