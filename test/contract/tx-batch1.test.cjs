/**
 * tx-batch1.test.cjs — Batch 1（1A + 1B）合约测试（SQLite + node:test，不冒充 PG integration test）
 *
 * 验证范围（Batch 1 共 7 个 endpoint，分 1A/1B 两子批）：
 *   1A: POST /api/commercial-invoices
 *   1A: POST /api/commercial-invoices/:id/reverse
 *   1A: POST /api/purchase-orders
 *   1A: POST /api/inbound-records
 *   1B: POST /api/proforma-invoices/batch-import      (PI batch — 删 outer，保留每行顶层 transaction)
 *   1B: POST /api/commercial-invoices/batch-import     (CI batch — 单事务 sync 化)
 *   1B: POST /api/inbound-records/batch-import         (inbound batch — 单事务 sync 化)
 *
 * 静态契约：
 *   - 这 7 个 transaction 回调已从 async 改为 sync
 *   - 这 7 个 transaction 回调内不再直接调用 updateInventoryTransitData（transit 已移 Phase C）
 *   - 全仓 (async && hasTransit) 的 transaction 数量已由 9 降为 0（1A 消除 4、1B 消除 3、1C 消除 2）
 *   - 1C 两个目标（refreshInventoryTotals + createHistoricalCI）均已将 transit 移出 transaction 回调
 *   - createHistoricalCI 因 recalculatePaymentSettlement 返回 Promise 被阻塞，方案 A 已先将
 *     整条 settlement helper 链（recalculatePaymentSettlement / paymentSettlementFacts /
 *     syncPaymentSource / aggregatePiDepositSettlement / aggregateSourceSettlement）同步化，
 *     解除阻塞，HCI 现完整 sync + Phase C。
 *
 * 事务边界模式（better-sqlite3，仅证明 Phase B/Phase C 分离语义，不等同 PG worker 验证）：
 *   - Phase B 主事实 COMMIT 后，Phase C transit 抛错不影响已提交主事实
 *   - Phase B 内部失败时主事实整体 ROLLBACK
 *   - 单事务内多行 per-row try/catch 吞错（CI batch 风格）
 *   - 每行独立顶层事务 + 单行失败后 Phase C（PI batch 风格）
 *
 * 注意：SQLite 不能证明 PostgreSQL worker 路径下
 *   "[DB-WORKER] COMMIT 时 txClient 为 null" 已消失；
 *   该项仅由静态结构证明 + PostgreSQL 生产 smoke 覆盖。
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');
const { execFileSync } = require('child_process');

const REPO = process.cwd();
const SERVER = path.resolve(REPO, 'server.js');
const SCANNER = path.resolve(REPO, 'scripts/scan-tx-async.cjs');

function parseTransactions() {
  const src = fs.readFileSync(SERVER, 'utf8');
  const ast = acorn.parse(src, { ecmaVersion: 2022, sourceType: 'script' });
  const out = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'CallExpression') {
      const callee = node.callee;
      const isTx =
        (callee.type === 'Identifier' && callee.name === 'transaction') ||
        (callee.type === 'MemberExpression' && !callee.computed && callee.property.name === 'transaction');
      if (isTx) {
        const cb = node.arguments && node.arguments[0];
        const cbAsync = !!(cb && (cb.type === 'ArrowFunctionExpression' || cb.type === 'FunctionExpression') && cb.async);
        let hasTransit = false;
        const scan = (n) => {
          if (!n || typeof n !== 'object') return;
          if (n.type === 'CallExpression') {
            const c = n.callee;
            if (c.type === 'Identifier' && c.name === 'updateInventoryTransitData') hasTransit = true;
          }
          for (const k of Object.keys(n)) {
            if (n[k] && typeof n[k] === 'object') scan(n[k]);
          }
        };
        if (cb) scan(cb);
        out.push({ async: cbAsync, hasTransit });
      }
    }
    for (const k of Object.keys(node)) {
      if (node[k] && typeof node[k] === 'object') walk(node[k]);
    }
  };
  walk(ast);
  return out;
}

function scannerCheck() {
  const out = execFileSync('node', [SCANNER, '--check'], { encoding: 'utf8' });
  const m = out.match(/total=(\d+) async=(\d+) asyncCallee=(\d+) nested=(\d+) indirectNested=(\d+) transit=(\d+) indirectTransit=(\d+)/);
  return {
    raw: out,
    total: m ? Number(m[1]) : null,
    async: m ? Number(m[2]) : null,
    asyncCallee: m ? Number(m[3]) : null,
    nested: m ? Number(m[4]) : null,
    indirectNested: m ? Number(m[5]) : null,
    transit: m ? Number(m[6]) : null,
    indirectTransit: m ? Number(m[7]) : null,
    ok: /OK: 全部 transaction 反模式指标为 0/.test(out),
  };
}

test('1A-SCANNER: 零容忍 gate 通过（6 指标全 0）且 wrapper 保留（total=70）', () => {
  const r = scannerCheck();
  assert.ok(r.ok, 'scanner --check 必须 OK（零容忍全 0）\n' + r.raw);
  assert.strictEqual(r.total, 70, `transaction wrapper 不得被删，实际 ${r.total}`);
  assert.strictEqual(r.async, 0, `async 必须 =0，实际 ${r.async}`);
  assert.strictEqual(r.asyncCallee, 0, `asyncCallee 必须 =0，实际 ${r.asyncCallee}`);
  assert.strictEqual(r.nested, 0, `nested 必须 =0，实际 ${r.nested}`);
  assert.strictEqual(r.indirectNested, 0, `indirectNested 必须 =0，实际 ${r.indirectNested}`);
  assert.strictEqual(r.transit, 0, `transit 必须 =0，实际 ${r.transit}`);
  assert.strictEqual(r.indirectTransit, 0, `indirectTransit 必须 =0，实际 ${r.indirectTransit}`);
});

test('1A-STATIC: 全仓 (async && hasTransit) 的 transaction 已清零（1A 4 + 1B 3 + 1C 2 = 9 → 0）', () => {
  const txs = parseTransactions();
  const bad = txs.filter((t) => t.async && t.hasTransit).length;
  // 1A 消除 4 + 1B 消除 3 + 1C 消除 2（refreshInventoryTotals + createHistoricalCI）
  assert.strictEqual(bad, 0, `Batch 1 全部 9 个 async+transit transaction 应已清零，实际 ${bad}`);
});

test('1B-STATIC: 全仓 transaction 回调内仍直接调用 updateInventoryTransitData 的数量 = 0（1C 两个目标均已完成）', () => {
  const txs = parseTransactions();
  const stillHasTransitInCb = txs.filter((t) => t.hasTransit).length;
  assert.strictEqual(stillHasTransitInCb, 0, `refreshInventoryTotals 与 createHistoricalCI 均已将 transit 移出事务回调，实际 ${stillHasTransitInCb}`);
});

test('1A-PATTERN-A: Phase B 主事实 COMMIT 后，Phase C transit 抛错不影响已提交主事实', () => {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');

  // Phase B：同步事务，仅写主事实
  db.exec('BEGIN');
  db.prepare('INSERT INTO t (v) VALUES (?)').run('main-fact');
  db.exec('COMMIT');

  // Phase C：在途刷新（best-effort），此处模拟失败
  let transitFailed = false;
  try {
    throw new Error('simulated transit refresh failure');
  } catch (err) {
    transitFailed = true;
    // 实际 handler 中：console.warn('[...] updateInventoryTransitData failed (best-effort, ignored):', err.message)
  }
  assert.ok(transitFailed, 'Phase C 失败时应当被捕获并仅告警');

  const row = db.prepare('SELECT v FROM t WHERE v = ?').get('main-fact');
  assert.ok(row, '主事实在 Phase C 失败后必须仍然存在（未被回滚）');
});

test('1A-PATTERN-B: Phase B 内部失败时主事实整体 ROLLBACK', () => {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');

  let rolledBack = false;
  db.exec('BEGIN');
  db.prepare('INSERT INTO t (v) VALUES (?)').run('before-error');
  try {
    throw new Error('simulated main-fact write failure');
  } catch (err) {
    db.exec('ROLLBACK');
    rolledBack = true;
  }
  assert.ok(rolledBack);

  const row = db.prepare('SELECT v FROM t WHERE v = ?').get('before-error');
  assert.strictEqual(row, undefined, '主事实写入失败后不应残留（整体回滚）');
});

test('1A-PATTERN-C: 单笔成功 + 单笔失败的两行，彼此独立（PI batch 风格隔离的基础语义）', () => {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');

  // 行 1：成功
  db.exec('BEGIN');
  db.prepare('INSERT INTO t (v) VALUES (?)').run('row-ok');
  db.exec('COMMIT');

  // 行 2：失败回滚
  db.exec('BEGIN');
  db.prepare('INSERT INTO t (v) VALUES (?)').run('row-bad');
  db.exec('ROLLBACK');

  assert.ok(db.prepare('SELECT v FROM t WHERE v = ?').get('row-ok'), '成功行应存在');
  assert.strictEqual(db.prepare('SELECT v FROM t WHERE v = ?').get('row-bad'), undefined, '失败行不应存在');
});

test('1B-PATTERN-D: CI batch 风格 — 单事务内多行 + per-row try/catch 吞错，提交后 Phase C 刷新', () => {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT NOT NULL)');
  const result = { success: 0, failed: 0 };
  // 单事务包裹全部行（与 CI batch 现状一致）
  db.exec('BEGIN');
  const rows = ['ok-1', null, 'ok-2']; // null 触发 NOT NULL 约束，模拟单行验证/写入失败
  rows.forEach((r) => {
    try {
      db.prepare('INSERT INTO t (v) VALUES (?)').run(r);
      result.success++;
    } catch (e) {
      result.failed++; // per-row try/catch 吞错，事务继续
    }
  });
  db.exec('COMMIT'); // 同事务整体提交（CI batch 既有语义）
  // Phase C：在途刷新（best-effort）
  try { /* updateInventoryTransitData() */ } catch (e) { /* ignore */ }
  assert.strictEqual(result.success, 2, 'CI batch 成功行计数正确');
  assert.strictEqual(result.failed, 1, 'CI batch 失败行计数正确');
  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM t').get().c, 2, 'CI batch 单行失败不阻止其它行提交（同事务整体提交，保持现状语义）');
});

