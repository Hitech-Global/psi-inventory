'use strict';

/**
 * 有效在途资产口径 regression test
 *
 * 验证 getEffectiveTransitRows（batch / item-level 统一口径）：
 *   在途量 = CI 已发货数量 − 已完成到仓(completed)物流批次对应 PL 的 SKU 数量
 *   —— 按 (ci_id, sku_code) 聚合；只剔除已到仓 batch 承载的那部分货，保留仍在途 batch 的部分。
 *   —— 事实判断用 logistics_status = 'completed'（系统枚举），不使用 display status。
 *   —— 不读取 inbound_qty（inbound 不参与在途扣减）。
 *   —— ci_status 过滤为 NOT IN ('cancelled')，包含 completed CI（completed CI 仍可能有未到仓 batch）。
 *
 * 覆盖 5 个场景（见用户验收清单）：
 *   Case 1 同 CI 两 batch（A 已到仓 / B 在途）→ transit=60
 *   Case 2 同 SKU 多 CI item → SKU 聚合 + 加权单位值
 *   Case 3 CI status=completed 但存在未到仓 batch → 仍算剩余 transit
 *   Case 4 CI status=cancelled → 不计算
 *   Case 5 inbound_qty 不重复扣减 → 仍按 arrived 扣减
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_DRIVER = 'sqlite';
process.env.DB_PATH = ':memory:';

const dbMod = require('../db');
const { query, run, getDB } = dbMod;
const { getEffectiveTransitRows } = require('../server');

createSchema();


function createSchema() {
  const d = getDB();
  d.exec(`
    CREATE TABLE IF NOT EXISTS commercial_invoices (
      id TEXT PRIMARY KEY, ci_no TEXT NOT NULL, ci_status TEXT DEFAULT 'draft',
      currency TEXT DEFAULT 'USD', country TEXT DEFAULT '', target_warehouse TEXT DEFAULT '',
      brand TEXT DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS commercial_invoice_items (
      id TEXT PRIMARY KEY, ci_id TEXT NOT NULL, ci_no TEXT DEFAULT '', sku_code TEXT NOT NULL,
      shipped_qty INTEGER DEFAULT 0, inbound_qty INTEGER DEFAULT 0, ci_amount NUMERIC DEFAULT 0,
      unit_price NUMERIC DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS logistics_batches (
      id TEXT PRIMARY KEY, batch_no TEXT NOT NULL, related_ci_id TEXT DEFAULT '',
      related_ci_no TEXT DEFAULT '', logistics_status TEXT DEFAULT 'pending',
      target_country TEXT DEFAULT '', target_warehouse TEXT DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS packing_lists (
      id TEXT PRIMARY KEY, pl_no TEXT NOT NULL, related_ci_id TEXT DEFAULT '',
      related_ci_no TEXT DEFAULT '', logistics_batch_id TEXT DEFAULT '', total_qty INTEGER DEFAULT 0,
      status TEXT DEFAULT 'confirmed'
    );
    CREATE TABLE IF NOT EXISTS packing_list_items (
      id TEXT PRIMARY KEY, pl_id TEXT NOT NULL, pl_no TEXT DEFAULT '', ci_no TEXT DEFAULT '',
      sku_code TEXT NOT NULL, total_qty INTEGER DEFAULT 0
    );
  `);
}

function clearAll() {
  const d = getDB();
  d.exec(`
    DELETE FROM packing_list_items;
    DELETE FROM packing_lists;
    DELETE FROM logistics_batches;
    DELETE FROM commercial_invoice_items;
    DELETE FROM commercial_invoices;
  `);
}

let seq = 0;
function uniq(prefix) { seq += 1; return `${prefix}_${seq}`; }

function seedCI(id, ciNo, status, opts) {
  opts = opts || {};
  run(
    `INSERT INTO commercial_invoices (id, ci_no, ci_status, currency, country, target_warehouse, brand)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, ciNo, status, opts.currency || 'RMB', opts.country || '印度尼西亚', opts.wh || 'Bekasi', opts.brand || 'Netac']
  );
}

function seedCIIItem(ciId, ciNo, sku, shipped, ciAmount, unitPrice, inbound) {
  run(
    `INSERT INTO commercial_invoice_items (id, ci_id, ci_no, sku_code, shipped_qty, inbound_qty, ci_amount, unit_price)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [uniq('cii'), ciId, ciNo, sku, shipped, inbound || 0, ciAmount, unitPrice || 0]
  );
}

// 创建一个 logistics batch（含 PL + PL items），status 决定它是否计入 arrived
function seedBatch(ciId, ciNo, status, items) {
  const lbId = uniq('lb');
  const plId = uniq('pl');
  const batchNo = uniq('LOG');
  const plNo = uniq('PL');
  const total = items.reduce((s, it) => s + it.qty, 0);
  run(
    `INSERT INTO logistics_batches (id, batch_no, related_ci_id, related_ci_no, logistics_status, target_country, target_warehouse)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [lbId, batchNo, ciId, ciNo, status, '印度尼西亚', 'Bekasi']
  );
  run(
    `INSERT INTO packing_lists (id, pl_no, related_ci_id, related_ci_no, logistics_batch_id, total_qty, status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [plId, plNo, ciId, ciNo, lbId, total, 'confirmed']
  );
  for (const it of items) {
    run(
      `INSERT INTO packing_list_items (id, pl_id, pl_no, ci_no, sku_code, total_qty)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [uniq('pli'), plId, plNo, ciNo, it.sku, it.qty]
    );
  }
  return lbId;
}

function findRow(rows, ciId, sku) {
  return rows.find(r => r.ci_id === ciId && r.sku_code === sku);
}

// ── Case 1 ──
test('Case 1: 同 CI 两 batch（A 已到仓=40 / B 在途=60）→ transit_qty=60', () => {
  clearAll();
  const ci = uniq('CI');
  seedCI(ci, 'CI-C1', 'shipped');
  seedCIIItem(ci, 'CI-C1', 'SKU-X', 100, 10000, 100);
  seedBatch(ci, 'CI-C1', 'completed', [{ sku: 'SKU-X', qty: 40 }]);   // 已到仓
  seedBatch(ci, 'CI-C1', 'in_transit', [{ sku: 'SKU-X', qty: 60 }]);  // 在途

  const rows = getEffectiveTransitRows();
  const r = findRow(rows, ci, 'SKU-X');
  assert.ok(r, '应存在有效在途行');
  assert.equal(Number(r.shipped_qty), 100);
  assert.equal(Number(r.arrived_qty), 40);   // 仅 completed batch 计入到仓
  assert.equal(Number(r.transit_qty), 60);    // 在途 batch 的 60 保留
});

// ── Case 2 ──
test('Case 2: 同 SKU 多 CI item → (ci,sku) 聚合 + 加权单位值', () => {
  clearAll();
  const ci = uniq('CI');
  seedCI(ci, 'CI-C2', 'shipped');
  // 同 SKU 两条 CI item：100 qty / 10000 value；50 qty / 6000 value
  seedCIIItem(ci, 'CI-C2', 'SKU-Y', 100, 10000, 100);
  seedCIIItem(ci, 'CI-C2', 'SKU-Y', 50, 6000, 120);
  // arrived 40（completed batch）
  seedBatch(ci, 'CI-C2', 'completed', [{ sku: 'SKU-Y', qty: 40 }]);

  const rows = getEffectiveTransitRows();
  const r = findRow(rows, ci, 'SKU-Y');
  assert.ok(r, '应存在有效在途行');
  assert.equal(Number(r.shipped_qty), 150);        // 两条 item 按 SKU 聚合
  assert.equal(Number(r.ci_amount_total), 16000);   // 金额聚合
  assert.equal(Number(r.arrived_qty), 40);
  assert.equal(Number(r.transit_qty), 110);         // 150 - 40
  // 加权单位值 = 16000 / 150（消费者据此估值，而非单条 item 的 10000/100 或 6000/50）
  const unitValue = Number(r.ci_amount_total) / Number(r.shipped_qty);
  assert.ok(Math.abs(unitValue - 16000 / 150) < 1e-9);
});

// ── Case 3 ──
test('Case 3: CI status=completed 但存在未到仓 batch → 仍算剩余 transit', () => {
  clearAll();
  const ci = uniq('CI');
  seedCI(ci, 'CI-C3', 'completed'); // CI 已完成，但 batch 还在途
  seedCIIItem(ci, 'CI-C3', 'SKU-Z', 100, 8000, 80);
  // 仅一个 in_transit batch（未到仓），arrived 应为 0
  seedBatch(ci, 'CI-C3', 'in_transit', [{ sku: 'SKU-Z', qty: 100 }]);

  const rows = getEffectiveTransitRows();
  const r = findRow(rows, ci, 'SKU-Z');
  assert.ok(r, 'completed CI 仍应参与有效在途（NOT IN cancelled）');
  assert.equal(Number(r.arrived_qty), 0);
  assert.equal(Number(r.transit_qty), 100); // 整批仍在途
});

// ── Case 4 ──
test('Case 4: CI status=cancelled → 不计算', () => {
  clearAll();
  const ci = uniq('CI');
  seedCI(ci, 'CI-C4', 'cancelled');
  seedCIIItem(ci, 'CI-C4', 'SKU-W', 100, 5000, 50);
  seedBatch(ci, 'CI-C4', 'completed', [{ sku: 'SKU-W', qty: 100 }]); // 即便到仓也不该出现

  const rows = getEffectiveTransitRows();
  const r = findRow(rows, ci, 'SKU-W');
  assert.equal(r, undefined, 'cancelled CI 不应出现在有效在途结果中');
});

// ── Case 5 ──
test('Case 5: inbound_qty 不重复扣减 → 仍按 arrived 扣减', () => {
  clearAll();
  const ci = uniq('CI');
  seedCI(ci, 'CI-C5', 'shipped');
  // shipped=100，inbound=80（部分入库），但 arrived 只看 completed batch 的 PL qty
  seedCIIItem(ci, 'CI-C5', 'SKU-V', 100, 9000, 90, 80);
  // completed batch 仅承载 40 → arrived=40
  seedBatch(ci, 'CI-C5', 'completed', [{ sku: 'SKU-V', qty: 40 }]);

  const rows = getEffectiveTransitRows();
  const r = findRow(rows, ci, 'SKU-V');
  assert.ok(r, '应存在有效在途行');
  assert.equal(Number(r.shipped_qty), 100);
  assert.equal(Number(r.arrived_qty), 40);  // 来自 PL qty，而非 inbound_qty(80)
  assert.equal(Number(r.transit_qty), 60);  // 100 - 40，而非 100 - 80
});
