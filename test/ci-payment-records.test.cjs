'use strict';

/**
 * ci-payment-records.test.cjs — CI 详情付款记录（ciPaymentRecords）回归测试
 *
 * 契约：
 *   - 输入 payable_item_ids（调用方按 CI 类型给出口径：运营=balance 尾款；历史=全部应付项）；
 *   - 批量聚合 payment_requests / payment_settlement_logs / payment_transactions（各查询一次，无 N+1、
 *     无循环单条 paymentSettlementFacts 调用）；
 *   - 每 PR 金额与状态公式必须与 paymentSettlementFacts / derivePaymentStatus（财务 SSOT）逐字段一致；
 *   - PR 过滤口径与 /api/payment-requests/by-payable-items 一致：排除 cancelled/rejected。
 *
 * 金额单位约定：payment_transactions.paid_amount_minor 为分（minor）；
 *              settlement_logs.amount / payment_requests.payable_amount·deduction_amount·rounding_amount 为元。
 * 不访问生产 DB；全部用例运行于 :memory: SQLite 离线回放。
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_DRIVER = 'sqlite';
process.env.DB_PATH = ':memory:';

const dbMod = require('../db');
const { run, query } = dbMod;
const {
  ciPaymentRecords,
  paymentSettlementFacts,
  derivePaymentStatus,
} = require('../server');

createSchema();
seed();

function createSchema() {
  const db = dbMod.getDB();
  db.exec(`
    CREATE TABLE IF NOT EXISTS payable_items (
      id TEXT PRIMARY KEY, source_type TEXT, source_id TEXT, source_ci_id TEXT, source_no TEXT,
      fee_type TEXT, payable_amount_minor INTEGER DEFAULT 0, lifecycle_status TEXT DEFAULT 'active'
    );
    CREATE TABLE IF NOT EXISTS payment_requests (
      id TEXT PRIMARY KEY, request_no TEXT, source_type TEXT,
      payment_status TEXT DEFAULT 'pending', approval_status TEXT DEFAULT 'pending',
      payment_mode TEXT DEFAULT 'single', payment_category TEXT DEFAULT 'goods',
      currency TEXT DEFAULT 'USD', payee_name_snapshot TEXT DEFAULT '',
      payable_amount NUMERIC DEFAULT 0, paid_amount NUMERIC DEFAULT 0,
      deduction_amount NUMERIC DEFAULT 0, rounding_amount NUMERIC DEFAULT 0,
      paid_date TEXT DEFAULT '', created_at TEXT DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS payment_request_items (
      id TEXT PRIMARY KEY, payable_item_id TEXT, payment_request_id TEXT, requested_amount_minor INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS payment_settlement_logs (
      id TEXT PRIMARY KEY, payment_request_id TEXT, event_type TEXT, amount NUMERIC DEFAULT 0,
      status TEXT DEFAULT 'applied', reason TEXT DEFAULT '', paid_date TEXT DEFAULT '',
      original_currency TEXT DEFAULT '', operator_name TEXT DEFAULT '',
      is_legacy INTEGER DEFAULT 0, created_at TEXT DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS payment_transactions (
      id TEXT PRIMARY KEY, payment_request_id TEXT, trans_no TEXT DEFAULT '',
      paid_amount_minor INTEGER DEFAULT 0, paid_date TEXT DEFAULT '',
      payment_account TEXT DEFAULT '', trans_status TEXT DEFAULT 'reconciled', created_at TEXT DEFAULT ''
    );
  `);
}

function insertPR(id, fields) {
  run(`INSERT INTO payment_requests (id, request_no, payment_status, approval_status, currency, payee_name_snapshot,
        payable_amount, deduction_amount, rounding_amount, paid_date, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [id, fields.request_no, fields.payment_status, fields.approval_status, fields.currency || 'USD',
      fields.payee_name_snapshot || '', fields.payable_amount || 0, fields.deduction_amount || 0,
      fields.rounding_amount || 0, fields.paid_date || '', fields.created_at || '']);
}

function seed() {
  // PR-A：新事务付款（2 笔不同账户 reconciled）+ applied 抵扣/抹零 logs
  insertPR('PAY-A', { request_no: 'PAY-MULTI-A', payment_status: 'partial_paid', approval_status: 'approved',
    payable_amount: 1000, created_at: '2026-01-01T00:00:00Z' });
  run(`INSERT INTO payment_request_items (id, payable_item_id, payment_request_id, requested_amount_minor) VALUES (?,?,?,?)`,
    ['pri_a1', 'pi_a1', 'PAY-A', 60000]);
  run(`INSERT INTO payment_request_items (id, payable_item_id, payment_request_id, requested_amount_minor) VALUES (?,?,?,?)`,
    ['pri_a2', 'pi_a2', 'PAY-A', 40000]);
  run(`INSERT INTO payment_transactions (id, payment_request_id, trans_no, paid_amount_minor, paid_date, payment_account, trans_status, created_at)
       VALUES (?,?,?,?,?,?,?,?)`, ['tx_a1', 'PAY-A', 'TX-A1', 30000, '2026-01-10', 'BCA-123', 'reconciled', '2026-01-10T00:00:00Z']);
  run(`INSERT INTO payment_transactions (id, payment_request_id, trans_no, paid_amount_minor, paid_date, payment_account, trans_status, created_at)
       VALUES (?,?,?,?,?,?,?,?)`, ['tx_a2', 'PAY-A', 'TX-A2', 10000, '2026-01-15', 'MANDIRI-456', 'reconciled', '2026-01-15T00:00:00Z']);
  run(`INSERT INTO payment_settlement_logs (id, payment_request_id, event_type, amount, status, is_legacy, created_at)
       VALUES (?,?,?,?,?,?,?)`, ['sl_a1', 'PAY-A', 'deduction', 5, 'applied', 0, '2026-01-10T00:00:00Z']);
  run(`INSERT INTO payment_settlement_logs (id, payment_request_id, event_type, amount, status, is_legacy, created_at)
       VALUES (?,?,?,?,?,?,?)`, ['sl_a2', 'PAY-A', 'rounding', 0.2, 'applied', 0, '2026-01-10T00:00:00Z']);
  // PR-B：无任何 logs → deduction/rounding 回退 PR 存列；未付款
  insertPR('PAY-B', { request_no: 'PAY-MULTI-B', payment_status: 'pending', approval_status: 'approved',
    payable_amount: 500, deduction_amount: 10, created_at: '2026-01-02T00:00:00Z' });
  run(`INSERT INTO payment_request_items (id, payable_item_id, payment_request_id, requested_amount_minor) VALUES (?,?,?,?)`,
    ['pri_b1', 'pi_b1', 'PAY-B', 50000]);
  // PR-C：cancelled → 必须被排除
  insertPR('PAY-C', { request_no: 'PAY-MULTI-C', payment_status: 'cancelled', approval_status: 'approved',
    payable_amount: 300, created_at: '2026-01-03T00:00:00Z' });
  run(`INSERT INTO payment_request_items (id, payable_item_id, payment_request_id, requested_amount_minor) VALUES (?,?,?,?)`,
    ['pri_c1', 'pi_c1', 'PAY-C', 30000]);
  // PR-D：approved 未结算（无 logs、无 tx、无存列抵扣）
  insertPR('PAY-D', { request_no: 'PAY-MULTI-D', payment_status: 'pending', approval_status: 'approved',
    payable_amount: 200, created_at: '2026-01-04T00:00:00Z' });
  run(`INSERT INTO payment_request_items (id, payable_item_id, payment_request_id, requested_amount_minor) VALUES (?,?,?,?)`,
    ['pri_d1', 'pi_d1', 'PAY-D', 20000]);
}

test('ciPaymentRecords: 空输入返回空数组', () => {
  assert.deepEqual(ciPaymentRecords([]), []);
  assert.deepEqual(ciPaymentRecords(null), []);
  assert.deepEqual(ciPaymentRecords(undefined), []);
});

test('ciPaymentRecords: 批量一次调用返回全部有效 PR（排除 cancelled），PR 去重', () => {
  const recs = ciPaymentRecords(['pi_a1', 'pi_a2', 'pi_b1', 'pi_c1', 'pi_d1']);
  const ids = recs.map(r => r.payment_request_id);
  // PR-A 因两个 payable item 只出一条（去重）；PR-C cancelled 被排除
  assert.equal(ids.filter(x => x === 'PAY-A').length, 1);
  assert.ok(!ids.includes('PAY-C'));
  assert.equal(recs.length, 3);
  // created_at DESC 排序
  assert.deepEqual(ids, ['PAY-D', 'PAY-B', 'PAY-A']);
});

test('ciPaymentRecords: 金额与状态与 paymentSettlementFacts SSOT 逐字段一致（PR-A）', () => {
  const recA = ciPaymentRecords(['pi_a1']).find(r => r.payment_request_id === 'PAY-A');
  assert.ok(recA);
  const prA = query(`SELECT * FROM payment_requests WHERE id = 'PAY-A'`).rows[0];
  const factsA = paymentSettlementFacts(prA);
  assert.equal(recA.actual_paid_amount, factsA.effectivePaid);          // 300 + 100 = 400
  assert.equal(recA.deduction_amount, factsA.effectiveDeduction);        // 5
  assert.equal(recA.rounding_amount, factsA.effectiveRounding);          // 0.2
  assert.equal(recA.outstanding, factsA.outstanding);                    // 1000-400-5-0.2 = 594.8
  assert.equal(recA.payment_status, derivePaymentStatus(prA, factsA));   // partial_payment_partial_deduction
  assert.equal(recA.actual_paid_amount, 400);
  assert.equal(recA.outstanding, 594.8);
  assert.equal(recA.payment_status, 'partial_payment_partial_deduction');
  // 交易明细与账户聚合
  assert.equal(recA.transactions.length, 2);
  assert.equal(recA.payment_account, 'BCA-123 / MANDIRI-456');
  assert.equal(recA.paid_date, '2026-01-15'); // PR 存列 paid_date 为空时回退最新 tx 日期
  assert.equal(recA.transactions[1].paid_amount, 100);
});

test('ciPaymentRecords: 无 logs 时回退 PR 存列（PR-B）', () => {
  const recB = ciPaymentRecords(['pi_b1']).find(r => r.payment_request_id === 'PAY-B');
  const prB = query(`SELECT * FROM payment_requests WHERE id = 'PAY-B'`).rows[0];
  const factsB = paymentSettlementFacts(prB);
  assert.equal(recB.actual_paid_amount, factsB.effectivePaid);
  assert.equal(recB.deduction_amount, factsB.effectiveDeduction);
  assert.equal(recB.outstanding, factsB.outstanding);
  assert.equal(recB.payment_status, derivePaymentStatus(prB, factsB));
  assert.equal(recB.deduction_amount, 10);
  assert.equal(recB.actual_paid_amount, 0);
  assert.equal(recB.payment_status, 'partial_deduction');
});

test('ciPaymentRecords: approved 未结算 PR 状态口径（PR-D）', () => {
  const recD = ciPaymentRecords(['pi_d1']).find(r => r.payment_request_id === 'PAY-D');
  const prD = query(`SELECT * FROM payment_requests WHERE id = 'PAY-D'`).rows[0];
  const factsD = paymentSettlementFacts(prD);
  assert.equal(recD.payment_status, derivePaymentStatus(prD, factsD));
  assert.equal(recD.payment_status, 'approved');
  assert.equal(recD.outstanding, 200);
});

test('ciPaymentRecords: 字段结构完整（7 个展示字段 + 交易明细）', () => {
  const rec = ciPaymentRecords(['pi_a1'])[0];
  for (const key of ['payment_request_id', 'payment_no', 'actual_paid_amount', 'deduction_amount',
    'rounding_amount', 'outstanding', 'paid_date', 'payment_account', 'payment_status',
    'approval_status', 'currency', 'payee_name', 'transactions']) {
    assert.ok(Object.prototype.hasOwnProperty.call(rec, key), 'missing key: ' + key);
  }
  assert.equal(rec.payment_no, 'PAY-MULTI-A');
  assert.equal(rec.currency, 'USD');
  for (const tx of rec.transactions) {
    for (const k of ['trans_no', 'paid_amount', 'paid_date', 'payment_account']) {
      assert.ok(Object.prototype.hasOwnProperty.call(tx, k), 'missing tx key: ' + k);
    }
  }
});
