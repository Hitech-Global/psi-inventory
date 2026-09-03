'use strict';

/**
 * 库存导入前端状态规则（INV-IMPORT-PRECHECK-01）纯函数回归测试
 *
 * 覆盖用户验收的 UI 不变量（A–F），全部通过 assets/inv-import-rules.js 的纯函数验证，
 * 不依赖浏览器 DOM：
 *   A) 预检查 pending → 按钮禁用
 *   B) 存在 blocking → 按钮禁用
 *   C) 预检查 ok 但 fingerprint 已变化 → 按钮禁用（防止旧 ok:true 放行新 payload）
 *   D) 预检查 ok 且 fingerprint 一致 → 按钮启用
 *   E) bulk-import 返回 blocked:true → 状态恢复为 blocked（precheck.ok=false、blocking 保留、指纹失效）→ 按钮禁用
 *   F) 旧的 precheck 响应（seq 较小）不得覆盖最新请求（seq 守卫）
 *
 * 另含：品牌严格比较纯函数（逐字符 ===）、fingerprint 稳定性。
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const R = require('../assets/inv-import-rules.js');

// ==================== 品牌严格比较纯函数 ====================
test('isBrandMismatch：逐字符 ===，区分大小写与首尾空格', () => {
  // 主数据 brand = "Redragon"
  assert.equal(R.isBrandMismatch('Redragon', 'Redragon'), false, '完全一致应视为无不一致');
  assert.equal(R.isBrandMismatch('REDRAGON', 'Redragon'), true, '全大写不一致');
  assert.equal(R.isBrandMismatch('redragon', 'Redragon'), true, '全小写不一致');
  assert.equal(R.isBrandMismatch(' Redragon', 'Redragon'), true, '前导空格不一致');
  assert.equal(R.isBrandMismatch('Redragon ', 'Redragon'), true, '尾部空格不一致');
  assert.equal(R.isBrandMismatch(' Redragon ', 'Redragon'), true, '前后空格不一致');
  assert.equal(R.isBrandMismatch('Red Dragon', 'Redragon'), true, '内部空格不一致');
  assert.equal(R.isBrandMismatch('   ', 'Redragon'), true, '纯空格（已填写）必须参与比较 → 不一致');
  assert.equal(R.isBrandMismatch('', 'Redragon'), false, '真空 → 视为未填写 → 允许');
  assert.equal(R.isBrandMismatch(null, 'Redragon'), false, 'null → 视为未填写 → 允许');
  assert.equal(R.isBrandMismatch(undefined, 'Redragon'), false, 'undefined → 视为未填写 → 允许');
});

test('isBrandUnmaintained：NULL / 空串 / 纯空格 视为未维护', () => {
  assert.equal(R.isBrandUnmaintained(null), true);
  assert.equal(R.isBrandUnmaintained(undefined), true);
  assert.equal(R.isBrandUnmaintained(''), true);
  assert.equal(R.isBrandUnmaintained('   '), true);
  assert.equal(R.isBrandUnmaintained('Redragon'), false);
});

// ==================== fingerprint 稳定性 / 敏感性 ====================
function rec(over) {
  return Object.assign({ sku_code: 'SKU-A', brand: 'Redragon', import_date: '2026-07-05', country: 'Indonesia', warehouse: 'Jakarta仓', available_qty: 10, weighted_avg_cost: 80, snapshot_cutoff_date: '' }, over);
}
test('computeInvImportFingerprint：相同 payload 稳定；任一笔字段变化即改变', () => {
  const a = [rec({})];
  const b = [rec({})];
  assert.equal(R.computeInvImportFingerprint(a, '2026-07-05'), R.computeInvImportFingerprint(b, '2026-07-05'), '相同 records+快照 应稳定');

  assert.notEqual(
    R.computeInvImportFingerprint(a, '2026-07-05'),
    R.computeInvImportFingerprint([rec({ brand: ' Redragon ' })], '2026-07-05'),
    'brand 首尾空格变化应改变 fingerprint'
  );
  assert.notEqual(
    R.computeInvImportFingerprint(a, '2026-07-05'),
    R.computeInvImportFingerprint([rec({ brand: 'REDRAGON' })], '2026-07-05'),
    'brand 大小写变化应改变 fingerprint'
  );
  assert.notEqual(
    R.computeInvImportFingerprint(a, '2026-07-05'),
    R.computeInvImportFingerprint([rec({ available_qty: 11 })], '2026-07-05'),
    'qty 变化应改变 fingerprint'
  );
  assert.notEqual(
    R.computeInvImportFingerprint(a, '2026-07-05'),
    R.computeInvImportFingerprint(a, '2026-07-06'),
    '快照截止日期变化应改变 fingerprint'
  );
  // 多行顺序 / 内容
  const multi = [rec({ sku_code: 'SKU-A' }), rec({ sku_code: 'SKU-B', brand: 'Logitech' })];
  assert.notEqual(
    R.computeInvImportFingerprint(multi, '2026-07-05'),
    R.computeInvImportFingerprint([rec({ sku_code: 'SKU-B', brand: 'Logitech' }), rec({ sku_code: 'SKU-A' })], '2026-07-05'),
    '行内容变化应改变 fingerprint'
  );
});

// ==================== 按钮 enabled 不变量 A–D ====================
const ENABLED_BASE = { hasRows: true, hasLocalError: false, precheckOk: true, blockingCount: 0, fingerprintMatch: true, hasDate: true };

test('A) 预检查 pending（precheckOk=false）→ 按钮禁用', () => {
  assert.equal(R.invImportShouldEnable(Object.assign({}, ENABLED_BASE, { precheckOk: false })), false);
});

test('B) 存在 blocking（blockingCount>0）→ 按钮禁用', () => {
  assert.equal(R.invImportShouldEnable(Object.assign({}, ENABLED_BASE, { blockingCount: 3 })), false);
});

test('C) 预检查 ok 但 fingerprint 已变化 → 按钮禁用', () => {
  assert.equal(R.invImportShouldEnable(Object.assign({}, ENABLED_BASE, { fingerprintMatch: false })), false);
});

test('D) 预检查 ok 且 fingerprint 一致 且 有快照日期 → 按钮启用', () => {
  assert.equal(R.invImportShouldEnable(Object.assign({}, ENABLED_BASE)), true);
});

test('D2) 缺快照日期 → 即便预检查通过也禁用', () => {
  assert.equal(R.invImportShouldEnable(Object.assign({}, ENABLED_BASE, { hasDate: false })), false);
});

test('D3) 存在本地格式错误 → 即便预检查通过也禁用', () => {
  assert.equal(R.invImportShouldEnable(Object.assign({}, ENABLED_BASE, { hasLocalError: true })), false);
});

// ==================== E) 422 兜底恢复 blocked 态 ====================
test('E) bulk-import blocked:true → 状态恢复为 blocked，指纹失效，按钮禁用', () => {
  const payload = {
    blocked: true,
    blocking: [
      { issue_type: 'BRAND_MISMATCH', sku_code: 'SKU-A', row: 2, excel_brand: 'REDRAGON', master_brand: 'Redragon' }
    ],
    summary: [{ issue_type: 'BRAND_MISMATCH', count: 1 }],
    total_rows: 1
  };
  const st = R.applyBlockedFallback(payload, { total_rows: 1 });
  assert.equal(st.precheck.ok, false, '422 后 precheck.ok 必须为 false');
  assert.equal(st.passedFingerprint, null, '422 后通过指纹必须失效');
  assert.equal(st.precheck.blocking.length, 1, 'blocking 明细必须保留');
  assert.equal(st.precheck.blocking[0].issue_type, 'BRAND_MISMATCH');
  // 与按钮不变量组合：blocked 态 → 禁用
  const enabled = R.invImportShouldEnable({
    hasRows: true, hasLocalError: false,
    precheckOk: st.precheck.ok, blockingCount: st.precheck.blocking.length,
    fingerprintMatch: st.passedFingerprint !== null, hasDate: true
  });
  assert.equal(enabled, false, '422 恢复为 blocked 态后按钮必须保持禁用');
});

// ==================== F) 旧 precheck 响应不得覆盖新请求（seq 守卫） ====================
test('F) 旧 seq 响应不得覆盖最新请求', () => {
  assert.equal(R.invPrecheckSeqAccepted(2, 2), true, '同 seq 应接受');
  assert.equal(R.invPrecheckSeqAccepted(1, 2), false, '过期旧响应（seq 较小）必须被丢弃');
  assert.equal(R.invPrecheckSeqAccepted(1, 3), false, '更早的旧响应必须被丢弃');
});

// ==================== 二、fingerprint 字段覆盖（用户验收：必须含 sku/brand/import_date/country/warehouse/qty/wac/snapshot） ====================
test('fingerprint：覆盖全部必填字段，且 brand 保留原始首尾空格（不 trim）', () => {
  const r = rec({ sku_code: 'SKU-X', brand: 'Redragon ', import_date: '2026-08-01', country: 'ID', warehouse: 'W1', available_qty: 5, weighted_avg_cost: 9.5 });
  const fp = R.computeInvImportFingerprint([r], '2026-07-09');
  ['SKU-X', 'Redragon ', '2026-08-01', 'ID', 'W1', '5', '9.5', '2026-07-09'].forEach(function (token) {
    assert.ok(fp.indexOf(token) >= 0, 'fingerprint 必须包含字段值: ' + JSON.stringify(token));
  });
  // 关键：brand 的尾部空格必须原样出现在 fingerprint 中（证明没有 trim）
  assert.ok(fp.indexOf('Redragon ') >= 0, 'brand 原始值（含尾随空格）必须进入 fingerprint，不能 trim');
});

// ==================== 二、fingerprint 敏感性（用户验收） ====================
test('fingerprint：纯顺序变化即改变', () => {
  const r1 = rec({ sku_code: 'SKU-A', brand: 'Redragon' });
  const r2 = rec({ sku_code: 'SKU-B', brand: 'Logitech' });
  assert.notEqual(
    R.computeInvImportFingerprint([r1, r2], '2026-07-05'),
    R.computeInvImportFingerprint([r2, r1], '2026-07-05'),
    '仅交换两行顺序必须改变 fingerprint'
  );
});

test('fingerprint：新增/删除任一行即改变', () => {
  const base = R.computeInvImportFingerprint([rec({ sku_code: 'SKU-A' })], '2026-07-05');
  assert.notEqual(base, R.computeInvImportFingerprint([rec({ sku_code: 'SKU-A' }), rec({ sku_code: 'SKU-B' })], '2026-07-05'), '新增一行必须改变');
  assert.notEqual(base, R.computeInvImportFingerprint([], '2026-07-05'), '删除所有行必须改变');
});

test('fingerprint：weighted_avg_cost 变化即改变', () => {
  assert.notEqual(
    R.computeInvImportFingerprint([rec({})], '2026-07-05'),
    R.computeInvImportFingerprint([rec({ weighted_avg_cost: 81 })], '2026-07-05'),
    'WAC 变化必须改变 fingerprint'
  );
});

// ==================== 三、快照截止日期变更 → 立即失效（UI 不变量） ====================
test('三) 快照截止日期变更：旧通过 fingerprint 失效 → 按钮禁用（必须重新 precheck）', () => {
  const records = [rec({})];
  const passed = R.computeInvImportFingerprint(records, '2026-07-05'); // 通过时记录的 fingerprint
  // 用户在弹窗内把快照日期改为 2026-07-06
  const current = R.computeInvImportFingerprint(records, '2026-07-06');
  const fpMatch = (passed !== null) && current === passed; // 与 updateInvImportBtnState 中判定一致
  assert.equal(fpMatch, false, '快照日期变更后当前 fingerprint 必须不等于旧 passed');
  assert.equal(
    R.invImportShouldEnable(Object.assign({}, ENABLED_BASE, { fingerprintMatch: fpMatch })),
    false,
    '旧通过指纹在快照日期变更后必须使按钮保持禁用'
  );
});

// ==================== 四、品牌「空格」边界：纯空格 Excel 品牌不得被当作空值 ====================
test('四) 纯空格 Excel 品牌「不」被 trim 成空值（前端/规则层不提前 trim）', () => {
  // 若被错误地 trim 成 ''，isBrandMismatch 会返回 false（放行）；此处必须为 true（参与比较 → 不一致）
  assert.equal(R.isBrandMismatch('   ', 'Redragon'), true, '纯空格必须参与比较 → BRAND_MISMATCH，而非被当成未填写放行');
  assert.equal(R.isBrandMismatch('  ', 'Redragon'), true, '两个空格同样必须参与比较');
});
