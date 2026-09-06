#!/usr/bin/env node
/**
 * Wave 0B —— 真实 PostgreSQL 并发 refresh 正确性证明（不是 SQLite 模拟）。
 *
 * 背景：Wave 0B 把 inventory 在途三列的全表刷新从「同步桥 Atomics.wait」改为
 * 「原生 async PG 单事务（BEGIN → 6 条 SQL → COMMIT）」，并由 23 个 mutation hook
 * 以 after-COMMIT fire-and-forget 方式触发。由此产生并发正确性问题：
 * 两个 refresh 交错时会不会留下 partial / stale 的 inventory 在途值？
 *
 * 本脚本用真实 PostgreSQL 实例回答：
 *   Q1 第 1 条 `UPDATE inventory SET in_transit_qty = 0`（无 WHERE，全表）
 *      是否会拿到足够的 row lock，使第二个 refresh 事务在相同行上等待？
 *   Q2 被阻塞方在对方 COMMIT 后继续执行时，READ COMMITTED 下后续语句是否看到最新 source facts？
 *   Q3 两个 refresh 无论谁先开始，最后完成者是否根据当时已提交事实重算完整三列？
 *   Q4 两边 6 条 SQL 访问顺序完全一致时，是否只是 wait/serialize 而不是 deadlock？
 *
 * 用法（连接串只能来自环境变量，硬编码一律拒绝）：
 *   W0B_PG_DSN='postgresql://postgres@127.0.0.1:55433/postgres' node scripts/wave0b-pg-concurrency.js
 *
 * 主机白名单：仅 localhost / 127.0.0.1 / ::1 —— 生产库一律拒绝。
 */
'use strict';

const PG = require('pg');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DSN = process.env.W0B_PG_DSN || '';

