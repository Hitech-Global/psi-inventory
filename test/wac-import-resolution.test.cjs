'use strict';

// 强制正时区，确保日期 -1 day 回归可被捕获（Jakarta UTC+7）
process.env.TZ = 'Asia/Jakarta';
process.env.DB_DRIVER = 'sqlite';
process.env.DB_PATH = ':memory:';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { query, queryOne, run, getDB } = require('../db');
const server = require('../server');
const { resolveImportWac, runOriginalInventoryTotalsLoop } = server;

// ---------------------------------------------------------------------------
// 从 app.js 抽取“真实” parseDateStr（浏览器函数，Node 不可直接 require）
// 用括号配平精确截取函数体，确保测试的是生产代码本身，而非副本。
// ---------------------------------------------------------------------------
function loadParseDateStr() {
  const src = fs.readFileSync(__dirname + '/../app.js', 'utf8');
  const start = src.indexOf('function parseDateStr(v){');
  assert.ok(start >= 0, 'app.js 中未找到 parseDateStr 定义');
  let depth = 0, end = -1;
  for (let j = src.indexOf('{', start); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) { end = j; break; } }
  }
  assert.ok(end > 0, 'parseDateStr 函数体未闭合');
  const fnSrc = src.slice(start, end + 1);
  // eslint-disable-next-line no-new-func
  return new Function(fnSrc + '\nreturn parseDateStr;')();
}
const parseDateStr = loadParseDateStr();

// ===========================================================================
// 一、WAC 优先级单元测试（resolveImportWac 纯函数）
// ===========================================================================
const confirmed = (v) => ({ new_avg_cost: v });

test('WAC-A: confirmed+locked + file + existing → confirmed（Excel 不可覆盖）', () => {
  const r = resolveImportWac({ wacRecord: confirmed(999), fileWacRaw: 57685, existingWacRaw: 57 });
  assert.strictEqual(r.wac, 999);
  assert.strictEqual(r.wacSource, 'confirmed');
  assert.strictEqual(r.warning, null);
});

test('WAC-B: 无 confirmed + file + existing → file WAC', () => {
  const r = resolveImportWac({ wacRecord: null, fileWacRaw: 57685, existingWacRaw: 57 });
  assert.strictEqual(r.wac, 57685);
  assert.strictEqual(r.wacSource, 'file');
  assert.strictEqual(r.warning, null);
});

test('WAC-C: 无 confirmed + file 为空/无效 + existing → existing 兜底（不归零）', () => {
  const r1 = resolveImportWac({ wacRecord: null, fileWacRaw: '', existingWacRaw: 57 });
  assert.strictEqual(r1.wac, 57);
  assert.strictEqual(r1.wacSource, 'existing');
  assert.strictEqual(r1.warning, 'preserve');
  // file=0 也视为无效
  const r2 = resolveImportWac({ wacRecord: null, fileWacRaw: '0', existingWacRaw: 57 });
  assert.strictEqual(r2.wac, 57);
  assert.strictEqual(r2.wacSource, 'existing');
  // file 非数字也视为无效
  const r3 = resolveImportWac({ wacRecord: null, fileWacRaw: 'abc', existingWacRaw: 57 });
  assert.strictEqual(r3.wac, 57);
  assert.strictEqual(r3.wacSource, 'existing');
});

test('WAC-D: 三者都无 → 0', () => {
  const r = resolveImportWac({ wacRecord: null, fileWacRaw: '', existingWacRaw: undefined });
  assert.strictEqual(r.wac, 0);
  assert.strictEqual(r.wacSource, 'none');
  assert.strictEqual(r.warning, 'zero');
});

test('WAC-E: 实际回归 Arm 30 existing=57 file=57685 → 57685', () => {
  const r = resolveImportWac({ wacRecord: null, fileWacRaw: 57685, existingWacRaw: 57 });
  assert.strictEqual(r.wac, 57685);
});

test('WAC-F: Star MINI existing=211 file=204158 → 204158', () => {
  const r = resolveImportWac({ wacRecord: null, fileWacRaw: 204158, existingWacRaw: 211 });
  assert.strictEqual(r.wac, 204158);
});

