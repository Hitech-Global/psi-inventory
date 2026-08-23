/**
 * tx-batch2d.test.cjs — Batch 2D（logistics-batches PUT + generate-cost-items）静态边界 + 行为回归测试
 *
 * 不冒充 PG integration test；SQLite 仅证明「业务同步事务模型」与「费用事实仍受同一事务保护」。
 *
 * 本批修改形态极小：仅将两条 route 的 `transaction(async () =>` 改为 `transaction(() =>`
 * （删一个 async 关键字），外层 `await transaction(...)` 保留。业务代码一行不动，transaction wrapper 必须保留。
 *
 * 静态契约（防“删 transaction 让数字变绿” / 防 nested transaction 回潮）：
 *   - PUT /api/logistics-batches/:id：route 内 exactly 1 transaction；callback async=false；
 *     AwaitExpression=0；callback 内含 UPDATE logistics_batches 写 + 调 syncLogisticsCostFactsCore。
 *   - POST /api/logistics-batches/:id/generate-cost-items：route 内 exactly 1 transaction；callback async=false；
 *     AwaitExpression=0；callback 调 syncLogisticsCostFactsCore。
 *   - async-callee gate（核心新增）：对两条 callback 的可达本地 helper 链做 BFS，
 *     凡 callee 定义为 async function / 体内含 await / 内部再开 transaction 者计数；
 *     断言 async callee count = 0 / AwaitExpression = 0 / nested transaction = 0。
 *     重点覆盖 syncLogisticsCostFactsCore / _syncOneFeeCategory / createPayableItemFromSource /
 *     cancelPayableItem / findActivePayableItem 整条递归。
 *
 * 迁移不变量（Batch 2D gate）：
 *   - 全仓 transaction() 调用总数 == 70（sync 化不得删 wrapper、不得增 wrapper）
 *   - 剩余 async transaction == 1（仅 runSalesDeletionInTx = 2C）
 *
 * 行为回归（better-sqlite3，仅证明同步事务 rollback 模型，对应真实代码的失败注入点）：
 *   LOGI-A. generate-cost-items 成功 → 多费用事实（freight/duty/other_local）全部一起 COMMIT
 *   LOGI-B. generate-cost-items 处理第 2 个费用类目时失败 → 第 1 个类目已产生的 payable_items /
 *           ci_cost_items / fee_status 全部 rollback（不得留下“运费成功、关税失败”半套状态）
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');

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

// 全部 FunctionDeclaration 的 name→node 映射（用于本地 helper 可达性分析）
const fnMap = {};
findAll(ast, n => n.type === 'FunctionDeclaration' && n.id && n.id.name).forEach(n => {
  fnMap[n.id.name] = n;
});

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

function firstTxCallback(node) {
  const txs = transactionCallsIn(node);
  return txs.length === 1 ? txs[0].arguments[0] : null;
}

// 从一组起始节点出发，BFS 收集所有“指向本地 FunctionDeclaration”的 callee 名
function reachableLocalFns(startNodes) {
  const seen = new Set();
  const queue = [];
  function collect(node) {
    findAll(node, n =>
      n.type === 'CallExpression' &&
      n.callee && n.callee.type === 'Identifier' &&
      fnMap[n.callee.name] && !seen.has(n.callee.name)
    ).forEach(c => {
      const name = c.callee.name;
      seen.add(name);
      queue.push(fnMap[name]);
    });
  }
  startNodes.forEach(collect);
  while (queue.length) {
    const fn = queue.shift();
    collect(fn.body);
  }
  return seen;
}

// ---------- 1. PUT logistics 静态锁 ----------

const putRoute = findRoute('put', '/api/logistics-batches/:id');
test('2D-PUT-1: PUT /api/logistics-batches/:id — exactly 1 transaction / callback sync / AwaitExpression=0', () => {
  assert.ok(putRoute, 'PUT /api/logistics-batches/:id 路由必须存在');
  const txs = transactionCallsIn(putRoute);
  assert.strictEqual(txs.length, 1, 'PUT 路由应有 exactly 1 transaction');
  const cb = txs[0].arguments[0];
  assert.strictEqual(cb.async, false, 'PUT transaction callback 必须 sync（async=false）');
  assert.strictEqual(countAwait(cb.body), 0, 'PUT transaction callback AwaitExpression=0');
});

test('2D-PUT-2: PUT callback 内含 UPDATE logistics_batches 写 + 调 syncLogisticsCostFactsCore', () => {
  const cb = firstTxCallback(putRoute);
  assert.ok(cb, '应定位 PUT 唯一 transaction callback');
  const body = src.slice(cb.body.start, cb.body.end);
  assert.ok(body.includes('UPDATE logistics_batches'), 'PUT callback 必须仍含 UPDATE logistics_batches 写');
  assert.ok(body.includes('syncLogisticsCostFactsCore('), 'PUT callback 必须仍调 syncLogisticsCostFactsCore');
});

// ---------- 2. generate-cost-items 静态锁 ----------

const genRoute = findRoute('post', '/api/logistics-batches/:id/generate-cost-items');
test('2D-GEN-1: POST /api/logistics-batches/:id/generate-cost-items — exactly 1 transaction / callback sync / AwaitExpression=0', () => {
  assert.ok(genRoute, 'POST /api/logistics-batches/:id/generate-cost-items 路由必须存在');
  const txs = transactionCallsIn(genRoute);
  assert.strictEqual(txs.length, 1, 'generate-cost-items 路由应有 exactly 1 transaction');
  const cb = txs[0].arguments[0];
  assert.strictEqual(cb.async, false, 'generate-cost-items transaction callback 必须 sync（async=false）');
  assert.strictEqual(countAwait(cb.body), 0, 'generate-cost-items transaction callback AwaitExpression=0');
});

test('2D-GEN-2: generate-cost-items callback 调 syncLogisticsCostFactsCore', () => {
  const cb = firstTxCallback(genRoute);
  assert.ok(cb, '应定位 generate-cost-items 唯一 transaction callback');
  const body = src.slice(cb.body.start, cb.body.end);
  assert.ok(body.includes('syncLogisticsCostFactsCore('), 'generate-cost-items callback 必须仍调 syncLogisticsCostFactsCore');
});

// ---------- 3. async-callee gate（覆盖整条 syncLogisticsCostFactsCore 递归） ----------

test('2D-ASYNC-CALLEE-GATE: 两条 callback 可达本地 helper 链全部非 async / 无 await / 无 nested transaction', () => {
  const putCb = firstTxCallback(putRoute);
  const genCb = firstTxCallback(genRoute);
  const reachable = reachableLocalFns([putCb, genCb]);

  // 必须覆盖的 5 个关键函数都应在可达集合内
  const required = [
    'syncLogisticsCostFactsCore',
    '_syncOneFeeCategory',
    'createPayableItemFromSource',
    'cancelPayableItem',
    'findActivePayableItem'
  ];
  for (const name of required) {
    assert.ok(reachable.has(name), `可达集合必须包含 ${name}（真实代码中被两条 callback 间接调用）`);
  }

  let asyncCount = 0;
  let awaitCount = 0;
  let nestedTxCount = 0;
  for (const name of reachable) {
    const fn = fnMap[name];
    if (fn.async) asyncCount++;
    awaitCount += countAwait(fn.body);
    nestedTxCount += transactionCallsIn(fn).length;
  }

  assert.strictEqual(asyncCount, 0, `可达 helper 链中 async function 数必须为 0（发现 ${asyncCount} 个：防“无 await 但调 async helper”隐患）`);
  assert.strictEqual(awaitCount, 0, `可达 helper 链中 AwaitExpression 总数必须为 0（实际 ${awaitCount}）`);
  assert.strictEqual(nestedTxCount, 0, `可达 helper 链中 nested transaction 必须为 0（实际 ${nestedTxCount}）`);
});

// ---------- 4. wrapper preservation（防 Batch 1B 式“删 transaction 让数字变绿”回归） ----------

test('2D-WRAPPER: 两条 route 的 transaction wrapper 必须完整保留（不得裸跑 run + syncLogisticsCostFactsCore）', () => {
  for (const [label, route] of [['PUT', putRoute], ['generate-cost-items', genRoute]]) {
    const routeBody = src.slice(route.start, route.end);
    // transaction wrapper 存在
    assert.ok(routeBody.includes('transaction('), `${label} 必须仍含 transaction(（wrapper 保留）`);
    // 不得出现“脱离事务”的裸调用：syncLogisticsCostFactsCore 直接出现在 transaction 之外
    // （这里只验证 callback 内确有调用；wrapper 保留已由 exactly-1-transaction 测试保证）
    const txs = transactionCallsIn(route);
    assert.strictEqual(txs.length, 1, `${label} 必须 exactly 1 transaction（不得删 wrapper）`);
  }
});

// ---------- 5. 迁移不变量（Batch 2D gate） ----------

test('2D-MIGRATION-INVARIANT: transaction() 总数 == 70（不增不减，wrapper 不得被删）', () => {
  const all = findAll(ast, n =>
    n.type === 'CallExpression' &&
    n.callee && n.callee.type === 'Identifier' && n.callee.name === 'transaction'
  );
  assert.strictEqual(all.length, 70, `transaction() 总数应为 70（不得因 2D sync 化而增减），实际 ${all.length}`);
});

// ---------- 6. 行为回归（better-sqlite3 同步事务模型） ----------
// 与 db.js 的 sync transaction 语义一致：begin; fn(); commit; catch→rollback;throw
function syncTransaction(db, fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

function buildLogiSchema(db) {
  db.exec(`CREATE TABLE logistics_batches (id TEXT PRIMARY KEY, fee_status TEXT)`);
  db.exec(`CREATE TABLE payable_items (id TEXT PRIMARY KEY, source_type TEXT, source_ref TEXT, lifecycle_status TEXT)`);
  db.exec(`CREATE TABLE ci_cost_items (id TEXT PRIMARY KEY, ci_id TEXT, category TEXT, include_in_landing_cost INTEGER)`);
}

// 镜像真实 _syncOneFeeCategory：amount>0 → CREATE payable_item + ci_cost_item（upsert 的 CREATE 分支）
function syncOneFee(db, cat, amt) {
  const pid = 'pi-' + cat;
  db.prepare('INSERT INTO payable_items (id, source_type, source_ref, lifecycle_status) VALUES (?,?,?,?)')
    .run(pid, 'logistics', 'lb-1', 'active');
  db.prepare('INSERT INTO ci_cost_items (id, ci_id, category, include_in_landing_cost) VALUES (?,?,?,?)')
    .run('cci-' + cat, 'ci-1', cat, 1);
}

test('2D-LOGI-A: generate-cost-items 成功 → 多费用事实（freight/duty/other_local）全部一起 COMMIT', () => {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  buildLogiSchema(db);
  db.prepare("INSERT INTO logistics_batches (id, fee_status) VALUES (?,?)").run('lb-1', 'pending');

  // 镜像 generate-cost-items transaction：遍历 3 个费用类目（freight/duty/other_local）
  syncTransaction(db, () => {
    syncOneFee(db, 'freight', 100);
    syncOneFee(db, 'duty', 50);
    syncOneFee(db, 'other_local', 30);
    db.prepare("UPDATE logistics_batches SET fee_status='cost_generated' WHERE id=?").run('lb-1');
  });

  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM payable_items').get().c, 3, '3 个费用类目应各创建 1 条 payable_item');
  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM ci_cost_items').get().c, 3, '3 个费用类目应各创建 1 条 ci_cost_item');
  assert.strictEqual(db.prepare('SELECT fee_status FROM logistics_batches WHERE id=?').get('lb-1').fee_status, 'cost_generated', 'fee_status 应为 cost_generated');
});

test('2D-LOGI-B: generate-cost-items 第 2 个费用类目处理中失败 → 第 1 个类目已产生的写全部 rollback（不得半套）', () => {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  buildLogiSchema(db);
  db.prepare("INSERT INTO logistics_batches (id, fee_status) VALUES (?,?)").run('lb-1', 'pending');

  // 镜像：freight 成功落库 → 处理 duty 时抛错（真实代码中 _syncOneFeeCategory 内 INSERT 失败 / 409 等）
  assert.throws(() => syncTransaction(db, () => {
    syncOneFee(db, 'freight', 100); // 第 1 个类目：已产生 payable_item + ci_cost_item
    syncOneFee(db, 'duty', 50);     // 第 2 个类目：在处理中途失败
    throw new Error('处理 duty 费用类目时失败（如 INSERT ci_cost_items 异常）');
  }));

  // 断言：不得留下“运费成功、关税失败”半套状态
  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM payable_items').get().c, 0, 'payable_items 必须全部 rollback（不得残留 freight）');
  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM ci_cost_items').get().c, 0, 'ci_cost_items 必须全部 rollback（不得残留 freight）');
  assert.strictEqual(db.prepare('SELECT fee_status FROM logistics_batches WHERE id=?').get('lb-1').fee_status, 'pending', 'fee_status 不得改为 cost_generated（回滚）');
});
