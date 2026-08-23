'use strict';

/**
 * 付款结算「部分付款 vs 尾差抹零」判断修复测试
 *
 * 根因：原 finalPaymentApprovalInput 用 `实际付款 < 应付` 直接判定部分付款，
 * 导致「整数实际付款 + 尾差抹零 = 应付金额」的正常尾差结清场景被误判为部分付款并拦截。
 *
 * 新规则：真实部分付款 = `实际付款金额 < 应付金额 − 抹零金额`
 *   - 实际付款整数 + 尾差抹零 = 应付  → 视为全额结清，允许提交（不再拦截）
 *   - 实际付款 + 抹零 仍 < 应付        → 视为真实部分付款
 *
 * 本文件覆盖验收要求的 4 个案例，并验证统一结算公式与 settlement log 记录一致性。
 */

process.env.DB_DRIVER = 'sqlite';
process.env.DB_PATH = ':memory:';

const { test, before, describe } = require('node:test');
const assert = require('node:assert/strict');

const db = require('./db');
const { finalPaymentApprovalInput, paymentSettlementFacts, derivePaymentStatus } = require('./server');

// 一个有效的审批输入骨架（通过附件校验 + 日期校验）
function baseBody(overrides) {
  return Object.assign({
    actual_paid_amount: 0,
    actual_paid_date: '2026-01-15',
    attachment: 'voucher.pdf'
  }, overrides || {});
}

// 构造一个付款申请（仅携带 payable_amount 即可驱动 finalPaymentApprovalInput）
function payment(payableAmount) {
  return { id: 'pr_' + Math.random().toString(36).slice(2, 8), payable_amount: payableAmount };
}

before(() => {
  // 为 settlement log 一致性测试建表（仅 integration 用例使用）
  db.initDatabase();
});