// ===========================================================================
// 二、WAC 集成测试：真实 runOriginalInventoryTotalsLoop（SQLite）
// ===========================================================================
function setupSchema() {
  const d = getDB();
  d.exec(`CREATE TABLE IF NOT EXISTS inventory (
    id TEXT PRIMARY KEY, sku_code TEXT, country TEXT, warehouse TEXT,
    available_qty INTEGER DEFAULT 0, weighted_avg_cost NUMERIC DEFAULT 0,
    inventory_value NUMERIC DEFAULT 0, last_import_date TEXT DEFAULT '',
    snapshot_cutoff_date TEXT DEFAULT '', last_inbound_date TEXT DEFAULT '',
    first_inbound_date TEXT DEFAULT '', updated_at TEXT DEFAULT '');`);
  d.exec(`CREATE TABLE IF NOT EXISTS inventory_imports (
    id TEXT PRIMARY KEY, import_date TEXT, country TEXT, warehouse TEXT, channel TEXT,
    sku_code TEXT, available_qty INTEGER, remark TEXT, snapshot_cutoff_date TEXT,
    brand TEXT, weighted_avg_cost NUMERIC, last_inbound_date TEXT, first_inbound_date TEXT);`);
  d.exec(`CREATE TABLE IF NOT EXISTS wac_history (
    id TEXT PRIMARY KEY, version_no INTEGER, sku_code TEXT, country TEXT, warehouse TEXT,
    confirmation_status TEXT, is_locked INTEGER, new_avg_cost NUMERIC);`);
}
function clearInv() {
  run('DELETE FROM inventory'); run('DELETE FROM inventory_imports'); run('DELETE FROM wac_history');
}
function seedOne(sku, existingWac, fileWac, country = 'Indonesia', wh = 'Bekasi Warehouse', lid = '2026-07-18') {
  run('INSERT INTO inventory (id, sku_code, country, warehouse, available_qty, weighted_avg_cost, last_inbound_date, first_inbound_date) VALUES (?,?,?,?,?,?,?,?)',
    ['inv_' + sku, sku, country, wh, 10, existingWac, lid, lid]);
  run('INSERT INTO inventory_imports (id, import_date, country, warehouse, channel, sku_code, available_qty, remark, snapshot_cutoff_date, brand, weighted_avg_cost, last_inbound_date, first_inbound_date) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
    ['imp_' + sku, '2026-09-13', country, wh, '', sku, 10, '', '2026-09-12', '', fileWac, lid, lid]);
}
function impRow(sku) {
  return queryOne('SELECT sku_code, country, warehouse, available_qty, weighted_avg_cost, last_inbound_date, first_inbound_date FROM inventory WHERE sku_code=?', [sku]);
}
function loopInput(sku, wac, lid = '2026-07-18') {
  return { sku_code: sku, country: 'Indonesia', warehouse: 'Bekasi Warehouse', available_qty: 10, weighted_avg_cost: wac, import_date: '2026-09-13', last_inbound_date: lid, first_inbound_date: lid };
}

test('INT-A: confirmed+locked=999 覆盖 file WAC=57685 → 写入 999（不被 Excel 覆盖）', () => {
  setupSchema(); clearInv();
  seedOne('Arm 30', 57, 57685);
  run('INSERT INTO wac_history (id, version_no, sku_code, country, warehouse, confirmation_status, is_locked, new_avg_cost) VALUES (?,?,?,?,?,?,?,?)',
    ['wac_1', 1, 'Arm 30', 'Indonesia', 'Bekasi Warehouse', 'confirmed', 1, 999]);
  const warnings = [];
  runOriginalInventoryTotalsLoop([loopInput('Arm 30', 57685)], '2026-09-12', warnings);
  assert.strictEqual(Number(impRow('Arm 30').weighted_avg_cost), 999);
  assert.ok(warnings.every(w => !/已保留原成本/.test(w.message)), 'confirmed 路径不应提示保留原成本');
});

test('INT-E: 真实 loop Arm 30 existing=57 file=57685 无 confirmed → 57685（回归修复）', () => {
  setupSchema(); clearInv();
  seedOne('Arm 30', 57, 57685);
  const warnings = [];
  runOriginalInventoryTotalsLoop([loopInput('Arm 30', 57685)], '2026-09-12', warnings);
  assert.strictEqual(Number(impRow('Arm 30').weighted_avg_cost), 57685, '必须采用 Excel 新成本 57685，而非旧 57');
  assert.ok(warnings.every(w => !/已保留原成本/.test(w.message)), '采用 file WAC 不应提示保留原成本');
  assert.strictEqual(impRow('Arm 30').last_inbound_date, '2026-07-18', '入库日期不得 -1 day');
});

test('INT-F: 真实 loop Star MINI existing=211 file=204158 → 204158（回归修复）', () => {
  setupSchema(); clearInv();
  seedOne('Star MINI', 211, 204158);
  const warnings = [];
  runOriginalInventoryTotalsLoop([loopInput('Star MINI', 204158)], '2026-09-12', warnings);
  assert.strictEqual(Number(impRow('Star MINI').weighted_avg_cost), 204158, '必须采用 Excel 新成本 204158，而非旧 211');
  assert.ok(warnings.every(w => !/已保留原成本/.test(w.message)));
});

