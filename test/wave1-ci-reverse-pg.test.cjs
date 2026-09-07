'use strict';
/**
 * Wave 1 — CI Reverse 测试 Part B（真实 PostgreSQL，全栈 require('../server')，DB_DRIVER=pg）
 * =================================================================================================================
 * 【真 PG 锁语义证明】R9/R10/R11/R13-runtime/AEL 全部在真实 PostgreSQL 上执行（非 SQLite 冒充）。
 *   B1  R1-PG parity smoke + WAC trigger guard 自愈（旧函数 → fail-secure 守卫函数，保护不降级）
 *   B2  R2-PG 顺序二次 reverse → 400 且不重复扣减
 *   B3  R9 并发同 CI reverse —— 恰好一个 200（FOR UPDATE + EvalPlanQual 串行化，无 double decrement）
 *   B4  R10 并发共享 PI/不同 CI —— 两个都 200 且最终值 = initial - A - B（无 lost update）
 *   B5  R8-PG 中途失败（注入列缺失）→ 整体 ROLLBACK
 *   B6  R11 SET LOCAL 守卫生命周期：plain reject / SET LOCAL allow / COMMIT 后 reject /
 *       ROLLBACK 后 reject / 非法值 reject（fail-secure）
 *   B7  R13-runtime：reverse 请求窗口内 sync bridge 日志 —— 核心 SQL 零出现（唯一 sync call =
 *       COMMIT 后 logOperation 审计）
 *   B8  AEL 实证：reverse 与并发读事务共存（不退化）+ 旧路径 trigger DDL 锁级别实证
 *       （真机 PG 16.15：ALTER TABLE ... DISABLE TRIGGER = ShareRowExclusiveLock，非
 *       AccessExclusiveLock；不阻塞读但阻塞 wac_history 全部写直到 COMMIT + 死锁环风险）
 *       —— 该实证修正设计稿的锁级断言，消除 DDL 的收益不变
 *
 * 嵌入式 PG：maven zonky darwin-arm64v8 16.15.0（缓存在 .pgtest/pg16bin/，重复运行不重新下载）。
 * 或 W1_PG_DSN 指向已运行的本地实例（仅允许 localhost/127.0.0.1/::1）。
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const net = require('net');
const { execSync } = require('child_process');
const { Client } = require('pg');

const REPO = path.resolve(__dirname, '..');

const CORE_SYNC_FORBIDDEN = [
  /UPDATE\s+inventory\b/i,
  /UPDATE\s+proforma_invoice_items\b/i,
  /UPDATE\s+proforma_invoices\b/i,
  /UPDATE\s+wac_history\b/i,
  /UPDATE\s+commercial_invoices\b/i,
  /UPDATE\s+inbound_records\b/i,
  /UPDATE\s+packing_lists\b/i,
  /UPDATE\s+payable_items\b/i,
  /UPDATE\s+cost_allocations\b/i,
  /FOR\s+UPDATE/i
];

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const exec = (cmd, opts = {}) => execSync(cmd, Object.assign({ stdio: 'pipe', timeout: 180000 }, opts));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

// ---------------------------------------------------------------------------
// 嵌入式 PG 启动（只允许本地实例；生产库一律拒绝）
// ---------------------------------------------------------------------------
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
      console.log('[W1-PG] 下载嵌入式 PostgreSQL 16.15 二进制（首次运行一次）...');
      exec('curl -sfL -o "' + jarPath + '" https://repo1.maven.org/maven2/io/zonky/test/postgres/embedded-postgres-binaries-darwin-arm64v8/16.15.0/embedded-postgres-binaries-darwin-arm64v8-16.15.0.jar', { timeout: 300000 });
    }
    exec('cd "' + pgtestDir + '" && unzip -oq pg16.jar && tar -xf postgres-darwin-arm_64.txz -C "' + binDir + '" && xattr -dr com.apple.quarantine "' + binDir + '"');
    console.log('[W1-PG] 二进制就绪: ' + pgBin);
  }
  const port = await freePort();
  const dataDir = path.join(pgtestDir, 'data-' + Date.now());
  fs.mkdirSync(dataDir, { recursive: true });
  exec('"' + path.join(pgBin, 'initdb') + '" -D "' + dataDir + '" -U postgres -A trust');
  exec('openssl req -new -x509 -days 2 -nodes -subj "/CN=localhost" -keyout "' + dataDir + '/server.key" -out "' + dataDir + '/server.crt"');
  fs.chmodSync(path.join(dataDir, 'server.key'), 0o600);
  fs.appendFileSync(path.join(dataDir, 'postgresql.conf'), `\nssl=on\nlisten_addresses='127.0.0.1'\nport=${port}\n`);
  exec('"' + path.join(pgBin, 'pg_ctl') + '" -D "' + dataDir + '" -l "' + dataDir + '/pg.log" -w -t 60 start');
  console.log('[W1-PG] 实例已启动 127.0.0.1:' + port);
  return {
    dsn: `postgresql://postgres@127.0.0.1:${port}/postgres`,
    dataDir,
    pgCtl: path.join(pgBin, 'pg_ctl')
  };
}

// ---------------------------------------------------------------------------
// DDL 抽取（真实生产类型，来自 db-pg.js，禁止手写）
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

// 旧版触发器函数（镜像生产带外创建的现状：无条件拒绝 locked 行）
const OLD_FN_UPDATE = `CREATE OR REPLACE FUNCTION trg_block_wac_history_update() RETURNS trigger AS $$
BEGIN
  IF OLD.is_locked = 1 THEN
    RAISE EXCEPTION 'LOCKED_WAC_HISTORY_UPDATE_FORBIDDEN';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;`;
const OLD_FN_DELETE = `CREATE OR REPLACE FUNCTION trg_block_wac_history_delete() RETURNS trigger AS $$
BEGIN
  IF OLD.is_locked = 1 THEN
    RAISE EXCEPTION 'LOCKED_WAC_HISTORY_DELETE_FORBIDDEN';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;`;
const TRIGGER_DDL = [
  `DROP TRIGGER IF EXISTS trg_wac_history_block_update ON wac_history`,
  `CREATE TRIGGER trg_wac_history_block_update BEFORE UPDATE ON wac_history FOR EACH ROW EXECUTE FUNCTION trg_block_wac_history_update()`,
  `DROP TRIGGER IF EXISTS trg_wac_history_block_delete ON wac_history`,
  `CREATE TRIGGER trg_wac_history_block_delete BEFORE DELETE ON wac_history FOR EACH ROW EXECUTE FUNCTION trg_block_wac_history_delete()`
];

// ---------------------------------------------------------------------------
// 全局状态
// ---------------------------------------------------------------------------
let emb, admin, srv, port, schema, testDsn, dataDir;
let recording = false;
let syncLog = [];

async function q(sql, params) { return (await admin.query(sql, params)).rows; }
async function q1(sql, params) { return (await q(sql, params))[0] || null; }

// ---------------------------------------------------------------------------
// seed（PG 直插；列清单对齐 db-pg.js 真实 DDL）
// ---------------------------------------------------------------------------
async function seedSingle(tag, opts = {}) {
  const sku = 'SKU-' + tag;
  const ciId = 'ci_' + tag;
  const piId = 'pi_' + tag;
  const invQty = opts.invQty != null ? opts.invQty : 100;
  await q(`INSERT INTO inventory (id, sku_code, country, warehouse, available_qty) VALUES ($1,$2,'ID','WH1',$3)`, ['inv_' + tag, sku, invQty]);
  await q(`INSERT INTO proforma_invoices (id, pi_no, pi_date, need_deposit, deposit_ratio, balance_ratio, total_amount,
          currency, pi_status, deposit_payment_status, country, target_warehouse, payable_deposit, deducted_deposit,
          available_deduct_deposit, shipped_amount, unshipped_amount)
          VALUES ($1,$2,'2026-08-01',0,0,100,500,'USD','shipped_complete','unpaid','ID','WH1',200,175,25,400,100)`, [piId, 'PI-' + tag]);
  await q(`INSERT INTO proforma_invoice_items (id, pi_id, pi_no, po_no, sku_code, po_qty, pi_confirmed_qty, unit_price,
          pi_amount, shipped_qty, unshipped_qty) VALUES ($1,$2,$3,'',$4,0,50,0,0,50,0)`, ['pii_' + tag, piId, 'PI-' + tag, sku]);
  await q(`INSERT INTO commercial_invoices (id, ci_no, ci_date, currency, ci_status, country, target_warehouse,
          actual_deducted_deposit, wac_confirmed, wac_version_id, cost_confirmed, cost_allocated, remark, original_inventory_imported)
          VALUES ($1,$2,'2026-08-01','USD','inbound_complete','ID','WH1',100,1,'wv1',1,1,'ci-remark',1)`, [ciId, 'CI-' + tag]);
  await q(`INSERT INTO commercial_invoice_items (id, ci_id, ci_no, pi_id, sku_code, shipped_qty, inbound_qty, ci_amount, unit_price)
          VALUES ($1,$2,$3,$4,$5,30,0,300,0)`, ['cii_' + tag, ciId, 'CI-' + tag, piId, sku]);
  const inbounds = opts.inbounds || [{ qty: 5 }, { qty: 7 }];
  let m = 0;
  for (const ib of inbounds) {
    m++;
    await q(`INSERT INTO inbound_records (id, inbound_no, source_ci_id, source_ci_no, country, warehouse, inbound_date,
          sku_code, actual_qty, inbound_status, remark) VALUES ($1,$2,$3,$4,$5,'WH1','2026-08-05',$6,$7,'completed',$8)`,
      [`ib_${tag}_${m}`, 'IB-' + tag + '-' + m, ciId, 'CI-' + tag, ib.country != null ? ib.country : 'ID', ib.sku || sku, ib.qty, '']);
  }
  await q(`INSERT INTO wac_history (id, version_no, ci_id, ci_no, sku_code, country, warehouse, is_locked, confirmation_status)
          VALUES ($1,1,$2,$3,$4,'ID','WH1',1,'confirmed')`, ['wac_' + tag, ciId, 'CI-' + tag, sku]);
  await q(`INSERT INTO cost_allocations (id, ci_no, sku_code, allocation_basis) VALUES ($1,$2,$3,'BASE')`, ['ca_' + tag, 'CI-' + tag, sku]);
  await q(`INSERT INTO payable_items (id, fee_no, source_type, source_id, source_no, source_ci_id, fee_type, payee_key,
          payee_name_snapshot, payer_entity_key, payer_name_snapshot, currency, payable_amount_minor, is_active, lifecycle_status)
          VALUES ($1,$2,'pi',$3,'',$4,'balance','payee1','Payee','payer1','Payer','USD',10000,1,'active')`, ['pay_' + tag, 'FEE-' + tag, piId, ciId]);
  await q(`INSERT INTO packing_lists (id, pl_no, related_ci_id, related_ci_no, total_qty, status, remark)
          VALUES ($1,$2,$3,$4,12,'confirmed','pl-remark')`, ['pl_' + tag, 'PL-' + tag, ciId, 'CI-' + tag]);
  return { sku, ciId, piId };
}

async function seedShared(tag) {
  const sku = 'SKU-' + tag;
  await q(`INSERT INTO inventory (id, sku_code, country, warehouse, available_qty) VALUES ($1,$2,'ID','WH1',200)`, ['inv_' + tag, sku]);
  await q(`INSERT INTO proforma_invoices (id, pi_no, pi_date, need_deposit, deposit_ratio, balance_ratio, total_amount,
          currency, pi_status, deposit_payment_status, country, target_warehouse, payable_deposit, deducted_deposit,
          available_deduct_deposit, shipped_amount, unshipped_amount)
          VALUES ($1,$2,'2026-08-01',0,0,100,500,'USD','shipped_complete','unpaid','ID','WH1',200,175,25,400,100)`, ['pi_' + tag, 'PI-' + tag]);
  await q(`INSERT INTO proforma_invoice_items (id, pi_id, pi_no, po_no, sku_code, po_qty, pi_confirmed_qty, unit_price,
          pi_amount, shipped_qty, unshipped_qty) VALUES ($1,$2,$3,'',$4,0,80,0,0,80,0)`, ['pii_' + tag, 'pi_' + tag, 'PI-' + tag, sku]);
  for (const [cid, amt, deduct, ship] of [['ci_' + tag + 'A', 300, 60, 30], ['ci_' + tag + 'B', 100, 40, 50]]) {
    await q(`INSERT INTO commercial_invoices (id, ci_no, ci_date, currency, ci_status, country, target_warehouse,
          actual_deducted_deposit, wac_confirmed, wac_version_id, cost_confirmed, cost_allocated, remark, original_inventory_imported)
          VALUES ($1,$2,'2026-08-01','USD','inbound_complete','ID','WH1',$3,1,'wv',1,1,'',1)`, [cid, 'CI-' + cid, deduct]);
    await q(`INSERT INTO commercial_invoice_items (id, ci_id, ci_no, pi_id, sku_code, shipped_qty, inbound_qty, ci_amount, unit_price)
          VALUES ($1,$2,$3,$4,$5,$6,0,$7,0)`, ['cii_' + cid, cid, 'CI-' + cid, 'pi_' + tag, sku, ship, amt]);
    await q(`INSERT INTO inbound_records (id, inbound_no, source_ci_id, source_ci_no, country, warehouse, inbound_date,
          sku_code, actual_qty, inbound_status, remark) VALUES ($1,$2,$3,$4,'ID','WH1','2026-08-05',$5,0,'completed','')`,
      ['ib_' + cid, 'IB-' + cid, cid, 'CI-' + cid, sku]);
  }
  return { sku, piId: 'pi_' + tag, ciA: 'ci_' + tag + 'A', ciB: 'ci_' + tag + 'B' };
}

async function fetchJSON(method, pathStr, body, opts = {}) {
  const res = await fetch(`http://127.0.0.1:${port}${pathStr}`, Object.assign({
    method,
    headers: { 'content-type': 'application/json', cookie: `session_token=${process.env.W1_TEST_TOKEN || 'wave1pg-token'}` },
    body: body === undefined ? undefined : JSON.stringify(body)
  }, opts));
  let json = null; try { json = await res.json(); } catch (e) {}
  return { status: res.status, json };
}

// 期望值（seedSingle 标准场景，reverse 后）
const EXP = {
  inv: 88,                       // 100-(5+7)
  pitShipped: 20, pitUnshipped: 30,
  piDeducted: 75, piAvailable: 125, piShipped: 100, piUnshipped: 400, // ratio=1 → 175-100；400-300；500-100
  piStatus: 'partial_shipped'
};

describe('Part B: 真实 PostgreSQL（R9/R10/R11/R13/AEL 锁语义）', () => {
  before(async () => {
    emb = await ensureEmbeddedPg();
    dataDir = emb.dataDir;
    testDsn = emb.dsn;
    admin = new Client({ connectionString: emb.dsn, ssl: { rejectUnauthorized: false } });
    await admin.connect();
    const ver = await admin.query('SELECT version() AS v');
    console.log('[W1-PG] server = ' + String(ver.rows[0].v).split(' on ')[0]);

    schema = 'w1t_' + Math.random().toString(36).slice(2, 10);
    await admin.query('CREATE SCHEMA "' + schema + '"');
    await admin.query('SET search_path TO "' + schema + '"');
    testDsn = emb.dsn + (emb.dsn.indexOf('?') >= 0 ? '&' : '?') + 'options=-csearch_path%3D' + encodeURIComponent(schema);

    // 全部表（真实生产类型）
    const pgSrc = fs.readFileSync(path.join(REPO, 'db-pg.js'), 'utf8');
    const tables = extractAllCreateTables(pgSrc);
    let created = 0; const errs = [];
    for (const t of tables) {
      try {
        await admin.query(t.ddl.replace('CREATE TABLE IF NOT EXISTS ' + t.table, 'CREATE TABLE IF NOT EXISTS "' + schema + '".' + t.table));
        created++;
      } catch (e) { errs.push(t.table + ': ' + String(e.message).slice(0, 100)); }
    }
    console.log(`[W1-PG] tables created = ${created}/${tables.length}` + (errs.length ? ' 失败: ' + errs.join(' | ') : ''));

    // 线上迁移列（db.js 生产迁移入口覆盖之外的部分，预先补齐）
    // 注：commercial_invoice_items.pi_id 生产同为带外添加（reverse 读取/写入依赖它）
    for (const col of [
      `ALTER TABLE "${schema}".commercial_invoice_items ADD COLUMN IF NOT EXISTS pi_id TEXT DEFAULT ''`,
      `ALTER TABLE "${schema}".commercial_invoices ADD COLUMN IF NOT EXISTS target_warehouse TEXT DEFAULT ''`,
      `ALTER TABLE "${schema}".commercial_invoices ADD COLUMN IF NOT EXISTS original_inventory_imported INTEGER DEFAULT 0`,
      `ALTER TABLE "${schema}".proforma_invoices ADD COLUMN IF NOT EXISTS target_warehouse TEXT DEFAULT ''`,
      `ALTER TABLE "${schema}".purchase_orders ADD COLUMN IF NOT EXISTS target_warehouse TEXT DEFAULT ''`,
      `ALTER TABLE "${schema}".packing_lists ADD COLUMN IF NOT EXISTS logistics_batch_id TEXT DEFAULT ''`
    ]) { try { await admin.query(col); } catch (e) { /* 已存在 */ } }

    // 镜像生产现状：旧版无条件拒绝触发器函数 + 触发器（生产为带外创建）
    await admin.query(OLD_FN_UPDATE);
    await admin.query(OLD_FN_DELETE);
    for (const ddl of TRIGGER_DDL) await admin.query(ddl);

    // ---- 全栈启动（先 env，再 db，再计数器/记录器，最后 server）----
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
      console.warn('[W1-PG] worker unref patch warn:', e && e.message);
    }

    const dbmod = require('../db');
    dbmod.initDatabase();

    // sync bridge 记录器（R13-runtime）：必须先替换 db 导出再 require('../server')
    const origFns = { query: dbmod.query, queryOne: dbmod.queryOne, run: dbmod.run, transaction: dbmod.transaction };
    const wrap = (name) => {
      const orig = origFns[name];
      dbmod[name] = function (...args) {
        if (recording) syncLog.push({ fn: name, sql: String(args[0] || '') });
        return orig.apply(this, args);
      };
    };
    wrap('query'); wrap('queryOne'); wrap('run');
    dbmod.transaction = function (fn) {
      if (recording) syncLog.push({ fn: 'transaction', sql: '[transaction]' });
      return origFns.transaction(fn);
    };

    const server = require('../server');
    await new Promise((resolve) => { srv = server.app.listen(0, () => { port = srv.address().port; resolve(); }); });

    // ---- 鉴权种子 ----
    const token = 'wave1pg-token';
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    await q(`INSERT INTO roles (id, name, description, permissions, is_system) VALUES ('role_w1pg','W1PG Role','', $1, 0)`,
      [JSON.stringify(['ci_view', 'ci_edit', 'user_manage'])]);
    await q(`INSERT INTO users (id, username, name, password, role_id, status) VALUES ('user_w1pg','w1pg','W1PG Tester','','role_w1pg','active')`);
    await q(`INSERT INTO sessions (id, token_hash, user_id, created_at, expires_at) VALUES ('sess_w1pg',$1,'user_w1pg', to_char(NOW(),'YYYY-MM-DD HH24:MI:SS'), to_char(NOW()+INTERVAL '1 day','YYYY-MM-DD HH24:MI:SS'))`, [tokenHash]);
    process.env.W1_TEST_TOKEN = token;
    console.log('[W1-PG] server up on 127.0.0.1:' + port);
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
      } catch (e) { console.warn('[W1-PG] schema cleanup warn:', e.message); }
      try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (e) {}
    }
  });

  test('B1-R1: 正常 reverse（parity smoke）+ trigger guard 自愈（保护不降级）', { timeout: 120000 }, async () => {
    const f = await seedSingle('P1');
    // 部署前现状证明：旧函数无条件拒绝 locked 行 UPDATE
    const probe = new Client({ connectionString: testDsn, ssl: { rejectUnauthorized: false } });
    await probe.connect();
    let rejectedPre = false;
    try { await probe.query(`UPDATE wac_history SET confirmation_status='probe' WHERE id='wac_P1'`); }
    catch (e) { rejectedPre = /LOCKED_WAC_HISTORY_UPDATE_FORBIDDEN/.test(e.message); }
    assert.ok(rejectedPre, '部署前：旧函数必须拒绝 locked 行 UPDATE（基线保护存在）');

    const r = await fetchJSON('POST', '/api/commercial-invoices/ci_P1/reverse');
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual(r.json, { success: true, id: 'ci_P1', ci_no: 'CI-P1' });

    assert.equal((await q1(`SELECT ci_status, wac_confirmed, cost_confirmed FROM commercial_invoices WHERE id='ci_P1'`)).ci_status, 'reversed');
    assert.equal((await q1(`SELECT available_qty FROM inventory WHERE sku_code=$1 AND country='ID' AND warehouse='WH1'`, [f.sku])).available_qty, EXP.inv);
    const pit = await q1(`SELECT shipped_qty, unshipped_qty FROM proforma_invoice_items WHERE id='pii_P1'`);
    assert.equal(Number(pit.shipped_qty), EXP.pitShipped); assert.equal(Number(pit.unshipped_qty), EXP.pitUnshipped);
    const pi = await q1(`SELECT deducted_deposit, available_deduct_deposit, shipped_amount, unshipped_amount, pi_status FROM proforma_invoices WHERE id='pi_P1'`);
    assert.equal(Number(pi.deducted_deposit), EXP.piDeducted); assert.equal(Number(pi.available_deduct_deposit), EXP.piAvailable);
    assert.equal(Number(pi.shipped_amount), EXP.piShipped); assert.equal(Number(pi.unshipped_amount), EXP.piUnshipped);
    assert.equal(pi.pi_status, EXP.piStatus);
    const ibs = await q(`SELECT inbound_status FROM inbound_records WHERE source_ci_id='ci_P1'`);
    assert.equal(ibs.length, 2); ibs.forEach((b) => assert.equal(b.inbound_status, 'reversed'));
    const wac = await q1(`SELECT is_locked, confirmation_status FROM wac_history WHERE id='wac_P1'`);
    assert.equal(Number(wac.is_locked), 0); assert.equal(wac.confirmation_status, 'reversed');
    assert.equal((await q1(`SELECT ci_id FROM cost_allocations WHERE id='ca_P1'`)).ci_id, '');
    assert.equal((await q1(`SELECT lifecycle_status FROM payable_items WHERE id='pay_P1'`)).lifecycle_status, 'released');
    assert.equal(ibs.length, 2);

    // 守卫自愈已生效：pg_proc 函数体含 app.wac_unlock
    const fnRow = await q1(`SELECT prosrc FROM pg_proc WHERE proname='trg_block_wac_history_update'`);
    assert.ok(fnRow && String(fnRow.prosrc).indexOf('app.wac_unlock') >= 0, '守卫函数必须已自愈应用');
    // fail-secure 不降级：新插入的 locked 行，普通事务仍然拒绝
    await q(`INSERT INTO wac_history (id, version_no, ci_id, ci_no, sku_code, country, warehouse, is_locked, confirmation_status)
           VALUES ('wac_P1b',1,'ci_ghost','CI-GHOST',$1,'ID','WH1',1,'confirmed')`, [f.sku]);
    let rejectedPost = false;
    try { await probe.query(`UPDATE wac_history SET confirmation_status='probe' WHERE id='wac_P1b'`); }
    catch (e) { rejectedPost = /LOCKED_WAC_HISTORY_UPDATE_FORBIDDEN/.test(e.message); }
    assert.ok(rejectedPost, '部署后：守卫函数 fail-secure —— 普通事务仍必须拒绝 locked 行 UPDATE');
    await probe.end();
  });

  test('B2-R2: 顺序二次 reverse → 400 + 不重复扣减', { timeout: 60000 }, async () => {
    const before = (await q1(`SELECT available_qty FROM inventory WHERE id='inv_P1'`)).available_qty;
    const r = await fetchJSON('POST', '/api/commercial-invoices/ci_P1/reverse');
    assert.strictEqual(r.status, 400);
    assert.equal(r.json.error, '该 CI 已冲销，不能重复冲销');
    const after = (await q1(`SELECT available_qty FROM inventory WHERE id='inv_P1'`)).available_qty;
    assert.equal(Number(after), Number(before), '库存不得二次扣减');
  });

  test('B3-R9: 并发同 CI reverse —— 恰好一个 200，无 double decrement', { timeout: 90000 }, async () => {
    const f = await seedSingle('P9');
    const [a, b] = await Promise.all([
      fetchJSON('POST', '/api/commercial-invoices/ci_P9/reverse'),
      fetchJSON('POST', '/api/commercial-invoices/ci_P9/reverse')
    ]);
    const statuses = [a.status, b.status].sort();
    assert.deepEqual(statuses, [200, 400], '必须恰好一个成功一个失败: ' + JSON.stringify([a.json, b.json]));
    const okOne = a.status === 200 ? a : b;
    assert.deepEqual(okOne.json, { success: true, id: 'ci_P9', ci_no: 'CI-P9' });
    assert.equal(Number((await q1(`SELECT available_qty FROM inventory WHERE id='inv_P9'`)).available_qty), EXP.inv,
      '库存只允许被扣减一次');
    assert.equal(Number((await q1(`SELECT is_locked FROM wac_history WHERE id='wac_P9'`)).is_locked), 0);
    assert.equal((await q1(`SELECT ci_status FROM commercial_invoices WHERE id='ci_P9'`)).ci_status, 'reversed');
  });

  test('B4-R10: 并发共享 PI / 不同 CI —— 两个都成功且无 lost update', { timeout: 90000 }, async () => {
    const f = await seedShared('P10');
    const [a, b] = await Promise.all([
      fetchJSON('POST', '/api/commercial-invoices/' + f.ciA + '/reverse'),
      fetchJSON('POST', '/api/commercial-invoices/' + f.ciB + '/reverse')
    ]);
    assert.equal(a.status, 200, JSON.stringify(a.json));
    assert.equal(b.status, 200, JSON.stringify(b.json));
    const pi = await q1(`SELECT deducted_deposit, available_deduct_deposit, shipped_amount, unshipped_amount, pi_status FROM proforma_invoices WHERE id=$1`, [f.piId]);
    assert.equal(Number(pi.deducted_deposit), 75, '175-60-40=75（FOR UPDATE 串行化，无丢失更新）');
    assert.equal(Number(pi.available_deduct_deposit), 125);
    assert.equal(Number(pi.shipped_amount), 0, '400-300-50=0（两次扣减都生效）');
    assert.equal(Number(pi.unshipped_amount), 500);
    const pit = await q1(`SELECT shipped_qty, unshipped_qty FROM proforma_invoice_items WHERE id='pii_P10'`);
    assert.equal(Number(pit.shipped_qty), 0, '80-30-50=0');
    assert.equal(Number(pit.unshipped_qty), 80);
    assert.equal(pi.pi_status, 'pending', 'shipped 0 → pending');
  });

  test('B5-R8: 中途失败（注入列缺失）→ 整体 ROLLBACK', { timeout: 90000 }, async () => {
    const f = await seedSingle('P8');
    await admin.query(`ALTER TABLE cost_allocations RENAME COLUMN ci_id TO ci_id_w1bak`);
    let resp;
    try {
      resp = await fetchJSON('POST', '/api/commercial-invoices/ci_P8/reverse');
    } finally {
      await admin.query(`ALTER TABLE cost_allocations RENAME COLUMN ci_id_w1bak TO ci_id`);
    }
    assert.strictEqual(resp.status, 500, JSON.stringify(resp.json));
    assert.equal((await q1(`SELECT ci_status FROM commercial_invoices WHERE id='ci_P8'`)).ci_status, 'inbound_complete', 'CI 必须回滚');
    assert.equal(Number((await q1(`SELECT available_qty FROM inventory WHERE id='inv_P8'`)).available_qty), 100, '库存必须回滚');
    assert.equal(Number((await q1(`SELECT is_locked FROM wac_history WHERE id='wac_P8'`)).is_locked), 1, 'WAC 必须仍锁定');
    assert.equal((await q1(`SELECT lifecycle_status FROM payable_items WHERE id='pay_P8'`)).lifecycle_status, 'active', 'payable 必须未释放');
    const ib = await q1(`SELECT inbound_status FROM inbound_records WHERE source_ci_id='ci_P8'`);
    assert.equal(ib.inbound_status, 'completed', 'inbound 必须回滚');
    // 列恢复确认
    assert.ok(await q1(`SELECT 1 FROM information_schema.columns WHERE table_name='cost_allocations' AND column_name='ci_id'`), 'ci_id 列必须恢复');
  });

  test('B6-R11: SET LOCAL 守卫生命周期（fail-secure）', { timeout: 90000 }, async () => {
    const sku = 'SKU-R11';
    for (const id of ['wac_r11a', 'wac_r11b', 'wac_r11c', 'wac_r11d', 'wac_r11e']) {
      await q(`INSERT INTO wac_history (id, version_no, ci_id, ci_no, sku_code, country, warehouse, is_locked, confirmation_status)
             VALUES ($1,1,'ci_ghost_r11','CI-GHOST',$2,'ID','WH1',1,'confirmed')`, [id, sku]);
    }
    const mk = () => new Client({ connectionString: testDsn, ssl: { rejectUnauthorized: false } });

    // (a) 普通事务：locked 行拒绝
    {
      const c = mk(); await c.connect();
      let rejected = false;
      try { await c.query(`UPDATE wac_history SET confirmation_status='probe' WHERE id='wac_r11a'`); }
      catch (e) { rejected = /LOCKED_WAC_HISTORY_UPDATE_FORBIDDEN/.test(e.message); }
      assert.ok(rejected, '(a) 普通事务必须拒绝 locked 行 UPDATE');
      await c.end();
    }
    // (b) SET LOCAL（set_config is_local=true）事务内允许受控解锁
    {
      const c = mk(); await c.connect();
      await c.query('BEGIN');
      await c.query(`SELECT set_config('app.wac_unlock', '1', true)`);
      const r = await c.query(`UPDATE wac_history SET is_locked=0, confirmation_status='reversed' WHERE id='wac_r11b'`);
      assert.equal(r.rowCount, 1, '(b) SET LOCAL 后本事务允许解锁');
      await c.query('COMMIT');
      const row = await q1(`SELECT is_locked FROM wac_history WHERE id='wac_r11b'`);
      assert.equal(Number(row.is_locked), 0);
      await c.end();
    }
    // (c) COMMIT 后新事务（无 setting）→ 再次拒绝（权限已随事务消失）
    {
      const c = mk(); await c.connect();
      let rejected = false;
      try { await c.query(`UPDATE wac_history SET confirmation_status='probe' WHERE id='wac_r11c'`); }
      catch (e) { rejected = /LOCKED_WAC_HISTORY_UPDATE_FORBIDDEN/.test(e.message); }
      assert.ok(rejected, '(c) COMMIT 后 setting 必须消失，locked 行仍拒绝');
      await c.end();
    }
    // (d) ROLLBACK 后 → 拒绝
    {
      const c = mk(); await c.connect();
      await c.query('BEGIN');
      await c.query(`SELECT set_config('app.wac_unlock', '1', true)`);
      await c.query(`UPDATE wac_history SET confirmation_status='probe' WHERE id='wac_r11d'`);
      await c.query('ROLLBACK');
      const row = await q1(`SELECT is_locked, confirmation_status FROM wac_history WHERE id='wac_r11d'`);
      assert.equal(Number(row.is_locked), 1, '(d) ROLLBACK 后解锁必须回滚');
      let rejected = false;
      try { await c.query(`UPDATE wac_history SET confirmation_status='probe2' WHERE id='wac_r11d'`); }
      catch (e) { rejected = /LOCKED_WAC_HISTORY_UPDATE_FORBIDDEN/.test(e.message); }
      assert.ok(rejected, '(d) ROLLBACK 后新语句仍拒绝');
      await c.end();
    }
    // (e) 非法值（非 '1'）→ fail-secure 拒绝
    {
      const c = mk(); await c.connect();
      await c.query('BEGIN');
      await c.query(`SELECT set_config('app.wac_unlock', '0', true)`);
      let rejected = false;
      try { await c.query(`UPDATE wac_history SET confirmation_status='probe' WHERE id='wac_r11e'`); }
      catch (e) { rejected = /LOCKED_WAC_HISTORY_UPDATE_FORBIDDEN/.test(e.message); }
      assert.ok(rejected, "(e) 非 '1' 值必须 fail-secure 拒绝");
      await c.query('ROLLBACK');
      await c.end();
    }
  });

  test('B7-R13: reverse 请求窗口内 sync bridge 零核心 SQL（唯一 sync = COMMIT 后审计）', { timeout: 90000 }, async () => {
    const f = await seedSingle('P13');
    syncLog = [];
    recording = true;
    let r;
    try { r = await fetchJSON('POST', '/api/commercial-invoices/ci_P13/reverse'); }
    finally { recording = false; }
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    const forbidden = syncLog.filter((e) => CORE_SYNC_FORBIDDEN.some((re) => re.test(e.sql)));
    assert.deepEqual(forbidden.map((e) => ({ fn: e.fn, sql: e.sql.slice(0, 120) })), [],
      'reverse 核心 SQL 不得经过 sync bridge，实际: ' + JSON.stringify(forbidden));
    const audit = syncLog.find((e) => /INSERT\s+INTO\s+operation_logs/i.test(e.sql));
    assert.ok(audit, 'COMMIT 后必须仍有一次 sync 审计写入（logOperation，P2 债务口径）');
    // 核心事实确实写入了（走 async 事务）
    assert.equal((await q1(`SELECT ci_status FROM commercial_invoices WHERE id='ci_P13'`)).ci_status, 'reversed');
    assert.equal(Number((await q1(`SELECT available_qty FROM inventory WHERE id='inv_P13'`)).available_qty), EXP.inv);
  });

  test('B8-AEL: reverse 与并发读共存 + 旧路径 trigger DDL 锁级别实证（ShareRowExclusive）+ 写阻塞证明', { timeout: 120000 }, async () => {
    // (1) 行为证明：client B 开读事务持有 wac_history AccessShareLock；reverse 必须照常完成
    //    （新路径与读并发无碍。注：经真机实证，旧路径的 trigger DDL 拿 ShareRowExclusiveLock，
    //     与读也不冲突 —— 故本项为"不退化"证据；旧路径的真实风险在 (2)(3) 实证。）
    const f = await seedSingle('P14');
    const b = new Client({ connectionString: testDsn, ssl: { rejectUnauthorized: false } });
    await b.connect();
    await b.query('BEGIN');
    await b.query('SELECT 1 FROM wac_history LIMIT 1'); // AccessShareLock，事务保持打开
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 20000);
    let r;
    try { r = await fetchJSON('POST', '/api/commercial-invoices/ci_P14/reverse', undefined, { signal: ac.signal }); }
    finally { clearTimeout(timer); }
    await b.query('ROLLBACK');
    await b.end();
    assert.strictEqual(r.status, 200, '并发读事务持有期间 reverse 必须完成: ' + JSON.stringify(r.json || {}));

    // (2) 旧路径锁级别实证（真机 PG 16.15）：ALTER TABLE ... DISABLE TRIGGER 拿
    //    ShareRowExclusiveLock（非 AccessExclusiveLock）。transactional DDL → ROLLBACK
    //    自动恢复触发器 enabled，零残留。
    const c2 = new Client({ connectionString: testDsn, ssl: { rejectUnauthorized: false } });
    await c2.connect();
    await c2.query('BEGIN');
    await c2.query('ALTER TABLE wac_history DISABLE TRIGGER trg_wac_history_block_update');
    const modes = (await c2.query(`SELECT mode FROM pg_locks WHERE relation = 'wac_history'::regclass`)).rows.map((x) => x.mode);
    await c2.query('ROLLBACK');
    await c2.end();
    assert.ok(modes.includes('ShareRowExclusiveLock'),
      'trigger DDL 实证锁级别必须为 ShareRowExclusiveLock，实际: ' + JSON.stringify(modes));
    const trig = await q1(`SELECT tgenabled FROM pg_trigger WHERE tgrelid='wac_history'::regclass AND tgname='trg_wac_history_block_update'`);
    assert.equal(trig.tgenabled, 'O', 'ROLLBACK 后触发器必须恢复 enabled（零残留）');

    // (3) 写阻塞证明：未决事务持有 ShareRowExclusive 期间，其他连接对 wac_history 的
    //    UPDATE（哪怕是被解锁的行）也被阻塞 → 旧路径在 reverse 全事务期间阻塞 WAC 写。
    const b3 = new Client({ connectionString: testDsn, ssl: { rejectUnauthorized: false } });
    await b3.connect();
    await b3.query('BEGIN');
    await b3.query('ALTER TABLE wac_history DISABLE TRIGGER trg_wac_history_block_update');
    const c3 = new Client({ connectionString: testDsn, ssl: { rejectUnauthorized: false } });
    await c3.connect();
    await c3.query(`SET lock_timeout = '1200ms'`);
    let writeBlocked = false;
    try { await c3.query(`UPDATE wac_history SET confirmation_status='probe' WHERE id='wac_r11b'`); }
    catch (e) { writeBlocked = true; }
    await b3.query('ROLLBACK');
    await b3.end();
    await c3.end();
    assert.ok(writeBlocked, 'ShareRowExclusive 持有期间 wac_history 写必须被阻塞（旧路径风险实证）');
  });
});
