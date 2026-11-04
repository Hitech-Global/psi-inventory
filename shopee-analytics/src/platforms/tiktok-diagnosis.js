'use strict';

/**
 * TikTok 店铺诊断编排。
 * ============================================================================================
 * 目的：把 TikTok 的已落库事实变成一份可执行的诊断结论。
 *
 * 与 Shopee 诊断的关键差别
 * ------------------------
 * Shopee 的诊断有 direct/broad 两条线，可以回答「广告带来的订单够不够」「流量结构
 * 稳不稳」「这个投放成熟了吗」。TikTok 侧拆不出 direct —— 订单对象里没有流量来源字段。
 *
 * 所以本模块**不套用** Shopee 的规则集，而是按 TikTok 实际有的数据回答实际能回答的问题：
 *   - 钱够不够赚（结算净收益、结算净 ROAS —— 不受归因口径影响，最硬的一个数）
 *   - 广告到底带来多少增量（增量 GMV、增量 ROAS）
 *   - 投放强度是否合理（花费占 GMV 比例）
 *   - 生意本身的样子（订单量、销量、客单价、退款率、取消率）
 *
 * 拿不到的结论（流量结构、成熟度分档、直接归因 ROAS）会**明确列在 unavailable 里**，
 * 附上原因 —— 而不是悄悄省略，更不会编一个数出来。
 *
 * ★ 每条结论都标了 kind：
 *   data-fact      数据事实。可追到具体口径与数字。
 *   ai-suggestion  AI 推测建议。基于事实的判断。
 * 这正是项目约束要求的「区分【数据事实】和【AI推测建议】」。
 */

const {
  ATTRIBUTION_BASES,
  PLATFORMS,
} = require('../platform-model');
const {
  buildAnalysis,
  hasValue,
} = require('./tiktok-analysis-adapter');

/** 严重度的排序权重 —— 越严重的越靠前。 */
const SEVERITY_RANK = Object.freeze({
  critical: 0,
  warning: 1,
  info: 2,
  good: 3,
  neutral: 4,
});

/**
 * 构造一条信号。
 *
 * 沿用 Shopee 侧 portfolio-diagnosis 的形状（code/severity/title/detail/action），
 * 这样前端与报告模板能用同一套渲染逻辑处理两个平台的诊断结果。
 *
 * @param {string} code
 * @param {string} severity
 * @param {string} title
 * @param {string} detail 数据事实
 * @param {string|null} action 落地动作
 * @param {string} kind data-fact | ai-suggestion
 * @returns {object}
 */
function signal(code, severity, title, detail, action = null, kind = 'data-fact') {
  return { code, severity, title, detail, action, kind };
}

/**
 * 对单个 TikTok 店铺做诊断。
 *
 * @param {object} options
 * @param {Array<object>} options.rows 该店铺的日粒度事实行
 * @param {object} [options.thresholds] 阈值
 * @param {string} [options.shopId]
 * @param {string} [options.shopName]
 * @returns {object} 诊断结果
 */
