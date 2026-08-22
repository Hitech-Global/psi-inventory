'use strict';
/*
 * tx-contract.test.cjs — Batch 0A 事务契约测试
 *
 * ⚠️ 语义区分（报告要求，务必准确）：
 *   A. SQLite-backed contract test —— 本文件用 DB_DRIVER=sqlite + :memory: 验证
 *      transaction API 的「通用原子性测试模型」（BEGIN / COMMIT / ROLLBACK 行为）。
 *      它证明测试框架与 transaction API 的预期语义正确，但**不等于**生产 PG 底座已验证。
 *   B. PG sync-worker production contract —— db.js → worker_threads → db-sync-worker.js →
 *      PostgreSQL 这一套实现的原子性，目前靠「代码审计 + 本扫描器静态契约」确认；
 *      真正的 PG integration regression 需可用 PostgreSQL 环境后单独执行。
 *   故：本文件 7+ 项测试全部 pass ≠ 「生产 PG 事务底座已验证通过」。
 *
 * 本批（Batch 0A）不修改 db.js / server.js / 任何 endpoint，只落地护栏+测试。
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const { execFileSync } = require('child_process');

const scanner = require('../../scripts/scan-tx-async.cjs');
const REPO = path.resolve(__dirname, '../..');
const BASELINE_PATH = scanner.BASELINE_PATH;

// ---------- A/B：SQLite-backed transaction 原子性 harness ----------
function setupSqlite() {
  process.env.DB_DRIVER = 'sqlite';
  process.env.DB_PATH = ':memory:';
  delete process.env.POOLER_DATABASE_URL;
  delete process.env.DATABASE_URL;
  const db = require(path.resolve(REPO, 'db.js'));
  db.run('DROP TABLE IF EXISTS tx_demo');
  db.run('CREATE TABLE tx_demo (id INTEGER PRIMARY KEY, v TEXT)');
  return db;
}

test('A. SQLite: sync transaction callback commits all writes atomically', () => {
  const db = setupSqlite();
  db.transaction(() => {
    db.run("INSERT INTO tx_demo (id,v) VALUES (1,'a')");
    db.run("INSERT INTO tx_demo (id,v) VALUES (2,'b')");
  });
  const rows = db.query('SELECT * FROM tx_demo ORDER BY id').rows;
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].v, 'a');
  assert.strictEqual(rows[1].v, 'b');
});

test('B. SQLite: sync transaction callback rolls back on throw (no residue)', () => {
  const db = setupSqlite();
  assert.throws(() => {
    db.transaction(() => {
      db.run("INSERT INTO tx_demo (id,v) VALUES (1,'a')");
      throw new Error('boom');
    });
  }, /boom/);
  const rows = db.query('SELECT * FROM tx_demo').rows;
  assert.strictEqual(rows.length, 0, 'rollback 必须不留残留');
});

// ---------- C/D：静态扫描识别现有违规 ----------
test('C. static scan identifies existing transaction(async) callbacks', () => {
  const { summary } = scanner.analyze(scanner.DEFAULT_FILES);
  assert.strictEqual(summary.async, 29, '当前 server.js 有 29 个 async transaction 回调');
});

test('D. static scan identifies nested-transit (transaction containing updateInventoryTransitData)', () => {
  const { summary } = scanner.analyze(scanner.DEFAULT_FILES);
  // 9 个 transit：refreshInventoryTotals@4080 + PO/CI/CI-reverse/PI-batch/CI-batch/inbound/inbound-batch/historical CI
  assert.strictEqual(summary.transit, 9, '9 个 nested-transit 违规');
  // 1 个直接嵌套事务（PI batch 8623 内嵌 8627）
  assert.strictEqual(summary.nested, 1, '1 个直接嵌套事务');
  assert.strictEqual(summary.total, 71, 'AST 真实 transaction 调用总数 = 71（与 raw grep 一致）');
});

// ---------- E：baseline 集合比较（set-based，非数量比较） ----------
function mk(file, scope, fp, opts = {}) {
  const callbackType = opts.async ? 'async' : 'sync';
  const characteristic = [callbackType, opts.nested ? 'nested' : '', opts.transit ? 'transit' : '']
    .filter(Boolean)
    .join('+');
  return {
    file,
    scope,
    fingerprint: fp,
    key: `${file}::${scope}::${fp}`,
    callbackType,
    nested: !!opts.nested,
    transit: !!opts.transit,
    characteristic,
  };
}

test('E1. baseline == current => OK（无新增违规）', () => {
  const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8')).violations;
  const cur = baseline.map((v) => ({
    file: v.file,
    scope: v.scope,
    fingerprint: v.fingerprint,
    key: scanner.stableKey(v),
    callbackType: v.callbackType,
    nested: v.nested,
    transit: v.transit,
  }));
  const res = scanner.compare(cur, baseline);
  assert.strictEqual(res.newViolations.length, 0);
});

test('E2. 同作用域删掉 1 个 async（其余 4 个重排）=> removed=1, new=0（ordinal 漂移不误报）', () => {
  const file = 'server.js';
  const scope = 'POST /api/x';
  const all5 = [0, 1, 2, 3, 4].map((i) => mk(file, scope, 'fp' + i, { async: true }));
  const afterRemoveFirst = [1, 2, 3, 4].map((i) => mk(file, scope, 'fp' + i, { async: true }));
  const res = scanner.compare(afterRemoveFirst, all5);
  assert.strictEqual(res.removedViolations.length, 1, '被删的那 1 个应记为 removed');
  assert.strictEqual(res.newViolations.length, 0, '剩余 4 个因 fingerprint 稳定，不应误报为新增');
});

test('E3. 删旧违规 A + 同作用域新增真正不同的违规 B => FAIL（new 必须被抓到）', () => {
  const file = 'server.js';
  const scope = 'POST /api/x';
  const baseline = [mk(file, scope, 'fpA', { async: true })];
  const current = [mk(file, scope, 'fpB', { async: true })]; // A 消失、B 新增（源码不同）
  const res = scanner.compare(current, baseline);
  assert.strictEqual(res.newViolations.length, 1, '即便 ordinal 重排，新违规必须被识别');
});

test('E4. 编辑既有 async 回调正文（fingerprint 变）但仍是 async => 仍 FAIL（不会漏报）', () => {
  const file = 'server.js';
  const scope = 'POST /api/x';
  const baseline = [mk(file, scope, 'fpOld', { async: true })];
  const current = [mk(file, scope, 'fpNew', { async: true })]; // 同一站点、正文被改、依旧 async
  const res = scanner.compare(current, baseline);
  assert.strictEqual(res.newViolations.length, 1, '改了正文的 async 站点须被当作新增违规拦截');
});

// ---------- F：身份与运行时 guard 边界 ----------
test('F1. stable identity 与特征无关：async->sync 修复被识别为 removed 而非 new', () => {
  const file = 'server.js';
  const scope = 'POST /api/x';
  const baseline = [mk(file, scope, 'fpZ', { async: true })];
  const current = []; // 同站点（同 fp）修复为 sync 且去 transit => 不再属 violations
  const res = scanner.compare(current, baseline);
  assert.strictEqual(res.removedViolations.length, 1);
  assert.strictEqual(res.newViolations.length, 0, '修复不应误报为新增违规');
});

test('F2. 本批（Batch 0A）不向 db.js 注入运行时 guard', () => {
  const dbSrc = fs.readFileSync(path.resolve(REPO, 'db.js'), 'utf8');
  assert.ok(!/DB_SYNC_ASYNC_TX_UNSUPPORTED/.test(dbSrc), '运行时 guard 本轮不得出现');
});

// ---------- 冻结基线回归测试（用户要求 A-E）----------
const baselineRaw = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
const baselineViolations = baselineRaw.violations;

function fromBaseline(arr) {
  return arr.map((v) => ({
    file: v.file,
    scope: v.scope,
    fingerprint: v.fingerprint,
    key: scanner.stableKey(v),
    callbackType: v.callbackType,
    nested: v.nested,
    transit: v.transit,
  }));
}

test('Frozen-A. current == baseline => 无新增违规（PASS）', () => {
  const cur = fromBaseline(baselineViolations);
  const res = scanner.compare(cur, baselineViolations);
  assert.strictEqual(res.newViolations.length, 0);
});

test('Frozen-B. current 是 baseline 严格子集 => 无新增违规（PASS）', () => {
  const cur = fromBaseline(baselineViolations.slice(3)); // 移除 3 个旧违规
  const res = scanner.compare(cur, baselineViolations);
  assert.strictEqual(res.newViolations.length, 0, '子集不得误报为新增');
  assert.strictEqual(res.removedViolations.length, 3);
});

test('Frozen-C. 删除一个特定旧违规 => 无新增违规（PASS）', () => {
  const cur = fromBaseline(baselineViolations.slice(1)); // 删掉第 1 个
  const res = scanner.compare(cur, baselineViolations);
  assert.strictEqual(res.newViolations.length, 0);
  assert.strictEqual(res.removedViolations.length, 1);
});

test('Frozen-D. 删旧 A + 同处新增真正不同的违规 B => 抓到新增（FAIL）', () => {
  const withoutA = baselineViolations.slice(1);
  const cur = fromBaseline(withoutA).concat([mk('server.js', 'POST /api/x', 'brand-new-fp-D')]);
  const res = scanner.compare(cur, baselineViolations);
  assert.strictEqual(res.newViolations.length, 1, '新增违规必须被拦截');
});

test('Frozen-E. 普通 --check 不改写冻结基线文件', () => {
  const before = fs.readFileSync(BASELINE_PATH, 'utf8');
  const beforeHash = crypto.createHash('sha256').update(before).digest('hex');
  execFileSync('node', [path.join(REPO, 'scripts', 'scan-tx-async.cjs'), '--check'], { cwd: REPO });
  const after = fs.readFileSync(BASELINE_PATH, 'utf8');
  const afterHash = crypto.createHash('sha256').update(after).digest('hex');
  assert.strictEqual(afterHash, beforeHash, '--check 不得改写冻结基线文件');
});

// ---------- MemberExpression 检测（用户要求 二）----------
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'txscan-'));
function writeTemp(name, code) {
  const p = path.join(tmpDir, name);
  fs.writeFileSync(p, code);
  return p;
}

test('Member-A. db.transaction(async () => {}) 被识别为 async 违规', () => {
  const p = writeTemp('m1.js', 'db.transaction(async () => { await x(); });\n');
  const { summary, entries } = scanner.analyze([p]);
  assert.strictEqual(summary.total, 1, '成员调用应被计入 transaction 总数');
  assert.strictEqual(summary.async, 1, 'async 回调应被识别');
  assert.strictEqual(entries[0].callbackType, 'async');
});

test('Member-B. obj.transaction(async () => {}) 被识别为 async 违规', () => {
  const p = writeTemp('m2.js', 'obj.transaction(async () => { await y(); });\n');
  const { summary } = scanner.analyze([p]);
  assert.strictEqual(summary.total, 1);
  assert.strictEqual(summary.async, 1);
});

test('Member-C. 计算成员 db["transaction"](async () => {}) 也被识别', () => {
  const p = writeTemp('m3.js', 'db["transaction"](async () => { await z(); });\n');
  const { summary } = scanner.analyze([p]);
  assert.strictEqual(summary.total, 1);
  assert.strictEqual(summary.async, 1);
});

test('Member-D. 裸 transaction(async () => {}) 仍被识别（回归保护）', () => {
  const p = writeTemp('m4.js', 'transaction(async () => { await w(); });\n');
  const { summary } = scanner.analyze([p]);
  assert.strictEqual(summary.total, 1);
  assert.strictEqual(summary.async, 1);
});

test('Member-E. 别名调用 const tx = transaction; tx(async () => {}) 不被识别（已知边界，P0 不扩展）', () => {
  const p = writeTemp('m5.js', 'const tx = transaction;\ntx(async () => { await v(); });\n');
  const { summary } = scanner.analyze([p]);
  assert.strictEqual(summary.total, 0, '别名调用(data-flow)不在 P0 纯 AST 覆盖范围内');
});

test('teardown: 清理临时扫描文件', () => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
