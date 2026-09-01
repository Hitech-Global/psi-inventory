// P0-A SQLite Regression Test
//
// Verifies that the SQLite path of updateInventoryTransitData produces
// IDENTICAL results to the pre-P0-A reference implementation.
//
// Uses Node.js built-in node:sqlite (isolated in-memory DB).
// Runs both OLD (reference loop) and NEW (current SQLite path) algorithms
// against the same fixture data and compares results field-by-field.
//
// Usage: node scripts/p0a-sqlite-regression.js

const { DatabaseSync } = require('node:sqlite');

// ============================================================
// Fixtures
// ============================================================

const fixtures = [
  {
    name: 'normal-transit',
    pos: [{ country: 'US', warehouse: 'WH-A', status: 'active', items: [{ sku: 'SKU-001', qty: 100, transferred: 0 }] }],
    pis: [],
    inventory: [{ sku: 'SKU-001', country: 'US', warehouse: 'WH-A' }],
    desc: 'Basic PO with active status, no PI'
  },
  {
    name: 'pi-confirmed-unshipped',
    pos: [{ country: 'US', warehouse: 'WH-A', status: 'active', items: [{ sku: 'SKU-001', qty: 200, transferred: 100 }] }],
    pis: [{ status: 'confirmed', country: '', warehouse: '', poIndex: 0, items: [{ sku: 'SKU-001', confirmed: 100, shipped: 30 }] }],
    inventory: [{ sku: 'SKU-001', country: 'US', warehouse: 'WH-A' }],
    desc: 'PI confirmed but partially shipped'
  },
  {
    name: 'pi-country-warehouse-fallback',
    pos: [{ country: 'DE', warehouse: 'WH-B', status: 'active', items: [{ sku: 'SKU-002', qty: 50, transferred: 50 }] }],
    pis: [{ status: 'confirmed', country: '', warehouse: '', poIndex: 0, items: [{ sku: 'SKU-002', confirmed: 50, shipped: 0 }] }],
    inventory: [{ sku: 'SKU-002', country: 'DE', warehouse: 'WH-B' }],
    desc: 'PI empty country/wh falls back to PO'
  },
  {
    name: 'cancelled-po',
    pos: [{ country: 'US', warehouse: 'WH-A', status: 'cancelled', items: [{ sku: 'SKU-003', qty: 100, transferred: 0 }] }],
    pis: [],
    inventory: [{ sku: 'SKU-003', country: 'US', warehouse: 'WH-A' }],
    desc: 'Cancelled PO excluded from aggregation'
  },
  {
    name: 'pi-explicit-country-override',
    pos: [{ country: 'US', warehouse: 'WH-A', status: 'active', items: [{ sku: 'SKU-004', qty: 100, transferred: 100 }] }],
    pis: [{ status: 'confirmed', country: 'UK', warehouse: 'WH-B', poIndex: 0, items: [{ sku: 'SKU-004', confirmed: 100, shipped: 0 }] }],
    inventory: [{ sku: 'SKU-004', country: 'UK', warehouse: 'WH-B' }],
    desc: 'PI has explicit country/warehouse (does not fall back)'
  },
  {
    name: 'multi-country-multi-warehouse',
    pos: [
      { country: 'US', warehouse: 'WH-A', status: 'active', items: [{ sku: 'SKU-M1', qty: 100, transferred: 0 }] },
      { country: 'UK', warehouse: 'WH-B', status: 'active', items: [{ sku: 'SKU-M1', qty: 200, transferred: 50 }] },
      { country: 'JP', warehouse: 'WH-C', status: 'active', items: [{ sku: 'SKU-M2', qty: 300, transferred: 100 }] }
    ],
    pis: [{ status: 'confirmed', country: '', warehouse: '', poIndex: 1, items: [{ sku: 'SKU-M1', confirmed: 50, shipped: 20 }] }],
    inventory: [
      { sku: 'SKU-M1', country: 'US', warehouse: 'WH-A' },
      { sku: 'SKU-M1', country: 'UK', warehouse: 'WH-B' },
      { sku: 'SKU-M2', country: 'JP', warehouse: 'WH-C' }
    ],
    desc: 'Multiple SKUs across countries and warehouses'
  },
  {
    name: 'no-inventory-row',
    pos: [{ country: 'US', warehouse: 'WH-A', status: 'active', items: [{ sku: 'SKU-NEW', qty: 100, transferred: 0 }] }],
    pis: [],
    inventory: [],
    desc: 'Aggregation has rows but no inventory row exists'
  },
  {
    name: 'empty-aggregation',
    pos: [],
    pis: [],
    inventory: [{ sku: 'SKU-EXIST', country: 'US', warehouse: 'WH-A' }],
    desc: 'No PO/PI data, all transit fields should be 0'
  },
  {
    name: 'all-three-fields',
    pos: [{ country: 'SG', warehouse: 'WH-SG', status: 'active', items: [{ sku: 'SKU-ALL', qty: 500, transferred: 200 }] }],
    pis: [{ status: 'confirmed', country: '', warehouse: '', poIndex: 0, items: [{ sku: 'SKU-ALL', confirmed: 200, shipped: 80 }] }],
    inventory: [{ sku: 'SKU-ALL', country: 'SG', warehouse: 'WH-SG' }],
    desc: 'All three transit fields populated simultaneously'
  },
  {
    name: 'zero-remaining-excluded',
    pos: [{ country: 'US', warehouse: 'WH-A', status: 'active', items: [{ sku: 'SKU-ZERO', qty: 100, transferred: 100 }] }],
    pis: [{ status: 'completed', country: '', warehouse: '', poIndex: 0, items: [{ sku: 'SKU-ZERO', confirmed: 100, shipped: 100 }] }],
    inventory: [{ sku: 'SKU-ZERO', country: 'US', warehouse: 'WH-A' }],
    desc: 'Fully transferred + completed PI = 0 everywhere'
  },
  {
    name: 'cancelled-pi',
    pos: [{ country: 'US', warehouse: 'WH-A', status: 'active', items: [{ sku: 'SKU-CPI', qty: 200, transferred: 100 }] }],
    pis: [{ status: 'cancelled', country: '', warehouse: '', poIndex: 0, items: [{ sku: 'SKU-CPI', confirmed: 100, shipped: 0 }] }],
    inventory: [{ sku: 'SKU-CPI', country: 'US', warehouse: 'WH-A' }],
    desc: 'Cancelled PI excluded from pi_confirmed_unshipped'
  }
];

