// ============================================================================
// PAY-SCHEMA-CORRECTION-01: permanent payable identity uniqueness tests
//
// S1  fresh PG schema → 目标 index 定义正确
// S2  old PG schema → migration 后正确
// S3  old + new dual existence → validation 正确
// S4  duplicate exact identity → second INSERT rejected
// S5  same PI + different CI → both INSERT allowed
// S6  same PI + same CI + same fee → rejected
// S7  source_ci_id NULL vs '' → 被视为 same identity
// S8  paid row + same-key new active row → rejected
// S9  partially_paid + same-key active → rejected
// S10 reserved + same-key active → rejected
// S11 cancelled + same-key active → rejected
// S12 released + same-key active → rejected
// S13 已收敛状态 → 重启 initDatabase 零 DDL（索引 oid / relfilenode 不变）
// S14 dual-index 期间旧索引仍阻塞「同 PI 多 CI」（旧索引未 DROP 前不得解冻 Wave 2A）
// S1  附加：source-of-truth 静态/DDL 断言（db-pg.js / db-sqlite.js / db.js 防漂移）
//
// 运行：node --test --test-force-exit test/pay-schema-correction.test.cjs
// ============================================================================

const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const net = require('net');
const { execSync } = require('child_process');
const { Client } = require('pg');

const REPO = path.resolve(__dirname, '..');
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const exec = (cmd, opts = {}) => execSync(cmd, Object.assign({ stdio: 'pipe', timeout: 180000 }, opts));

// ---------------------------------------------------------------------------
// 嵌入式 PG 16（缓存在 .pgtest/pg16bin/，与 schema-consolidation.test.cjs 共用）
// ---------------------------------------------------------------------------
async function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

async function ensureEmbeddedPg() {
  if (process.env.W1_PG_DSN) {
    const u = new URL(process.env.W1_PG_DSN);
    if (!LOCAL_HOSTS.has(u.hostname)) throw new Error('PAY-PG-GUARD: 主机不在白名单: ' + u.hostname);
    return { dsn: process.env.W1_PG_DSN, dataDir: null, pgCtl: null };
  }
  const pgtestDir = path.join(REPO, '.pgtest');
  const binDir = path.join(pgtestDir, 'pg16bin');
  const pgBin = path.join(binDir, 'bin');
  if (!fs.existsSync(path.join(pgBin, 'postgres'))) {
    fs.mkdirSync(binDir, { recursive: true });
    const jarPath = path.join(pgtestDir, 'pg16.jar');
    if (!fs.existsSync(jarPath)) {
      console.log('[PAY-PG] 下载嵌入式 PostgreSQL 16.15 二进制（首次运行一次）...');
      exec('curl -sfL -o "' + jarPath + '" https://repo1.maven.org/maven2/io/zonky/test/postgres/embedded-postgres-binaries-darwin-arm64v8/16.15.0/embedded-postgres-binaries-darwin-arm64v8-16.15.0.jar', { timeout: 300000 });
    }
    exec('cd "' + pgtestDir + '" && unzip -oq pg16.jar && tar -xf postgres-darwin-arm_64.txz -C "' + binDir + '" && xattr -dr com.apple.quarantine "' + binDir + '"');
    console.log('[PAY-PG] 二进制就绪: ' + pgBin);
  }
  const port = await freePort();
  const dataDir = path.join(pgtestDir, 'data-pay-' + Date.now());
  fs.mkdirSync(dataDir, { recursive: true });
  exec('"' + path.join(pgBin, 'initdb') + '" -D "' + dataDir + '" -U postgres -A trust');
  exec('openssl req -new -x509 -days 2 -nodes -subj "/CN=localhost" -keyout "' + dataDir + '/server.key" -out "' + dataDir + '/server.crt"');
  fs.chmodSync(path.join(dataDir, 'server.key'), 0o600);
  fs.appendFileSync(path.join(dataDir, 'postgresql.conf'), `\nssl=on\nlisten_addresses='127.0.0.1'\nport=${port}\n`);
  exec('"' + path.join(pgBin, 'pg_ctl') + '" -D "' + dataDir + '" -l "' + dataDir + '/pg.log" -w -t 60 start');
  console.log('[PAY-PG] 实例已启动 127.0.0.1:' + port);
  return {
    dsn: `postgresql://postgres@127.0.0.1:${port}/postgres`,
    dataDir,
    pgCtl: path.join(pgBin, 'pg_ctl')
  };
}

