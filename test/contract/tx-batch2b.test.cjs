/**
 * tx-batch2b.test.cjs — Batch 2B（approval ×6 + settleFinalPaymentApproval P0 原子性）静态边界 + 行为回归测试
 *
 * 不冒充 PG integration test；SQLite 仅证明「业务同步事务模型」与「关键财务事实仍受同一事务保护」。
 *
 * 静态契约（防“删 transaction 让数字变绿” / 防 nested transaction 回潮）：
 *   - 6 条 approval transaction 回调已由 async 改为 sync（async=false，AwaitExpression=0），
 *     且 6 个 wrapper 一个不少（createApprovalInstance 1 + approve 路由 5）
 *   - applyPaymentSettlementInTx：non-async / AwaitExpression=0 / transaction()=0
 *   - settleFinalPaymentApprovalInTx：non-async / AwaitExpression=0 / transaction()=0 / 调 applyPaymentSettlementInTx / 不调 applyPaymentSettlement
 *   - applyPaymentSettlement wrapper：exactly 1 transaction / callback 调 applyPaymentSettlementInTx
 *   - final approve（#2）合并事务：exactly 1 顶层 transaction / callback sync / AwaitExpression=0 /
 *     审批写 approval_records+payment_requests approved 在内 / actual_paid_amount 分支内调 settleFinalPaymentApprovalInTx /
 *     不得调 settleFinalPaymentApproval / 不得调 applyPaymentSettlement wrapper
 *   - 全仓旧函数名 settleFinalPaymentApproval(（非 InTx）production live call = 0
 *   - confirm-paid / bulk-import-result 仍走 applyPaymentSettlement wrapper（regression）
 *
 * 迁移不变量（Batch 2B gate）：
 *   - 全仓 transaction() 调用总数 == 70（sync 化不得删 wrapper、core 抽取不得增 wrapper）
 *   - 剩余 async transaction == 1（仅 runSalesDeletionInTx = 2C）
 *
 * 行为回归（better-sqlite3，仅证明同步事务 rollback 模型，对应真实代码的失败注入点）：
 *   P0-A. final approve + actual_paid_amount 成功 → 审批 approved + 付款 settlement 全部一起 COMMIT
 *   P0-B. final approve + actual_paid_amount 中 settlement 失败 → approval + settlement 全部 rollback（审批不得单独成功）
 *   P0-C. final approve + actual_paid_amount == null → 仅审批成功，不创建任何 settlement
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

// ---------- 1. core / wrapper 防 nested 静态门禁 ----------

test('2B-CORE: applyPaymentSettlementInTx — non-async / AwaitExpression=0 / transaction()=0', () => {
  const fn = findNamedFunction('applyPaymentSettlementInTx');
  assert.ok(fn, 'applyPaymentSettlementInTx 必须存在');
  assert.strictEqual(fn.async, false, 'core 必须为 non-async');
  assert.strictEqual(countAwait(fn.body), 0, 'core 内 AwaitExpression 必须为 0');
  assert.strictEqual(transactionCallsIn(fn).length, 0, 'core 内不得调用 transaction()（否则 nested）');
});

test('2B-CORE: settleFinalPaymentApprovalInTx — non-async / AwaitExpression=0 / transaction()=0 / 调 InTx core / 不调 wrapper', () => {
  const fn = findNamedFunction('settleFinalPaymentApprovalInTx');
  assert.ok(fn, 'settleFinalPaymentApprovalInTx 必须存在');
  assert.strictEqual(fn.async, false, 'InTx 必须为 non-async');
  assert.strictEqual(countAwait(fn.body), 0, 'InTx 内 AwaitExpression 必须为 0');
  assert.strictEqual(transactionCallsIn(fn).length, 0, 'InTx 内不得调用 transaction()（否则 nested）');
  const body = src.slice(fn.body.start, fn.body.end);
  assert.ok(body.includes('applyPaymentSettlementInTx('), 'InTx 必须调 applyPaymentSettlementInTx');
  assert.ok(!body.includes('applyPaymentSettlement('), 'InTx 不得调 applyPaymentSettlement wrapper');
  assert.ok(body.includes('attachment'), 'InTx 必须仍更新 attachment');
});

test('2B-WRAPPER: applyPaymentSettlement — exactly 1 transaction / callback 调 InTx core', () => {
  const fn = findNamedFunction('applyPaymentSettlement');
  assert.ok(fn, 'applyPaymentSettlement wrapper 必须存在');
  const txs = transactionCallsIn(fn);
  assert.strictEqual(txs.length, 1, 'wrapper 必须 exactly 1 transaction');
  const cb = txs[0].arguments[0];
  const body = src.slice(cb.body.start, cb.body.end);
  assert.ok(body.includes('applyPaymentSettlementInTx('), 'wrapper 的 transaction 回调必须调 applyPaymentSettlementInTx');
});

// ---------- 2. 6 条 approval transaction 全部同步化且 wrapper 保留 ----------

const createApprovalInstanceFn = findNamedFunction('createApprovalInstance');
test('2B-APPROVAL-1: createApprovalInstance — exactly 1 transaction / sync / AwaitExpression=0 / 核心写在内', () => {
  assert.ok(createApprovalInstanceFn, 'createApprovalInstance 必须存在');
  const txs = transactionCallsIn(createApprovalInstanceFn);
  assert.strictEqual(txs.length, 1, 'createApprovalInstance 必须有 exactly 1 transaction');
  const cb = txs[0].arguments[0];
  assert.strictEqual(cb.async, false, 'callback 必须 sync');
  assert.strictEqual(countAwait(cb.body), 0, 'callback AwaitExpression=0');
  const body = src.slice(cb.body.start, cb.body.end);
  assert.ok(body.includes('approval_records'), '必须仍写 approval_records');
  assert.ok(body.includes('business_participants'), '必须仍写 business_participants');
  assert.ok(body.includes('approval_status = ?'), '必须仍更新 payment_requests.approval_status');
  assert.ok(body.includes("'pending'"), 'payment_requests.approval_status 必须置 pending');
});

const approveRoute = findRoute('post', '/api/payment-requests/:id/approve');
test('2B-APPROVAL-2: approve 路由 — 5 条审批 transaction / 全部 sync / AwaitExpression=0', () => {
  assert.ok(approveRoute, 'approve 路由必须存在');
  const txs = transactionCallsIn(approveRoute);
  assert.strictEqual(txs.length, 5, 'approve 路由应有 exactly 5 条 transaction（final/intermediate/reject/legacy-approve/legacy-reject）');
  for (const tx of txs) {
    const cb = tx.arguments[0];
    assert.strictEqual(cb.async, false, '每条审批 transaction callback 必须 sync');
    assert.strictEqual(countAwait(cb.body), 0, '每条审批 transaction callback AwaitExpression=0');
  }
});

// 在 5 条中定位 final-approve #2（带 settleFinalPaymentApprovalInTx）
const txsInApprove = transactionCallsIn(approveRoute);
const finalApprovedCb = txsInApprove
  .map(tx => tx.arguments[0])
  .find(cb => {
    const body = src.slice(cb.body.start, cb.body.end);
    return body.includes('settleFinalPaymentApprovalInTx(');
  });

test('2B-APPROVAL-3: final approve #2 — 合并事务契约（审批+付款同一事务，无 nested）', () => {
  assert.ok(finalApprovedCb, '必须能定位 final-approve 合并事务（含 settleFinalPaymentApprovalInTx 调用）');
  const body = src.slice(finalApprovedCb.body.start, finalApprovedCb.body.end);
  // 审批核心写仍在内
  assert.ok(body.includes("approval_records SET status") && body.includes("'approved'"), 'approval_records 必须置 approved（事务内）');
  assert.ok(body.includes("payment_requests SET approval_status") && body.includes("'approved'"), 'payment_requests.approval_status 必须置 approved（事务内）');
  // actual_paid_amount 分支内调 InTx core
  assert.ok(body.includes('actual_paid_amount != null'), '必须存在 actual_paid_amount 分支判断');
  const idxBranch = body.indexOf('actual_paid_amount != null');
  const idxInTx = body.indexOf('settleFinalPaymentApprovalInTx(');
  assert.ok(idxBranch >= 0 && idxInTx > idxBranch, 'settleFinalPaymentApprovalInTx 必须位于 actual_paid_amount 分支内');
  assert.ok(body.includes('queryOne('), '付款分支内必须重查 approvedPayment（消状态漂移）');
  // 防 nested / 防误调 wrapper
  assert.ok(!body.includes('settleFinalPaymentApproval('), 'final-approve 不得调旧的 settleFinalPaymentApproval（会再开事务）');
  assert.ok(!body.includes('applyPaymentSettlement('), 'final-approve 不得调 applyPaymentSettlement wrapper');
  // callback 本身 sync
  assert.strictEqual(finalApprovedCb.async, false, 'final-approve callback 必须 sync');
  assert.strictEqual(countAwait(finalApprovedCb.body), 0, 'final-approve callback AwaitExpression=0');
});

// ---------- 3. 全仓旧名 / 调用方审计 ----------

test('2B-GLOBAL: 旧函数名 settleFinalPaymentApproval(（非 InTx）production live call = 0', () => {
  const oldCalls = findAll(ast, n =>
    n.type === 'CallExpression' &&
    n.callee && n.callee.type === 'Identifier' && n.callee.name === 'settleFinalPaymentApproval'
  );
  assert.strictEqual(oldCalls.length, 0, '不得存在旧 settleFinalPaymentApproval(...) 调用（已全部改为 InTx）');

  const inTxCalls = findAll(ast, n =>
    n.type === 'CallExpression' &&
    n.callee && n.callee.type === 'Identifier' && n.callee.name === 'settleFinalPaymentApprovalInTx'
  );
  assert.strictEqual(inTxCalls.length, 1, 'settleFinalPaymentApprovalInTx 应只有 1 个 production caller（final-approve）');
});

// ---------- 4. confirm-paid / bulk 回归锁（不得因合并事务丢失独立 transaction） ----------

test('2B-REGRESSION: confirm-paid 分支仍走 applyPaymentSettlement wrapper（不丢失事务）', () => {
  assert.ok(approveRoute, 'approve 路由必须存在');
  const routeBody = src.slice(approveRoute.start, approveRoute.end);
  assert.ok(routeBody.includes("action === 'confirm-paid'"), 'approve 路由应仍含 confirm-paid 分支');
  assert.ok(routeBody.includes('applyPaymentSettlement('), 'confirm-paid 分支仍须调用 applyPaymentSettlement wrapper');
  assert.ok(!routeBody.includes('applyPaymentSettlementInTx('), 'confirm-paid 不得直接调 InTx（应经 wrapper 保事务）');
});

const bulkRoute = findRoute('post', '/api/payment-requests/bulk-import-result');
test('2B-REGRESSION: bulk-import-result 仍走 applyPaymentSettlement wrapper（不丢失事务）', () => {
  assert.ok(bulkRoute, 'bulk-import-result 路由必须存在');
  const routeBody = src.slice(bulkRoute.start, bulkRoute.end);
  assert.ok(routeBody.includes('applyPaymentSettlement('), 'bulk 仍须调用 applyPaymentSettlement wrapper');
  assert.ok(!routeBody.includes('applyPaymentSettlementInTx('), 'bulk 不得直接调 InTx（应经 wrapper 保事务）');
});

// ---------- 5. 迁移不变量（Batch 2B gate） ----------

test('2B-MIGRATION-INVARIANT: transaction() 总数 == 70 / async == 1（不增不减）', () => {
  const all = findAll(ast, n =>
    n.type === 'CallExpression' &&
    n.callee && n.callee.type === 'Identifier' && n.callee.name === 'transaction'
  );
  assert.strictEqual(all.length, 70, `transaction() 总数应为 70（不得因 core 抽取而增减），实际 ${all.length}`);
  const asyncTx = all.filter(n => n.arguments[0] && n.arguments[0].type === 'ArrowFunctionExpression' && n.arguments[0].async);
  // 全局 async 数快照：Batch 2C 已完成最后一处（runSalesDeletionInTx SQLite branch）sync 化，
  // 故最终值应为 0。本测试只锁「总量不增不减」，async 终值由 tx-batch2c + scanner 负责。
  assert.strictEqual(asyncTx.length, 0, `剩余 async transaction 应为 0（2C 已完成最后 sync 化），实际 ${asyncTx.length}`);
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

function buildSchema(db) {
  db.exec(`CREATE TABLE approval_records (id TEXT PRIMARY KEY, business_id TEXT, status TEXT)`);
  db.exec(`CREATE TABLE payment_requests (id TEXT PRIMARY KEY, approval_status TEXT, payable_amount REAL, payment_status TEXT)`);
  db.exec(`CREATE TABLE payment_settlement_logs (id TEXT PRIMARY KEY, payment_request_id TEXT, event_type TEXT, amount REAL, status TEXT)`);
  db.exec(`CREATE TABLE payment_transactions (id TEXT PRIMARY KEY, payment_request_id TEXT, paid_amount_minor INTEGER)`);
  db.exec(`CREATE TABLE payment_allocations (id TEXT PRIMARY KEY, transaction_id TEXT, payment_request_item_id TEXT, allocated_amount_minor INTEGER)`);
  db.exec(`CREATE TABLE payment_request_items (id TEXT PRIMARY KEY, payment_request_id TEXT, payable_item_id TEXT)`);
  db.exec(`CREATE TABLE payable_items (id TEXT PRIMARY KEY, payable_amount_minor INTEGER, status TEXT)`);
}

test('2B-P0-A: final approve + actual_paid_amount 成功 → 审批 approved + 付款 settlement 一起 COMMIT', () => {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  buildSchema(db);
  const approvalId = 'appr-1', prId = 'pr-1', piId = 'pi-1';
  db.prepare('INSERT INTO approval_records (id, business_id, status) VALUES (?,?,?)').run(approvalId, prId, 'pending');
  db.prepare('INSERT INTO payment_requests (id, approval_status, payable_amount, payment_status) VALUES (?,?,?,?)').run(prId, 'pending', 100, 'unpaid');
  db.prepare('INSERT INTO payable_items (id, payable_amount_minor, status) VALUES (?,?,?)').run(piId, 10000, 'reserved');

  // 镜像真实 final-approve #2 + settleFinalPaymentApprovalInTx 的合并事务
  syncTransaction(db, () => {
    db.prepare("UPDATE approval_records SET status='approved' WHERE id=?").run(approvalId);
    db.prepare("UPDATE payment_requests SET approval_status='approved' WHERE id=?").run(prId);
    // actual_paid_amount != null 分支：settlement
    db.prepare("INSERT INTO payment_settlement_logs (id, payment_request_id, event_type, amount, status) VALUES (?,?,?,?,?)")
      .run('log-1', prId, 'payment', 100, 'applied');
    db.prepare("INSERT INTO payment_transactions (id, payment_request_id, paid_amount_minor) VALUES (?,?,?)")
      .run('txn-1', prId, 10000);
    db.prepare("INSERT INTO payment_allocations (id, transaction_id, payment_request_item_id, allocated_amount_minor) VALUES (?,?,?,?)")
      .run('alloc-1', 'txn-1', 'pri-1', 10000);
    db.prepare("UPDATE payable_items SET status='paid' WHERE id=?").run(piId);
  });

  assert.strictEqual(db.prepare('SELECT status FROM approval_records WHERE id=?').get(approvalId).status, 'approved', 'approval_records 应为 approved');
  assert.strictEqual(db.prepare('SELECT approval_status FROM payment_requests WHERE id=?').get(prId).approval_status, 'approved', 'payment_requests 应为 approved');
  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM payment_settlement_logs').get().c, 1, 'settlement_log 应创建');
  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM payment_transactions').get().c, 1, 'payment_transaction 应创建');
  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM payment_allocations').get().c, 1, 'payment_allocation 应创建');
  assert.strictEqual(db.prepare('SELECT status FROM payable_items WHERE id=?').get(piId).status, 'paid', 'payable_item 应为 paid');
});

test('2B-P0-B: final approve + actual_paid_amount 中 settlement 失败 → approval + settlement 全部 rollback（审批不得单独成功）', () => {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  buildSchema(db);
  const approvalId = 'appr-1', prId = 'pr-1', piId = 'pi-1';
  db.prepare('INSERT INTO approval_records (id, business_id, status) VALUES (?,?,?)').run(approvalId, prId, 'pending');
  db.prepare('INSERT INTO payment_requests (id, approval_status, payable_amount, payment_status) VALUES (?,?,?,?)').run(prId, 'pending', 100, 'unpaid');
  db.prepare('INSERT INTO payable_items (id, payable_amount_minor, status) VALUES (?,?,?)').run(piId, 10000, 'reserved');

  assert.throws(() => syncTransaction(db, () => {
    db.prepare("UPDATE approval_records SET status='approved' WHERE id=?").run(approvalId);
    db.prepare("UPDATE payment_requests SET approval_status='approved' WHERE id=?").run(prId);
    // settlement 中段（INSERT payment_transactions 之前/之时）失败
    db.prepare("INSERT INTO payment_settlement_logs (id, payment_request_id, event_type, amount, status) VALUES (?,?,?,?,?)")
      .run('log-1', prId, 'payment', 100, 'applied');
    throw new Error('settlement 中段失败（如 INSERT payment_transactions 异常）');
  }));

  // 断言：审批不得单独成功
  assert.strictEqual(db.prepare('SELECT status FROM approval_records WHERE id=?').get(approvalId).status, 'pending', 'approval_records 仍应为 pending（不得单独成功）');
  assert.strictEqual(db.prepare('SELECT approval_status FROM payment_requests WHERE id=?').get(prId).approval_status, 'pending', 'payment_requests 仍应为 pending（不得单独成功）');
  // 断言：settlement 不留半套数据
  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM payment_settlement_logs').get().c, 0, 'settlement_log 不得残留');
  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM payment_transactions').get().c, 0, 'payment_transaction 不得残留');
  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM payment_allocations').get().c, 0, 'payment_allocation 不得残留');
  assert.strictEqual(db.prepare('SELECT status FROM payable_items WHERE id=?').get(piId).status, 'reserved', 'payable_item 不得被错误修改');
});

test('2B-P0-C: final approve + actual_paid_amount == null → 仅审批成功，不创建任何 settlement', () => {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  buildSchema(db);
  const approvalId = 'appr-1', prId = 'pr-1', piId = 'pi-1';
  db.prepare('INSERT INTO approval_records (id, business_id, status) VALUES (?,?,?)').run(approvalId, prId, 'pending');
  db.prepare('INSERT INTO payment_requests (id, approval_status, payable_amount, payment_status) VALUES (?,?,?,?)').run(prId, 'pending', 100, 'unpaid');
  db.prepare('INSERT INTO payable_items (id, payable_amount_minor, status) VALUES (?,?,?)').run(piId, 10000, 'reserved');

  // 镜像：actual_paid_amount == null 分支（仅审批，不付款）
  syncTransaction(db, () => {
    db.prepare("UPDATE approval_records SET status='approved' WHERE id=?").run(approvalId);
    db.prepare("UPDATE payment_requests SET approval_status='approved' WHERE id=?").run(prId);
  });

  assert.strictEqual(db.prepare('SELECT status FROM approval_records WHERE id=?').get(approvalId).status, 'approved', 'approval_records 应为 approved');
  assert.strictEqual(db.prepare('SELECT approval_status FROM payment_requests WHERE id=?').get(prId).approval_status, 'approved', 'payment_requests 应为 approved');
  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM payment_settlement_logs').get().c, 0, 'settlement_log 不得创建');
  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM payment_transactions').get().c, 0, 'payment_transaction 不得创建');
  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM payment_allocations').get().c, 0, 'payment_allocation 不得创建');
  assert.strictEqual(db.prepare('SELECT status FROM payable_items WHERE id=?').get(piId).status, 'reserved', 'payable_item 不得被改变');
});