describe('部分付款 vs 尾差抹零 — 核心判断（finalPaymentApprovalInput）', () => {

  test('案例1（允许）：应付 57435.71，付款 57435，抹零 0.71 → 尾差结清，不拦截', () => {
    const r = finalPaymentApprovalInput(
      payment(57435.71),
      baseBody({ actual_paid_amount: 57435, rounding_amount: 0.71 })
    );
    assert.equal(r.isPartialPayment, false, '尾差抹零不应被判为部分付款');
    assert.equal(r.applyRoundOff, true, '应应用抹零（尾差结清）');
    assert.ok(Math.abs(r.roundingAmount - 0.71) < 0.005, '抹零金额应为 0.71');
  });

  test('案例2（禁止=真实部分付款）：应付 57435.71，付款 30000，抹零 0 → 仍属部分付款', () => {
    const r = finalPaymentApprovalInput(
      payment(57435.71),
      baseBody({ actual_paid_amount: 30000, rounding_amount: 0 })
    );
    assert.equal(r.isPartialPayment, true, '实际付款+抹零 仍小于应付，应判为部分付款');
    assert.equal(r.applyRoundOff, false, '真实部分付款不应用抹零');
    assert.equal(r.roundingAmount, 0);
  });

  test('案例3（允许）：应付 1000.50，付款 1000，抹零 0.50 → 尾差结清', () => {
    const r = finalPaymentApprovalInput(
      payment(1000.50),
      baseBody({ actual_paid_amount: 1000, rounding_amount: 0.50 })
    );
    assert.equal(r.isPartialPayment, false, '尾差抹零不应被判为部分付款');
    assert.equal(r.applyRoundOff, true);
    assert.ok(Math.abs(r.roundingAmount - 0.50) < 0.005);
  });

  test('案例4（部分付款）：应付 1000.50，付款 999，抹零 0 → 部分付款', () => {
    const r = finalPaymentApprovalInput(
      payment(1000.50),
      baseBody({ actual_paid_amount: 999, rounding_amount: 0 })
    );
    assert.equal(r.isPartialPayment, true, '实际付款+抹零 仍小于应付，应判为部分付款');
    assert.equal(r.applyRoundOff, false);
    assert.equal(r.roundingAmount, 0);
  });

  test('回归：抹零金额必须等于 应付−实际付款，否则拦截', () => {
    assert.throws(
      () => finalPaymentApprovalInput(
        payment(57435.71),
        baseBody({ actual_paid_amount: 57435, rounding_amount: 0.70 })
      ),
      /抹零金额必须等于申请金额减实际付款金额/
    );
  });

  test('回归：仅支持小数尾差抹零（实际付款须为应付向下取整），滥用抹零拦截', () => {
    // 应付 57435.71，实际付款 57400（非 floor），抹零 35.71：明显非尾差，应拦截
    assert.throws(
      () => finalPaymentApprovalInput(
        payment(57435.71),
        baseBody({ actual_paid_amount: 57400, rounding_amount: 35.71 })
      ),
      /现有付款核心仅支持小数尾差抹零/
    );
  });

  test('案例5（拒绝）：应付 57435.71，付款 0，抹零 57435.71 → 抹零不能当作付款抵扣', () => {
    // 实际付款 0 本身无效（必须 >0），且抹零 57435.71 远超小额尾差上限，双重拦截；
    // 无论命中哪条，结果都必须是「拒绝提交」
    assert.throws(
      () => finalPaymentApprovalInput(
        payment(57435.71),
        baseBody({ actual_paid_amount: 0, rounding_amount: 57435.71 })
      ),
      /最终审批必须填写有效的实际付款金额|小数尾差抹零|小于 1 元/
    );
  });

  test('案例6（拒绝）：应付 1000，付款 900，抹零 100 → 扩大抹零伪装结清应拦截', () => {
    // 抹零金额超过合理尾差（100 元非小数尾差），不能通过 round_off 把部分付款伪装成结清
    assert.throws(
      () => finalPaymentApprovalInput(
        payment(1000),
        baseBody({ actual_paid_amount: 900, rounding_amount: 100 })
      ),
      /小数尾差抹零|小于 1 元/
    );
  });

  test('防御：明确定义的最大抹零阈值 MAX_ROUND_OFF_AMOUNT = 1，超阈值即拦截', () => {
    // 通过 server 模块暴露的常量行为间接验证：任何 >= 1 元的抹零都必须在更早的
    // 「小数尾差」校验被拦截（本用例确保 >=1 元抹零绝不可能通过审批输入）
    for (const [payable, paid, rounding] of [
      [1000, 999, 1],      // 抹零恰好 1 元 → 非小数尾差
      [1000.50, 500, 500.50], // 抹零远超尾差
      [57435.71, 1, 57434.71]  // 抹零几乎等于整笔应付
    ]) {
      assert.throws(
        () => finalPaymentApprovalInput(
          payment(payable),
          baseBody({ actual_paid_amount: paid, rounding_amount: rounding })
        ),
        /小数尾差抹零|小于 1 元/,
        `应付 ${payable} / 付款 ${paid} / 抹零 ${rounding} 应被拦截`
      );
    }
  });

});

