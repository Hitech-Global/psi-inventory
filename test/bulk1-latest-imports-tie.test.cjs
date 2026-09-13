'use strict';
/**
 * BULK-1 — latestImportsSqlForKeySet set-based 重写的 tie 语义等价性证明（真实 PostgreSQL）
 * ===========================================================================================
 * v2：共同 created_at 的旧 tie fixtures 保留旧多重集；不同事件按最新日、最新 created_at 选择。
 *
 * 方法：在同一份真实 PG 数据上【同时】跑旧 SQL（BULK-1 之前的 correlated-MAX 版本，
 *      以 LEGACY_SQL 字面量冻结在本文件内）与当前 server.js 实际导出的
 *      latestImportsSqlForKeySet()，在共同 created_at fixtures 上比较多重集。
 *      v2 不同事件另用定向用例及独立 JS oracle 做差分验证。
 *
 * 覆盖：
 *   Case 1  同 key，2026-09-10 单行        → 返回 1 条
 *   Case 2  同 key，2026-09-10 两行        → 必须返回 2 条（tie 不得被 arbitrary pick）
 *   Case 3  同 key 2026-09-09×3 / 09-10×2  → 只返回 09-10 的 2 条
 *   Case 4  多 key 混合 tie / non-tie      → 每 key 独立取自己的 max date
 *   Case 5  tombstone 条件与旧 SQL 完全一致（抑制 / 部分抑制 / 全部抑制）
 *   Case 6  重复 key 出现在 jsonb key set  → 输出不放大（DISTINCT 生效）
 *   Case 7  随机 fuzz 差分（200 组）        → 旧/新输出多重集恒等
 *   Case 8  静态约束：新 SQL 不得出现 DISTINCT ON / MAX(id) / ORDER BY id ... LIMIT
 *   Case 9  下游 fallback 前置条件仍在：tie key 的 inventory_match_count > 1 守卫未被移除
 *
 * 真 PG：嵌入式 PostgreSQL（.pgtest/pg16bin），或 BULK1_PG_DSN 指向已运行的本地实例
 *       （仅允许 localhost / 127.0.0.1 / ::1；绝不允许指向生产库）。
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const net = require('net');
const { execSync, spawn } = require('child_process');
const { Client } = require('pg');

const REPO = path.resolve(__dirname, '..');
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const exec = (cmd, opts) => execSync(cmd, Object.assign({ stdio: 'pipe', timeout: 180000 }, opts || {}));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function freePort() {
  return new Promise(resolve => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

async function ensureEmbeddedPg() {
  if (process.env.BULK1_PG_DSN) {
    const u = new URL(process.env.BULK1_PG_DSN.replace(/^postgres:\/\//, 'postgresql://'));
    if (!LOCAL_HOSTS.has(u.hostname)) throw new Error('BULK1-PG-GUARD: 主机不在白名单: ' + u.hostname);
    return { dsn: process.env.BULK1_PG_DSN, proc: null };
  }
  const pgtestDir = path.join(REPO, '.pgtest');
  const binDir = path.join(pgtestDir, 'pg16bin');
  const pgBin = path.join(binDir, 'bin');
  if (!fs.existsSync(path.join(pgBin, 'postgres'))) {
    fs.mkdirSync(binDir, { recursive: true });
    const jarPath = path.join(pgtestDir, 'pg16.jar');
    if (!fs.existsSync(jarPath)) {
      console.log('[BULK1-PG] 下载嵌入式 PostgreSQL 16.15 二进制（首次运行一次）...');
      exec('curl -sfL -o "' + jarPath + '" https://repo1.maven.org/maven2/io/zonky/test/postgres/embedded-postgres-binaries-darwin-arm64v8/16.15.0/embedded-postgres-binaries-darwin-arm64v8-16.15.0.jar', { timeout: 300000 });
    }
    exec('cd "' + pgtestDir + '" && unzip -oq pg16.jar && tar -xf postgres-darwin-arm_64.txz -C "' + binDir + '" && xattr -dr com.apple.quarantine "' + binDir + '"');
  }
  const port = await freePort();
  const dataDir = path.join(pgtestDir, 'data_bulk1_' + port);
  fs.mkdirSync(dataDir, { recursive: true });
  exec('"' + path.join(pgBin, 'initdb') + '" -D "' + dataDir + '" -U postgres --auth-host=trust --auth-local=trust');
  const pgLogFile = path.join(dataDir, 'pg.log');
  const proc = spawn(path.join(pgBin, 'postgres'),
    ['-D', dataDir, '-p', String(port), '-c', 'listen_addresses=127.0.0.1', '-c', 'logging_collector=off'],
    { stdio: ['ignore', fs.openSync(pgLogFile, 'a'), fs.openSync(pgLogFile, 'a')], detached: true });
  proc.unref();
  const dsn = 'postgres://postgres@127.0.0.1:' + port + '/postgres';
  for (let i = 0; i < 60; i++) {
    try { const c = new Client({ connectionString: dsn }); await c.connect(); await c.query('SELECT 1'); await c.end(); return { dsn, proc }; }
    catch (e) { await sleep(500); }
  }
  let tail = ''; try { tail = fs.readFileSync(pgLogFile, 'utf8').split('\n').slice(-20).join('\n'); } catch (e) {}
  throw new Error('PG 启动超时: ' + tail);
}

// ---------------------------------------------------------------------------
// Legacy differential fixtures deliberately share one created_at event; v2 must preserve all old ties.
// LEGACY SQL —— BULK-1 之前的 server.js:4516-4540 原样冻结（差分基准，禁止修改）
// ---------------------------------------------------------------------------
const LEGACY_SQL = `
  SELECT sku_code, country, warehouse, available_qty, import_date, snapshot_cutoff_date, weighted_avg_cost, last_inbound_date, first_inbound_date
  FROM inventory_imports i1
  WHERE i1.import_date IS NOT NULL AND i1.import_date <> ''
    AND NOT EXISTS (
      SELECT 1 FROM inventory_delete_tombstones t1
      WHERE t1.sku_code = i1.sku_code AND t1.country = i1.country AND t1.warehouse = i1.warehouse
    )
    AND i1.import_date::date = (
      SELECT MAX(i2.import_date::date)
      FROM inventory_imports i2
      WHERE i2.sku_code = i1.sku_code AND i2.country = i1.country AND i2.warehouse = i1.warehouse
        AND i2.import_date IS NOT NULL AND i2.import_date <> ''
        AND NOT EXISTS (
          SELECT 1 FROM inventory_delete_tombstones t2
          WHERE t2.sku_code = i2.sku_code AND t2.country = i2.country AND t2.warehouse = i2.warehouse
        )
    )
    AND (i1.sku_code, i1.country, i1.warehouse) IN (
      SELECT j.sku_code, j.country, j.warehouse
      FROM jsonb_to_recordset($1::jsonb) AS j(sku_code text, country text, warehouse text)
    )`;

const DDL = `
  DROP TABLE IF EXISTS inventory_imports;
  DROP TABLE IF EXISTS inventory_delete_tombstones;
  CREATE TABLE inventory_imports (
    id TEXT PRIMARY KEY,
    import_date TEXT NOT NULL,
    country TEXT DEFAULT '',
    warehouse TEXT DEFAULT '',
    channel TEXT DEFAULT '',
    sku_code TEXT DEFAULT '',
    available_qty INTEGER DEFAULT 0,
    last_inbound_date TEXT DEFAULT '',
    first_inbound_date TEXT DEFAULT '',
    remark TEXT DEFAULT '',
    snapshot_cutoff_date TEXT DEFAULT '',
    brand TEXT DEFAULT '',
    weighted_avg_cost NUMERIC(18,4) DEFAULT 0,
    created_at TEXT DEFAULT NOW()
  );
  CREATE TABLE inventory_delete_tombstones (
    id TEXT PRIMARY KEY NOT NULL,
    sku_code TEXT NOT NULL DEFAULT '',
    country TEXT NOT NULL DEFAULT '',
    warehouse TEXT NOT NULL DEFAULT '',
    deleted_at TEXT DEFAULT NOW(),
    deleted_by TEXT DEFAULT '',
    reason TEXT DEFAULT '',
    created_at TEXT DEFAULT NOW(),
    UNIQUE (sku_code, country, warehouse)
  );`;

let emb, admin, NEW_SQL;
let seq = 0;

const COUNTRY = 'Indonesia';
const WH = 'Bekasi';

function norm(rows) {
  // 多重集比较：把每行规范化为稳定字符串后排序（重复行必须保留）
  return rows.map(r => JSON.stringify([
    r.sku_code, r.country, r.warehouse,
    String(r.available_qty), String(r.import_date), String(r.snapshot_cutoff_date),
    String(r.weighted_avg_cost), String(r.last_inbound_date), String(r.first_inbound_date)
  ])).sort();
}

async function reset() {
  await admin.query(DDL);
}
async function addImport(sku, date, opts) {
  opts = opts || {};
  await admin.query(
    'INSERT INTO inventory_imports (id, import_date, country, warehouse, sku_code, available_qty, weighted_avg_cost, last_inbound_date, first_inbound_date, snapshot_cutoff_date, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
    ['IMP' + (++seq), String(date), opts.country || COUNTRY, opts.warehouse || WH, sku,
      opts.qty === undefined ? 10 : opts.qty,
      opts.wac === undefined ? 5 : opts.wac,
      opts.lastInbound === undefined ? '' : opts.lastInbound,
      opts.firstInbound === undefined ? '' : opts.firstInbound,
      opts.cutoff === undefined ? '' : opts.cutoff,
      opts.createdAt === undefined ? '2026-09-13 08:00:00' : opts.createdAt]);
}
async function tombstone(sku, country, warehouse) {
  await admin.query('INSERT INTO inventory_delete_tombstones (id, sku_code, country, warehouse) VALUES ($1,$2,$3,$4)',
    ['T' + (++seq), sku, country || COUNTRY, warehouse || WH]);
}

/** 同时跑旧/新 SQL 并比较多重集；返回 { legacy, next } */
async function diffRun(keys) {
  const payload = JSON.stringify(keys.map(k => typeof k === 'string'
    ? { sku_code: k, country: COUNTRY, warehouse: WH }
    : { sku_code: k.sku_code, country: k.country || COUNTRY, warehouse: k.warehouse || WH }));
  const a = await admin.query(LEGACY_SQL, [payload]);
  const b = await admin.query(NEW_SQL, [payload]);
  return { legacy: norm(a.rows), next: norm(b.rows), legacyRows: a.rows, nextRows: b.rows };
}