test('1B-PATTERN-E: PI batch 风格 — 每行独立顶层事务 + 全部行后单次 Phase C 刷新', () => {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT NOT NULL)');
  const result = { success: 0, failed: 0 };
  const rows = ['ok-1', null, 'ok-2']; // null 触发 NOT NULL 约束，模拟单行失败
  // 删 outer 后：每行独立顶层 transaction（不再嵌套）
  rows.forEach((r) => {
    try {
      db.exec('BEGIN');
      db.prepare('INSERT INTO t (v) VALUES (?)').run(r);
      db.exec('COMMIT');
      result.success++;
    } catch (e) {
      db.exec('ROLLBACK');
      result.failed++;
    }
  });
  // 全部行处理完成后单次 Phase C（best-effort，失败不回滚已提交主事实）
  try { /* updateInventoryTransitData() */ } catch (e) { /* ignore */ }
  assert.strictEqual(result.success, 2, 'PI batch 成功行计数正确');
  assert.strictEqual(result.failed, 1, 'PI batch 失败行计数正确');
  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM t').get().c, 2, 'PI batch 每行独立事务，失败行不污染成功行');
});

// ---------- 真实 route 边界静态契约（防“删 transaction 让数字变绿”回归） ----------
// 关键反思：async=0 本身不能代表事务修复正确。必须同时证明「需要事务保护的业务写仍在事务里」。
// 以下测试直接解析 server.js AST，锁定每个 batch route 的事务边界。
function findRouteHandler(src, method, path) {
  const ast = acorn.parse(src, { ecmaVersion: 2022, sourceType: 'script', ranges: true });
  let handler = null;
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'CallExpression') {
      const c = node.callee;
      if (
        c.type === 'MemberExpression' && !c.computed &&
        c.object.type === 'Identifier' && c.object.name === 'app' &&
        c.property.type === 'Identifier' && c.property.name === method &&
        node.arguments.length >= 1 &&
        node.arguments[0].type === 'Literal' && node.arguments[0].value === path
      ) {
        const ah = node.arguments.find(
          (a) => a.type === 'CallExpression' && a.callee.type === 'Identifier' && a.callee.name === 'asyncHandler'
        );
        if (ah && ah.arguments[0]) handler = ah.arguments[0];
      }
    }
    for (const k of Object.keys(node)) {
      if (node[k] && typeof node[k] === 'object') walk(node[k]);
    }
  };
  walk(ast);
  return handler;
}