// 从 db-pg.js 源码提取所有 CREATE TABLE 语句
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

// ---------------------------------------------------------------------------
// 测试基础设施
// ---------------------------------------------------------------------------
let emb, admin, srv, port, schema, testDsn, dataDir;
let dbmod;

async function q(sql, params) { return (await admin.query(sql, params)).rows; }
async function q1(sql, params) { return (await q(sql, params))[0] || null; }

// 清理 payable_items：删除所有行 + 删除两个索引（恢复到"无索引"状态）
async function resetPayableItems() {
  await admin.query('DROP INDEX IF EXISTS uq_payable_active');
  await admin.query('DROP INDEX IF EXISTS uq_payable_identity');
  await admin.query('DELETE FROM payable_items');
}

// 创建旧索引（模拟生产旧 schema）
async function createOldIndex() {
  await admin.query(`CREATE UNIQUE INDEX uq_payable_active ON payable_items(source_type, source_id, fee_type) WHERE is_active = 1`);
}

// 创建新索引（手动，非通过 db.js migration）
async function createNewIndex() {
  await admin.query(`CREATE UNIQUE INDEX uq_payable_identity ON payable_items(source_type, source_id, COALESCE(source_ci_id, ''), fee_type)`);
}

// 获取索引信息
async function getIndexInfo(indexName) {
  const rows = await q(`
    SELECT i.indisvalid, i.indisready, i.indisunique,
      pg_get_expr(i.indpred, i.indrelid) AS predicate,
      pg_get_indexdef(i.indexrelid) AS indexdef
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    WHERE c.relname = $1
  `, [indexName]);
  return rows[0] || null;
}