function assertEquivalent(res, label) {
  assert.deepEqual(res.next, res.legacy,
    label + ' → 新 SQL 输出与旧 SQL 不等价\n  legacy=' + JSON.stringify(res.legacy, null, 2) + '\n  new   =' + JSON.stringify(res.next, null, 2));
}

describe('BULK-1: latestImportsSqlForKeySet tie 语义等价性（真 PG）', { timeout: 600000 }, () => {
  before(async () => {
    emb = await ensureEmbeddedPg();
    admin = new Client({ connectionString: emb.dsn });
    await admin.connect();
    // 生产同构：创建 BULK-1 候选索引（差分测试与性能基准都用"有索引"形态）
    await admin.query(DDL);
    await admin.query('CREATE INDEX IF NOT EXISTS idx_inventory_imports_latest ON inventory_imports (sku_code, country, warehouse, import_date)');

    // 取 server.js 实际导出的 SQL 字符串（证明测的是真正发往生产库的那条 SQL）
    process.env.DB_DRIVER = 'pg';
    process.env.DATABASE_URL = emb.dsn;
    process.env.NODE_ENV = 'test';
    const S = require('../server.js');
    assert.equal(typeof S.latestImportsSqlForKeySet, 'function', 'server.js 必须导出 latestImportsSqlForKeySet');
    NEW_SQL = S.latestImportsSqlForKeySet();
  });

  after(async () => {
    try { if (admin) await admin.end(); } catch (e) {}
    try { if (emb && emb.proc) process.kill(-emb.proc.pid, 'SIGKILL'); } catch (e) {}
  });

  test('Case 1: 同 key，2026-09-10 单行 → 返回 1 条', async () => {
    await reset();
    await addImport('SKU-1', '2026-09-10', { qty: 11 });
    const r = await diffRun(['SKU-1']);
    assertEquivalent(r, 'Case1');
    assert.equal(r.next.length, 1, 'Case1 应返回 1 条');
  });

  test('Case 2: 同 key，2026-09-10 两行 → 必须返回 2 条（tie 不得被 arbitrary pick）', async () => {
    await reset();
    await addImport('SKU-1', '2026-09-10', { qty: 11 });
    await addImport('SKU-1', '2026-09-10', { qty: 22 });
    const r = await diffRun(['SKU-1']);
    assertEquivalent(r, 'Case2');
    assert.equal(r.next.length, 2, 'Case2 tie 必须返回 2 条（否则会绕过 duplicate-key fallback）');
    const qtys = r.nextRows.map(x => Number(x.available_qty)).sort((a, b) => a - b);
    assert.deepEqual(qtys, [11, 22]);
  });

  test('Case 3: 同 key 2026-09-09×3 / 2026-09-10×2 → 只返回 09-10 的 2 条', async () => {
    await reset();
    await addImport('SKU-1', '2026-09-09', { qty: 1 });
    await addImport('SKU-1', '2026-09-09', { qty: 2 });
    await addImport('SKU-1', '2026-09-09', { qty: 3 });
    await addImport('SKU-1', '2026-09-10', { qty: 91 });
    await addImport('SKU-1', '2026-09-10', { qty: 92 });
    const r = await diffRun(['SKU-1']);
    assertEquivalent(r, 'Case3');
    assert.equal(r.next.length, 2, 'Case3 应只返回 max date 的 2 条');
    assert.deepEqual(r.nextRows.map(x => Number(x.available_qty)).sort((a, b) => a - b), [91, 92]);
  });

  test('Case 4: 多 key 混合 tie / non-tie → 每 key 独立取自己的 max date', async () => {
    await reset();
    await addImport('SKU-A', '2026-09-01', { qty: 1 });
    await addImport('SKU-A', '2026-09-05', { qty: 2 });   // max=09-05, 1 条
    await addImport('SKU-B', '2026-09-02', { qty: 3 });
    await addImport('SKU-B', '2026-09-07', { qty: 4 });   // max=09-07, 2 条 tie
    await addImport('SKU-B', '2026-09-07', { qty: 5 });
    await addImport('SKU-C', '2026-08-30', { qty: 6 });   // 未被查询，不应出现
    const r = await diffRun(['SKU-A', 'SKU-B']);
    assertEquivalent(r, 'Case4');
    assert.equal(r.next.length, 3, 'A 1 条 + B 2 条 = 3 条');
    const bySku = {};
    for (const x of r.nextRows) bySku[x.sku_code] = (bySku[x.sku_code] || 0) + 1;
    assert.deepEqual(bySku, { 'SKU-A': 1, 'SKU-B': 2 });
    assert.ok(!r.nextRows.some(x => x.sku_code === 'SKU-C'), 'SKU-C 不在 key set，不得返回');
  });

  test('Case 5: tombstone 条件与旧 SQL 完全一致', async () => {
    await reset();
    // 5a 全抑制：key 被 tombstone → 0 条
    await addImport('SKU-T1', '2026-09-10', { qty: 1 });
    await tombstone('SKU-T1');
    // 5b 部分抑制：最新日期被抑制 → max 只从非抑制行算（旧 SQL 的 i2 也带 tombstone NOT EXISTS）
    await addImport('SKU-T2', '2026-09-08', { qty: 2 });
    await addImport('SKU-T2', '2026-09-10', { qty: 3 });
    await tombstone('SKU-T2');
    // 5c 跨 warehouse 不受影响（tombstone 按 (sku,country,warehouse) tuple）
    await addImport('SKU-T3', '2026-09-10', { qty: 4, warehouse: 'Bekasi' });
    await addImport('SKU-T3', '2026-09-11', { qty: 5, warehouse: 'Jakarta' });
    await tombstone('SKU-T3', COUNTRY, 'Jakarta');
    // 5d 无 tombstone 的正常 key
    await addImport('SKU-T4', '2026-09-10', { qty: 6 });

    const r = await diffRun([
      'SKU-T1', 'SKU-T2',
      { sku_code: 'SKU-T3', warehouse: 'Bekasi' },
      { sku_code: 'SKU-T3', warehouse: 'Jakarta' },
      'SKU-T4'
    ]);
    assertEquivalent(r, 'Case5');
    const rows = r.nextRows;
    assert.ok(!rows.some(x => x.sku_code === 'SKU-T1'), '5a 全抑制 → 0 条');
    assert.ok(!rows.some(x => x.sku_code === 'SKU-T2'), '5b 最新日期被抑制且该 tuple 全抑制 → 0 条');
    const t3 = rows.filter(x => x.sku_code === 'SKU-T3');
    assert.equal(t3.length, 1, '5c 只有 Bekasi 保留');
    assert.equal(t3[0].warehouse, 'Bekasi');
    assert.ok(rows.some(x => x.sku_code === 'SKU-T4'), '5d 正常 key 保留');
  });

  test('Case 6: key set 内重复 key → 输出不放大（DISTINCT 生效）', async () => {
    await reset();
    await addImport('SKU-D', '2026-09-10', { qty: 7 });
    const r = await diffRun(['SKU-D', 'SKU-D', 'SKU-D']);
    assertEquivalent(r, 'Case6');
    assert.equal(r.next.length, 1, '重复 key 不得放大输出行数');
  });

  test('Case 7: 随机 fuzz 差分（旧/新输出多重集恒等）', async () => {
    let seed = 20260913;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    for (let iter = 0; iter < 200; iter++) {
      await reset();
      const nKeys = 1 + Math.floor(rnd() * 4);
      const keys = [];
      for (let k = 0; k < nKeys; k++) {
        const sku = 'SKU-' + k;
        keys.push(sku);
        const nRows = Math.floor(rnd() * 6); // 0..5 行
        for (let i = 0; i < nRows; i++) {
          const day = 1 + Math.floor(rnd() * 5);
          const date = '2026-09-0' + day;
          await addImport(sku, date, { qty: Math.floor(rnd() * 100) });
        }
        if (rnd() < 0.25) await tombstone(sku);
      }
      // 偶尔塞入重复 key / 不存在的 key
      const probe = keys.slice();
      if (rnd() < 0.5 && keys.length) probe.push(keys[0]);
      probe.push('SKU-MISSING');
      const r = await diffRun(probe);
      assertEquivalent(r, 'Case7 iter=' + iter + ' keys=' + JSON.stringify(probe));
    }
  });

  test('v2: latest day first, then newest event; defensive date prefix', async () => {
    await reset();
    await addImport('EVENT', '2026-09-09', { qty: 99, createdAt: '2026-09-14 00:00:00' });
    await addImport('EVENT', '2026-09-10', { qty: 10, createdAt: '2026-09-13 08:00:00' });
    await addImport('EVENT', ' 2026-09-10T23:45:00+07:00 ', { qty: 20, createdAt: '2026-09-13 09:00:00' });
    const r = await admin.query(NEW_SQL, [JSON.stringify([{sku_code: 'EVENT', country: COUNTRY, warehouse: WH}])]);
    assert.deepEqual(r.rows.map(x => x.available_qty), [20]);
  });

  test('v2: conflicting exact max event ties survive, null-safe event selection', async () => {
    await reset();
    await addImport('TIE', '2026-09-10', { qty: 1, createdAt: '2026-09-13 08:00:00' });
    await addImport('TIE', '2026-09-10', { qty: 2, createdAt: '2026-09-13 09:00:00' });
    await addImport('TIE', '2026-09-10', { qty: 3, createdAt: '2026-09-13 09:00:00' });
    await addImport('TIE', '2026-09-10', { qty: 4, createdAt: null });
    await addImport('NULL', '2026-09-10', { qty: 5, createdAt: null });
    await addImport('NULL', '2026-09-10', { qty: 6, createdAt: null });
    const keys = ['TIE', 'NULL'].map(sku_code => ({sku_code, country: COUNTRY, warehouse: WH}));
    const r = await admin.query(NEW_SQL, [JSON.stringify(keys)]);
    assert.deepEqual(r.rows.map(x => x.available_qty).sort(), [2, 3, 5, 6]);
  });

  test('v2: repeated same-day imports for 577 keys collapse to 577 latest events', async () => {
    await reset();
    await admin.query(`INSERT INTO inventory_imports
      (id, sku_code, country, warehouse, import_date, created_at, available_qty)
      SELECT k||'-'||e, 'PROD-'||k, 'Indonesia', 'Bekasi', '2026-09-10',
             '2026-09-13 '||lpad(e::text,2,'0')||':00:00', e
      FROM generate_series(1,577) k CROSS JOIN generate_series(1,14) e`);
    const keys = Array.from({length:577}, (_, i) => ({sku_code:'PROD-'+(i+1), country:COUNTRY, warehouse:WH}));
    const r = await admin.query(NEW_SQL, [JSON.stringify(keys)]);
    assert.equal(r.rows.length, 577);
    assert.ok(r.rows.every(x => x.available_qty === 14));
    assert.equal(new Set(r.rows.map(x => x.sku_code)).size, 577);
  });

  test('v2: randomized event differential against independent JS oracle (100 sets)', async () => {
    let seed = 913;
    const rnd = n => { seed = (Math.imul(seed,1664525)+1013904223) >>> 0; return seed % n; };
    for (let iteration=0; iteration<100; iteration++) {
      await reset();
      const suppressed = new Set();
      const keys = [];
      for (let k=0; k<5; k++) {
        const sku = 'FUZZ-'+k;
        if (k<4) keys.push({sku_code:sku,country:COUNTRY,warehouse:WH});
        if (rnd(4)===0) { await tombstone(sku); suppressed.add(sku); }
        for (let row=0; row<8; row++) {
          await addImport(sku, '2026-09-0'+(1+rnd(3)), {
            qty:rnd(100), createdAt:[null,'','2026-09-13 08:00:00','2026-09-13 09:00:00'][rnd(4)]
          });
        }
      }
      keys.push(keys[0]); // duplicate input must not amplify rows
      const all = (await admin.query('SELECT * FROM inventory_imports')).rows;
      const expected = [];
      for (const sku of new Set(keys.map(k=>k.sku_code))) {
        if (suppressed.has(sku)) continue;
        const rows = all.filter(r=>r.sku_code===sku);
        const day = rows.map(r=>r.import_date.trim().slice(0,10)).sort().at(-1);
        const latest = rows.filter(r=>r.import_date.trim().slice(0,10)===day);
        const maxCreated = latest.map(r=>r.created_at).filter(x=>x!==null).sort().at(-1) ?? null;
        expected.push(...latest.filter(r=>r.created_at===maxCreated));
      }
      const actual = (await admin.query(NEW_SQL,[JSON.stringify(keys)])).rows;
      assert.deepEqual(norm(actual),norm(expected),'event oracle iteration '+iteration);
    }
  });

  test('Case 8: 静态约束 —— 新 SQL 不得出现 arbitrary-pick 写法', () => {
    const s = NEW_SQL;
    assert.ok(!/DISTINCT\s+ON/i.test(s), '禁止 DISTINCT ON（会 arbitrary pick 单行，绕过 duplicate fallback）');
    assert.ok(!/MAX\s*\(\s*id\s*\)/i.test(s), '禁止 MAX(id)');
    assert.ok(!/ORDER\s+BY[\s\S]{0,200}id\s+DESC[\s\S]{0,80}LIMIT\s+1/i.test(s), '禁止 ORDER BY id DESC LIMIT 1');
    assert.ok(!/LIMIT\s+1/i.test(s), '禁止 LIMIT 1');
    assert.ok(/MAX\s*\(\s*l?\.?import_day\s*\)\s*OVER\s*\(\s*PARTITION\s+BY/i.test(s),
      '应使用窗口函数 MAX(import_day) OVER (PARTITION BY key) 求每 key 的最大日期（一次扫描）');
    assert.ok(/jsonb_to_recordset/i.test(s), '必须仍然接收 $1 jsonb key set');
    assert.ok(/inventory_delete_tombstones/i.test(s), 'tombstone 过滤不得丢失');
    // 不允许退化回 correlated MAX 子查询（i2 自关联）—— 那正是 BULK-1 要消除的 O(M×K) 形态
    assert.ok(!/inventory_imports\s+i2\b/i.test(s), '不得退回 correlated MAX 子查询');
    // 只有一次 FROM inventory_imports（不得出现 live 自连接导致的二次扫描）
    assert.equal((s.match(/FROM\s+inventory_imports/gi) || []).length, 1,
      'inventory_imports 只能被扫描一次（自连接会让 planner 走 Nested Loop，实测 >120s 超时）');
  });

  test('Case 9: 下游 inventory_match_count>1 fallback 前置条件仍在', () => {
    const src = fs.readFileSync(path.join(REPO, 'server.js'), 'utf8');
    assert.ok(/Number\(r\.inventory_match_count\)\s*>\s*1/.test(src), 'refreshInventoryTotalsForKeys 的 duplicate 守卫不得移除');
    assert.ok(/runOriginalInventoryTotalsLoop/.test(src), 'fallback 函数不得移除');
  });
});
