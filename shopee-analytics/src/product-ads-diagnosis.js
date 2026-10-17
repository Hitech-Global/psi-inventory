'use strict';

const { normalizePerformance } = require('./metrics');

function productAdDiagnosis({
  performance,
  days,
  targetRoas = 0,
  breakEvenRoas = 0,
  weeklyOrderReference = 25,
  adType,
  itemCount = 0,
}) {
  const p = normalizePerformance(performance || {});
  const safeDays = Math.max(1, Number(days) || 1);
  const weeklyEquivalentOrders = p.broadOrders / safeDays * 7;
  const volumeState = weeklyEquivalentOrders >= weeklyOrderReference ? 'MATURE_VOLUME' : 'LOW_VOLUME';

  let profitabilityState = 'NO_BREAK_EVEN';
  if (breakEvenRoas > 0) {
    profitabilityState = p.broadRoas >= breakEvenRoas ? 'ABOVE_BREAK_EVEN' : 'BELOW_BREAK_EVEN';
  }

  let targetState = 'NO_TARGET';
  if (targetRoas > 0) {
    targetState = p.broadRoas >= targetRoas ? 'MEETS_TARGET' : 'BELOW_TARGET';
  }

  let primarySignal;
  let action;
  if (volumeState === 'LOW_VOLUME') {
    primarySignal = '订单样本不足';
    action = '先稳定设置并积累订单样本，再判断放量或结构调整。';
  } else if (profitabilityState === 'BELOW_BREAK_EVEN') {
    primarySignal = 'ROAS低于保本';
    action = '先保护利润，检查商品承接与流量质量，不扩大预算。';
  } else if (targetState === 'BELOW_TARGET') {
    primarySignal = 'ROAS低于Target';
    action = '先看CTR与CVR定位点击或转化问题，再决定是否调整目标。';
  } else {
    primarySignal = '结构相对稳定';
    action = '保持核心变量稳定，继续观察下一完整周期。';
  }

  return {
    adType,
    itemCount,
    days: safeDays,
    weeklyEquivalentOrders,
    weeklyOrderReference,
    volumeState,
    profitabilityState,
    targetState,
    targetRoas: Number(targetRoas || 0),
    breakEvenRoas: Number(breakEvenRoas || 0),
    primarySignal,
    action,
    performance: p,
  };
}

module.exports = { productAdDiagnosis };
