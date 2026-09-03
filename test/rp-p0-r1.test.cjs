/**
 * RP-P0-R1 — Order-forecast payload slimming regression tests.
 *
 * 覆盖（用户 F 段要求）：
 *   1. 主 endpoint 必需字段全部存在
 *   2. 已确认 unused 字段不再返回
 *   3. daily endpoint 不再使用 ...sku 全字段 spread
 *   4. daily 必需字段存在
 *   5. identity 字段（id/sku_code/country/warehouse）不丢
 *   6. suggested qty / turnover 所需字段不丢
 *   7. online/offline 所需字段不丢
 *   8. export 所需字段不丢
 *   9. response row count 不变
 *  10. 预测数值不因 projection 改变（真实 DB fixture parity）
 *
 * 真实 serializer parity：直接使用 rp-projection 的 slimReplenishmentRow /
 * projectDailySalesRow（与主 endpoint / daily endpoint 完全相同的函数），
 * 并在本地 SQLite 上跑 endpoint 同构 SQL 做 fixture 校验。
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const D = require('better-sqlite3');

const { RP_UNUSED_RESPONSE_FIELDS, slimReplenishmentRow, projectDailySalesRow } = require('../rp-projection');

// ---- 构建与 endpoint 同构的字段宇宙 ----
const dbPath = path.join(__dirname, '..', 'data', 'inventory.db');
const haveDb = fs.existsSync(dbPath);
let rsCols = [];
if (haveDb) {
  const db = new D(dbPath, { readonly: true });
  rsCols = db.prepare('PRAGMA table_info(replenishment_suggestions)').all().map(c => c.name);
  db.close();
}
const JOIN_FIELDS = ['product_name', 'brand', 'category', 'model', 'standard_purchase_price', 'qty_per_carton', 'purchase_currency', 'last_inbound_date'];
const DERIVED_FIELDS = ['available_qty', 'in_transit_qty', 'pi_confirmed_unshipped_qty', 'po_unconfirmed_pi_qty', 'total_inventory_pool', 'days_since_last_inbound'];
const ALL = [...rsCols, ...JOIN_FIELDS, ...DERIVED_FIELDS];

// 经审计零引用的 30 死字段（与 rp-projection 必须一致）
const EXPECTED_UNUSED = [
  'online_sales_30d', 'online_sales_60d', 'online_sales_90d',
  'offline_sales_30d', 'offline_sales_60d', 'offline_sales_90d',
  'manual_forecast_online', 'manual_forecast_offline',
  'mdf_forecast_monthly', 'total_monthly_forecast',
  'current_turnover_months', 'with_transit_turnover_months', 'with_pi_turnover_months', 'with_po_turnover_months',
  'manual_planned_qty', 'moq_qty', 'carton_adjusted_qty', 'generate_po',
  'target_stock_months', 'risk_level',
  'online_reservation_method', 'online_reservation_months', 'online_reservation_qty',
  'offline_reservation_method', 'offline_reservation_months', 'offline_reservation_qty',
  'other_suggested_qty', 'resolved_at',
  'standard_purchase_price', 'purchase_currency'
];
const REQUIRED = ALL.filter(f => !EXPECTED_UNUSED.includes(f));
const DAILY_REQUIRED = ['id', 'sku_code', 'sales_group', 'lifecycle_status', 'model', 'daily_sales', 'last_7_days', 'last_14_days', 'last_30_days', 'avg_daily_sales', 'trend'];

// 构造覆盖全部候选字段的 fixture（数值/字符串用哨兵值，便于 parity 校验）
function buildFixture() {
  const row = {};
  ALL.forEach((f, i) => {
    // 用类型化哨兵：数值列给 i，字符串列给 'V'+i，便于断言“值未被改写”
    const numericLike = /_(qty|months|days|sales|period|turnover|stock|seq|revision|price|cost|avg|m\d|pct|level|write_seq)$/.test(f)
      || ['id', 'moq_qty', 'carton_adjusted_qty', 'suggested_qty', 'user_adjusted_qty', 'final_order_qty', 'is_new_product', 'generate_po', 'recalc_revision'].includes(f);
    row[f] = numericLike ? i + 1 : 'V' + i;
  });
  // id / sku_code 给可辨识值
  row.id = 'ROW-1';
  row.sku_code = 'SKU-1';
  row.country = 'ID';
  row.target_warehouse = 'WH-1';
  return row;
}

test('A. 主 endpoint：unused 30 字段全部被删除', () => {
  const row = buildFixture();
  const slim = slimReplenishmentRow(row);
  for (const f of EXPECTED_UNUSED) {
    assert.strictEqual(f in slim, false, `期望删除字段仍存在: ${f}`);
  }
  // deny-list 集合本身正确
  assert.deepStrictEqual(RP_UNUSED_RESPONSE_FIELDS.slice().sort(), EXPECTED_UNUSED.slice().sort());
});

test('B. 主 endpoint：必需字段全部存在', () => {
  const slim = slimReplenishmentRow(buildFixture());
  for (const f of REQUIRED) {
    assert.strictEqual(f in slim, true, `期望保留字段被误删: ${f}`);
  }
});

test('C. 主 endpoint：投影不改写任何保留字段的值（parity）', () => {
  const before = buildFixture();
  const after = slimReplenishmentRow(before);
  for (const f of REQUIRED) {
    assert.strictEqual(after[f], before[f], `保留字段值被改写: ${f} (${before[f]} -> ${after[f]})`);
  }
});

test('D. 主 endpoint：identity 字段不丢', () => {
  const slim = slimReplenishmentRow(buildFixture());
  for (const f of ['id', 'sku_code', 'country', 'target_warehouse']) {
    assert.strictEqual(f in slim, true, `identity 字段丢失: ${f}`);
  }
});

test('E. 主 endpoint：suggested / turnover / sales 字段不丢', () => {
  const slim = slimReplenishmentRow(buildFixture());
  const need = ['suggested_qty', 'user_adjusted_qty', 'after_order_turnover_months',
    'sales_m1', 'sales_m2', 'sales_m3', 'sales_m4', 'avg_sales_4m',
    'online_sales_m1', 'online_sales_m2', 'online_sales_m3', 'online_sales_m4',
    'offline_sales_m1', 'offline_sales_m2', 'offline_sales_m3', 'offline_sales_m4',
    'online_avg_sales_4m', 'offline_avg_sales_4m',
    'online_after_order_turnover_months', 'offline_after_order_turnover_months'];
  for (const f of need) {
    assert.strictEqual(f in slim, true, `预测相关字段丢失: ${f}`);
  }
});

test('F. 主 endpoint：online/offline 渠道字段不丢', () => {
  const slim = slimReplenishmentRow(buildFixture());
  const need = ['online_target_turnover', 'offline_target_turnover', 'online_target_stock', 'offline_target_stock',
    'other_target_stock', 'online_remark', 'offline_remark', 'final_order_qty', 'adjustment_reason',
    'online_avg_sales_period', 'offline_avg_sales_period', 'avg_sales_period',
    'online_suggested_qty', 'offline_suggested_qty'];
  for (const f of need) {
    assert.strictEqual(f in slim, true, `渠道字段丢失: ${f}`);
  }
});

test('G. 主 endpoint：export 所需字段不丢（rpCellText 渲染链）', () => {
  const slim = slimReplenishmentRow(buildFixture());
  const need = ['sku_code', 'model', 'available_qty', 'in_transit_qty', 'pi_confirmed_unshipped_qty',
    'po_unconfirmed_pi_qty', 'total_inventory_pool', 'sales_status', 'risk_tags', 'action', 'suggestion',
    'sales_reason', 'ai_business_advice', 'last_inbound_date', 'days_since_last_inbound', 'arrival_month',
    'online_target_turnover', 'offline_target_turnover', 'online_target_stock', 'offline_target_stock'];
  for (const f of need) {
    assert.strictEqual(f in slim, true, `export 渲染字段丢失: ${f}`);
  }
});

test('H. 主 endpoint：row count 不变（slim 不丢行）', () => {
  const rows = [buildFixture(), buildFixture(), buildFixture()];
  const slimmed = rows.map(slimReplenishmentRow);
  assert.strictEqual(slimmed.length, rows.length);
  assert.strictEqual(slimmed[0].sku_code, 'SKU-1');
});

test('I. daily endpoint：不再 ...sku 全字段 spread（仅 11 字段白名单）', () => {
  const sku = buildFixture(); // 含全部字段
  const out = projectDailySalesRow(sku, [1, 2, 3], 6, 6, 6, 0.2, 'up');
  const keys = Object.keys(out).sort();
  assert.deepStrictEqual(keys, DAILY_REQUIRED.slice().sort(),
    `daily 响应字段越界（含 ...sku 泄漏）: ${keys.join(',')}`);
});

test('J. daily endpoint：必需字段存在且值正确', () => {
  const sku = buildFixture();
  const out = projectDailySalesRow(sku, [1, 2, 3], 6, 12, 18, 0.5, 'down');
  assert.strictEqual(out.id, 'ROW-1');
  assert.strictEqual(out.sku_code, 'SKU-1');
  assert.strictEqual(out.sales_group, sku.sales_group);
  assert.strictEqual(out.lifecycle_status, sku.lifecycle_status);
  assert.strictEqual(out.model, sku.model);
  assert.deepStrictEqual(out.daily_sales, [1, 2, 3]);
  assert.strictEqual(out.last_7_days, 6);
  assert.strictEqual(out.last_14_days, 12);
  assert.strictEqual(out.last_30_days, 18);
  assert.strictEqual(out.avg_daily_sales, 0.5);
  assert.strictEqual(out.trend, 'down');
});

test('K. 真实 DB parity：slim 仅删字段、不改写任何保留字段值', () => {
  if (!haveDb) return; // 无本地库则跳过（不视为失败）
  const db = new D(dbPath, { readonly: true });
  const rows = db.prepare(
    `SELECT rs.*, s.product_name, s.brand, s.category, s.model, s.standard_purchase_price, s.qty_per_carton, s.purchase_currency, i.last_inbound_date,
        i.id AS inv_row_id, i.available_qty AS inv_available_qty, i.in_transit_qty AS inv_in_transit_qty,
        i.pi_confirmed_unshipped_qty AS inv_pi_confirmed_unshipped_qty, i.po_unconfirmed_pi_qty AS inv_po_unconfirmed_pi_qty
      FROM replenishment_suggestions rs
      LEFT JOIN skus s ON rs.sku_code = s.sku_code
      LEFT JOIN inventory i ON rs.sku_code = i.sku_code AND rs.country = i.country AND rs.target_warehouse = i.warehouse
      LIMIT 50`
  ).all();
  db.close();
  assert.ok(rows.length > 0, '本地库应有 replenishment_suggestions 行');
  for (const r of rows) {
    const before = JSON.parse(JSON.stringify(r));
    const after = slimReplenishmentRow(r);
    // 保留字段值逐字段一致
    for (const f of REQUIRED) {
      if (f in before) assert.strictEqual(after[f], before[f], `真实行保留字段被改写: ${f}`);
    }
    // 死字段应被删除
    for (const f of EXPECTED_UNUSED) assert.strictEqual(f in after, false, `真实行死字段未删: ${f}`);
  }
});

// ---------- FINAL CORRECTION GATE：non-mutation 契约（真实 serializer，合成全字段输入） ----------
// serializer 字段无关：保留任何非 deny-list 字段。合成输入显式补入用户指定的
// warehouse / turnover_months（即便不在真实 schema 中），以验证“保留一切非 deny-list 字段”契约。
function buildSyntheticFull() {
  const row = buildFixture();
  row.warehouse = 'WH-X';
  row.turnover_months = 3.5;
  return row;
}

test('L. non-mutation: input object unchanged after slimReplenishmentRow', () => {
  const input = buildSyntheticFull();
  const before = structuredClone(input);
  const output = slimReplenishmentRow(input);
  assert.deepStrictEqual(input, before, 'slimReplenishmentRow 修改了输入对象（应为 non-mutating）');
});

test('M. non-mutation: returned object is a new object (!== input)', () => {
  const input = buildSyntheticFull();
  const output = slimReplenishmentRow(input);
  assert.notStrictEqual(output, input, 'slimReplenishmentRow 返回了同一输入对象（应为新对象）');
});

test('N. non-mutation: 30 deny-list fields absent in output', () => {
  const input = buildSyntheticFull();
  const output = slimReplenishmentRow(input);
  for (const f of RP_UNUSED_RESPONSE_FIELDS) {
    assert.strictEqual(f in output, false, `deny-list 字段仍存在于 output: ${f}`);
  }
});

test('O. non-mutation: required fields preserved (presence + value)', () => {
  const input = buildSyntheticFull();
  const output = slimReplenishmentRow(input);
  const required = ['sku_code', 'country', 'warehouse', 'id', 'suggested_qty',
    'online_suggested_qty', 'offline_suggested_qty', 'turnover_months',
    'target_warehouse', 'available_qty', 'in_transit_qty', 'total_inventory_pool',
    'sales_status', 'risk_tags', 'model'];
  for (const f of required) {
    assert.strictEqual(f in output, true, `required 字段丢失: ${f}`);
    assert.strictEqual(output[f], input[f], `required 字段值被改写: ${f}`);
  }
});

test('P. non-mutation: unknown future field preserved (deny-list schema-extension safe)', () => {
  const input = buildSyntheticFull();
  input.future_new_field = 'future-safe';
  const output = slimReplenishmentRow(input);
  assert.strictEqual('future_new_field' in input, true, '输入对象被篡改（不应发生）');
  assert.strictEqual(output.future_new_field, 'future-safe', '未来 schema 扩展字段被 deny-list 误删');
});

test('Q. daily serializer: input sku unchanged (projectDailySalesRow is pure)', () => {
  const sku = buildSyntheticFull();
  const before = structuredClone(sku);
  const out = projectDailySalesRow(sku, [1, 2, 3], 6, 12, 18, 0.5, 'down');
  assert.deepStrictEqual(sku, before, 'projectDailySalesRow 修改了输入 sku 对象（应为 pure）');
  assert.notStrictEqual(out, sku, 'projectDailySalesRow 应返回新对象');
  assert.deepStrictEqual(Object.keys(out).sort(), DAILY_REQUIRED.slice().sort(), 'daily 响应字段越界（含泄漏）');
});