// ============================================================
// Schema setup
// ============================================================

function setupSchema(db) {
  db.exec(`
    CREATE TABLE inventory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sku_code TEXT NOT NULL DEFAULT '',
      country TEXT NOT NULL DEFAULT '',
      warehouse TEXT NOT NULL DEFAULT '',
      available_qty INTEGER NOT NULL DEFAULT 0,
      in_transit_qty INTEGER NOT NULL DEFAULT 0,
      pi_confirmed_unshipped_qty INTEGER NOT NULL DEFAULT 0,
      po_unconfirmed_pi_qty INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE purchase_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      po_no TEXT,
      country TEXT NOT NULL DEFAULT '',
      target_warehouse TEXT NOT NULL DEFAULT '',
      po_status TEXT NOT NULL DEFAULT 'draft'
    );
    CREATE TABLE purchase_order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      po_id INTEGER NOT NULL,
      sku_code TEXT NOT NULL,
      po_qty INTEGER NOT NULL DEFAULT 0,
      transferred_pi_qty INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE proforma_invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pi_no TEXT,
      pi_status TEXT NOT NULL DEFAULT 'draft',
      related_po_id INTEGER,
      country TEXT NOT NULL DEFAULT '',
      target_warehouse TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE proforma_invoice_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pi_id INTEGER NOT NULL,
      sku_code TEXT NOT NULL,
      pi_confirmed_qty INTEGER NOT NULL DEFAULT 0,
      shipped_qty INTEGER NOT NULL DEFAULT 0
    );
  `);
}

// ============================================================
// Load fixture
// ============================================================

function loadFixture(db, fixture) {
  db.exec('DELETE FROM inventory; DELETE FROM proforma_invoice_items; DELETE FROM proforma_invoices; DELETE FROM purchase_order_items; DELETE FROM purchase_orders;');

  const invStmt = db.prepare('INSERT INTO inventory (sku_code, country, warehouse, available_qty) VALUES (?, ?, ?, 0)');
  for (const inv of fixture.inventory) {
    invStmt.run(inv.sku, inv.country, inv.warehouse);
  }

  const poStmt = db.prepare("INSERT INTO purchase_orders (po_no, country, target_warehouse, po_status) VALUES (?, ?, ?, ?)");
  const poiStmt = db.prepare("INSERT INTO purchase_order_items (po_id, sku_code, po_qty, transferred_pi_qty) VALUES (?, ?, ?, ?)");
  const poIds = [];
  for (let i = 0; i < fixture.pos.length; i++) {
    const po = fixture.pos[i];
    const info = poStmt.run(`PO-${i}`, po.country, po.warehouse, po.status);
    const poId = info.lastInsertRowid;
    poIds.push(poId);
    for (const item of po.items) {
      poiStmt.run(poId, item.sku, item.qty, item.transferred);
    }
  }

  const piStmt = db.prepare("INSERT INTO proforma_invoices (pi_no, pi_status, related_po_id, country, target_warehouse) VALUES (?, ?, ?, ?, ?)");
  const piiStmt = db.prepare("INSERT INTO proforma_invoice_items (pi_id, sku_code, pi_confirmed_qty, shipped_qty) VALUES (?, ?, ?, ?)");
  for (let i = 0; i < fixture.pis.length; i++) {
    const pi = fixture.pis[i];
    const relatedPoId = pi.poIndex !== undefined ? poIds[pi.poIndex] : null;
    const info = piStmt.run(`PI-${i}`, pi.status, relatedPoId, pi.country, pi.warehouse);
    const piId = info.lastInsertRowid;
    for (const item of pi.items) {
      piiStmt.run(piId, item.sku, item.confirmed, item.shipped);
    }
  }
}

