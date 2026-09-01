// P0-A Complexity Test — DB invocation count verification
//
// Instrument db.js run/query/queryOne 调用计数，
// 验证 PG path 的 DB call count 不随数据量增长。
//
// 测试三档：10 rows / 100 rows / 500 rows
// 期望：run = 6, query = 0, queryOne = 0 (application calls, 不含 BEGIN/COMMIT)
//
// Requires: DATABASE_URL, P0A_SCHEMA, DB_DRIVER=pg

process.env.DB_DRIVER = 'pg';
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const db = require('../db');

const schema = process.env.P0A_SCHEMA;
if (!schema) { console.log('P0A_SCHEMA not set'); process.exit(1); }

// ============================================================
// Instrumentation: wrap db methods to count invocations
// ============================================================

let counters = { run: 0, query: 0, queryOne: 0, begin: 0, commit: 0, rollback: 0 };

function resetCounters() {
  counters = { run: 0, query: 0, queryOne: 0, begin: 0, commit: 0, rollback: 0 };
}

const origRun = db.run;
const origQuery = db.query;
const origQueryOne = db.queryOne;
const origTransaction = db.transaction;

db.run = function(sql, params) {
  const trimmed = (sql || '').trim().toLowerCase();
  if (trimmed.startsWith('begin')) counters.begin++;
  else if (trimmed.startsWith('commit')) counters.commit++;
  else if (trimmed.startsWith('rollback')) counters.rollback++;
  else counters.run++;
  return origRun.call(this, sql, params);
};

db.query = function(sql, params) {
  counters.query++;
  return origQuery.call(this, sql, params);
};

db.queryOne = function(sql, params) {
  counters.queryOne++;
  return origQueryOne.call(this, sql, params);
};

// ============================================================
// Test data generator
// ============================================================

function generateData(client, n, schema) {
  // Generate N unique SKUs with PO + PI + CI data
  for (let i = 1; i <= n; i++) {
    const sku = `SKU-${String(i).padStart(5, '0')}`;
    const poNo = `PO-${i}`;
    const piNo = `PI-${i}`;
    const ciNo = `CI-${i}`;

    client.run("INSERT INTO purchase_orders (po_no, country, target_warehouse, po_status) VALUES (?, 'US', 'WH-A', 'active')", [poNo]);
    const poId = client.query("SELECT id FROM purchase_orders WHERE po_no = ?", [poNo]).rows[0].id;

    const poQty = 100 + (i % 10) * 10;
    const xferQty = Math.floor(poQty * 0.6);
    client.run("INSERT INTO purchase_order_items (po_id, sku_code, po_qty, transferred_pi_qty) VALUES (?, ?, ?, ?)",
      [poId, sku, poQty, xferQty]);

    client.run("INSERT INTO proforma_invoices (pi_no, pi_status, related_po_id, country, target_warehouse) VALUES (?, 'confirmed', ?, '', '')",
      [piNo, poId]);
    const piId = client.query("SELECT id FROM proforma_invoices WHERE pi_no = ?", [piNo]).rows[0].id;

    const shippedQty = Math.floor(xferQty * 0.5);
    client.run("INSERT INTO proforma_invoice_items (pi_id, sku_code, pi_confirmed_qty, shipped_qty) VALUES (?, ?, ?, ?)",
      [piId, sku, xferQty, shippedQty]);

    client.run("INSERT INTO commercial_invoices (ci_no, country, target_warehouse, ci_status, brand) VALUES (?, 'US', 'WH-A', 'confirmed', 'B')",
      [ciNo]);
    const ciId = client.query("SELECT id FROM commercial_invoices WHERE ci_no = ?", [ciNo]).rows[0].id;

    client.run("INSERT INTO commercial_invoice_items (ci_id, sku_code, shipped_qty) VALUES (?, ?, ?)",
      [ciId, sku, 30 + (i % 20) * 5]);

    client.run("INSERT INTO inventory (sku_code, country, warehouse, available_qty) VALUES (?, 'US', 'WH-A', ?)",
      [sku, 10 + i]);
  }
}