function analyzeHandler(handler) {
  const txs = [];
  const forEachs = [];
  const transits = [];
  const isTxCallee = (callee) =>
    (callee.type === 'Identifier' && callee.name === 'transaction') ||
    (callee.type === 'MemberExpression' && !callee.computed && callee.property.name === 'transaction');
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'CallExpression') {
      if (isTxCallee(node.callee)) {
        const cb = node.arguments[0];
        txs.push({
          node,
          cb,
          async: !!(cb && (cb.type === 'ArrowFunctionExpression' || cb.type === 'FunctionExpression') && cb.async),
        });
      }
      if (
        node.callee.type === 'MemberExpression' && !node.callee.computed &&
        node.callee.property.type === 'Identifier' && node.callee.property.name === 'forEach'
      ) {
        forEachs.push(node);
      }
      if (node.callee.type === 'Identifier' && node.callee.name === 'updateInventoryTransitData') {
        transits.push(node);
      }
    }
    for (const k of Object.keys(node)) {
      if (node[k] && typeof node[k] === 'object') walk(node[k]);
    }
  };
  walk(handler);
  const inside = (inner, outer) =>
    !!(outer && inner && outer.range && inner.range && outer.range[0] <= inner.range[0] && outer.range[1] >= inner.range[1]);
  return { txs, forEachs, transits, inside };
}

