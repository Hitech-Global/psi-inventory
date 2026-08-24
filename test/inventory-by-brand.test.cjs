'use strict';

/**
 * 库存资产「国家 → 品牌」维度汇总 (computeInventoryByBrand) 测试
 *
 * 口径（复用 overview 已上线，不重写金额算法）：
 *   可用 = inventory WAC；寄售 = consignment remaining_inventory_value；
 *   在途 CI = getEffectiveTransitRows（arrived_qty 已剔除）；
 *   在途 PI = getPiTransitAssets（已付未发 = total − shipped_amount）。
 * 品牌归属统一：优先 skus.brand（按 sku_code），未命中 fallback 原单据 brand（CI=ci.brand / PI=pi.brand），仍空归「未分类」。
 *
 * 覆盖：
 *   1) 恒等式：Σ 品牌可用 = 国家可用、Σ 品牌在途 = 国家在途、Σ 品牌寄售 = 国家寄售、Σ 品牌 total = 国家 total
 *   2) 品牌统一：同一 SKU（SKU-A）在 可用/寄售/在途CI 三类均归到同一品牌 Redragon
 *   3) fallback：CI 中 sku 不在 skus → 用 ci.brand（Netac）
 *   4) PI 文档 brand（BOYA）单独成品牌；已全发货/未付款 PI 不进入
 *   5) 未分类：sku 不在 skus 且无 doc brand → 「未分类」，不被丢弃
 *   6) 默认排序：按品牌总资产从高到低（BOYA 第一）
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_DRIVER = 'sqlite';
process.env.DB_PATH = ':memory:';

const dbMod = require('../db');
const { query, run, getDB } = dbMod;
const { computeInventoryByBrand, getPiTransitAssets } = require('../server');

createSchema();

function createSchema() {
  const d = getDB();
  // 重建用表，确保使用本测试定义的列集合（覆盖 server 初始化时建立的真实 schema，
  // 例如真实 consignment_inventory_lots 未含本测试所需的 status 列）。
  d.exec('PRAGMA foreign_keys=OFF;');
  d.exec(`
    DROP TABLE IF EXISTS historical_commercial_invoice_items;
    DROP TABLE IF EXISTS historical_commercial_invoices;
    DROP TABLE IF EXISTS packing_list_items;
    DROP TABLE IF EXISTS packing_lists;
    DROP TABLE IF EXISTS logistics_batches;
    DROP TABLE IF EXISTS commercial_invoice_items;
    DROP TABLE IF EXISTS commercial_invoices;
    DROP TABLE IF EXISTS proforma_invoice_items;
    DROP TABLE IF EXISTS proforma_invoices;
    DROP TABLE IF EXISTS consignment_inventory_lots;
    DROP TABLE IF EXISTS inventory;
    DROP TABLE IF EXISTS skus;
    DROP TABLE IF EXISTS countries;
  `);
  d.exec(`
    CREATE TABLE countries (name TEXT PRIMARY KEY, default_currency TEXT DEFAULT '', status TEXT DEFAULT 'active');
    CREATE TABLE skus (sku_code TEXT PRIMARY KEY, brand TEXT DEFAULT '');
    CREATE TABLE inventory (
      id TEXT PRIMARY KEY, sku_code TEXT DEFAULT '', country TEXT DEFAULT '',
      available_qty NUMERIC DEFAULT 0, weighted_avg_cost NUMERIC DEFAULT 0
    );
    CREATE TABLE consignment_inventory_lots (
      id TEXT PRIMARY KEY, sku_code TEXT DEFAULT '', country_name TEXT DEFAULT '',
      remaining_inventory_value NUMERIC DEFAULT 0, status TEXT DEFAULT 'active'
    );
    CREATE TABLE commercial_invoices (
      id TEXT PRIMARY KEY, ci_no TEXT NOT NULL, ci_status TEXT DEFAULT 'draft',
      currency TEXT DEFAULT '', country TEXT DEFAULT '', brand TEXT DEFAULT '', target_warehouse TEXT DEFAULT ''
    );
    CREATE TABLE commercial_invoice_items (
      id TEXT PRIMARY KEY, ci_id TEXT NOT NULL, pi_id TEXT DEFAULT '', sku_code TEXT DEFAULT '',
      shipped_qty NUMERIC DEFAULT 0, ci_amount NUMERIC DEFAULT 0
    );
    CREATE TABLE proforma_invoices (
      id TEXT PRIMARY KEY, pi_no TEXT NOT NULL, pi_status TEXT DEFAULT 'pending',
      country TEXT DEFAULT '', brand TEXT DEFAULT '', target_warehouse TEXT DEFAULT '',
      currency TEXT DEFAULT 'RMB', total_amount NUMERIC DEFAULT 0,
      paid_deposit NUMERIC DEFAULT 0, shipped_amount NUMERIC DEFAULT 0
    );
    CREATE TABLE proforma_invoice_items (
      id TEXT PRIMARY KEY, pi_id TEXT NOT NULL, sku_code TEXT DEFAULT '',
      unshipped_qty NUMERIC DEFAULT 0, unit_price NUMERIC DEFAULT 0, discount NUMERIC DEFAULT 0
    );
    CREATE TABLE logistics_batches (id TEXT PRIMARY KEY, related_ci_id TEXT DEFAULT '', logistics_status TEXT DEFAULT '');
    CREATE TABLE packing_lists (id TEXT PRIMARY KEY, logistics_batch_id TEXT DEFAULT '');
    CREATE TABLE packing_list_items (id TEXT PRIMARY KEY, pl_id TEXT DEFAULT '', sku_code TEXT DEFAULT '', total_qty NUMERIC DEFAULT 0);
    CREATE TABLE historical_commercial_invoices (id TEXT PRIMARY KEY);
    CREATE TABLE historical_commercial_invoice_items (id TEXT PRIMARY KEY, hci_id TEXT DEFAULT '', pi_id TEXT DEFAULT '', ci_amount NUMERIC DEFAULT 0);
  `);
  d.exec('PRAGMA foreign_keys=ON;');
}

function seed() {
  run("INSERT INTO countries (name, default_currency, status) VALUES ('Indonesia', 'USD', 'active')");
  // skus 主数据
  run("INSERT INTO skus (sku_code, brand) VALUES ('SKU-A', 'Redragon')");
  run("INSERT INTO skus (sku_code, brand) VALUES ('SKU-D', 'Joypeer')");
  // SKU-B / SKU-C 故意不在 skus 中

  // 可用库存（country=Indonesia）
  run("INSERT INTO inventory (id, sku_code, country, available_qty, weighted_avg_cost) VALUES ('INV1','SKU-A','Indonesia',10,100)");
  run("INSERT INTO inventory (id, sku_code, country, available_qty, weighted_avg_cost) VALUES ('INV2','SKU-C','Indonesia',5,200)");

  // 寄售（active, country=Indonesia）
  run("INSERT INTO consignment_inventory_lots (id, sku_code, country_name, remaining_inventory_value, status) VALUES ('CL1','SKU-A','Indonesia',500,'active')");
  run("INSERT INTO consignment_inventory_lots (id, sku_code, country_name, remaining_inventory_value, status) VALUES ('CL2','SKU-D','Indonesia',300,'active')");

  // CI（在途，USD，Indonesia；brand 仅作 fallback 来源）
  run("INSERT INTO commercial_invoices (id, ci_no, ci_status, currency, country, brand, target_warehouse) VALUES ('CI1','CI1','uploaded','USD','Indonesia','Netac','WH1')");
  run("INSERT INTO commercial_invoice_items (id, ci_id, sku_code, shipped_qty, ci_amount) VALUES ('CII1','CI1','SKU-A',10,2800)");   // sku 在 skus → Redragon
  run("INSERT INTO commercial_invoice_items (id, ci_id, sku_code, shipped_qty, ci_amount) VALUES ('CII2','CI1','SKU-B',5,1000)");  // 不在 skus → fallback ci.brand=Netac

  // PI 采购在途
  run("INSERT INTO proforma_invoices (id, pi_no, pi_status, country, brand, currency, total_amount, paid_deposit, shipped_amount) VALUES ('PI1','PI1','pending','Indonesia','BOYA','USD',14000,1000,0)");      // 未发货 → 全在途
  run("INSERT INTO proforma_invoices (id, pi_no, pi_status, country, brand, currency, total_amount, paid_deposit, shipped_amount) VALUES ('PI2','PI2','pending','Indonesia','Redragon','USD',20000,2000,20000)"); // 已全发货 → 排除
  run("INSERT INTO proforma_invoices (id, pi_no, pi_status, country, brand, currency, total_amount, paid_deposit, shipped_amount) VALUES ('PI3','PI3','pending','Indonesia','Redragon','USD',5000,0,0)");          // 未付款 → 排除
}

function sumBy(brands, key) { return Math.round(brands.reduce((s, b) => s + b[key], 0) * 100) / 100; }

function resetAll() {
  getDB().exec('DELETE FROM countries; DELETE FROM skus; DELETE FROM inventory; DELETE FROM consignment_inventory_lots; DELETE FROM commercial_invoices; DELETE FROM commercial_invoice_items; DELETE FROM proforma_invoices; DELETE FROM proforma_invoice_items; DELETE FROM logistics_batches; DELETE FROM packing_lists; DELETE FROM packing_list_items; DELETE FROM historical_commercial_invoices; DELETE FROM historical_commercial_invoice_items;');
}
const RESET_SQL = 'DELETE FROM countries; DELETE FROM skus; DELETE FROM inventory; DELETE FROM consignment_inventory_lots; DELETE FROM commercial_invoices; DELETE FROM commercial_invoice_items; DELETE FROM proforma_invoices; DELETE FROM proforma_invoice_items; DELETE FROM logistics_batches; DELETE FROM packing_lists; DELETE FROM packing_list_items; DELETE FROM historical_commercial_invoices; DELETE FROM historical_commercial_invoice_items;';
const EPS = 1e-6;


test('computeInventoryByBrand: Indonesia 恒等式 + 品牌统一 + 未分类', async () => {
  // 清空并重建（隔离其它用例）
  getDB().exec('DELETE FROM countries; DELETE FROM skus; DELETE FROM inventory; DELETE FROM consignment_inventory_lots; DELETE FROM commercial_invoices; DELETE FROM commercial_invoice_items; DELETE FROM proforma_invoices; DELETE FROM proforma_invoice_items; DELETE FROM logistics_batches; DELETE FROM packing_lists; DELETE FROM packing_list_items; DELETE FROM historical_commercial_invoices; DELETE FROM historical_commercial_invoice_items;');
  seed();

  const foreignToRmbMap = { RMB: 1, CNY: 1, USD: 7 };
  const r = await computeInventoryByBrand('Indonesia', foreignToRmbMap);
  const rRaw = await computeInventoryByBrand('Indonesia', foreignToRmbMap, { raw: true }); // 原始金额（round 之前）

  // 国家层四项（USD=7）
  const EXPECT_A = 14000;   // 可用: SKU-A 7000 + SKU-C 7000
  const EXPECT_C = 5600;    // 寄售: SKU-A 3500 + SKU-D 2100
  const EXPECT_T = 124600;  // 在途: CI 26600 + PI 98000
  const EXPECT_TOTAL = EXPECT_A + EXPECT_C + EXPECT_T; // 144200

  assert.equal(r.country_code, 'ID');
  assert.equal(r.country, '印度尼西亚');
  assert.equal(r.available_asset, EXPECT_A);
  assert.equal(r.consignment_asset, EXPECT_C);
  assert.equal(r.transit_asset, EXPECT_T);
  assert.equal(r.country_total, EXPECT_TOTAL);

  // 品牌集合
  const byBrand = {};
  for (const b of r.brands) byBrand[b.brand] = b;
  const brandNames = Object.keys(byBrand).sort();
  assert.deepEqual(brandNames, ['BOYA', 'Joypeer', 'Netac', 'Redragon', '未分类'].sort());

  // 恒等式（round 后值）：Σ 品牌 = 国家
  assert.equal(sumBy(r.brands, 'available_asset'), EXPECT_A);
  assert.equal(sumBy(r.brands, 'transit_asset'), EXPECT_T);
  assert.equal(sumBy(r.brands, 'consignment_asset'), EXPECT_C);
  assert.equal(sumBy(r.brands, 'total_asset'), EXPECT_TOTAL);

  // 恒等式（原始金额，round 之前）：Σ 品牌原始金额 ≈ 国家原始金额（允许浮点误差 <= 1e-6）
  const EPS = 1e-6;
  const sumRaw = (key) => rRaw.raw.brands.reduce((s, b) => s + (b[key] || 0), 0);
  assert.ok(Math.abs(sumRaw('available_asset') - rRaw.raw.available_asset) <= EPS, 'raw available identity');
  assert.ok(Math.abs(sumRaw('transit_asset') - rRaw.raw.transit_asset) <= EPS, 'raw transit identity');
  assert.ok(Math.abs(sumRaw('consignment_asset') - rRaw.raw.consignment_asset) <= EPS, 'raw consignment identity');
  assert.ok(Math.abs(sumRaw('total_asset') - rRaw.raw.country_total) <= EPS, 'raw total identity');

  // 品牌统一：SKU-A 在 可用/寄售/在途CI 均归 Redragon
  assert.equal(byBrand['Redragon'].available_asset, 7000);
  assert.equal(byBrand['Redragon'].consignment_asset, 3500);
  assert.equal(byBrand['Redragon'].transit_asset, 19600); // CI 中 SKU-A 部分
  assert.equal(byBrand['Redragon'].total_asset, 30100);

  // fallback：CI 中 SKU-B 不在 skus → ci.brand=Netac
  assert.equal(byBrand['Netac'].transit_asset, 7000);
  assert.equal(byBrand['Netac'].available_asset, 0);
  assert.equal(byBrand['Netac'].consignment_asset, 0);

  // PI 文档 brand（BOYA）单独成品牌；已全发货/未付款 PI 不进入
  assert.equal(byBrand['BOYA'].transit_asset, 98000);
  assert.equal(byBrand['BOYA'].total_asset, 98000);
  assert.ok(!('Redragon' in byBrand) || byBrand['Redragon'].transit_asset === 19600, 'PI2/PI3 不应为 Redragon 贡献在途');
  // 确认 PI2/PI3 被排除：Redragon 在途只来自 CI，无 PI 部分
  assert.equal(byBrand['Redragon'].transit_asset, 19600);

  // 寄售品牌 Joypeer
  assert.equal(byBrand['Joypeer'].consignment_asset, 2100);
  assert.equal(byBrand['Joypeer'].total_asset, 2100);

  // 未分类：SKU-C（不在 skus，无 doc brand）归入「未分类」，不被丢弃
  assert.equal(byBrand['未分类'].available_asset, 7000);
  assert.equal(byBrand['未分类'].total_asset, 7000);
  assert.equal(r.unclassified_count, 1);
  assert.equal(r.unclassified_asset, 7000);

  // 默认排序：按品牌总资产从高到低 → BOYA 第一
  assert.equal(r.brands[0].brand, 'BOYA');
});

test('computeInventoryByBrand: 缺失汇率行被跳过（与 overview 一致，禁止 fallback=1）', async () => {
  getDB().exec('DELETE FROM countries; DELETE FROM skus; DELETE FROM inventory; DELETE FROM consignment_inventory_lots; DELETE FROM commercial_invoices; DELETE FROM commercial_invoice_items; DELETE FROM proforma_invoices; DELETE FROM proforma_invoice_items; DELETE FROM logistics_batches; DELETE FROM packing_lists; DELETE FROM packing_list_items; DELETE FROM historical_commercial_invoices; DELETE FROM historical_commercial_invoice_items;');
  run("INSERT INTO countries (name, default_currency, status) VALUES ('Indonesia', 'XYZ', 'active')"); // 无汇率
  run("INSERT INTO skus (sku_code, brand) VALUES ('SKU-A', 'Redragon')");
  run("INSERT INTO inventory (id, sku_code, country, available_qty, weighted_avg_cost) VALUES ('INV1','SKU-A','Indonesia',10,100)");

  const foreignToRmbMap = { RMB: 1, CNY: 1, USD: 7 }; // 不含 XYZ
  const r = await computeInventoryByBrand('Indonesia', foreignToRmbMap);
  // XYZ 无汇率 → 行被跳过 → 国家可用 = 0，且不应 fallback=1
  assert.equal(r.available_asset, 0);
  assert.equal(r.country_total, 0);
});

// ===== PI 在途品牌归属（方案 A：无损拆；不使用对账因子 / 比例分摊） =====
// 口径：transitOrig = total_amount − shipped_amount（唯一权威，本组测试不改动）
//   Case A: |Σ item未发货 − transitOrig| <= 1e-6 → 按 SKU 拆；品牌 = skus.brand → pi.brand → 未分类
//   Case B1: 漂移但所有未发货 SKU 唯一主品牌 → 整单归该主品牌（非 SKU 间分摊）
//   Case B2: 漂移且多品牌/无法唯一 → 整单回退 pi.brand → 未分类

test('PI 品牌归属 Case A：金额一致 + pi.brand 名称错误 → 归入 skus.brand', async () => {
  resetAll();
  const map = { RMB: 1, CNY: 1, USD: 7 };
  run("INSERT INTO countries (name, default_currency, status) VALUES ('Indonesia','USD','active')");
  run("INSERT INTO skus (sku_code, brand) VALUES ('SKU-R','Redragon')");
  run("INSERT INTO proforma_invoices (id, pi_no, pi_status, country, brand, currency, total_amount, paid_deposit, shipped_amount) VALUES ('PI1','PI1','pending','Indonesia','Red Dragon','USD',1400,100,0)");
  run("INSERT INTO proforma_invoice_items (id, pi_id, sku_code, unshipped_qty, unit_price, discount) VALUES ('I1','PI1','SKU-R',10,140,0)"); // Σ=1400 == transitOrig

  const pi = getPiTransitAssets(map, '', [], { includeSkuDetails: true });
  const sumRaw = pi.detailsBySku.reduce((s, d) => s + d.amount_raw, 0);
  assert.ok(Math.abs(sumRaw - pi.byCountryCny['ID']) <= EPS, 'Σ SKU == byCountryCny');
  assert.ok(Math.abs(sumRaw - pi.totalCny) <= EPS, 'Σ SKU == totalCny');
  assert.equal(pi.detailsBySku.length, 1);
  assert.equal(pi.detailsBySku[0].reconciliation_status, 'exact');
  assert.equal(pi.detailsBySku[0].document_brand, 'Red Dragon');
  assert.equal(pi.detailsBySku[0].resolved_brand, 'Redragon'); // 主数据优先

  const r = await computeInventoryByBrand('Indonesia', map);
  const byBrand = {}; for (const b of r.brands) byBrand[b.brand] = b;
  assert.ok(!('Red Dragon' in byBrand), '不应出现 Red Dragon 品牌行');
  assert.equal(byBrand['Redragon'].transit_asset, 9800); // 1400 * 7
  const rRaw = await computeInventoryByBrand('Indonesia', map, { raw: true });
  const redRaw = rRaw.raw.brands.find(b => b.brand === 'Redragon');
  assert.ok(Math.abs(redRaw.transit_asset - 9800) <= EPS, 'PI 在途 9800 全部进入 Redragon（原始金额）');
});

test('PI 品牌归属 Case B1：金额漂移 + 唯一主数据品牌 → 整单归该主品牌（不按比例）', async () => {
  resetAll();
  const map = { RMB: 1, CNY: 1, USD: 7 };
  run("INSERT INTO countries (name, default_currency, status) VALUES ('Indonesia','USD','active')");
  run("INSERT INTO skus (sku_code, brand) VALUES ('SKU-R1','Redragon'), ('SKU-R2','Redragon')");
  run("INSERT INTO proforma_invoices (id, pi_no, pi_status, country, brand, currency, total_amount, paid_deposit, shipped_amount) VALUES ('PI1','PI1','pending','Indonesia','Red Dragon','USD',1400,100,0)");
  // Σ item未发货 = 500+500 = 1000 != transitOrig 1400 → 漂移
  run("INSERT INTO proforma_invoice_items (id, pi_id, sku_code, unshipped_qty, unit_price, discount) VALUES ('I1','PI1','SKU-R1',5,100,0), ('I2','PI1','SKU-R2',5,100,0)");

  const pi = getPiTransitAssets(map, '', [], { includeSkuDetails: true });
  assert.equal(pi.detailsBySku.length, 1); // 整单一条，未拆 SKU
  const e = pi.detailsBySku[0];
  assert.equal(e.reconciliation_status, 'fallback_single_master_brand');
  assert.equal(e.resolved_brand, 'Redragon');
  assert.equal(e.sku_code, ''); // 整单，非单 SKU
  assert.ok(Math.abs(e.amount_raw - 9800) <= EPS, '整单金额=原 PI transit（未变动）');
  assert.ok(Math.abs(pi.totalCny - 9800) <= EPS, 'PI 总额完全不变');

  const r = await computeInventoryByBrand('Indonesia', map);
  const byBrand = {}; for (const b of r.brands) byBrand[b.brand] = b;
  assert.ok(!('Red Dragon' in byBrand), '不应出现 Red Dragon 品牌行');
  assert.equal(byBrand['Redragon'].transit_asset, 9800);
});

test('PI 品牌归属 Case B2：金额漂移 + 多品牌 → 回退 pi.brand / 未分类（禁止比例分摊）', async () => {
  resetAll();
  const map = { RMB: 1, CNY: 1, USD: 7 };
  run("INSERT INTO countries (name, default_currency, status) VALUES ('Indonesia','USD','active')");
  run("INSERT INTO skus (sku_code, brand) VALUES ('SKU-A','Redragon'), ('SKU-B','Netac')");
  // PI1: pi.brand='Red Dragon'，多品牌 → 回退 pi.brand
  run("INSERT INTO proforma_invoices (id, pi_no, pi_status, country, brand, currency, total_amount, paid_deposit, shipped_amount) VALUES ('PI1','PI1','pending','Indonesia','Red Dragon','USD',1400,100,0)");
  run("INSERT INTO proforma_invoice_items (id, pi_id, sku_code, unshipped_qty, unit_price, discount) VALUES ('I1','PI1','SKU-A',10,100,0), ('I2','PI1','SKU-B',10,100,0)"); // Σ=2000 != 1400 漂移
  // PI2: pi.brand 为空，多品牌 → 回退 未分类
  run("INSERT INTO proforma_invoices (id, pi_no, pi_status, country, brand, currency, total_amount, paid_deposit, shipped_amount) VALUES ('PI2','PI2','pending','Indonesia','', 'USD',1400,100,0)");
  run("INSERT INTO proforma_invoice_items (id, pi_id, sku_code, unshipped_qty, unit_price, discount) VALUES ('J1','PI2','SKU-A',10,100,0), ('J2','PI2','SKU-B',10,100,0)");

  const pi = getPiTransitAssets(map, '', [], { includeSkuDetails: true });
  const e1 = pi.detailsBySku.find(d => d.pi_no === 'PI1');
  const e2 = pi.detailsBySku.find(d => d.pi_no === 'PI2');
  assert.equal(e1.reconciliation_status, 'fallback_document_brand');
  assert.equal(e1.resolved_brand, 'Red Dragon');
  assert.ok(Math.abs(e1.amount_raw - 9800) <= EPS);
  assert.equal(e2.reconciliation_status, 'fallback_document_brand');
  assert.equal(e2.resolved_brand, '未分类');
  assert.ok(Math.abs(e2.amount_raw - 9800) <= EPS);
  assert.ok(Math.abs(pi.totalCny - 19600) <= EPS, '两张 PI 总额 19600 完全不变');

  const r = await computeInventoryByBrand('Indonesia', map);
  const byBrand = {}; for (const b of r.brands) byBrand[b.brand] = b;
  assert.ok(!('Redragon' in byBrand) || byBrand['Redragon'].transit_asset === 0, '不可拆成 Redragon');
  assert.ok(!('Netac' in byBrand) || byBrand['Netac'].transit_asset === 0, '不可拆成 Netac');
  assert.equal(byBrand['Red Dragon'].transit_asset, 9800);
  assert.equal(byBrand['未分类'].transit_asset, 9800);
  assert.ok(Math.abs(r.transit_asset - 19600) <= EPS);
});

test('PI 品牌归属 Case A + 多品牌：按真实 item 未发货金额分别归入各主品牌，且 Σ = 原 PI transit', async () => {
  resetAll();
  const map = { RMB: 1, CNY: 1, USD: 7 };
  run("INSERT INTO countries (name, default_currency, status) VALUES ('Indonesia','USD','active')");
  run("INSERT INTO skus (sku_code, brand) VALUES ('SKU-A','Redragon'), ('SKU-B','Netac')");
  run("INSERT INTO proforma_invoices (id, pi_no, pi_status, country, brand, currency, total_amount, paid_deposit, shipped_amount) VALUES ('PI1','PI1','pending','Indonesia','MixedDoc','USD',1400,100,0)");
  // Σ item未发货 = 700+700 = 1400 == transitOrig → 无损拆
  run("INSERT INTO proforma_invoice_items (id, pi_id, sku_code, unshipped_qty, unit_price, discount) VALUES ('I1','PI1','SKU-A',10,70,0), ('I2','PI1','SKU-B',10,70,0)");

  const pi = getPiTransitAssets(map, '', [], { includeSkuDetails: true });
  assert.equal(pi.detailsBySku.length, 2);
  const a = pi.detailsBySku.find(d => d.sku_code === 'SKU-A');
  const b = pi.detailsBySku.find(d => d.sku_code === 'SKU-B');
  assert.equal(a.reconciliation_status, 'exact');
  assert.equal(a.resolved_brand, 'Redragon');
  assert.equal(b.resolved_brand, 'Netac');
  assert.ok(Math.abs(a.amount_raw - 4900) <= EPS); // 700 * 7
  assert.ok(Math.abs(b.amount_raw - 4900) <= EPS);
  assert.ok(Math.abs((a.amount_raw + b.amount_raw) - 9800) <= EPS, 'Σ SKU == 原 PI transit（原始金额）');

  const r = await computeInventoryByBrand('Indonesia', map);
  const byBrand = {}; for (const x of r.brands) byBrand[x.brand] = x;
  assert.equal(byBrand['Redragon'].transit_asset, 4900);
  assert.equal(byBrand['Netac'].transit_asset, 4900);
});
