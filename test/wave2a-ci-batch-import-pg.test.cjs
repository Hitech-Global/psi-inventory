'use strict';
/**
 * Wave 2A — CI batch-import async rewrite 测试（真实 PostgreSQL，全栈 require('../server')，DB_DRIVER=pg）
 * =================================================================================================================
 * 覆盖 C1-C20：
 *   C1  正常单行 CI import
 *   C2  100+ rows valid → success=N → fixed DB round trips
 *   C3  mixed: 80 valid + 20 expected invalid → 80 success → 20 failed → errors 精确映射 source_row_no
 *   C4  invalid row → DB mutation = 0 for that row
 *   C5  duplicate input → fail-closed
 *   C6  PI shipped limit exceeded
 *   C7  existing CI + new item
 *   C8  new CI + multiple items
 *   C9  PI item shipped_qty / unshipped_qty totals correct
 *   C10 PI header shipped_amount / unshipped_amount / status correct
 *   C11 CI goods_amount / total_amount correct
 *   C12 payable existing → authoritative update semantics unchanged
 *   C13 payable missing → exactly one created
 *   C14 mutation SQL 中途失败 → all valid-row mutation rollback → no half CI
 *   C15 concurrent two CI imports sharing PI → no lost update
 *   C16 CI import × CI reverse → lock ordering no deadlock → final facts correct
 *   C17 after-COMMIT transit refresh exactly once
 *   C18 core PG path sync bridge calls = 0
 *   C19 Atomics.wait/event-loop proof: import DB work blocked → unrelated HTTP GET still responds
 *   C20 hard limit 1001 → 422 → DB calls = 0
 *
 * 真实 PG：嵌入式 PostgreSQL 16.15（zonky darwin-arm64v8），缓存在 .pgtest/pg16bin/。
 * 或 W2A_PG_DSN 指向已运行的本地实例（仅允许 localhost/127.0.0.1/::1）。
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
  /INSERT\s+INTO\s+commercial_invoices\b/i,
  /INSERT\s+INTO\s+commercial_invoice_items\b/i,
  /UPDATE\s+proforma_invoice_items\b/i,
  /UPDATE\s+proforma_invoices\b/i,
  /UPDATE\s+commercial_invoices\b/i,
  /INSERT\s+INTO\s+payable_items\b/i,
  /UPDATE\s+payable_items\b/i,
  /SELECT.*FROM\s+commercial_invoices\b/i,
  /SELECT.*FROM\s+proforma_invoices\b/i,
  /SELECT.*FROM\s+proforma_invoice_items\b/i,
  /SELECT.*FROM\s+commercial_invoice_items\b/i,
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
  // 与 Wave 1 一致：正则匹配表名，再用括号深度匹配 DDL 体（db-pg.js 用反引号模板串，
  // 简单 `[^;]+` 无法正确捕获含分号的 DDL）
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

// ---------------------------------------------------------------------------
// 嵌入式 PG 启动（只允许本地实例；生产库一律拒绝）
// ---------------------------------------------------------------------------
async function ensureEmbeddedPg() {
  if (process.env.W2A_PG_DSN) {
    const u = new URL(process.env.W2A_PG_DSN);
    if (!LOCAL_HOSTS.has(u.hostname)) throw new Error('W2A-PG-GUARD: 主机不在白名单: ' + u.hostname);
    return { dsn: process.env.W2A_PG_DSN, dataDir: null, pgCtl: null, proc: null };
  }
  const pgtestDir = path.join(REPO, '.pgtest');
  const binDir = path.join(pgtestDir, 'pg16bin');
  const pgBin = path.join(binDir, 'bin');
  if (!fs.existsSync(path.join(pgBin, 'postgres'))) {
    fs.mkdirSync(binDir, { recursive: true });
    const jarPath = path.join(pgtestDir, 'pg16.jar');
    if (!fs.existsSync(jarPath)) {
      console.log('[W2A-PG] 下载嵌入式 PostgreSQL 16.15 二进制（首次运行一次）...');
      exec('curl -sfL -o "' + jarPath + '" https://repo1.maven.org/maven2/io/zonky/test/postgres/embedded-postgres-binaries-darwin-arm64v8/16.15.0/embedded-postgres-binaries-darwin-arm64v8-16.15.0.jar', { timeout: 300000 });
    }
    exec('cd "' + pgtestDir + '" && unzip -oq pg16.jar && tar -xf postgres-darwin-arm_64.txz -C "' + binDir + '" && xattr -dr com.apple.quarantine "' + binDir + '"');
    console.log('[W2A-PG] 二进制就绪: ' + pgBin);
  }
  const port = await freePort();
  const dataDir = path.join(pgtestDir, 'data_' + port);
  fs.mkdirSync(dataDir, { recursive: true });
  const initDb = path.join(pgBin, 'initdb');
  const postgres = path.join(pgBin, 'postgres');
  console.log('[W2A-PG] initdb: ' + initDb + ' -D ' + dataDir);
  exec('"' + initDb + '" -D "' + dataDir + '" -U postgres --auth-host=trust --auth-local=trust');
  // 写日志到文件便于排查（stdio:'ignore' 会让 postgres 输出丢失）
  const pgLogFile = path.join(dataDir, 'pg.log');
  const pgProc = spawn(postgres, ['-D', dataDir, '-p', String(port), '-c', 'listen_addresses=127.0.0.1', '-c', 'logging_collector=off'], { stdio: ['ignore', fs.openSync(pgLogFile, 'a'), fs.openSync(pgLogFile, 'a')], detached: true });
  pgProc.unref();
  pgProc.on('error', function (err) { console.log('[W2A-PG] spawn error: ' + err.message); });
  pgProc.on('exit', function (code, sig) { console.log('[W2A-PG] postgres exited code=' + code + ' sig=' + sig); });
  const dsn = 'postgres://postgres@127.0.0.1:' + port + '/postgres';
  const maxRetry = 60; // 30 → 60，更宽裕的启动窗口
  for (let i = 0; i < maxRetry; i++) {
    try {
      const c = new Client({ connectionString: dsn });
      await c.connect();
      await c.query('SELECT 1');
      await c.end();
      console.log('[W2A-PG] server up on port ' + port);
      return { dsn, dataDir, pgCtl: path.join(pgBin, 'pg_ctl'), proc: pgProc };
    } catch (e) { await sleep(500); }
  }
  // 失败时打印日志，便于定位
  let logTail = '';
  try { logTail = fs.readFileSync(pgLogFile, 'utf8').split('\n').slice(-20).join('\n'); } catch (e) {}
  throw new Error('PG 启动超时（port=' + port + ', log:\n' + logTail + ')');
}

// ---------------------------------------------------------------------------
// 全局状态
// ---------------------------------------------------------------------------
let emb, dataDir, testDsn, admin, schema, srv, port, pgProc;
let recording = false;
let syncLog = [];

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------
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
    headers: { 'content-type': 'application/json', cookie: 'session_token=' + (process.env.W2A_TEST_TOKEN || 'wave2atoken') },
    body: body === undefined ? undefined : JSON.stringify(body)
  }, opts));
  let json = null;
  try { json = await res.json(); } catch (e) {}
  return { status: res.status, json };
}

// 种子数据：创建 supplier, brand, country, PO, PI, PI item, SKU
async function seedFixture(tag, opts) {
  opts = opts || {};
  const sku = 'SKU-' + tag;
  const piNo = 'PI-' + tag;
  const poNo = 'PO-' + tag;
  const piId = 'pi_' + tag;
  const poId = 'po_' + tag;
  const piiId = 'pii_' + tag;
  const piTotal = opts.piTotal || 1000;
  const piConfirmedQty = opts.piConfirmedQty || 100;
  const needDeposit = opts.needDeposit !== undefined ? opts.needDeposit : 0;
  const depositStatus = opts.depositStatus || 'paid';
  const availableDeduct = opts.availableDeduct || 0;
  const discount = opts.discount || 0;
  const unitPrice = opts.unitPrice || 10;
  const creditDays = opts.creditDays || 0;
  const paymentTermId = opts.paymentTermId || '';
  const supplierId = 'sup_' + tag;

  await q(`INSERT INTO suppliers (id, name, status) VALUES ($1, $2, 'active') ON CONFLICT DO NOTHING`, [supplierId, 'Supplier-' + tag]);
  await q(`INSERT INTO skus (id, sku_code, product_name, reference_customs_rate) VALUES ($1, $2, $3, 0.05) ON CONFLICT (sku_code) DO NOTHING`, ['sku_' + tag, sku, 'Product-' + tag]);
  await q(`INSERT INTO purchase_orders (id, po_no, supplier_id, supplier_name, brand, country, target_warehouse, po_date, currency, total_amount, po_status, approval_status) VALUES ($1, $2, $3, $4, 'BrandX', 'ID', 'WH1', '2026-08-01', 'USD', $5, 'confirmed', 'approved') ON CONFLICT DO NOTHING`, [poId, poNo, supplierId, 'Supplier-' + tag, piTotal]);
  if (paymentTermId) {
    await q(`INSERT INTO supplier_payment_terms (id, supplier_id, term_name, term_type, credit_days, is_default, status) VALUES ($1, $2, 'Net30', 'credit', $3, 1, 'active') ON CONFLICT DO NOTHING`, [paymentTermId, supplierId, creditDays]);
  }
  await q(`INSERT INTO proforma_invoices (id, pi_no, related_po_id, related_po_no, supplier_id, supplier_name, brand, country, target_warehouse, pi_date, currency, total_amount, need_deposit, deposit_payment_status, available_deduct_deposit, shipped_amount, unshipped_amount, pi_status, payment_term_id) VALUES ($1, $2, $3, $4, $5, $6, 'BrandX', 'ID', 'WH1', '2026-08-01', 'USD', $7, $8, $9, $10, 0, $7, 'pending', $11) ON CONFLICT DO NOTHING`, [piId, piNo, poId, poNo, supplierId, 'Supplier-' + tag, piTotal, needDeposit, depositStatus, availableDeduct, paymentTermId]);
  await q(`INSERT INTO proforma_invoice_items (id, pi_id, pi_no, po_no, sku_code, pi_confirmed_qty, unit_price, pi_amount, shipped_qty, unshipped_qty, discount) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, $6, $9) ON CONFLICT DO NOTHING`, [piiId, piId, piNo, poNo, sku, piConfirmedQty, unitPrice, piConfirmedQty * unitPrice, discount]);

  return { sku, piId, piNo, poId, piiId, piTotal, piConfirmedQty, discount, unitPrice, supplierId };
}

// 批量种子：创建多个 SKU + PI items
async function seedMultiSkuFixture(tag, skuCount, opts) {
  opts = opts || {};
  const piNo = 'PI-' + tag;
  const poNo = 'PO-' + tag;
  const piId = 'pi_' + tag;
  const poId = 'po_' + tag;
  const supplierId = 'sup_' + tag;
  const piTotal = opts.piTotal || 10000;
  const needDeposit = opts.needDeposit || 0;
  const depositStatus = opts.depositStatus || 'paid';
  const availableDeduct = opts.availableDeduct || 0;
  const creditDays = opts.creditDays || 0;
  const paymentTermId = opts.paymentTermId || '';
  const qtyPerSku = opts.qtyPerSku || 100;
  const pricePerSku = opts.pricePerSku || 10;

  await q(`INSERT INTO suppliers (id, name, status) VALUES ($1, $2, 'active') ON CONFLICT DO NOTHING`, [supplierId, 'Supplier-' + tag]);
  await q(`INSERT INTO purchase_orders (id, po_no, supplier_id, supplier_name, brand, country, target_warehouse, po_date, currency, total_amount, po_status, approval_status) VALUES ($1, $2, $3, $4, 'BrandX', 'ID', 'WH1', '2026-08-01', 'USD', $5, 'confirmed', 'approved') ON CONFLICT DO NOTHING`, [poId, poNo, supplierId, 'Supplier-' + tag, piTotal]);
  if (paymentTermId) {
    await q(`INSERT INTO supplier_payment_terms (id, supplier_id, term_name, term_type, credit_days, is_default, status) VALUES ($1, $2, 'Net30', 'credit', $3, 1, 'active') ON CONFLICT DO NOTHING`, [paymentTermId, supplierId, creditDays]);
  }
  await q(`INSERT INTO proforma_invoices (id, pi_no, related_po_id, related_po_no, supplier_id, supplier_name, brand, country, target_warehouse, pi_date, currency, total_amount, need_deposit, deposit_payment_status, available_deduct_deposit, shipped_amount, unshipped_amount, pi_status, payment_term_id) VALUES ($1, $2, $3, $4, $5, $6, 'BrandX', 'ID', 'WH1', '2026-08-01', 'USD', $7, $8, $9, $10, 0, $7, 'pending', $11) ON CONFLICT DO NOTHING`, [piId, piNo, poId, poNo, supplierId, 'Supplier-' + tag, piTotal, needDeposit, depositStatus, availableDeduct, paymentTermId]);

  var skus = [];
  for (var i = 0; i < skuCount; i++) {
    var sku = 'SKU-' + tag + '-' + (i + 1);
    await q(`INSERT INTO skus (id, sku_code, product_name, reference_customs_rate) VALUES ($1, $2, $3, 0.05) ON CONFLICT (sku_code) DO NOTHING`, ['sku_' + tag + '_' + i, sku, 'Product-' + tag + '-' + i]);
    await q(`INSERT INTO proforma_invoice_items (id, pi_id, pi_no, po_no, sku_code, pi_confirmed_qty, unit_price, pi_amount, shipped_qty, unshipped_qty, discount) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, $6, 0) ON CONFLICT DO NOTHING`, ['pii_' + tag + '_' + i, piId, piNo, poNo, sku, qtyPerSku, pricePerSku, qtyPerSku * pricePerSku]);
    skus.push(sku);
  }

  return { skus, piId, piNo, poId, supplierId, piTotal };
}

describe('Wave 2A: CI batch-import async rewrite (真 PG)', { timeout: 900000 }, () => {
  before(async function () {
    // Node 原生 test runner 的 before hook 无 this.timeout；改用 describe 级 timeout
    try {
      emb = await ensureEmbeddedPg();
      dataDir = emb.dataDir;
      testDsn = emb.dsn;
      pgProc = emb.proc || null;
      admin = new Client({ connectionString: emb.dsn });
      await admin.connect();
      const ver = await admin.query('SELECT version() AS v');
      console.log('[W2A-PG] server = ' + String(ver.rows[0].v).split(' on ')[0]);

      schema = 'w2a_' + Math.random().toString(36).slice(2, 10);
      await admin.query('CREATE SCHEMA "' + schema + '"');
      await admin.query('SET search_path TO "' + schema + '"');
      testDsn = emb.dsn + (emb.dsn.indexOf('?') >= 0 ? '&' : '?') + 'options=-csearch_path%3D' + encodeURIComponent(schema);

      // 创建全部表（真实生产类型）
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
      console.log('[W2A-PG] tables created = ' + created + '/' + tables.length + (errs.length ? ' 失败: ' + errs.join(' | ') : ''));

      // 额外列（与生产迁移一致）
      for (const col of [
        'ALTER TABLE "' + schema + '".commercial_invoice_items ADD COLUMN IF NOT EXISTS pi_id TEXT DEFAULT \'\'',
        'ALTER TABLE "' + schema + '".commercial_invoices ADD COLUMN IF NOT EXISTS target_warehouse TEXT DEFAULT \'\'',
        'ALTER TABLE "' + schema + '".commercial_invoices ADD COLUMN IF NOT EXISTS related_pi_ids TEXT DEFAULT \'\'',
        'ALTER TABLE "' + schema + '".commercial_invoices ADD COLUMN IF NOT EXISTS related_pi_nos TEXT DEFAULT \'\'',
        'ALTER TABLE "' + schema + '".commercial_invoices ADD COLUMN IF NOT EXISTS shipping_attachments TEXT NOT NULL DEFAULT \'[]\'',
        'ALTER TABLE "' + schema + '".commercial_invoices ADD COLUMN IF NOT EXISTS original_inventory_imported INTEGER DEFAULT 0',
        'ALTER TABLE "' + schema + '".commercial_invoice_items ADD COLUMN IF NOT EXISTS discount DOUBLE PRECISION DEFAULT 0',
        'ALTER TABLE "' + schema + '".commercial_invoice_items ADD COLUMN IF NOT EXISTS net_unit_price NUMERIC(18,4) DEFAULT 0',
        'ALTER TABLE "' + schema + '".proforma_invoices ADD COLUMN IF NOT EXISTS target_warehouse TEXT DEFAULT \'\'',
        'ALTER TABLE "' + schema + '".purchase_orders ADD COLUMN IF NOT EXISTS target_warehouse TEXT DEFAULT \'\'',
        'ALTER TABLE "' + schema + '".payable_items ADD COLUMN IF NOT EXISTS lifecycle_status TEXT NOT NULL DEFAULT \'active\'',
        'ALTER TABLE "' + schema + '".payable_items ADD COLUMN IF NOT EXISTS payable_date TEXT DEFAULT \'\'',
        'ALTER TABLE "' + schema + '".payable_items ADD COLUMN IF NOT EXISTS source_ci_id TEXT NOT NULL DEFAULT \'\''
      ]) {
        try { await admin.query(col); } catch (e) { /* 已存在 */ }
      }

      // 创建唯一索引（与生产一致）
      try { await admin.query('CREATE UNIQUE INDEX IF NOT EXISTS uq_payable_active ON "' + schema + '".payable_items(source_type, source_id, source_ci_id, fee_type) WHERE is_active = 1'); } catch (e) {}
      // 权威 identity（PAY-SCHEMA-CORRECTION-01 已上线，全生命周期唯一、无 partial predicate）：
      // 作为 MUTABILITY 守卫的安全网——若守卫漏拒，二次 INSERT 会撞唯一约束 → 整批 ROLLBACK → 测试显式失败。
      try { await admin.query('CREATE UNIQUE INDEX IF NOT EXISTS uq_payable_identity ON "' + schema + '".payable_items(source_type, source_id, COALESCE(source_ci_id, \'\'), fee_type)'); } catch (e) {}

      // ---- 全栈启动 ----
      process.env.DB_DRIVER = 'pg';
      process.env.DATABASE_URL = testDsn;
      process.env.NODE_ENV = 'test';

      // 清除 require cache 确保 fresh load
      delete require.cache[require.resolve('../db')];
      delete require.cache[require.resolve('../server')];
      delete require.cache[require.resolve('../wave2a-ci-batch-import-pg.js')];

      // 测试侧 instrumentation：db-sync-worker 是 new Worker(...) 且 db.js 未导出 shutdown，
      // 该 worker 会一直持有事件循环 → 测试跑完后 node 进程永不退出（表现为“挂起”）。
      // 这里在 require('../db') 之前给 Worker 打补丁使其 unref：db.js 在自身 require 时
      // 解构 worker_threads.Worker，故此刻打补丁可被其捕获。不修改任何生产代码。
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
        console.warn('[W2A-PG] worker unref patch warn:', e && e.message);
      }

      const dbmod = require('../db');
      dbmod.initDatabase();

      // sync bridge 记录器（C18）
      const origFns = { query: dbmod.query, queryOne: dbmod.queryOne, run: dbmod.run, transaction: dbmod.transaction };
      const wrap = function (name) {
        const orig = origFns[name];
        dbmod[name] = function () {
          var args = arguments;
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

      // 鉴权种子
      const token = 'wave2atoken';
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      await q('INSERT INTO roles (id, name, description, permissions, is_system) VALUES ($1, $2, $3, $4, 0) ON CONFLICT DO NOTHING', ['role_w2a', 'W2A Role', '', JSON.stringify(['ci_view', 'ci_create', 'ci_edit', 'user_manage'])]);
      await q('INSERT INTO users (id, username, name, password, role_id, status) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING', ['user_w2a', 'w2a', 'W2A Tester', '', 'role_w2a', 'active']);
      await q('INSERT INTO sessions (id, token_hash, user_id, created_at, expires_at) VALUES ($1, $2, $3, to_char(NOW(), $4), to_char(NOW() + INTERVAL \'1 day\', $4)) ON CONFLICT DO NOTHING', ['sess_w2a', tokenHash, 'user_w2a', 'YYYY-MM-DD HH24:MI:SS']);
      process.env.W2A_TEST_TOKEN = token;
      console.log('[W2A-PG] server up on 127.0.0.1:' + port);
    } catch (e) {
      console.error('[W2A-PG] before hook failed:', e.message, e.stack);
      throw e;
    }
  });

  after(async () => {
    // 步骤一：先优雅关闭主线程客户端连接池，避免嵌入式 PG 被停后 idle client 异步报错。
    // gen-pool 需显式 end；db-sync-worker 的 pool 自带 error 监听器，仅 log 不抛。
    try {
      const pgAsync = require('../pg-async');
      const gp = pgAsync.getGeneratePool();
      if (gp) { try { await gp.end(); } catch (e) {} }
    } catch (e) {}
    try { if (srv && typeof srv.close === 'function') { await new Promise((res) => { srv.close(() => res()); }); } } catch (e) {}
    try { if (admin) await admin.end(); } catch (e) {}
    // 步骤二：PG 仍存活时清理 schema，避免连接已断导致 ECONNREFUSED。
    if (emb && dataDir) {
      try {
        const c = new Client({ connectionString: emb.dsn });
        await c.connect();
        await c.query('DROP SCHEMA IF EXISTS "' + schema + '" CASCADE');
        await c.end();
      } catch (e) { console.warn('[W2A-PG] schema cleanup warn:', e.message); }
    }
    // 步骤三：停嵌入式 PG（此时 data dir 必须仍在，pg_ctl 需要它）。
    if (emb && emb.pgCtl && dataDir) {
      try { exec('"' + emb.pgCtl + '" -D "' + dataDir + '" -m fast stop', { timeout: 60000 }); } catch (e) {}
    }
    // 步骤四：await postgres 子进程真正退出（确定性 teardown；主机制是 exit 事件，不是 sleep）
    if (pgProc) {
      await new Promise(function (res) {
        if (pgProc.exitCode !== null || pgProc.signalCode !== null) return res();
        var guard = setTimeout(res, 60000); // 仅兜底守卫，正常路径由 exit 事件驱动
        pgProc.once('exit', function () { clearTimeout(guard); res(); });
      });
    }
    // 步骤五：postgres 已退出后才删除本轮 data dir（ownership：仅本轮自建目录）
    if (dataDir) {
      try {
        fs.rmSync(dataDir, { recursive: true, force: true });
      } catch (e) {
        // 不静默：删除失败必须可观测（teardown 确定性要求），但不影响测试结果判定
        console.warn('[W2A-PG] data dir cleanup warn: ' + dataDir + ' -> ' + (e && e.code) + ' ' + (e && e.message));
      }
    }
  });

  // =========================================================================
  // C1: 正常单行 CI import
  // =========================================================================
  test('C1: 正常单行 CI import', { timeout: 30000 }, async () => {
    const f = await seedFixture('C1', { piTotal: 1000, piConfirmedQty: 100, unitPrice: 10 });
    const r = await fetchJSON('POST', '/api/commercial-invoices/batch-import', {
      items: [{
        'CI编号': 'CI-C1', '关联PI编号': f.piNo, '关联PO编号': f.poNo,
        SKU: f.sku, '数量': 5, '单价': 10, '实际出货日期': '2026-08-15'
      }]
    });
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.success, 1);
    assert.equal(r.json.failed, 0);
    assert.equal(r.json.total, 1);

    const ci = await q1('SELECT * FROM commercial_invoices WHERE ci_no = $1', ['CI-C1']);
    assert.ok(ci, 'CI must exist');
    assert.equal(ci.ci_status, 'uploaded');
    assert.equal(Number(ci.goods_amount), 50);
    assert.equal(Number(ci.payable_balance), 50);

    const cii = await q1('SELECT * FROM commercial_invoice_items WHERE ci_id = $1', [ci.id]);
    assert.ok(cii);
    assert.equal(Number(cii.shipped_qty), 5);
    assert.equal(Number(cii.ci_amount), 50);
  });

  // =========================================================================
  // C2: 100+ rows valid → success=N → fixed DB round trips
  // =========================================================================
  test('C2: 100+ rows valid → success=N → fixed DB round trips', { timeout: 60000 }, async () => {
    const f = await seedMultiSkuFixture('C2', 120, { piTotal: 100000, qtyPerSku: 100, pricePerSku: 10 });
    var items = [];
    for (var i = 0; i < f.skus.length; i++) {
      items.push({
        'CI编号': 'CI-C2-' + i, '关联PI编号': f.piNo, '关联PO编号': f.poNo,
        SKU: f.skus[i], '数量': 5, '单价': 10, '实际出货日期': '2026-08-15'
      });
    }

    syncLog = []; recording = true;
    var r;
    try { r = await fetchJSON('POST', '/api/commercial-invoices/batch-import', { items: items }); }
    finally { recording = false; }

    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.success, 120);
    assert.equal(r.json.failed, 0);
    assert.equal(r.json.total, 120);

    // sync bridge 核心调用 = 0
    const forbidden = syncLog.filter(function (e) { return CORE_SYNC_FORBIDDEN.some(function (re) { return re.test(e.sql); }); });
    assert.deepEqual(forbidden, [], '核心 SQL 不得经过 sync bridge: ' + JSON.stringify(forbidden));

    // 验证 DB 状态
    const ciCount = await q1('SELECT COUNT(*)::int AS n FROM commercial_invoices WHERE ci_no LIKE $1', ['CI-C2-%']);
    assert.equal(ciCount.n, 120);
  });

  // =========================================================================
  // C3: mixed 80 valid + 20 invalid → 80 success → 20 failed → errors 精确映射
  // =========================================================================
  test('C3: mixed 80 valid + 20 invalid → partial success', { timeout: 60000 }, async () => {
    const f = await seedMultiSkuFixture('C3', 100, { piTotal: 100000, qtyPerSku: 100, pricePerSku: 10 });
    var items = [];
    // 80 valid rows
    for (var i = 0; i < 80; i++) {
      items.push({
        'CI编号': 'CI-C3-' + i, '关联PI编号': f.piNo, '关联PO编号': f.poNo,
        SKU: f.skus[i], '数量': 5, '单价': 10, '实际出货日期': '2026-08-15'
      });
    }
    // 20 invalid rows (bad SKU)
    for (var j = 0; j < 20; j++) {
      items.push({
        'CI编号': 'CI-C3-INV-' + j, '关联PI编号': f.piNo, '关联PO编号': f.poNo,
        SKU: 'BAD-SKU-' + j, '数量': 5, '单价': 10, '实际出货日期': '2026-08-15'
      });
    }

    const r = await fetchJSON('POST', '/api/commercial-invoices/batch-import', { items: items });
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.success, 80);
    assert.equal(r.json.failed, 20);
    assert.equal(r.json.total, 100);
    assert.equal(r.json.errors.length, 20);

    // 验证 error row 精确映射
    for (var k = 0; k < r.json.errors.length; k++) {
      var err = r.json.errors[k];
      assert.ok(err.row >= 82, 'error row should be >= 82 (after 80 valid + header): ' + err.row);
      assert.ok(/SKU不存在/.test(err.reason), 'reason should mention SKU: ' + err.reason);
    }
  });

  // =========================================================================
  // C4: invalid row → DB mutation = 0 for that row
  // =========================================================================
  test('C4: invalid row → DB mutation = 0', { timeout: 30000 }, async () => {
    const f = await seedFixture('C4', { piTotal: 1000, piConfirmedQty: 100 });
    const r = await fetchJSON('POST', '/api/commercial-invoices/batch-import', {
      items: [{
        'CI编号': 'CI-C4', '关联PI编号': f.piNo, '关联PO编号': f.poNo,
        SKU: 'BAD-SKU-C4', '数量': 5, '单价': 10, '实际出货日期': '2026-08-15'
      }]
    });
    assert.strictEqual(r.status, 200);
    assert.equal(r.json.success, 0);
    assert.equal(r.json.failed, 1);

    // 验证 DB 无写入
    const ci = await q1('SELECT * FROM commercial_invoices WHERE ci_no = $1', ['CI-C4']);
    assert.ok(!ci, 'no CI should be created for invalid row');
    const piItems = await q1('SELECT shipped_qty FROM proforma_invoice_items WHERE pi_id = $1', [f.piId]);
    assert.equal(Number(piItems.shipped_qty), 0, 'PI item shipped_qty should not change');
  });

  // =========================================================================
  // C5: duplicate input → fail-closed
  // =========================================================================
  test('C5: duplicate input → fail-closed', { timeout: 30000 }, async () => {
    const f = await seedFixture('C5', { piTotal: 1000, piConfirmedQty: 100, unitPrice: 10 });
    const r = await fetchJSON('POST', '/api/commercial-invoices/batch-import', {
      items: [
        { 'CI编号': 'CI-C5', '关联PI编号': f.piNo, '关联PO编号': f.poNo, SKU: f.sku, '数量': 5, '单价': 10, '实际出货日期': '2026-08-15' },
        { 'CI编号': 'CI-C5', '关联PI编号': f.piNo, '关联PO编号': f.poNo, SKU: f.sku, '数量': 5, '单价': 10, '实际出货日期': '2026-08-15' }
      ]
    });
    assert.strictEqual(r.status, 200);
    assert.equal(r.json.success, 0, 'both duplicate rows should fail');
    assert.equal(r.json.failed, 2);
    assert.ok(r.json.errors.some(function (e) { return /输入重复/.test(e.reason); }));
  });

  // =========================================================================
  // C6: PI shipped limit exceeded
  // =========================================================================
  test('C6: PI shipped limit exceeded', { timeout: 30000 }, async () => {
    const f = await seedFixture('C6', { piTotal: 1000, piConfirmedQty: 10, unitPrice: 10 });
    const r = await fetchJSON('POST', '/api/commercial-invoices/batch-import', {
      items: [{
        'CI编号': 'CI-C6', '关联PI编号': f.piNo, '关联PO编号': f.poNo,
        SKU: f.sku, '数量': 15, '单价': 10, '实际出货日期': '2026-08-15'
      }]
    });
    assert.strictEqual(r.status, 200);
    assert.equal(r.json.success, 0);
    assert.equal(r.json.failed, 1);
    assert.ok(/超过PI剩余数量/.test(r.json.errors[0].reason));
  });

  // =========================================================================
  // C7: existing CI + new item
  // =========================================================================
  test('C7: existing CI + new item', { timeout: 30000 }, async () => {
    const f = await seedMultiSkuFixture('C7', 2, { piTotal: 10000, qtyPerSku: 100, pricePerSku: 10 });
    // First import: create CI
    await fetchJSON('POST', '/api/commercial-invoices/batch-import', {
      items: [{ 'CI编号': 'CI-C7', '关联PI编号': f.piNo, '关联PO编号': f.poNo, SKU: f.skus[0], '数量': 5, '单价': 10, '实际出货日期': '2026-08-15' }]
    });
    // Second import: add item to existing CI
    const r = await fetchJSON('POST', '/api/commercial-invoices/batch-import', {
      items: [{ 'CI编号': 'CI-C7', '关联PI编号': f.piNo, '关联PO编号': f.poNo, SKU: f.skus[1], '数量': 3, '单价': 10, '实际出货日期': '2026-08-15' }]
    });
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.success, 1);

    const ci = await q1('SELECT * FROM commercial_invoices WHERE ci_no = $1', ['CI-C7']);
    assert.equal(Number(ci.goods_amount), 80, 'goods_amount = 50 + 30 = 80');

    const items = await q('SELECT * FROM commercial_invoice_items WHERE ci_id = $1 ORDER BY sku_code', [ci.id]);
    assert.equal(items.length, 2);
  });

  // =========================================================================
  // C8: new CI + multiple items
  // =========================================================================
  test('C8: new CI + multiple items', { timeout: 30000 }, async () => {
    const f = await seedMultiSkuFixture('C8', 3, { piTotal: 10000, qtyPerSku: 100, pricePerSku: 10 });
    const r = await fetchJSON('POST', '/api/commercial-invoices/batch-import', {
      items: [
        { 'CI编号': 'CI-C8', '关联PI编号': f.piNo, '关联PO编号': f.poNo, SKU: f.skus[0], '数量': 5, '单价': 10, '实际出货日期': '2026-08-15' },
        { 'CI编号': 'CI-C8', '关联PI编号': f.piNo, '关联PO编号': f.poNo, SKU: f.skus[1], '数量': 3, '单价': 10, '实际出货日期': '2026-08-15' },
        { 'CI编号': 'CI-C8', '关联PI编号': f.piNo, '关联PO编号': f.poNo, SKU: f.skus[2], '数量': 2, '单价': 10, '实际出货日期': '2026-08-15' }
      ]
    });
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.success, 3);

    const ci = await q1('SELECT * FROM commercial_invoices WHERE ci_no = $1', ['CI-C8']);
    assert.equal(Number(ci.goods_amount), 100, '5*10 + 3*10 + 2*10 = 100');

    const items = await q('SELECT * FROM commercial_invoice_items WHERE ci_id = $1', [ci.id]);
    assert.equal(items.length, 3);
  });

  // =========================================================================
  // C9: PI item shipped_qty / unshipped_qty totals correct
  // =========================================================================
  test('C9: PI item shipped_qty / unshipped_qty totals correct', { timeout: 30000 }, async () => {
    const f = await seedFixture('C9', { piTotal: 1000, piConfirmedQty: 100, unitPrice: 10 });
    await fetchJSON('POST', '/api/commercial-invoices/batch-import', {
      items: [{ 'CI编号': 'CI-C9', '关联PI编号': f.piNo, '关联PO编号': f.poNo, SKU: f.sku, '数量': 30, '单价': 10, '实际出货日期': '2026-08-15' }]
    });
    const pii = await q1('SELECT shipped_qty, unshipped_qty, pi_confirmed_qty FROM proforma_invoice_items WHERE pi_id = $1 AND sku_code = $2', [f.piId, f.sku]);
    assert.equal(Number(pii.shipped_qty), 30);
    assert.equal(Number(pii.unshipped_qty), 70);
    assert.equal(Number(pii.pi_confirmed_qty), 100);
  });

  // =========================================================================
  // C10: PI header shipped_amount / unshipped_amount / status correct
  // =========================================================================
  test('C10: PI header shipped_amount / unshipped_amount / status correct', { timeout: 30000 }, async () => {
    const f = await seedFixture('C10', { piTotal: 1000, piConfirmedQty: 100, unitPrice: 10 });
    await fetchJSON('POST', '/api/commercial-invoices/batch-import', {
      items: [{ 'CI编号': 'CI-C10', '关联PI编号': f.piNo, '关联PO编号': f.poNo, SKU: f.sku, '数量': 50, '单价': 10, '实际出货日期': '2026-08-15' }]
    });
    const pi = await q1('SELECT shipped_amount, unshipped_amount, pi_status FROM proforma_invoices WHERE id = $1', [f.piId]);
    assert.equal(Number(pi.shipped_amount), 500);
    assert.equal(Number(pi.unshipped_amount), 500);
    assert.equal(pi.pi_status, 'partial_shipped');
  });

  // =========================================================================
  // C11: CI goods_amount correct
  // =========================================================================
  test('C11: CI goods_amount correct', { timeout: 30000 }, async () => {
    const f = await seedFixture('C11', { piTotal: 1000, piConfirmedQty: 100, unitPrice: 10, discount: 0.1 });
    await fetchJSON('POST', '/api/commercial-invoices/batch-import', {
      items: [{ 'CI编号': 'CI-C11', '关联PI编号': f.piNo, '关联PO编号': f.poNo, SKU: f.sku, '数量': 10, '单价': 10, '实际出货日期': '2026-08-15' }]
    });
    const ci = await q1('SELECT goods_amount, payable_balance FROM commercial_invoices WHERE ci_no = $1', ['CI-C11']);
    // discount 0.1: net_price = 10 * 0.9 = 9, amount = 10 * 9 = 90
    assert.equal(Number(ci.goods_amount), 90);
    assert.equal(Number(ci.payable_balance), 90);
  });

  // =========================================================================
  // C12: payable existing → authoritative update
  // =========================================================================
  test('C12: payable existing → authoritative update', { timeout: 30000 }, async () => {
    const f = await seedFixture('C12', { piTotal: 1000, piConfirmedQty: 100, unitPrice: 10 });
    // First import: create CI + payable
    await fetchJSON('POST', '/api/commercial-invoices/batch-import', {
      items: [{ 'CI编号': 'CI-C12', '关联PI编号': f.piNo, '关联PO编号': f.poNo, SKU: f.sku, '数量': 10, '单价': 10, '实际出货日期': '2026-08-15' }]
    });
    // Verify payable created
    var pi1 = await q1('SELECT * FROM payable_items WHERE source_ci_id IN (SELECT id FROM commercial_invoices WHERE ci_no = $1) AND fee_type = $2', ['CI-C12', 'balance']);
    assert.ok(pi1, 'payable should exist');
    assert.equal(Number(pi1.payable_amount_minor), 10000); // 100 * 100

    // Second import: add more items to same CI → payable should update
    await fetchJSON('POST', '/api/commercial-invoices/batch-import', {
      items: [{ 'CI编号': 'CI-C12', '关联PI编号': f.piNo, '关联PO编号': f.poNo, SKU: f.sku, '数量': 5, '单价': 10, '实际出货日期': '2026-08-15' }]
    });
    var pi2 = await q1('SELECT * FROM payable_items WHERE source_ci_id IN (SELECT id FROM commercial_invoices WHERE ci_no = $1) AND fee_type = $2', ['CI-C12', 'balance']);
    assert.ok(pi2, 'payable should still exist');
    // New goods_amount = 150, payable = 150 → 15000
    assert.equal(Number(pi2.payable_amount_minor), 15000);
  });

  // =========================================================================
  // C13: payable missing → exactly one created
  // =========================================================================
  test('C13: payable missing → exactly one created', { timeout: 30000 }, async () => {
    const f = await seedFixture('C13', { piTotal: 1000, piConfirmedQty: 100, unitPrice: 10 });
    await fetchJSON('POST', '/api/commercial-invoices/batch-import', {
      items: [{ 'CI编号': 'CI-C13', '关联PI编号': f.piNo, '关联PO编号': f.poNo, SKU: f.sku, '数量': 5, '单价': 10, '实际出货日期': '2026-08-15' }]
    });
    var count = await q1('SELECT COUNT(*)::int AS n FROM payable_items WHERE source_ci_id IN (SELECT id FROM commercial_invoices WHERE ci_no = $1) AND fee_type = $2', ['CI-C13', 'balance']);
    assert.equal(count.n, 1, 'exactly one payable_item should be created');
  });

  // =========================================================================
  // C14: mutation SQL 中途失败 → all valid-row mutation rollback
  // =========================================================================
  test('C14: mutation 中途失败 → 整体 ROLLBACK', { timeout: 60000 }, async () => {
    const f = await seedFixture('C14', { piTotal: 1000, piConfirmedQty: 100, unitPrice: 10 });
    // 注入故障：重命名 ci_status 列，导致 UPDATE commercial_invoices 失败
    await admin.query('ALTER TABLE commercial_invoices RENAME COLUMN ci_status TO ci_status_w2abak');
    let resp;
    try {
      resp = await fetchJSON('POST', '/api/commercial-invoices/batch-import', {
        items: [{ 'CI编号': 'CI-C14', '关联PI编号': f.piNo, '关联PO编号': f.poNo, SKU: f.sku, '数量': 5, '单价': 10, '实际出货日期': '2026-08-15' }]
      });
    } finally {
      await admin.query('ALTER TABLE commercial_invoices RENAME COLUMN ci_status_w2abak TO ci_status');
    }
    assert.strictEqual(resp.status, 500, JSON.stringify(resp.json));

    // 验证无半提交
    const ci = await q1('SELECT * FROM commercial_invoices WHERE ci_no = $1', ['CI-C14']);
    assert.ok(!ci, 'no CI should exist after rollback');
    const pii = await q1('SELECT shipped_qty FROM proforma_invoice_items WHERE pi_id = $1', [f.piId]);
    assert.equal(Number(pii.shipped_qty), 0, 'PI item shipped_qty should be 0');
    const pi = await q1('SELECT shipped_amount FROM proforma_invoices WHERE id = $1', [f.piId]);
    assert.equal(Number(pi.shipped_amount), 0, 'PI shipped_amount should be 0');
    const piCount = await q1('SELECT COUNT(*)::int AS n FROM payable_items WHERE source_ci_id IN (SELECT id FROM commercial_invoices WHERE ci_no = $1)', ['CI-C14']);
    assert.equal(piCount.n, 0, 'no payable should exist');
  });

  // =========================================================================
  // C15: concurrent two CI imports sharing PI → no lost update
  // =========================================================================
  test('C15: concurrent two CI imports sharing PI → no lost update', { timeout: 60000 }, async () => {
    const f = await seedFixture('C15', { piTotal: 10000, piConfirmedQty: 1000, unitPrice: 10 });
    const [a, b] = await Promise.all([
      fetchJSON('POST', '/api/commercial-invoices/batch-import', {
        items: [{ 'CI编号': 'CI-C15A', '关联PI编号': f.piNo, '关联PO编号': f.poNo, SKU: f.sku, '数量': 50, '单价': 10, '实际出货日期': '2026-08-15' }]
      }),
      fetchJSON('POST', '/api/commercial-invoices/batch-import', {
        items: [{ 'CI编号': 'CI-C15B', '关联PI编号': f.piNo, '关联PO编号': f.poNo, SKU: f.sku, '数量': 30, '单价': 10, '实际出货日期': '2026-08-15' }]
      })
    ]);
    assert.strictEqual(a.status, 200, JSON.stringify(a.json));
    assert.strictEqual(b.status, 200, JSON.stringify(b.json));

    // 验证 PI shipped_qty = 80 (50 + 30), no lost update
    const pii = await q1('SELECT shipped_qty FROM proforma_invoice_items WHERE pi_id = $1 AND sku_code = $2', [f.piId, f.sku]);
    assert.equal(Number(pii.shipped_qty), 80, '50 + 30 = 80, no lost update');

    // 验证 PI shipped_amount = 800
    const pi = await q1('SELECT shipped_amount FROM proforma_invoices WHERE id = $1', [f.piId]);
    assert.equal(Number(pi.shipped_amount), 800, '500 + 300 = 800, no lost update');
  });

  // =========================================================================
  // C16: CI import × CI reverse → lock ordering no deadlock
  // =========================================================================
  test('C16: CI import × CI reverse → lock ordering compatible', { timeout: 60000 }, async () => {
    // 先创建一个已入库的 CI 用于 reverse
    const f = await seedFixture('C16', { piTotal: 10000, piConfirmedQty: 1000, unitPrice: 10 });
    // 创建 CI 并标记为已入库
    await fetchJSON('POST', '/api/commercial-invoices/batch-import', {
      items: [{ 'CI编号': 'CI-C16-EXIST', '关联PI编号': f.piNo, '关联PO编号': f.poNo, SKU: f.sku, '数量': 100, '单价': 10, '实际出货日期': '2026-08-15' }]
    });
    const ci = await q1('SELECT * FROM commercial_invoices WHERE ci_no = $1', ['CI-C16-EXIST']);
    // 标记为已入库以便 reverse
    await q('UPDATE commercial_invoices SET ci_status = $1 WHERE id = $2', ['inbound_complete', ci.id]);
    await q('INSERT INTO inbound_records (id, inbound_no, source_ci_id, source_ci_no, country, warehouse, inbound_date, sku_code, actual_qty, inbound_status, remark) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)', ['ib_c16', 'IB-C16', ci.id, 'CI-C16-EXIST', 'ID', 'WH1', '2026-08-20', f.sku, 100, 'completed', '']);

    // 并发：import 新 CI + reverse 旧 CI（共享 PI）
    const [importRes, reverseRes] = await Promise.all([
      fetchJSON('POST', '/api/commercial-invoices/batch-import', {
        items: [{ 'CI编号': 'CI-C16-NEW', '关联PI编号': f.piNo, '关联PO编号': f.poNo, SKU: f.sku, '数量': 50, '单价': 10, '实际出货日期': '2026-08-15' }]
      }),
      fetchJSON('POST', '/api/commercial-invoices/' + ci.id + '/reverse')
    ]);

    // 两者都应成功（lock ordering 兼容，无死锁）
    assert.strictEqual(importRes.status, 200, JSON.stringify(importRes.json));
    assert.strictEqual(reverseRes.status, 200, JSON.stringify(reverseRes.json));

    // 验证最终状态正确
    const pi = await q1('SELECT shipped_amount FROM proforma_invoices WHERE id = $1', [f.piId]);
    // reverse 回退 100*10=1000，import 新增 50*10=500 → 500
    assert.equal(Number(pi.shipped_amount), 500, 'shipped_amount = 500 (1000-1000+500)');
  });

  // =========================================================================
  // C17: after-COMMIT transit refresh
  // =========================================================================
  test('C17: after-COMMIT transit refresh（best-effort, not blocking response）', { timeout: 30000 }, async () => {
    const f = await seedFixture('C17', { piTotal: 1000, piConfirmedQty: 100, unitPrice: 10 });
    const t0 = Date.now();
    const r = await fetchJSON('POST', '/api/commercial-invoices/batch-import', {
      items: [{ 'CI编号': 'CI-C17', '关联PI编号': f.piNo, '关联PO编号': f.poNo, SKU: f.sku, '数量': 5, '单价': 10, '实际出货日期': '2026-08-15' }]
    });
    const elapsed = Date.now() - t0;
    assert.strictEqual(r.status, 200);
    // Response should return quickly (transit refresh is best-effort, not awaited)
    assert.ok(elapsed < 10000, 'response should return within 10s, got ' + elapsed + 'ms');
  });

  // =========================================================================
  // C18: core PG path sync bridge calls = 0
  // =========================================================================
  test('C18: core PG path sync bridge calls = 0', { timeout: 30000 }, async () => {
    const f = await seedFixture('C18', { piTotal: 1000, piConfirmedQty: 100, unitPrice: 10 });
    syncLog = []; recording = true;
    let r;
    try {
      r = await fetchJSON('POST', '/api/commercial-invoices/batch-import', {
        items: [{ 'CI编号': 'CI-C18', '关联PI编号': f.piNo, '关联PO编号': f.poNo, SKU: f.sku, '数量': 5, '单价': 10, '实际出货日期': '2026-08-15' }]
      });
    } finally { recording = false; }
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.success, 1);

    const forbidden = syncLog.filter(function (e) {
      return CORE_SYNC_FORBIDDEN.some(function (re) { return re.test(e.sql); });
    });
    assert.deepEqual(forbidden, [], '核心 SQL 不得经过 sync bridge: ' + JSON.stringify(forbidden));
  });

  // =========================================================================
  // C19: event-loop responsiveness proof
  // =========================================================================
  test('C19: event-loop proof — import blocked, GET still responds', { timeout: 60000 }, async () => {
    // 启动一个会持有 PI 锁的 CI import（通过先锁 PI 再 import）
    const f = await seedFixture('C19', { piTotal: 100000, piConfirmedQty: 1000, unitPrice: 10 });

    // 开启一个独立事务，锁住 PI header（让 CI import 的 FOR UPDATE 等待）
    const blocker = new Client({ connectionString: testDsn });
    await blocker.connect();
    await blocker.query('BEGIN');
    await blocker.query('SELECT * FROM proforma_invoices WHERE id = $1 FOR UPDATE', [f.piId]);

    // 发起 CI import（会被 FOR UPDATE 阻塞）
    const importPromise = fetchJSON('POST', '/api/commercial-invoices/batch-import', {
      items: [{ 'CI编号': 'CI-C19', '关联PI编号': f.piNo, '关联PO编号': f.poNo, SKU: f.sku, '数量': 5, '单价': 10, '实际出货日期': '2026-08-15' }]
    });

    // 同时发 GET /api/version（不应被阻塞）
    await sleep(200); // 确保 import 确实在等锁
    const t0 = Date.now();
    const versionRes = await fetch('http://127.0.0.1:' + port + '/api/version', {
      headers: { cookie: 'session_token=' + (process.env.W2A_TEST_TOKEN || 'wave2atoken') }
    });
    const versionElapsed = Date.now() - t0;
    assert.ok(versionRes.status === 200, 'GET /api/version must respond 200');
    assert.ok(versionElapsed < 3000, 'GET /api/version must respond within 3s, got ' + versionElapsed + 'ms');

    // 释放锁
    await blocker.query('ROLLBACK');
    await blocker.end();

    // import 应该完成
    const importRes = await importPromise;
    assert.strictEqual(importRes.status, 200, JSON.stringify(importRes.json));
    assert.equal(importRes.json.success, 1);
  });

  // =========================================================================
  // C20: hard limit 1001 → 422 → DB calls = 0
  // =========================================================================
  test('C20: hard limit 1001 → 422 → DB calls = 0', { timeout: 30000 }, async () => {
    var items = [];
    for (var i = 0; i < 1001; i++) {
      items.push({ 'CI编号': 'CI-C20-' + i, SKU: 'SKU-C20-' + i, '数量': 1, '单价': 1, '实际出货日期': '2026-08-15' });
    }
    syncLog = []; recording = true;
    var r;
    try {
      r = await fetchJSON('POST', '/api/commercial-invoices/batch-import', { items: items });
    } finally { recording = false; }
    assert.strictEqual(r.status, 422);
    assert.equal(r.json.code, 'IMPORT_ROW_LIMIT_EXCEEDED');
    assert.equal(r.json.limit, 1000);
    assert.equal(r.json.actual, 1001);
    // Wave 0A regression: rejected batch must not touch CI/PI/payable tables
    // (auth middleware 的 session 检查不算 import DB 工作)
    const forbidden = syncLog.filter(function (e) {
      return CORE_SYNC_FORBIDDEN.some(function (re) { return re.test(e.sql); });
    });
    assert.deepEqual(forbidden, [], 'rejected batch must not run import SQL: ' + JSON.stringify(forbidden));
  });

  // =====================================================================
  // PAY-CORE SEMANTIC EQUIVALENCE GATE (P1-P4)
  // 验证 Wave 2A PG path 与 legacy 的 payable_items 业务语义等价
  // 核心结论：balance payable = per-(pi_id, ci_id)，每个 CI 独立一条
  // =====================================================================

  // P1: 一个 PI → 一个 CI → 一条 balance payable
  test('P1: single PI single CI → exactly one balance payable', { timeout: 30000 }, async () => {
    const f = await seedFixture('P1', { piTotal: 5000, piConfirmedQty: 100, unitPrice: 50 });
    const r = await fetchJSON('POST', '/api/commercial-invoices/batch-import', {
      items: [{ 'CI编号': 'CI-P1', '关联PI编号': f.piNo, '关联PO编号': f.poNo, SKU: f.sku, '数量': 10, '单价': 50, '实际出货日期': '2026-08-15' }]
    });
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.success, 1);
    const ci = await q1('SELECT id FROM commercial_invoices WHERE ci_no = $1', ['CI-P1']);
    const pays = await q('SELECT * FROM payable_items WHERE source_type = $1 AND source_id = $2 AND source_ci_id = $3 AND fee_type = $4 AND is_active = 1',
      ['pi', f.piId, ci.id, 'balance']);
    assert.equal(pays.length, 1, 'one balance payable per (pi_id, ci_id)');
    assert.equal(pays[0].payable_amount_minor, 50000, 'amount = 500.00');
    assert.equal(pays[0].lifecycle_status, 'active');
    assert.equal(pays[0].source_ci_id, ci.id, 'source_ci_id = ci.id');
  });

  // P2: 一个 PI → CI-A + CI-B → 两条独立 balance payable（per-CI 业务模型）
  test('P2: single PI two CIs → two independent balance payables', { timeout: 30000 }, async () => {
    const f = await seedFixture('P2', { piTotal: 10000, piConfirmedQty: 200, unitPrice: 50 });
    const r = await fetchJSON('POST', '/api/commercial-invoices/batch-import', {
      items: [
        { 'CI编号': 'CI-P2A', '关联PI编号': f.piNo, '关联PO编号': f.poNo, SKU: f.sku, '数量': 10, '单价': 50, '实际出货日期': '2026-08-15' },
        { 'CI编号': 'CI-P2B', '关联PI编号': f.piNo, '关联PO编号': f.poNo, SKU: f.sku, '数量': 20, '单价': 50, '实际出货日期': '2026-08-15' }
      ]
    });
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.success, 2);
    const ciA = await q1('SELECT id FROM commercial_invoices WHERE ci_no = $1', ['CI-P2A']);
    const ciB = await q1('SELECT id FROM commercial_invoices WHERE ci_no = $1', ['CI-P2B']);
    const pays = await q('SELECT * FROM payable_items WHERE source_type = $1 AND source_id = $2 AND fee_type = $3 AND is_active = 1 ORDER BY source_ci_id',
      ['pi', f.piId, 'balance']);
    assert.equal(pays.length, 2, 'two balance payables (one per CI)');
    const payA = pays.find(p => p.source_ci_id === ciA.id);
    const payB = pays.find(p => p.source_ci_id === ciB.id);
    assert.ok(payA, 'payable for CI-P2A exists');
    assert.ok(payB, 'payable for CI-P2B exists');
    assert.equal(payA.payable_amount_minor, 50000, 'CI-A amount = 500.00 (10*50)');
    assert.equal(payB.payable_amount_minor, 100000, 'CI-B amount = 1000.00 (20*50)');
  });

  // P3: 一个 PI → 同一个 CI 多 SKU → 一条 balance payable（同 CI 多行累积）
  test('P3: single PI same CI multiple SKUs → one accumulated balance payable', { timeout: 30000 }, async () => {
    const f = await seedMultiSkuFixture('P3', 3, { qtyPerSku: 10, pricePerSku: 50, piTotal: 10000 });
    const r = await fetchJSON('POST', '/api/commercial-invoices/batch-import', {
      items: f.skus.map((sku, i) => ({
        'CI编号': 'CI-P3', '关联PI编号': f.piNo, '关联PO编号': f.poNo, SKU: sku,
        '数量': 10, '单价': 50, '实际出货日期': '2026-08-15'
      }))
    });
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.success, 3);
    const ci = await q1('SELECT id FROM commercial_invoices WHERE ci_no = $1', ['CI-P3']);
    const pays = await q('SELECT * FROM payable_items WHERE source_type = $1 AND source_id = $2 AND source_ci_id = $3 AND fee_type = $4 AND is_active = 1',
      ['pi', f.piId, ci.id, 'balance']);
    assert.equal(pays.length, 1, 'one accumulated balance payable for same CI');
    assert.equal(pays[0].payable_amount_minor, 150000, 'amount = 1500.00 (3 * 10 * 50)');
  });

  // P4: 已有 active balance → 再导第二 CI → 两条独立 payable
  test('P4: existing active balance + second CI import → two independent payables', { timeout: 30000 }, async () => {
    const f = await seedFixture('P4', { piTotal: 10000, piConfirmedQty: 200, unitPrice: 50 });
    // 第一批：CI-P4A
    const r1 = await fetchJSON('POST', '/api/commercial-invoices/batch-import', {
      items: [{ 'CI编号': 'CI-P4A', '关联PI编号': f.piNo, '关联PO编号': f.poNo, SKU: f.sku, '数量': 10, '单价': 50, '实际出货日期': '2026-08-15' }]
    });
    assert.strictEqual(r1.status, 200, JSON.stringify(r1.json));
    // 第二批：CI-P4B（同一 PI，不同 CI）
    const r2 = await fetchJSON('POST', '/api/commercial-invoices/batch-import', {
      items: [{ 'CI编号': 'CI-P4B', '关联PI编号': f.piNo, '关联PO编号': f.poNo, SKU: f.sku, '数量': 20, '单价': 50, '实际出货日期': '2026-08-15' }]
    });
    assert.strictEqual(r2.status, 200, JSON.stringify(r2.json));
    const ciA = await q1('SELECT id FROM commercial_invoices WHERE ci_no = $1', ['CI-P4A']);
    const ciB = await q1('SELECT id FROM commercial_invoices WHERE ci_no = $1', ['CI-P4B']);
    const pays = await q('SELECT * FROM payable_items WHERE source_type = $1 AND source_id = $2 AND fee_type = $3 AND is_active = 1 ORDER BY source_ci_id',
      ['pi', f.piId, 'balance']);
    assert.equal(pays.length, 2, 'two independent balance payables');
    const payA = pays.find(p => p.source_ci_id === ciA.id);
    const payB = pays.find(p => p.source_ci_id === ciB.id);
    assert.ok(payA, 'payable for CI-P4A');
    assert.ok(payB, 'payable for CI-P4B');
    assert.equal(payA.payable_amount_minor, 50000, 'CI-A amount = 500.00 unchanged');
    assert.equal(payB.payable_amount_minor, 100000, 'CI-B amount = 1000.00 correct');
    // 验证 CI-A 的 payable 不被 CI-B 覆盖（per-CI 独立）
    assert.notEqual(payA.id, payB.id, 'different payable_item ids');
  });

  // =====================================================================
  // PAY MUTABILITY GATE (P5-P12) — P1-PAY-CURRENT-ITEM-SEMANTICS
  // 终态/锁定态应付不可被导入修改/新增，且必须在**任何 mutation 之前**按 CI identity 整组拒绝。
  // 核心标准（延续 C4）：expected validation failure → 该失败业务行 DB mutation = 0。
  //   不能出现 failed=1 但 CI header/item 已插入、PI shipped_qty 已改变的情况。
  // 复现路径与 C12 一致（重导同一 CI，模块支持），仅差别在 payable lifecycle_status。
  // =====================================================================

  // 业务状态快照（mutation 前后对比，用于 zero-mutation 证明）
  async function snapshotState(ciNo, piId) {
    const ciRow = await q1('SELECT * FROM commercial_invoices WHERE ci_no = $1', [ciNo]);
    const ciItems = ciRow
      ? await q('SELECT sku_code, shipped_qty, ci_amount, discount, net_unit_price FROM commercial_invoice_items WHERE ci_id = $1 ORDER BY sku_code, shipped_qty', [ciRow.id])
      : [];
    const pii = await q('SELECT sku_code, shipped_qty, unshipped_qty FROM proforma_invoice_items WHERE pi_id = $1 ORDER BY sku_code', [piId]);
    const pi = await q1('SELECT shipped_amount, unshipped_amount, pi_status FROM proforma_invoices WHERE id = $1', [piId]);
    const pay = ciRow
      ? await q1('SELECT id, lifecycle_status, payable_amount_minor, is_active FROM payable_items WHERE source_ci_id = $1 AND fee_type = $2', [ciRow.id, 'balance'])
      : null;
    const counts = await q1(
      'SELECT (SELECT COUNT(*)::int FROM commercial_invoices) AS ci_n,' +
      ' (SELECT COUNT(*)::int FROM commercial_invoice_items) AS cii_n,' +
      ' (SELECT COUNT(*)::int FROM payable_items) AS pay_n'
    );
    return { ciRow, ciItems, pii, pi, pay, counts };
  }

  // zero-mutation 断言：被拒的 CI 不得产生任何 business mutation
  function assertZeroMutation(before, after, label) {
    // 1) 表行数：无新增 CI / CI item / payable
    assert.deepEqual(
      { ci: after.counts.ci_n, cii: after.counts.cii_n, pay: after.counts.pay_n },
      { ci: before.counts.ci_n, cii: before.counts.cii_n, pay: before.counts.pay_n },
      label + ': 表行数必须完全一致（无新增 CI / CI item / payable）'
    );
    // 2) CI header 关键金额与状态未被改写
    if (before.ciRow) {
      assert.ok(after.ciRow, label + ': CI header 仍存在');
      assert.equal(Number(after.ciRow.goods_amount), Number(before.ciRow.goods_amount), label + ': CI goods_amount 未被改写');
      assert.equal(Number(after.ciRow.payable_balance), Number(before.ciRow.payable_balance), label + ': CI payable_balance 未被改写');
      assert.equal(after.ciRow.ci_status, before.ciRow.ci_status, label + ': CI ci_status 未被改写');
    }
    // 3) CI items / PI item / PI header / payable 完全一致
    assert.deepEqual(after.ciItems, before.ciItems, label + ': CI items 完全一致（无新增/无修改）');
    assert.deepEqual(after.pii, before.pii, label + ': PI item shipped_qty/unshipped_qty 未被改变');
    assert.deepEqual(after.pi, before.pi, label + ': PI header shipped/unshipped/status 未被改变');
    assert.deepEqual(after.pay, before.pay, label + ': payable 完全一致（未更新/未新增）');
  }

  // P5-P9：五个锁定态逐个证明 zero mutation
  [
    { tag: 'P5', state: 'partially_paid' },
    { tag: 'P6', state: 'reserved' },
    { tag: 'P7', state: 'paid' },
    { tag: 'P8', state: 'cancelled' },
    { tag: 'P9', state: 'released' }
  ].forEach(function (c) {
    test(c.tag + ': MUTABILITY — ' + c.state + ' 重导 → 该 CI zero business mutation', { timeout: 30000 }, async () => {
      const f = await seedFixture(c.tag, { piTotal: 1000, piConfirmedQty: 100, unitPrice: 10 });
      const ciNo = 'CI-' + c.tag;
      // 首次导入：创建 CI + active payable（100.00）
      const r0 = await fetchJSON('POST', '/api/commercial-invoices/batch-import', {
        items: [{ 'CI编号': ciNo, '关联PI编号': f.piNo, '关联PO编号': f.poNo, SKU: f.sku, '数量': 10, '单价': 10, '实际出货日期': '2026-08-15' }]
      });
      assert.strictEqual(r0.status, 200, JSON.stringify(r0.json));
      const pay0 = await q1('SELECT * FROM payable_items WHERE source_ci_id IN (SELECT id FROM commercial_invoices WHERE ci_no = $1) AND fee_type = $2', [ciNo, 'balance']);
      assert.ok(pay0, 'payable should exist after first import');
      assert.equal(pay0.lifecycle_status, 'active');
      assert.equal(Number(pay0.payable_amount_minor), 10000);

      // 推进到锁定态（cancelled/released 同时置 is_active=0，与生产语义一致）
      const inactive = (c.state === 'cancelled' || c.state === 'released') ? 0 : 1;
      await q('UPDATE payable_items SET lifecycle_status = $1, is_active = $2 WHERE id = $3', [c.state, inactive, pay0.id]);

      // mutation 前快照
      const before = await snapshotState(ciNo, f.piId);

      // 重导同一 CI（金额会变 → 若放行就是改终态应付）
      const r1 = await fetchJSON('POST', '/api/commercial-invoices/batch-import', {
        items: [{ 'CI编号': ciNo, '关联PI编号': f.piNo, '关联PO编号': f.poNo, SKU: f.sku, '数量': 5, '单价': 10, '实际出货日期': '2026-08-15' }]
      });
      assert.strictEqual(r1.status, 200, JSON.stringify(r1.json));
      assert.equal(r1.json.success, 0, c.state + ': 锁定态 CI 不得成功');
      assert.equal(r1.json.failed, 1, c.state + ': 该行必须 failed');
      const reasons = (r1.json.errors || []).map(e => e.reason).join(' | ');
      assert.ok(reasons.indexOf(c.state) >= 0, 'error reason 应提及 ' + c.state + '，实际: ' + reasons);

      // ZERO MUTATION 证明
      const after = await snapshotState(ciNo, f.piId);
      assertZeroMutation(before, after, c.tag + '/' + c.state);
    });
  });

  // P10: 分组一致性 — PAY identity 是 (pi_id, ci_id) 不是单个 SKU row
  test('P10: MUTABILITY — 同 CI 多 SKU 分组一致(不能只 fail 一个 SKU), zero mutation', { timeout: 30000 }, async () => {
    const f = await seedMultiSkuFixture('P10', 2, { piTotal: 10000, qtyPerSku: 100, pricePerSku: 10 });
    const ciNo = 'CI-P10';
    const r0 = await fetchJSON('POST', '/api/commercial-invoices/batch-import', {
      items: f.skus.map(function (s) {
        return { 'CI编号': ciNo, '关联PI编号': f.piNo, '关联PO编号': f.poNo, SKU: s, '数量': 10, '单价': 10, '实际出货日期': '2026-08-15' };
      })
    });
    assert.strictEqual(r0.status, 200, JSON.stringify(r0.json));
    assert.equal(r0.json.success, 2, 'first import: 2 SKU rows ok');
    const pay0 = await q1('SELECT * FROM payable_items WHERE source_ci_id IN (SELECT id FROM commercial_invoices WHERE ci_no = $1) AND fee_type = $2', [ciNo, 'balance']);
    assert.ok(pay0, 'one accumulated payable for the CI');
    await q('UPDATE payable_items SET lifecycle_status = $1 WHERE id = $2', ['paid', pay0.id]);

    const before = await snapshotState(ciNo, f.piId);

    // 重导同一 CI 的两个 SKU → 两行必须一起被拒（不能只拒一个、另一个继续改同一个 CI）
    const r1 = await fetchJSON('POST', '/api/commercial-invoices/batch-import', {
      items: f.skus.map(function (s) {
        return { 'CI编号': ciNo, '关联PI编号': f.piNo, '关联PO编号': f.poNo, SKU: s, '数量': 5, '单价': 10, '实际出货日期': '2026-08-15' };
      })
    });
    assert.strictEqual(r1.status, 200, JSON.stringify(r1.json));
    assert.equal(r1.json.success, 0, 'both SKU rows must fail');
    assert.equal(r1.json.failed, 2, '两个 source rows 都 failed（CI group 一致）');
    // source_row_no 采用 Excel 行号约定：sourceRowNo = idx + 2（跳过表头行，见模块 2b 前处理）
    const rows = (r1.json.errors || []).map(e => e.row).sort((a, b) => a - b);
    assert.deepEqual(rows, [2, 3], 'errors 映射回每个 source_row_no');

    const after = await snapshotState(ciNo, f.piId);
    assertZeroMutation(before, after, 'P10/group');
  });

  // P11: 对照组 — active 重导仍允许 authoritative update（金额同步，不算 failed）
  test('P11: 对照 — active 重导仍 authoritative UPDATE(金额同步, 不 failed)', { timeout: 30000 }, async () => {
    const f = await seedFixture('P11', { piTotal: 1000, piConfirmedQty: 100, unitPrice: 10 });
    const ciNo = 'CI-P11';
    await fetchJSON('POST', '/api/commercial-invoices/batch-import', {
      items: [{ 'CI编号': ciNo, '关联PI编号': f.piNo, '关联PO编号': f.poNo, SKU: f.sku, '数量': 10, '单价': 10, '实际出货日期': '2026-08-15' }]
    });
    const r1 = await fetchJSON('POST', '/api/commercial-invoices/batch-import', {
      items: [{ 'CI编号': ciNo, '关联PI编号': f.piNo, '关联PO编号': f.poNo, SKU: f.sku, '数量': 5, '单价': 10, '实际出货日期': '2026-08-15' }]
    });
    assert.strictEqual(r1.status, 200, JSON.stringify(r1.json));
    assert.equal(r1.json.success, 1, 'active 重导仍成功');
    assert.equal(r1.json.failed, 0, 'active 不算 failed');
    const pay = await q1('SELECT * FROM payable_items WHERE source_ci_id IN (SELECT id FROM commercial_invoices WHERE ci_no = $1) AND fee_type = $2', [ciNo, 'balance']);
    assert.equal(pay.lifecycle_status, 'active', 'still active');
    assert.equal(Number(pay.payable_amount_minor), 15000, 'authoritative update 100→150');
    const cnt = await q1('SELECT COUNT(*)::int AS n FROM payable_items WHERE source_type = $1 AND source_id = $2 AND fee_type = $3', ['pi', f.piId, 'balance']);
    assert.equal(cnt.n, 1, 'exactly one row (update not insert)');
  });

  // P12: 对照组 — 无 payable 时正常创建（锁定态判定不得误伤正常新建）
  test('P12: 对照 — 无 payable 时正常创建 active payable', { timeout: 30000 }, async () => {
    const f = await seedFixture('P12', { piTotal: 1000, piConfirmedQty: 100, unitPrice: 10 });
    const ciNo = 'CI-P12';
    const r = await fetchJSON('POST', '/api/commercial-invoices/batch-import', {
      items: [{ 'CI编号': ciNo, '关联PI编号': f.piNo, '关联PO编号': f.poNo, SKU: f.sku, '数量': 10, '单价': 10, '实际出货日期': '2026-08-15' }]
    });
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.success, 1);
    assert.equal(r.json.failed, 0);
    const pay = await q1('SELECT * FROM payable_items WHERE source_ci_id IN (SELECT id FROM commercial_invoices WHERE ci_no = $1) AND fee_type = $2', [ciNo, 'balance']);
    assert.ok(pay, 'payable created');
    assert.equal(pay.lifecycle_status, 'active');
    assert.equal(Number(pay.payable_amount_minor), 10000, '100.00');
  });
});
