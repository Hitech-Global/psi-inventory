// P0-A Real Function Runtime Test
//
// 直接调用 server.js 的真实 updateInventoryTransitData()，
// 而非复制 SQL。验证生产 code path 完整执行。
//
// 链路：server.js updateInventoryTransitData()
//   → db.js → syncRequest → db-sync-worker.js → db-pg.js → Neon PG
//
// Requires: DATABASE_URL, P0A_SCHEMA, DB_DRIVER=pg

process.env.DB_DRIVER = 'pg';

const db = require('../db');
const { updateInventoryTransitData } = require('../server.js');

const schema = process.env.P0A_SCHEMA;
if (!schema) { console.log('P0A_SCHEMA not set'); process.exit(1); }

console.log('=== P0-A Real Function Runtime Test ===');
console.log('DB_DRIVER:', process.env.DB_DRIVER);
console.log('Schema:', schema);
console.log('Source: server.js real updateInventoryTransitData()');
console.log('');

// We need to set search_path inside a transaction before calling the function,
// since db-pg uses pool (different connections per query outside tx).
// But updateInventoryTransitData() calls transaction() internally.
// We need the schema set for the whole session.
// Solution: set it via a GUC that applies to all pool connections.
// We'll use ALTER ROLE ... SET search_path, or just prefix the schema.
// Actually, the function uses table names without schema prefix,
// so we need search_path to be set for the connection.
// Since the function internally calls db.transaction(), and db-pg's
// transaction uses pool.connect() → single client for the whole tx,
// we can set search_path at the start of that transaction.
// But we can't inject into the function...
//
// Workaround: Use ALTER DATABASE SET search_path for the test,
// then reset it after.

const { Pool } = require('pg');
const testPool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  let pass = true;

  // Step 0: Set search_path for ALL connections to this database
  // (Neon serverless: each pool connection gets this setting)
  console.log('Step 0: Set search_path for all connections...');
  const adminClient = await testPool.connect();
  try {
    await adminClient.query(`ALTER DATABASE neondb SET search_path TO ${schema}, public`);
    console.log(`  ALTER DATABASE SET search_path TO ${schema}, public: OK`);
  } finally {
    adminClient.release();
  }
  console.log('');

  // Step 1: Verify sync bridge connectivity
  console.log('Step 1: Verify sync bridge...');
  const v = db.query('SELECT current_schema() as s, version() as v');
  console.log('  current_schema:', v.rows[0].s);
  console.log('  PG version:', v.rows[0].v.split(',')[0].trim());
  console.log('  OK');
  console.log('');

  // Step 2: Setup test data via sync bridge
  console.log('Step 2: Setup test data via sync bridge...');
  db.transaction(() => {
    db.run('DELETE FROM packing_list_items');
    db.run('DELETE FROM packing_lists');
    db.run('DELETE FROM logistics_batches');
    db.run('DELETE FROM commercial_invoice_items');
    db.run('DELETE FROM commercial_invoices');
    db.run('DELETE FROM proforma_invoice_items');
    db.run('DELETE FROM proforma_invoices');
    db.run('DELETE FROM purchase_order_items');
    db.run('DELETE FROM purchase_orders');
    db.run('DELETE FROM inventory');

    // PO + PI + CI for SKU-RT
    db.run("INSERT INTO purchase_orders (po_no, country, target_warehouse, po_status) VALUES ('PO-RT-1', 'SG', 'WH-SG', 'active')");
    const poRes = db.query("SELECT id FROM purchase_orders WHERE po_no = 'PO-RT-1'");
    const poId = poRes.rows[0].id;

    db.run("INSERT INTO purchase_order_items (po_id, sku_code, po_qty, transferred_pi_qty) VALUES (?, 'SKU-RT', 500, 200)", [poId]);

    db.run("INSERT INTO proforma_invoices (pi_no, pi_status, related_po_id, country, target_warehouse) VALUES ('PI-RT-1', 'confirmed', ?, '', '')", [poId]);
    const piRes = db.query("SELECT id FROM proforma_invoices WHERE pi_no = 'PI-RT-1'");
    const piId = piRes.rows[0].id;

    db.run("INSERT INTO proforma_invoice_items (pi_id, sku_code, pi_confirmed_qty, shipped_qty) VALUES (?, 'SKU-RT', 200, 80)", [piId]);

    db.run("INSERT INTO commercial_invoices (ci_no, country, target_warehouse, ci_status, brand) VALUES ('CI-RT-1', 'SG', 'WH-SG', 'confirmed', 'B1')");
    const ciRes = db.query("SELECT id FROM commercial_invoices WHERE ci_no = 'CI-RT-1'");
    const ciId = ciRes.rows[0].id;

    db.run("INSERT INTO commercial_invoice_items (ci_id, sku_code, shipped_qty) VALUES (?, 'SKU-RT', 50)", [ciId]);

    db.run("INSERT INTO inventory (sku_code, country, warehouse, available_qty) VALUES ('SKU-RT', 'SG', 'WH-SG', 10)");
  });
  console.log('  Test data inserted');
  console.log('');

  // Step 3: Call the REAL updateInventoryTransitData from server.js
  console.log('Step 3: Call server.js real updateInventoryTransitData()...');
  console.log('  (async function, awaited)');
  await updateInventoryTransitData();
  console.log('  Function returned without error');
  console.log('');

  // Step 4: Verify results
  console.log('Step 4: Verify inventory results...');
  const res = db.query(`
    SELECT sku_code, country, warehouse,
           in_transit_qty, pi_confirmed_unshipped_qty, po_unconfirmed_pi_qty
    FROM inventory
    ORDER BY sku_code
  `);
  const rows = res.rows;

  for (const r of rows) {
    console.log(`  ${r.sku_code}/${r.country}/${r.warehouse}:`);
    console.log(`    in_transit_qty = ${r.in_transit_qty}`);
    console.log(`    pi_confirmed_unshipped_qty = ${r.pi_confirmed_unshipped_qty}`);
    console.log(`    po_unconfirmed_pi_qty = ${r.po_unconfirmed_pi_qty}`);
  }

  // Expected:
  // in_transit = 50 (50 shipped via CI, 0 arrived)
  // pi_unshipped = 120 (200 confirmed - 80 shipped)
  // po_unconfirmed = 300 (500 - 200 transferred)
  const expected = {
    in_transit_qty: 50,
    pi_confirmed_unshipped_qty: 120,
    po_unconfirmed_pi_qty: 300
  };

  const r = rows[0];
  for (const [k, v] of Object.entries(expected)) {
    if (r[k] !== v) {
      console.log(`  ❌ MISMATCH: ${k} = ${r[k]}, expected ${v}`);
      pass = false;
    }
  }
  if (pass) {
    console.log('  ✅ All values correct');
  }
  console.log('');

  // Step 5: Reset search_path
  console.log('Step 5: Reset search_path to public...');
  const resetClient = await testPool.connect();
  try {
    await resetClient.query('ALTER DATABASE neondb SET search_path TO public');
    console.log('  Reset OK');
  } finally {
    resetClient.release();
  }
  console.log('');

  // Summary
  console.log('=== Result ===');
  if (pass) {
    console.log('✅ REAL FUNCTION RUNTIME TEST PASSED');
    console.log('   server.js updateInventoryTransitData() executed successfully on Neon PG');
    console.log('   Production code path verified:');
    console.log('   server.js → db.js → syncRequest → db-sync-worker.js → db-pg.js → Neon PG');
    process.exit(0);
  } else {
    console.log('❌ REAL FUNCTION RUNTIME TEST FAILED');
    process.exit(1);
  }
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