// 按函数名定位（用于非 route handler 的纯函数，如 refreshInventoryTotals / createHistoricalCI）
function findFunction(src, name) {
  const ast = acorn.parse(src, { ecmaVersion: 2022, sourceType: 'script', ranges: true });
  let fn = null;
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (
      (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') &&
      node.id && node.id.type === 'Identifier' && node.id.name === name
    ) {
      fn = node;
    }
    for (const k of Object.keys(node)) {
      if (node[k] && typeof node[k] === 'object') walk(node[k]);
    }
  };
  walk(ast);
  return fn;
}

function countAwait(node) {
  let n = 0;
  const walk = (nd) => {
    if (!nd || typeof nd !== 'object') return;
    if (nd.type === 'AwaitExpression') n++;
    for (const k of Object.keys(nd)) {
      if (nd[k] && typeof nd[k] === 'object') walk(nd[k]);
    }
  };
  walk(node);
  return n;
}

function countCallsInside(node, calleeName) {
  let n = 0;
  const walk = (nd) => {
    if (!nd || typeof nd !== 'object') return;
    if (nd.type === 'CallExpression' && nd.callee.type === 'Identifier' && nd.callee.name === calleeName) n++;
    for (const k of Object.keys(nd)) {
      if (nd[k] && typeof nd[k] === 'object') walk(nd[k]);
    }
  };
  walk(node);
  return n;
}

function findCallSites(src, calleeName) {
  const ast = acorn.parse(src, { ecmaVersion: 2022, sourceType: 'script', ranges: true });
  const sites = [];
  const walk = (nd, parent) => {
    if (!nd || typeof nd !== 'object') return;
    if (nd.type === 'CallExpression' && nd.callee.type === 'Identifier' && nd.callee.name === calleeName) {
      sites.push({ node: nd, parent });
    }
    for (const k of Object.keys(nd)) {
      if (nd[k] && typeof nd[k] === 'object') walk(nd[k], nd);
    }
  };
  walk(ast, null);
  return sites;
}

test('1B-ROUTE-CI: CI batch 保留 exactly 1 transaction，callback sync，rows.forEach 在事务内，transit 在事务外', () => {
  const src = fs.readFileSync(SERVER, 'utf8');
  const handler = findRouteHandler(src, 'post', '/api/commercial-invoices/batch-import');
  assert.ok(handler, '必须找到 CI batch handler');
  const { txs, forEachs, transits, inside } = analyzeHandler(handler);
  assert.strictEqual(txs.length, 1, `CI batch 必须恰好 1 个 transaction（当前 ${txs.length}，多/少都意味着事务边界被破坏）`);
  assert.strictEqual(txs[0].async, false, 'CI batch transaction callback 必须是 sync（非 async）');
  const rowForEach = forEachs.find((f) => inside(f, txs[0].cb));
  assert.ok(rowForEach, 'rows.forEach 必须位于 transaction 回调内（主事实写受事务保护）');
  const transitInTx = transits.filter((t) => inside(t, txs[0].cb));
  assert.strictEqual(transitInTx.length, 0, 'updateInventoryTransitData 必须位于 transaction 回调外（Phase C）');
  assert.ok(transits.length >= 1, '应存在 updateInventoryTransitData 调用（Phase C best-effort）');
});

