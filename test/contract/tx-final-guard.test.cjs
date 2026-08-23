'use strict';
/*
 * tx-final-guard.test.cjs — Final Guard 长期零容忍 gate 测试
 *
 * 覆盖：
 *  - 合成矩阵（别名 / 未调用嵌套函数不钻入 / Sales Delete 窄例外 / fire-and-forget async callee /
 *    awaited async callee 合法 / withGenerateClient 真 async PG 事务不被标记）
 *  - zeroToleranceGate 自检（干净通过 / 任一指标 > 0 失败）
 *  - db.js 两道运行时 guard（AsyncFunction BEGIN-before 拒绝；thenable 不 COMMIT + 单次 ROLLBACK）
 *  - SQLite 驱动 thenable 回调合法（db-sqlite 支持，不抛 DB_SYNC_PROMISE_TX_UNSUPPORTED）
 *  - 真实 server.js/app.js：wrapper 保留（total=70）且全部零容忍干净（syncOk=70）
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const acorn = require('acorn');

const scanner = require('../../scripts/scan-tx-async.cjs');
const REPO = path.resolve(__dirname, '../..');
const DB_PATH = path.join(REPO, 'db.js');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'txfg-'));
function writeTemp(name, code) {
  const p = path.join(tmpDir, name);
  fs.writeFileSync(p, code);
  return p;
}

// 忠实提取 db.js 中 impl.transaction 的真实函数体（读取源码 + acorn，不依赖 PG worker）
function extractTransaction() {
  const src = fs.readFileSync(DB_PATH, 'utf8');
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script' });
  let implObj = null;
  (function find(node) {
    if (!node || typeof node.type !== 'string') return;
    if (
      (node.type === 'VariableDeclarator' && node.id && node.id.name === 'impl' && node.init && node.init.type === 'ObjectExpression') ||
      (node.type === 'AssignmentExpression' && node.left && node.left.name === 'impl' && node.right && node.right.type === 'ObjectExpression')
    ) {
      implObj = node.init || node.right;
      return;
    }
    for (const k of Object.keys(node)) {
      if (['loc', 'start', 'end', 'range', 'parent'].includes(k)) continue;
      const c = node[k];
      if (Array.isArray(c)) c.forEach((x) => x && x.type && find(x));
      else if (c && c.type) find(c);
    }
  })(ast);
  assert.ok(implObj, '应在 db.js 中找到 impl 对象');
  const prop = implObj.properties.find(
    (p) => (p.key.name === 'transaction' || p.key.value === 'transaction') && p.value.type === 'FunctionExpression'
  );
  assert.ok(prop, '应在 impl 中找到 transaction 函数');
  const fnText = src.slice(prop.value.start, prop.value.end);
  const makeTx = new Function('syncRequest', 'poisoned', 'return (' + fnText + ');');
  return makeTx;
}

// ---------- 合成矩阵：别名支持 ----------

test('FG-1: 别名 const tx = transaction; tx(async () => {}) 被识别为 async 违规', () => {
  const p = writeTemp('alias1.js', 'const transaction = (fn) => fn();\nconst tx = transaction;\ntx(async () => { await x(); });\n');
  const { summary, entries } = scanner.analyze([p]);
  assert.strictEqual(summary.total, 1, '别名调用应计入 transaction 总数');
  assert.strictEqual(summary.async, 1, 'async 回调应被识别');
  assert.strictEqual(entries[0].callbackType, 'async');
});

test('FG-2: 别名 const tx = db.transaction; tx(async () => {}) 被识别', () => {
  const p = writeTemp('alias2.js', "const db = { transaction: (fn) => fn() };\nconst tx = db.transaction;\ntx(async () => { await y(); });\n");
  const { summary } = scanner.analyze([p]);
  assert.strictEqual(summary.total, 1);
  assert.strictEqual(summary.async, 1);
});

test('FG-3: 别名 const tx = db["transaction"]; tx(async () => {}) 被识别', () => {
  const p = writeTemp('alias3.js', "const db = { transaction: (fn) => fn() };\nconst tx = db['transaction'];\ntx(async () => { await z(); });\n");
  const { summary } = scanner.analyze([p]);
  assert.strictEqual(summary.total, 1);
  assert.strictEqual(summary.async, 1);
});

// ---------- 合成矩阵：correction #2（不钻入未调用的嵌套函数） ----------

test('FG-4: 未被调用的嵌套函数内的 transit 不钻入 → 外层 indirectTransit/asyncCallee 不误报', () => {
  const p = writeTemp(
    'unused.js',
    `
function helper() {
  function unused() { updateInventoryTransitData(); }
  run();
}
function run() {}
function updateInventoryTransitData() {}
const transaction = (fn) => fn();
transaction(() => { helper(); });
`
  );
  const { summary, entries } = scanner.analyze([p]);
  assert.strictEqual(summary.total, 1, '只应统计到外层 1 个 transaction');
  const e = entries[0];
  assert.strictEqual(e.async, false);
  assert.strictEqual(e.indirectTransit, false, 'unused 内的 transit 未被钻入，外层不得误报 indirectTransit');
  assert.strictEqual(e.indirectNested, false);
  assert.strictEqual(e.asyncCallee, false);
});

// ---------- 合成矩阵：SQLite Sales Delete 窄例外 ----------

test('FG-5: SQLite Sales Delete 结构（runSalesDeletionInTx 内 sync cb return execSalesDeletionFlow）豁免 asyncCallee', () => {
  const p = writeTemp(
    'sales.js',
    `
function buildSqliteExec() { return {}; }
async function execSalesDeletionFlow(exec, req, ids, dialect) { return true; }
async function runSalesDeletionInTx(req, ids) {
  const transaction = (fn) => fn();
  transaction(() => {
    const exec = buildSqliteExec();
    return execSalesDeletionFlow(exec, req, ids, 'sqlite');
  });
}
`
  );
  const { summary, entries } = scanner.analyze([p]);
  assert.strictEqual(summary.total, 1);
  const e = entries[0];
  assert.strictEqual(e.async, false, 'cb 必须 sync');
  assert.strictEqual(e.asyncCallee, false, 'Sales Delete 结构必须豁免 asyncCallee');
  assert.strictEqual(e.indirectNested, false);
  assert.strictEqual(e.indirectTransit, false);
});

// ---------- 合成矩阵：asyncCallee（逃逸 vs 合法） ----------

test('FG-6: sync cb 内调用未被 await/return 的 async 函数 → asyncCallee 违规', () => {
  const p = writeTemp(
    'fire.js',
    `
async function fire() { return 1; }
function useIt() { fire(); }
const transaction = (fn) => fn();
transaction(() => { useIt(); });
`
  );
  const { summary, entries } = scanner.analyze([p]);
  assert.strictEqual(summary.total, 1);
  assert.strictEqual(summary.asyncCallee, 1, '逃逸的 async callee 必须被标记');
  assert.strictEqual(entries[0].asyncCallee, true);
});

test('FG-7: sync cb 内 await/return 的 async 函数 → 不报 asyncCallee', () => {
  const p = writeTemp(
    'awaited.js',
    `
async function fire() { return 1; }
function useIt() { return await fire(); }
const transaction = (fn) => fn();
transaction(() => { useIt(); });
`
  );
  const { summary } = scanner.analyze([p]);
  assert.strictEqual(summary.asyncCallee, 0, 'await 的 async callee 不应报违规');
});

// ---------- 合成矩阵：withGenerateClient 真 async PG 事务不被标记 ----------

test('FG-8: withGenerateClient 风格的真 async PG 事务（不用 transaction 符号）不被标记', () => {
  const p = writeTemp(
    'wgit.js',
    `
async function withGenerateClient(fn) {
  const client = { query: async () => ({ rows: [] }) };
  await client.query('BEGIN');
  try { await fn(client); await client.query('COMMIT'); }
  catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { /* release */ }
}
async function run() {
  await withGenerateClient(async (client) => {
    await client.query('INSERT INTO t VALUES (1)');
  });
}
`
  );
  const { summary } = scanner.analyze([p]);
  assert.strictEqual(summary.total, 0, 'withGenerateClient 不使用 transaction 符号，不应被统计');
  assert.strictEqual(summary.async, 0);
});

// ---------- zeroToleranceGate 自检 ----------

test('FG-9: zeroToleranceGate —— 干净输入通过；任一指标 > 0 则失败', () => {
  const clean = writeTemp('clean.js', "const transaction = (fn) => fn();\ntransaction(() => { doWork(); });\nfunction doWork() {}\n");
  const { summary: sClean } = scanner.analyze([clean]);
  assert.ok(scanner.zeroToleranceGate(sClean).passed, '干净代码应通过零容忍');

  const dirty = writeTemp('dirty.js', "const transaction = (fn) => fn();\ntransaction(async () => { await x(); });\n");
  const { summary: sDirty } = scanner.analyze([dirty]);
  const g = scanner.zeroToleranceGate(sDirty);
  assert.ok(!g.passed, '含 async 必须失败');
  assert.ok(g.failures.includes('async'), 'failures 必须包含 async');
});

// ---------- 运行时 guard（提取真实 db.js transaction 函数，mock syncRequest） ----------

test('FG-RT-1: db.js transaction 拒绝 async 回调（BEGIN 之前抛出，code=DB_SYNC_ASYNC_TX_UNSUPPORTED，不触达 syncRequest begin）', () => {
  const makeTx = extractTransaction();
  const calls = [];
  const syncRequest = (t) => { calls.push(t); return { ok: true }; };
  const transaction = makeTx(syncRequest, false);
  let err = null;
  try { transaction(async function () { return 1; }); } catch (e) { err = e; }
  assert.ok(err, 'async 回调必须被拒绝');
  assert.strictEqual(err.code, 'DB_SYNC_ASYNC_TX_UNSUPPORTED');
  assert.deepStrictEqual(calls, [], 'guard 必须在 syncRequest(begin) 之前抛出，begin 不得被调用');
});

test('FG-RT-2: sync 回调返回 Promise → 不 COMMIT + 单次 ROLLBACK（code=DB_SYNC_PROMISE_TX_UNSUPPORTED）', () => {
  const makeTx = extractTransaction();
  const calls = [];
  const syncRequest = (t) => { calls.push(t); return { ok: true }; };
  const transaction = makeTx(syncRequest, false);
  let err = null;
  try { transaction(function () { return Promise.resolve(42); }); } catch (e) { err = e; }
  assert.ok(err, 'thenable 回调必须被拒绝');
  assert.strictEqual(err.code, 'DB_SYNC_PROMISE_TX_UNSUPPORTED');
  assert.deepStrictEqual(calls, ['begin', 'rollback'], '必须 begin 后单次 rollback，不得 COMMIT（无双重 rollback）');
});

test('FG-RT-2b: 正常 sync 回调（返回非 Promise）仍正常 COMMIT 并返回结果', () => {
  const makeTx = extractTransaction();
  const calls = [];
  const syncRequest = (t) => { calls.push(t); return { ok: true }; };
  const transaction = makeTx(syncRequest, false);
  const r = transaction(function () { return 7; });
  assert.strictEqual(r, 7);
  assert.deepStrictEqual(calls, ['begin', 'commit']);
});

test('FG-RT-2c: 业务错误 → 单次 rollback（无双重 rollback）', () => {
  const makeTx = extractTransaction();
  const calls = [];
  const syncRequest = (t) => { calls.push(t); return { ok: true }; };
  const transaction = makeTx(syncRequest, false);
  let err = null;
  try { transaction(function () { throw new Error('biz'); }); } catch (e) { err = e; }
  assert.ok(err && err.message === 'biz');
  assert.deepStrictEqual(calls, ['begin', 'rollback']);
});

test('FG-RT-3: SQLite 驱动 thenable 回调合法（db-sqlite 支持 Promise，不抛 DB_SYNC_PROMISE_TX_UNSUPPORTED）', () => {
  const prev = process.env.DB_DRIVER;
  process.env.DB_DRIVER = 'sqlite';
  process.env.DB_PATH = ':memory:';
  delete process.env.DATABASE_URL;
  const dbFile = require.resolve(DB_PATH);
  delete require.cache[dbFile];
  const db = require(dbFile);
  let err = null;
  try { db.transaction(() => Promise.resolve(99)); } catch (e) { err = e; }
  assert.ok(!err, 'SQLite thenable 回调不应抛错: ' + (err && err.message));
  process.env.DB_DRIVER = prev;
});

// ---------- 真实代码：wrapper 保留 + 全部干净 ----------

test('FG-10: 真实 server.js/app.js —— wrapper 保留（total=70）且全部零容忍干净（syncOk=70）', () => {
  const { summary } = scanner.analyze(scanner.DEFAULT_FILES);
  assert.strictEqual(summary.total, 70, 'transaction wrapper 不得被删（迁移不变量）');
  assert.strictEqual(summary.syncOk, 70, '全部 70 个事务必须为零容忍干净');
  assert.strictEqual(summary.async, 0);
  assert.strictEqual(summary.asyncCallee, 0);
  assert.strictEqual(summary.nested, 0);
  assert.strictEqual(summary.indirectNested, 0);
  assert.strictEqual(summary.transit, 0);
  assert.strictEqual(summary.indirectTransit, 0);
});

test('FG-11: db.js（PG sync 桥）包含两道运行时 guard 的稳定错误码', () => {
  const src = fs.readFileSync(DB_PATH, 'utf8');
  assert.ok(/DB_SYNC_ASYNC_TX_UNSUPPORTED/.test(src), '必须存在 async guard 错误码');
  assert.ok(/DB_SYNC_PROMISE_TX_UNSUPPORTED/.test(src), '必须存在 thenable guard 错误码');
});

test('teardown: 清理临时扫描文件', () => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
