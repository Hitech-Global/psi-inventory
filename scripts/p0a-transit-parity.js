// P0-A Parity Test — OLD loop vs NEW set-based (PostgreSQL)
//
// SQL 直接从 server.js 的 updateInventoryTransitData() 复制，
// 确保业务口径 100% 一致。
//
// 使用 P0A_SCHEMA 环境变量指定隔离 schema。
// Requires: DATABASE_URL, P0A_SCHEMA

const { Pool } = require('pg');

const DB_URL = process.env.DATABASE_URL;
const SCHEMA = process.env.P0A_SCHEMA;

// ============================================================
// NEW PG set-based SQL (verbatim copy from server.js lines 4174-4259)
// ============================================================

const NEW_SQL = {
  resetTransit: 'UPDATE inventory SET in_transit_qty = 0',
  transit: `
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
  `,
  resetPi: 'UPDATE inventory SET pi_confirmed_unshipped_qty = 0',
  pi: `
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
  `,
  resetPo: 'UPDATE inventory SET po_unconfirmed_pi_qty = 0',
  po: `
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
  `
};

// ============================================================
// OLD loop algorithm (exact logic from pre-P0-A)
// ============================================================

const OLD_TRANSIT_SQL = `
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
`;

const OLD_PI_SQL = `
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
`;

const OLD_PO_SQL = `
  SELECT poi.sku_code, po.country, po.target_warehouse as warehouse,
         SUM(poi.po_qty - poi.transferred_pi_qty) as po_unconfirmed
  FROM purchase_order_items poi
  JOIN purchase_orders po ON poi.po_id = po.id
  WHERE po.po_status NOT IN ('cancelled', 'transferred_pi') AND (poi.po_qty - poi.transferred_pi_qty) > 0
  GROUP BY poi.sku_code, po.country, po.target_warehouse
`;

async function runOldLoop(client) {
  // Reset
  await client.query('UPDATE inventory SET in_transit_qty = 0');
  await client.query('UPDATE inventory SET pi_confirmed_unshipped_qty = 0');
  await client.query('UPDATE inventory SET po_unconfirmed_pi_qty = 0');

  const getInv = 'SELECT id FROM inventory WHERE sku_code = $1 AND country = $2 AND warehouse = $3';

  // Section 1: transit
  const transitRes = await client.query(OLD_TRANSIT_SQL);
  for (const row of transitRes.rows) {
    const inv = await client.query(getInv, [row.sku_code, row.country, row.warehouse]);
    if (inv.rows.length > 0) {
      await client.query('UPDATE inventory SET in_transit_qty = $1 WHERE id = $2',
        [row.in_transit_qty, inv.rows[0].id]);
    }
  }

  // Section 2: PI
  const piRes = await client.query(OLD_PI_SQL);
  for (const row of piRes.rows) {
    const inv = await client.query(getInv, [row.sku_code, row.country, row.warehouse]);
    if (inv.rows.length > 0) {
      await client.query('UPDATE inventory SET pi_confirmed_unshipped_qty = $1 WHERE id = $2',
        [row.pi_unshipped, inv.rows[0].id]);
    }
  }

  // Section 3: PO
  const poRes = await client.query(OLD_PO_SQL);
  for (const row of poRes.rows) {
    const inv = await client.query(getInv, [row.sku_code, row.country, row.warehouse]);
    if (inv.rows.length > 0) {
      await client.query('UPDATE inventory SET po_unconfirmed_pi_qty = $1 WHERE id = $2',
        [row.po_unconfirmed, inv.rows[0].id]);
    }
  }
}

async function runNewSetBased(client) {
  await client.query(NEW_SQL.resetTransit);
  await client.query(NEW_SQL.transit);
  await client.query(NEW_SQL.resetPi);
  await client.query(NEW_SQL.pi);
  await client.query(NEW_SQL.resetPo);
  await client.query(NEW_SQL.po);
}

// ============================================================
// Fixtures
// ============================================================

