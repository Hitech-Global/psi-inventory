// ============================================================================
// Part C: Phantom duplicate concurrency proof（真 PG 16.15 嵌入式）
//
// 用户 gate 一~七（2026-09-06）：duplicate fail-closed guard 的 phantom insert
// 风险核查 —— 「guard 通过后、mutation 前另一事务 INSERT 相同 logical key」。
//
// 生产 metadata 实测（phantom-gate-probe-readonly.cjs，2026-09-06）：
//   1. inventory 存在带外 UNIQUE 约束 uq_inventory_key(sku_code, country,
//      warehouse)（代码库 db*.js 均无 → harness 显式镜像生产现状）；
//      NULL 键行 = 0 → UNIQUE 无 NULL 绕过。
//   2. proforma_invoice_items(pi_id, sku) 无 UNIQUE（仅 PK id）→ 保护 =
//      parent-lock 提交串行化：全部 3 条 INSERT 路径（server.js:8632 新建 PI
//      全新 genId / :8808 PUT 有 getPILockReason 守卫互斥 / :10262 batch-import
//      事务内必 UPDATE proforma_invoices 同一 header 行）或 key 空间不相交、
//      或其提交点被 header 行锁串行化于 reverse FOR UPDATE 之后。
//
// 本文件用确定性交错证明：
//   C0  harness 镜像生产 metadata（UNIQUE 在 / pi_items 无 UNIQUE）
//   C1  inventory 并发同键 INSERT → 必被 uq_inventory_key 拒绝（23505）
//   C2  并发 PI item 写事务的提交点被 reverse 的 header FOR UPDATE 串行化
//       （T2 持 header 锁 → reverse 阻塞 → T2 提交 → reverse 基于含 T2 提交
//        事实的快照执行且结果正确）
//   C3  预置 (pi_id,sku) 重复（模拟 batch-import 无守卫追加的产物）→
//       guard B fail-closed 409，库存零扣减
// 运行：node --test --test-force-exit test/wave1-phantom-concurrency.test.cjs
// ============================================================================
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
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

// 旧版触发器函数（镜像生产带外创建的现状）
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

let emb, admin, srv, port, schema, testDsn, dataDir;

async function q(sql, params) { return (await admin.query(sql, params)).rows; }
async function q1(sql, params) { return (await q(sql, params))[0] || null; }

// seedSingle（与 Part B 同构：标准可 reverse 场景）
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

async function fetchJSON(method, pathStr, body, opts = {}) {
  const res = await fetch(`http://127.0.0.1:${port}${pathStr}`, Object.assign({
    method,
    headers: { 'content-type': 'application/json', cookie: `session_token=${process.env.W1_TEST_TOKEN || 'wave1pg-token'}` },
    body: body === undefined ? undefined : JSON.stringify(body)
  }, opts));
  let json = null; try { json = await res.json(); } catch (e) {}
  return { status: res.status, json };
}

// 期望值（seedSingle 标准场景，reverse 后，与 Part B EXP 一致）
const EXP = {
  inv: 88,
  pitShipped: 20, pitUnshipped: 30,
  piDeducted: 75, piAvailable: 125, piShipped: 100, piUnshipped: 400,
  piStatus: 'partial_shipped'
};