test('INT-C: 仅更新数量（file WAC 留空）→ 保留 existing 57，不归零，且提示保留原成本', () => {
  setupSchema(); clearInv();
  seedOne('Arm 30', 57, '');
  const warnings = [];
  runOriginalInventoryTotalsLoop([loopInput('Arm 30', '')], '2026-09-12', warnings);
  assert.strictEqual(Number(impRow('Arm 30').weighted_avg_cost), 57, '无 file WAC 必须保留 existing');
  assert.ok(warnings.some(w => /已保留原成本/.test(w.message)), '无 file WAC 应提示保留原成本');
});

test('INT-D: 三者皆无 → 0 且 high 警告（新 SKU 初始化）', () => {
  setupSchema(); clearInv();
  const warnings = [];
  runOriginalInventoryTotalsLoop([loopInput('NEW-SKU', '')], '2026-09-12', warnings);
  const row = impRow('NEW-SKU');
  assert.ok(row, '新 SKU 应被插入');
  assert.strictEqual(Number(row.weighted_avg_cost), 0);
  assert.ok(warnings.some(w => /成本与金额暂为 0/.test(w.message)));
});

// ===========================================================================
// 三、日期 -1 day 修复测试（从 app.js 抽取真实 parseDateStr）
// ===========================================================================
test('DATE-1: 2026/7/18（斜杠文本，Excel 常见）→ 2026-07-18（非 2026-07-17）', () => {
  assert.strictEqual(parseDateStr('2026/7/18'), '2026-07-18');
});

test('DATE-2: 2026/5/18 → 2026-05-18（非 2026-05-17）', () => {
  assert.strictEqual(parseDateStr('2026/5/18'), '2026-05-18');
});

test('DATE-3: 2026-07-18（ISO）→ 2026-07-18', () => {
  assert.strictEqual(parseDateStr('2026-07-18'), '2026-07-18');
});

test('DATE-4: Excel Date 单元格（本地午夜）→ 同一日历日 2026-07-18', () => {
  const d = new Date(2026, 6, 18); // 本地 2026-07-18 00:00
  assert.strictEqual(parseDateStr(d), '2026-07-18');
});

test('DATE-5: 2026.7.18（点分隔）→ 2026-07-18', () => {
  assert.strictEqual(parseDateStr('2026.7.18'), '2026-07-18');
});

test('DATE-6: 绝不允许出现 -1 day', () => {
  assert.notStrictEqual(parseDateStr('2026/7/18'), '2026-07-17');
  assert.notStrictEqual(parseDateStr('2026/5/18'), '2026-05-17');
});

test('DATE-7: 空值 / 非法输入安全返回', () => {
  assert.strictEqual(parseDateStr(''), '');
  assert.strictEqual(parseDateStr(null), '');
  assert.strictEqual(parseDateStr(undefined), '');
  assert.strictEqual(parseDateStr('not-a-date'), '');
});

test('DATE-regression: 正时区下旧实现会 -1 day，新实现不会', () => {
  const inPositiveTz = new Date('2026/7/18').getTimezoneOffset() < 0;
  const oldImpl = (v) => { if (!v) return ''; const d = new Date(v); return !isNaN(d) ? d.toISOString().slice(0, 10) : ''; };
  if (inPositiveTz) {
    assert.strictEqual(oldImpl('2026/7/18'), '2026-07-17', '旧实现在正时区确实 -1 day（回归复现）');
  }
  assert.strictEqual(parseDateStr('2026/7/18'), '2026-07-18', '新实现永远正确');
});

// ===========================================================================
// 四、三条路径一致性静态守卫
// ===========================================================================
test('PARITY: 三条路径共用 resolveImportWac，旧“existing 优先于 file”内联分支已移除', () => {
  const S = fs.readFileSync(__dirname + '/../server.js', 'utf8');
  // 旧 bug 特征：confirmed 之后紧跟 existing 优先（wacSource='existing' 在 file 之前）
  assert.ok(!/else if \(existing && \(existing\.weighted_avg_cost \|\| 0\) !== 0\)/.test(S),
    '不应再存在 existing 优先于 file WAC 的内联分支');
  const calls = (S.match(/resolveImportWac\(/g) || []).length;
  // 1 处定义 + 3 处调用（runOriginalInventoryTotalsLoop / PG fast path / scoped path）
  assert.ok(calls >= 4, 'resolveImportWac 应被定义并至少被 3 处调用，实际出现 ' + calls + ' 次');
});
