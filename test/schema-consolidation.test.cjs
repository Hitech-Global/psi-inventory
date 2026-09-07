// ============================================================================
// SCHEMA-CONSOLIDATION-01: 生产带外 schema 收编验收（真 PG 16.15 嵌入式）
//
// 模拟「空白/重建 PG 库」：仅从 db-pg.js 建表（模拟 dump 恢复的表结构），
// 不镜像任何带外对象（uq_inventory_key / WAC 触发器 / sales 索引），
// 由 db.initDatabase() 生产启动入口自行补齐 —— 验证 DB 重建后保护不静默消失。
//
// T1 索引收编：uq_inventory_key + sales_records×6 + sales_import_runs×2
// T2 WAC 守卫收编：函数 fail-secure 体 + 双触发器 enabled
// T3 行为验证：locked wac 行 UPDATE 拒绝 / SET LOCAL 放行 / COMMIT 后再拒 / DELETE 拒绝
// T4 幂等：二次 initDatabase 零错误、对象不变
// T5 升级路径：旧版函数体 → boot 后升级为 fail-secure（模拟 Wave 1 之前的生产）
// T6 重建路径：触发器被删 → boot 后重建并 enabled
// 运行：node --test --test-force-exit test/schema-consolidation.test.cjs
// ============================================================================
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const net = require('net');
const { execSync } = require('child_process');
const { Client } = require('pg');

const REPO = path.resolve(__dirname, '..');
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const exec = (cmd, opts = {}) => execSync(cmd, Object.assign({ stdio: 'pipe', timeout: 180000 }, opts));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

async function ensureEmbeddedPg() {
  if (process.env.W1_PG_DSN) {
    const u = new URL(process.env.W1_PG_DSN);
    if (!LOCAL_HOSTS.has(u.hostname)) throw new Error('W1-PG-GUARD: 主机不在白名单: ' + u.hostname);
    return { dsn: process.env.W1_PG_DSN, dataDir: null, pgCtl: null };
  }
  const pgtestDir = path.join(REPO, '.pgtest');
  const binDir = path.join(pgtestDir, 'pg16bin');
  const pgBin = path.join(binDir, 'bin');
  if (!fs.existsSync(path.join(pgBin, 'postgres'))) {
    fs.mkdirSync(binDir, { recursive: true });
    const jarPath = path.join(pgtestDir, 'pg16.jar');
    if (!fs.existsSync(jarPath)) {
      console.log('[SC-PG] 下载嵌入式 PostgreSQL 16.15 二进制（首次运行一次）...');
      exec('curl -sfL -o "' + jarPath + '" https://repo1.maven.org/maven2/io/zonky/test/postgres/embedded-postgres-binaries-darwin-arm64v8/16.15.0/embedded-postgres-binaries-darwin-arm64v8-16.15.0.jar', { timeout: 300000 });
    }
    exec('cd "' + pgtestDir + '" && unzip -oq pg16.jar && tar -xf postgres-darwin-arm_64.txz -C "' + binDir + '" && xattr -dr com.apple.quarantine "' + binDir + '"');
    console.log('[SC-PG] 二进制就绪: ' + pgBin);
  }
  const port = await freePort();
  const dataDir = path.join(pgtestDir, 'data-' + Date.now());
  fs.mkdirSync(dataDir, { recursive: true });
  exec('"' + path.join(pgBin, 'initdb') + '" -D "' + dataDir + '" -U postgres -A trust');
  exec('openssl req -new -x509 -days 2 -nodes -subj "/CN=localhost" -keyout "' + dataDir + '/server.key" -out "' + dataDir + '/server.crt"');
  fs.chmodSync(path.join(dataDir, 'server.key'), 0o600);
  fs.appendFileSync(path.join(dataDir, 'postgresql.conf'), `\nssl=on\nlisten_addresses='127.0.0.1'\nport=${port}\n`);
  exec('"' + path.join(pgBin, 'pg_ctl') + '" -D "' + dataDir + '" -l "' + dataDir + '/pg.log" -w -t 60 start');
  console.log('[SC-PG] 实例已启动 127.0.0.1:' + port);
  return {
    dsn: `postgresql://postgres@127.0.0.1:${port}/postgres`,
    dataDir,
    pgCtl: path.join(pgBin, 'pg_ctl')
  };
}

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

