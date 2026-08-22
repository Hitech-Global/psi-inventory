/**
 * tx-batch2a.test.cjs — Batch 2A（settlement / payment，11 条）静态边界 + 行为回归测试
 *
 * 不冒充 PG integration test；SQLite 仅证明「业务同步事务模型」与「关键财务事实仍受事务保护」。
 *
 * 静态契约（防“删 transaction 让数字变绿”回归）：
 *   - 11 条 transaction 回调已由 async 改为 sync（callback async=false，AwaitExpression=0）
 *   - 每条的关键财务写（payment_settlement_logs / payment_transactions / payment_allocations /
 *     payment_requests / payment_request_items / reservation·link / source status / ci_cost_items）
 *     仍位于 transaction 回调内，未被移出
 *   - 每条 enclosing scope 内 transaction 数量 == 1（未被删、未被误增）
 *
 * 迁移不变量（Batch 2A gate，可后续由 Final Guard 替换）：
 *   - 全仓 transaction() 调用总数 == 70（sync 化不得删 wrapper）
 *
 * 行为回归（better-sqlite3，仅证明同步事务 rollback 模型，对应真实代码的失败注入点）：
 *   A. payment settlement：写 settlement_log + transaction + allocation 后，allocation 校验失败
 *      → 前面所有财务写整体回滚
 *   B. deduction：写 deduction log + 更新 payment_requests 后，后续写失败 → 整体回滚
 *   C. multi-expense reservation：写 payment_request + payment_request_items + 预留 payable_item
 *      后，预留返回 false → throw → 整体回滚（payment_request / items / 预留均撤销）
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

// 返回 enclosing scope 节点（named fn 或 route handler），及其 source 范围
function enclosingScope(target) {
  if (target.type === 'fn') {
    const fn = findNamedFunction(target.name);
    if (!fn) throw new Error('named function not found: ' + target.name);
    return { node: fn, start: fn.start, end: fn.end };
  } else {
    const route = findRoute(target.method, target.route);
    if (!route) throw new Error('route not found: ' + target.route);
    // 以整个 route CallExpression 为 scope（handler 可能被中间件/wrapper 包裹，直接搜全节点更稳）
    return { node: route, start: route.start, end: route.end };
  }
}

// 在 scope 范围内找 transaction(async? )=> 调用（Batch 2A 后应为 sync）
function transactionCallsIn(scope) {
  return findAll(scope.node, n =>
    n.type === 'CallExpression' &&
    n.callee && n.callee.type === 'Identifier' && n.callee.name === 'transaction'
  );
}

// ---- 11 个 Batch 2A 目标定义 ----
const TARGETS = [
  { key: 'applyPaymentSettlement', type: 'fn', name: 'applyPaymentSettlement',
    keyWrites: ['payment_settlement_logs', 'payment_transactions', 'payment_allocations', 'recalculatePaymentSettlement'] },
  { key: 'applyDeductionSettlement', type: 'fn', name: 'applyDeductionSettlement',
    keyWrites: ['payment_settlement_logs', 'payment_requests', 'recalculatePaymentSettlement'] },
  { key: 'applyRoundingSettlement', type: 'fn', name: 'applyRoundingSettlement',
    keyWrites: ['payment_settlement_logs', 'payment_requests', 'recalculatePaymentSettlement'] },
  { key: 'reverseSettlementEvent', type: 'fn', name: 'reverseSettlementEvent',
    keyWrites: ['payment_settlement_logs', 'payment_transactions', 'recalculatePaymentSettlement'] },
  { key: 'from-pi-deposit', type: 'route', method: 'post', route: '/api/payment-requests/from-pi-deposit',
    keyWrites: ['payment_requests', 'linkSinglePayableItem', 'recordInitialDeduction', 'proforma_invoices'] },
  { key: 'from-ci-balance', type: 'route', method: 'post', route: '/api/payment-requests/from-ci-balance',
    keyWrites: ['payment_requests', 'payment_request_items', 'reservePayableItem', 'recordInitialDeduction', 'commercial_invoices'] },
  { key: 'multi-expense', type: 'route', method: 'post', route: '/api/payment-requests/multi-expense',
    keyWrites: ['payment_requests', 'payment_request_items', 'reservePayableItem', 'ci_cost_items', 'syncMultiSourcePiStatus'] },
  { key: 'batch-cancel', type: 'route', method: 'post', route: '/api/payment-requests/batch-cancel',
    keyWrites: ['payment_requests', 'releasePayableItem'] },
  { key: 'warehouse-arrival', type: 'route', method: 'post', route: '/api/payment-requests/warehouse-arrival',
    keyWrites: ['payment_requests', 'recordInitialDeduction', 'ci_cost_items'] },
  { key: 'customs-duty', type: 'route', method: 'post', route: '/api/payment-requests/customs-duty',
    keyWrites: ['payment_requests', 'recordInitialDeduction', 'ci_cost_items', 'commercial_invoices'] },
  { key: 'inspection-fee', type: 'route', method: 'post', route: '/api/payment-requests/inspection-fee',
    keyWrites: ['payment_requests', 'recordInitialDeduction', 'ci_cost_items'] },
];

// 解析每个 target 的 transaction 回调
const analyzed = TARGETS.map(t => {
  const scope = enclosingScope(t);
  const txs = transactionCallsIn(scope);
  const cb = txs.length === 1 ? txs[0].arguments[0] : null;
  const bodySrc = cb && cb.body ? src.slice(cb.body.start, cb.body.end) : '';
  return { ...t, scope, txCount: txs.length, arrow: cb, bodySrc,
    async: cb ? cb.async : null, awaitCount: cb ? countAwait(cb.body) : null };
});

// ---------- 静态契约 ----------
for (const a of analyzed) {
  test(`2A-STATIC[${a.key}]: 恰好 1 个 transaction，callback sync，AwaitExpression=0`, () => {
    assert.strictEqual(a.txCount, 1, `${a.key} 应有 exactly 1 transaction（不得删/误增）`);
    assert.strictEqual(a.async, false, `${a.key} callback 必须为 sync（async=false）`);
    assert.strictEqual(a.awaitCount, 0, `${a.key} callback 内 AwaitExpression 必须为 0`);
  });

  test(`2A-BOUNDARY[${a.key}]: 关键财务写仍位于 transaction 回调内`, () => {
    assert.ok(a.bodySrc, `${a.key} 无法提取 callback body`);
    for (const kw of a.keyWrites) {
      assert.ok(a.bodySrc.includes(kw), `${a.key} callback 必须仍包含关键财务写: ${kw}`);
    }
  });
}

// ---------- 迁移不变量（Batch 2A gate） ----------
test('2A-MIGRATION-INVARIANT: 全仓 transaction() 调用总数 == 70（sync 化不得删 wrapper）', () => {
  const all = findAll(ast, n =>
    n.type === 'CallExpression' &&
    n.callee && n.callee.type === 'Identifier' && n.callee.name === 'transaction'
  );
  assert.strictEqual(all.length, 70, `transaction() 总数应为 70，实际 ${all.length}`);
  // 11 条 Batch 2A 已全部 sync；剩余 async 不应落在 2A 范围
  const asyncTx = all.filter(n => n.arguments[0] && n.arguments[0].type === 'ArrowFunctionExpression' && n.arguments[0].async);
  assert.strictEqual(asyncTx.length, 9, `剩余 async transaction 应为 9（2B/2C/2D），实际 ${asyncTx.length}`);
  for (const a of analyzed) {
    assert.strictEqual(a.async, false, `2A target ${a.key} 仍被标记为 async`);
  }
});

// ---------- 行为回归（better-sqlite3 同步事务模型） ----------
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

test('2A-BEHAVIOR-A: payment settlement 中途 allocation 校验失败 → 全部财务写回滚', () => {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE payment_settlement_logs (
    id TEXT PRIMARY KEY, payment_request_id TEXT, event_type TEXT, amount REAL, status TEXT)`);
  db.exec(`CREATE TABLE payment_transactions (
    id TEXT PRIMARY KEY, payment_request_id TEXT, paid_amount_minor INTEGER)`);
  db.exec(`CREATE TABLE payment_allocations (
    id TEXT PRIMARY KEY, transaction_id TEXT, payment_request_item_id TEXT, allocated_amount_minor INTEGER)`);
  db.exec(`CREATE TABLE payment_request_items (
    id TEXT PRIMARY KEY, payment_request_id TEXT, payable_item_id TEXT)`);

  const prId = 'pr-1';
  // 模拟“写 payment log + transaction + allocation”序列，allocation 校验失败回滚
  assert.throws(() => {
    syncTransaction(db, () => {
      db.prepare('INSERT INTO payment_settlement_logs (id, payment_request_id, event_type, amount, status) VALUES (?,?,?,?,?)')
        .run('log-1', prId, 'payment', 100, 'applied');
      db.prepare('INSERT INTO payment_transactions (id, payment_request_id, paid_amount_minor) VALUES (?,?,?)')
        .run('txn-1', prId, 10000);
      // 真实代码 insertHumanAllocations：分配合计 != 实际付款 → throw（部分提交=BUG）
      const allocSum = 9999; // 与 10000 不符
      if (allocSum !== 10000) {
        throw new Error('分摊合计不等于实际付款金额（真实校验失败）');
      }
      db.prepare('INSERT INTO payment_allocations (id, transaction_id, payment_request_item_id, allocated_amount_minor) VALUES (?,?,?,?)')
        .run('alloc-1', 'txn-1', 'pri-1', 10000);
    });
  });

  // 断言：三部分财务写全部回滚，无部分提交
  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM payment_settlement_logs').get().c, 0, 'payment log 应回滚');
  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM payment_transactions').get().c, 0, 'payment transaction 应回滚');
  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM payment_allocations').get().c, 0, 'payment allocation 应回滚');
});

test('2A-BEHAVIOR-B: deduction 写 log + 更新 payment_requests 后失败 → 整体回滚', () => {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE payment_settlement_logs (
    id TEXT PRIMARY KEY, payment_request_id TEXT, event_type TEXT, amount REAL, status TEXT)`);
  db.exec(`CREATE TABLE payment_requests (id TEXT PRIMARY KEY, has_deduction INTEGER, deduction_amount REAL)`);

  const prId = 'pr-d';
  assert.throws(() => {
    syncTransaction(db, () => {
      db.prepare('INSERT INTO payment_settlement_logs (id, payment_request_id, event_type, amount, status) VALUES (?,?,?,?,?)')
        .run('dlog-1', prId, 'deduction', 50, 'applied');
      db.prepare('UPDATE payment_requests SET has_deduction=1, deduction_amount=? WHERE id=?')
        .run(50, prId);
      // 模拟后续 recalculatePaymentSettlement 或写入失败（真实代码此处无 Phase C，整段同一事务）
      throw new Error('deduction 后续写失败（真实场景：recalc/状态更新异常）');
    });
  });

  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM payment_settlement_logs').get().c, 0, 'deduction log 应回滚');
  // payment_requests 行本身未被创建（仅 UPDATE 不影响不存在的行）——重点验证 deduction log 不残留
  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM payment_settlement_logs WHERE event_type=?').get('deduction').c, 0, 'deduction log 不得残留');
});

test('2A-BEHAVIOR-C: multi-expense reservation 预留返回 false → throw → 整体回滚', () => {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE payment_requests (id TEXT PRIMARY KEY, payable_amount REAL)`);
  db.exec(`CREATE TABLE payment_request_items (id TEXT PRIMARY KEY, payment_request_id TEXT)`);
  db.exec(`CREATE TABLE payable_items (id TEXT PRIMARY KEY, reserved INTEGER DEFAULT 0)`);

  const prId = 'pr-m';
  // 已预留（reserved=1），模拟真实 multi-expense 中 reservePayableItem 返回 false 的失败场景
  db.prepare('INSERT INTO payable_items (id, reserved) VALUES (?,1)').run('pi-1');

  // 真实 multi-expense 顺序：INSERT payment_request → INSERT payment_request_items → reservePayableItem
  // reservePayableItem 返回 false（如已预留/金额不符）→ 真实代码 throw。
  function reservePayableItem(id) {
    const row = db.prepare('SELECT reserved FROM payable_items WHERE id=?').get(id);
    if (!row || row.reserved === 1) return false; // 真实语义：已预留则不可再预留
    db.prepare('UPDATE payable_items SET reserved=1 WHERE id=?').run(id);
    return true;
  }

  assert.throws(() => {
    syncTransaction(db, () => {
      db.prepare('INSERT INTO payment_requests (id, payable_amount) VALUES (?,?)').run(prId, 200);
      db.prepare('INSERT INTO payment_request_items (id, payment_request_id) VALUES (?,?)').run('pri-1', prId);
      const ok = reservePayableItem('pi-1');
      if (!ok) throw new Error('reservePayableItem 返回 false → 真实代码 throw（部分提交=BUG）');
    });
  });

  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM payment_requests').get().c, 0, 'payment_request 应回滚');
  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM payment_request_items').get().c, 0, 'payment_request_items 应回滚');
  // payable_item 的 reserved=1 为事务外前置状态（事务内 reservePayableItem 因已预留返回 false 而未执行 UPDATE），
  // 证明：预留失败 → throw → 事务内 payment_request / items 写入整体回滚，无部分提交。
  assert.strictEqual(db.prepare('SELECT reserved FROM payable_items WHERE id=?').get('pi-1').reserved, 1, 'payable_item 前置 reserved 状态未被事务内写破坏');
});
