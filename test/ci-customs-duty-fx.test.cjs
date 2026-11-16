'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { resolveCiCustomsDutyCost } = require('../ci-customs-duty-fx');

function makeInput(overrides = {}) {
  const amount = 39758219;
  const log = {
    id: 'settle-1',
    amount,
    original_currency: 'IDR',
    paid_date: '2026-11-16',
    rmb_rate: 0.00044,
    rmb_rate_date: '2026-11-16',
    rmb_rate_type: 'realtime',
    rmb_rate_direction: 'direct',
    rmb_amount: 17493.62
  };
  return {
    ciCurrency: 'RMB',
    dutyCurrency: 'IDR',
    dutyAmount: amount,
    payment: {
      id: 'pay-duty-1',
      payment_category: 'customs_duty',
      payment_subcategory: 'duty',
      currency: 'IDR',
      payable_amount: amount,
      approval_status: 'approved',
      payment_status: 'paid'
    },
    paymentFacts: {
      outstanding: 0,
      effectivePaid: amount,
      effectiveDeduction: 0,
      effectiveRounding: 0,
      hasReversal: false,
      activePayments: [log]
    },
    ...overrides
  };
}

test('converts IDR customs duty to RMB using the immutable FX snapshot from the actual payment date', () => {
  const result = resolveCiCustomsDutyCost(makeInput());
  assert.equal(result.amount, 17493.62);
  assert.equal(result.currency, 'RMB');
  assert.equal(result.original_amount, 39758219);
  assert.equal(result.original_currency, 'IDR');
  assert.equal(result.conversion_source, 'locked_payment_settlement_snapshot');
  assert.equal(result.fx[0].paid_date, '2026-11-16');
  assert.equal(result.fx[0].rate_date, '2026-11-16');
  assert.equal(result.fx[0].rate, 0.00044);
});

test('sums multiple payments using each payment event own locked rate snapshot', () => {
  const input = makeInput();
  const firstAmount = 20000000;
  const secondAmount = 19758219;
  const round = value => Math.round((value + Number.EPSILON) * 100) / 100;
  input.paymentFacts.activePayments = [
    {
      amount: firstAmount, original_currency: 'IDR', paid_date: '2026-11-14',
      rmb_rate: 0.00044, rmb_rate_date: '2026-11-14', rmb_rate_type: 'realtime',
      rmb_rate_direction: 'direct', rmb_amount: round(firstAmount * 0.00044)
    },
    {
      amount: secondAmount, original_currency: 'IDR', paid_date: '2026-11-16',
      rmb_rate: 0.00045, rmb_rate_date: '2026-11-16', rmb_rate_type: 'realtime',
      rmb_rate_direction: 'direct', rmb_amount: round(secondAmount * 0.00045)
    }
  ];
  const result = resolveCiCustomsDutyCost(input);
  assert.equal(result.amount, round(round(firstAmount * 0.00044) + round(secondAmount * 0.00045)));
  assert.deepEqual(result.fx.map(row => row.rate_date), ['2026-11-14', '2026-11-16']);
});

test('rejects an unpaid or unapproved customs duty payment', () => {
  const input = makeInput({ payment: { ...makeInput().payment, payment_status: 'partial_paid' } });
  assert.throws(() => resolveCiCustomsDutyCost(input), /尚未审批并全部结清/);
});

test('rejects a missing or non-payment-date FX snapshot', () => {
  const input = makeInput();
  input.paymentFacts.activePayments[0].rmb_rate_date = '2026-11-15';
  assert.throws(() => resolveCiCustomsDutyCost(input), /实际付款日锁定/);
});

test('rejects a rate snapshot whose converted amount does not reconcile', () => {
  const input = makeInput();
  input.paymentFacts.activePayments[0].rmb_amount = 17000;
  assert.throws(() => resolveCiCustomsDutyCost(input), /折算金额与付款日锁定汇率快照不一致/);
});

test('rejects CI duty and payment request amount mismatches', () => {
  const input = makeInput({ dutyAmount: 39758218 });
  assert.throws(() => resolveCiCustomsDutyCost(input), /CI关税金额与关税付款申请金额不一致/);
});

test('rejects deduction, rounding, and reversed payment facts rather than guessing a net cost', () => {
  const deduction = makeInput();
  deduction.paymentFacts.effectiveDeduction = 100;
  assert.throws(() => resolveCiCustomsDutyCost(deduction), /存在抵扣或抹零/);

  const rounding = makeInput();
  rounding.paymentFacts.effectiveRounding = 1;
  assert.throws(() => resolveCiCustomsDutyCost(rounding), /存在抵扣或抹零/);

  const reversed = makeInput();
  reversed.paymentFacts.hasReversal = true;
  assert.throws(() => resolveCiCustomsDutyCost(reversed), /存在冲销记录/);
});

test('uses the source amount unchanged when CI goods and duty share the same currency', () => {
  const input = makeInput({
    ciCurrency: 'IDR',
    payment: { ...makeInput().payment, currency: 'IDR' }
  });
  const result = resolveCiCustomsDutyCost(input);
  assert.equal(result.amount, 39758219);
  assert.equal(result.currency, 'IDR');
  assert.equal(result.conversion_source, 'same_currency');
  assert.deepEqual(result.fx, []);
});

test('uses the locked local-currency snapshot when CI goods currency matches the expense country currency', () => {
  const input = makeInput({ ciCurrency: 'IDR', dutyCurrency: 'USD' });
  input.payment.currency = 'USD';
  input.payment.payable_amount = 100;
  input.dutyAmount = 100;
  input.paymentFacts.effectivePaid = 100;
  input.paymentFacts.activePayments = [{
    amount: 100, original_currency: 'USD', paid_date: '2026-11-16',
    local_currency: 'IDR', local_rate: 16000, local_rate_date: '2026-11-16',
    local_rate_type: 'realtime', local_rate_direction: 'direct', local_amount: 1600000
  }];
  const result = resolveCiCustomsDutyCost(input);
  assert.equal(result.amount, 1600000);
  assert.equal(result.currency, 'IDR');
  assert.equal(result.fx[0].to_currency, 'IDR');
});

test('does not fall back to a live rate when the CI currency has no locked snapshot', () => {
  const input = makeInput({ ciCurrency: 'USD' });
  assert.throws(() => resolveCiCustomsDutyCost(input), /没有锁定 USD 汇率快照/);
});

test('WAC allocation consumes the converted duty amount and retains conversion evidence', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(server, /dutyCost = resolveCiCustomsDutyCost/);
  assert.match(server, /total: inputs\.dutyTotal,[\s\S]{0,120}currency: inputs\.dutyCurrency/);
  assert.match(server, /duty_conversion: inputs\.dutyConversion/);
});
