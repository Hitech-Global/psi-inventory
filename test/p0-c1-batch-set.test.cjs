'use strict';
/**
 * P0-C1 INVENTORY BATCH-SET — call-count / parity / transaction regression suite
 *
 * 口径统一：
 *   application DB calls = query + queryOne + run
 *   BEGIN / COMMIT / ROLLBACK 单独计数（transaction 包裹次数），不混入 application calls。
 *
 * 驱动分支：
 *   - SQLite 路径：直接跑在真实 :memory: SQLite 上（db.js）。
 *   - PG 路径：本机无 PostgreSQL 服务，用 PG-SIM（把 4 条 jsonb 语句翻译成等价 SQLite
 *     语句执行）驱动 applyInventoryBatchSet 的 PG 分支。
 *     → 可验证：调用次数、调用顺序、payload 语义、业务结果 parity、事务回滚。
 *     → 不可验证：PG 语法本身（本机无 PG 实例），该项由 §22 结构检查 + 与
 *       既有 refreshInventoryTotals 的 jsonb 写法同族来保证。
 */

process.env.DB_DRIVER = 'sqlite';
process.env.DB_PATH = ':memory:';

const { test, describe, before } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const db = require('../db');
db.initDatabase();

// ---------------------------------------------------------------------------
// DB call 计数器 + PG-SIM（必须在 require('./server') 之前替换 db 导出，
// server.js 在模块加载时解构 db 的 query/queryOne/run/transaction）
// ---------------------------------------------------------------------------
const counters = { query: 0, queryOne: 0, run: 0, txBegin: 0, txCommit: 0, txRollback: 0, statements: [] };
const orig = { query: db.query, queryOne: db.queryOne, run: db.run, transaction: db.transaction };

let pgSim = null;        // 非 null 时：拦截 PG 风格 SQL 翻译成 SQLite 执行
let failOn = null;       // 'batch-update' | 'batch-log' —— 注入失败用于回滚测试

function resetCounters() {
  counters.query = 0; counters.queryOne = 0; counters.run = 0;
  counters.txBegin = 0; counters.txCommit = 0; counters.txRollback = 0;
  counters.statements = [];
}
function appCalls() { return counters.query + counters.queryOne + counters.run; }
function norm(sql) { return String(sql).replace(/\s+/g, ' ').trim().slice(0, 90); }

