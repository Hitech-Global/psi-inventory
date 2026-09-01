// P0-A Sync-Bridge Path Verification
//
// 通过完整生产等效链路执行 set-based UPDATE：
//   db.js syncRequest → db-sync-worker.js → db-pg.js → Neon PostgreSQL
//
// 关键：db-pg 用 pool，SET search_path 不跨连接保留，
// 所以所有操作放在 transaction() 内，事务开始时 SET search_path。
//
// Requires: DATABASE_URL, P0A_SCHEMA, DB_DRIVER=pg

process.env.DB_DRIVER = 'pg';
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const db = require('../db');

const schema = process.env.P0A_SCHEMA;
if (!schema) { console.log('P0A_SCHEMA not set'); process.exit(1); }

console.log('=== P0-A Sync-Bridge Path Verification ===');
console.log('DB_DRIVER:', process.env.DB_DRIVER);
console.log('Schema:', schema);
console.log('');

let pass = true;

// Step 1: Basic connectivity + query through sync bridge
console.log('Step 1: Basic query via sync bridge...');
const v = db.query('SELECT version() as v');
console.log('  PG version:', v.rows[0].v.split(',')[0].trim());
console.log('  OK (chain: db.js → syncRequest → worker → db-pg → Neon)');
console.log('');

// Step 2: Transaction + SET search_path + set-based UPDATE
console.log('Step 2: Full set-based UPDATE inside transaction (sync bridge)...');
db.transaction(() => {
  // Set schema inside transaction (single client for whole tx)
  db.run(`SET search_path TO ${schema}`);

  // Clean up test data
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

  // Setup: PO + PI + CI
  db.run("INSERT INTO purchase_orders (po_no, country, target_warehouse, po_status) VALUES ('PO-SB-1', 'SG', 'WH-SG', 'active')");
  const poRes = db.query("SELECT id FROM purchase_orders WHERE po_no = 'PO-SB-1'");
  const poId = poRes.rows[0].id;

  db.run("INSERT INTO purchase_order_items (po_id, sku_code, po_qty, transferred_pi_qty) VALUES (?, 'SKU-SB', 500, 200)", [poId]);

  db.run("INSERT INTO proforma_invoices (pi_no, pi_status, related_po_id, country, target_warehouse) VALUES ('PI-SB-1', 'confirmed', ?, '', '')", [poId]);
  const piRes = db.query("SELECT id FROM proforma_invoices WHERE pi_no = 'PI-SB-1'");
  const piId = piRes.rows[0].id;

  db.run("INSERT INTO proforma_invoice_items (pi_id, sku_code, pi_confirmed_qty, shipped_qty) VALUES (?, 'SKU-SB', 200, 80)", [piId]);

  db.run("INSERT INTO commercial_invoices (ci_no, country, target_warehouse, ci_status, brand) VALUES ('CI-SB-1', 'SG', 'WH-SG', 'confirmed', 'B1')");
  const ciRes = db.query("SELECT id FROM commercial_invoices WHERE ci_no = 'CI-SB-1'");
  const ciId = ciRes.rows[0].id;

  db.run("INSERT INTO commercial_invoice_items (ci_id, sku_code, shipped_qty) VALUES (?, 'SKU-SB', 50)", [ciId]);

  db.run("INSERT INTO inventory (sku_code, country, warehouse, available_qty) VALUES ('SKU-SB', 'SG', 'WH-SG', 10)");

  // === Set-based UPDATE (exact SQL from server.js PG path) ===

  // 1. in_transit_qty
  db.run('UPDATE inventory SET in_transit_qty = 0');
  db.run(`
    UPDATE inventory i
    SET in_transit_qty = src.in_transit_qty
    FROM (
      WITH shipped AS (
        SELECT cii.ci_id, cii.sku_code,
               SUM(COALESCE(cii.shipped_qty, 0)) AS shipped_qty
        FROM commercial_invoice_items cii
        JOIN commercial_invoices ci ON ci.id = cii.ci_id
        WHERE ci.ci_status NOT IN ('cancelled')
        GROUP BY cii.ci_id, cii.sku_code
      ),
      arrived AS (
        SELECT lb.related_ci_id AS ci_id, pli.sku_code,
               SUM(COALESCE(pli.total_qty, 0)) AS arrived_qty
        FROM logistics_batches lb
        JOIN packing_lists pl ON pl.logistics_batch_id = lb.id
        JOIN packing_list_items pli ON pli.pl_id = pl.id
        WHERE lb.logistics_status = 'completed'
          AND lb.related_ci_id IS NOT NULL
        GROUP BY lb.related_ci_id, pli.sku_code
      ),
      per_ci_transit AS (
        SELECT s.sku_code, ci.country, ci.target_warehouse AS warehouse,
               CASE WHEN COALESCE(s.shipped_qty, 0) - COALESCE(a.arrived_qty, 0) < 0 THEN 0
                    ELSE COALESCE(s.shipped_qty, 0) - COALESCE(a.arrived_qty, 0) END AS in_transit_qty
        FROM shipped s
        JOIN commercial_invoices ci ON ci.id = s.ci_id
        LEFT JOIN arrived a ON a.ci_id = s.ci_id AND a.sku_code = s.sku_code
        WHERE ci.country != '' AND ci.target_warehouse != ''
      )
      SELECT sku_code, country, warehouse, SUM(in_transit_qty) AS in_transit_qty
      FROM per_ci_transit
      GROUP BY sku_code, country, warehouse
      HAVING SUM(in_transit_qty) > 0
    ) src
    WHERE
      i.sku_code = src.sku_code
      AND i.country = src.country
      AND i.warehouse = src.warehouse
  `);

  // 2. pi_confirmed_unshipped_qty
  db.run('UPDATE inventory SET pi_confirmed_unshipped_qty = 0');
  db.run(`
    UPDATE inventory i
    SET pi_confirmed_unshipped_qty = src.pi_unshipped
    FROM (
      SELECT pii.sku_code,
             COALESCE(NULLIF(pi.country,''), po.country) as country,
             COALESCE(NULLIF(pi.target_warehouse,''), po.target_warehouse) as warehouse,
             SUM(pii.pi_confirmed_qty - pii.shipped_qty) as pi_unshipped
      FROM proforma_invoice_items pii
      JOIN proforma_invoices pi ON pii.pi_id = pi.id
      LEFT JOIN purchase_orders po ON pi.related_po_id = po.id
      WHERE pi.pi_status NOT IN ('cancelled', 'completed')
        AND (pii.pi_confirmed_qty - pii.shipped_qty) > 0
      GROUP BY pii.sku_code,
               COALESCE(NULLIF(pi.country,''), po.country),
               COALESCE(NULLIF(pi.target_warehouse,''), po.target_warehouse)
    ) src
    WHERE
      i.sku_code = src.sku_code
      AND i.country = src.country
      AND i.warehouse = src.warehouse
  `);

  // 3. po_unconfirmed_pi_qty
  db.run('UPDATE inventory SET po_unconfirmed_pi_qty = 0');
  db.run(`
    UPDATE inventory i
    SET po_unconfirmed_pi_qty = src.po_unconfirmed
    FROM (
      SELECT poi.sku_code, po.country, po.target_warehouse as warehouse,
             SUM(poi.po_qty - poi.transferred_pi_qty) as po_unconfirmed
      FROM purchase_order_items poi
      JOIN purchase_orders po ON poi.po_id = po.id
      WHERE po.po_status NOT IN ('cancelled', 'transferred_pi') AND (poi.po_qty - poi.transferred_pi_qty) > 0
      GROUP BY poi.sku_code, po.country, po.target_warehouse
    ) src
    WHERE
      i.sku_code = src.sku_code
      AND i.country = src.country
      AND i.warehouse = src.warehouse
  `);

  // Verify inside transaction
  const res = db.query(`
    SELECT sku_code, country, warehouse,
           in_transit_qty, pi_confirmed_unshipped_qty, po_unconfirmed_pi_qty
    FROM inventory
    ORDER BY sku_code
  `);
  const rows = res.rows;

  console.log('  Transaction successful');
  console.log('  Results:');
  for (const r of rows) {
    console.log(`    ${r.sku_code}/${r.country}/${r.warehouse}:`);
    console.log(`      in_transit_qty = ${r.in_transit_qty}`);
    console.log(`      pi_confirmed_unshipped_qty = ${r.pi_confirmed_unshipped_qty}`);
    console.log(`      po_unconfirmed_pi_qty = ${r.po_unconfirmed_pi_qty}`);
  }

  // Expected:
  // in_transit = 50 (50 shipped, 0 arrived)
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
});

console.log('  Transaction COMMIT: OK');
console.log('');

// Step 3: Sync bridge stats
console.log('Step 3: Sync bridge stats...');
const stats = db._syncBridgeStats();
console.log(`  totalRequests: ${stats.totalRequests}`);
console.log(`  workerReady: ${stats.workerReady}`);
console.log('');

// Summary
console.log('=== Result ===');
if (pass) {
  console.log('✅ SYNC-BRIDGE PATH VERIFIED');
  console.log('   Production-equivalent chain:');
  console.log('   db.js → syncRequest → db-sync-worker.js → db-pg.js → Neon PG');
  process.exit(0);
} else {
  console.log('❌ SYNC-BRIDGE PATH FAILED');
  process.exit(1);
}