describe('Part C: Phantom duplicate concurrency proof（真 PG）', () => {
  before(async () => {
    emb = await ensureEmbeddedPg();
    dataDir = emb.dataDir;
    testDsn = emb.dsn;
    admin = new Client({ connectionString: emb.dsn, ssl: { rejectUnauthorized: false } });
    await admin.connect();

    schema = 'w1c_' + Math.random().toString(36).slice(2, 10);
    await admin.query('CREATE SCHEMA "' + schema + '"');
    await admin.query('SET search_path TO "' + schema + '"');
    testDsn = emb.dsn + (emb.dsn.indexOf('?') >= 0 ? '&' : '?') + 'options=-csearch_path%3D' + encodeURIComponent(schema);

    const pgSrc = fs.readFileSync(path.join(REPO, 'db-pg.js'), 'utf8');
    const tables = extractAllCreateTables(pgSrc);
    let created = 0; const errs = [];
    for (const t of tables) {
      try {
        await admin.query(t.ddl.replace('CREATE TABLE IF NOT EXISTS ' + t.table, 'CREATE TABLE IF NOT EXISTS "' + schema + '".' + t.table));
        created++;
      } catch (e) { errs.push(t.table + ': ' + String(e.message).slice(0, 100)); }
    }
    console.log(`[W1-PHC] tables created = ${created}/${tables.length}` + (errs.length ? ' 失败: ' + errs.join(' | ') : ''));

    for (const col of [
      `ALTER TABLE "${schema}".commercial_invoice_items ADD COLUMN IF NOT EXISTS pi_id TEXT DEFAULT ''`,
      `ALTER TABLE "${schema}".commercial_invoices ADD COLUMN IF NOT EXISTS target_warehouse TEXT DEFAULT ''`,
      `ALTER TABLE "${schema}".commercial_invoices ADD COLUMN IF NOT EXISTS original_inventory_imported INTEGER DEFAULT 0`,
      `ALTER TABLE "${schema}".proforma_invoices ADD COLUMN IF NOT EXISTS target_warehouse TEXT DEFAULT ''`,
      `ALTER TABLE "${schema}".purchase_orders ADD COLUMN IF NOT EXISTS target_warehouse TEXT DEFAULT ''`,
      `ALTER TABLE "${schema}".packing_lists ADD COLUMN IF NOT EXISTS logistics_batch_id TEXT DEFAULT ''`
    ]) { try { await admin.query(col); } catch (e) { /* 已存在 */ } }

    // 镜像生产带外 UNIQUE 约束（生产实测存在，代码库无 → 测试 harness 显式镜像）
    // 生产为 CONSTRAINT (type=u)，底层即 UNIQUE INDEX，强制语义等价
    await admin.query(`CREATE UNIQUE INDEX IF NOT EXISTS "uq_inventory_key" ON "${schema}".inventory (sku_code, country, warehouse)`);

    await admin.query(OLD_FN_UPDATE);
    await admin.query(OLD_FN_DELETE);
    for (const ddl of TRIGGER_DDL) await admin.query(ddl);

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
      console.warn('[W1-PHC] worker unref patch warn:', e && e.message);
    }

    const dbmod = require('../db');
    dbmod.initDatabase();

    const server = require('../server');
    await new Promise((resolve) => { srv = server.app.listen(0, () => { port = srv.address().port; resolve(); }); });

    const token = 'wave1pg-token';
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    await q(`INSERT INTO roles (id, name, description, permissions, is_system) VALUES ('role_w1c','W1C Role','', $1, 0)`,
      [JSON.stringify(['ci_view', 'ci_edit', 'user_manage'])]);
    await q(`INSERT INTO users (id, username, name, password, role_id, status) VALUES ('user_w1c','w1c','W1C Tester','','role_w1c','active')`);
    await q(`INSERT INTO sessions (id, token_hash, user_id, created_at, expires_at) VALUES ('sess_w1c',$1,'user_w1c', to_char(NOW(),'YYYY-MM-DD HH24:MI:SS'), to_char(NOW()+INTERVAL '1 day','YYYY-MM-DD HH24:MI:SS'))`, [tokenHash]);
    process.env.W1_TEST_TOKEN = token;
    console.log('[W1-PHC] server up on 127.0.0.1:' + port);
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
      } catch (e) { console.warn('[W1-PHC] schema cleanup warn:', e.message); }
      try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (e) {}
    }
  });

  test('C0: harness 必须镜像生产 metadata（uq_inventory_key 在 / pi_items 无业务键 UNIQUE）', { timeout: 60000 }, async () => {
    const idx = await q(`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname=current_schema() AND tablename='inventory'`);
    const uq = idx.find((r) => r.indexdef.indexOf('CREATE UNIQUE INDEX uq_inventory_key') === 0 || r.indexname === 'uq_inventory_key');
    assert.ok(uq, 'inventory 必须有 uq_inventory_key（镜像生产带外约束）');
    assert.ok(/sku_code.*country.*warehouse|country.*warehouse.*sku_code/.test(uq.indexdef), 'uq_inventory_key 键列必须为 sku_code+country+warehouse: ' + uq.indexdef);

    const pitIdx = await q(`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname=current_schema() AND tablename='proforma_invoice_items'`);
    const bizUnique = pitIdx.filter((r) => r.indexdef.indexOf('CREATE UNIQUE') === 0 && r.indexname !== 'proforma_invoice_items_pkey');
    assert.equal(bizUnique.length, 0, 'proforma_invoice_items 必须无业务键 UNIQUE（与生产一致，保护=parent-lock 串行化）: ' + JSON.stringify(bizUnique));
  });

  test('C1: inventory 并发同键 INSERT 必被 uq_inventory_key 拒绝（23505）', { timeout: 120000 }, async () => {
    // (a) 对已提交行的普通重复 INSERT → 立即 23505
    await seedSingle('C1A');
    const dup = new Client({ connectionString: testDsn, ssl: { rejectUnauthorized: false } });
    await dup.connect();
    let dupCode = null;
    try {
      await dup.query(`INSERT INTO inventory (id, sku_code, country, warehouse, available_qty) VALUES ('inv_C1A_dup','SKU-C1A','ID','WH1',1)`);
    } catch (e) { dupCode = e.code; }
    await dup.end();
    assert.equal(dupCode, '23505', '对已提交同键行的 INSERT 必须被 uq_inventory_key 拒绝');

    // (b) 确定性并发：T1 未提交 INSERT(K2) → T2 INSERT(K2) 阻塞 → T1 COMMIT → T2 醒来 23505
    const t1 = new Client({ connectionString: testDsn, ssl: { rejectUnauthorized: false } });
    const t2 = new Client({ connectionString: testDsn, ssl: { rejectUnauthorized: false } });
    await t1.connect(); await t2.connect();
    await t1.query('BEGIN');
    await t1.query(`INSERT INTO inventory (id, sku_code, country, warehouse, available_qty) VALUES ('inv_C1B_t1','SKU-C1B','ID','WH1',10)`);
    const t2p = t2.query(`INSERT INTO inventory (id, sku_code, country, warehouse, available_qty) VALUES ('inv_C1B_t2','SKU-C1B','ID','WH1',20)`);
    let t2Done = false;
    t2p.then(() => { t2Done = true; }, () => { t2Done = true; });
    await sleep(700);
    assert.ok(!t2Done, 'T2 的同键 INSERT 必须阻塞等待 T1 未提交插入（uniqueness wait）');
    await t1.query('COMMIT');
    let t2Code = null;
    try { await t2p; } catch (e) { t2Code = e.code; }
    await t1.end(); await t2.end();
    assert.equal(t2Code, '23505', 'T1 提交后 T2 必须以 23505（unique_violation）失败');
  });

  test('C2: 并发 PI item 写事务的提交点被 reverse 的 header FOR UPDATE 串行化', { timeout: 120000 }, async () => {
    const f = await seedSingle('C2');
    // T2：模拟 batch-import 行事务——先持 header 行锁（其提交必经点）
    const t2 = new Client({ connectionString: testDsn, ssl: { rejectUnauthorized: false } });
    await t2.connect();
    await t2.query('BEGIN');
    await t2.query(`UPDATE proforma_invoices SET remark = 't2-hold' WHERE id = $1`, [f.piId]);

    // reverse 启动：W1-5 对 pi_C2 的 FOR UPDATE 必须被 T2 阻塞
    let revResult = null; let revDone = false;
    const revp = fetchJSON('POST', '/api/commercial-invoices/ci_C2/reverse')
      .then((r) => { revResult = r; revDone = true; }, (e) => { revResult = { status: 0, json: { error: e.message } }; revDone = true; });
    await sleep(900);
    assert.ok(!revDone, 'T2 持有 header 行锁期间 reverse 必须阻塞（FOR UPDATE 串行化）');

    // T2 在持锁期间追加 item（不同 SKU，模拟 batch-import 向已有 PI 追加新明细行）
    await t2.query(`INSERT INTO proforma_invoice_items (id, pi_id, pi_no, po_no, sku_code, po_qty, pi_confirmed_qty, unit_price, pi_amount, shipped_qty, unshipped_qty)
                    VALUES ('pii_C2_t2', $1, 'PI-C2', '', 'SKU-C2X', 0, 5, 0, 0, 0, 5)`, [f.piId]);
    await t2.query('COMMIT'); // 提交点：reverse 解除阻塞、基于含 T2 事实的快照继续

    await revp;
    assert.equal(revResult.status, 200, 'T2 提交后 reverse 必须完成: ' + JSON.stringify(revResult.json || {}));

    // reverse 结果正确（基于含 T2 item 的最新已提交快照，互不污染）
    const inv = await q1(`SELECT available_qty FROM inventory WHERE id='inv_C2'`);
    assert.equal(inv.available_qty, EXP.inv, '库存扣减必须正确');
    const pit = await q1(`SELECT shipped_qty, unshipped_qty FROM proforma_invoice_items WHERE id='pii_C2'`);
    assert.equal(pit.shipped_qty, EXP.pitShipped, 'CI 关联 item shipped 回退正确');
    assert.equal(pit.unshipped_qty, EXP.pitUnshipped, 'CI 关联 item unshipped 重算正确');
    const t2item = await q1(`SELECT shipped_qty, unshipped_qty FROM proforma_invoice_items WHERE id='pii_C2_t2'`);
    assert.ok(t2item, 'T2 追加的 item 必须存在（未被 reverse 误删/误改）');
    assert.equal(t2item.shipped_qty, 0, 'T2 item shipped 不受影响');
    assert.equal(t2item.unshipped_qty, 5, 'T2 item unshipped 不受影响');
    await t2.end();
  });

  test('C3: 预置 (pi_id,sku) 重复 → guard B fail-closed 400，库存零扣减', { timeout: 120000 }, async () => {
    const f = await seedSingle('C3');
    // 模拟 batch-import 无守卫追加产生的同键重复（guard B 要拦截的历史异常形态）
    await q(`INSERT INTO proforma_invoice_items (id, pi_id, pi_no, po_no, sku_code, po_qty, pi_confirmed_qty, unit_price, pi_amount, shipped_qty, unshipped_qty)
             VALUES ('pii_C3_dup', $1, 'PI-C3', '', $2, 0, 20, 0, 0, 10, 10)`, [f.piId, f.sku]);

    const r = await fetchJSON('POST', '/api/commercial-invoices/ci_C3/reverse');
    // 实现返回 400（与 legacy 业务拒绝一致），文案 = 用户 gate 指定文案 + 重复键明细
    assert.equal(r.status, 400, '重复键必须 fail-closed 拒绝: ' + JSON.stringify(r.json || {}));
    assert.ok(String((r.json || {}).error || '').includes('检测到关联数据异常，无法安全撤销 CI，请先处理重复数据'),
      '错误文案必须包含 gate 指定文案: ' + JSON.stringify(r.json));

    const inv = await q1(`SELECT available_qty FROM inventory WHERE id='inv_C3'`);
    assert.equal(inv.available_qty, 100, 'fail-closed 后库存必须零扣减');
    const ci = await q1(`SELECT ci_status FROM commercial_invoices WHERE id='ci_C3'`);
    assert.equal(ci.ci_status, 'inbound_complete', 'CI 状态必须未被改动');
  });
});
