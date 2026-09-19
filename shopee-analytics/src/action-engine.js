'use strict';

function itemAction(state, context = {}) {
  switch (state) {
    case 'CORE_CANDIDATE':
      return context.lowVolumeAndEfficient
        ? {
            code: 'CORE_VOUCHER_TEST',
            title: '主力 SKU 做 3 天短券验证',
            action: '只给主力链接短期优惠，副链接/探索链接不跟券；目标是验证 CVR 提升后能否带来更多有效订单。',
          }
        : {
            code: 'PROTECT_CORE',
            title: '保护主力 SKU',
            action: '维持结构与价格变量稳定，继续观察其订单、Direct ROAS 与预算承接。',
          };
    case 'EXPLORATION_KEEP':
      return {
        code: 'KEEP_EXPLORATION',
        title: '保留少量探索',
        action: '保持低 Spend Share 探索，不与主力 SKU 同步加券，避免稀释主力转化信号。',
      };
    case 'INSUFFICIENT_EXPLORATION':
      return {
        code: 'WAIT_FOR_SAMPLE',
        title: '样本不足，暂不剔除',
        action: '继续小额探索，未达到足够测试成本前不要把零订单直接判成商品失败。',
      };
    case 'HIGH_RISK_ZERO_ORDER':
      return {
        code: 'REMOVE_ZERO_ORDER_BURN',
        title: '高风险空烧，进入剔除候选',
        action: '已消耗较充分测试成本仍无订单；优先从组内移除，预算集中给已验证 SKU。',
      };
    case 'PRODUCT_OPTIMIZATION_CANDIDATE':
      return {
        code: 'PRODUCT_TEST_FIRST',
        title: '先解决商品层问题',
        action: '优先验证价格、优惠、主图/卖点与详情承接；当前不建议因为 CVR 弱就直接拆成单品广告。',
      };
    case 'ZERO_ORDER_STILL_TESTING':
      return {
        code: 'CONTINUE_CONTROLLED_TEST',
        title: '继续受控测试',
        action: '当前已开始消耗但尚未达到高风险阈值，保持小额探索并避免同时改多个变量。',
      };
    default:
      return {
        code: 'OBSERVE',
        title: '继续观察',
        action: '数据不足以做结构性动作，保持单变量测试并等待更完整样本。',
      };
  }
}

function campaignActions({ campaign, items = [] }) {
  const actions = [];
  const efficient = campaign.roasState === 'TARGET_MET' &&
    campaign.spendLimitState === 'WITHIN_SPEND_LIMIT';
  const lowVolume = campaign.volumeState === 'LOW_VOLUME_SIGNAL';
  const hasCore = items.some(item => item.state === 'CORE_CANDIDATE');
  const weakCount = items.filter(item =>
    item.state === 'HIGH_RISK_ZERO_ORDER' ||
    item.state === 'PRODUCT_OPTIMIZATION_CANDIDATE'
  ).length;

  if (campaign.roasState === 'BELOW_BREAK_EVEN' || campaign.spendLimitState === 'OVER_SPEND_LIMIT') {
    actions.push({
      priority: 1,
      code: 'PROTECT_PROFIT',
      title: '先保护利润，不放量',
      reason: campaign.spendLimitState === 'OVER_SPEND_LIMIT'
        ? '广告花费占比超过经营硬约束。'
        : '广告 ROAS 低于保本线。',
      action: '暂停新增预算；先处理弱 SKU、商品转化和 Target ROAS，再重新跑完整周期。',
    });
  }

  if (weakCount > 0) {
    actions.push({
      priority: 2,
      code: 'CONCENTRATE_BUDGET',
      title: '清理弱 SKU，集中预算信号',
      reason: `当前有 ${weakCount} 个 SKU 进入空烧/商品优化候选。`,
      action: '保留主力与低占比但能出单的探索 SKU；高风险零订单 SKU 优先移除，商品问题 SKU 先做商品层测试。',
    });
  }

  if (lowVolume && efficient && hasCore) {
    actions.push({
      priority: 3,
      code: 'THREE_DAY_CORE_VOUCHER',
      title: '用 3 天短券测试主力 CVR',
      reason: '广告效率达标但周订单参考量不足，且已经出现主力候选。',
      action: '只给主力链接优惠，探索链接不跟券；第 3 天检查日均订单/CVR，第 7 天再看整个广告组是否形成稳定提升。',
    });
  } else if (lowVolume && !efficient) {
    actions.push({
      priority: 3,
      code: 'FIX_EFFICIENCY_BEFORE_VOLUME',
      title: '先修效率，再追订单量',
      reason: '订单量不足，同时 ROAS/广告花费约束尚未达标。',
      action: '先解决商品转化和 SKU 结构，不通过降 Target ROAS 或加预算强行买量。',
    });
  }

  if (!lowVolume && efficient) {
    actions.push({
      priority: 4,
      code: 'HOLD_AND_SCALE_TEST',
      title: '进入稳定/放量验证',
      reason: '周订单参考量与广告效率同时满足。',
      action: '先保持结构跑完整周期；若预算持续跑满且广告花费占比仍≤硬约束，再做小幅单变量预算测试。',
    });
  }

  return actions.sort((a, b) => a.priority - b.priority);
}

module.exports = { itemAction, campaignActions };