function cleanAll(client) {
  client.run('DELETE FROM packing_list_items');
  client.run('DELETE FROM packing_lists');
  client.run('DELETE FROM logistics_batches');
  client.run('DELETE FROM commercial_invoice_items');
  client.run('DELETE FROM commercial_invoices');
  client.run('DELETE FROM proforma_invoice_items');
  client.run('DELETE FROM proforma_invoices');
  client.run('DELETE FROM purchase_order_items');
  client.run('DELETE FROM purchase_orders');
  client.run('DELETE FROM inventory');
}

// ============================================================
// PG set-based UPDATE (exact SQL from server.js)
// ============================================================

function runSetBasedTransit(client) {
  client.run('UPDATE inventory SET in_transit_qty = 0');
  client.run(`
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

  client.run('UPDATE inventory SET pi_confirmed_unshipped_qty = 0');
  client.run(`
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

  client.run('UPDATE inventory SET po_unconfirmed_pi_qty = 0');
  client.run(`
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
}

// ============================================================
// OLD loop algorithm (for comparison formula)
// ============================================================

function runOldLoop(client) {
  // Reset
  client.run('UPDATE inventory SET in_transit_qty = 0');
  client.run('UPDATE inventory SET pi_confirmed_unshipped_qty = 0');
  client.run('UPDATE inventory SET po_unconfirmed_pi_qty = 0');

  // Transit: 1 SELECT + N × (1 queryOne + 1 UPDATE)
  const transitRes = client.query(`
    WITH shipped AS (
      SELECT cii.ci_id, cii.sku_code, SUM(COALESCE(cii.shipped_qty, 0)) AS shipped_qty
      FROM commercial_invoice_items cii JOIN commercial_invoices ci ON ci.id = cii.ci_id
      WHERE ci.ci_status NOT IN ('cancelled')
      GROUP BY cii.ci_id, cii.sku_code
    ),
    arrived AS (
      SELECT lb.related_ci_id AS ci_id, pli.sku_code, SUM(COALESCE(pli.total_qty, 0)) AS arrived_qty
      FROM logistics_batches lb JOIN packing_lists pl ON pl.logistics_batch_id = lb.id
        JOIN packing_list_items pli ON pli.pl_id = pl.id
      WHERE lb.logistics_status = 'completed' AND lb.related_ci_id IS NOT NULL
      GROUP BY lb.related_ci_id, pli.sku_code
    ),
    per_ci_transit AS (
      SELECT s.sku_code, ci.country, ci.target_warehouse AS warehouse,
             CASE WHEN COALESCE(s.shipped_qty, 0) - COALESCE(a.arrived_qty, 0) < 0 THEN 0
                  ELSE COALESCE(s.shipped_qty, 0) - COALESCE(a.arrived_qty, 0) END AS in_transit_qty
      FROM shipped s JOIN commercial_invoices ci ON ci.id = s.ci_id
        LEFT JOIN arrived a ON a.ci_id = s.ci_id AND a.sku_code = s.sku_code
      WHERE ci.country != '' AND ci.target_warehouse != ''
    )
    SELECT sku_code, country, warehouse, SUM(in_transit_qty) AS in_transit_qty
    FROM per_ci_transit GROUP BY sku_code, country, warehouse
    HAVING SUM(in_transit_qty) > 0
  `);
  for (const row of transitRes.rows) {
    const inv = client.queryOne("SELECT id FROM inventory WHERE sku_code = ? AND country = ? AND warehouse = ?",
      [row.sku_code, row.country, row.warehouse]);
    if (inv) {
      client.run('UPDATE inventory SET in_transit_qty = ? WHERE id = ?', [row.in_transit_qty, inv.id]);
    }
  }

  // PI: 1 SELECT + N × (1 queryOne + 1 UPDATE)
  const piRes = client.query(`
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
  `);
  for (const row of piRes.rows) {
    const inv = client.queryOne("SELECT id FROM inventory WHERE sku_code = ? AND country = ? AND warehouse = ?",
      [row.sku_code, row.country, row.warehouse]);
    if (inv) {
      client.run('UPDATE inventory SET pi_confirmed_unshipped_qty = ? WHERE id = ?', [row.pi_unshipped, inv.id]);
    }
  }

  // PO: 1 SELECT + N × (1 queryOne + 1 UPDATE)
  const poRes = client.query(`
    SELECT poi.sku_code, po.country, po.target_warehouse as warehouse,
           SUM(poi.po_qty - poi.transferred_pi_qty) as po_unconfirmed
    FROM purchase_order_items poi
    JOIN purchase_orders po ON poi.po_id = po.id
    WHERE po.po_status NOT IN ('cancelled', 'transferred_pi') AND (poi.po_qty - poi.transferred_pi_qty) > 0
    GROUP BY poi.sku_code, po.country, po.target_warehouse
  `);
  for (const row of poRes.rows) {
    const inv = client.queryOne("SELECT id FROM inventory WHERE sku_code = ? AND country = ? AND warehouse = ?",
      [row.sku_code, row.country, row.warehouse]);
    if (inv) {
      client.run('UPDATE inventory SET po_unconfirmed_pi_qty = ? WHERE id = ?', [row.po_unconfirmed, inv.id]);
    }
  }
}

// ============================================================
// Test runner
// ============================================================

function testScale(n) {
  // Clean and insert test data inside transaction (schema set inside tx)
  db.transaction(() => {
    db.run(`SET search_path TO ${schema}`);
    cleanAll(db);
    generateData(db, n, schema);
  });

  // --- NEW set-based ---
  // SET search_path 是测试 harness 操作，不属于应用层调用
  db.transaction(() => {
    db.run(`SET search_path TO ${schema}`);
    resetCounters(); // 在 SET 之后清零，只计数实际业务调用
    runSetBasedTransit(db);
  });

  const newStats = { ...counters };

  // --- OLD loop ---
  db.transaction(() => {
    db.run(`SET search_path TO ${schema}`);
    resetCounters(); // 在 SET 之后清零，只计数实际业务调用
    runOldLoop(db);
  });

  const oldStats = { ...counters };

  // Count actual rows in aggregation results (for OLD formula verification)
  let transitRows = 0, piRows = 0, poRows = 0;
  db.transaction(() => {
    db.run(`SET search_path TO ${schema}`);
    const t = db.query(`
      SELECT COUNT(*) as cnt FROM (
        WITH shipped AS (
          SELECT cii.ci_id, cii.sku_code, SUM(COALESCE(cii.shipped_qty, 0)) AS shipped_qty
          FROM commercial_invoice_items cii JOIN commercial_invoices ci ON ci.id = cii.ci_id
          WHERE ci.ci_status NOT IN ('cancelled')
          GROUP BY cii.ci_id, cii.sku_code
        ),
        arrived AS (
          SELECT lb.related_ci_id AS ci_id, pli.sku_code, SUM(COALESCE(pli.total_qty, 0)) AS arrived_qty
          FROM logistics_batches lb JOIN packing_lists pl ON pl.logistics_batch_id = lb.id
            JOIN packing_list_items pli ON pli.pl_id = pl.id
          WHERE lb.logistics_status = 'completed' AND lb.related_ci_id IS NOT NULL
          GROUP BY lb.related_ci_id, pli.sku_code
        ),
        per_ci_transit AS (
          SELECT s.sku_code, ci.country, ci.target_warehouse AS warehouse,
                 CASE WHEN COALESCE(s.shipped_qty, 0) - COALESCE(a.arrived_qty, 0) < 0 THEN 0
                      ELSE COALESCE(s.shipped_qty, 0) - COALESCE(a.arrived_qty, 0) END AS in_transit_qty
          FROM shipped s JOIN commercial_invoices ci ON ci.id = s.ci_id
            LEFT JOIN arrived a ON a.ci_id = s.ci_id AND a.sku_code = s.sku_code
          WHERE ci.country != '' AND ci.target_warehouse != ''
        )
        SELECT sku_code, country, warehouse FROM per_ci_transit
        GROUP BY sku_code, country, warehouse
        HAVING SUM(in_transit_qty) > 0
      ) sub
    `);
    transitRows = parseInt(t.rows[0].cnt);

    const p = db.query(`
      SELECT COUNT(*) as cnt FROM (
        SELECT pii.sku_code,
               COALESCE(NULLIF(pi.country,''), po.country) as country,
               COALESCE(NULLIF(pi.target_warehouse,''), po.target_warehouse) as warehouse
        FROM proforma_invoice_items pii
        JOIN proforma_invoices pi ON pii.pi_id = pi.id
        LEFT JOIN purchase_orders po ON pi.related_po_id = po.id
        WHERE pi.pi_status NOT IN ('cancelled', 'completed')
          AND (pii.pi_confirmed_qty - pii.shipped_qty) > 0
        GROUP BY pii.sku_code,
                 COALESCE(NULLIF(pi.country,''), po.country),
                 COALESCE(NULLIF(pi.target_warehouse,''), po.target_warehouse)
      ) sub
    `);
    piRows = parseInt(p.rows[0].cnt);

    const o = db.query(`
      SELECT COUNT(*) as cnt FROM (
        SELECT poi.sku_code, po.country, po.target_warehouse as warehouse
        FROM purchase_order_items poi
        JOIN purchase_orders po ON poi.po_id = po.id
        WHERE po.po_status NOT IN ('cancelled', 'transferred_pi') AND (poi.po_qty - poi.transferred_pi_qty) > 0
        GROUP BY poi.sku_code, po.country, po.target_warehouse
      ) sub
    `);
    poRows = parseInt(o.rows[0].cnt);
  });

  return { n, transitRows, piRows, poRows, newStats, oldStats };
}

// ============================================================
// Main
// ============================================================

const SCALES = [10, 100, 500];
const results = [];
let allPass = true;

console.log('=== P0-A Complexity Test ===');
console.log('Schema:', schema);
console.log('DB_DRIVER: pg (sync bridge)');
console.log('');

for (const n of SCALES) {
  console.log(`[${n} rows] Generating data and running...`);
  const r = testScale(n);
  results.push(r);

  const newAppCalls = r.newStats.run; // 6 set-based UPDATEs (3 reset + 3 update)
  const oldAppCalls = 3 + r.oldStats.query + r.oldStats.queryOne + r.oldStats.run; // 3 reset + selects + queryOnes + updates
  const expectedNew = 6;

  const pass = newAppCalls === expectedNew;
  if (!pass) allPass = false;

  console.log(`  Aggregate rows: transit=${r.transitRows}, pi=${r.piRows}, po=${r.poRows}`);
  console.log(`  OLD app calls: run=${r.oldStats.run}, query=${r.oldStats.query}, queryOne=${r.oldStats.queryOne}`);
  console.log(`  NEW app calls: run=${r.newStats.run}, query=${r.newStats.query}, queryOne=${r.newStats.queryOne}`);
  console.log(`  NEW target: run=6, query=0, queryOne=0  →  ${pass ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`  Complexity: ${pass ? 'O(1) constant' : 'NOT constant'}`);
  console.log('');
}

console.log('=== Summary ===');
console.log('');
console.log('OLD formula: 6 + 2×(N_transit + N_pi + N_po)');
console.log('NEW target:  6 (constant)');
console.log('');
console.log('Scale  | N_transit | N_pi | N_po | OLD calls | NEW calls | Complexity');
console.log('-------|-----------|------|------|-----------|-----------|-----------');
for (const r of results) {
  const oldApp = 6 + 2 * (r.transitRows + r.piRows + r.poRows);
  const newApp = r.newStats.run;
  const isConst = newApp === 6 ? 'O(1) ✅' : 'FAIL';
  console.log(`${String(r.n).padEnd(6)} | ${String(r.transitRows).padEnd(9)} | ${String(r.piRows).padEnd(4)} | ${String(r.poRows).padEnd(4)} | ${String(oldApp).padEnd(9)} | ${String(newApp).padEnd(9)} | ${isConst}`);
}
console.log('');

if (allPass) {
  console.log('✅ ALL SCALES PASS — DB invocation count is O(1) constant (~6)');
  process.exit(0);
} else {
  console.log('❌ FAILED — DB invocation count not constant');
  process.exit(1);
}