test('1B-ROUTE-INBOUND: inbound batch 保留 exactly 1 transaction，callback sync，records.forEach 在事务内，transit 在事务外', () => {
  const src = fs.readFileSync(SERVER, 'utf8');
  const handler = findRouteHandler(src, 'post', '/api/inbound-records/batch-import');
  assert.ok(handler, '必须找到 inbound batch handler');
  const { txs, forEachs, transits, inside } = analyzeHandler(handler);
  assert.strictEqual(txs.length, 1, `inbound batch 必须恰好 1 个 transaction（当前 ${txs.length}）`);
  assert.strictEqual(txs[0].async, false, 'inbound batch transaction callback 必须是 sync');
  const recForEach = forEachs.find((f) => inside(f, txs[0].cb));
  assert.ok(recForEach, 'records.forEach 必须位于 transaction 回调内（入库主事实写受事务保护）');
  const transitInTx = transits.filter((t) => inside(t, txs[0].cb));
  assert.strictEqual(transitInTx.length, 0, 'updateInventoryTransitData 必须位于 transaction 回调外（Phase C）');
  assert.ok(transits.length >= 1, '应存在 updateInventoryTransitData 调用（Phase C best-effort）');
});

test('1B-ROUTE-PI: PI batch 无 outer transaction，每行处理含顶层 transaction，transit 在全部事务外', () => {
  const src = fs.readFileSync(SERVER, 'utf8');
  const handler = findRouteHandler(src, 'post', '/api/proforma-invoices/batch-import');
  assert.ok(handler, '必须找到 PI batch handler');
  const { txs, forEachs, transits, inside } = analyzeHandler(handler);
  assert.ok(txs.length >= 1, 'PI batch 应至少含 1 个 transaction（per-row 顶层，非 outer 包裹）');
  const forEachInTx = forEachs.filter((f) => txs.some((t) => inside(f, t.cb)));
  assert.strictEqual(forEachInTx.length, 0, 'PI batch 的 rows.forEach 不得在任何 transaction 回调内（无失效 outer 事务）');
  const transitInTx = transits.filter((t) => txs.some((tt) => inside(t, tt.cb)));
  assert.strictEqual(transitInTx.length, 0, 'PI batch 的 updateInventoryTransitData 必须在所有 transaction 回调外（Phase C）');
});

// ---------- 1C-ROUTE: refreshInventoryTotals + createHistoricalCI 均已同步化 ----------
test('1C-ROUTE-REFRESH: refreshInventoryTotals 恰好 1 transaction，callback sync，无 AwaitExpression，主事实写在事务内，transit 在事务外；latestConfirmedWac 声明 sync 且 caller 不 await', () => {
  const src = fs.readFileSync(SERVER, 'utf8');
  const fn = findFunction(src, 'refreshInventoryTotals');
  assert.ok(fn, '必须找到 refreshInventoryTotals 函数定义');
  const { txs, transits, inside } = analyzeHandler(fn);
  assert.strictEqual(txs.length, 1, `refreshInventoryTotals 必须恰好 1 个 transaction（当前 ${txs.length}）`);
  assert.strictEqual(txs[0].async, false, 'refreshInventoryTotals transaction callback 必须是 sync（非 async）');
  assert.strictEqual(countAwait(txs[0].cb), 0, 'refreshInventoryTotals transaction callback 内 AwaitExpression 必须为 0（latestConfirmedWac 已同步化）');
  // inventory 主事实写（run / queryOne）必须仍在 transaction 回调内
  const mainFactWrites = countCallsInside(txs[0].cb, 'run') + countCallsInside(txs[0].cb, 'queryOne');
  assert.ok(mainFactWrites >= 1, 'inventory 主事实写（run/queryOne）必须仍在 transaction 回调内（受事务保护）');
  // latestConfirmedWac 声明 non-async
  const wacFn = findFunction(src, 'latestConfirmedWac');
  assert.ok(wacFn, '必须找到 latestConfirmedWac 函数定义');
  assert.strictEqual(wacFn.async, false, 'latestConfirmedWac 必须声明为 sync function（非 async）');
  // 唯一生产 caller 不带 await
  const sites = findCallSites(src, 'latestConfirmedWac');
  assert.strictEqual(sites.length, 1, `latestConfirmedWac 应仅有 1 个生产调用点（当前 ${sites.length}）`);
  for (const s of sites) {
    assert.notStrictEqual(s.parent && s.parent.type, 'AwaitExpression', 'latestConfirmedWac 的生产调用点不得带 await（已同步化）');
  }
  // updateInventoryTransitData 在 transaction 外（Phase C）
  const transitInTx = transits.filter((t) => inside(t, txs[0].cb));
  assert.strictEqual(transitInTx.length, 0, 'updateInventoryTransitData 必须位于 transaction 回调外（Phase C best-effort）');
  assert.ok(transits.length >= 1, '应存在 updateInventoryTransitData 调用（Phase C best-effort）');
});

