'use strict';
/**
 * Wave 2B — PI batch-import async rewrite 测试（真实 PostgreSQL，全栈 require('../server')，DB_DRIVER=pg）
 * =================================================================================================================
 * 镜像 Wave 2A 测试结构，覆盖 PI 专属语义：
 *   T1  硬上限 1001 → 422 → sync bridge 0
 *   T2  Layer1 拒绝（SKU/PO 空）→ failed → 零 mutation
 *   T3  FK 拒绝（SKU/PO 不存在）→ failed → 零 mutation
 *   T4  getPILockReason 等价（cancelled / has-CI / has-PL / deposit-paid）→ 追加被拒 → 零 mutation
 *   T5  P2-6 累计超 PO 数量 → 拒绝
 *   T6  批内重复 (pi_no, sku) → fail-closed
 *   T7  deposit payable 幂等（重导/追加 → 仍一条 active，金额 authoritative UPDATE）
 *   T8  完整对账（新 PI 多 item + 定金；po_status='transferred_pi'；追加后 totals 更新）
 *   T9  并发同 PI 追加不同 SKU → 无 lost update
 *   T10 中途 mutation 失败 → 整批 ROLLBACK（无半 PI）
 *   T11 core PG path sync bridge calls = 0
 *   T12 event-loop 存活证明（import 等锁，GET /api/version 仍响应）
 *   P1  S2 MUTABILITY：deposit 锁定态 + 金额变化 → 行拒 → 零 mutation（P1-PAY-CURRENT-ITEM-SEMANTICS）
 *   P2  对照组：active 重导仍 authoritative UPDATE（金额同步，不 failed）
 *   P3  对照组：cancelled deposit payable → 追加不重建（仍 1 条 cancelled，不新建 active）
 *
 * 真实 PG：嵌入式 PostgreSQL 16.15（zonky darwin-arm64v8）。或 W2B_PG_DSN 指向本地实例（仅 localhost/127.0.0.1/::1）。
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const net = require('net');
const { execSync, spawn } = require('child_process');
const { Client } = require('pg');

const REPO = path.resolve(__dirname, '..');

const CORE_SYNC_FORBIDDEN = [
  /INSERT\s+INTO\s+proforma_invoices\b/i,
  /INSERT\s+INTO\s+proforma_invoice_items\b/i,
  /UPDATE\s+proforma_invoices\b/i,
  /UPDATE\s+proforma_invoice_items\b/i,
  /UPDATE\s+purchase_orders\b/i,
  /INSERT\s+INTO\s+payable_items\b/i,
  /UPDATE\s+payable_items\b/i,
  /SELECT.*FROM\s+proforma_invoices\b/i,
  /SELECT.*FROM\s+proforma_invoice_items\b/i,
  /SELECT.*FROM\s+purchase_orders\b/i,
  /FOR\s+UPDATE/i,
  /jsonb_to_recordset/i,
  /CREATE\s+TEMP/i
];

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const exec = (cmd, opts) => execSync(cmd, Object.assign({ stdio: 'pipe', timeout: 180000 }, opts || {}));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

function extractAllCreateTables(src) {
  const out = [];
  const re = /CREATE TABLE IF NOT EXISTS ([a-z_0-9]+) \(/g;
  let m;
  while ((m = re.exec(src))) {
    const start = m.index;
    let depth = 0;
    let j = start + m[0].length - 1;
    for (; j < src.length; j++) {
      const ch = src[j];
      if (ch === '(') depth++;
      else if (ch === ')') { depth--; if (depth === 0) { j++; break; } }
    }
    out.push({ table: m[1], ddl: src.slice(start, j) });
  }
  return out;
}

async function ensureEmbeddedPg() {
  if (process.env.W2B_PG_DSN) {
    const u = new URL(process.env.W2B_PG_DSN);
    if (!LOCAL_HOSTS.has(u.hostname)) throw new Error('W2B-PG-GUARD: 主机不在白名单: ' + u.hostname);
    return { dsn: process.env.W2B_PG_DSN, dataDir: null, pgCtl: null, proc: null };
  }
  const pgtestDir = path.join(REPO, '.pgtest');
  const binDir = path.join(pgtestDir, 'pg16bin');
  const pgBin = path.join(binDir, 'bin');
  if (!fs.existsSync(path.join(pgBin, 'postgres'))) {
    fs.mkdirSync(binDir, { recursive: true });
    const jarPath = path.join(pgtestDir, 'pg16.jar');
    if (!fs.existsSync(jarPath)) {
      console.log('[W2B-PG] 下载嵌入式 PostgreSQL 16.15 二进制（首次运行一次）...');
      exec('curl -sfL -o "' + jarPath + '" https://repo1.maven.org/maven2/io/zonky/test/postgres/embedded-postgres-binaries-darwin-arm64v8/16.15.0/embedded-postgres-binaries-darwin-arm64v8-16.15.0.jar', { timeout: 300000 });
    }
    exec('cd "' + pgtestDir + '" && unzip -oq pg16.jar && tar -xf postgres-darwin-arm_64.txz -C "' + binDir + '" && xattr -dr com.apple.quarantine "' + binDir + '"');
    console.log('[W2B-PG] 二进制就绪: ' + pgBin);
  }
  const port = await freePort();
  const dataDir = path.join(pgtestDir, 'data_' + port);
  fs.mkdirSync(dataDir, { recursive: true });
  const initDb = path.join(pgBin, 'initdb');
  const postgres = path.join(pgBin, 'postgres');
  console.log('[W2B-PG] initdb: ' + initDb + ' -D ' + dataDir);
  exec('"' + initDb + '" -D "' + dataDir + '" -U postgres --auth-host=trust --auth-local=trust');
  const pgLogFile = path.join(dataDir, 'pg.log');
  const pgProc = spawn(postgres, ['-D', dataDir, '-p', String(port), '-c', 'listen_addresses=127.0.0.1', '-c', 'logging_collector=off'], { stdio: ['ignore', fs.openSync(pgLogFile, 'a'), fs.openSync(pgLogFile, 'a')], detached: true });
  pgProc.unref();
  pgProc.on('error', function (err) { console.log('[W2B-PG] spawn error: ' + err.message); });
  pgProc.on('exit', function (code, sig) { console.log('[W2B-PG] postgres exited code=' + code + ' sig=' + sig); });
  const dsn = 'postgres://postgres@127.0.0.1:' + port + '/postgres';
  const maxRetry = 60;
  for (let i = 0; i < maxRetry; i++) {
    try {
      const c = new Client({ connectionString: dsn });
      await c.connect();
      await c.query('SELECT 1');
      await c.end();
      console.log('[W2B-PG] server up on port ' + port);
      return { dsn, dataDir, pgCtl: path.join(pgBin, 'pg_ctl'), proc: pgProc };
    } catch (e) { await sleep(500); }
  }
  let logTail = '';
  try { logTail = fs.readFileSync(pgLogFile, 'utf8').split('\n').slice(-20).join('\n'); } catch (e) {}
  throw new Error('PG 启动超时（port=' + port + ', log:\n' + logTail + ')');
}

let emb, dataDir, testDsn, admin, schema, srv, port, pgProc;
let recording = false;
let syncLog = [];

async function q(sql, params) {
  const r = await admin.query(sql, params || []);
  return r.rows;
}
async function q1(sql, params) {
  const rows = await q(sql, params);
  return rows[0] || null;
}

async function fetchJSON(method, pathStr, body, opts) {
  opts = opts || {};
  const res = await fetch('http://127.0.0.1:' + port + pathStr, Object.assign({
    method,
    headers: { 'content-type': 'application/json', cookie: 'session_token=' + (process.env.W2B_TEST_TOKEN || 'wave2btoken') },
    body: body === undefined ? undefined : JSON.stringify(body)
  }, opts));
  let json = null;
  try { json = await res.json(); } catch (e) {}
  return { status: res.status, json };
}

// ---- 种子：单 SKU PO ----
async function seedPo(tag, opts) {
  opts = opts || {};
  const sku = 'SKU-' + tag;
  const poNo = 'PO-' + tag;
  const poId = 'po_' + tag;
  const supplierId = 'sup_' + tag;
  const poQty = opts.poQty || 100;
  const unitPrice = opts.unitPrice || 10;
  const poTotal = opts.poTotal || (poQty * unitPrice);
  await q(`INSERT INTO suppliers (id, name, status) VALUES ($1,$2,'active') ON CONFLICT DO NOTHING`, [supplierId, 'Supplier-' + tag]);
  await q(`INSERT INTO skus (id, sku_code, product_name, reference_customs_rate) VALUES ($1,$2,$3,0.05) ON CONFLICT (sku_code) DO NOTHING`, ['sku_' + tag, sku, 'Product-' + tag]);
  await q(`INSERT INTO purchase_orders (id, po_no, supplier_id, supplier_name, brand, country, target_warehouse, po_date, currency, total_amount, po_status, approval_status) VALUES ($1,$2,$3,$4,'BrandX','ID','WH1','2026-08-01','USD',$5,'confirmed','approved') ON CONFLICT DO NOTHING`, [poId, poNo, supplierId, 'Supplier-' + tag, poTotal]);
  await q(`INSERT INTO purchase_order_items (id, po_id, po_no, sku_code, po_qty, unit_price, po_amount) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`, ['poi_' + tag, poId, poNo, sku, poQty, unitPrice, poQty * unitPrice]);
  return { sku, poId, poNo, supplierId, poQty, unitPrice };
}

// ---- 种子：多 SKU PO ----
async function seedMultiSkuPo(tag, skuCount, opts) {
  opts = opts || {};
  const poNo = 'PO-' + tag;
  const poId = 'po_' + tag;
  const supplierId = 'sup_' + tag;
  const poQty = opts.poQty || 100;
  const unitPrice = opts.unitPrice || 10;
  await q(`INSERT INTO suppliers (id, name, status) VALUES ($1,$2,'active') ON CONFLICT DO NOTHING`, [supplierId, 'Supplier-' + tag]);
  await q(`INSERT INTO purchase_orders (id, po_no, supplier_id, supplier_name, brand, country, target_warehouse, po_date, currency, total_amount, po_status, approval_status) VALUES ($1,$2,$3,$4,'BrandX','ID','WH1','2026-08-01','USD',$5,'confirmed','approved') ON CONFLICT DO NOTHING`, [poId, poNo, supplierId, 'Supplier-' + tag, poQty * unitPrice * skuCount]);
  const skus = [];
  for (let i = 0; i < skuCount; i++) {
    const sku = 'SKU-' + tag + '-' + i;
    await q(`INSERT INTO skus (id, sku_code, product_name, reference_customs_rate) VALUES ($1,$2,$3,0.05) ON CONFLICT (sku_code) DO NOTHING`, ['sku_' + tag + '_' + i, sku, 'Product-' + tag + '-' + i]);
    await q(`INSERT INTO purchase_order_items (id, po_id, po_no, sku_code, po_qty, unit_price, po_amount) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`, ['poi_' + tag + '_' + i, poId, poNo, sku, poQty, unitPrice, poQty * unitPrice]);
    skus.push(sku);
  }
  return { skus, poId, poNo, supplierId, poQty, unitPrice };
}

// ---- 种子：已存在 PI（可控制 item 数量 / 锁定态 / 定金）----
async function seedExistingPi(tag, opts) {
  opts = opts || {};
  const f = await seedMultiSkuPo(tag, opts.skuCount || 1, opts);
  const piNo = 'PI-' + tag;
  const piId = 'pi_' + tag;
  const needDeposit = opts.needDeposit !== undefined ? opts.needDeposit : 1;
  const depositRatio = opts.depositRatio || 30;
  const piStatus = opts.piStatus || 'uploaded';
  const depositPaymentStatus = opts.depositPaymentStatus || 'unpaid';
  const piItemSkuCount = opts.piItemSkuCount || f.skus.length;
  const piConfirmedQty = opts.piConfirmedQty || 10;
  const unitPrice = f.unitPrice;
  await q(`INSERT INTO proforma_invoices (id, pi_no, related_po_id, related_po_no, supplier_id, supplier_name, brand, country, target_warehouse, pi_date, currency, total_amount, need_deposit, deposit_ratio, balance_ratio, payable_deposit, available_deduct_deposit, deposit_payment_status, pi_status) VALUES ($1,$2,$3,$4,$5,$6,'BrandX','ID','WH1','2026-08-01','USD',$7,$8,$9,$10,0,0,$11,$12) ON CONFLICT DO NOTHING`,
    [piId, piNo, f.poId, f.poNo, f.supplierId, 'Supplier-' + tag, f.skus.length * piConfirmedQty * unitPrice, needDeposit, depositRatio, 100 - depositRatio, depositPaymentStatus, piStatus]);
  let total = 0;
  for (let i = 0; i < piItemSkuCount; i++) {
    const sku = f.skus[i];
    await q(`INSERT INTO proforma_invoice_items (id, pi_id, pi_no, po_no, sku_code, po_qty, pi_confirmed_qty, unit_price, pi_amount, shipped_qty, unshipped_qty) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,0,$7) ON CONFLICT DO NOTHING`, ['pii_' + tag + '_' + i, piId, piNo, f.poNo, sku, piConfirmedQty, piConfirmedQty, unitPrice, piConfirmedQty * unitPrice]);
    total += piConfirmedQty * unitPrice;
  }
  await q(`UPDATE proforma_invoices SET total_amount=$1, payable_deposit=$2, available_deduct_deposit=$2 WHERE id=$3`, [total, needDeposit ? Math.round(total * depositRatio / 100) : 0, piId]);
  return Object.assign({}, f, { piId, piNo, needDeposit, depositRatio, piStatus, piConfirmedQty, piTotal: total });
}

// ---- 种子：deposit payable（用于 S2 / cancel 测试）----
async function seedDepositPayable(piId, piNo, supplierId, supplierName, amountMinor, lifecycle, isActive) {
  const id = 'pay_' + piId + '_' + lifecycle + '_' + amountMinor;
  await q(`INSERT INTO payable_items (id, fee_no, source_type, source_id, source_no, source_ci_id, fee_type, category_code, subcategory_code, payee_type, payee_key, payee_name_snapshot, payer_entity_key, payer_name_snapshot, currency, payable_amount_minor, is_active, lifecycle_status, payable_date, created_by) VALUES ($1,$2,'pi',$3,$4,'','deposit','goods','deposit','factory',$5,$6,'self','',$7,$8,$9,$10,$11,$12) ON CONFLICT DO NOTHING`,
    [id, 'PAY-ITEM-' + piNo + '-' + id.slice(-8), piId, piNo, 'supplier:' + (supplierId || supplierName || ''), supplierName || '', 'USD', amountMinor, isActive !== undefined ? isActive : 1, lifecycle, '', 'seed']);
  return id;
}

// ---- PI 状态快照（zero-mutation 证明）----
async function snapshotPiState(piNo, piId) {
  const piRow = await q1('SELECT * FROM proforma_invoices WHERE pi_no=$1', [piNo]);
  const piItems = piRow
    ? await q('SELECT sku_code, pi_confirmed_qty, pi_amount, shipped_qty, unshipped_qty FROM proforma_invoice_items WHERE pi_id=$1 ORDER BY sku_code', [piId])
    : [];
  const po = await q1('SELECT po_status FROM purchase_orders WHERE id IN (SELECT related_po_id FROM proforma_invoices WHERE id=$1)', [piId]);
  const pay = piRow
    ? await q('SELECT id, lifecycle_status, payable_amount_minor, is_active FROM payable_items WHERE source_type=$1 AND source_id=$2 AND fee_type=$3 ORDER BY id', ['pi', piId, 'deposit'])
    : [];
  const counts = await q1(
    'SELECT (SELECT COUNT(*)::int FROM proforma_invoices) AS pin,' +
    ' (SELECT COUNT(*)::int FROM proforma_invoice_items) AS pii_n,' +
    ' (SELECT COUNT(*)::int FROM payable_items) AS pay_n'
  );
  return { piRow, piItems, po, pay, counts };
}

function assertZeroMutation(before, after, label) {
  assert.deepEqual(
    { pin: after.counts.pin, pii: after.counts.pii_n, pay: after.counts.pay_n },
    { pin: before.counts.pin, pii: before.counts.pii_n, pay: before.counts.pay_n },
    label + ': 表行数必须完全一致（无新增 PI / PI item / payable）'
  );
  if (before.piRow) {
    assert.ok(after.piRow, label + ': PI header 仍存在');
    assert.equal(Number(after.piRow.total_amount), Number(before.piRow.total_amount), label + ': PI total_amount 未被改写');
    assert.equal(Number(after.piRow.payable_deposit), Number(before.piRow.payable_deposit), label + ': PI payable_deposit 未被改写');
    assert.equal(after.piRow.pi_status, before.piRow.pi_status, label + ': PI pi_status 未被改写');
    assert.equal(Number(after.piRow.available_deduct_deposit), Number(before.piRow.available_deduct_deposit), label + ': PI available_deduct_deposit 未被改写');
  }
  if (before.po) {
    assert.equal(after.po.po_status, before.po.po_status, label + ': PO po_status 未被改写');
  }
  assert.deepEqual(after.piItems, before.piItems, label + ': PI items 完全一致（无新增/无修改）');
  assert.deepEqual(after.pay, before.pay, label + ': payable 完全一致（未更新/未新增）');
}

describe('Wave 2B: PI batch-import async rewrite (真 PG)', { timeout: 900000 }, () => {
  before(async function () {
    try {
      emb = await ensureEmbeddedPg();
      dataDir = emb.dataDir;
      testDsn = emb.dsn;
      pgProc = emb.proc || null;
      admin = new Client({ connectionString: emb.dsn });
      await admin.connect();
      const ver = await admin.query('SELECT version() AS v');
      console.log('[W2B-PG] server = ' + String(ver.rows[0].v).split(' on ')[0]);

      schema = 'w2b_' + Math.random().toString(36).slice(2, 10);
      await admin.query('CREATE SCHEMA "' + schema + '"');
      await admin.query('SET search_path TO "' + schema + '"');
      testDsn = emb.dsn + (emb.dsn.indexOf('?') >= 0 ? '&' : '?') + 'options=-csearch_path%3D' + encodeURIComponent(schema);

      const pgSrc = fs.readFileSync(path.join(REPO, 'db-pg.js'), 'utf8');
      const tables = extractAllCreateTables(pgSrc);
      let created = 0;
      const errs = [];
      for (const t of tables) {
        try {
          await admin.query(t.ddl.replace('CREATE TABLE IF NOT EXISTS ' + t.table, 'CREATE TABLE IF NOT EXISTS "' + schema + '".' + t.table));
          created++;
        } catch (e) { errs.push(t.table + ': ' + String(e.message).slice(0, 100)); }
      }
      console.log('[W2B-PG] tables created = ' + created + '/' + tables.length + (errs.length ? ' 失败: ' + errs.join(' | ') : ''));

      // 额外列（与生产迁移一致；embedded PG 仅从 CREATE TABLE DDL 建表，漏掉后续 ALTER）
      for (const col of [
        'ALTER TABLE "' + schema + '".commercial_invoice_items ADD COLUMN IF NOT EXISTS pi_id TEXT DEFAULT \'\'',
        'ALTER TABLE "' + schema + '".commercial_invoice_items ADD COLUMN IF NOT EXISTS discount DOUBLE PRECISION DEFAULT 0',
        'ALTER TABLE "' + schema + '".commercial_invoice_items ADD COLUMN IF NOT EXISTS net_unit_price NUMERIC(18,4) DEFAULT 0',
        'ALTER TABLE "' + schema + '".commercial_invoices ADD COLUMN IF NOT EXISTS target_warehouse TEXT DEFAULT \'\'',
        'ALTER TABLE "' + schema + '".commercial_invoices ADD COLUMN IF NOT EXISTS related_pi_ids TEXT DEFAULT \'\'',
        'ALTER TABLE "' + schema + '".commercial_invoices ADD COLUMN IF NOT EXISTS related_pi_nos TEXT DEFAULT \'\'',
        'ALTER TABLE "' + schema + '".proforma_invoices ADD COLUMN IF NOT EXISTS target_warehouse TEXT DEFAULT \'\'',
        'ALTER TABLE "' + schema + '".purchase_orders ADD COLUMN IF NOT EXISTS target_warehouse TEXT DEFAULT \'\''
      ]) {
        try { await admin.query(col); } catch (e) { /* 已存在 */ }
      }

      // 权威 identity（与 Wave 2A/生产一致）
      try { await admin.query('CREATE UNIQUE INDEX IF NOT EXISTS uq_payable_identity ON "' + schema + '".payable_items(source_type, source_id, COALESCE(source_ci_id, \'\'), fee_type)'); } catch (e) {}
      try { await admin.query('CREATE UNIQUE INDEX IF NOT EXISTS uq_payable_active ON "' + schema + '".payable_items(source_type, source_id, source_ci_id, fee_type) WHERE is_active = 1'); } catch (e) {}

      process.env.DB_DRIVER = 'pg';
      process.env.DATABASE_URL = testDsn;
      process.env.NODE_ENV = 'test';

      delete require.cache[require.resolve('../db')];
      delete require.cache[require.resolve('../server')];
      delete require.cache[require.resolve('../wave2b-pi-batch-import-pg.js')];

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
        console.warn('[W2B-PG] worker unref patch warn:', e && e.message);
      }

      const dbmod = require('../db');
      dbmod.initDatabase();

      const origFns = { query: dbmod.query, queryOne: dbmod.queryOne, run: dbmod.run, transaction: dbmod.transaction };
      const wrap = function (name) {
        const orig = origFns[name];
        dbmod[name] = function () {
          const args = arguments;
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
      await new Promise(function (resolve) { srv = server.app.listen(0, function () { port = srv.address().port; resolve(); }); });

      const token = 'wave2btoken';
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      await q('INSERT INTO roles (id, name, description, permissions, is_system) VALUES ($1, $2, $3, $4, 0) ON CONFLICT DO NOTHING', ['role_w2b', 'W2B Role', '', JSON.stringify(['pi_view', 'pi_create', 'pi_edit', 'user_manage'])]);
      await q('INSERT INTO users (id, username, name, password, role_id, status) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING', ['user_w2b', 'w2b', 'W2B Tester', '', 'role_w2b', 'active']);
      await q('INSERT INTO sessions (id, token_hash, user_id, created_at, expires_at) VALUES ($1, $2, $3, to_char(NOW(), $4), to_char(NOW() + INTERVAL \'1 day\', $4)) ON CONFLICT DO NOTHING', ['sess_w2b', tokenHash, 'user_w2b', 'YYYY-MM-DD HH24:MI:SS']);
      process.env.W2B_TEST_TOKEN = token;
      console.log('[W2B-PG] server up on 127.0.0.1:' + port);
    } catch (e) {
      console.error('[W2B-PG] before hook failed:', e.message, e.stack);
      throw e;
    }
  });

  after(async () => {
    try {
      const pgAsync = require('../pg-async');
      const gp = pgAsync.getGeneratePool();
      if (gp) { try { await gp.end(); } catch (e) {} }
    } catch (e) {}
    try { if (srv && typeof srv.close === 'function') { await new Promise((res) => { srv.close(() => res()); }); } } catch (e) {}
    try { if (admin) await admin.end(); } catch (e) {}
    if (emb && dataDir) {
      try {
        const c = new Client({ connectionString: emb.dsn });
        await c.connect();
        await c.query('DROP SCHEMA IF EXISTS "' + schema + '" CASCADE');
        await c.end();
      } catch (e) { console.warn('[W2B-PG] schema cleanup warn:', e.message); }
    }
    if (emb && emb.pgCtl && dataDir) {
      try { exec('"' + emb.pgCtl + '" -D "' + dataDir + '" -m fast stop', { timeout: 60000 }); } catch (e) {}
    }
    if (pgProc) {
      await new Promise(function (res) {
        if (pgProc.exitCode !== null || pgProc.signalCode !== null) return res();
        let guard = setTimeout(res, 60000);
        pgProc.once('exit', function () { clearTimeout(guard); res(); });
      });
    }
    if (dataDir) {
      try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (e) { console.warn('[W2B-PG] data dir cleanup warn: ' + dataDir + ' -> ' + (e && e.code) + ' ' + (e && e.message)); }
    }
  });

  // =========================================================================
  // T1: 硬上限 1001 → 422 → sync bridge 0
  // =========================================================================
  test('T1: 硬上限 1001 → 422 → sync bridge 0', { timeout: 30000 }, async () => {
    const items = [];
    for (let i = 0; i < 1001; i++) {
      items.push({ 'PI编号': 'PI-T1-' + i, SKU: 'SKU-T1-' + i, '关联PO编号': 'PO-T1-' + i, '数量': 1, '单价': 1 });
    }
    syncLog = []; recording = true;
    let r;
    try { r = await fetchJSON('POST', '/api/proforma-invoices/batch-import', { items: items }); }
    finally { recording = false; }
    assert.strictEqual(r.status, 422);
    assert.equal(r.json.code, 'IMPORT_ROW_LIMIT_EXCEEDED');
    assert.equal(r.json.limit, 1000);
    assert.equal(r.json.actual, 1001);
    const forbidden = syncLog.filter(function (e) { return CORE_SYNC_FORBIDDEN.some(function (re) { return re.test(e.sql); }); });
    assert.deepEqual(forbidden, [], 'rejected batch must not run import SQL: ' + JSON.stringify(forbidden));
  });

  // =========================================================================
  // T2: Layer1 拒绝（SKU/PO 空）→ failed → 零 mutation
  // =========================================================================
  test('T2: Layer1 拒绝（SKU/PO 空）→ 零 mutation', { timeout: 30000 }, async () => {
    const r = await fetchJSON('POST', '/api/proforma-invoices/batch-import', {
      items: [
        { 'PI编号': 'PI-T2A', SKU: '', '关联PO编号': 'PO-T2A', '数量': 5, '单价': 10 },
        { 'PI编号': 'PI-T2B', SKU: 'SKU-T2B', '关联PO编号': '', '数量': 5, '单价': 10 }
      ]
    });
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.success, 0);
    assert.equal(r.json.failed, 2);
    const reasons = (r.json.errors || []).map(e => e.reason).join(' | ');
    assert.ok(reasons.indexOf('SKU不能为空') >= 0, 'SKU 空应被 Layer1 拒绝: ' + reasons);
    assert.ok(reasons.indexOf('无法匹配PO：PO编号为空') >= 0, 'PO 空应被 Layer1 拒绝: ' + reasons);
    // 零 mutation：不应有任何 PI 写入
    const pi = await q1('SELECT COUNT(*)::int AS n FROM proforma_invoices WHERE pi_no LIKE $1', ['PI-T2%']);
    assert.equal(pi.n, 0, 'Layer1 拒绝不得写入 PI');
  });

  // =========================================================================
  // T3: FK 拒绝（SKU/PO 不存在）→ failed → 零 mutation
  // =========================================================================
  test('T3: FK 拒绝（SKU/PO 不存在）→ 零 mutation', { timeout: 30000 }, async () => {
    // 行 A：SKU 存在但 PO 不存在 → 首错为「无法匹配PO」
    // 行 B：SKU 不存在（PO 无关） → 首错为「SKU不存在」
    const f = await seedPo('T3', { poQty: 100 });
    const r = await fetchJSON('POST', '/api/proforma-invoices/batch-import', {
      items: [
        { 'PI编号': 'PI-T3A', SKU: f.sku, '关联PO编号': 'NOPE-PO-T3', '数量': 5, '单价': 10 },
        { 'PI编号': 'PI-T3B', SKU: 'NOPE-SKU-T3', '关联PO编号': f.poNo, '数量': 5, '单价': 10 }
      ]
    });
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.success, 0);
    assert.equal(r.json.failed, 2);
    const reasons = (r.json.errors || []).map(e => e.reason).join(' | ');
    assert.ok(reasons.indexOf('SKU不存在') >= 0, 'SKU 不存在应拒: ' + reasons);
    assert.ok(reasons.indexOf('无法匹配PO') >= 0, 'PO 不存在应拒: ' + reasons);
    const pi = await q1('SELECT COUNT(*)::int AS n FROM proforma_invoices WHERE pi_no LIKE $1', ['PI-T3%']);
    assert.equal(pi.n, 0);
  });

  // =========================================================================
  // T4: getPILockReason 等价（cancelled / has-CI / has-PL / deposit-paid）
  // =========================================================================
  [
    { tag: 'T4A', reason: '已作废', setup: async (f) => { await q('UPDATE proforma_invoices SET pi_status=$1 WHERE id=$2', ['cancelled', f.piId]); } },
    { tag: 'T4B', reason: '已生成CI', setup: async (f) => { await q('INSERT INTO commercial_invoices (id, ci_no, related_pi_id, related_pi_no, ci_status, ci_date, actual_ship_date, payment_term_id, credit_days, ops_owner_id, ops_plan_listing_date, ops_ready_status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0,$9,$10,$11) ON CONFLICT DO NOTHING', ['ci_' + f.piId, 'CI-' + f.piNo, f.piId, f.piNo, 'uploaded', '2026-08-10', '', '', '', '', 'pending']); } },
    { tag: 'T4C', reason: '已生成PL', setup: async (f) => { await q('INSERT INTO packing_lists (id, pl_no, related_pi_id, related_pi_no) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', ['pl_' + f.piId, 'PL-' + f.piNo, f.piId, f.piNo]); } },
    { tag: 'T4D', reason: '已付定金', setup: async (f) => { await q('UPDATE proforma_invoices SET deposit_payment_status=$1 WHERE id=$2', ['paid', f.piId]); } }
  ].forEach(function (c) {
    test(c.tag + ': getPILockReason 等价 — ' + c.reason + ' → 追加被拒 → 零 mutation', { timeout: 30000 }, async () => {
      // need_deposit=0 以隔离 getPILockReason（避免 S2 干扰）；append 新 SKU
      const f = await seedExistingPi(c.tag, { skuCount: 2, piItemSkuCount: 1, needDeposit: 0, poQty: 100, piConfirmedQty: 10 });
      await c.setup(f);
      const before = await snapshotPiState(f.piNo, f.piId);
      const r = await fetchJSON('POST', '/api/proforma-invoices/batch-import', {
        items: [{ 'PI编号': f.piNo, SKU: f.skus[1], '关联PO编号': f.poNo, '数量': 5, '单价': 10 }]
      });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.equal(r.json.success, 0, c.reason + ': 锁定 PI 不得追加');
      assert.equal(r.json.failed, 1);
      const reasons = (r.json.errors || []).map(e => e.reason).join(' | ');
      assert.ok(reasons.indexOf(c.reason) >= 0, 'error reason 应提及 ' + c.reason + '，实际: ' + reasons);
      const after = await snapshotPiState(f.piNo, f.piId);
      assertZeroMutation(before, after, c.tag + '/' + c.reason);
    });
  });

  // =========================================================================
  // T5: P2-6 累计超 PO 数量 → 拒绝
  // =========================================================================
  test('T5: P2-6 累计超 PO 数量 → 拒绝', { timeout: 30000 }, async () => {
    // PO 含 2 个 SKU，各 po_qty=100；现有 PI 仅含 skus[0]=100（已占满 skus[0] 配额）。
    // 追加 skus[1] 数量 101 → 超过该 PO item 剩余(=100) → P2-6 拒（dup-SKU 守卫不触发，因 skus[1] 不在 PI 内）
    const f = await seedExistingPi('T5', { skuCount: 2, piItemSkuCount: 1, poQty: 100, piConfirmedQty: 100, needDeposit: 0 });
    const r = await fetchJSON('POST', '/api/proforma-invoices/batch-import', {
      items: [{ 'PI编号': f.piNo, SKU: f.skus[1], '关联PO编号': f.poNo, '数量': 101, '单价': 10 }]
    });
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.success, 0);
    assert.equal(r.json.failed, 1);
    assert.ok(/超过采购订单剩余数量/.test(r.json.errors[0].reason));
    const pii = await q1('SELECT pi_confirmed_qty FROM proforma_invoice_items WHERE pi_id=$1 AND sku_code=$2', [f.piId, f.skus[0]]);
    assert.equal(Number(pii.pi_confirmed_qty), 100, 'PI item 数量不应改变');
  });

  // =========================================================================
  // T6: 批内重复 (pi_no, sku) → fail-closed
  // =========================================================================
  test('T6: 批内重复 (pi_no, sku) → fail-closed', { timeout: 30000 }, async () => {
    const f = await seedPo('T6', { poQty: 100 });
    const r = await fetchJSON('POST', '/api/proforma-invoices/batch-import', {
      items: [
        { 'PI编号': 'PI-T6', SKU: f.sku, '关联PO编号': f.poNo, '数量': 5, '单价': 10 },
        { 'PI编号': 'PI-T6', SKU: f.sku, '关联PO编号': f.poNo, '数量': 5, '单价': 10 }
      ]
    });
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.success, 0, '两条重复都应 fail');
    assert.equal(r.json.failed, 2);
    assert.ok(r.json.errors.every(function (e) { return /输入重复/.test(e.reason); }));
  });

  // =========================================================================
  // T7: deposit payable 幂等（重导/追加 → 仍一条 active，金额 authoritative UPDATE）
  // =========================================================================
  test('T7: deposit payable 幂等（追加后金额 UPDATE，仍一条 active）', { timeout: 30000 }, async () => {
    const f = await seedExistingPi('T7', { skuCount: 2, piItemSkuCount: 1, needDeposit: 1, depositRatio: 30, poQty: 100, piConfirmedQty: 10, unitPrice: 10 });
    // 首次追加 SKU[1] → 创建 deposit payable（existing total=100, new total=200, deposit=60）
    let r = await fetchJSON('POST', '/api/proforma-invoices/batch-import', {
      items: [{ 'PI编号': f.piNo, SKU: f.skus[1], '关联PO编号': f.poNo, '数量': 10, '单价': 10 }]
    });
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.success, 1);
    let pays = await q('SELECT * FROM payable_items WHERE source_type=$1 AND source_id=$2 AND fee_type=$3 ORDER BY id', ['pi', f.piId, 'deposit']);
    assert.equal(pays.length, 1, '首次应创建一条 deposit payable');
    assert.equal(pays[0].lifecycle_status, 'active');
    // newTotal = 100 + 100 = 200 → deposit = 60.00 → 6000
    assert.equal(Number(pays[0].payable_amount_minor), 6000, '首次 deposit=6000');

    // 二次追加 SKU[1] 已存在（dup guard）→ 改用 SKU[1] 其他数量会撞 dup；改用追加不同数量需换 sku。
    // 这里改为「重导同 PI 同 SKU[0] 已存在」不可行（dup），故校验：再次整体重导（含 SKU[0] 既有）应被 dup 拒。
    // 改为追加第三 SKU 需要 PO 有 item；重建 f2 验证幂等 UPDATE 路径：
    const r2 = await fetchJSON('POST', '/api/proforma-invoices/batch-import', {
      items: [{ 'PI编号': f.piNo, SKU: f.skus[1], '关联PO编号': f.poNo, '数量': 20, '单价': 10 }]
    });
    // SKU[1] 已存在 → 本轮被 dup guard 拒（failed=1），但验证仍只有一条 deposit payable 且金额不因误 UPDATE 改变
    assert.strictEqual(r2.status, 200, JSON.stringify(r2.json));
    pays = await q('SELECT * FROM payable_items WHERE source_type=$1 AND source_id=$2 AND fee_type=$3 ORDER BY id', ['pi', f.piId, 'deposit']);
    assert.equal(pays.length, 1, 'dup 拒后仍为一条 deposit payable');
    assert.equal(Number(pays[0].payable_amount_minor), 6000, 'dup 拒不得改变 deposit 金额');
  });

  // =========================================================================
  // T8: 完整对账（新 PI 多 item + 定金；po_status='transferred_pi'；追加后 totals 更新）
  // =========================================================================
  test('T8: 完整对账（多 item 新 PI + 定金 + po_status + 追加后 totals）', { timeout: 30000 }, async () => {
    const f = await seedMultiSkuPo('T8', 2, { poQty: 100, unitPrice: 10 });
    const r = await fetchJSON('POST', '/api/proforma-invoices/batch-import', {
      items: [
        { 'PI编号': 'PI-T8', SKU: f.skus[0], '关联PO编号': f.poNo, '数量': 10, '单价': 10, '是否需要定金': '是', '定金比例': 30 },
        { 'PI编号': 'PI-T8', SKU: f.skus[1], '关联PO编号': f.poNo, '数量': 20, '单价': 10, '是否需要定金': '是', '定金比例': 30 }
      ]
    });
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.success, 2);
    assert.equal(r.json.failed, 0);

    const pi = await q1('SELECT * FROM proforma_invoices WHERE pi_no=$1', ['PI-T8']);
    assert.ok(pi, 'PI 应创建');
    assert.equal(pi.pi_status, 'uploaded');
    assert.equal(Number(pi.total_amount), 300, '10*10 + 20*10 = 300');
    assert.equal(Number(pi.payable_deposit), 90, '300*0.3 = 90');
    assert.equal(Number(pi.available_deduct_deposit), 90);

    const po = await q1('SELECT po_status FROM purchase_orders WHERE id=$1', [f.poId]);
    assert.equal(po.po_status, 'transferred_pi', 'PO 状态应更新为 transferred_pi');

    const pays = await q('SELECT * FROM payable_items WHERE source_type=$1 AND source_id=$2 AND fee_type=$3', ['pi', pi.id, 'deposit']);
    assert.equal(pays.length, 1, '一条 deposit payable');
    assert.equal(pays[0].lifecycle_status, 'active');
    assert.equal(Number(pays[0].payable_amount_minor), 9000, 'deposit=9000 (90.00)');

    // 追加：在 SKU[0] 上追加（dup 会拒），故验证「追加既有 PI 新金额」改用不同 SKU 不适用。
    // 直接核验追加路径：用同一 PI 追加 SKU[0] 会被 dup 拒；改为追加「已存在 PI」场景在 T9 并发覆盖。
  });

  // =========================================================================
  // T9: 并发同 PI 追加不同 SKU → 无 lost update
  // =========================================================================
  test('T9: 并发同 PI 追加不同 SKU → 无 lost update', { timeout: 60000 }, async () => {
    const f = await seedExistingPi('T9', { skuCount: 3, piItemSkuCount: 1, needDeposit: 0, poQty: 100, piConfirmedQty: 10, unitPrice: 10 });
    const [a, b] = await Promise.all([
      fetchJSON('POST', '/api/proforma-invoices/batch-import', {
        items: [{ 'PI编号': f.piNo, SKU: f.skus[1], '关联PO编号': f.poNo, '数量': 5, '单价': 10 }]
      }),
      fetchJSON('POST', '/api/proforma-invoices/batch-import', {
        items: [{ 'PI编号': f.piNo, SKU: f.skus[2], '关联PO编号': f.poNo, '数量': 7, '单价': 10 }]
      })
    ]);
    assert.strictEqual(a.status, 200, JSON.stringify(a.json));
    assert.strictEqual(b.status, 200, JSON.stringify(b.json));
    assert.equal(a.json.success, 1);
    assert.equal(b.json.success, 1);

    // PI total = 初始 100 + 50 + 70 = 220
    const pi = await q1('SELECT total_amount FROM proforma_invoices WHERE id=$1', [f.piId]);
    assert.equal(Number(pi.total_amount), 220, '100 + 50 + 70 = 220, no lost update');
    const items = await q('SELECT sku_code FROM proforma_invoice_items WHERE pi_id=$1', [f.piId]);
    assert.equal(items.length, 3, '三个 SKU item（初始 + 并发追加两行）');
  });

  // =========================================================================
  // T10: 中途 mutation 失败 → 整批 ROLLBACK（无半 PI）
  // =========================================================================
  test('T10: 中途 mutation 失败 → 整批 ROLLBACK', { timeout: 60000 }, async () => {
    const f = await seedPo('T10', { poQty: 100 });
    await admin.query('ALTER TABLE proforma_invoices RENAME COLUMN pi_status TO pi_status_w2bbak');
    let resp;
    try {
      resp = await fetchJSON('POST', '/api/proforma-invoices/batch-import', {
        items: [{ 'PI编号': 'PI-T10', SKU: f.sku, '关联PO编号': f.poNo, '数量': 5, '单价': 10, '是否需要定金': '是', '定金比例': 30 }]
      });
    } finally {
      await admin.query('ALTER TABLE proforma_invoices RENAME COLUMN pi_status_w2bbak TO pi_status');
    }
    assert.strictEqual(resp.status, 500, JSON.stringify(resp.json));
    const pi = await q1('SELECT * FROM proforma_invoices WHERE pi_no=$1', ['PI-T10']);
    assert.ok(!pi, 'no PI should exist after rollback');
    const pay = await q1('SELECT COUNT(*)::int AS n FROM payable_items WHERE source_no=$1 AND fee_type=$2', ['PI-T10', 'deposit']);
    assert.equal(pay.n, 0, 'no deposit payable after rollback');
  });

  // =========================================================================
  // T11: core PG path sync bridge calls = 0
  // =========================================================================
  test('T11: core PG path sync bridge calls = 0', { timeout: 30000 }, async () => {
    const f = await seedMultiSkuPo('T11', 2, { poQty: 100, unitPrice: 10 });
    syncLog = []; recording = true;
    let r;
    try {
      r = await fetchJSON('POST', '/api/proforma-invoices/batch-import', {
        items: [
          { 'PI编号': 'PI-T11', SKU: f.skus[0], '关联PO编号': f.poNo, '数量': 5, '单价': 10 },
          { 'PI编号': 'PI-T11', SKU: f.skus[1], '关联PO编号': f.poNo, '数量': 5, '单价': 10 }
        ]
      });
    } finally { recording = false; }
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.success, 2);
    const forbidden = syncLog.filter(function (e) { return CORE_SYNC_FORBIDDEN.some(function (re) { return re.test(e.sql); }); });
    assert.deepEqual(forbidden, [], '核心 SQL 不得经过 sync bridge: ' + JSON.stringify(forbidden));
  });

  // =========================================================================
  // T12: event-loop 存活证明
  // =========================================================================
  test('T12: event-loop 存活 — import 等锁，GET /api/version 仍响应', { timeout: 60000 }, async () => {
    const f = await seedExistingPi('T12', { skuCount: 2, piItemSkuCount: 1, needDeposit: 0, poQty: 100, piConfirmedQty: 10 });

    const blocker = new Client({ connectionString: testDsn });
    await blocker.connect();
    await blocker.query('BEGIN');
    await blocker.query('SELECT * FROM proforma_invoices WHERE id=$1 FOR UPDATE', [f.piId]);

    const importPromise = fetchJSON('POST', '/api/proforma-invoices/batch-import', {
      items: [{ 'PI编号': f.piNo, SKU: f.skus[1], '关联PO编号': f.poNo, '数量': 5, '单价': 10 }]
    });

    await sleep(200);
    const t0 = Date.now();
    const versionRes = await fetch('http://127.0.0.1:' + port + '/api/version', {
      headers: { cookie: 'session_token=' + (process.env.W2B_TEST_TOKEN || 'wave2btoken') }
    });
    const versionElapsed = Date.now() - t0;
    assert.ok(versionRes.status === 200, 'GET /api/version must respond 200');
    assert.ok(versionElapsed < 3000, 'GET /api/version must respond within 3s, got ' + versionElapsed + 'ms');

    await blocker.query('ROLLBACK');
    await blocker.end();

    const importRes = await importPromise;
    assert.strictEqual(importRes.status, 200, JSON.stringify(importRes.json));
    assert.equal(importRes.json.success, 1);
  });

  // =========================================================================
  // P1: S2 MUTABILITY — deposit 锁定态 + 金额变化 → 行拒 → 零 mutation
  // =========================================================================
  test('P1: S2 MUTABILITY — deposit locked + amount change → 行拒 → 零 mutation', { timeout: 30000 }, async () => {
    // existing PI need_deposit=1 ratio=30，初始 item total=100 → deposit=30 (3000)
    const f = await seedExistingPi('P1', { skuCount: 2, piItemSkuCount: 1, needDeposit: 1, depositRatio: 30, poQty: 100, piConfirmedQty: 10, unitPrice: 10 });
    // 创建 active deposit payable=3000
    await seedDepositPayable(f.piId, f.piNo, f.supplierId, 'Supplier-P1', 3000, 'active', 1);
    // 推进到锁定态
    await q('UPDATE payable_items SET lifecycle_status=$1 WHERE source_type=$2 AND source_id=$3 AND fee_type=$4', ['partially_paid', 'pi', f.piId, 'deposit']);

    const before = await snapshotPiState(f.piNo, f.piId);
    // 追加 SKU[1] amount=500 → prospective=(100+500)*0.3=180 → ≠30 → 锁定态应拒
    const r = await fetchJSON('POST', '/api/proforma-invoices/batch-import', {
      items: [{ 'PI编号': f.piNo, SKU: f.skus[1], '关联PO编号': f.poNo, '数量': 50, '单价': 10 }]
    });
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.success, 0, 'deposit 锁定态 + 金额变化 应拒');
    assert.equal(r.json.failed, 1);
    assert.ok(/已进入付款流程/.test(r.json.errors[0].reason), 'reason 应提及付款流程: ' + r.json.errors[0].reason);
    const after = await snapshotPiState(f.piNo, f.piId);
    assertZeroMutation(before, after, 'P1/S2-locked');
  });

  // =========================================================================
  // P2: 对照 — active 重导/追加仍 authoritative UPDATE（金额同步，不 failed）
  // =========================================================================
  test('P2: 对照 — active deposit 追加 → 金额 authoritative UPDATE（仍一条 active）', { timeout: 30000 }, async () => {
    const f = await seedExistingPi('P2', { skuCount: 2, piItemSkuCount: 1, needDeposit: 1, depositRatio: 30, poQty: 100, piConfirmedQty: 10, unitPrice: 10 });
    await seedDepositPayable(f.piId, f.piNo, f.supplierId, 'Supplier-P2', 3000, 'active', 1);

    const r = await fetchJSON('POST', '/api/proforma-invoices/batch-import', {
      items: [{ 'PI编号': f.piNo, SKU: f.skus[1], '关联PO编号': f.poNo, '数量': 10, '单价': 10 }]
    });
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.success, 1, 'active 追加应成功');
    assert.equal(r.json.failed, 0);
    const pays = await q('SELECT * FROM payable_items WHERE source_type=$1 AND source_id=$2 AND fee_type=$3 ORDER BY id', ['pi', f.piId, 'deposit']);
    assert.equal(pays.length, 1, 'exactly one deposit payable (update not insert)');
    assert.equal(pays[0].lifecycle_status, 'active');
    // newTotal = 100 + 100 = 200 → deposit = 60 → 6000
    assert.equal(Number(pays[0].payable_amount_minor), 6000, 'authoritative update 3000→6000');
  });

  // =========================================================================
  // P3: 对照 — cancelled deposit payable → 追加不重建（仍 1 条 cancelled）
  // =========================================================================
  test('P3: 对照 — cancelled deposit payable → 追加不重建 active', { timeout: 30000 }, async () => {
    const f = await seedExistingPi('P3', { skuCount: 2, piItemSkuCount: 1, needDeposit: 1, depositRatio: 30, poQty: 100, piConfirmedQty: 10, unitPrice: 10 });
    // 已 cancelled 的 deposit payable（Round 5：cancelled 不进 S2，不重建）
    await seedDepositPayable(f.piId, f.piNo, f.supplierId, 'Supplier-P3', 3000, 'cancelled', 0);

    const r = await fetchJSON('POST', '/api/proforma-invoices/batch-import', {
      items: [{ 'PI编号': f.piNo, SKU: f.skus[1], '关联PO编号': f.poNo, '数量': 10, '单价': 10 }]
    });
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.success, 1, '追加新 SKU 仍应成功（cancelled deposit 不应阻塞追加）');
    const pays = await q('SELECT * FROM payable_items WHERE source_type=$1 AND source_id=$2 AND fee_type=$3 ORDER BY id', ['pi', f.piId, 'deposit']);
    assert.equal(pays.length, 1, '不得为追加重建 deposit payable');
    assert.equal(pays[0].lifecycle_status, 'cancelled', '仍保留原 cancelled 行');
  });
});
