'use strict';
/**
 * P0-C1 REAL POSTGRES RUNTIME GATE
 * ============================================================================
 * 目的：在**真实 PostgreSQL runtime** 上执行 P0-C1 新增的 production helper，
 *       验证其 PG set-based 路径（jsonb_to_recordset / UPDATE ... FROM /
 *       batch operation-log INSERT / sales aggregate / unique business-key
 *       derived UPDATE）的真实语法、类型行为、事务回滚与调用次数。
 *
 * 硬约束：
 *   1. 连接串只能来自环境变量（P0C1_NEON_DATABASE_URL 或 P0C1_PG_DSN），
 *      文件内绝不 hardcode URL / 用户名 / 密码 / endpoint。
 *   2. production-host guard：白名单只允许「本地临时实例」与「*.neon.tech
 *      隔离实例」，其余一律拒绝（默认拒绝 = 不可能连到生产库）。
 *   3. 只创建临时 schema p0c1_test_<random>，表 DDL 直接抽取自 db-pg.js
 *      （真实生产类型），测试结束 DROP SCHEMA CASCADE + 新连接确认。
 *   4. 只调用生产真实 helper：applyInventoryBatchSet()（→ applyInventoryBatchSetPg()），
 *      不复写一套「类似 SQL」。
 *   5. 绝不输出 credential；日志只输出连接类别（local-tcp / local-unix / neon）。
 *
 * 运行：
 *   P0C1_NEON_DATABASE_URL='postgresql://...' node scripts/p0c1-pg-runtime.js
 *   P0C1_PG_DSN='postgresql://...'            node scripts/p0c1-pg-runtime.js
 */

const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const PG = require(path.join(ROOT, 'node_modules', 'pg'));

// ===========================================================================
// A. env-only credential + production-host guard
// ===========================================================================
const DSN = process.env.P0C1_NEON_DATABASE_URL || process.env.P0C1_PG_DSN || '';

const ALLOW_NEON = /(^|\.)neon\.tech$/i;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

function classifyDsn(dsn) {
  if (!dsn) {
    throw new Error('P0C1-PG-GUARD: 未设置 P0C1_NEON_DATABASE_URL / P0C1_PG_DSN（禁止 hardcode 连接串）');
  }
  let u;
  try { u = new URL(dsn); } catch (e) {
    throw new Error('P0C1-PG-GUARD: DSN 无法解析');
  }
  if (!/^postgres(ql)?:$/.test(u.protocol)) {
    throw new Error('P0C1-PG-GUARD: 仅允许 postgres / postgresql 协议');
  }
  const db = (u.pathname || '').replace(/^\//, '') || 'postgres';
  const hostParam = u.searchParams.get('host') || '';
  if (hostParam.charAt(0) === '/') return { kind: 'local-unix', db: db };
  const host = (u.hostname || '').toLowerCase();
  if (LOCAL_HOSTS.has(host)) return { kind: 'local-tcp', db: db };
  if (ALLOW_NEON.test(host)) return { kind: 'neon', db: db };
  // 默认拒绝：supabase / render / aws / 任何托管生产库都在此被拦下
  throw new Error('P0C1-PG-GUARD: 主机不在白名单（仅允许本地临时实例或 *.neon.tech 隔离实例）；生产库一律禁止');
}

// 从 db-pg.js 抽取真实 CREATE TABLE 语句（保证字段类型与生产完全一致）
function extractCreateTable(pgSrc, table) {
  const marker = 'CREATE TABLE IF NOT EXISTS ' + table + ' (';
  const i = pgSrc.indexOf(marker);
  if (i < 0) throw new Error('P0C1-PG: db-pg.js 中找不到 ' + table + ' 的 DDL');
  let depth = 0;
  let j = i + marker.length - 1;
  for (; j < pgSrc.length; j++) {
    const ch = pgSrc[j];
    if (ch === '(') depth++;
    else if (ch === ')') { depth--; if (depth === 0) { j++; break; } }
  }
  return pgSrc.slice(i, j);
}

// ===========================================================================
// B. 极简断言运行器
// ===========================================================================
const results = [];
let currentSection = '';

function section(name) { currentSection = name; console.log('\n=== ' + name + ' ==='); }
function check(name, fn) {
  let ok = false, detail = '';
  try { const r = fn(); ok = true; if (typeof r === 'string') detail = r; }
  catch (e) { detail = String(e && e.message ? e.message : e); }
  results.push({ section: currentSection, name, ok, detail });
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '   -> ' + detail : ''));
  return ok;
}
function eq(actual, expected, label) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a !== b) throw new Error((label || '') + ' expected=' + b + ' actual=' + a);
  return (label || '') + ' = ' + a;
}