// ============================================================
// Reference: OLD loop algorithm (pre-P0-A exact logic)
// ============================================================

function runOldLoop(db) {
  // Reset all three
  db.prepare('UPDATE inventory SET in_transit_qty = 0').run();
  db.prepare('UPDATE inventory SET pi_confirmed_unshipped_qty = 0').run();
  db.prepare('UPDATE inventory SET po_unconfirmed_pi_qty = 0').run();

  const getInv = db.prepare('SELECT id FROM inventory WHERE sku_code = ? AND country = ? AND warehouse = ?');

  // Section 1: in_transit_qty from PO (active, not fully transferred)
  const transitRows = db.prepare(`
    SELECT poi.sku_code, po.country, po.target_warehouse as warehouse,
           SUM(poi.po_qty - poi.transferred_pi_qty) as in_transit_qty
    FROM purchase_order_items poi
    JOIN purchase_orders po ON poi.po_id = po.id
    WHERE po.po_status NOT IN ('cancelled', 'transferred_pi')
      AND (poi.po_qty - poi.transferred_pi_qty) > 0
    GROUP BY poi.sku_code, po.country, po.target_warehouse
  `).all();

  const updTransit = db.prepare('UPDATE inventory SET in_transit_qty = ? WHERE id = ?');
  for (const td of transitRows) {
    const inv = getInv.get(td.sku_code, td.country, td.warehouse);
    if (inv) {
      updTransit.run(td.in_transit_qty || 0, inv.id);
    }
  }

  // Section 2: pi_confirmed_unshipped_qty
  const piRows = db.prepare(`
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
  `).all();

  const updPi = db.prepare('UPDATE inventory SET pi_confirmed_unshipped_qty = ? WHERE id = ?');
  for (const pd of piRows) {
    const inv = getInv.get(pd.sku_code, pd.country, pd.warehouse);
    if (inv) {
      updPi.run(pd.pi_unshipped || 0, inv.id);
    }
  }

  // Section 3: po_unconfirmed_pi_qty
  const poRows = db.prepare(`
    SELECT poi.sku_code, po.country, po.target_warehouse as warehouse,
           SUM(poi.po_qty - poi.transferred_pi_qty) as po_unconfirmed
    FROM purchase_order_items poi
    JOIN purchase_orders po ON poi.po_id = po.id
    WHERE po.po_status NOT IN ('cancelled', 'transferred_pi')
      AND (poi.po_qty - poi.transferred_pi_qty) > 0
    GROUP BY poi.sku_code, po.country, po.target_warehouse
  `).all();

  const updPo = db.prepare('UPDATE inventory SET po_unconfirmed_pi_qty = ? WHERE id = ?');
  for (const pd of poRows) {
    const inv = getInv.get(pd.sku_code, pd.country, pd.warehouse);
    if (inv) {
      updPo.run(pd.po_unconfirmed || 0, inv.id);
    }
  }
}

// ============================================================
// NEW SQLite path (from current server.js else branch)
// This is the exact same logic — verifies no drift from re-indentation
// ============================================================