// ---------------------------------------------------------------------------
// 0. 连接串守卫（与 p0c1-pg-runtime 同款：env-only + 主机白名单）
// ---------------------------------------------------------------------------
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
function classifyDsn(dsn) {
  if (!dsn) throw new Error('W0B-PG-GUARD: 未设置 W0B_PG_DSN（禁止 hardcode 连接串）');
  let u;
  try { u = new URL(dsn); } catch (e) { throw new Error('W0B-PG-GUARD: 连接串非法'); }
  if (!LOCAL_HOSTS.has(u.hostname)) {
    throw new Error('W0B-PG-GUARD: 主机不在白名单（仅允许本地临时实例）；生产库一律禁止: ' + u.hostname);
  }
  return { host: u.hostname, db: u.pathname.replace(/^\//, '') };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// 1. 极简断言运行器
// ---------------------------------------------------------------------------
const results = [];
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { results.push({ ok: true, name }); console.log('  PASS  ' + name); })
    .catch((e) => { results.push({ ok: false, name, err: e && e.message }); console.log('  FAIL  ' + name + '\n        ' + (e && e.message)); });
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function eq(actual, expected, label) {
  if (String(actual) !== String(expected)) throw new Error(`${label}: expected ${expected}, got ${actual}`);
}

// ---------------------------------------------------------------------------
// 2. DDL 抽取（真实生产类型，直接来自 db-pg.js，禁止手写）
// ---------------------------------------------------------------------------
function extractAllCreateTables(pgSrc) {
  const out = [];
  const re = /CREATE TABLE IF NOT EXISTS ([a-z_0-9]+) \(/g;
  let m;
  while ((m = re.exec(pgSrc))) {
    const start = m.index;
    let depth = 0;
    let j = start + m[0].length - 1;
    for (; j < pgSrc.length; j++) {
      const ch = pgSrc[j];
      if (ch === '(') depth++;
      else if (ch === ')') { depth--; if (depth === 0) { j++; break; } }
    }
    out.push({ table: m[1], ddl: pgSrc.slice(start, j) });
  }
  return out;
}

async function main() {
  const target = classifyDsn(DSN);
  console.log('[W0B-PG] target = ' + target.host + ' / db = ' + target.db + ' (credential: env-only)');

  const sslOpt = { rejectUnauthorized: false };
  const admin = new PG.Client({ connectionString: DSN, ssl: sslOpt });
  await admin.connect();
  const ver = await admin.query('SELECT version() AS v');
  console.log('[W0B-PG] server = ' + String(ver.rows[0].v).split(' on ')[0]);

  const schema = 'w0b_test_' + Math.random().toString(36).slice(2, 10);
  console.log('[W0B-PG] temp schema = ' + schema);

  let failed = 0;
  try {
    await admin.query('CREATE SCHEMA "' + schema + '"');
    const testDsn = DSN + (DSN.indexOf('?') >= 0 ? '&' : '?') +
      'options=-csearch_path%3D' + encodeURIComponent(schema);

    // ---- 建全部表（DDL 来自 db-pg.js，真实生产类型）----
    const pgSrc = fs.readFileSync(path.join(ROOT, 'db-pg.js'), 'utf8');
    const tables = extractAllCreateTables(pgSrc);
    let created = 0;
    const createErrs = [];
    for (const t of tables) {
      try {
        await admin.query(t.ddl.replace('CREATE TABLE IF NOT EXISTS ' + t.table, 'CREATE TABLE IF NOT EXISTS "' + schema + '".' + t.table));
        created++;
      } catch (e) { createErrs.push(t.table + ': ' + String(e.message).slice(0, 80)); }
    }
    console.log('[W0B-PG] tables created = ' + created + ' / ' + tables.length);
    if (createErrs.length) console.log('[W0B-PG] 建表失败（不影响本次并发证明用到的表）: ' + createErrs.join(' | '));

    // 迁移列补齐：db-pg.js 基础 DDL 之后的线上迁移列（真实生产由 db.js 迁移列表添加）
    for (const col of [
      'ALTER TABLE packing_lists ADD COLUMN IF NOT EXISTS logistics_batch_id TEXT',
      "ALTER TABLE commercial_invoices ADD COLUMN IF NOT EXISTS target_warehouse TEXT DEFAULT ''",
      "ALTER TABLE proforma_invoices ADD COLUMN IF NOT EXISTS target_warehouse TEXT DEFAULT ''",
      "ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS target_warehouse TEXT DEFAULT ''"
    ]) {
      try { await admin.query(col.replace('TABLE ', 'TABLE "' + schema + '".')); } catch (e) { /* 已存在 */ }
    }

    // -----------------------------------------------------------------------
    // 3. 加载真实生产代码（DB_DRIVER=pg → 真 PG；拿到真实 SQL 与真实 async 函数）
    // -----------------------------------------------------------------------
    process.env.DB_DRIVER = 'pg';
    process.env.DATABASE_URL = testDsn;
    process.env.NODE_ENV = process.env.NODE_ENV || 'test';
    const S = require(path.join(ROOT, 'server'));
    const SQLS = S.TRANSIT_PG_REFRESH_SQLS;
    const refresh = S.updateInventoryTransitDataAsync;
    if (!Array.isArray(SQLS) || SQLS.length !== 6) throw new Error('TRANSIT_PG_REFRESH_SQLS 缺失或不是 6 条');
    console.log('[W0B-PG] TRANSIT_PG_REFRESH_SQLS = ' + SQLS.length + ' 条（真实生产常量）');

    const c = new PG.Client({ connectionString: testDsn, ssl: sslOpt });
    await c.connect();

    // -----------------------------------------------------------------------
    // 4. fixture
    // -----------------------------------------------------------------------
    const SK = 'ID', WH = 'WH1';
    async function resetAll() {
      await c.query(`DELETE FROM packing_list_items; DELETE FROM packing_lists; DELETE FROM logistics_batches;
                     DELETE FROM commercial_invoice_items; DELETE FROM commercial_invoices;
                     DELETE FROM proforma_invoice_items; DELETE FROM proforma_invoices;
                     DELETE FROM purchase_order_items; DELETE FROM purchase_orders;
                     DELETE FROM inventory;`);
    }
    async function seed(sku) {
      await c.query(`INSERT INTO inventory (id, sku_code, country, warehouse, available_qty, in_transit_qty, pi_confirmed_unshipped_qty, po_unconfirmed_pi_qty)
                     VALUES ($1,$2,$3,$4,0,0,0,0)`, ['inv_' + sku, sku, SK, WH]);
    }
    async function seedCI(id, sku, shipped) {
      await c.query(`INSERT INTO commercial_invoices (id, ci_no, ci_status, country, target_warehouse, ci_date, actual_ship_date, payment_term_id, credit_days, ops_owner_id, ops_plan_listing_date, ops_ready_status)
                     VALUES ($1,$2,'uploaded',$3,$4,'2026-08-01','2026-08-01','','0','','2026-08-01','')`, [id, 'CI-' + id, SK, WH]);
      await c.query(`INSERT INTO commercial_invoice_items (id, ci_id, ci_no, sku_code, shipped_qty) VALUES ($1,$2,$3,$4,$5)`, ['cii_' + id, id, 'CI-' + id, sku, shipped]);
    }
    async function seedBatch(id, ciId, sku, arrived, status) {
      await c.query(`INSERT INTO logistics_batches (id, batch_no, related_ci_id, related_ci_no, logistics_status) VALUES ($1,$2,$3,$4,$5)`,
        [id, 'LOG-' + id, ciId, 'CI-' + ciId, status]);
      await c.query(`INSERT INTO packing_lists (id, pl_no, related_ci_id, related_ci_no, logistics_batch_id) VALUES ($1,$2,$3,$4,$5)`,
        ['pl_' + id, 'PL-' + id, ciId, 'CI-' + ciId, id]);
      await c.query(`INSERT INTO packing_list_items (id, pl_id, pl_no, sku_code, total_qty) VALUES ($1,$2,$3,$4,$5)`,
        ['pli_' + id, 'pl_' + id, 'PL-' + id, sku, arrived]);
    }
    async function seedPI(id, sku, confirmed, shipped, status) {
      await c.query(`INSERT INTO proforma_invoices (id, pi_no, pi_status, country, target_warehouse, pi_date) VALUES ($1,$2,$3,$4,$5,'2026-08-01')`, [id, 'PI-' + id, status || 'uploaded', SK, WH]);
      await c.query(`INSERT INTO proforma_invoice_items (id, pi_id, pi_no, sku_code, pi_confirmed_qty, shipped_qty) VALUES ($1,$2,$3,$4,$5,$6)`,
        ['pii_' + id, id, 'PI-' + id, sku, confirmed, shipped]);
    }
    async function seedPO(id, sku, poQty, transferred, status) {
      await c.query(`INSERT INTO purchase_orders (id, po_no, po_status, country, target_warehouse, po_date) VALUES ($1,$2,$3,$4,$5,'2026-08-01')`, [id, 'PO-' + id, status || 'draft', SK, WH]);
      await c.query(`INSERT INTO purchase_order_items (id, po_id, po_no, sku_code, po_qty, transferred_pi_qty) VALUES ($1,$2,$3,$4,$5,$6)`,
        ['poi_' + id, id, 'PO-' + id, sku, poQty, transferred]);
    }
    async function row(sku) {
      const r = await c.query('SELECT in_transit_qty, pi_confirmed_unshipped_qty, po_unconfirmed_pi_qty FROM inventory WHERE sku_code=$1 AND country=$2 AND warehouse=$3', [sku, SK, WH]);
      return r.rows[0] || {};
    }
    const num = (v) => Number(v || 0);

    // =======================================================================
    // P1 —— Q1/Q2/Q3 决定性证明：锁阻塞 + 陈旧覆盖反证
    // =======================================================================
    console.log('\n=== P1 锁阻塞 + READ COMMITTED 新鲜读 + 后完成者胜出（决定性证明） ===');

    await resetAll();
    await seed('SKU-P1');
    await seedCI('ci_p1', 'SKU-P1', 100);
    await seedBatch('lb_p1', 'ci_p1', 'SKU-P1', 40, 'pending');
    await refresh();
    eq(num((await row('SKU-P1')).in_transit_qty), 100, 'P1 baseline（pending 未抵减）');

    {
      const c1 = new PG.Client({ connectionString: testDsn, ssl: sslOpt }); await c1.connect();
      const c2 = new PG.Client({ connectionString: testDsn, ssl: sslOpt }); await c2.connect();
      const c3 = new PG.Client({ connectionString: testDsn, ssl: sslOpt }); await c3.connect();
      try {
        // c1 开事务，只跑第 1 条（全表清零）→ 持有 inventory 全部行锁
        await c1.query('BEGIN');
        await c1.query(SQLS[0]);
        // c1 再跑第 2 条（in_transit 重算），快照仍为 mutation 前 → 写入“旧值 100”
        await c1.query(SQLS[1]);

        // c2 开事务，跑第 1 条 → 必须在 c1 的行锁上等待
        await c2.query('BEGIN');
        let s0done = false, s0elapsed = 0;
        const t0 = Date.now();
        const pS0 = c2.query(SQLS[0]).then(() => { s0done = true; s0elapsed = Date.now() - t0; });
        await sleep(600);

        await check('Q1: 第二个 refresh 的第 1 条全表 UPDATE 被第一个 refresh 的行锁阻塞（600ms 内未完成）', async () => {
          assert(!s0done, 'c2 的第 1 条应当在 c1 的行锁上等待，但 600ms 内已完成（说明未拿到全表行锁）');
        });

        // c2 仍被阻塞期间，mutation B 在独立连接上提交（logistics completed → arrived 40）
        await c3.query("UPDATE logistics_batches SET logistics_status='completed' WHERE id='lb_p1'");

        // c1 跑完剩余 4 条并 COMMIT → 其 in_transit 来自 mutation 前的旧快照（100，陈旧）
        for (let i = 2; i < 6; i++) await c1.query(SQLS[i]);
        await c1.query('COMMIT');

        const afterC1 = num((await row('SKU-P1')).in_transit_qty);
        await check('Q3a: 先开始者 c1 以旧快照提交 → 写入陈旧值 100（构造出“陈旧覆盖”前提）', async () => {
          eq(afterC1, 100, 'c1 提交后的陈旧值');
        });

        // c2 解除阻塞后继续：后续语句在 READ COMMITTED 下取新快照 → 应看到 mutation B
        await pS0;
        await check('Q2: c2 被解除阻塞后第 1 条完成（等待时长 ' + s0elapsed + 'ms），说明只是 wait/serialize 而非死锁', async () => {
          assert(s0done, 'c2 应已解除阻塞');
        });
        for (let i = 1; i < 6; i++) await c2.query(SQLS[i]);
        await c2.query('COMMIT');

        const finalV = num((await row('SKU-P1')).in_transit_qty);
        await check('Q3b: 后完成者 c2 以最新已提交事实重算 → 最终值 = 100-40 = 60（陈旧值 100 未残留）', async () => {
          eq(finalV, 60, '最终 in_transit_qty');
        });
      } finally {
        for (const x of [c1, c2, c3]) { try { await x.end(); } catch (e) {} }
      }
    }

    // =======================================================================
    // C1 —— 两个 mutation（CI shipped 增加 + logistics completed 抵减）并发 refresh
    // =======================================================================
    console.log('\n=== C1 CI shipped 增加 + logistics completed 抵减，两个 after-commit refresh 并发 ===');
    await resetAll();
    await seed('SKU-C1');
    await seedCI('ci_c1', 'SKU-C1', 100);
    await seedBatch('lb_c1', 'ci_c1', 'SKU-C1', 40, 'pending');
    await refresh();
    eq(num((await row('SKU-C1')).in_transit_qty), 100, 'C1 baseline');

    // mutation A: 新 CI 再出货 50 → 期望 150
    await seedCI('ci_c1b', 'SKU-C1', 50);
    // mutation B: 原 batch completed 抵减 40 → 期望 100 + 50 - 40 = 110
    await c.query("UPDATE logistics_batches SET logistics_status='completed' WHERE id='lb_c1'");

    const pA = refresh();
    const pB = refresh();
    const errs = [];
    await Promise.all([pA.catch((e) => errs.push(e)), pB.catch((e) => errs.push(e))]);
    await check('C1: 两个 refresh 均无错误（无 deadlock / 无 lock timeout）', async () => {
      assert(errs.length === 0, '错误: ' + errs.map((e) => e.code + ' ' + e.message).join(' | '));
    });
    await check('C1: 最终 in_transit_qty = 100 + 50 - 40 = 110（严格等于最新 source facts）', async () => {
      eq(num((await row('SKU-C1')).in_transit_qty), 110, '最终 in_transit_qty');
    });

    // =======================================================================
    // C2 —— PI unshipped + PO unconfirmed 两类来源并发，三列全验
    // =======================================================================
    console.log('\n=== C2 PI confirmed-unshipped + PO unconfirmed PI 并发，三列全验 ===');
    await resetAll();
    await seed('SKU-C2');
    await seedCI('ci_c2', 'SKU-C2', 70);
    await seedBatch('lb_c2', 'ci_c2', 'SKU-C2', 20, 'completed'); // arrived 20 → in_transit 50
    await seedPI('pi_c2', 'SKU-C2', 60, 10);                      // unshipped 50
    await seedPO('po_c2', 'SKU-C2', 90, 30);                      // unconfirmed 60
    await refresh();

    // mutation A: 新增一批 PI 未出货 25 → 50 + 25 = 75
    await seedPI('pi_c2b', 'SKU-C2', 25, 0);
    // mutation B: PO 新增未转 PI 15 → 60 + 15 = 75
    await seedPO('po_c2b', 'SKU-C2', 15, 0);

    const c2errs = [];
    await Promise.all([refresh().catch((e) => c2errs.push(e)), refresh().catch((e) => c2errs.push(e))]);
    await check('C2: 两个 refresh 均无错误', async () => {
      assert(c2errs.length === 0, '错误: ' + c2errs.map((e) => e.code + ' ' + e.message).join(' | '));
    });
    const r2 = await row('SKU-C2');
    await check('C2: in_transit_qty = 70 - 20 = 50', async () => eq(num(r2.in_transit_qty), 50, 'in_transit_qty'));
    await check('C2: pi_confirmed_unshipped_qty = (60-10) + 25 = 75', async () => eq(num(r2.pi_confirmed_unshipped_qty), 75, 'pi_confirmed_unshipped_qty'));
    await check('C2: po_unconfirmed_pi_qty = (90-30) + 15 = 75', async () => eq(num(r2.po_unconfirmed_pi_qty), 75, 'po_unconfirmed_pi_qty'));

    // =======================================================================
    // C3 —— 三次 refresh 并发：无 deadlock / 结果一致
    // =======================================================================
    console.log('\n=== C3 Promise.all x3 连续并发 refresh ===');
    await resetAll();
    await seed('SKU-C3');
    await seedCI('ci_c3', 'SKU-C3', 30);
    await seedPI('pi_c3', 'SKU-C3', 40, 5);
    await seedPO('po_c3', 'SKU-C3', 50, 10);
    const c3errs = [];
    await Promise.all([
      refresh().catch((e) => c3errs.push(e)),
      refresh().catch((e) => c3errs.push(e)),
      refresh().catch((e) => c3errs.push(e))
    ]);
    await check('C3: 3 个并发 refresh 全部成功，无 deadlock(40P01) / 无 lock timeout(55P03)', async () => {
      assert(c3errs.length === 0, '错误: ' + c3errs.map((e) => '[' + e.code + '] ' + e.message).join(' | '));
    });
    const r3 = await row('SKU-C3');
    await check('C3: 三列最终值一致且正确（30 / 35 / 40）', async () => {
      eq(num(r3.in_transit_qty), 30, 'in_transit_qty');
      eq(num(r3.pi_confirmed_unshipped_qty), 35, 'pi_confirmed_unshipped_qty');
      eq(num(r3.po_unconfirmed_pi_qty), 40, 'po_unconfirmed_pi_qty');
    });
    // 再跑一次串行 refresh，验证并发结果与串行结果完全一致（幂等）
    await refresh();
    const r3b = await row('SKU-C3');
    await check('C3: 并发结果与后续串行重算结果逐列一致（幂等、无 partial state）', async () => {
      eq(num(r3b.in_transit_qty), num(r3.in_transit_qty), 'in_transit_qty');
      eq(num(r3b.pi_confirmed_unshipped_qty), num(r3.pi_confirmed_unshipped_qty), 'pi_confirmed_unshipped_qty');
      eq(num(r3b.po_unconfirmed_pi_qty), num(r3.po_unconfirmed_pi_qty), 'po_unconfirmed_pi_qty');
    });

    // =======================================================================
    // Q4 —— 死锁排查：确认服务端未记录 deadlock
    // =======================================================================
    console.log('\n=== Q4 死锁排查（相同 SQL 顺序 → wait/serialize，非 deadlock） ===');
    await check('Q4: 数据库未发生任何死锁（pg_stat_database.deadlocks 增量为 0）', async () => {
      const before = await admin.query("SELECT sum(deadlocks) AS d FROM pg_stat_database WHERE datname = current_database()");
      // 再并发 5 次制造压力
      await Promise.all(Array.from({ length: 5 }, () => refresh().catch(() => {})));
      const after = await admin.query("SELECT sum(deadlocks) AS d FROM pg_stat_database WHERE datname = current_database()");
      eq(Number(after.rows[0].d) - Number(before.rows[0].d), 0, 'deadlocks 增量');
    });

    try { await c.end(); } catch (e) {}
  } finally {
    // -----------------------------------------------------------------------
    // 清理：DROP SCHEMA CASCADE + 新连接复查残留
    // -----------------------------------------------------------------------
    try {
      await admin.query('DROP SCHEMA IF EXISTS "' + schema + '" CASCADE');
      const left = await admin.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema=$1", [schema]);
      console.log('[W0B-PG] 清理后残留表 = ' + left.rows[0].n + (left.rows[0].n === 0 ? ' （干净）' : ' （异常！）'));
    } catch (e) { console.log('[W0B-PG] cleanup failed: ' + e.message); }
    try { await admin.end(); } catch (e) {}
  }

  const pass = results.filter((r) => r.ok).length;
  const fail = results.length - pass;
  if (fail) failed++;
  console.log('\n============================================');
  console.log(`REAL PG CONCURRENCY PROOF: ${pass} pass / ${fail} fail`);
  console.log('============================================');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('[W0B-PG] FATAL: ' + (e && e.message)); process.exit(1); });