const PGSIM = {
  query(sql, params) {
    const g = db.getDB();
    if (/jsonb_to_recordset\(\$1::jsonb\)\s+AS\s+j\(id text, ord integer\)/.test(sql)) {
      const payload = JSON.parse(params[0]);
      const stmt = g.prepare(`SELECT id, sku_code, country, warehouse, available_qty, weighted_avg_cost,
                                     inventory_status, safety_stock, target_turnover_months
                              FROM inventory WHERE id = ?`);
      const rows = [];
      for (const p of payload) { const r = stmt.get(p.id); if (r) rows.push(r); }
      return { rows };
    }
    if (/jsonb_array_elements_text\(\$1::jsonb\)/.test(sql)) {
      const skus = JSON.parse(params[0]);
      const stmt = g.prepare(`SELECT MAX(order_date) AS d,
                                     COALESCE(SUM(CASE WHEN order_date >= date('now','-90 days') THEN quantity ELSE 0 END), 0) AS qty90
                              FROM sales_records WHERE is_valid_order = 1 AND sku_code = ?`);
      const rows = [];
      for (const s of skus) {
        const r = stmt.get(s);
        if (r && r.d != null) rows.push({ sku_code: s, d: r.d, qty90: r.qty90 });
      }
      return { rows };
    }
    throw new Error('PGSIM: unsupported query -> ' + norm(sql));
  },
  run(sql, params) {
    const g = db.getDB();
    const t = sql.trim();
    let m;
    if ((m = /^UPDATE inventory i\s+SET\s+(\w+)\s*=\s*src\.new_value/.exec(t))) {
      if (failOn === 'batch-update') throw new Error('PGSIM-INJECT: batch update failed');
      const col = m[1];
      const payload = JSON.parse(params[0]);
      const stmt = g.prepare(`UPDATE inventory SET ${col} = ?, updated_at = datetime('now') WHERE id = ?`);
      let changes = 0;
      for (const p of payload) changes += stmt.run(p.new_value, p.id).changes;
      return { changes };
    }
    if (/^INSERT INTO operation_logs/.test(t)) {
      if (failOn === 'batch-log') throw new Error('PGSIM-INJECT: batch log insert failed');
      const payload = JSON.parse(params[0]);
      const stmt = g.prepare(`INSERT INTO operation_logs
        (id, operator_id, operator_name, page, operation_type, target_ids, affected_count,
         old_values, new_values, reason, triggered_recalc, is_rollbackable)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
      let changes = 0;
      for (const p of payload) {
        changes += stmt.run(p.id, p.operator_id, p.operator_name, p.page, p.operation_type,
          p.target_ids, p.affected_count, p.old_values, p.new_values, p.reason,
          p.triggered_recalc, p.is_rollbackable).changes;
      }
      return { changes };
    }
    if (/^UPDATE inventory SET last_outbound_date/.test(t)) {
      return { changes: g.prepare(t).run(...(params || [])).changes };
    }
    if (/^INSERT INTO batch_tasks/.test(t) || /^UPDATE batch_tasks/.test(t)) {
      return { changes: g.prepare(t).run(...(params || [])).changes };
    }
    throw new Error('PGSIM: unsupported run -> ' + norm(t));
  }
};

db.query = function (sql, params) {
  counters.query++; counters.statements.push('query: ' + norm(sql));
  return pgSim ? PGSIM.query(sql, params) : orig.query(sql, params);
};
db.queryOne = function (sql, params) {
  counters.queryOne++; counters.statements.push('queryOne: ' + norm(sql));
  return pgSim ? PGSIM.query(sql, params).rows[0] || null : orig.queryOne(sql, params);
};
db.run = function (sql, params) {
  counters.run++; counters.statements.push('run: ' + norm(sql));
  return pgSim ? PGSIM.run(sql, params) : orig.run(sql, params);
};
db.transaction = function (fn) {
  counters.txBegin++;
  try { const r = orig.transaction(fn); counters.txCommit++; return r; }
  catch (e) { counters.txRollback++; throw e; }
};

const server = require('../server');
const {
  MAX_BATCH_SET_ITEMS, applyInventoryBatchSet,
  computeInventoryDerivedFromFacts, recalcInventoryForSku
} = server;

// ---------------------------------------------------------------------------
// 数据工具
// ---------------------------------------------------------------------------
const G = () => db.getDB();

function resetTables() {
  const g = G();
  g.exec(`DELETE FROM operation_logs; DELETE FROM batch_tasks;
          DELETE FROM inventory; DELETE FROM sales_records;`);
  // 序列一起归零 → 两次 seedScenario 生成完全相同的 id 集合，parity 可比
  invSeq = 0; saleSeq = 0;
}

function iso(d) { return d.toISOString().slice(0, 10); }
function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); }

let invSeq = 0;
function seedInv(o) {
  const g = G();
  const id = o.id || ('inv_' + (++invSeq));
  g.prepare(`INSERT INTO inventory
    (id, sku_code, country, warehouse, available_qty, weighted_avg_cost, inventory_value,
     safety_stock, target_turnover_months, inventory_status, last_outbound_date, turnover_months)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, o.sku, o.country || 'Indonesia', o.warehouse || 'WH-JKT',
    o.available_qty == null ? 0 : o.available_qty,
    o.wac == null ? 0 : o.wac,
    o.inventory_value == null ? 0 : o.inventory_value,
    o.safety_stock == null ? 0 : o.safety_stock,
    o.target_turnover_months == null ? 0 : o.target_turnover_months,
    o.inventory_status || 'normal',
    o.last_outbound_date || '', o.turnover_months == null ? 0 : o.turnover_months);
  return id;
}

let saleSeq = 0;
function seedSale(sku, orderDate, qty, valid) {
  G().prepare(`INSERT INTO sales_records (id, order_no, sku_code, order_date, quantity, is_valid_order, country)
    VALUES (?,?,?,?,?,?,?)`).run(
    'sr_' + (++saleSeq), 'SO-' + (++saleSeq), sku, orderDate, qty,
    valid === 0 ? 0 : 1, 'Indonesia');
}

// 标准场景：n 行、每 dup 行共享一个 business key → U = ceil(n/dup)
function seedScenario(n, dup) {
  resetTables();
  const ids = [];
  for (let i = 0; i < n; i++) {
    const keyIdx = Math.floor(i / dup);
    const sku = 'SKU-' + String(keyIdx).padStart(4, '0');
    ids.push(seedInv({
      sku, country: 'Indonesia', warehouse: 'WH-' + (keyIdx % 3),
      available_qty: 10 + (i % 37),
      wac: 3.5 + (keyIdx % 7),
      safety_stock: 5 + (keyIdx % 4),
      target_turnover_months: 1 + (keyIdx % 5)
    }));
  }
  // 给前若干个 SKU 造销量
  for (let k = 0; k < Math.min(6, Math.ceil(n / dup)); k++) {
    const sku = 'SKU-' + String(k).padStart(4, '0');
    seedSale(sku, daysAgo(5), 12 + k, 1);
    seedSale(sku, daysAgo(30), 30 + k, 1);
    seedSale(sku, daysAgo(200), 99, 1);   // 90 天窗口外
    seedSale(sku, daysAgo(3), 7, 0);      // 无效单
  }
  return ids;
}

function snapshot() {
  const g = G();
  const inv = g.prepare(`SELECT id, sku_code, country, warehouse, available_qty, weighted_avg_cost,
    inventory_value, safety_stock, target_turnover_months, inventory_status,
    last_outbound_date, turnover_months FROM inventory ORDER BY id`).all();
  const logs = g.prepare(`SELECT operation_type, target_ids, affected_count, old_values, new_values,
    reason, triggered_recalc, is_rollbackable FROM operation_logs ORDER BY target_ids, operation_type`).all();
  const tasks = g.prepare(`SELECT task_name, operation_type, total_count, status, success_count,
    failed_count, skipped_count, is_rollbackable FROM batch_tasks ORDER BY task_name`).all();
  return { inv, logs, tasks };
}

const CTX = { currentUserId: 'u_test', currentUserName: 'tester' };

function cfgFor(kind, ids) {
  if (kind === 'status') {
    return { ids, value: 'high_stock', column: 'inventory_status', operationType: 'set_status',
      taskName: '批量设置库存状态', recalcMode: 'none', oldValueKey: 'inventory_status',
      reason: 'r', req: CTX };
  }
  if (kind === 'safety') {
    return { ids, value: 42, column: 'safety_stock', operationType: 'set_safety_stock',
      taskName: '批量设置安全库存', recalcMode: 'status', oldValueKey: 'safety_stock',
      reason: 'r', req: CTX };
  }
  return { ids, value: 3, column: 'target_turnover_months', operationType: 'set_turnover',
    taskName: '批量设置目标周转月数', recalcMode: 'status', oldValueKey: 'target_turnover_months',
    reason: 'r', req: CTX };
}

function runAs(kind, driver, ids) {
  pgSim = (driver === 'pg') ? PGSIM : null;
  process.env.DB_DRIVER = driver;
  resetCounters();
  let res, err = null;
  try { res = applyInventoryBatchSet(cfgFor(kind, ids)); }
  catch (e) { err = e; }
  const snap = { res, err, calls: appCalls(), counters: { ...counters }, stmts: counters.statements.slice() };
  pgSim = null;
  process.env.DB_DRIVER = 'sqlite';
  return snap;
}

// 在两个 driver 上用同一份种子各跑一次，比对业务结果
function parityRun(kind, n, dup) {
  const idsA = seedScenario(n, dup);
  const a = runAs(kind, 'sqlite', idsA);
  const stateA = a.err ? null : snapshot();

  const idsB = seedScenario(n, dup);
  const b = runAs(kind, 'pg', idsB);
  const stateB = b.err ? null : snapshot();

  return { a, b, stateA, stateB, idsA, idsB };
}

// ===========================================================================
describe('P0-C1 batch-set', () => {

  // ---------------------------------------------------------------- §11-12
  test('B/L/M: status call count = 5 for N=10 / 100 / 500 / 2000', () => {
    for (const n of [10, 100, 500, 2000]) {
      const ids = seedScenario(n, 1);
      const r = runAs('status', 'pg', ids);
      assert.strictEqual(r.err, null, 'N=' + n + ' 不应抛错: ' + (r.err && r.err.message));
      assert.strictEqual(r.calls, 5, `N=${n} status application DB calls 应为 5，实际 ${r.calls}`);
      assert.strictEqual(r.counters.queryOne, 0, `N=${n} PG 路径不应出现 queryOne（证明未走逐行/未调 recalc）`);
      assert.strictEqual(r.counters.txBegin, 1, '每请求恰好 1 个 transaction');
      assert.strictEqual(r.counters.txCommit, 1);
      assert.strictEqual(r.res.success, n);
    }
  });

  test('E/F: safety & turnover call count = U + 6', () => {
    // N=500 U=500 → 506
    let ids = seedScenario(500, 1);
    let r = runAs('safety', 'pg', ids);
    assert.strictEqual(r.err, null, r.err && r.err.message);
    assert.strictEqual(r.calls, 506, `N=500 U=500 safety 应为 506，实际 ${r.calls}`);
    assert.strictEqual(r.counters.queryOne, 0);

    r = runAs('turnover', 'pg', seedScenario(500, 1));
    assert.strictEqual(r.calls, 506, `N=500 U=500 turnover 应为 506，实际 ${r.calls}`);

    // N=500 U=250 → 256
    ids = seedScenario(500, 2);
    r = runAs('safety', 'pg', ids);
    assert.strictEqual(r.err, null, r.err && r.err.message);
    assert.strictEqual(r.calls, 256, `N=500 U=250 safety 应为 256，实际 ${r.calls}`);

    r = runAs('turnover', 'pg', seedScenario(500, 2));
    assert.strictEqual(r.calls, 256, `N=500 U=250 turnover 应为 256，实际 ${r.calls}`);
  });

  // ---------------------------------------------------------------- §1-4
  test('A: status small batch parity (PG vs SQLite)', () => {
    const { a, b, stateA, stateB } = parityRun('status', 12, 1);
    assert.strictEqual(a.err, null, a.err && a.err.message);
    assert.strictEqual(b.err, null, b.err && b.err.message);
    assert.deepStrictEqual(stateB.inv, stateA.inv, 'inventory 最终状态应与 SQLite 逐行路径一致');
    assert.deepStrictEqual(stateB.logs, stateA.logs, 'operation_logs 应与 SQLite 逐行路径完全一致');
    assert.strictEqual(stateB.logs.length, 12, '12 行 → 12 条审计日志');
    assert.deepStrictEqual(stateB.tasks, stateA.tasks);
  });

  test('C: safety small batch parity (PG vs SQLite)', () => {
    const { a, b, stateA, stateB } = parityRun('safety', 12, 1);
    assert.strictEqual(a.err, null, a.err && a.err.message);
    assert.strictEqual(b.err, null, b.err && b.err.message);
    assert.deepStrictEqual(stateB.inv, stateA.inv, 'safety 派生列重算结果应与旧逐行 recalc 一致');
    assert.deepStrictEqual(stateB.logs, stateA.logs);
    assert.strictEqual(stateB.logs.length, 12);
  });

  test('D: turnover small batch parity (PG vs SQLite)', () => {
    const { a, b, stateA, stateB } = parityRun('turnover', 12, 1);
    assert.strictEqual(a.err, null, a.err && a.err.message);
    assert.strictEqual(b.err, null, b.err && b.err.message);
    assert.deepStrictEqual(stateB.inv, stateA.inv, 'turnover 派生列重算结果应与旧逐行 recalc 一致');
    assert.deepStrictEqual(stateB.logs, stateA.logs);
    assert.strictEqual(stateB.logs.length, 12);
  });

  // ---------------------------------------------------------------- §4
  test('G: duplicate business key — N=8 U=4, 同 key 所有行派生列一致且与旧逻辑一致', () => {
    const { a, b, stateA, stateB } = parityRun('safety', 8, 2);
    assert.strictEqual(b.err, null, b.err && b.err.message);
    assert.deepStrictEqual(stateB.inv, stateA.inv, '重复 business key 下 PG 结果应与 SQLite 逐行一致');

    // 同一 (sku,country,warehouse) 的所有行，派生列必须完全一致
    const byKey = new Map();
    for (const r of stateB.inv) {
      const k = r.sku_code + '\0' + r.country + '\0' + r.warehouse;
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push(r);
    }
    assert.strictEqual(byKey.size, 4, 'U 应为 4');
    for (const [, rows] of byKey) {
      assert.strictEqual(rows.length, 2);
      for (const col of ['last_outbound_date', 'turnover_months', 'inventory_value', 'inventory_status']) {
        assert.strictEqual(rows[0][col], rows[1][col],
          `同 business key 的 ${col} 必须一致（不能退化成 WHERE id=? 只更新一行）`);
      }
    }
    // N/U 放大倍率：逐 key 更新次数 = U（不是 N）
    const recalcUpdates = b.stmts.filter(s => s.indexOf('UPDATE inventory SET last_outbound_date') >= 0).length;
    assert.strictEqual(recalcUpdates, 4, `重复 key 场景下派生列 UPDATE 应为 U=4 次，实际 ${recalcUpdates}`);
  });

  test('R: safety/turnover 派生列 UPDATE 次数 = U（不是 N）', () => {
    const ids = seedScenario(300, 3);   // N=300 U=100
    const r = runAs('turnover', 'pg', ids);
    const recalcUpdates = r.stmts.filter(s => s.indexOf('UPDATE inventory SET last_outbound_date') >= 0).length;
    assert.strictEqual(recalcUpdates, 100, `U=100，实际 ${recalcUpdates}`);
    assert.strictEqual(r.calls, 106, `U+6=106，实际 ${r.calls}`);
  });

  // ---------------------------------------------------------------- §6
  test('H: duplicate IDs in input — 每个出现各计一次 success、各写一条 log', () => {
    const dup = ['inv_1', 'inv_2', 'inv_1', 'inv_3', 'inv_1'];   // 5 次出现，3 个唯一
    const a = runAs('status', 'sqlite', seedScenario(4, 1) && dup);
    assert.strictEqual(a.err, null);
    assert.strictEqual(a.res.success, 5, 'SQLite: 重复 id 每个出现各计一次 success');

    seedScenario(4, 1);
    const b = runAs('status', 'pg', dup);
    assert.strictEqual(b.err, null, b.err && b.err.message);
    assert.strictEqual(b.res.success, 5, 'PG: 重复 id 每个出现各计一次 success');

    // 两个 driver 的日志内容必须一致
    const logsB = G().prepare('SELECT target_ids, old_values, new_values FROM operation_logs ORDER BY target_ids, rowid').all();
    assert.strictEqual(logsB.length, 5, '重复 id 应写 5 条审计日志（不合并）');
    assert.strictEqual(logsB.filter(l => JSON.parse(l.target_ids)[0] === 'inv_1').length, 3);
    assert.strictEqual(logsB.filter(l => JSON.parse(l.target_ids)[0] === 'inv_2').length, 1);
    assert.strictEqual(logsB.filter(l => JSON.parse(l.target_ids)[0] === 'inv_3').length, 1);
  });

  test('M: log parity — 每条记录字段与旧 logOperation 一致', () => {
    const ids = seedScenario(3, 1);
    runAs('safety', 'pg', ids);
    const logs = G().prepare('SELECT * FROM operation_logs ORDER BY rowid').all();
    assert.strictEqual(logs.length, 3);
    for (const l of logs) {
      assert.strictEqual(l.operator_id, 'u_test');
      assert.strictEqual(l.operator_name, 'tester');
      assert.strictEqual(l.page, 'inventory');
      assert.strictEqual(l.operation_type, 'set_safety_stock');
      assert.strictEqual(l.affected_count, 1);
      assert.strictEqual(l.reason, 'r');
      assert.strictEqual(l.triggered_recalc, 1);
      assert.strictEqual(l.is_rollbackable, 1);
      assert.strictEqual(JSON.stringify(JSON.parse(l.target_ids).length), '1');
      const nv = JSON.parse(l.new_values);
      assert.deepStrictEqual(Object.keys(nv), ['safety_stock']);
      assert.strictEqual(nv.safety_stock, 42);
      const ov = JSON.parse(l.old_values);
      assert.deepStrictEqual(Object.keys(ov), ['safety_stock']);
    }
  });

  // ---------------------------------------------------------------- §1
  test('I: missing inventory id → skipped=1 + 记录不存在', () => {
    const ids = seedScenario(3, 1);
    const withMissing = [ids[0], 'inv_does_not_exist', ids[1]];
    const r = runAs('status', 'pg', withMissing);
    assert.strictEqual(r.err, null, r.err && r.err.message);
    assert.strictEqual(r.res.success, 2);
    assert.strictEqual(r.res.skipped, 1);
    assert.deepStrictEqual(r.res.errors, [{ id: 'inv_does_not_exist', reason: '记录不存在' }]);
  });

  test('J: empty ids → helper 抛「未选择记录」（端点层先于 helper 返回 400）', () => {
    assert.throws(() => applyInventoryBatchSet(cfgFor('status', [])), /未选择记录/);
  });

  // ---------------------------------------------------------------- §9
  test('K: ids.length > MAX_BATCH_SET_ITEMS(2000) → 400 文案，且零写入', () => {
    assert.strictEqual(MAX_BATCH_SET_ITEMS, 2000);
    const ids = seedScenario(10, 1);
    const tooMany = [];
    for (let i = 0; i < 2001; i++) tooMany.push('inv_' + i);
    const before = snapshot();
    let caught = null;
    try { applyInventoryBatchSet(cfgFor('status', tooMany)); } catch (e) { caught = e; }
    assert.ok(caught, '超过 2000 必须抛错，禁止静默截断');
    assert.strictEqual(caught.message, '最多可批量操作 2000 条，当前选择 2001 条。');
    const after = snapshot();
    assert.deepStrictEqual(after.inv, before.inv, '超限必须零写入');
    assert.deepStrictEqual(after.logs, before.logs);
    assert.strictEqual(after.tasks.length, before.tasks.length, '超限不应创建 batch task');
  });

  test('L: ids.length === 2000 → 允许', () => {
    seedScenario(2000, 1);
    const ids = G().prepare('SELECT id FROM inventory').all().map(r => r.id);
    assert.strictEqual(ids.length, 2000);
    const r = runAs('status', 'pg', ids);
    assert.strictEqual(r.err, null, r.err && r.err.message);
    assert.strictEqual(r.res.success, 2000);
    assert.strictEqual(r.calls, 5, 'N=2000 仍是常数 5');
  });

  // ---------------------------------------------------------------- §7 / §0
  test('N: 事务内 SQL 失败 → 全部回滚，无残留写入', () => {
    seedScenario(20, 1);
    const before = snapshot();
    const ids = G().prepare('SELECT id FROM inventory').all().map(r => r.id);
    failOn = 'batch-update';
    let caught = null;
    pgSim = PGSIM; process.env.DB_DRIVER = 'pg'; resetCounters();
    try { applyInventoryBatchSet(cfgFor('safety', ids)); } catch (e) { caught = e; }
    const rollbackCount = counters.txRollback;
    pgSim = null; failOn = null; process.env.DB_DRIVER = 'sqlite';

    assert.ok(caught, '注入失败必须抛出');
    assert.strictEqual(rollbackCount, 1, '应恰好回滚 1 次');
    const after = snapshot();
    assert.deepStrictEqual(after.inv, before.inv, 'inventory 必须完全回滚');
    assert.deepStrictEqual(after.logs, before.logs, 'operation_logs 必须完全回滚');
  });

  test('O: PG batch 失败 → 明确 error，且旧逐行 helper 未被调用', () => {
    seedScenario(50, 1);
    const ids = G().prepare('SELECT id FROM inventory').all().map(r => r.id);
    failOn = 'batch-update';
    const r = runAs('safety', 'pg', ids);
    failOn = null;
    assert.ok(r.err, '必须抛出明确错误');
    assert.ok(/PGSIM-INJECT/.test(r.err.message), '错误信息应透传底层原因: ' + r.err.message);
    assert.ok(!/fallback/i.test(r.err.message), '不应出现 fallback 语义');
    // 旧逐行路径的标志：queryOne('SELECT * FROM inventory WHERE id=?') 逐行调用
    assert.strictEqual(r.counters.queryOne, 0,
      'PG 失败后绝不可回退旧逐行路径（queryOne 出现即证明回退了）');
    assert.ok(r.calls <= 4, `失败路径 DB calls 应 ≤ 4，实际 ${r.calls}`);
  });

  test('边界：全部 id 都不存在时的 DB-call 下限（无 UPDATE / 无 log 写入）', () => {
    seedScenario(3, 1);
    const r = runAs('safety', 'pg', ['inv_nope_1', 'inv_nope_2']);
    assert.strictEqual(r.err, null, r.err && r.err.message);
    assert.strictEqual(r.res.success, 0);
    assert.strictEqual(r.res.skipped, 2);
    // 1 lookup + createBatchTask + finishBatchTask = 3（批量 UPDATE / 销售聚合 / 批量 log 全部跳过）
    assert.strictEqual(r.calls, 3, `零命中时下限应为 3，实际 ${r.calls}`);
    assert.strictEqual(G().prepare('SELECT COUNT(*) c FROM operation_logs').get().c, 0);
  });

  test('Q: status 路径不触发 recalc（无 queryOne、无 last_outbound_date UPDATE）', () => {
    const ids = seedScenario(100, 1);
    const r = runAs('status', 'pg', ids);
    assert.strictEqual(r.err, null);
    assert.strictEqual(r.counters.queryOne, 0, 'status 不应调用任何 queryOne（recalc 用 queryOne）');
    assert.strictEqual(r.stmts.filter(s => s.indexOf('last_outbound_date') >= 0).length, 0,
      'status 不应重算 last_outbound_date / turnover_months / inventory_value');
    assert.strictEqual(r.stmts.filter(s => s.indexOf('sales_records') >= 0).length, 0,
      'status 不应查询 sales_records');
  });

  // ---------------------------------------------------------------- §8
  test('P: SQLite regression — 旧逐行路径语义不变', () => {
    const ids = seedScenario(9, 1);
    const r = runAs('safety', 'sqlite', ids);
    assert.strictEqual(r.err, null, r.err && r.err.message);
    assert.strictEqual(r.res.success, 9);
    assert.strictEqual(r.res.skipped, 0);
    // 旧逐行公式：1 lookup + 1 update + recalc(4) + 1 log = 7N，+2 = create/finishBatchTask
    assert.strictEqual(r.calls, 7 * 9 + 2, `SQLite 逐行路径应仍是 7N+2=65，实际 ${r.calls}`);
    assert.strictEqual(r.counters.txBegin, 1);
    assert.strictEqual(r.counters.txCommit, 1);
    const logs = G().prepare('SELECT COUNT(*) c FROM operation_logs').get().c;
    assert.strictEqual(logs, 9);

    const st = runAs('status', 'sqlite', seedScenario(9, 1));
    // SQLite 上 status 同样不再 recalc（与 PG 保持 parity）→ 1+1+1 = 3N + 2
    assert.strictEqual(st.calls, 3 * 9 + 2, `SQLite status 应为 3N+2=29，实际 ${st.calls}`);
  });

  // ---------------------------------------------------------------- §2
  test('computeInventoryDerivedFromFacts 与 recalcInventoryForSku 逐字段等价', () => {
    const combos = [];
    for (const available of [0, 1, 7, 50, 999]) {
      for (const wac of [0, null, 0.005, 12.345, 100]) {
        for (const safety of [0, null, 5]) {
          for (const target of [0, null, 1, 3, 6]) {
            combos.push({ available, wac, safety, target });
          }
        }
      }
    }
    let checked = 0;
    for (let ci = 0; ci < combos.length; ci += 7) {   // 抽样，覆盖各分支
      const c = combos[ci];
      for (const salesQty of [0, 12, 100]) {
        resetTables();
        const sku = 'SKU-T' + ci + '-' + salesQty;
        if (salesQty > 0) { seedSale(sku, daysAgo(5), salesQty, 1); seedSale(sku, daysAgo(200), 500, 1); }
        seedInv({ sku, country: 'ID', warehouse: 'W1', available_qty: c.available, wac: c.wac,
          safety_stock: c.safety, target_turnover_months: c.target });

        // 真实旧逻辑
        recalcInventoryForSku(sku, 'ID', 'W1');
        const actual = G().prepare('SELECT * FROM inventory WHERE id = (SELECT MIN(id) FROM inventory)').get();

        // 新逻辑（facts 由同一组 SQL 聚合得来）
        resetTables();
        if (salesQty > 0) { seedSale(sku, daysAgo(5), salesQty, 1); seedSale(sku, daysAgo(200), 500, 1); }
        seedInv({ sku, country: 'ID', warehouse: 'W1', available_qty: c.available, wac: c.wac,
          safety_stock: c.safety, target_turnover_months: c.target });
        const d = (function () {
          pgSim = null; process.env.DB_DRIVER = 'sqlite'; resetCounters();
          const lo = orig.queryOne(`SELECT MAX(order_date) as d FROM sales_records WHERE sku_code=? AND is_valid_order=1`, [sku]);
          const s90 = orig.queryOne(`SELECT COALESCE(SUM(quantity),0) as qty FROM sales_records WHERE sku_code=? AND is_valid_order=1 AND order_date >= date('now','-90 days')`, [sku]);
          return { lo, s90 };
        })();
        const row = G().prepare('SELECT available_qty, weighted_avg_cost, safety_stock, target_turnover_months FROM inventory').get();
        const derived = computeInventoryDerivedFromFacts(row, 'inventory_status', undefined,
          { d: d.lo && d.lo.d, qty90: d.s90 && d.s90.qty });
        G().prepare(`UPDATE inventory SET last_outbound_date=?, turnover_months=?, inventory_status=?, inventory_value=? WHERE sku_code=? AND country=? AND warehouse=?`)
          .run(derived.lastOutboundDate, derived.turnover, derived.autoStatus, derived.inventoryValue, sku, 'ID', 'W1');
        const expected = G().prepare('SELECT * FROM inventory WHERE id = (SELECT MIN(id) FROM inventory)').get();

        assert.strictEqual(expected.last_outbound_date, actual.last_outbound_date, `last_outbound_date @${JSON.stringify(c)}/${salesQty}`);
        assert.strictEqual(expected.turnover_months, actual.turnover_months, `turnover_months @${JSON.stringify(c)}/${salesQty}`);
        assert.strictEqual(expected.inventory_status, actual.inventory_status, `inventory_status @${JSON.stringify(c)}/${salesQty}`);
        assert.strictEqual(Number(expected.inventory_value), Number(actual.inventory_value), `inventory_value @${JSON.stringify(c)}/${salesQty}`);
        checked++;
      }
    }
    assert.ok(checked >= 30, '等价性样本数应 ≥ 30，实际 ' + checked);
  });
});

// ===========================================================================
describe('P0-C1 structural guards', () => {
  const SRC = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

  function routeBlock(sig) {
    const i = SRC.indexOf(sig);
    assert.ok(i >= 0, '找不到路由: ' + sig);
    // 取到下一个 app.post/app.get 为止
    const next = SRC.indexOf('\napp.', i + sig.length);
    return SRC.slice(i, next > 0 ? next : i + 4000);
  }

  test('三个 endpoint 都在调用 applyInventoryBatchSet（共用 helper）', () => {
    for (const sig of [
      "app.post('/api/inventory/batch-set-status'",
      "app.post('/api/inventory/batch-set-safety-stock'",
      "app.post('/api/inventory/batch-set-turnover'"
    ]) {
      const b = routeBlock(sig);
      assert.ok(/applyInventoryBatchSet\(/.test(b), sig + ' 应调用共享 helper');
      assert.ok(!/transaction\(\(\)\s*=>/.test(b), sig + ' 路由内不应再有 transaction（已收敛进 helper）');
      assert.ok(!/ids\.forEach/.test(b), sig + ' 路由内不应再有逐行循环');
    }
  });

  test('三个 endpoint 都带 MAX_BATCH_SET_ITEMS 400 护栏（不静默截断）', () => {
    for (const sig of [
      "app.post('/api/inventory/batch-set-status'",
      "app.post('/api/inventory/batch-set-safety-stock'",
      "app.post('/api/inventory/batch-set-turnover'"
    ]) {
      const b = routeBlock(sig);
      assert.ok(/ids\.length > MAX_BATCH_SET_ITEMS/.test(b), sig + ' 缺少条数上限校验');
      assert.ok(/res\.status\(400\)\.json\(\{ error: `最多可批量操作/.test(b), sig + ' 缺少明确 400 文案');
      assert.ok(!/\.slice\(0,\s*MAX_BATCH_SET_ITEMS\)/.test(b), sig + ' 禁止静默截断');
    }
  });

  test('PG 路径无 fallback 到旧逐行 helper', () => {
    const i = SRC.indexOf('function applyInventoryBatchSetPg');
    const j = SRC.indexOf('function applyInventoryBatchSet(');
    const body = SRC.slice(i, j);
    assert.ok(!/applyInventoryBatchSetRowByRow/.test(body), 'PG 路径内不得调用旧逐行 helper');
    assert.ok(!/catch\s*\(/.test(body), 'PG 路径内不得有 try/catch 兜底');
  });

  test('helper 内 transaction 回调为同步函数（无 async / await）', () => {
    for (const fn of ['function applyInventoryBatchSetPg', 'function applyInventoryBatchSetRowByRow']) {
      const i = SRC.indexOf(fn);
      const j = SRC.indexOf('\nfunction ', i + fn.length);
      const body = SRC.slice(i, j > 0 ? j : i + 4000);
      assert.ok(/transaction\(\(\)\s*=>/.test(body), fn + ' 应使用同步 transaction 回调');
      assert.ok(!/transaction\(async/.test(body), fn + ' 禁止 async 事务回调');
      assert.ok(!/await /.test(body), fn + ' 禁止 await');
      assert.ok(!/updateInventoryTransitData/.test(body), fn + ' 禁止事务内 transit refresh');
    }
  });

  test('PG 批量 SQL 不使用「几千个 WHERE id IN (?,?,...)」拼参', () => {
    const sqls = [server.pgBatchSetLookupSql(), server.pgBatchSetUpdateSql('safety_stock', 'integer'),
      server.pgSalesFactsSql(), server.pgBatchLogInsertSql()];
    for (const s of sqls) {
      assert.ok(/\$1::jsonb/.test(s), '应使用单个 jsonb 参数，避免 parameter explosion');
      assert.strictEqual((s.match(/\$\d+/g) || []).length, 1, '只允许 1 个绑定参数');
    }
    assert.ok(/UPDATE inventory i[\s\S]*FROM jsonb_to_recordset/.test(server.pgBatchSetUpdateSql('safety_stock', 'integer')));
  });
});