// 插入 payable_item 辅助函数
async function insertPayable(opts) {
  const id = opts.id || 'pay_' + Math.random().toString(36).slice(2, 8);
  const feeNo = opts.fee_no || 'FN_' + Math.random().toString(36).slice(2, 8);
  const sourceType = opts.source_type || 'pi';
  const sourceId = opts.source_id || 'pi_001';
  const sourceCiId = opts.source_ci_id !== undefined ? opts.source_ci_id : '';
  const feeType = opts.fee_type || 'deposit';
  const isActive = opts.is_active !== undefined ? opts.is_active : 1;
  const lifecycleStatus = opts.lifecycle_status || 'active';
  const currency = opts.currency || 'USD';
  const amount = opts.payable_amount_minor || 10000;
  const payeeKey = opts.payee_key || 'bank:abc';
  const payerKey = opts.payer_entity_key || 'entity:xyz';

  try {
    await admin.query(`
      INSERT INTO payable_items (id, fee_no, source_type, source_id, source_ci_id, fee_type,
        is_active, lifecycle_status, currency, payable_amount_minor, payee_key, payer_entity_key)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    `, [id, feeNo, sourceType, sourceId, sourceCiId, feeType, isActive, lifecycleStatus,
         currency, amount, payeeKey, payerKey]);
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ===========================================================================
// TESTS
// ===========================================================================
describe('PAY-SCHEMA-CORRECTION-01: permanent payable identity uniqueness', () => {
  before(async () => {
    emb = await ensureEmbeddedPg();
    dataDir = emb.dataDir;
    testDsn = emb.dsn;
    admin = new Client({ connectionString: emb.dsn, ssl: { rejectUnauthorized: false } });
    await admin.connect();

    schema = 'pay01_' + Math.random().toString(36).slice(2, 10);
    await admin.query('CREATE SCHEMA "' + schema + '"');
    await admin.query('SET search_path TO "' + schema + '"');
    testDsn = emb.dsn + (emb.dsn.indexOf('?') >= 0 ? '&' : '?') + 'options=-csearch_path%3D' + encodeURIComponent(schema);

    // 从 db-pg.js 提取 CREATE TABLE 语句并执行
    const pgSrc = fs.readFileSync(path.join(REPO, 'db-pg.js'), 'utf8');
    const tables = extractAllCreateTables(pgSrc);
    for (const t of tables) {
      try {
        await admin.query(t.ddl.replace('CREATE TABLE IF NOT EXISTS ' + t.table, 'CREATE TABLE IF NOT EXISTS "' + schema + '".' + t.table));
      } catch (e) { /* 依赖关系导致部分表创建失败，忽略 */ }
    }

    // 补充 lifecycle_status 列（db-pg.js ALTER TABLE 之外）
    try { await admin.query('ALTER TABLE payable_items ADD COLUMN IF NOT EXISTS lifecycle_status TEXT NOT NULL DEFAULT \'active\''); } catch(e) {}
    try { await admin.query('ALTER TABLE payable_items ADD COLUMN IF NOT EXISTS source_ci_id TEXT NOT NULL DEFAULT \'\''); } catch(e) {}
    try { await admin.query('ALTER TABLE payable_items ADD COLUMN IF NOT EXISTS payable_date TEXT DEFAULT \'\''); } catch(e) {}

    // 设置环境变量，加载 db 模块
    process.env.DB_DRIVER = 'pg';
    process.env.DATABASE_URL = testDsn;
    process.env.NODE_ENV = 'test';

    console.log('[PAY-PG] schema=' + schema + ' ready');
  });

  after(async () => {
    try { if (admin) await admin.end(); } catch (e) {}
    if (emb && emb.pgCtl && dataDir) {
      try { exec('"' + emb.pgCtl + '" -D "' + dataDir + '" -m fast stop', { timeout: 60000 }); } catch (e) {}
    }
    if (emb && dataDir) {
      try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (e) {}
    }
  });

  // =========================================================================
  // S1: fresh PG schema → 目标 index 定义正确
  // =========================================================================
  test('S1: fresh PG schema → 目标 index 定义正确', { timeout: 120000 }, async () => {
    await resetPayableItems();

    // 通过 db.js initDatabase 执行迁移（创建 uq_payable_identity）
    dbmod = require('../db');
    dbmod.initDatabase();

    // 验证新索引存在且定义正确
    const idx = await getIndexInfo('uq_payable_identity');
    assert.ok(idx, 'uq_payable_identity 必须存在');
    assert.equal(idx.indisvalid, true, 'indisvalid 必须为 true');
    assert.equal(idx.indisready, true, 'indisready 必须为 true');
    assert.equal(idx.indisunique, true, 'indisunique 必须为 true');
    assert.ok(!idx.predicate || String(idx.predicate).trim() === '', 'index predicate 必须为 none');
    assert.ok(String(idx.indexdef).indexOf('COALESCE') !== -1, 'indexdef 必须包含 COALESCE: ' + idx.indexdef);
    assert.ok(String(idx.indexdef).indexOf('source_ci_id') !== -1, 'indexdef 必须包含 source_ci_id: ' + idx.indexdef);

    // 验证旧索引不存在（fresh schema 不会创建旧索引）
    const oldIdx = await getIndexInfo('uq_payable_active');
    assert.equal(oldIdx, null, 'fresh schema 上 uq_payable_active 不应存在');

    // ---- source-of-truth 静态/DDL 断言：防止 future fresh bootstrap 重新漂移 ----
    // 只跑 runtime 检查不够：db-pg.js 在 worker_threads 模式下是 fresh bootstrap 唯一 DDL 出处，
    // 若其索引名/定义再次漂移，S1 的 runtime 断言（走 db.js migration）可能仍“看起来通过”。
    const pgSrc = fs.readFileSync(path.join(REPO, 'db-pg.js'), 'utf8');
    const sqliteSrc = fs.readFileSync(path.join(REPO, 'db-sqlite.js'), 'utf8');
    const dbSrc = fs.readFileSync(path.join(REPO, 'db.js'), 'utf8');

    // 抽取源码中所有 CREATE UNIQUE INDEX ... uq_payable_identity 语句片段
    const identityCreates = (src) => {
      const out = [];
      const re = /CREATE\s+UNIQUE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?uq_payable_identity/gi;
      let m;
      while ((m = re.exec(src))) out.push(src.slice(m.index, m.index + 300));
      return out;
    };

    for (const [label, src] of [['db-pg.js', pgSrc], ['db-sqlite.js', sqliteSrc]]) {
      const creates = identityCreates(src);
      assert.ok(creates.length >= 1, label + ' 必须创建 canonical index uq_payable_identity');
      for (const stmt of creates) {
        assert.ok(/COALESCE\(\s*source_ci_id/i.test(stmt),
          label + ' 的 uq_payable_identity 必须含 COALESCE(source_ci_id, ...): ' + stmt.slice(0, 160));
        assert.ok(!/WHERE\s+is_active/i.test(stmt),
          label + ' 的 uq_payable_identity 不得带 WHERE is_active partial predicate: ' + stmt.slice(0, 160));
        assert.ok(!/lifecycle_status/i.test(stmt),
          label + ' 的 uq_payable_identity 不得引用 lifecycle_status: ' + stmt.slice(0, 160));
      }
      // 不得再创建旧名索引（DROP 旧索引是允许的迁移动作，不在本断言范围）
      assert.ok(!/CREATE\s+UNIQUE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?uq_payable_active/i.test(src),
        label + ' 不得再创建 uq_payable_active');
    }

    // db.js（生产实际生效迁移入口）：canonical name + CONCURRENTLY + 旧索引 DROP + 不 rename
    assert.ok(/uq_payable_identity/.test(dbSrc), 'db.js 必须使用 canonical name uq_payable_identity');
    assert.ok(/CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS/.test(dbSrc), 'db.js 必须走 CREATE INDEX CONCURRENTLY');
    assert.ok(/DROP INDEX CONCURRENTLY IF EXISTS/.test(dbSrc), 'db.js 必须 DROP 旧索引（CONCURRENTLY）');
    assert.ok(!/uq_payable_identity_v2/.test(dbSrc), 'db.js 不得残留名字漂移 uq_payable_identity_v2');
    // rollback 时间边界必须写进代码注释（Wave 2A 上线后 schema 不回滚到旧 business key）
    assert.ok(/Wave 2A 上线之后：schema 不回滚到旧 business key/.test(dbSrc),
      'db.js 必须写明 rollback 时间边界');
  });

  // =========================================================================
  // S2: old PG schema → migration 后正确
  // =========================================================================
  test('S2: old PG schema → migration 后正确', { timeout: 120000 }, async () => {
    await resetPayableItems();

    // 模拟生产旧 schema：创建旧索引
    await createOldIndex();
    const oldBefore = await getIndexInfo('uq_payable_active');
    assert.ok(oldBefore, '旧索引应存在（S2 前置条件）');

    // 运行 db.js initDatabase 执行迁移
    dbmod.initDatabase();

    // 验证旧索引已删除
    const oldAfter = await getIndexInfo('uq_payable_active');
    assert.equal(oldAfter, null, '旧索引 uq_payable_active 必须已被 DROP');

    // 验证新索引存在且 valid
    const newIdx = await getIndexInfo('uq_payable_identity');
    assert.ok(newIdx, 'uq_payable_identity 必须存在');
    assert.equal(newIdx.indisvalid, true, 'indisvalid 必须为 true');
    assert.equal(newIdx.indisready, true, 'indisready 必须为 true');
    assert.equal(newIdx.indisunique, true, 'indisunique 必须为 true');
    assert.ok(!newIdx.predicate || String(newIdx.predicate).trim() === '', 'index predicate 必须为 none');
    assert.ok(String(newIdx.indexdef).indexOf('COALESCE') !== -1, 'indexdef 必须包含 COALESCE');
  });

  // =========================================================================
  // S3: old + new dual existence → validation 正确
  // =========================================================================
  test('S3: old narrow + new wide dual existence → validation 正确', { timeout: 120000 }, async () => {
    await resetPayableItems();

    // 创建旧 + 新索引（dual-index 共存状态）
    await createOldIndex();
    await createNewIndex();

    const oldBefore = await getIndexInfo('uq_payable_active');
    const newBefore = await getIndexInfo('uq_payable_identity');
    assert.ok(oldBefore, '旧索引应存在（S3 前置条件）');
    assert.ok(newBefore, '新索引应存在（S3 前置条件）');

    // 运行 db.js initDatabase
    dbmod.initDatabase();

    // 验证旧索引已删除
    const oldAfter = await getIndexInfo('uq_payable_active');
    assert.equal(oldAfter, null, 'dual-index 共存后旧索引必须被 DROP');

    // 验证新索引仍然 valid
    const newAfter = await getIndexInfo('uq_payable_identity');
    assert.ok(newAfter, 'uq_payable_identity 必须仍存在');
    assert.equal(newAfter.indisvalid, true, 'indisvalid 必须为 true');
    assert.equal(newAfter.indisready, true, 'indisready 必须为 true');
    assert.equal(newAfter.indisunique, true, 'indisunique 必须为 true');
  });

  // =========================================================================
  // S4: duplicate exact identity → second INSERT rejected
  // =========================================================================
  test('S4: duplicate exact identity → second INSERT rejected', { timeout: 60000 }, async () => {
    await resetPayableItems();
    await createNewIndex();

    const r1 = await insertPayable({ id: 's4_1', source_type: 'pi', source_id: 'pi_s4', source_ci_id: 'ci_a', fee_type: 'deposit' });
    assert.equal(r1.ok, true, '第一次 INSERT 必须成功');

    const r2 = await insertPayable({ id: 's4_2', source_type: 'pi', source_id: 'pi_s4', source_ci_id: 'ci_a', fee_type: 'deposit' });
    assert.equal(r2.ok, false, '第二次 INSERT（完全相同 identity）必须被拒绝');
    assert.ok(r2.error.indexOf('unique') !== -1 || r2.error.indexOf('duplicate') !== -1,
      '错误信息必须包含 unique/duplicate: ' + r2.error);
  });

  // =========================================================================
  // S5: same PI + different CI → both INSERT allowed
  // =========================================================================
  test('S5: same PI + different CI → both INSERT allowed', { timeout: 60000 }, async () => {
    await resetPayableItems();
    await createNewIndex();

    const r1 = await insertPayable({ id: 's5_1', source_type: 'pi', source_id: 'pi_s5', source_ci_id: 'ci_a', fee_type: 'balance' });
    assert.equal(r1.ok, true, 'CI-A 的 INSERT 必须成功');

    const r2 = await insertPayable({ id: 's5_2', source_type: 'pi', source_id: 'pi_s5', source_ci_id: 'ci_b', fee_type: 'balance' });
    assert.equal(r2.ok, true, 'CI-B（不同 CI）的 INSERT 必须成功');
  });

  // =========================================================================
  // S6: same PI + same CI + same fee → rejected
  // =========================================================================
  test('S6: same PI + same CI + same fee → rejected', { timeout: 60000 }, async () => {
    await resetPayableItems();
    await createNewIndex();

    const r1 = await insertPayable({ id: 's6_1', source_type: 'pi', source_id: 'pi_s6', source_ci_id: 'ci_a', fee_type: 'deposit' });
    assert.equal(r1.ok, true, '第一次 INSERT 必须成功');

    const r2 = await insertPayable({ id: 's6_2', source_type: 'pi', source_id: 'pi_s6', source_ci_id: 'ci_a', fee_type: 'deposit' });
    assert.equal(r2.ok, false, '相同 identity（同 PI + 同 CI + 同 fee_type）必须被拒绝');
  });

  // =========================================================================
  // S7: source_ci_id NULL vs '' → 被视为 same identity
  // =========================================================================
  test('S7: source_ci_id NULL vs empty string → 被视为 same identity', { timeout: 60000 }, async () => {
    await resetPayableItems();
    await createNewIndex();

    // 临时允许 NULL（PG CREATE TABLE 定义为 NOT NULL）
    await admin.query('ALTER TABLE payable_items ALTER COLUMN source_ci_id DROP NOT NULL');

    try {
      // 插入 source_ci_id = '' 的行
      const r1 = await insertPayable({ id: 's7_1', source_type: 'pi', source_id: 'pi_s7', source_ci_id: '', fee_type: 'deposit' });
      assert.equal(r1.ok, true, 'source_ci_id="" 的 INSERT 必须成功');

      // 插入 source_ci_id = NULL 的行（相同 identity）
      const r2 = await insertPayable({ id: 's7_2', source_type: 'pi', source_id: 'pi_s7', source_ci_id: null, fee_type: 'deposit' });
      assert.equal(r2.ok, false, 'source_ci_id=NULL（与 "" 相同 identity）必须被拒绝');
      assert.ok(r2.error.indexOf('unique') !== -1 || r2.error.indexOf('duplicate') !== -1,
        '错误信息必须包含 unique/duplicate: ' + r2.error);
    } finally {
      // 恢复 NOT NULL
      await admin.query("ALTER TABLE payable_items ALTER COLUMN source_ci_id SET NOT NULL");
    }
  });

  // =========================================================================
  // S8: paid row + same-key new active row → rejected
  // =========================================================================
  test('S8: paid row + same-key new active row → rejected', { timeout: 60000 }, async () => {
    await resetPayableItems();
    await createNewIndex();

    // 插入 paid 行
    const r1 = await insertPayable({
      id: 's8_1', source_type: 'pi', source_id: 'pi_s8', source_ci_id: 'ci_a', fee_type: 'deposit',
      lifecycle_status: 'paid', is_active: 0
    });
    assert.equal(r1.ok, true, 'paid 行 INSERT 必须成功');

    // 尝试插入相同 identity 的 active 行
    const r2 = await insertPayable({
      id: 's8_2', source_type: 'pi', source_id: 'pi_s8', source_ci_id: 'ci_a', fee_type: 'deposit',
      lifecycle_status: 'active', is_active: 1
    });
    assert.equal(r2.ok, false, 'paid 行存在时，相同 identity 的 active 行必须被拒绝');
  });

  // =========================================================================
  // S9: partially_paid + same-key active → rejected
  // =========================================================================
  test('S9: partially_paid + same-key active → rejected', { timeout: 60000 }, async () => {
    await resetPayableItems();
    await createNewIndex();

    const r1 = await insertPayable({
      id: 's9_1', source_type: 'pi', source_id: 'pi_s9', source_ci_id: 'ci_a', fee_type: 'deposit',
      lifecycle_status: 'partially_paid', is_active: 1
    });
    assert.equal(r1.ok, true, 'partially_paid 行 INSERT 必须成功');

    const r2 = await insertPayable({
      id: 's9_2', source_type: 'pi', source_id: 'pi_s9', source_ci_id: 'ci_a', fee_type: 'deposit',
      lifecycle_status: 'active', is_active: 1
    });
    assert.equal(r2.ok, false, 'partially_paid 行存在时，相同 identity 的 active 行必须被拒绝');
  });

  // =========================================================================
  // S10: reserved + same-key active → rejected
  // =========================================================================
  test('S10: reserved + same-key active → rejected', { timeout: 60000 }, async () => {
    await resetPayableItems();
    await createNewIndex();

    const r1 = await insertPayable({
      id: 's10_1', source_type: 'pi', source_id: 'pi_s10', source_ci_id: 'ci_a', fee_type: 'deposit',
      lifecycle_status: 'reserved', is_active: 1
    });
    assert.equal(r1.ok, true, 'reserved 行 INSERT 必须成功');

    const r2 = await insertPayable({
      id: 's10_2', source_type: 'pi', source_id: 'pi_s10', source_ci_id: 'ci_a', fee_type: 'deposit',
      lifecycle_status: 'active', is_active: 1
    });
    assert.equal(r2.ok, false, 'reserved 行存在时，相同 identity 的 active 行必须被拒绝');
  });

  // =========================================================================
  // S11: cancelled + same-key active → rejected
  // =========================================================================
  test('S11: cancelled + same-key active → rejected', { timeout: 60000 }, async () => {
    await resetPayableItems();
    await createNewIndex();

    const r1 = await insertPayable({
      id: 's11_1', source_type: 'pi', source_id: 'pi_s11', source_ci_id: 'ci_a', fee_type: 'deposit',
      lifecycle_status: 'cancelled', is_active: 0
    });
    assert.equal(r1.ok, true, 'cancelled 行 INSERT 必须成功');

    const r2 = await insertPayable({
      id: 's11_2', source_type: 'pi', source_id: 'pi_s11', source_ci_id: 'ci_a', fee_type: 'deposit',
      lifecycle_status: 'active', is_active: 1
    });
    assert.equal(r2.ok, false, 'cancelled 行存在时，相同 identity 的 active 行必须被拒绝');
  });

  // =========================================================================
  // S12: released + same-key active → rejected
  // =========================================================================
  test('S12: released + same-key active → rejected', { timeout: 60000 }, async () => {
    await resetPayableItems();
    await createNewIndex();

    const r1 = await insertPayable({
      id: 's12_1', source_type: 'pi', source_id: 'pi_s12', source_ci_id: 'ci_a', fee_type: 'deposit',
      lifecycle_status: 'released', is_active: 0
    });
    assert.equal(r1.ok, true, 'released 行 INSERT 必须成功');

    const r2 = await insertPayable({
      id: 's12_2', source_type: 'pi', source_id: 'pi_s12', source_ci_id: 'ci_a', fee_type: 'deposit',
      lifecycle_status: 'active', is_active: 1
    });
    assert.equal(r2.ok, false, 'released 行存在时，相同 identity 的 active 行必须被拒绝');
  });

  // =========================================================================
  // S13: 已收敛状态 → 重启 initDatabase 零 DDL
  // =========================================================================
  test('S13: 已收敛状态 → 重启 initDatabase 零 DDL（索引 oid / relfilenode 不变）', { timeout: 120000 }, async () => {
    await resetPayableItems();
    dbmod.initDatabase(); // 首次收敛
    const before = await q1("SELECT c.oid, c.relfilenode FROM pg_class c WHERE c.relname = 'uq_payable_identity'");
    assert.ok(before, '首次收敛后 uq_payable_identity 必须存在');

    dbmod.initDatabase(); // 再次启动：必须零 DDL（Render 每次 restart 都走这里）
    const after = await q1("SELECT c.oid, c.relfilenode FROM pg_class c WHERE c.relname = 'uq_payable_identity'");
    assert.ok(after, '再次启动后 uq_payable_identity 必须仍存在');
    assert.equal(String(after.oid), String(before.oid), '已收敛时不得重建索引（oid 必须不变）');
    assert.equal(String(after.relfilenode), String(before.relfilenode), '已收敛时不得重写索引（relfilenode 必须不变）');

    const idx = await getIndexInfo('uq_payable_identity');
    assert.equal(idx.indisvalid, true, '重启后仍必须 valid');
    assert.equal(idx.indisready, true, '重启后仍必须 ready');
    assert.equal(idx.indisunique, true, '重启后仍必须 unique');
  });

  // =========================================================================
  // S14: dual-index 期间旧索引仍阻塞「同 PI 多 CI」
  // =========================================================================
  test('S14: dual-index 期间旧索引仍阻塞「同 PI 多 CI」（旧索引未 DROP 前不得解冻）', { timeout: 120000 }, async () => {
    await resetPayableItems();
    await createOldIndex();
    await createNewIndex();

    // 同 PI + CI-A：两条索引都允许（首行）
    const r1 = await insertPayable({ id: 's14_1', source_type: 'pi', source_id: 'pi_s14', source_ci_id: 'ci_a', fee_type: 'balance' });
    assert.equal(r1.ok, true, 'CI-A 首行必须成功');

    // 同 PI + CI-B：新 business key 允许，但旧 3-field 索引仍阻塞 ⇒ 必须被拒绝
    const r2 = await insertPayable({ id: 's14_2', source_type: 'pi', source_id: 'pi_s14', source_ci_id: 'ci_b', fee_type: 'balance' });
    assert.equal(r2.ok, false, '旧索引 uq_payable_active 未 DROP 前，同 PI 多 CI 必须仍被阻塞');

    // DROP 旧索引（等价 Step 3 完成）后同 PI 多 CI 必须放行
    await admin.query('DROP INDEX IF EXISTS uq_payable_active');
    const r3 = await insertPayable({ id: 's14_3', source_type: 'pi', source_id: 'pi_s14', source_ci_id: 'ci_b', fee_type: 'balance' });
    assert.equal(r3.ok, true, '旧索引 DROP 后，同 PI 多 CI 必须放行（Wave 2A 解冻前置条件）');
  });
});
