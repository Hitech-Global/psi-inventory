'use strict';

function normalizeCurrency(value) {
  const currency = String(value || '').trim().toUpperCase();
  return currency === 'CNY' ? 'RMB' : currency;
}

function money(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return NaN;
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

function fail(message) {
  const error = new Error(message);
  error.status = 409;
  throw error;
}

/**
 * Resolve a CI customs-duty cost into the CI goods currency using only the
 * immutable FX snapshots captured on actual payment settlement logs.
 *
 * The cost is deliberately blocked when payment, reversal, deduction, rounding,
 * currency, or FX evidence is ambiguous. Never fall back to today's exchange rate.
 */
function resolveCiCustomsDutyCost({ ciCurrency, dutyCurrency, dutyAmount, payment, paymentFacts }) {
  const targetCurrency = normalizeCurrency(ciCurrency || 'RMB');
  const sourceCurrency = normalizeCurrency(dutyCurrency || (payment && payment.currency));
  const sourceAmount = money(dutyAmount);

  if (!/^[A-Z]{3}$/.test(targetCurrency) || !/^[A-Z]{3}$/.test(sourceCurrency)) {
    fail('CI币种或关税原币种无效，无法确认关税成本');
  }
  if (!Number.isFinite(sourceAmount) || sourceAmount < 0) {
    fail('CI关税金额无效，无法确认关税成本');
  }
  if (!payment) fail('未找到关税付款申请，无法读取实际付款汇率快照');
  if (payment.approval_status !== 'approved' || payment.payment_status !== 'paid') {
    fail('关税付款尚未审批并全部结清，暂不能换算并确认WAC成本');
  }
  if (payment.payment_category !== 'customs_duty' || payment.payment_subcategory !== 'duty') {
    fail('关联付款申请不是当前CI的Import Duty付款申请');
  }
  if (normalizeCurrency(payment.currency) !== sourceCurrency) {
    fail('关税费用币种与付款申请原币种不一致');
  }
  if (Math.abs(money(payment.payable_amount) - sourceAmount) > 0.01) {
    fail('CI关税金额与关税付款申请金额不一致，请先核对原始单据');
  }

  const facts = paymentFacts || {};
  if (!Number.isFinite(Number(facts.outstanding)) || Number(facts.outstanding) > 0.01) {
    fail('关税付款尚有未结金额，不能确认WAC成本');
  }
  if (Number(facts.effectiveDeduction || 0) > 0.01 || Number(facts.effectiveRounding || 0) > 0.01) {
    fail('关税付款存在抵扣或抹零，需先核对净额成本口径后才能确认WAC');
  }
  if (facts.hasReversal) fail('关税付款存在冲销记录，请先核对有效付款记录');
  const payments = Array.isArray(facts.activePayments) ? facts.activePayments : [];
  if (!payments.length) fail('关税付款缺少有效的实际付款记录');

  const paidOriginalTotal = money(payments.reduce((sum, log) => sum + Number(log.amount || 0), 0));
  const effectivePaid = money(facts.effectivePaid);
  if (!Number.isFinite(paidOriginalTotal) || !Number.isFinite(effectivePaid) ||
      Math.abs(paidOriginalTotal - sourceAmount) > 0.01 ||
      Math.abs(effectivePaid - sourceAmount) > 0.01) {
    fail('关税实际付款金额与CI关税金额不一致，不能确认WAC成本');
  }

  if (targetCurrency === sourceCurrency) {
    return {
      amount: sourceAmount,
      currency: targetCurrency,
      original_amount: sourceAmount,
      original_currency: sourceCurrency,
      conversion_source: 'same_currency',
      payment_request_id: payment.id,
      fx: []
    };
  }

  // RMB is the standard WAC currency for RMB-denominated CI goods. For other
  // CI currencies, only the destination-country local-currency snapshot is
  // admissible; arbitrary live / historical rate lookups are never used.
  const snapshotPrefix = targetCurrency === 'RMB' ? 'rmb' : 'local';
  const fx = [];
  let convertedTotal = 0;

  payments.forEach((log) => {
    const paidDate = String(log.paid_date || '').slice(0, 10);
    const original = normalizeCurrency(log.original_currency);
    const snapshotCurrency = normalizeCurrency(log[snapshotPrefix + '_currency'] || (snapshotPrefix === 'rmb' ? 'RMB' : ''));
    const rate = Number(log[snapshotPrefix + '_rate']);
    const rateDate = String(log[snapshotPrefix + '_rate_date'] || '').slice(0, 10);
    const rateType = String(log[snapshotPrefix + '_rate_type'] || '');
    const convertedAmount = Number(log[snapshotPrefix + '_amount']);

    if (original !== sourceCurrency) fail('关税实际付款记录的原币种与关税费用币种不一致');
    if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(paidDate) || rateDate !== paidDate) {
      fail('关税付款记录缺少实际付款日锁定的目标币种汇率');
    }
    if (snapshotCurrency !== targetCurrency) {
      fail('关税付款记录没有锁定 ' + targetCurrency + ' 汇率快照');
    }
    if (!Number.isFinite(rate) || rate <= 0 || !Number.isFinite(convertedAmount) || convertedAmount < 0) {
      fail('关税付款记录的锁定汇率或折算金额无效');
    }
    if (rateType !== 'realtime') fail('关税付款记录不是实际付款日的realtime汇率快照');
    if (Math.abs(Number(log.amount) * rate - convertedAmount) > 0.02) {
      fail('关税付款折算金额与付款日锁定汇率快照不一致');
    }

    convertedTotal += convertedAmount;
    fx.push({
      paid_date: paidDate,
      from_currency: sourceCurrency,
      to_currency: targetCurrency,
      rate,
      rate_date: rateDate,
      rate_type: rateType,
      direction: String(log[snapshotPrefix + '_rate_direction'] || ''),
      original_amount: Number(log.amount),
      converted_amount: money(convertedAmount)
    });
  });

  return {
    amount: money(convertedTotal),
    currency: targetCurrency,
    original_amount: sourceAmount,
    original_currency: sourceCurrency,
    conversion_source: 'locked_payment_settlement_snapshot',
    payment_request_id: payment.id,
    fx
  };
}

module.exports = { resolveCiCustomsDutyCost, normalizeCurrency };