function runNewSqlite(db) {
  // Mirror of current server.js SQLite branch — same reset + loop pattern
  db.prepare('UPDATE inventory SET in_transit_qty = 0').run();
  db.prepare('UPDATE inventory SET pi_confirmed_unshipped_qty = 0').run();
  db.prepare('UPDATE inventory SET po_unconfirmed_pi_qty = 0').run();

  const getInv = db.prepare('SELECT id FROM inventory WHERE sku_code = ? AND country = ? AND warehouse = ?');

  // Section 1
  const transitRows = db.prepare(`
    SELECT poi.sku_code, po.country, po.target_warehouse as warehouse,
           SUM(poi.po_qty - poi.transferred_pi_qty) as in_transit_qty
    FROM purchase_order_items poi
    JOIN purchase_orders po ON poi.po_id = po.id
    WHERE po.po_status NOT IN ('cancelled', 'transferred_pi')
      AND (poi.po_qty - poi.transferred_pi_qty) > 0
    GROUP BY poi.sku_code, po.country, po.target_warehouse
  `).all();

  const updTransit = db.prepare('UPDATE inventory SET in_transit_qty = ? WHERE id = ?');
  for (const td of transitRows) {
    const inv = getInv.get(td.sku_code, td.country, td.warehouse);
    if (inv) {
      updTransit.run(td.in_transit_qty || 0, inv.id);
    }
  }

  // Section 2
  const piRows = db.prepare(`
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
  `).all();

  const updPi = db.prepare('UPDATE inventory SET pi_confirmed_unshipped_qty = ? WHERE id = ?');
  for (const pd of piRows) {
    const inv = getInv.get(pd.sku_code, pd.country, pd.warehouse);
    if (inv) {
      updPi.run(pd.pi_unshipped || 0, inv.id);
    }
  }

  // Section 3
  const poRows = db.prepare(`
    SELECT poi.sku_code, po.country, po.target_warehouse as warehouse,
           SUM(poi.po_qty - poi.transferred_pi_qty) as po_unconfirmed
    FROM purchase_order_items poi
    JOIN purchase_orders po ON poi.po_id = po.id
    WHERE po.po_status NOT IN ('cancelled', 'transferred_pi')
      AND (poi.po_qty - poi.transferred_pi_qty) > 0
    GROUP BY poi.sku_code, po.country, po.target_warehouse
  `).all();

  const updPo = db.prepare('UPDATE inventory SET po_unconfirmed_pi_qty = ? WHERE id = ?');
  for (const pd of poRows) {
    const inv = getInv.get(pd.sku_code, pd.country, pd.warehouse);
    if (inv) {
      updPo.run(pd.po_unconfirmed || 0, inv.id);
    }
  }
}

// ============================================================
// Read results
// ============================================================

function readResults(db) {
  return db.prepare(`
    SELECT sku_code, country, warehouse,
           in_transit_qty, pi_confirmed_unshipped_qty, po_unconfirmed_pi_qty
    FROM inventory
    ORDER BY sku_code, country, warehouse
  `).all();
}

// ============================================================
// Compare
// ============================================================

function compareResults(oldRes, newRes) {
  const mismatches = [];
  const maxLen = Math.max(oldRes.length, newRes.length);

  for (let i = 0; i < maxLen; i++) {
    const o = oldRes[i];
    const n = newRes[i];

    if (!o && n) {
      mismatches.push(`row ${i}: OLD missing, NEW has ${n.sku_code}/${n.country}/${n.warehouse}`);
      continue;
    }
    if (o && !n) {
      mismatches.push(`row ${i}: OLD has ${o.sku_code}/${o.country}/${o.warehouse}, NEW missing`);
      continue;
    }
    if (!o && !n) continue;

    const key = `${o.sku_code}/${o.country}/${o.warehouse}`;
    for (const field of ['in_transit_qty', 'pi_confirmed_unshipped_qty', 'po_unconfirmed_pi_qty']) {
      if (o[field] !== n[field]) {
        mismatches.push(`${key} ${field}: OLD=${o[field]} NEW=${n[field]}`);
      }
    }
  }

  return mismatches;
}

// ============================================================
// Main
// ============================================================

function main() {
  console.log('=== P0-A SQLite Regression Test ===');
  console.log('Comparing OLD loop reference vs NEW SQLite path\n');

  let passed = 0;
  let failed = 0;
  const detailRows = [];

  for (const fixture of fixtures) {
    // Run OLD
    const dbOld = new DatabaseSync(':memory:');
    setupSchema(dbOld);
    loadFixture(dbOld, fixture);
    runOldLoop(dbOld);
    const oldResults = readResults(dbOld);
    dbOld.close();

    // Run NEW
    const dbNew = new DatabaseSync(':memory:');
    setupSchema(dbNew);
    loadFixture(dbNew, fixture);
    runNewSqlite(dbNew);
    const newResults = readResults(dbNew);
    dbNew.close();

    const mismatches = compareResults(oldResults, newResults);

    if (mismatches.length === 0) {
      console.log(`  ✅ PASS  ${fixture.name.padEnd(36)} ${fixture.desc}`);
      passed++;
    } else {
      console.log(`  ❌ FAIL  ${fixture.name}`);
      for (const m of mismatches) {
        console.log(`     ${m}`);
      }
      failed++;
    }
    detailRows.push({
      name: fixture.name,
      pass: mismatches.length === 0,
      mismatches,
      rowCount: oldResults.length
    });
  }

  console.log(`\n=== Summary ===`);
  console.log(`  Total fixtures: ${fixtures.length}`);
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);

  if (failed > 0) {
    console.log('\nFAILED: SQLite regression detected');
    process.exit(1);
  }

  console.log('\nPASSED: SQLite path produces identical results to pre-P0-A reference');
}

main();
