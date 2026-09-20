'use strict';

function itemAction(state, context = {}) {
  switch (state) {
    case 'CORE_CANDIDATE':
      if (context.scaleEligible) {
        return {
          code: 'CONTROLLED_SINGLE_ITEM_SCALE',
          title: '已具备受控放大资格',
          action: '该 SKU 已达到内部 A 阶段、高 Confidence 且广告组稳定；只做小幅单变量预算/单品广告验证，并继续监控 Direct CVR、Direct ROAS 与广告花费占比。',
        };
      }
      if (context.maturityStatus === 'LEARNING' || context.maturityStatus === 'CONVERGING' || context.confidence !== 'HIGH') {
        return {
          code: 'PROTECT_CORE_SIGNAL',
          title: '保护主力信号，暂不裂变',
          action: '当前只是主力候选，尚未满足稳定放大证据；保持结构稳定，继续累计 Direct Orders 与连续表现，不因单日高 ROAS 或高花费占比单独拿出。',
        };
      }
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

function structuralActionGates({ campaign, items = [] }) {
  const maturity = campaign.maturityStatus || (campaign.maturity && campaign.maturity.status) || 'UNKNOWN';
  const stable = maturity === 'STABLE';
  const profitable = campaign.roasState !== 'BELOW_BREAK_EVEN' && campaign.spendLimitState !== 'OVER_SPEND_LIMIT';
  const targetMet = campaign.roasState === 'TARGET_MET';
  const budgetUtilization = campaign.budgetUtilization;
  const highRiskZero = items.filter(item => item.state === 'HIGH_RISK_ZERO_ORDER');
  const scalable = items.filter(item => item.scaleEligibility && item.scaleEligibility.eligible);
  const gates = {
    REMOVE_SKU: {
      allowed: maturity !== 'LEARNING' && highRiskZero.length > 0,
      reason: maturity === 'LEARNING'
        ? '学习期默认不做永久性剔除；先完成最低观察窗口。'
        : highRiskZero.length ? '存在已达到高风险测试成本且零订单的 SKU。' : '没有达到高风险空烧证据的 SKU。',
    },
    SPLIT_SINGLE_ITEM: {
      allowed: stable && scalable.length > 0,
      reason: stable && scalable.length > 0
        ? '广告组已稳定且存在通过 A阶段/High Confidence/利润门槛的 SKU。'
        : '仅在广告组稳定且 SKU 通过放大资格 Gate 后才允许裂变单跑。',
    },
    LOWER_TARGET_ROAS: {
      allowed: stable && profitable && targetMet && budgetUtilization != null && budgetUtilization < 0.8,
      reason: !stable ? '广告组尚未稳定，避免用降 Target ROAS 干扰收敛。'
        : !profitable ? '利润/广告花费占比约束未通过，不能用降 ROAS 换量。'
        : !targetMet ? '实际 ROAS 尚未达到当前 Target ROAS。'
        : budgetUtilization == null ? '缺少预算利用率，无法判断是否存在花不完预算。'
        : budgetUtilization >= 0.8 ? '预算利用率并不低，暂不存在明确的降 ROAS 放量前提。'
        : '稳定且效率达标，但预算利用率偏低，可做小幅单变量 Target ROAS 测试。',
    },
    INCREASE_BUDGET: {
      allowed: stable && profitable && scalable.length > 0 && budgetUtilization != null && budgetUtilization >= 0.9,
      reason: !stable ? '广告组尚未稳定，暂不加预算。'
        : !profitable ? '利润/广告花费占比约束未通过，暂不加预算。'
        : !scalable.length ? '没有 SKU 通过受控放大资格。'
        : budgetUtilization == null ? '缺少预算利用率，无法证明预算正在成为瓶颈。'
        : budgetUtilization < 0.9 ? '预算尚未持续接近跑满，不优先加预算。'
        : '稳定、利润约束通过、存在可放大 SKU 且预算接近跑满，可小幅单变量加预算。',
    },
    DISABLE_RAPID_BOOST: {
      allowed: maturity === 'UNSTABLE' || items.some(item => item.state === 'HIGH_RISK_ZERO_ORDER'),
      reason: maturity === 'UNSTABLE'
        ? '长期未稳定，优先收缩探索变量并检查 Rapid Boost。'
        : items.some(item => item.state === 'HIGH_RISK_ZERO_ORDER')
          ? '存在高风险空烧 SKU，优先减少低置信探索。'
          : '当前没有足够证据仅凭短期波动关闭 Rapid Boost。',
    },
  };
  return gates;
}

function campaignActions({ campaign, items = [] }) {
  const actions = [];
  const efficient = campaign.roasState === 'TARGET_MET' &&
    campaign.spendLimitState === 'WITHIN_SPEND_LIMIT';
  const lowVolume = campaign.volumeState === 'LOW_VOLUME_SIGNAL';
  const hasCore = items.some(item => item.state === 'CORE_CANDIDATE');
  const maturityStatus = campaign.maturityStatus || (campaign.maturity && campaign.maturity.status) || 'UNKNOWN';
  const gates = structuralActionGates({ campaign, items });
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

  if (maturityStatus === 'LEARNING' || maturityStatus === 'CONVERGING') {
    actions.push({
      priority: 4,
      code: 'WAIT_FOR_CONVERGENCE',
      title: maturityStatus === 'LEARNING' ? '学习期保持变量稳定' : '继续收敛观察',
      reason: maturityStatus === 'LEARNING'
        ? '仍处于最低学习观察窗口，单日高 ROAS 或单 SKU 高花费不能证明稳定。'
        : '运行时间已达到观察窗口，但订单/分配/CVR/ROAS/扩量证据尚未共同收敛。',
      action: '避免同时修改 Target ROAS、Budget 与商品结构；继续累计 Direct Orders，并观察 SKU 花费占比、CVR、ROAS 与主力订单来源的连续性。',
    });
  }

  if (!lowVolume && efficient && maturityStatus === 'STABLE') {
    actions.push({
      priority: 4,
      code: 'HOLD_AND_SCALE_TEST',
      title: '进入稳定后的放量验证',
      reason: '订单参考量、广告效率与多维稳定性证据同时满足。',
      action: '先保持结构跑完整周期；若预算持续跑满且广告花费占比仍≤硬约束，再做小幅单变量预算测试。',
    });
  }

  const gatedActions = [
    ['REMOVE_SKU', '剔除 SKU'],
    ['SPLIT_SINGLE_ITEM', '裂变单品广告'],
    ['LOWER_TARGET_ROAS', '降低 Target ROAS'],
    ['INCREASE_BUDGET', '增加 Budget'],
    ['DISABLE_RAPID_BOOST', '关闭 Rapid Boost'],
  ].map(([code, title]) => ({ code, title, ...gates[code] }));
  return { recommendations: actions.sort((a, b) => a.priority - b.priority), gates: gatedActions };
}

module.exports = { itemAction, structuralActionGates, campaignActions };