const FIXTURES = [
  {
    name: 'normal-transit',
    desc: 'CI shipped, not arrived',
    setup: async (c) => {
      await c.query("INSERT INTO commercial_invoices (ci_no, country, target_warehouse, ci_status, brand) VALUES ('CI-001', 'US', 'WH-A', 'confirmed', 'B1')");
      const ci = await c.query("SELECT id FROM commercial_invoices WHERE ci_no = 'CI-001'");
      await c.query("INSERT INTO commercial_invoice_items (ci_id, sku_code, shipped_qty) VALUES ($1, 'SKU-001', 100)", [ci.rows[0].id]);
      await c.query("INSERT INTO inventory (sku_code, country, warehouse, available_qty) VALUES ('SKU-001', 'US', 'WH-A', 50)");
    }
  },
  {
    name: 'partial-arrival',
    desc: 'Shipped 100, arrived 40',
    setup: async (c) => {
      await c.query("INSERT INTO commercial_invoices (ci_no, country, target_warehouse, ci_status, brand) VALUES ('CI-001', 'US', 'WH-A', 'confirmed', 'B1')");
      const ci = await c.query("SELECT id FROM commercial_invoices WHERE ci_no = 'CI-001'");
      const ciId = ci.rows[0].id;
      await c.query("INSERT INTO commercial_invoice_items (ci_id, sku_code, shipped_qty) VALUES ($1, 'SKU-001', 100)", [ciId]);
      await c.query("INSERT INTO logistics_batches (batch_no, related_ci_id, logistics_status) VALUES ('LB-001', $1, 'completed')", [ciId]);
      const lb = await c.query("SELECT id FROM logistics_batches WHERE batch_no = 'LB-001'");
      await c.query("INSERT INTO packing_lists (pl_no, logistics_batch_id) VALUES ('PL-001', $1)", [lb.rows[0].id]);
      const pl = await c.query("SELECT id FROM packing_lists WHERE pl_no = 'PL-001'");
      await c.query("INSERT INTO packing_list_items (pl_id, sku_code, total_qty) VALUES ($1, 'SKU-001', 40)", [pl.rows[0].id]);
      await c.query("INSERT INTO inventory (sku_code, country, warehouse, available_qty) VALUES ('SKU-001', 'US', 'WH-A', 50)");
    }
  },
  {
    name: 'fully-arrived',
    desc: 'Shipped = arrived → transit = 0',
    setup: async (c) => {
      await c.query("INSERT INTO commercial_invoices (ci_no, country, target_warehouse, ci_status, brand) VALUES ('CI-001', 'US', 'WH-A', 'confirmed', 'B1')");
      const ci = await c.query("SELECT id FROM commercial_invoices WHERE ci_no = 'CI-001'");
      const ciId = ci.rows[0].id;
      await c.query("INSERT INTO commercial_invoice_items (ci_id, sku_code, shipped_qty) VALUES ($1, 'SKU-001', 100)", [ciId]);
      await c.query("INSERT INTO logistics_batches (batch_no, related_ci_id, logistics_status) VALUES ('LB-001', $1, 'completed')", [ciId]);
      const lb = await c.query("SELECT id FROM logistics_batches WHERE batch_no = 'LB-001'");
      await c.query("INSERT INTO packing_lists (pl_no, logistics_batch_id) VALUES ('PL-001', $1)", [lb.rows[0].id]);
      const pl = await c.query("SELECT id FROM packing_lists WHERE pl_no = 'PL-001'");
      await c.query("INSERT INTO packing_list_items (pl_id, sku_code, total_qty) VALUES ($1, 'SKU-001', 100)", [pl.rows[0].id]);
      await c.query("INSERT INTO inventory (sku_code, country, warehouse, available_qty) VALUES ('SKU-001', 'US', 'WH-A', 50)");
    }
  },
  {
    name: 'multi-ci-same-sku',
    desc: 'Multiple CI same SKU aggregates correctly',
    setup: async (c) => {
      await c.query("INSERT INTO commercial_invoices (ci_no, country, target_warehouse, ci_status, brand) VALUES ('CI-001', 'US', 'WH-A', 'confirmed', 'B1')");
      await c.query("INSERT INTO commercial_invoices (ci_no, country, target_warehouse, ci_status, brand) VALUES ('CI-002', 'US', 'WH-A', 'confirmed', 'B1')");
      const ci1 = await c.query("SELECT id FROM commercial_invoices WHERE ci_no = 'CI-001'");
      const ci2 = await c.query("SELECT id FROM commercial_invoices WHERE ci_no = 'CI-002'");
      await c.query("INSERT INTO commercial_invoice_items (ci_id, sku_code, shipped_qty) VALUES ($1, 'SKU-001', 100)", [ci1.rows[0].id]);
      await c.query("INSERT INTO commercial_invoice_items (ci_id, sku_code, shipped_qty) VALUES ($1, 'SKU-001', 50)", [ci2.rows[0].id]);
      await c.query("INSERT INTO inventory (sku_code, country, warehouse, available_qty) VALUES ('SKU-001', 'US', 'WH-A', 50)");
    }
  },
  {
    name: 'pi-confirmed-unshipped',
    desc: 'PI confirmed, partially shipped',
    setup: async (c) => {
      await c.query("INSERT INTO purchase_orders (po_no, country, target_warehouse, po_status) VALUES ('PO-001', 'US', 'WH-A', 'active')");
      const po = await c.query("SELECT id FROM purchase_orders WHERE po_no = 'PO-001'");
      const poId = po.rows[0].id;
      await c.query("INSERT INTO purchase_order_items (po_id, sku_code, po_qty, transferred_pi_qty) VALUES ($1, 'SKU-001', 200, 150)", [poId]);
      await c.query("INSERT INTO proforma_invoices (pi_no, pi_status, related_po_id, country, target_warehouse) VALUES ('PI-001', 'confirmed', $1, '', '')", [poId]);
      const pi = await c.query("SELECT id FROM proforma_invoices WHERE pi_no = 'PI-001'");
      await c.query("INSERT INTO proforma_invoice_items (pi_id, sku_code, pi_confirmed_qty, shipped_qty) VALUES ($1, 'SKU-001', 150, 30)", [pi.rows[0].id]);
      await c.query("INSERT INTO inventory (sku_code, country, warehouse, available_qty) VALUES ('SKU-001', 'US', 'WH-A', 50)");
    }
  },
  {
    name: 'pi-country-fallback',
    desc: 'PI empty country falls back to PO',
    setup: async (c) => {
      await c.query("INSERT INTO purchase_orders (po_no, country, target_warehouse, po_status) VALUES ('PO-001', 'DE', 'WH-B', 'active')");
      const po = await c.query("SELECT id FROM purchase_orders WHERE po_no = 'PO-001'");
      const poId = po.rows[0].id;
      await c.query("INSERT INTO purchase_order_items (po_id, sku_code, po_qty, transferred_pi_qty) VALUES ($1, 'SKU-002', 50, 50)", [poId]);
      await c.query("INSERT INTO proforma_invoices (pi_no, pi_status, related_po_id, country, target_warehouse) VALUES ('PI-001', 'confirmed', $1, '', '')", [poId]);
      const pi = await c.query("SELECT id FROM proforma_invoices WHERE pi_no = 'PI-001'");
      await c.query("INSERT INTO proforma_invoice_items (pi_id, sku_code, pi_confirmed_qty, shipped_qty) VALUES ($1, 'SKU-002', 50, 0)", [pi.rows[0].id]);
      await c.query("INSERT INTO inventory (sku_code, country, warehouse, available_qty) VALUES ('SKU-002', 'DE', 'WH-B', 10)");
    }
  },
  {
    name: 'pi-warehouse-fallback',
    desc: 'PI empty warehouse falls back to PO',
    setup: async (c) => {
      await c.query("INSERT INTO purchase_orders (po_no, country, target_warehouse, po_status) VALUES ('PO-001', 'JP', 'WH-C', 'active')");
      const po = await c.query("SELECT id FROM purchase_orders WHERE po_no = 'PO-001'");
      const poId = po.rows[0].id;
      await c.query("INSERT INTO purchase_order_items (po_id, sku_code, po_qty, transferred_pi_qty) VALUES ($1, 'SKU-003', 80, 60)", [poId]);
      await c.query("INSERT INTO proforma_invoices (pi_no, pi_status, related_po_id, country, target_warehouse) VALUES ('PI-001', 'confirmed', $1, 'JP', '')", [poId]);
      const pi = await c.query("SELECT id FROM proforma_invoices WHERE pi_no = 'PI-001'");
      await c.query("INSERT INTO proforma_invoice_items (pi_id, sku_code, pi_confirmed_qty, shipped_qty) VALUES ($1, 'SKU-003', 60, 20)", [pi.rows[0].id]);
      await c.query("INSERT INTO inventory (sku_code, country, warehouse, available_qty) VALUES ('SKU-003', 'JP', 'WH-C', 10)");
    }
  },
  {
    name: 'po-partly-transferred',
    desc: 'PO partly transferred to PI',
    setup: async (c) => {
      await c.query("INSERT INTO purchase_orders (po_no, country, target_warehouse, po_status) VALUES ('PO-001', 'SG', 'WH-SG', 'active')");
      const po = await c.query("SELECT id FROM purchase_orders WHERE po_no = 'PO-001'");
      const poId = po.rows[0].id;
      await c.query("INSERT INTO purchase_order_items (po_id, sku_code, po_qty, transferred_pi_qty) VALUES ($1, 'SKU-004', 500, 200)", [poId]);
      await c.query("INSERT INTO inventory (sku_code, country, warehouse, available_qty) VALUES ('SKU-004', 'SG', 'WH-SG', 10)");
    }
  },
  {
    name: 'cancelled-po',
    desc: 'Cancelled PO excluded from transit and po_unconfirmed',
    setup: async (c) => {
      await c.query("INSERT INTO purchase_orders (po_no, country, target_warehouse, po_status) VALUES ('PO-001', 'US', 'WH-A', 'cancelled')");
      const po = await c.query("SELECT id FROM purchase_orders WHERE po_no = 'PO-001'");
      await c.query("INSERT INTO purchase_order_items (po_id, sku_code, po_qty, transferred_pi_qty) VALUES ($1, 'SKU-005', 100, 0)", [po.rows[0].id]);
      await c.query("INSERT INTO inventory (sku_code, country, warehouse, available_qty) VALUES ('SKU-005', 'US', 'WH-A', 0)");
    }
  },
  {
    name: 'cancelled-ci',
    desc: 'Cancelled CI excluded from transit',
    setup: async (c) => {
      await c.query("INSERT INTO commercial_invoices (ci_no, country, target_warehouse, ci_status, brand) VALUES ('CI-001', 'US', 'WH-A', 'cancelled', 'B1')");
      const ci = await c.query("SELECT id FROM commercial_invoices WHERE ci_no = 'CI-001'");
      await c.query("INSERT INTO commercial_invoice_items (ci_id, sku_code, shipped_qty) VALUES ($1, 'SKU-006', 100)", [ci.rows[0].id]);
      await c.query("INSERT INTO inventory (sku_code, country, warehouse, available_qty) VALUES ('SKU-006', 'US', 'WH-A', 0)");
    }
  },
  {
    name: 'reversed-ci',
    desc: 'reversed CI — OLD algorithm determines expected',
    setup: async (c) => {
      await c.query("INSERT INTO commercial_invoices (ci_no, country, target_warehouse, ci_status, brand) VALUES ('CI-001', 'US', 'WH-A', 'reversed', 'B1')");
      const ci = await c.query("SELECT id FROM commercial_invoices WHERE ci_no = 'CI-001'");
      await c.query("INSERT INTO commercial_invoice_items (ci_id, sku_code, shipped_qty) VALUES ($1, 'SKU-007', 100)", [ci.rows[0].id]);
      await c.query("INSERT INTO inventory (sku_code, country, warehouse, available_qty) VALUES ('SKU-007', 'US', 'WH-A', 0)");
    }
  },
  {
    name: 'multi-country',
    desc: 'Same SKU across multiple countries',
    setup: async (c) => {
      await c.query("INSERT INTO commercial_invoices (ci_no, country, target_warehouse, ci_status, brand) VALUES ('CI-US', 'US', 'WH-A', 'confirmed', 'B1')");
      await c.query("INSERT INTO commercial_invoices (ci_no, country, target_warehouse, ci_status, brand) VALUES ('CI-UK', 'UK', 'WH-B', 'confirmed', 'B1')");
      const ciUs = await c.query("SELECT id FROM commercial_invoices WHERE ci_no = 'CI-US'");
      const ciUk = await c.query("SELECT id FROM commercial_invoices WHERE ci_no = 'CI-UK'");
      await c.query("INSERT INTO commercial_invoice_items (ci_id, sku_code, shipped_qty) VALUES ($1, 'SKU-MC', 100)", [ciUs.rows[0].id]);
      await c.query("INSERT INTO commercial_invoice_items (ci_id, sku_code, shipped_qty) VALUES ($1, 'SKU-MC', 200)", [ciUk.rows[0].id]);
      await c.query("INSERT INTO inventory (sku_code, country, warehouse, available_qty) VALUES ('SKU-MC', 'US', 'WH-A', 10)");
      await c.query("INSERT INTO inventory (sku_code, country, warehouse, available_qty) VALUES ('SKU-MC', 'UK', 'WH-B', 20)");
    }
  },
  {
    name: 'multi-warehouse',
    desc: 'Same SKU same country different warehouses',
    setup: async (c) => {
      await c.query("INSERT INTO commercial_invoices (ci_no, country, target_warehouse, ci_status, brand) VALUES ('CI-1', 'US', 'WH-A', 'confirmed', 'B1')");
      await c.query("INSERT INTO commercial_invoices (ci_no, country, target_warehouse, ci_status, brand) VALUES ('CI-2', 'US', 'WH-B', 'confirmed', 'B1')");
      const ci1 = await c.query("SELECT id FROM commercial_invoices WHERE ci_no = 'CI-1'");
      const ci2 = await c.query("SELECT id FROM commercial_invoices WHERE ci_no = 'CI-2'");
      await c.query("INSERT INTO commercial_invoice_items (ci_id, sku_code, shipped_qty) VALUES ($1, 'SKU-MW', 50)", [ci1.rows[0].id]);
      await c.query("INSERT INTO commercial_invoice_items (ci_id, sku_code, shipped_qty) VALUES ($1, 'SKU-MW', 75)", [ci2.rows[0].id]);
      await c.query("INSERT INTO inventory (sku_code, country, warehouse, available_qty) VALUES ('SKU-MW', 'US', 'WH-A', 5)");
      await c.query("INSERT INTO inventory (sku_code, country, warehouse, available_qty) VALUES ('SKU-MW', 'US', 'WH-B', 5)");
    }
  },
  {
    name: 'empty-aggregation',
    desc: 'No PO/PI/CI data — all fields stay 0',
    setup: async (c) => {
      await c.query("INSERT INTO inventory (sku_code, country, warehouse, available_qty) VALUES ('SKU-EMPTY', 'US', 'WH-A', 100)");
    }
  },
  {
    name: 'no-inventory-row',
    desc: 'Aggregation has rows but no inventory row exists',
    setup: async (c) => {
      await c.query("INSERT INTO commercial_invoices (ci_no, country, target_warehouse, ci_status, brand) VALUES ('CI-001', 'US', 'WH-A', 'confirmed', 'B1')");
      const ci = await c.query("SELECT id FROM commercial_invoices WHERE ci_no = 'CI-001'");
      await c.query("INSERT INTO commercial_invoice_items (ci_id, sku_code, shipped_qty) VALUES ($1, 'SKU-NOINV', 100)", [ci.rows[0].id]);
      // No inventory row for SKU-NOINV
    }
  },
  {
    name: 'all-three-fields',
    desc: 'in_transit + pi_unshipped + po_unconfirmed all populated',
    setup: async (c) => {
      // CI transit
      await c.query("INSERT INTO commercial_invoices (ci_no, country, target_warehouse, ci_status, brand) VALUES ('CI-001', 'SG', 'WH-SG', 'confirmed', 'B1')");
      const ci = await c.query("SELECT id FROM commercial_invoices WHERE ci_no = 'CI-001'");
      await c.query("INSERT INTO commercial_invoice_items (ci_id, sku_code, shipped_qty) VALUES ($1, 'SKU-ALL', 50)", [ci.rows[0].id]);
      // PO + PI
      await c.query("INSERT INTO purchase_orders (po_no, country, target_warehouse, po_status) VALUES ('PO-001', 'SG', 'WH-SG', 'active')");
      const po = await c.query("SELECT id FROM purchase_orders WHERE po_no = 'PO-001'");
      const poId = po.rows[0].id;
      await c.query("INSERT INTO purchase_order_items (po_id, sku_code, po_qty, transferred_pi_qty) VALUES ($1, 'SKU-ALL', 500, 200)", [poId]);
      await c.query("INSERT INTO proforma_invoices (pi_no, pi_status, related_po_id, country, target_warehouse) VALUES ('PI-001', 'confirmed', $1, '', '')", [poId]);
      const pi = await c.query("SELECT id FROM proforma_invoices WHERE pi_no = 'PI-001'");
      await c.query("INSERT INTO proforma_invoice_items (pi_id, sku_code, pi_confirmed_qty, shipped_qty) VALUES ($1, 'SKU-ALL', 200, 80)", [pi.rows[0].id]);
      await c.query("INSERT INTO inventory (sku_code, country, warehouse, available_qty) VALUES ('SKU-ALL', 'SG', 'WH-SG', 10)");
    }
  }
];

