/**
 * RP-P0-R1 — Order-forecast payload slimming regression tests.
 *
 * 设计：HERMETIC / 自包含（不依赖任何本地数据库或开发机 schema）。
 *   - fixture 由本文件定义的显式字段宇宙构成；deny-list 直接复用 production
 *     serializer 的 RP_UNUSED_RESPONSE_FIELDS（唯一真相源，不手抄，杜绝漂移）。
 *   - 覆盖 projection contract：30 死字段删除、必需字段保留、non-mutation、
 *     daily 白名单、future schema 字段安全、精确变换 parity。
 *   - 在纯净 `git archive HEAD`（无 data/inventory.db）下独立通过。
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');

const { RP_UNUSED_RESPONSE_FIELDS, slimReplenishmentRow, projectDailySalesRow } = require('../rp-projection');

// 唯一真相源：production serializer 的 deny-list（30 死字段，FIELD USAGE MATRIX 审计）。
const UNUSED = RP_UNUSED_RESPONSE_FIELDS;

// 显式 KEPT 字段宇宙（合成 fixture，不依赖任何本地数据库）。
// 这些字段名经核对均不在 UNUSED 中（test R 断言互斥）。
const KEPT_FIELDS = [
  // identity
  'id', 'sku_code', 'country', 'target_warehouse', 'warehouse',
  // product / join
  'product_name', 'brand', 'category', 'model', 'qty_per_carton',
  'sales_group', 'lifecycle_status',
  // suggestion / adjustment
  'suggested_qty', 'user_adjusted_qty', 'online_suggested_qty', 'offline_suggested_qty',
  'final_order_qty', 'adjustment_reason', 'other_target_stock',
  'action', 'suggestion', 'sales_reason', 'ai_business_advice', 'arrival_month',
  // turnover / status
  'after_order_turnover_months', 'online_after_order_turnover_months', 'offline_after_order_turnover_months',
  'turnover_months', 'sales_status', 'risk_tags',
  // targets / stock
  'online_target_turnover', 'offline_target_turnover', 'online_target_stock', 'offline_target_stock',
  'online_remark', 'offline_remark',
  // online / offline sales series
  'sales_m1', 'sales_m2', 'sales_m3', 'sales_m4', 'avg_sales_4m',
  'online_sales_m1', 'online_sales_m2', 'online_sales_m3', 'online_sales_m4',
  'offline_sales_m1', 'offline_sales_m2', 'offline_sales_m3', 'offline_sales_m4',
  'online_avg_sales_4m', 'offline_avg_sales_4m',
  'online_avg_sales_period', 'offline_avg_sales_period', 'avg_sales_period',
  // derived inventory
  'available_qty', 'in_transit_qty', 'pi_confirmed_unshipped_qty',
  'po_unconfirmed_pi_qty', 'total_inventory_pool', 'days_since_last_inbound', 'last_inbound_date'
];

const REQUIRED = KEPT_FIELDS;
const DAILY_REQUIRED = ['id', 'sku_code', 'sales_group', 'lifecycle_status', 'model', 'daily_sales', 'last_7_days', 'last_14_days', 'last_30_days', 'avg_daily_sales', 'trend'];

// 合成 fixture：KEPT 字段 + 30 deny-list 字段 + 未来 schema 扩展字段。
// 全部使用可辨识哨兵值，便于 parity 断言“值未被改写”。
function buildFixture() {
  const row = {};
  for (const f of KEPT_FIELDS) row[f] = `KEEP-${f}`;
  for (const f of UNUSED) row[f] = `UNUSED-${f}`;
  row.future_new_field = 'future-safe';
  return row;
}

// 合成“满字段”输入：在 buildFixture 基础上补入 daily/non-mutation 测试要求的字段。
function buildSyntheticFull() {
  const row = buildFixture();
  row.warehouse = 'WH-X';
  row.turnover_months = 3.5;
  row.extra_should_not_leak = 'leak-me'; // 验证投影不泄漏非白名单字段
  return row;
}

test('A. 主 endpoint：unused 30 字段全部被删除', () => {
  const row = buildFixture();
  const slim = slimReplenishmentRow(row);
  for (const f of UNUSED) {
    assert.strictEqual(f in slim, false, `期望删除字段仍存在: ${f}`);
  }
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
  assert.strictEqual(slimmed[0].sku_code, 'KEEP-sku_code');
});

test('I. daily endpoint：不再 ...sku 全字段 spread（仅 11 字段白名单）', () => {
  const sku = buildSyntheticFull(); // 含全部字段 + extra
  const out = projectDailySalesRow(sku, [1, 2, 3], 6, 6, 6, 0.2, 'up');
  const keys = Object.keys(out).sort();
  assert.deepStrictEqual(keys, DAILY_REQUIRED.slice().sort(),
    `daily 响应字段越界（含 ...sku 泄漏）: ${keys.join(',')}`);
});

test('J. daily endpoint：必需字段存在且值正确', () => {
  const sku = buildSyntheticFull();
  const out = projectDailySalesRow(sku, [1, 2, 3], 6, 12, 18, 0.5, 'down');
  assert.strictEqual(out.id, 'KEEP-id');
  assert.strictEqual(out.sku_code, 'KEEP-sku_code');
  assert.strictEqual(out.sales_group, 'KEEP-sales_group');
  assert.strictEqual(out.lifecycle_status, 'KEEP-lifecycle_status');
  assert.strictEqual(out.model, 'KEEP-model');
  assert.deepStrictEqual(out.daily_sales, [1, 2, 3]);
  assert.strictEqual(out.last_7_days, 6);
  assert.strictEqual(out.last_14_days, 12);
  assert.strictEqual(out.last_30_days, 18);
  assert.strictEqual(out.avg_daily_sales, 0.5);
  assert.strictEqual(out.trend, 'down');
});

test('K. 主 endpoint：slim 是精确“仅删 30 死字段”变换（合成 parity，无 DB）', () => {
  const input = buildFixture();
  const output = slimReplenishmentRow(input);
  // 期望 output == input 去掉 30 个 deny-list 字段（其余含未来字段原样保留）
  const expected = { ...input };
  for (const f of UNUSED) delete expected[f];
  assert.deepStrictEqual(output, expected, 'slim 结果不等于“输入去 deny-list”精确变换');
});

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
  for (const f of UNUSED) {
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

test('Q. daily serializer: input sku unchanged (projectDailySalesRow is pure) + no leak', () => {
  const sku = buildSyntheticFull();
  const before = structuredClone(sku);
  const out = projectDailySalesRow(sku, [1, 2, 3], 6, 12, 18, 0.5, 'down');
  assert.deepStrictEqual(sku, before, 'projectDailySalesRow 修改了输入 sku 对象（应为 pure）');
  assert.notStrictEqual(out, sku, 'projectDailySalesRow 应返回新对象');
  assert.deepStrictEqual(Object.keys(out).sort(), DAILY_REQUIRED.slice().sort(), 'daily 响应字段越界（含泄漏）');
  // 非白名单字段不得泄漏
  assert.strictEqual('extra_should_not_leak' in out, false, 'daily 投影泄漏 extra_should_not_leak');
  assert.strictEqual('warehouse' in out, false, 'daily 投影泄漏 warehouse');
  assert.strictEqual('turnover_months' in out, false, 'daily 投影泄漏 turnover_months');
  assert.strictEqual('future_new_field' in out, false, 'daily 投影泄漏 future_new_field');
});

test('R. contract guard: deny-list = 30 字段且与 KEPT 互斥', () => {
  assert.strictEqual(UNUSED.length, 30, 'production deny-list 必须为 30 个死字段（FIELD USAGE MATRIX 审计）');
  const overlap = KEPT_FIELDS.filter(f => UNUSED.includes(f));
  assert.deepStrictEqual(overlap, [], `KEPT 与 UNUSED 重叠（设计错误）: ${overlap.join(',')}`);
});