function diagnoseTikTokShop({ rows = [], thresholds = {}, shopId = null, shopName = null } = {}) {
  const analysis = buildAnalysis({ rows, thresholds });
  const signals = [];

  const orderLevel = analysis.metricsByBasis[ATTRIBUTION_BASES.ORDER_LEVEL];
  const platformAttributed = analysis.metricsByBasis[ATTRIBUTION_BASES.PLATFORM_ATTRIBUTED];
  const derivedNet = analysis.metricsByBasis[ATTRIBUTION_BASES.DERIVED_NET];
  const derivedIncremental = analysis.metricsByBasis[ATTRIBUTION_BASES.DERIVED_INCREMENTAL];

  // ---- 数据完全缺失 ----
  if (!analysis.facts || Object.keys(analysis.facts).length === 0) {
    signals.push(signal(
      'TIKTOK_NO_DATA',
      'neutral',
      '还没有可诊断的数据',
      '这个区间内没有任何口径的记录，诊断无法进行。',
      '先在「平台接入」里完成 TikTok 店铺授权，再触发一次数据同步；确认有数据后再回来看诊断。',
      'ai-suggestion',
    ));
    return finalize({ analysis, signals, shopId, shopName, rows });
  }

  // ---- 订单口径：生意本身的样子 ----
  if (orderLevel && hasValue(orderLevel.orders.value)) {
    const orders = orderLevel.orders.value;
    const gmv = orderLevel.gmvOrderTotal.value;
    const units = orderLevel.units.value;
    const aov = orderLevel.aov.value;
    signals.push(signal(
      'TIKTOK_ORDER_FACTS',
      'info',
      '订单实付口径',
      `订单 ${formatNumber(orders)} 笔，销量 ${formatNumber(units)} 件，`
      + `订单实付 ${formatNumber(gmv)}${orderLevel.gmvOrderTotal.unit ? '' : ''}`
      + `${aov !== null ? `，客单价 ${formatNumber(aov)}` : ''}。`
      + '这些数字来自订单本身，不含任何广告归因，因此不受投放归因方式影响。',
      null,
      'data-fact',
    ));
  }

  // ---- 结算净收益：最硬的一个数 ----
  if (derivedNet && hasValue(derivedNet.netProceeds.value)) {
    const net = derivedNet.netProceeds.value;
    const settled = derivedNet.gmvSettled.value;
    signals.push(signal(
      'TIKTOK_SETTLED_NET',
      net > 0 ? 'good' : 'critical',
      '结算净收益',
      `结算收入 ${formatNumber(settled)}，扣掉佣金、物流与退款后净收益 ${formatNumber(net)}。`
      + '结算是卖家实际到手的钱，不受平台归因口径影响，是判断店铺是否真的赚钱最可靠的依据。',
      net > 0
        ? '把这个净收益作为基线，反推广告需要达到的 ROAS 门槛。'
        : '净收益为负或为零，说明当前卖出的每单都在亏钱。先查成本结构（定价、佣金、物流），再谈投放。',
      'data-fact',
    ));
  }

  // ---- 结算净 ROAS：广告有没有真的赚钱 ----
  if (derivedNet && hasValue(derivedNet.settledNetRoas.value)) {
    const roas = derivedNet.settledNetRoas.value;
    const limit = Number(thresholds.settledNetRoasLimit ?? 1);
    signals.push(signal(
      'TIKTOK_SETTLED_NET_ROAS',
      roas < limit ? 'critical' : roas < limit * 1.5 ? 'warning' : 'good',
      '结算净 ROAS',
      `每投入 1 元广告费，结算后净收益 ${roas.toFixed(2)} 元。`
      + `分子分母同源（结算口径 ÷ 纯付费花费），口径成立。`,
      roas < limit
        ? `结算净 ROAS 低于 ${limit}，当前投放不赚钱。建议先停掉最差的广告组，把预算集中到结算净 ROAS 为正的那部分。`
        : roas < limit * 1.5
          ? '结算净 ROAS 刚过盈亏线，容错空间小。建议设一条 ROAS 底线，低于就自动降预算。'
          : '结算净 ROAS 健康。注意这个数比平台面板上的 ROI 更保守也更真实 —— 平台归因会把自然流量算进去。',
      'ai-suggestion',
    ));
  }

  // ---- 增量 ROAS：广告的真实贡献 ----
  if (derivedIncremental && hasValue(derivedIncremental.incrementalRoas.value)) {
    const roas = derivedIncremental.incrementalRoas.value;
    signals.push(signal(
      'TIKTOK_INCREMENTAL_ROAS',
      roas < 1 ? 'warning' : 'good',
      '增量 ROAS',
      `每投入 1 元广告费，带来了 ${roas.toFixed(2)} 元的增量 GMV。`
      + '增量 = 平台归因 GMV − 自然基线 GMV，扣掉了本来就会成交的那部分。',
      roas < 1
        ? '增量低于花费，说明大部分成交是自然流量，广告在抢本就会有的生意。建议缩窄定向。'
        : '增量为正且超过花费，投放确实带来了额外成交，可以考虑在 ROI 达标的方向上加预算。',
      'ai-suggestion',
    ));
  } else if (platformAttributed && hasValue(platformAttributed.gmvOrderTotal.value)) {
    // 有平台归因但没有增量 —— 说明自然基线还没采集。
    signals.push(signal(
      'TIKTOK_INCREMENTAL_BASELINE_MISSING',
      'neutral',
      '增量口径还拿不到',
      '有平台归因的 GMV，但缺少自然基线，因此算不出增量 GMV 与增量 ROAS。'
      + '平台归因口径把付费与自然流量合并，直接用它除以花费会高估广告的效果。',
      '补一次自然基线采集后再看增量结论。在此之前，不要用平台面板的 ROI 判断投放是否划算。',
      'ai-suggestion',
    ));
  }

  // ---- 投放强度 ----
  if (platformAttributed && hasValue(platformAttributed.spendRatio.value)) {
    const ratio = platformAttributed.spendRatio.value;
    const limit = Number(thresholds.adSpendRatioLimit ?? 0.15);
    signals.push(signal(
      'TIKTOK_SPEND_RATIO',
      ratio > limit ? 'warning' : 'good',
      '花费占 GMV 比例',
      `花费占平台归因 GMV 的 ${(ratio * 100).toFixed(1)}%。`
      + '这个 GMV 含自然流量，所以它反映的是投放强度，而不是广告效率。',
      ratio > limit
        ? `占比高于 ${(limit * 100).toFixed(0)}% 的警戒线。建议收窄到已验证的商品与人群，把预算从泛投放转到明确能出单的组合上。`
        : '投放强度在合理范围。',
      'data-fact',
    ));
  }

  // ---- 退款与取消 ----
  if (orderLevel && hasValue(orderLevel.refundRate.value) && orderLevel.refundRate.value > 0) {
    const rate = orderLevel.refundRate.value;
    signals.push(signal(
      'TIKTOK_REFUND_RATE',
      rate > 0.05 ? 'warning' : 'info',
      '退款率',
      `退款占结算收入（或订单实付）的 ${(rate * 100).toFixed(1)}%。`
      + '退款会直接吃掉结算净收益，所以它比 GMV 增长更能说明问题。',
      rate > 0.05
        ? '退款率偏高，优先查商品详情与质量描述 —— 这类退款会同时拉低结算净收益和店铺评分。'
        : null,
      'data-fact',
    ));
  }

  if (orderLevel && hasValue(orderLevel.cancellationRate.value) && orderLevel.cancellationRate.value > 0.03) {
    const rate = orderLevel.cancellationRate.value;
    signals.push(signal(
      'TIKTOK_CANCELLATION_RATE',
      rate > 0.05 ? 'warning' : 'info',
      '取消率',
      `取消占订单数的 ${(rate * 100).toFixed(1)}%。`,
      rate > 0.05
        ? '取消率偏高，通常是库存或发货时效问题。取消的订单不会产生结算收入，但已经消耗了广告费。'
        : null,
      'data-fact',
    ));
  }

  return finalize({ analysis, signals, shopId, shopName, rows });
}

/**
 * 组装最终结果。
 *
 * @param {object} options
 * @returns {object}
 */
function finalize({ analysis, signals, shopId, shopName, rows }) {
  const sorted = signals.slice().sort((a, b) =>
    (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9));
  const dayCount = new Set(rows.map(row => String(row.eventDate || row.event_date || ''))).size;
  return {
    platform: PLATFORMS.TIKTOK,
    shopId,
    shopName,
    dayCount,
    facts: analysis.facts,
    signals: sorted,
    unavailable: analysis.unavailable,
    capabilities: analysis.capabilities,
  };
}

/**
 * 把数字格式化成便于阅读的样子。
 *
 * @param {number|null} value
 * @returns {string}
 */
function formatNumber(value) {
  if (!hasValue(value)) return '—';
  return Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
}

module.exports = {
  SEVERITY_RANK,
  diagnoseTikTokShop,
  formatNumber,
  signal,
};