// ============================================================
// Helpers
// ============================================================

async function cleanAll(client) {
  await client.query('DELETE FROM packing_list_items');
  await client.query('DELETE FROM packing_lists');
  await client.query('DELETE FROM logistics_batches');
  await client.query('DELETE FROM commercial_invoice_items');
  await client.query('DELETE FROM commercial_invoices');
  await client.query('DELETE FROM proforma_invoice_items');
  await client.query('DELETE FROM proforma_invoices');
  await client.query('DELETE FROM purchase_order_items');
  await client.query('DELETE FROM purchase_orders');
  await client.query('DELETE FROM inventory');
}

function readResults(client) {
  return client.query(`
    SELECT sku_code, country, warehouse,
           in_transit_qty, pi_confirmed_unshipped_qty, po_unconfirmed_pi_qty
    FROM inventory
    ORDER BY sku_code, country, warehouse
  `);
}

function compare(oldRows, newRows) {
  const mismatches = [];
  const maxLen = Math.max(oldRows.length, newRows.length);
  for (let i = 0; i < maxLen; i++) {
    const o = oldRows[i];
    const n = newRows[i];
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
    for (const f of ['in_transit_qty', 'pi_confirmed_unshipped_qty', 'po_unconfirmed_pi_qty']) {
      if (o[f] !== n[f]) {
        mismatches.push(`${key} ${f}: OLD=${o[f]} NEW=${n[f]}`);
      }
    }
  }
  return mismatches;
}

