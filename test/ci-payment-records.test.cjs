'use strict';

/**
 * ci-payment-records.test.cjs — CI 详情付款记录（ciPaymentRecords）回归测试
 *
 * 契约（CI 维度口径，2026-09-05 修复后）：
 *   - 输入 payable_item_ids（调用方按 CI 类型给出口径：运营=balance 尾款；历史=全部应付项）；
 *   - 批量聚合 payment_requests / payment_allocations / payment_settlement_logs / payment_transactions
 *     （各查询一次，无 N+1、无循环单条 paymentSettlementFacts 调用）；
 *   - 一个 payment_request 可挂多个 CI：每行金额必须为「本 CI 在该 PR 内」的分摊额，公式与
 *     payableItemsSettlementBreakdown（应付/已付/抵扣/抹零 SSOT）逐项一致：
 *       应付 = 本 CI 在该 PR 的 Σ requested_amount_minor
 *       实付 = Σ payment_allocations.allocated_amount_minor（reconciled，按 pri 精确归属本 CI）
 *              + legacy 付款日志（is_legacy=1，PR 级，按占比分摊；excludeLegacy=true 时不计）
 *       抵扣/抹零 = PR 级 applied 日志金额 × share（share=本 CI 占比）
 *       未结 = 应付 − 实付 − 抵扣 − 抹零
 *   - 付款账户/日期/交易明细：仅取 payment_allocations.transaction_id → payment_transactions 中归属本 CI 的交易。
 *   - PR 过滤口径与 /api/payment-requests/by-payable-items 一致：排除 cancelled/rejected。
 *
 * 金额单位约定：payment_transactions.paid_amount_minor / payment_allocations.allocated_amount_minor /
 *              payment_request_items.requested_amount_minor 为分（minor）；
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
    CREATE TABLE IF NOT EXISTS payment_allocations (
      id TEXT PRIMARY KEY, transaction_id TEXT, payment_request_item_id TEXT,
      allocated_amount_minor INTEGER DEFAULT 0, status TEXT DEFAULT 'reconciled'
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
function pri(id, piId, prId, minor) {
  run(`INSERT INTO payment_request_items (id, payable_item_id, payment_request_id, requested_amount_minor) VALUES (?,?,?,?)`,
    [id, piId, prId, minor]);
}
function alloc(id, txId, priId, minor) {
  run(`INSERT INTO payment_allocations (id, transaction_id, payment_request_item_id, allocated_amount_minor) VALUES (?,?,?,?)`,
    [id, txId, priId, minor]);
}
function tx(id, prId, no, minor, date, acct) {
  run(`INSERT INTO payment_transactions (id, payment_request_id, trans_no, paid_amount_minor, paid_date, payment_account, trans_status, created_at)
       VALUES (?,?,?,?,?,?,?,?)`, [id, prId, no, minor, date, acct, 'reconciled', date + 'T00:00:00Z']);
}
function log(id, prId, type, amount, legacy) {
  run(`INSERT INTO payment_settlement_logs (id, payment_request_id, event_type, amount, status, is_legacy, created_at)
       VALUES (?,?,?,?,'applied',?,?)`, [id, prId, type, amount, legacy || 0, '2026-01-01T00:00:00Z']);
}

function seed() {
  // ── 场景 1：一个 PR 挂两个 CI（不同 payable item），仅付部分，验证行内分摊 ──
  // PR-A payable=1000，CI-A(pri_a1) 占比 60%，CI-B(pri_a2) 占比 40%
  insertPR('PAY-A', { request_no: 'PAY-MULTI-A', payment_status: 'partial_paid', approval_status: 'approved',
    payable_amount: 1000, created_at: '2026-01-01T00:00:00Z' });
  pri('pri_a1', 'pi_a1', 'PAY-A', 60000);
  pri('pri_a2', 'pi_b1', 'PAY-A', 40000);
  tx('tx_a1', 'PAY-A', 'TX-A1', 30000, '2026-01-10', 'BCA-123');
  tx('tx_a2', 'PAY-A', 'TX-A2', 10000, '2026-01-15', 'MANDIRI-456');
  alloc('al_a1', 'tx_a1', 'pri_a1', 30000); // CI-A 实付 300
  alloc('al_a2', 'tx_a2', 'pri_a2', 10000); // CI-B 实付 100

  // ── 场景 2：同一 CI 多次付款（同一 PR 内两笔 allocation + 两笔 tx） ──
  // PR-B payable=500，CI-B 全部付清（200+300），两账户两日期
  insertPR('PAY-B', { request_no: 'PAY-MULTI-B', payment_status: 'paid', approval_status: 'approved',
    payable_amount: 500, created_at: '2026-01-02T00:00:00Z' });
  pri('pri_b2', 'pi_b2', 'PAY-B', 50000);
  tx('tx_b1', 'PAY-B', 'TX-B1', 20000, '2026-02-10', 'BCA-111');
  tx('tx_b2', 'PAY-B', 'TX-B2', 30000, '2026-02-20', 'MANDIRI-222');
  alloc('al_b1', 'tx_b1', 'pri_b2', 20000);
  alloc('al_b2', 'tx_b2', 'pri_b2', 30000);

  // ── 场景 3：PR 级抵扣日志按占比分摊（无付款） ──
  // PR-C payable=1000，CI-C(pri_c1) 60% / CI-C2(pri_c2) 40%，抵扣 100 元
  insertPR('PAY-C', { request_no: 'PAY-MULTI-C', payment_status: 'pending', approval_status: 'approved',
    payable_amount: 1000, created_at: '2026-01-03T00:00:00Z' });
  pri('pri_c1', 'pi_c1', 'PAY-C', 60000);
  pri('pri_c2', 'pi_c2', 'PAY-C', 40000);
  log('sl_c1', 'PAY-C', 'deduction', 100, 0);

  // ── 场景 4：PR 级抹零日志按占比分摊（无付款） ──
  // PR-D payable=1000，CI-D(pri_d1) 60% / CI-D2(pri_d2) 40%，抹零 0.50 元
  insertPR('PAY-D', { request_no: 'PAY-MULTI-D', payment_status: 'pending', approval_status: 'approved',
    payable_amount: 1000, created_at: '2026-01-04T00:00:00Z' });
  pri('pri_d1', 'pi_d1', 'PAY-D', 60000);
  pri('pri_d2', 'pi_d2', 'PAY-D', 40000);
  log('sl_d1', 'PAY-D', 'rounding', 0.5, 0);

  // ── 场景 5：历史 CI legacy 付款（is_legacy=1 全付）── excludeLegacy 控制是否计入 ──
  // PR-E payable=1000，CI-E 全额 legacy 付款
  insertPR('PAY-E', { request_no: 'PAY-MULTI-E', payment_status: 'paid', approval_status: 'approved',
    payable_amount: 1000, created_at: '2026-01-05T00:00:00Z' });
  pri('pri_e1', 'pi_e1', 'PAY-E', 100000);
  log('sl_e1', 'PAY-E', 'payment', 1000, 1);

  // ── 场景 6：cancelled PR 必须被排除 ──
  insertPR('PAY-F', { request_no: 'PAY-MULTI-F', payment_status: 'cancelled', approval_status: 'approved',
    payable_amount: 300, created_at: '2026-01-06T00:00:00Z' });
  pri('pri_f1', 'pi_f1', 'PAY-F', 30000);
}

const f2 = n => Number(n || 0).toFixed(2);
const sumField = (recs, key) => recs.reduce((s, r) => s + Number(r[key] || 0), 0);

test('ciPaymentRecords: 空输入返回空数组', () => {
  assert.deepEqual(ciPaymentRecords([]), []);
  assert.deepEqual(ciPaymentRecords(null), []);
  assert.deepEqual(ciPaymentRecords(undefined), []);
});

test('ciPaymentRecords: 一个 PR 多 CI —— 行内按占比分摊（CI-A 60%）', () => {
  const recs = ciPaymentRecords(['pi_a1']);
  assert.equal(recs.length, 1);
  const r = recs[0];
  assert.equal(r.payment_request_id, 'PAY-A');
  assert.equal(r.payable_amount, 600);      // 60% of 1000
  assert.equal(r.actual_paid_amount, 300);  // 实付 300（仅本 CI 的 allocation）
  assert.equal(r.deduction_amount, 0);
  assert.equal(r.rounding_amount, 0);
  assert.equal(r.outstanding, 300);         // 600-300
  assert.equal(r.payment_account, 'BCA-123'); // 仅本 CI 交易账户，不含 CI-B 的 MANDIRI-456
  assert.equal(r.paid_date, '2026-01-10');
});

test('ciPaymentRecords: 一个 PR 多 CI —— 行内按占比分摊（CI-B 40%，未付）', () => {
  const recs = ciPaymentRecords(['pi_b1']);
  assert.equal(recs.length, 1);
  const r = recs[0];
  assert.equal(r.payable_amount, 400);
  assert.equal(r.actual_paid_amount, 100);  // 仅本 CI 的 allocation 100
  assert.equal(r.outstanding, 300);
  assert.equal(r.payment_account, 'MANDIRI-456'); // 仅本 CI 交易账户
});

test('ciPaymentRecords: 一个 PR 多 CI —— 同 PR 两 CI 集合调用汇总回 PR 级', () => {
  const recs = ciPaymentRecords(['pi_a1', 'pi_b1']);
  assert.equal(recs.length, 1); // 同 PR 去重为一条
  const r = recs[0];
  assert.equal(r.payable_amount, 1000);     // 600+400
  assert.equal(r.actual_paid_amount, 400);  // 300+100
  assert.equal(r.outstanding, 600);
});

test('ciPaymentRecords: 多次付款（同 CI 两笔 allocation / 两交易）全付清', () => {
  const recs = ciPaymentRecords(['pi_b2']);
  assert.equal(recs.length, 1);
  const r = recs[0];
  assert.equal(r.payable_amount, 500);
  assert.equal(r.actual_paid_amount, 500);  // 200+300
  assert.equal(r.outstanding, 0);
  assert.equal(r.payment_status, 'paid');
  assert.equal(r.transactions.length, 2);   // 两笔交易均归属本 CI
  assert.equal(r.payment_account, 'BCA-111 / MANDIRI-222');
  assert.equal(r.paid_date, '2026-02-20');  // 最新交易日期
});

test('ciPaymentRecords: PR 级抵扣按占比分摊（CI-C 60% → 60 元）', () => {
  const recs = ciPaymentRecords(['pi_c1']);
  assert.equal(recs.length, 1);
  const r = recs[0];
  assert.equal(r.payable_amount, 600);
  assert.equal(r.deduction_amount, 60);     // 100 * 0.6
  assert.equal(r.actual_paid_amount, 0);
  assert.equal(r.outstanding, 540);         // 600-60
  assert.equal(r.payment_status, 'partial_deduction');
});

test('ciPaymentRecords: PR 级抵扣按占比分摊（CI-C2 40% → 40 元）', () => {
  const recs = ciPaymentRecords(['pi_c2']);
  assert.equal(recs.length, 1);
  const r = recs[0];
  assert.equal(r.payable_amount, 400);
  assert.equal(r.deduction_amount, 40);
  assert.equal(r.outstanding, 360);
});

test('ciPaymentRecords: PR 级抹零按占比分摊（CI-D 60% → 0.30 元）', () => {
  const recs = ciPaymentRecords(['pi_d1']);
  assert.equal(recs.length, 1);
  const r = recs[0];
  assert.equal(r.payable_amount, 600);
  assert.equal(r.rounding_amount, 0.30);    // 0.5 * 0.6
  assert.equal(r.actual_paid_amount, 0);
  assert.equal(r.outstanding, 599.70);      // 600-0.30
});

test('ciPaymentRecords: PR 级抹零按占比分摊（CI-D2 40% → 0.20 元）', () => {
  const recs = ciPaymentRecords(['pi_d2']);
  assert.equal(recs.length, 1);
  const r = recs[0];
  assert.equal(r.rounding_amount, 0.20);
  assert.equal(r.outstanding, 399.80);
});

test('ciPaymentRecords: historical legacy —— excludeLegacy=true 排除 is_legacy 付款', () => {
  const recs = ciPaymentRecords(['pi_e1'], { excludeLegacy: true });
  assert.equal(recs.length, 1);
  const r = recs[0];
  assert.equal(r.payable_amount, 1000);
  assert.equal(r.actual_paid_amount, 0);   // legacy 付款被排除
  assert.equal(r.outstanding, 1000);
  assert.equal(r.payment_status, 'approved');
});

test('ciPaymentRecords: historical legacy —— 默认（excludeLegacy=false）计入 legacy 付款', () => {
  const recs = ciPaymentRecords(['pi_e1']);
  assert.equal(recs.length, 1);
  const r = recs[0];
  assert.equal(r.actual_paid_amount, 1000); // legacy 全付
  assert.equal(r.outstanding, 0);
  assert.equal(r.payment_status, 'paid');
});

test('ciPaymentRecords: PR 过滤 —— cancelled 被排除', () => {
  const recs = ciPaymentRecords(['pi_f1']);
  assert.equal(recs.length, 0);
});

test('ciPaymentRecords: 字段结构完整（含新增 payable_amount + 交易明细）', () => {
  const rec = ciPaymentRecords(['pi_a1'])[0];
  for (const key of ['payment_request_id', 'payment_no', 'payable_amount', 'actual_paid_amount',
    'deduction_amount', 'rounding_amount', 'outstanding', 'paid_date', 'payment_account',
    'payment_status', 'approval_status', 'currency', 'payee_name', 'transactions']) {
    assert.ok(Object.prototype.hasOwnProperty.call(rec, key), 'missing key: ' + key);
  }
  assert.equal(rec.payment_no, 'PAY-MULTI-A');
  assert.equal(rec.currency, 'USD');
  for (const txr of rec.transactions) {
    for (const k of ['trans_no', 'paid_amount', 'paid_date', 'payment_account']) {
      assert.ok(Object.prototype.hasOwnProperty.call(txr, k), 'missing tx key: ' + k);
    }
  }
});

test('ciPaymentRecords: 单 CI 维度金额与 SSOT 公式逐项一致（基于 payment_allocations 独立复算）', () => {
  // 以 CI-A（requested 60000 / 已 allocation 30000 / 无抵扣抹零）为例，
  // 独立从 payment_allocations 复算本 CI 实付，核验展示层为「本 CI 分摊额」而非 PR 级整单金额。
  const allocPaid = query(
    `SELECT COALESCE(SUM(allocated_amount_minor),0) AS m
     FROM payment_allocations pa
     JOIN payment_request_items pri ON pri.id = pa.payment_request_item_id
     WHERE pri.payable_item_id = 'pi_a1' AND pa.status = 'reconciled'`
  ).rows[0].m;
  const minorToAmount = m => (Number(m) || 0) / 100;
  const r = ciPaymentRecords(['pi_a1'])[0];
  assert.equal(r.actual_paid_amount, minorToAmount(allocPaid)); // 300
  // 未结 = 应付(本CI) − 实付(本CI) − 抵扣(本CI) − 抹零(本CI)
  const payable = r.payable_amount;
  assert.equal(r.outstanding, payable - r.actual_paid_amount - r.deduction_amount - r.rounding_amount);
  // 反例：PR 级整单实付为 400（CI-A 300 + CI-B 100），展示层必须不是 PR 级
  assert.notEqual(r.actual_paid_amount, 400);
});