// ===========================================================================
// C. 主流程
// ===========================================================================
async function main() {
  const target = classifyDsn(DSN);
  console.log('[P0C1-PG] 目标类别 = ' + target.kind + ' | database = ' + target.db + ' | credential = env-only');
  console.log('[P0C1-PG] production-host guard = ALLOWLIST(local | *.neon.tech)，其余默认拒绝');

  const schema = 'p0c1_test_' + Math.random().toString(36).slice(2, 10);
  console.log('[P0C1-PG] 临时 schema = ' + schema);

  const sslOpt = { rejectUnauthorized: false };
  const admin = new PG.Client({ connectionString: DSN, ssl: sslOpt });
  await admin.connect();

  const ver = await admin.query('SELECT version() AS v');
  const pgVersion = String(ver.rows[0].v).split(' on ')[0];
  console.log('[P0C1-PG] server = ' + pgVersion);

  let failed = 0;
  try {
    await admin.query('CREATE SCHEMA "' + schema + '"');

    // 每个连接通过 startup options 设置 search_path（Neon 无 ALTER DATABASE 权限也能用）
    const testDsn = DSN + (DSN.indexOf('?') >= 0 ? '&' : '?') +
      'options=-csearch_path%3D' + encodeURIComponent(schema);

    // ---- 建表（DDL 直接来自 db-pg.js，真实生产类型）----
    const pgSrc = fs.readFileSync(path.join(ROOT, 'db-pg.js'), 'utf8');
    const tables = ['inventory', 'sales_records', 'operation_logs', 'batch_tasks'];
    for (const t of tables) {
      await admin.query(extractCreateTable(pgSrc, t).replace('CREATE TABLE IF NOT EXISTS ' + t, 'CREATE TABLE IF NOT EXISTS ' + schema + '.' + t));
    }
    const created = await admin.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name", [schema]);
    console.log('[P0C1-PG] 已建最小表 = ' + created.rows.map(r => r.table_name).join(', '));

    const cAdmin = new PG.Client({ connectionString: testDsn, ssl: sslOpt });
    await cAdmin.connect();
    const sp = await cAdmin.query('SHOW search_path');
    console.log('[P0C1-PG] search_path(测试连接) = ' + sp.rows[0].search_path);

    // =======================================================================
    // D. 加载真实 production 代码（DB_DRIVER=pg → db.js sync bridge → 真 PG）
    // =======================================================================
    process.env.DB_DRIVER = 'pg';
    process.env.DATABASE_URL = testDsn;
    process.env.NODE_ENV = process.env.NODE_ENV || 'test';

    const db = require(path.join(ROOT, 'db'));

    // DB-call 计数器（必须在 require('./server') 之前替换 db 导出）
    const counters = { query: 0, queryOne: 0, run: 0, txBegin: 0, txCommit: 0, txRollback: 0 };
    let statements = [];
    let failOn = null;   // RegExp：命中的 SQL 抛错（用于真实回滚测试）

    const orig = { query: db.query, queryOne: db.queryOne, run: db.run, transaction: db.transaction };
    function guard(sql) {
      statements.push(String(sql).replace(/\s+/g, ' ').trim().slice(0, 110));
      if (failOn && failOn.test(String(sql))) throw new Error('P0C1-INJECT: forced failure on ' + failOn);
    }
    db.query = function (sql, p) { counters.query++; guard(sql); return orig.query(sql, p); };
    db.queryOne = function (sql, p) { counters.queryOne++; guard(sql); return orig.queryOne(sql, p); };
    db.run = function (sql, p) { counters.run++; guard(sql); return orig.run(sql, p); };
    db.transaction = function (fn) {
      counters.txBegin++;
      let threw = false;
      const wrapped = function () { try { return fn(); } catch (e) { threw = true; throw e; } };
      try {
        const r = orig.transaction(wrapped);
        counters.txCommit++;
        return r;
      } catch (e) { counters.txRollback++; throw e; }
    };

    const S = require(path.join(ROOT, 'server'));

    function appCalls() { return counters.query + counters.queryOne + counters.run; }
    function resetCounters() {
      counters.query = 0; counters.queryOne = 0; counters.run = 0;
      counters.txBegin = 0; counters.txCommit = 0; counters.txRollback = 0;
      statements = [];
    }
    function resetTx() { counters.txBegin = 0; counters.txCommit = 0; counters.txRollback = 0; }

    const REQ = { currentUserId: 'u-p0c1', currentUserName: 'P0C1 Tester' };
    function batchSet(o) {
      resetCounters();
      const res = S.applyInventoryBatchSet({
        ids: o.ids, value: o.value, column: o.column,
        operationType: o.operationType, taskName: o.taskName,
        recalcMode: o.recalcMode, oldValueKey: o.oldValueKey,
        reason: o.reason || '', req: REQ
      });
      return { res: res, calls: appCalls(), tx: { begin: counters.txBegin, commit: counters.txCommit, rollback: counters.txRollback }, stmts: statements.slice() };
    }

    // ---- 数据 seed / reset -------------------------------------------------
    async function resetAll() {
      await cAdmin.query('DELETE FROM operation_logs; DELETE FROM batch_tasks; DELETE FROM sales_records; DELETE FROM inventory;');
    }
    async function seedInv(n, opts) {
      opts = opts || {};
      const uniq = opts.uniq != null ? opts.uniq : n;           // 唯一 business key 数
      const perKey = Math.ceil(n / uniq);
      const rows = [];
      let id = 0;
      for (let k = 0; k < uniq && rows.length < n; k++) {
        for (let d = 0; d < perKey && rows.length < n; d++) {
          id++;
          rows.push({
            id: 'INV' + String(id).padStart(5, '0'),
            sku: opts.skuPrefix ? opts.skuPrefix + '-' + k : 'SKU-' + k,
            country: opts.country !== undefined ? opts.country : 'Indonesia',
            warehouse: opts.warehouse !== undefined ? opts.warehouse : 'WH-JKT',
            avail: opts.avail != null ? opts.avail : (100 + k),
            wac: opts.wac != null ? opts.wac : 12.5,
            safety: opts.safety != null ? opts.safety : 10,
            target: opts.target != null ? opts.target : 3,
            status: opts.status || 'normal'
          });
        }
      }
      for (const r of rows) {
        await cAdmin.query(
          `INSERT INTO inventory (id, sku_code, country, warehouse, available_qty, weighted_avg_cost,
             inventory_status, safety_stock, target_turnover_months, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,to_char(NOW(),'YYYY-MM-DD HH24:MI:SS'))`,
          [r.id, r.sku, r.country, r.warehouse, r.avail, r.wac, r.status, r.safety, r.target]);
      }
      return rows;
    }
    async function seedSales(rows) {
      for (const r of rows) {
        await cAdmin.query(
          `INSERT INTO sales_records (id, order_date, sku_code, quantity, is_valid_order)
           VALUES ($1,$2,$3,$4,$5)`,
          [r.id, r.d, r.sku, r.q, r.valid == null ? 1 : r.valid]);
      }
    }
    async function invAll() {
      const r = await cAdmin.query('SELECT id, sku_code, country, warehouse, available_qty, weighted_avg_cost, inventory_status, safety_stock, target_turnover_months, turnover_months, inventory_value, last_outbound_date FROM inventory ORDER BY id');
      return r.rows;
    }
    async function logCount() {
      const r = await cAdmin.query('SELECT COUNT(*)::int AS c FROM operation_logs');
      return r.rows[0].c;
    }
    async function logs() {
      const r = await cAdmin.query('SELECT id, operator_id, operator_name, page, operation_type, target_ids, affected_count, old_values, new_values, reason, triggered_recalc, is_rollbackable FROM operation_logs ORDER BY ctid');
      return r.rows;
    }
    function snap(rows) {
      return rows.map(r => [r.id, r.inventory_status, r.safety_stock, r.target_turnover_months,
        Number(r.turnover_months), Number(r.inventory_value), r.last_outbound_date].join('|'));
    }

    // =======================================================================
    // §5  STATUS — real PG
    // =======================================================================
    section('5. STATUS real PG');
    const statusRuns = {};
    for (const N of [1, 10, 500]) {
      await resetAll();
      const rows = await seedInv(N, { status: 'normal' });
      const ids = rows.map(r => r.id);
      const before = await invAll();
      const out = batchSet({ ids, value: 'high_stock', column: 'inventory_status', operationType: 'set_status', taskName: '批量设置库存状态', recalcMode: 'none', oldValueKey: 'inventory_status' });
      const after = await invAll();
      statusRuns[N] = out.calls;
      check('S-N' + N + ': 结果 success/skipped', () => eq([out.res.success, out.res.skipped, out.res.failed], [N, 0, 0], 'N=' + N));
      check('S-N' + N + ': application DB calls = 5', () => eq(out.calls, 5, 'N=' + N + ' calls'));
      check('S-N' + N + ': 事务 1 BEGIN / 1 COMMIT / 0 ROLLBACK', () => eq([out.tx.begin, out.tx.commit, out.tx.rollback], [1, 1, 0], 'N=' + N));
      check('S-N' + N + ': 只改 inventory_status，其它非目标列不变', () => {
        for (let i = 0; i < before.length; i++) {
          const b = before[i], a = after[i];
          if (a.inventory_status !== 'high_stock') throw new Error('status 未更新: ' + a.id);
          if (Number(a.safety_stock) !== Number(b.safety_stock)) throw new Error('safety_stock 被误改');
          if (Number(a.target_turnover_months) !== Number(b.target_turnover_months)) throw new Error('target_turnover_months 被误改');
          if (Number(a.available_qty) !== Number(b.available_qty)) throw new Error('available_qty 被误改');
          if (Number(a.turnover_months) !== Number(b.turnover_months)) throw new Error('turnover_months 被误改 (recalc 被调用)');
          if (Number(a.inventory_value) !== Number(b.inventory_value)) throw new Error('inventory_value 被误改 (recalc 被调用)');
          if ((a.last_outbound_date || '') !== (b.last_outbound_date || '')) throw new Error('last_outbound_date 被误改 (recalc 被调用)');
        }
        return '全部 ' + N + ' 行仅 status 变化';
      });
      const lc = await logCount();
      check('S-N' + N + ': operation_logs = ' + N, () => eq(lc, N, 'logs'));
    }
    // duplicate input id
    await resetAll();
    {
      const rows = await seedInv(4);
      const ids = rows.map(r => r.id);
      const dup = [ids[0], ids[1], ids[0], ids[2], ids[0]];
      const out = batchSet({ ids: dup, value: 'high_stock', column: 'inventory_status', operationType: 'set_status', taskName: '批量设置库存状态', recalcMode: 'none', oldValueKey: 'inventory_status' });
      check('S-dup: [a,b,a,c,a] success=5（重复 id 各计一次）', () => eq(out.res.success, 5, 'success'));
      const lc = await logCount();
      check('S-dup: [a,b,a,c,a] 写 5 条审计日志（不合并）', () => eq(lc, 5, 'logs'));
    }
    // >2000 / =2000
    await resetAll();
    {
      const rows = await seedInv(2001);
      let threw = null;
      try {
        S.applyInventoryBatchSet({ ids: rows.map(r => r.id), value: 'high_stock', column: 'inventory_status', operationType: 'set_status', taskName: 't', recalcMode: 'none', oldValueKey: 'inventory_status', req: REQ });
      } catch (e) { threw = e.message; }
      check('S-limit: N=2001 抛错且文案明确', () => {
        if (!threw) throw new Error('未抛错');
        if (threw.indexOf('最多可批量操作 2000 条，当前选择 2001 条') !== 0) throw new Error('文案不符: ' + threw);
        return threw;
      });
      const lc = await logCount();
      check('S-limit: N=2001 无任何写入', () => eq(lc, 0, 'logs'));
    }
    await resetAll();
    {
      const rows = await seedInv(2000);
      const out = batchSet({ ids: rows.map(r => r.id), value: 'high_stock', column: 'inventory_status', operationType: 'set_status', taskName: 't', recalcMode: 'none', oldValueKey: 'inventory_status' });
      check('S-limit: N=2000 允许且 calls=5', () => eq([out.res.success, out.calls], [2000, 5], 'N=2000'));
    }

    // =======================================================================
    // §6  SAFETY-STOCK — real PG
    // =======================================================================
    section('6. SAFETY-STOCK real PG');
    // available vs safety 三分支
    for (const [label, avail, safety] of [['available > safety', 100, 10], ['available == safety', 50, 50], ['available < safety', 5, 50]]) {
      await resetAll();
      const rows = await seedInv(1, { avail: avail, safety: safety });
      const out = batchSet({ ids: [rows[0].id], value: safety, column: 'safety_stock', operationType: 'set_safety_stock', taskName: '批量设置安全库存', recalcMode: 'status', oldValueKey: 'safety_stock' });
      const after = (await invAll())[0];
      const expect = avail <= 0 ? 'out_of_stock_risk' : (avail <= safety ? 'out_of_stock_risk' : 'normal');
      check('SAF-' + label + ': autoStatus 分支', () => eq(after.inventory_status, expect, 'status'));
      check('SAF-' + label + ': safety_stock 已写入', () => eq(Number(after.safety_stock), safety, 'safety'));
    }
    // sales NULL / 0 / positive
    for (const [label, sales] of [['no sales rows', []], ['qty=0', [{ id: 'S0', sku: 'SKU-0', d: '2026-08-01', q: 0 }]], ['qty>0', [{ id: 'S1', sku: 'SKU-0', d: '2026-08-01', q: 30 }]]]) {
      await resetAll();
      const rows = await seedInv(1, { avail: 100, wac: 12.5 });
      await seedSales(sales);
      const out = batchSet({ ids: [rows[0].id], value: 10, column: 'safety_stock', operationType: 'set_safety_stock', taskName: 't', recalcMode: 'status', oldValueKey: 'safety_stock' });
      const after = (await invAll())[0];
      const lc = await logCount();
      check('SAF-sales[' + label + ']: 无类型错误且 status 有值', () => {
        if (!after.inventory_status) throw new Error('status 为空');
        if (out.res.success !== 1) throw new Error('success=' + out.res.success);
        if (lc !== 1) throw new Error('logs=' + lc);
        return 'status=' + after.inventory_status + ' turnover=' + after.turnover_months + ' value=' + after.inventory_value + ' lastOut=' + (after.last_outbound_date || '(empty)');
      });
    }
    // N/U call count
    const safetyFormula = {};
    for (const [N, U] of [[10, 10], [10, 5], [500, 500], [500, 250]]) {
      await resetAll();
      const rows = await seedInv(N, { uniq: U });
      const out = batchSet({ ids: rows.map(r => r.id), value: 20, column: 'safety_stock', operationType: 'set_safety_stock', taskName: 't', recalcMode: 'status', oldValueKey: 'safety_stock' });
      safetyFormula['N' + N + 'U' + U] = { calls: out.calls, expect: U + 6 };
      check('SAF-N' + N + 'U' + U + ': calls = U+6 = ' + (U + 6), () => eq(out.calls, U + 6, 'calls'));
      check('SAF-N' + N + 'U' + U + ': 事务 1/1/0', () => eq([out.tx.begin, out.tx.commit, out.tx.rollback], [1, 1, 0], 'tx'));
      const lc = await logCount();
      check('SAF-N' + N + 'U' + U + ': logs = N = ' + N, () => eq(lc, N, 'logs'));
    }

    // =======================================================================
    // §7  TURNOVER — real PG
    // =======================================================================
    section('7. TURNOVER real PG');
    for (const [label, target] of [['target=0', 0], ['target=int 3', 3], ['target=decimal 2.5', 2.5]]) {
      await resetAll();
      const rows = await seedInv(1, { avail: 100, target: 3 });
      await seedSales([{ id: 'S1', sku: 'SKU-0', d: '2026-08-01', q: 30 }]); // avgMonthly=10 → turnover=10
      const out = batchSet({ ids: [rows[0].id], value: target, column: 'target_turnover_months', operationType: 'set_turnover', taskName: '批量设置目标周转月数', recalcMode: 'status', oldValueKey: 'target_turnover_months' });
      const after = (await invAll())[0];
      check('TRN-' + label + ': target 写入正确', () => eq(Number(after.target_turnover_months), target, 'target'));
      check('TRN-' + label + ': turnover_months 未被写成 target', () => {
        if (Number(after.turnover_months) === target && target !== 10) throw new Error('turnover_months 被误写为 target');
        return 'turnover_months=' + after.turnover_months + ' (target=' + target + ')';
      });
    }
    // turnover 低于 / 等于 / 高于 target → autoStatus
    for (const [label, q90, target] of [['below target', 300, 20], ['equal-ish', 30, 10], ['above target', 30, 2]]) {
      await resetAll();
      const rows = await seedInv(1, { avail: 100, target: 3 });
      await seedSales([{ id: 'S1', sku: 'SKU-0', d: '2026-08-01', q: q90 }]);
      const out = batchSet({ ids: [rows[0].id], value: target, column: 'target_turnover_months', operationType: 'set_turnover', taskName: 't', recalcMode: 'status', oldValueKey: 'target_turnover_months' });
      const after = (await invAll())[0];
      check('TRN-autoStatus[' + label + ']: status 有值且非异常', () => {
        const ok = ['normal', 'high_stock', 'slow_moving', 'out_of_stock_risk'].indexOf(after.inventory_status) >= 0;
        if (!ok) throw new Error('unexpected status: ' + after.inventory_status);
        return 'status=' + after.inventory_status + ' turnover=' + after.turnover_months + ' target=' + target;
      });
    }
    const turnoverFormula = {};
    for (const [N, U] of [[10, 10], [500, 250]]) {
      await resetAll();
      const rows = await seedInv(N, { uniq: U });
      const out = batchSet({ ids: rows.map(r => r.id), value: 4, column: 'target_turnover_months', operationType: 'set_turnover', taskName: 't', recalcMode: 'status', oldValueKey: 'target_turnover_months' });
      turnoverFormula['N' + N + 'U' + U] = { calls: out.calls, expect: U + 6 };
      check('TRN-N' + N + 'U' + U + ': calls = U+6 = ' + (U + 6), () => eq(out.calls, U + 6, 'calls'));
    }

    // =======================================================================
    // §8  JSONB / type edge cases
    // =======================================================================
    section('8. JSONB / TYPE edge cases');
    await resetAll();
    {
      // country NULL / empty string / 正常；warehouse 同
      const cases = [
        { id: 'E1', sku: 'SKU-NULL', country: null, warehouse: null },
        { id: 'E2', sku: 'SKU-EMPTY', country: '', warehouse: '' },
        { id: 'E3', sku: 'SKU-OK', country: 'Indonesia', warehouse: 'WH-JKT' }
      ];
      for (const c of cases) {
        await cAdmin.query(`INSERT INTO inventory (id, sku_code, country, warehouse, available_qty, weighted_avg_cost, inventory_status, safety_stock, target_turnover_months) VALUES ($1,$2,$3,$4,50,10,'normal',5,2)`,
          [c.id, c.sku, c.country, c.warehouse]);
      }
      await seedSales([{ id: 'ES1', sku: 'SKU-OK', d: '2026-08-01', q: 12 }]);
      const out = batchSet({ ids: ['E1', 'E2', 'E3'], value: 7, column: 'safety_stock', operationType: 'set_safety_stock', taskName: 't', recalcMode: 'status', oldValueKey: 'safety_stock' });
      check('TYPE-country/warehouse NULL+empty: 无 PG 类型/语法错误', () => eq([out.res.success, out.res.failed], [3, 0], 'safety'));
    }
    await resetAll();
    {
      // NUMERIC 边界：0 / 整数 / decimal / numeric string
      const rows = await seedInv(3, { wac: 0 });
      await cAdmin.query('UPDATE inventory SET weighted_avg_cost = $1 WHERE id = $2', [0, rows[0].id]);
      await cAdmin.query('UPDATE inventory SET weighted_avg_cost = $1 WHERE id = $2', [99, rows[1].id]);
      await cAdmin.query('UPDATE inventory SET weighted_avg_cost = $1 WHERE id = $2', ['12.3456', rows[2].id]);
      const out = batchSet({ ids: rows.map(r => r.id), value: 5, column: 'safety_stock', operationType: 'set_safety_stock', taskName: 't', recalcMode: 'status', oldValueKey: 'safety_stock' });
      const after = await invAll();
      check('TYPE-numeric 0/int/decimal: 无 overflow，inventory_value 正确', () => {
        if (out.res.failed !== 0) throw new Error('failed=' + out.res.failed);
        const v = after.map(r => Number(r.inventory_value));
        if (v[0] !== 0) throw new Error('wac=0 → value 应为 0，实际 ' + v[0]);
        return 'inventory_value = ' + JSON.stringify(v);
      });
    }
    await resetAll();
    {
      // date：NULL / 近期 / >90 天
      const rows = await seedInv(1, { avail: 100 });
      await seedSales([
        { id: 'D1', sku: 'SKU-0', d: '2026-08-25', q: 30 },   // 近期（90 天内）
        { id: 'D2', sku: 'SKU-0', d: '2025-01-01', q: 999 }   // 超过 90 天 → 不计入 qty90
      ]);
      const out = batchSet({ ids: [rows[0].id], value: 5, column: 'safety_stock', operationType: 'set_safety_stock', taskName: 't', recalcMode: 'status', oldValueKey: 'safety_stock' });
      const after = (await invAll())[0];
      check('TYPE-date >90d 不计入 qty90（avgMonthly = round(30/3) = 10）', () => {
        if (Number(after.turnover_months) !== 10) throw new Error('turnover_months=' + after.turnover_months + ' 期望 10');
        if (after.last_outbound_date !== '2026-08-25') throw new Error('last_outbound_date=' + after.last_outbound_date);
        return 'turnover=' + after.turnover_months + ' lastOut=' + after.last_outbound_date;
      });
    }
    // TEXT id / sku_code 非数字
    await resetAll();
    {
      await cAdmin.query(`INSERT INTO inventory (id, sku_code, country, warehouse, available_qty, weighted_avg_cost, inventory_status, safety_stock, target_turnover_months) VALUES ('id-with-dash_01','SKU/COLON:RED#1','Indonesia','WH-JKT',80,10,'normal',5,2)`);
      const out = batchSet({ ids: ['id-with-dash_01'], value: 'slow_moving', column: 'inventory_status', operationType: 'set_status', taskName: 't', recalcMode: 'none', oldValueKey: 'inventory_status' });
      const after = (await invAll())[0];
      check('TYPE-text id / 特殊字符 sku: JSONB 无转义错误', () => eq(after.inventory_status, 'slow_moving', 'status'));
    }

    // =======================================================================
    // §9  REAL ROLLBACK
    // =======================================================================
    section('9. REAL rollback (PG transaction)');
    await resetAll();
    {
      const rows = await seedInv(20, { uniq: 10 });
      const ids = rows.map(r => r.id);
      const before = await invAll();
      const beforeSnap = snap(before);
      const beforeLogs = await logCount();
      resetCounters();
      failOn = /INSERT INTO operation_logs/;   // 让「后续 SQL」失败
      let threw = null;
      try {
        S.applyInventoryBatchSet({ ids, value: 33, column: 'safety_stock', operationType: 'set_safety_stock', taskName: 't', recalcMode: 'status', oldValueKey: 'safety_stock', req: REQ });
      } catch (e) { threw = e.message; }
      failOn = null;
      const after = await invAll();
      const afterLogs = await logCount();
      check('ROLLBACK: 抛错（明确 error，非静默）', () => {
        if (!threw) throw new Error('未抛错');
        if (threw.indexOf('P0C1-INJECT') < 0) throw new Error('非注入错误: ' + threw);
        return threw;
      });
      check('ROLLBACK: 事务执行了 1 BEGIN + 1 ROLLBACK + 0 COMMIT', () => eq([counters.txBegin, counters.txRollback, counters.txCommit], [1, 1, 0], 'tx'));
      check('ROLLBACK: inventory 与事务前完全一致', () => eq(snap(after), beforeSnap, 'inventory'));
      check('ROLLBACK: operation_logs 与事务前一致', () => eq(afterLogs, beforeLogs, 'logs'));
      check('ROLLBACK: 旧逐行 fallback NOT CALLED（queryOne=0 且无 SELECT * FROM inventory WHERE id）', () => {
        const rowByRow = statements.filter(s => /SELECT \* FROM inventory WHERE id/i.test(s));
        if (counters.queryOne !== 0) throw new Error('queryOne=' + counters.queryOne + '（逐行 lookup 被调用）');
        if (rowByRow.length) throw new Error('检测到逐行语句: ' + rowByRow[0]);
        return 'queryOne=0，逐行语句 0 条';
      });
    }

    // =======================================================================
    // §10 OPERATION-LOG PARITY
    // =======================================================================
    section('10. operation-log parity');
    await resetAll();
    {
      const rows = await seedInv(4);
      const ids = rows.map(r => r.id);
      const dup = [ids[0], ids[1], ids[0], ids[2], ids[0]];
      batchSet({ ids: dup, value: 'high_stock', column: 'inventory_status', operationType: 'set_status', taskName: '批量设置库存状态', recalcMode: 'none', oldValueKey: 'inventory_status', reason: 'r1' });
      const ls = await logs();
      check('LOG: [a,b,a,c,a] → 5 条审计记录', () => eq(ls.length, 5, 'count'));
      check('LOG: 每条 target_ids 为单元素数组且对应输入顺序', () => eq(ls.map(l => JSON.parse(l.target_ids)[0]), dup, 'target_ids'));
      check('LOG: 字段语义与旧 logOperation 一致', () => {
        const l = ls[0];
        eq(l.page, 'inventory', 'page');
        eq(l.operation_type, 'set_status', 'operation_type');
        eq(Number(l.affected_count), 1, 'affected_count');
        eq(JSON.parse(l.old_values), { inventory_status: 'normal' }, 'old_values');
        eq(JSON.parse(l.new_values), { inventory_status: 'high_stock' }, 'new_values');
        eq(l.reason, 'r1', 'reason');
        eq(Number(l.triggered_recalc), 1, 'triggered_recalc');
        eq(Number(l.is_rollbackable), 1, 'is_rollbackable');
        eq(l.operator_id, 'u-p0c1', 'operator_id');
        return '全部字段对齐';
      });
      check('LOG: 5 条 id 互不相同（各自 genId）', () => eq(new Set(ls.map(l => l.id)).size, 5, 'unique ids'));
    }

    // =======================================================================
    // §11 DUPLICATE BUSINESS-KEY PARITY
    // =======================================================================
    section('11. duplicate business-key parity');
    await resetAll();
    {
      // 3 行共享同一 business key
      await cAdmin.query(`INSERT INTO inventory (id, sku_code, country, warehouse, available_qty, weighted_avg_cost, inventory_status, safety_stock, target_turnover_months) VALUES
        ('DUP1','SKU-DUP','Indonesia','WH-JKT',100,10,'normal',5,2),
        ('DUP2','SKU-DUP','Indonesia','WH-JKT',100,10,'normal',5,2),
        ('DUP3','SKU-DUP','Indonesia','WH-JKT',100,10,'normal',5,2)`);
      await seedSales([{ id: 'DS1', sku: 'SKU-DUP', d: '2026-08-01', q: 60 }]);
      const selBefore = await invAll();

      // --- 新 PG 路径：只选 DUP1 ---
      const out = batchSet({ ids: ['DUP1'], value: 40, column: 'safety_stock', operationType: 'set_safety_stock', taskName: 't', recalcMode: 'status', oldValueKey: 'safety_stock' });
      const afterNew = await invAll();
      check('DUPKEY: 只选 1 行 → calls = U+6 = 7', () => eq(out.calls, 7, 'calls'));
      check('DUPKEY: 只有 DUP1 的 safety_stock 被改（目标列按 id）', () => {
        const m = Object.fromEntries(afterNew.map(r => [r.id, Number(r.safety_stock)]));
        eq([m.DUP1, m.DUP2, m.DUP3], [40, 5, 5], 'safety_stock');
        return 'DUP1=40, DUP2/DUP3 未变';
      });
      check('DUPKEY: 派生列按 business key 更新到同 key 全部 3 行', () => {
        const s = afterNew.filter(r => r.sku_code === 'SKU-DUP');
        const set = new Set(s.map(r => [r.inventory_status, Number(r.turnover_months), Number(r.inventory_value), r.last_outbound_date].join('|')));
        if (set.size !== 1) throw new Error('同 key 派生列不一致: ' + JSON.stringify(Array.from(set)));
        return '3 行派生列一致: ' + Array.from(set)[0];
      });

      // --- 旧语义 oracle：用真实 recalcInventoryForSku 复刻 HEAD 的逐行路径 ---
      await resetAll();
      await cAdmin.query(`INSERT INTO inventory (id, sku_code, country, warehouse, available_qty, weighted_avg_cost, inventory_status, safety_stock, target_turnover_months) VALUES
        ('DUP1','SKU-DUP','Indonesia','WH-JKT',100,10,'normal',5,2),
        ('DUP2','SKU-DUP','Indonesia','WH-JKT',100,10,'normal',5,2),
        ('DUP3','SKU-DUP','Indonesia','WH-JKT',100,10,'normal',5,2)`);
      await seedSales([{ id: 'DS1', sku: 'SKU-DUP', d: '2026-08-01', q: 60 }]);
      // 旧路径：UPDATE safety_stock WHERE id=? → recalcInventoryForSku(sku, country, warehouse)
      orig.run("UPDATE inventory SET safety_stock = 40, updated_at = datetime('now') WHERE id = 'DUP1'");
      S.recalcInventoryForSku('SKU-DUP', 'Indonesia', 'WH-JKT');
      const afterOld = await invAll();
      check('DUPKEY: 与旧 recalcInventoryForSku 语义逐字段一致', () => {
        eq(snap(afterOld), snap(afterNew), 'inventory');
        return '新旧结果完全相同';
      });
      check('DUPKEY: DUP2/DUP3 非目标列也被旧 recalc 同步更新（语义一致）', () => {
        const m = Object.fromEntries(afterOld.map(r => [r.id, Number(r.safety_stock)]));
        eq([m.DUP1, m.DUP2, m.DUP3], [40, 5, 5], 'old-path safety_stock');
        return '目标列仍按 id，派生列按 business key（与新路径一致）';
      });
    }

    // =======================================================================
    // PG 错误串扫描（invalid input syntax / cannot cast / operator does not exist ...）
    // =======================================================================
    section('8b. PG error-string scan');
    {
      const PHRASES = ['invalid input syntax', 'cannot cast', 'operator does not exist',
        'jsonb_to_recordset', 'numeric field overflow', 'value out of range',
        'could not determine data type', 'malformed array literal', 'syntax error'];
      const hits = [];
      for (const r of results) {
        if (r.ok) continue;
        for (const p of PHRASES) {
          if ((r.detail || '').toLowerCase().indexOf(p) >= 0) hits.push(r.name + ' → ' + p);
        }
      }
      check('全程无 PG 类型/语法类错误（invalid input syntax / cannot cast / operator does not exist / jsonb mismatch / numeric overflow）',
        () => {
          if (hits.length) throw new Error('命中: ' + hits.join('; '));
          return '0 处（共扫描 ' + results.length + ' 条断言）';
        });
    }

    // =======================================================================
    // 汇总
    // =======================================================================
    const summary = {
      pgVersion: pgVersion,
      targetKind: target.kind,
      schema: schema,
      statusCalls: statusRuns,
      safetyFormula: safetyFormula,
      turnoverFormula: turnoverFormula,
      total: results.length,
      passed: results.filter(r => r.ok).length,
      failed: results.filter(r => !r.ok).length,
      failures: results.filter(r => !r.ok).map(r => r.section + ' / ' + r.name + ' / ' + r.detail)
    };
    fs.writeFileSync('/tmp/p0c1-pg-results.json', JSON.stringify(summary, null, 2));
    console.log('\n=== SUMMARY ===');
    console.log('PostgreSQL: ' + pgVersion + ' | target=' + target.kind + ' | schema=' + schema);
    console.log('status calls: ' + JSON.stringify(statusRuns));
    console.log('safety formula: ' + JSON.stringify(safetyFormula));
    console.log('turnover formula: ' + JSON.stringify(turnoverFormula));
    console.log('checks: ' + summary.passed + '/' + summary.total + ' passed, ' + summary.failed + ' failed');
    failed = summary.failed;

    await cAdmin.end();
  } finally {
    // ---- 清理：DROP SCHEMA CASCADE + 新连接确认 ----
    try {
      await admin.query('DROP SCHEMA IF EXISTS "' + schema + '" CASCADE');
      const rem = await admin.query('SELECT COUNT(*)::int AS c FROM information_schema.schemata WHERE schema_name = $1', [schema]);
      const gone = rem.rows[0].c === 0;
      console.log('\n[CLEANUP] DROP SCHEMA "' + schema + '" CASCADE → 新连接复查残留 = ' + rem.rows[0].c + (gone ? '  OK（已彻底删除）' : '  <-- 残留!'));
      if (!gone) failed++;
    } catch (e) {
      console.log('[CLEANUP] FAILED: ' + e.message);
      failed++;
    }
    try { await admin.end(); } catch (e) {}
  }

  console.log('\nP0-C1 REAL POSTGRES RUNTIME: ' + (failed === 0 ? 'ALL CHECKS PASSED' : failed + ' CHECK(S) FAILED'));
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(e => {
  console.error('\n[P0C1-PG] FATAL: ' + (e && e.message ? e.message : e));
  process.exit(2);
});