// ============================================================
// Main
// ============================================================

async function main() {
  if (!DB_URL) { console.log('DATABASE_URL not set'); process.exit(1); }
  if (!SCHEMA) { console.log('P0A_SCHEMA not set'); process.exit(1); }

  const pool = new Pool({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  const client = await pool.connect();

  try {
    await client.query(`SET search_path TO ${SCHEMA}`);
    console.log(`Schema: ${SCHEMA}`);
    console.log(`Fixtures: ${FIXTURES.length}\n`);

    let passed = 0;
    let failed = 0;
    const results = [];

    for (const fx of FIXTURES) {
      await cleanAll(client);
      await fx.setup(client);

      // Run OLD
      await client.query('BEGIN');
      await runOldLoop(client);
      const oldRes = (await readResults(client)).rows;
      await client.query('ROLLBACK');

      // Run NEW
      await client.query('BEGIN');
      await runNewSetBased(client);
      const newRes = (await readResults(client)).rows;
      await client.query('ROLLBACK');

      const mismatches = compare(oldRes, newRes);
      if (mismatches.length === 0) {
        console.log(`  ✅ PASS  ${fx.name.padEnd(28)} ${fx.desc}`);
        passed++;
      } else {
        console.log(`  ❌ FAIL  ${fx.name}`);
        for (const m of mismatches) console.log(`     ${m}`);
        failed++;
      }
      results.push({ name: fx.name, pass: mismatches.length === 0, mismatches, rows: oldRes.length });
    }

    console.log(`\n=== Summary ===`);
    console.log(`  Total: ${FIXTURES.length}`);
    console.log(`  Passed: ${passed}`);
    console.log(`  Failed: ${failed}`);

    if (failed > 0) {
      console.log('\nFAILED: parity mismatch detected');
      process.exit(1);
    }
    console.log('\nPASSED: OLD === NEW for all fixtures');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