test('1C-ROUTE-HCI: createHistoricalCI 恰好 1 transaction，callback sync，AwaitExpression=0，HCI/payment/settlement 主写在事务内，transit 在事务外，result 在 Phase C 后 return', () => {
  const src = fs.readFileSync(SERVER, 'utf8');
  const fn = findFunction(src, 'createHistoricalCI');
  assert.ok(fn, '必须找到 createHistoricalCI 函数定义');
  assert.strictEqual(fn.async, true, 'createHistoricalCI 外层 workflow 必须仍保持 async（normalizeHistoricalCI / 事务前数据准备保留 await）');
  const { txs, transits, inside } = analyzeHandler(fn);
  assert.strictEqual(txs.length, 1, `createHistoricalCI 必须恰好 1 个 transaction（当前 ${txs.length}）`);
  assert.strictEqual(txs[0].async, false, 'createHistoricalCI transaction callback 必须是 sync（非 async）');
  assert.strictEqual(countAwait(txs[0].cb), 0, 'createHistoricalCI transaction callback 内 AwaitExpression 必须为 0（settlement 链已同步化，全部 await 已剥除）');

  // HCI / payment_request / payment_request_items / settlement_logs / PI link 核心写必须仍在 transaction 回调内
  const hciInsert = countCallsInside(txs[0].cb, 'run') + countCallsInside(txs[0].cb, 'queryOne');
  assert.ok(hciInsert >= 1, 'HCI / payment_request / settlement 主事实写（run/queryOne）必须仍在 transaction 回调内（受事务保护）');
  const settlementCalc = countCallsInside(txs[0].cb, 'recalculatePaymentSettlement');
  assert.strictEqual(settlementCalc, 1, 'recalculatePaymentSettlement 必须位于 transaction 回调内（结算写仍在 HCI 同一事务）');
  // updateInventoryTransitData 在 transaction 外（Phase C）
  const transitInTx = transits.filter((t) => inside(t, txs[0].cb));
  assert.strictEqual(transitInTx.length, 0, 'updateInventoryTransitData 必须位于 transaction 回调外（Phase C，唯一移出的写）');
  assert.ok(transits.length >= 1, '应存在 updateInventoryTransitData 调用（Phase C best-effort）');

  // result 在 Phase C 后 return：transaction 返回值被赋值给 result 变量并 return
  // 结构： const result = transaction(() => {...}); ...updateInventoryTransitData().catch(...); return result;
  const body = fn.body.body;
  const hasResultAssign = body.some((s) =>
    s.type === 'VariableDeclaration' && s.declarations.some((d) => d.id.name === 'result' && d.init && d.init.type === 'CallExpression' && d.init.callee.name === 'transaction'));
  assert.ok(hasResultAssign, 'transaction 返回值必须赋给 result 变量（const result = transaction(...)）');
  const hasReturnResult = body.some((s) => s.type === 'ReturnStatement' && s.argument && s.argument.type === 'Identifier' && s.argument.name === 'result');
  assert.ok(hasReturnResult, '函数末尾必须以 return result 原样返回 transaction 结果（不得遗漏 return，不得 return transaction(...) 不可达）');
});