describe('统一结算公式 & settlement log 一致性（paymentSettlementFacts）', () => {

  test('案例1 端到端：应付 57435.71 = 付款 57435 + 抹零 0.71 → outstanding=0，round_off 已记录', () => {
    const { run, queryOne } = db;
    run('DELETE FROM payment_settlement_logs');
    run('DELETE FROM payment_transactions');
    run('DELETE FROM payment_requests');

    run(`INSERT INTO payment_requests
           (id, request_no, payable_amount, paid_amount, deduction_amount, rounding_amount, unpaid_amount, approval_status, payment_status, currency)
         VALUES (?, ?, ?, 0, 0, 0, ?, 'approved', 'pending_payment', 'RMB')`,
      ['pr_tail1', 'PR-TAIL1', 57435.71, 57435.71]);

    // 真实付款事实：payment_transactions（reconciled，paid_amount_minor 以分为单位）
    run(`INSERT INTO payment_transactions
           (id, trans_no, payment_request_id, paid_amount_minor, paid_date, trans_status, operator_name, created_at)
         VALUES (?, ?, ?, ?, '2026-01-15', 'reconciled', 'tester', datetime('now'))`,
      ['tx1', 'TX-TAIL1', 'pr_tail1', 5743500]);

    // 尾差抹零事实：settlement log（rounding）
    run(`INSERT INTO payment_settlement_logs
           (id, payment_request_id, event_type, amount, status, reason, original_currency, operator_name, is_legacy, created_at)
         VALUES (?, ?, 'rounding', ?, 'applied', '尾差抹零', 'RMB', 'tester', 0, datetime('now'))`,
      ['log_r1', 'pr_tail1', 0.71]);

    const pr = queryOne('SELECT * FROM payment_requests WHERE id = ?', ['pr_tail1']);
    const facts = paymentSettlementFacts(pr);

    // 统一结算公式：outstanding = 应付 − 实际付款 − 抵扣 − 抹零
    assert.equal(facts.grossPayable, 57435.71, 'gross_amount 应为 57435.71');
    assert.equal(facts.effectivePaid, 57435, 'paid_amount 应为 57435');
    assert.equal(facts.effectiveDeduction, 0, 'deduction 应为 0');
    assert.equal(facts.effectiveRounding, 0.71, 'round_off_amount 应为 0.71');
    assert.ok(Math.abs(facts.outstanding) < 0.005, 'outstanding 应为 0（尾差已结清），实际=' + facts.outstanding);

    // settlement log 确实记录了 round_off_amount
    const rlog = queryOne(
      "SELECT * FROM payment_settlement_logs WHERE payment_request_id=? AND event_type='rounding' AND status='applied'",
      ['pr_tail1']
    );
    assert.ok(rlog, '必须存在 applied 状态的 rounding settlement log');
    assert.ok(Math.abs(Number(rlog.amount) - 0.71) < 0.005, 'round_off_amount 必须记录为 0.71');
  });

  test('状态一致性（重点）：应付 57435.71 = 付款 57435 + 抹零 0.71 → outstanding=0 且 payment_status=paid，无残留 0.71', () => {
    const { run, queryOne } = db;
    run('DELETE FROM payment_settlement_logs');
    run('DELETE FROM payment_transactions');
    run('DELETE FROM payment_requests');

    run(`INSERT INTO payment_requests
           (id, request_no, payable_amount, paid_amount, deduction_amount, rounding_amount, unpaid_amount, approval_status, payment_status, currency)
         VALUES (?, ?, ?, 0, 0, 0, ?, 'approved', 'pending_payment', 'RMB')`,
      ['pr_status1', 'PR-STATUS1', 57435.71, 57435.71]);

    run(`INSERT INTO payment_transactions
           (id, trans_no, payment_request_id, paid_amount_minor, paid_date, trans_status, operator_name, created_at)
         VALUES (?, ?, ?, ?, '2026-01-15', 'reconciled', 'tester', datetime('now'))`,
      ['txs1', 'TX-STATUS1', 'pr_status1', 5743500]);

    run(`INSERT INTO payment_settlement_logs
           (id, payment_request_id, event_type, amount, status, reason, original_currency, operator_name, is_legacy, created_at)
         VALUES (?, ?, 'rounding', ?, 'applied', '尾差抹零', 'RMB', 'tester', 0, datetime('now'))`,
      ['log_rs1', 'pr_status1', 0.71]);

    const pr = queryOne('SELECT * FROM payment_requests WHERE id = ?', ['pr_status1']);
    const facts = paymentSettlementFacts(pr);

    // 统一结算公式（所有付款状态判断的唯一口径）：
    //   outstanding = gross − paid − deduction − round_off
    assert.ok(Math.abs(facts.outstanding) < 0.005, 'outstanding 必须为 0，不能残留 0.71，实际=' + facts.outstanding);

    // 状态推导必须使用上述 unification 的 outstanding，而非 gross − paid
    const status = derivePaymentStatus(pr, facts);
    assert.equal(status, 'paid', '尾差结清后 payment_status 必须为 paid，不能为残留未付款');

    // 反向验证：若用错误公式 gross − paid（漏掉抹零）会得到 0.71 残留 → 必须确认本实现不是这种做法
    const wrongOutstanding = settlementMoneyWrong(facts.grossPayable, facts.effectivePaid);
    assert.ok(wrongOutstanding > 0.70, '对照组：错误口径 gross−paid 会残留 0.71（本实现已修正，仅作反例说明）');
  });

});

// 仅用于「反例说明」：错误口径（漏掉抹零）会残留未付款，本实现已不使用该口径
function settlementMoneyWrong(gross, paid) {
  return Math.max(0, Number(gross) - Number(paid));
}
