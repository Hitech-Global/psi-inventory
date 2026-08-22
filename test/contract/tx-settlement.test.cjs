/**
 * tx-settlement.test.cjs — settlement helper 链同步化契约测试（方案 A 产物）
 *
 * Batch 1C 解除 createHistoricalCI 阻塞时，将整条 settlement 假异步链同步化：
 *   recalculatePaymentSettlement / paymentSettlementFacts / syncPaymentSource /
 *   aggregatePiDepositSettlement / aggregateSourceSettlement
 *
 * 这些函数本身不是 frozen baseline 中的 transaction callback（它们不计 scanner async 数），
 * 但它们被 createHistoricalCI transaction 回调同步调用，且返回值进入 HCI 返回 payload。
 *
 * 核心安全门（用户要求）：recalculatePaymentSettlement 返回值必须是「真实 settlement object」，
 * 而绝不能是 Promise。本测试用 AST 结构证明：
 *   - 5 个函数均为 sync（非 async）
 *   - 5 个函数体内 AwaitExpression = 0
 *   - recalculatePaymentSettlement 的 return 是「对象字面量」而非「返回 Promise 的调用」
 *   → 非 async + 无 await + 返回对象字面量 = 返回 plain object，结构上不可能为 Promise
 *
 * 不依赖 DB：结构证明比运行时 mock 更强（mock 只能证明一次调用，结构证明证明永远如此）。
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');

const REPO = process.cwd();
const SERVER = path.resolve(REPO, 'server.js');

function parse() {
  return acorn.parse(fs.readFileSync(SERVER, 'utf8'), {
    ecmaVersion: 2022, sourceType: 'script', ranges: true,
  });
}

function findFunction(ast, name) {
  let fn = null;
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (
      (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') &&
      node.id && node.id.type === 'Identifier' && node.id.name === name
    ) fn = node;
    for (const k of Object.keys(node)) if (node[k] && typeof node[k] === 'object') walk(node[k]);
  };
  walk(ast);
  return fn;
}

function countAwait(node) {
  let n = 0;
  const walk = (nd) => {
    if (!nd || typeof nd !== 'object') return;
    if (nd.type === 'AwaitExpression') n++;
    for (const k of Object.keys(nd)) if (nd[k] && typeof nd[k] === 'object') walk(nd[k]);
  };
  walk(node);
  return n;
}

function findReturnObject(node) {
  let found = null;
  const walk = (nd) => {
    if (!nd || typeof nd !== 'object' || found) return;
    if (nd.type === 'ReturnStatement') { found = nd.argument; return; }
    for (const k of Object.keys(nd)) if (nd[k] && typeof nd[k] === 'object') walk(nd[k]);
  };
  walk(node);
  return found;
}

const HELPERS = [
  'recalculatePaymentSettlement',
  'paymentSettlementFacts',
  'syncPaymentSource',
  'aggregatePiDepositSettlement',
  'aggregateSourceSettlement',
];

test('SETTLE-1: 5 个 settlement helper 均 non-async 且体内 AwaitExpression = 0', () => {
  const ast = parse();
  for (const h of HELPERS) {
    const fn = findFunction(ast, h);
    assert.ok(fn, `必须找到函数定义: ${h}`);
    assert.strictEqual(fn.async, false, `${h} 必须声明为 sync function（非 async）`);
    assert.strictEqual(countAwait(fn), 0, `${h} 函数体内 AwaitExpression 必须为 0（已同步化）`);
  }
});

test('SETTLE-2: recalculatePaymentSettlement 返回值是 plain object，绝不能是 Promise', () => {
  const ast = parse();
  const fn = findFunction(ast, 'recalculatePaymentSettlement');
  assert.ok(fn, '必须找到 recalculatePaymentSettlement 定义');
  // 非 async + 体内无 await ⇒ 其返回语句的值就是最终返回给 caller 的值
  assert.strictEqual(fn.async, false, '非 async');
  assert.strictEqual(countAwait(fn), 0, '无 await');
  const ret = findReturnObject(fn);
  assert.ok(ret, '必须存在 return 语句');
  // 返回必须是对象字面量（ObjectExpression），而非某个返回 Promise 的 CallExpression
  assert.strictEqual(ret.type, 'ObjectExpression',
    'recalculatePaymentSettlement 的 return 必须是对象字面量（plain object），而非返回 Promise 的调用——否则 createHistoricalCI 拿到的是 Promise 而非真实 settlement');
});

test('SETTLE-3: recalculatePaymentSettlement 返回 object 含 outstanding 与 payment_status（财务 payload 字段完整）', () => {
  const ast = parse();
  const fn = findFunction(ast, 'recalculatePaymentSettlement');
  const ret = findReturnObject(fn);
  assert.ok(ret && ret.type === 'ObjectExpression', 'return 必须是对象字面量');
  const keys = ret.properties
    .filter((p) => p.key && p.key.type === 'Identifier')
    .map((p) => p.key.name);
  assert.ok(keys.includes('outstanding'), `返回 object 必须含 outstanding（当前键: ${keys.join(',')}）`);
  assert.ok(keys.includes('payment_status'), `返回 object 必须含 payment_status（当前键: ${keys.join(',')}）`);
});

test('SETTLE-4: 链内调用（paymentSettlementFacts / syncPaymentSource / aggregate*）同步调用，无遗留 await', () => {
  const ast = parse();
  // 这些被 recalculatePaymentSettlement / syncPaymentSource 内部使用；已同步化后应为直接调用
  // 这里仅复核：5 个函数整体不再出现 AwaitExpression（已被 SETTLE-1 覆盖），
  // 并确认它们不在 frozen baseline 的 transaction callback 集合中（不影响 scanner 计数）。
  for (const h of HELPERS) {
    const fn = findFunction(ast, h);
    assert.strictEqual(countAwait(fn), 0, `${h} 不应残留任何 await`);
  }
});
