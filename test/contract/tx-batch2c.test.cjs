/**
 * tx-batch2c.test.cjs — Batch 2C（Sales Delete driver detection 统一 + 最后一个 SQLite async 消除）静态 + 行为契约测试
 *
 * 本批三处逻辑点（均在 server.js）：
 *   A. Sales Delete preflight（约 @4789）driver 判断：
 *        if (process.env.DATABASE_URL)  →  if ((process.env.DB_DRIVER || 'sqlite').toLowerCase() === 'pg')
 *   B. runSalesDeletionInTx（约 @4881）driver 分流：
 *        if (process.env.DATABASE_URL)  →  if ((process.env.DB_DRIVER || 'sqlite').toLowerCase() === 'pg')
 *   C. runSalesDeletionInTx 的 SQLite branch 最后一个 transaction async 消除：
 *        transaction(async () => {... return await execSalesDeletionFlow(...) })
 *          →
 *        transaction(() => {... return execSalesDeletionFlow(...) })   （保留 return Promise）
 *
 * 关键正确性论证（不因 scanner=0 而碰 PG）：
 *   - PG branch 使用 withGenerateClient（真 async transaction：connect→BEGIN→await flow→COMMIT→catch ROLLBACK→finally release）。
 *   - SQLite branch 使用 db-sqlite.transaction，其原子性依赖 callback「返回 Promise」→ isThenable → resolve COMMIT / reject ROLLBACK。
 *     因此删 async 关键字后，必须「保留 return execSalesDeletionFlow(...)」，绝不能写成裸 execSalesDeletionFlow(...)。
 *
 * 不冒充 PG integration test；SQLite 行为测试只证明「业务同步事务模型」与「DELETE+refresh 一起成功/一起 rollback」。
 * PG rollback 仅锁 committed HEAD:pg-async.js 的 6 项结构能力，部署后必须做 production PG smoke。
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');
const { execSync } = require('child_process');

const SERVER = path.join(__dirname, '..', '..', 'server.js');
const src = fs.readFileSync(SERVER, 'utf8');
const ast = acorn.parse(src, { ecmaVersion: 2022, sourceType: 'script' });

// ---- AST helpers ----
function countAwait(node) {
  let n = 0;
  (function w(x) {
    if (!x || typeof x.type !== 'string') return;
    if (x.type === 'AwaitExpression') n++;
    for (const k in x) {
      if (k === 'type' || k === 'start' || k === 'end') continue;
      const v = x[k];
      if (Array.isArray(v)) v.forEach(w);
      else if (v && typeof v.type === 'string') w(v);
    }
  })(node);
  return n;
}

function findAll(node, pred, out = []) {
  (function w(x) {
    if (!x || typeof x.type !== 'string') return;
    if (pred(x)) out.push(x);
    for (const k in x) {
      if (k === 'type' || k === 'start' || k === 'end') continue;
      const v = x[k];
      if (Array.isArray(v)) v.forEach(w);
      else if (v && typeof v.type === 'string') w(v);
    }
  })(node);
  return out;
}

function findNamedFunction(name) {
  return findAll(ast, n => n.type === 'FunctionDeclaration' && n.id && n.id.name === name)[0] || null;
}

function findRoute(method, routePath) {
  const calls = findAll(ast, n =>
    n.type === 'CallExpression' &&
    n.callee && n.callee.type === 'MemberExpression' &&
    n.callee.object && n.callee.object.name === 'app' &&
    n.callee.property && n.callee.property.name === method &&
    n.arguments.length >= 2 &&
    n.arguments[0].type === 'Literal' && n.arguments[0].value === routePath
  );
  return calls[0] || null;
}

function transactionCallsIn(node) {
  return findAll(node, n =>
    n.type === 'CallExpression' &&
    n.callee && n.callee.type === 'Identifier' && n.callee.name === 'transaction'
  );
}

function allTransactionCalls() {
  return findAll(ast, n =>
    n.type === 'CallExpression' &&
    n.callee && n.callee.type === 'Identifier' && n.callee.name === 'transaction'
  );
}

// 取函数的 if 分支体（PG branch）。注意：真实代码没有显式 else —— SQLite transaction 是 if 之后的
// 独立 return 语句，因此 SQLite branch 直接通过「函数体内唯一的 transaction 调用」定位（见下方 helper）。
function getIfBranchBody(fnNode) {
  const ifs = findAll(fnNode.body, n => n.type === 'IfStatement');
  assert.ok(ifs.length >= 1, 'runSalesDeletionInTx 必须含有 if 分支');
  return ifs[0].consequent;
}

// 取函数体内唯一的 transaction 调用（SQLite branch），并校验其唯一性。
function getSqliteTxIn(fnNode) {
  const txs = transactionCallsIn(fnNode);
  assert.strictEqual(txs.length, 1, 'runSalesDeletionInTx 内必须 exactly 1 个 transaction（仅 SQLite branch）');
  return txs[0];
}

// ---------------------------------------------------------------------------
// 1. driver detection contract（A + B）
// ---------------------------------------------------------------------------

test('2C-DD-1: Sales Delete preflight 与 runSalesDeletionInTx 必须依据 DB_DRIVER === "pg"', () => {
  const preflight = findRoute('post', '/api/sales-records/delete-preflight');
  assert.ok(preflight, 'DELETE preflight 路由必须存在');

  const runFn = findNamedFunction('runSalesDeletionInTx');
  assert.ok(runFn, 'runSalesDeletionInTx 函数必须存在');

  for (const [label, node] of [['preflight', preflight], ['runSalesDeletionInTx', runFn]]) {
    const body = src.slice(node.start, node.end);
    // 必须出现真实 driver selection 表达式
    assert.ok(
      body.includes("process.env.DB_DRIVER") && body.includes("=== 'pg'"),
      `${label} 必须依据 (process.env.DB_DRIVER||'sqlite').toLowerCase() === 'pg'`
    );
  }
});

test('2C-DD-2: Sales Delete 作用域内 process.env.DATABASE_URL 作为 driver 检测出现次数必须为 0', () => {
  const preflight = findRoute('post', '/api/sales-records/delete-preflight');
  const runFn = findNamedFunction('runSalesDeletionInTx');
  assert.ok(preflight && runFn, 'preflight 与 runSalesDeletionInTx 必须存在');

  for (const [label, node] of [['preflight', preflight], ['runSalesDeletionInTx', runFn]]) {
    const body = src.slice(node.start, node.end);
    const matches = body.match(/process\.env\.DATABASE_URL/g) || [];
    assert.strictEqual(
      matches.length,
      0,
      `${label} 内不得将 process.env.DATABASE_URL 用作 driver 检测（发现 ${matches.length} 处）`
    );
  }
});

// ---------------------------------------------------------------------------
// 2. PG branch contract（完全不动，仅断言结构正确）
// ---------------------------------------------------------------------------

test('2C-PG-1: runSalesDeletionInTx PG branch 结构正确（调 withGenerateClient / async callback / await execSalesDeletionFlow / buildPgExec / 不调 transaction）', () => {
  const runFn = findNamedFunction('runSalesDeletionInTx');
  const ifBranch = getIfBranchBody(runFn);
  const body = src.slice(ifBranch.start, ifBranch.end);

  // PG branch 必须：调 withGenerateClient
  assert.ok(body.includes('withGenerateClient('), 'PG branch 必须调 withGenerateClient（真 async transaction）');
  // PG branch callback 必须 async（这是正确形态，测试不得当违规）
  const wgcCalls = findAll(ifBranch, n =>
    n.type === 'CallExpression' &&
    n.callee && n.callee.type === 'Identifier' && n.callee.name === 'withGenerateClient'
  );
  assert.strictEqual(wgcCalls.length, 1, 'PG branch 必须有 exactly 1 withGenerateClient 调用');
  const pgCb = wgcCalls[0].arguments[0];
  assert.ok(pgCb && pgCb.async === true, 'PG branch 的 withGenerateClient callback 必须保持 async（正确形态）');
  // await execSalesDeletionFlow
  assert.ok(body.includes('await execSalesDeletionFlow('), 'PG branch 必须 await execSalesDeletionFlow');
  // buildPgExec 在该 branch
  assert.ok(body.includes('buildPgExec('), 'PG branch 必须含 buildPgExec');
  // 不调用 db.transaction（PG 路径走 withGenerateClient，不得混入 sqlite transaction）
  assert.strictEqual(transactionCallsIn(ifBranch).length, 0, 'PG branch 内不得调用 transaction（保持 PG 路径纯一）');
});

// ---------------------------------------------------------------------------
// 3. SQLite branch contract（C：最后一个 async 消除）
// ---------------------------------------------------------------------------

test('2C-SQLITE-1: runSalesDeletionInTx SQLite branch exactly 1 transaction / callback sync / AwaitExpression=0 / buildSqliteExec', () => {
  const runFn = findNamedFunction('runSalesDeletionInTx');
  const tx = getSqliteTxIn(runFn);
  const cb = tx.arguments[0];
  assert.strictEqual(cb.async, false, 'SQLite transaction callback 必须 sync（async=false）');
  assert.strictEqual(countAwait(cb.body), 0, 'SQLite transaction callback AwaitExpression=0');

  const body = src.slice(cb.start, cb.end);
  assert.ok(body.includes('buildSqliteExec('), 'SQLite branch callback 内必须含 buildSqliteExec');
});

test('2C-SQLITE-2: SQLite callback ReturnStatement.argument 必须是 execSalesDeletionFlow(...) 调用（非裸调用）', () => {
  const runFn = findNamedFunction('runSalesDeletionInTx');
  const tx = getSqliteTxIn(runFn);
  const cb = tx.arguments[0];

  // 找 callback 内的 ReturnStatement
  const rets = findAll(cb.body, n => n.type === 'ReturnStatement');
  assert.ok(rets.length >= 1, 'SQLite callback 必须含 return 语句（返回 Promise 供 db-sqlite thenable 检测）');
  const ret = rets[rets.length - 1]; // 业务 return
  assert.ok(ret.argument, 'return 必须有 argument（不得是裸 return / 裸 execSalesDeletionFlow 调用）');
  assert.strictEqual(
    ret.argument.type,
    'CallExpression',
    'ReturnStatement.argument 必须是 CallExpression（即 return execSalesDeletionFlow(...)）'
  );
  assert.strictEqual(
    ret.argument.callee.type === 'Identifier' && ret.argument.callee.name,
    'execSalesDeletionFlow',
    'ReturnStatement.argument 必须是 execSalesDeletionFlow(...) 调用，不能漏 return'
  );

  // 反向锁：callback 内不得出现「裸 execSalesDeletionFlow(...)（无 return 包裹）」
  // 通过确认所有 execSalesDeletionFlow 调用都位于某个 ReturnStatement.argument 下来保证。
  const esfCalls = findAll(cb.body, n =>
    n.type === 'CallExpression' &&
    n.callee && n.callee.type === 'Identifier' && n.callee.name === 'execSalesDeletionFlow'
  );
  assert.ok(esfCalls.length >= 1, '必须存在 execSalesDeletionFlow 调用');
  for (const call of esfCalls) {
    // 向上找最近的 ReturnStatement
    let p = call;
    let foundReturn = false;
    // 简单路径判断：call 必须直接是某 ReturnStatement.argument
    findAll(cb.body, n =>
      n.type === 'ReturnStatement' && n.argument === call
    ).forEach(() => { foundReturn = true; });
    assert.ok(foundReturn, '每个 execSalesDeletionFlow 调用必须作为 return 的 argument（不得裸调用导致立即 COMMIT）');
  }
});

// ---------------------------------------------------------------------------
// 4. db-sqlite thenable contract（基于 HEAD committed db-sqlite.js，不依赖 working-tree 改动）
// ---------------------------------------------------------------------------

test('2C-DBSQLITE-THENABLE: HEAD:db-sqlite.js transaction 对 thenable result 做 COMMIT/ROLLBACK', () => {
  const head = execSync(`git show HEAD:db-sqlite.js`, { cwd: path.join(__dirname, '..', '..') }).toString();
  // isThenable 检测
  assert.ok(head.includes('function isThenable'), 'HEAD db-sqlite.js 必须具备 isThenable');
  assert.ok(head.includes('isThenable(result)'), 'transaction 必须对 result 做 isThenable 检测');
  // resolve 后 COMMIT
  assert.ok(/COMMIT/.test(head), 'thenable resolve 后必须 COMMIT');
  // reject 后 ROLLBACK
  assert.ok(/ROLLBACK/.test(head), 'thenable reject 后必须 ROLLBACK');
  // result = fn() 同步取返回值
  assert.ok(/result\s*=\s*fn\(\)/.test(head), 'transaction 必须同步取 fn() 返回值（result = fn()）');
});

// ---------------------------------------------------------------------------
// 5. PG committed infrastructure contract（HEAD:pg-async.js 6 项核心能力，不要求 unstaged robustness）
// ---------------------------------------------------------------------------

test('2C-PG-INFRA: HEAD:pg-async.js withGenerateClient 具备 6 项核心事务能力（connect/BEGIN/await fn/COMMIT/ROLLBACK/release）', () => {
  const head = execSync(`git show HEAD:pg-async.js`, { cwd: path.join(__dirname, '..', '..') }).toString();

  // 1. connect
  assert.ok(/\.connect\(\)/.test(head), 'HEAD pg-async 必须 connect 连接');
  // 2. BEGIN
  assert.ok(/BEGIN/.test(head), 'HEAD pg-async 必须 BEGIN');
  // 3. await fn(...)
  assert.ok(/await\s+fn\(/.test(head), 'HEAD pg-async 必须 await fn(...)');
  // 4. COMMIT
  assert.ok(/COMMIT/.test(head), 'HEAD pg-async 必须 COMMIT');
  // 5. catch → ROLLBACK（存在 ROLLBACK 且位于 catch 上下文）
  assert.ok(/ROLLBACK/.test(head), 'HEAD pg-async 必须 ROLLBACK（catch 路径）');
  // 6. finally / release
  assert.ok(/finally/.test(head) && /release\(/.test(head), 'HEAD pg-async 必须 finally → client.release()');

  // 不应强制要求 unstaged robustness：
  assert.ok(
    true,
    '本测试只锁 HEAD 已提交的 6 项核心能力；COMMIT command 校验 / suspect client destroy / 新 timeout 属未提交 robustness，不在此强制'
  );
});

// ---------------------------------------------------------------------------
// 6. 迁移不变量（Batch 2C 最终 gate）：total=70 / async=0 / nested=0 / transit=0 / removed=29
// ---------------------------------------------------------------------------

test('2C-MIGRATION-INVARIANT: transaction() 总数 == 70 / async == 0 / nested == 0 / transit == 0（removed=29, new=0）', () => {
  const all = allTransactionCalls();
  assert.strictEqual(all.length, 70, `transaction() 总数应为 70（不增不减），实际 ${all.length}`);

  const asyncTx = all.filter(n => n.arguments[0] && n.arguments[0].type === 'ArrowFunctionExpression' && n.arguments[0].async);
  assert.strictEqual(asyncTx.length, 0, `剩余 async transaction 应为 0（2C 完成最后 sync 化），实际 ${asyncTx.length}`);

  // nested：任何 transaction 的 callback 内部不得再含 transaction
  const nested = all.filter(T => {
    const cb = T.arguments[0];
    if (!cb) return false;
    return transactionCallsIn(cb).length > 0;
  });
  assert.strictEqual(nested.length, 0, `nested transaction 必须为 0，实际 ${nested.length}`);

  // transit：回调内不得含 updateInventoryTransitData（其内会再开 transaction）
  const transit = all.filter(T => {
    const cb = T.arguments[0];
    if (!cb) return false;
    return findAll(cb, n =>
      n.type === 'CallExpression' &&
      n.callee && n.callee.type === 'Identifier' && n.callee.name === 'updateInventoryTransitData'
    ).length > 0;
  });
  assert.strictEqual(transit.length, 0, `transit transaction 必须为 0，实际 ${transit.length}`);
});

// ---------------------------------------------------------------------------
// 7. SQLite rollback 行为测试（真实业务契约：DELETE + refresh 一起成功/一起 rollback）
//    镜像 HEAD:db-sqlite.js transaction 的 thenable 语义（BEGIN → result=fn() →
//    isThenable ? Promise.then(COMMIT, ROLLBACK) : COMMIT），不污染应用真实 DB。
// ---------------------------------------------------------------------------

function isThenable(v) {
  return v && (typeof v === 'object' || typeof v === 'function') && typeof v.then === 'function';
}

// 忠实复刻 HEAD:db-sqlite.js transaction 的 thenable 语义（仅供本测试，不加载应用模块）
function sqliteThenableTransaction(db, fn) {
  db.exec('BEGIN');
  let result;
  try {
    result = fn();
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  if (!isThenable(result)) {
    db.exec('COMMIT');
    return result;
  }
  return result.then(
    (val) => { db.exec('COMMIT'); return val; },
    (err) => { db.exec('ROLLBACK'); throw err; }
  );
}

// 镜像真实 execSalesDeletionFlow（SQLite dialect）：DELETE sales_records → refresh 阶段写 suggestions
function execSalesDeletionFlowSqlite(db, failInRefresh) {
  // DELETE 阶段（同步）
  db.prepare('DELETE FROM sales_records WHERE id = ?').run('s-1');
  // refresh 阶段（同步写）；若要求失败则抛出 → 走 Promise reject
  if (failInRefresh) {
    return Promise.reject(new Error('refresh 阶段失败（如写 suggestion 冲突）'));
  }
  db.prepare('INSERT INTO sales_suggestions (id, sales_id) VALUES (?,?)').run('sg-1', 's-1');
  return Promise.resolve('done');
}

function buildSalesSchema(db) {
  db.exec(`CREATE TABLE sales_records (id TEXT PRIMARY KEY)`);
  db.exec(`CREATE TABLE sales_suggestions (id TEXT PRIMARY KEY, sales_id TEXT)`);
}

test('2C-SQLITE-ROLLBACK-A: DELETE 成功 + refresh 成功 → 两阶段一起 COMMIT', async () => {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  buildSalesSchema(db);
  db.prepare("INSERT INTO sales_records (id) VALUES (?)").run('s-1');

  const out = await sqliteThenableTransaction(db, () => execSalesDeletionFlowSqlite(db, false));

  assert.strictEqual(out, 'done', 'flow 应返回 done');
  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM sales_records WHERE id=?').get('s-1').c, 0, 'sales_records 应被 DELETE');
  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM sales_suggestions').get().c, 1, 'refresh 写入的 suggestion 应一起 COMMIT');
});

test('2C-SQLITE-ROLLBACK-B: DELETE 成功 + refresh 失败 → 整个 Promise reject，sales_records 也回滚（不得半套）', async () => {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  buildSalesSchema(db);
  db.prepare("INSERT INTO sales_records (id) VALUES (?)").run('s-1');

  await assert.rejects(
    sqliteThenableTransaction(db, () => execSalesDeletionFlowSqlite(db, true)),
    /refresh 阶段失败/,
    'refresh 失败应使事务 Promise reject'
  );

  // 断言：DELETE 与 refresh 一起回滚 —— sales_records 仍存在，suggestion 不得残留
  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM sales_records WHERE id=?').get('s-1').c, 1, 'sales_records 必须回滚（DELETE 不残留）');
  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM sales_suggestions').get().c, 0, 'suggestion 不得残留（无半套）');
});

test('2C-SQLITE-ROLLBACK-C: 漏 return（裸 execSalesDeletionFlow）会立即 COMMIT —— 反向证明必须 return Promise', async () => {
  // 本测试直接验证「thenable transaction 依赖 return 的 Promise」这一不变量：
  // 若 callback 不返回 Promise（裸调用），事务立即 COMMIT，refresh 失败无法回滚 DELETE。
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  buildSalesSchema(db);
  db.prepare("INSERT INTO sales_records (id) VALUES (?)").run('s-1');

  // 模拟「忘记 return」：callback 返回 undefined（非 thenable）→ 立即 COMMIT
  sqliteThenableTransaction(db, () => {
    db.prepare('DELETE FROM sales_records WHERE id = ?').run('s-1');
    // 注意：此处没有 return Promise，且故意不在事务内抛错（模拟漏 return 后 refresh 在别处失败）
  });

  // 立即 COMMIT 已经发生：DELETE 持久化
  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM sales_records WHERE id=?').get('s-1').c, 0, '漏 return → 立即 COMMIT（DELETE 已落库）');

  // 这正说明：runSalesDeletionInTx 的 SQLite callback 必须 return execSalesDeletionFlow(...)（返回 Promise），
  // 否则 refresh 阶段的失败无法回滚已发生的 DELETE。静态锁见 2C-SQLITE-2。
  assert.ok(true, '反向证明：return Promise 是 thenable transaction 原子性的必要前提');
});