// 旧版 UPDATE 守卫函数体（Wave 1 之前的生产现状，用于 T5 升级路径验证）
const OLD_FN_UPDATE = `CREATE OR REPLACE FUNCTION trg_block_wac_history_update() RETURNS trigger AS $$
BEGIN
  IF OLD.is_locked = 1 THEN
    RAISE EXCEPTION 'LOCKED_WAC_HISTORY_UPDATE_FORBIDDEN';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;`;

let emb, admin, srv, port, schema, testDsn, dataDir;
let dbmod;

async function q(sql, params) { return (await admin.query(sql, params)).rows; }
async function q1(sql, params) { return (await q(sql, params))[0] || null; }

async function seedLockedWac(tag) {
  await q(`INSERT INTO wac_history (id, version_no, ci_id, ci_no, sku_code, country, warehouse, is_locked, confirmation_status)
           VALUES ($1,1,$2,$3,$4,'ID','WH1',1,'confirmed')`, ['wac_' + tag, 'ci_' + tag, 'CI-' + tag, 'SKU-' + tag]);
}

async function triggerState() {
  return q(`SELECT tgname, tgenabled FROM pg_trigger WHERE tgrelid='wac_history'::regclass AND NOT tgisinternal ORDER BY tgname`);
}

describe('SCHEMA-CONSOLIDATION-01: 带外 schema 收编验收（真 PG）', () => {
  before(async () => {
    emb = await ensureEmbeddedPg();
    dataDir = emb.dataDir;
    testDsn = emb.dsn;
    admin = new Client({ connectionString: emb.dsn, ssl: { rejectUnauthorized: false } });
    await admin.connect();

    schema = 'sc1_' + Math.random().toString(36).slice(2, 10);
    await admin.query('CREATE SCHEMA "' + schema + '"');
    await admin.query('SET search_path TO "' + schema + '"');
    testDsn = emb.dsn + (emb.dsn.indexOf('?') >= 0 ? '&' : '?') + 'options=-csearch_path%3D' + encodeURIComponent(schema);

    // 仅建表（模拟 dump 恢复的结构现状）；【不】镜像任何带外索引/触发器/函数
    const pgSrc = fs.readFileSync(path.join(REPO, 'db-pg.js'), 'utf8');
    const tables = extractAllCreateTables(pgSrc);
    let created = 0; const errs = [];
    for (const t of tables) {
      try {
        await admin.query(t.ddl.replace('CREATE TABLE IF NOT EXISTS ' + t.table, 'CREATE TABLE IF NOT EXISTS "' + schema + '".' + t.table));
        created++;
      } catch (e) { errs.push(t.table + ': ' + String(e.message).slice(0, 100)); }
    }
    console.log(`[SC-PG] tables created = ${created}/${tables.length}` + (errs.length ? ' 失败: ' + errs.join(' | ') : ''));

    // 线上迁移列（db-pg.js DDL 之外、生产带外的列，reverse/业务依赖）
    for (const col of [
      `ALTER TABLE "${schema}".commercial_invoice_items ADD COLUMN IF NOT EXISTS pi_id TEXT DEFAULT ''`,
      `ALTER TABLE "${schema}".commercial_invoices ADD COLUMN IF NOT EXISTS target_warehouse TEXT DEFAULT ''`,
      `ALTER TABLE "${schema}".commercial_invoices ADD COLUMN IF NOT EXISTS original_inventory_imported INTEGER DEFAULT 0`,
      `ALTER TABLE "${schema}".proforma_invoices ADD COLUMN IF NOT EXISTS target_warehouse TEXT DEFAULT ''`,
      `ALTER TABLE "${schema}".purchase_orders ADD COLUMN IF NOT EXISTS target_warehouse TEXT DEFAULT ''`,
      `ALTER TABLE "${schema}".packing_lists ADD COLUMN IF NOT EXISTS logistics_batch_id TEXT DEFAULT ''`
    ]) { try { await admin.query(col); } catch (e) { /* 已存在 */ } }

    // 生产启动路径：DB_DRIVER=pg + DATABASE_URL → require db → initDatabase（收编逻辑在此执行）
    process.env.DB_DRIVER = 'pg';
    process.env.DATABASE_URL = testDsn;
    process.env.NODE_ENV = 'test';

    // 测试侧 instrumentation：db-sync-worker 是 new Worker(...) 且 db.js 未导出 shutdown，
    // 该 worker 会一直持有事件循环 → 测试跑完后 node 进程永不退出（表现为"挂起"）。
    // 与 wave2a harness 相同的修复：在 require('../db') 之前给 Worker 打补丁使其 unref。
    // db.js 在自身 require 时解构 worker_threads.Worker，故此刻打补丁可被其捕获。不修改任何生产代码。
    try {
      const wt = require('worker_threads');
      const OrigWorker = wt.Worker;
      function UnrefWorker() {
        const w = new (Function.prototype.bind.apply(OrigWorker, [null].concat(Array.prototype.slice.call(arguments))))();
        try { w.unref(); } catch (e) {}
        return w;
      }
      UnrefWorker.prototype = OrigWorker.prototype;
      wt.Worker = UnrefWorker;
    } catch (e) {
      console.warn('[SC-PG] worker unref patch warn:', e && e.message);
    }

    dbmod = require('../db');
    dbmod.initDatabase();

    const server = require('../server');
    await new Promise((resolve) => { srv = server.app.listen(0, () => { port = srv.address().port; resolve(); }); });
    console.log('[SC-PG] server up on 127.0.0.1:' + port);
  });

  after(async () => {
    try { if (srv) srv.close(); } catch (e) {}
    try { if (admin) await admin.end(); } catch (e) {}
    if (emb && emb.pgCtl && dataDir) {
      try { exec('"' + emb.pgCtl + '" -D "' + dataDir + '" -m fast stop', { timeout: 60000 }); } catch (e) {}
    }
    if (emb && dataDir) {
      try {
        const c = new Client({ connectionString: emb.dsn, ssl: { rejectUnauthorized: false } });
        await c.connect();
        await c.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        const r = await c.query(`SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_schema = $1`, [schema]);
        assert.equal(r.rows[0].n, 0, 'DROP SCHEMA 后必须零残留');
        await c.end();
      } catch (e) { console.warn('[SC-PG] schema cleanup warn:', e.message); }
      try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (e) {}
    }
  });

  test('T1: 索引收编 —— uq_inventory_key + sales_records×6 + sales_import_runs×2 由 boot 补齐', { timeout: 120000 }, async () => {
    const idx = await q(`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname=current_schema() AND tablename IN ('inventory','sales_records','sales_import_runs')`);
    const names = new Map(idx.map((r) => [r.indexname, r.indexdef]));

    const uq = names.get('uq_inventory_key');
    assert.ok(uq, 'uq_inventory_key 必须存在');
    assert.ok(uq.indexOf('CREATE UNIQUE') === 0, 'uq_inventory_key 必须是 UNIQUE 索引: ' + uq);
    assert.ok(/sku_code.*country.*warehouse/.test(uq), '键列必须为 sku_code+country+warehouse: ' + uq);

    const sru = names.get('idx_sales_records_unique');
    assert.ok(sru && sru.indexOf('CREATE UNIQUE') === 0, 'idx_sales_records_unique 必须存在且 UNIQUE: ' + sru);
    for (const n of ['idx_sales_records_sku', 'idx_sales_records_date', 'idx_sales_records_valid', 'idx_sales_records_batch', 'idx_sales_records_country']) {
      assert.ok(names.has(n), n + ' 必须存在');
      assert.ok(names.get(n).indexOf('CREATE UNIQUE') !== 0, n + ' 必须是普通索引');
    }
    for (const n of ['idx_sales_import_runs_status', 'idx_sales_import_runs_updated']) {
      assert.ok(names.has(n), n + ' 必须存在');
    }
  });

  test('T2: WAC 守卫收编 —— fail-secure 函数体 + 双触发器 enabled', { timeout: 60000 }, async () => {
    const fn = await q1(`SELECT prosrc FROM pg_proc WHERE proname='trg_block_wac_history_update'`);
    assert.ok(fn, 'trg_block_wac_history_update 必须存在');
    assert.ok(String(fn.prosrc).indexOf('app.wac_unlock') >= 0, '函数体必须是 fail-secure 新守卫');
    const dfn = await q1(`SELECT to_regproc('trg_block_wac_history_delete') AS f`);
    assert.ok(dfn.f, 'trg_block_wac_history_delete 必须存在');
    const trg = await triggerState();
    for (const n of ['trg_wac_history_block_update', 'trg_wac_history_block_delete']) {
      const t = trg.find((r) => r.tgname === n);
      assert.ok(t, n + ' 必须存在');
      assert.equal(t.tgenabled, 'O', n + ' 必须 enabled');
    }
  });

  test('T3: 行为验证 —— locked 行 UPDATE 拒 / SET LOCAL 放 / COMMIT 后再拒 / DELETE 拒', { timeout: 120000 }, async () => {
    await seedLockedWac('SC3');
    const c = new Client({ connectionString: testDsn, ssl: { rejectUnauthorized: false } });
    await c.connect();

    let code1 = null;
    try { await c.query(`UPDATE wac_history SET confirmation_status='x' WHERE id='wac_SC3'`); }
    catch (e) { code1 = e.message; }
    assert.ok(code1 && code1.indexOf('LOCKED_WAC_HISTORY_UPDATE_FORBIDDEN') >= 0, '无解锁令牌的 UPDATE 必须被拒: ' + code1);

    await c.query('BEGIN');
    await c.query(`SELECT set_config('app.wac_unlock', '1', true)`);
    await c.query(`UPDATE wac_history SET confirmation_status='x' WHERE id='wac_SC3'`);
    await c.query('COMMIT');

    let code2 = null;
    try { await c.query(`UPDATE wac_history SET confirmation_status='y' WHERE id='wac_SC3'`); }
    catch (e) { code2 = e.message; }
    assert.ok(code2 && code2.indexOf('LOCKED_WAC_HISTORY_UPDATE_FORBIDDEN') >= 0, 'COMMIT 后 UPDATE 必须再次被拒');

    let code3 = null;
    try { await c.query(`DELETE FROM wac_history WHERE id='wac_SC3'`); }
    catch (e) { code3 = e.message; }
    assert.ok(code3 && code3.indexOf('LOCKED_WAC_HISTORY_DELETE_FORBIDDEN') >= 0, 'locked 行 DELETE 必须被拒: ' + code3);

    await c.end();
  });

  test('T4: 幂等 —— 二次 initDatabase 零错误、对象不变', { timeout: 120000 }, async () => {
    assert.doesNotThrow(() => dbmod.initDatabase(), '二次 initDatabase 必须无错误');
    const idx = await q(`SELECT indexname FROM pg_indexes WHERE schemaname=current_schema() AND indexname IN ('uq_inventory_key','idx_sales_records_unique','idx_sales_records_sku')`);
    assert.equal(idx.length, 3, '索引必须仍在（不得重复/丢失）');
    const trg = await triggerState();
    assert.equal(trg.filter((r) => r.tgname.indexOf('trg_wac_history_block_') === 0).length, 2, '双触发器必须仍在且各一');
    const fn = await q1(`SELECT prosrc FROM pg_proc WHERE proname='trg_block_wac_history_update'`);
    assert.ok(String(fn.prosrc).indexOf('app.wac_unlock') >= 0, '函数体必须保持 fail-secure');
    await sleep(50);
  });

  test('T5: 升级路径 —— 旧版函数体在 boot 后升级为 fail-secure', { timeout: 120000 }, async () => {
    // 模拟 Wave 1 之前的生产：旧版无条件拒绝体
    await admin.query(OLD_FN_UPDATE);
    let fn = await q1(`SELECT prosrc FROM pg_proc WHERE proname='trg_block_wac_history_update'`);
    assert.ok(String(fn.prosrc).indexOf('app.wac_unlock') === -1, '前置：函数体应为旧版');
    dbmod.initDatabase();
    fn = await q1(`SELECT prosrc FROM pg_proc WHERE proname='trg_block_wac_history_update'`);
    assert.ok(String(fn.prosrc).indexOf('app.wac_unlock') >= 0, 'boot 后必须升级为 fail-secure 新守卫');
  });

  test('T6: 重建路径 —— 触发器被删后 boot 补建并 enabled', { timeout: 120000 }, async () => {
    await admin.query(`DROP TRIGGER IF EXISTS trg_wac_history_block_update ON wac_history`);
    await admin.query(`DROP TRIGGER IF EXISTS trg_wac_history_block_delete ON wac_history`);
    let trg = await triggerState();
    assert.equal(trg.filter((r) => r.tgname.indexOf('trg_wac_history_block_') === 0).length, 0, '前置：触发器应已不存在');
    dbmod.initDatabase();
    trg = await triggerState();
    for (const n of ['trg_wac_history_block_update', 'trg_wac_history_block_delete']) {
      const t = trg.find((r) => r.tgname === n);
      assert.ok(t, n + ' 必须被 boot 重建');
      assert.equal(t.tgenabled, 'O', n + ' 必须 enabled');
    }
  });
});
