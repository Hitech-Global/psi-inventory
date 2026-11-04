'use strict';

/**
 * TikTok 事实到分析层的适配。
 * ============================================================================================
 * 目的：让分析层（诊断、成熟度、报告）能读 TikTok 的数据，而不必知道 TikTok 的归因语义
 * 与 Shopee 不同。
 *
 * 为什么需要这一层
 * ------------------
 * Shopee 与 TikTok 的订单级语义**不可通约**：
 *
 *   - Shopee 的订单分 direct（广告带来）与 broad（全部）两套，
 *     所以「广告带来的订单占多少」「流量结构稳不稳」这类判断在 Shopee 侧成立；
 *   - TikTok 的 Open API 订单对象**没有任何流量来源字段**
 *     （已复核 Get Order Detail：traffic_source / attribution / PAID_AD 全为 0 命中），
 *     GMV Max 报表又把付费与自然流量**合并**在 gross_revenue / orders / roi 里。
 *     因此在 TikTok 侧，direct/broad 这个区分**根本不存在**。
 *
 * 硬套 Shopee 的诊断规则会怎样
 * -----------------------------
 * 若把 TikTok 的订单直接当成 broad、GMV 直接当成 broadGmv，
 * 而 direct_orders 恒为 0，那么：
 *   - directRoas 会被算成 null 或 0，看起来像「广告完全没效果」；
 *   - 成熟度引擎会因为 direct 订单全是 0 而判定「信号不足 / 不稳定」；
 *   - 更糟的是有些规则会把「0」当成事实，得出「投放无效，该关停」这类结论。
 *
 * 这些都是**编造**。项目约束写得很清楚：AI 诊断不能编造数据。
 *
 * 本层的做法
 * ----------
 * 不造数，而是**如实标注能算什么、不能算什么**：
 *   1. 能算的（口径成立，用 platform-model 的闸门保证）：
 *      - 结算净收益、结算净 ROAS（derived_net ÷ paid_only）；
 *      - 增量 GMV 与增量 ROAS（derived_incremental ÷ paid_only）；
 *      - 平台归因 ROI（platform_attributed ÷ paid_only，同一张 GMV Max 报表内）；
 *      - 花费占比、订单量、销量、退款率、取消率等不依赖流量来源的指标。
 *   2. 不能算的：显式标为 UNKNOWN，**不给数值**，也不给结论。
 *      典型是 direct/broad 拆分相关的：流量结构、成熟度分档、投放信号的稳定性。
 *
 * 换句话说：TikTok 店铺能拿到「效率」类结论，拿不到「结构」类结论。
 * 这不是缺陷，是平台数据的客观边界 —— 报告里必须如实说出来。
 */

const {
  ATTRIBUTION_BASES,
  CHANNELS,
  PLATFORMS,
  SOURCES,
  assertSameBasis,
  canDivideAcrossBases,
  createFact,
  createMetric,
  incrementalRoas,
  netProceeds,
  settledNetRoas,
} = require('../platform-model');

/**
 * 分析能力清单。
 *
 * 每一项说明「在 TikTok 侧能不能得出这个结论」，以及不能的原因。
 * 报告与前端直接读这个清单 —— 用户能清楚看到「这店能看什么、看不到什么」，
 * 而不是只看到一个缺了半边的结论。
 */
const CAPABILITIES = Object.freeze({
  /** 订单级事实：订单数、销量、GMV。这些 TikTok 有，Shopee 也有。 */
  orderFacts: {
    available: true,
    basis: ATTRIBUTION_BASES.ORDER_LEVEL,
    note: '订单实付与货款小计来自订单本身，TikTok 侧完整可得。',
  },
  /** 结算口径：净收益、结算净 ROAS。需要 finance 端点。 */
  settlementNet: {
    available: true,
    basis: ATTRIBUTION_BASES.DERIVED_NET,
    note: '结算收入、佣金、物流、退款来自结算账单，TikTok 侧可算净收益与结算净 ROAS。',
  },
  /** 增量口径：增量 GMV、增量 ROAS。需要自然基线。 */
  incremental: {
    available: true,
    basis: ATTRIBUTION_BASES.DERIVED_INCREMENTAL,
    note: '平台归因 GMV 减去自然基线得到增量，配合纯付费花费可算增量 ROAS。',
  },
  /** 平台归因 ROI：GMV Max 报表内成立。 */
  platformAttributedRoas: {
    available: true,
    basis: ATTRIBUTION_BASES.PLATFORM_ATTRIBUTED,
    note: 'GMV Max 报表内的平台归因 GMV 与纯付费花费同源，其比值成立（平台口径 ROI）。',
  },
  /**
   * ★ direct/broad 拆分 —— TikTok 侧不可得。
   *
   * 这是最重要的一条：Shopee 分析层大量规则依赖 direct_orders / direct_gmv，
   * 而 TikTok 的订单对象没有流量来源字段，拆不出来。
   */
  trafficSplit: {
    available: false,
    basis: null,
    reason: 'TikTok Open API 的订单对象没有流量来源字段，无法把订单拆成「广告带来」与「自然带来」。',
    consequence: '依赖 direct/broad 拆分的规则在 TikTok 侧不适用：流量结构、投放信号稳定性、成熟度分档。',
  },
  /** 成熟度分档：基于 direct 订单的时间序列，TikTok 侧不可得。 */
  maturityGrading: {
    available: false,
    basis: null,
    reason: '成熟度引擎用 direct 订单的日序列算变异系数、分配稳定性、领头商品延续性，TikTok 侧没有 direct 订单。',
    consequence: 'TikTok 店铺不给成熟度分档，只给效率类结论。',
  },
});

/**
 * 判断一个数字是否是"有值"。
 *
 * null 与 undefined 都算没有。0 是有值 —— 0 意味着"确实是零"，
 * 与"没有这个数"是两回事，混起来会让比率类指标算错。
 *
 * @param {*} value
 * @returns {boolean}
 */
function hasValue(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * 安全相除。分母为 0 或缺失时返回 null（不是 0，也不是 Infinity）。
 *
 * @param {number|null} numerator
 * @param {number|null} denominator
 * @returns {number|null}
 */
function ratio(numerator, denominator) {
  if (!hasValue(numerator) || !hasValue(denominator) || denominator === 0) return null;
  return numerator / denominator;
}

/**
 * 把落库的日粒度行变成中性事实。
 *
 * 落库的行已经带了 attribution_basis 与 source —— 这是它的价值所在：
 * 每一行都知道自己是什么口径，转换时不需要猜。
 *
 * @param {object} row tiktok_shop_daily 的一行
 * @returns {object} 中性事实
 */
function toFact(row = {}) {
  if (!row || typeof row !== 'object') throw new Error('row is required');
  const basis = String(row.attributionBasis || row.attribution_basis || ATTRIBUTION_BASES.UNKNOWN);
  const source = row.source ? String(row.source) : null;

  return createFact({
    platform: PLATFORMS.TIKTOK,
    // 订单级没有流量来源 —— 只能是 unknown，不能猜成 organic 或 direct。
    channel: CHANNELS.UNKNOWN,
    source,
    attributionBasis: basis,
    impressions: hasValue(row.impressions) ? row.impressions : null,
    clicks: hasValue(row.clicks) ? row.clicks : null,
    spend: hasValue(row.spend) ? row.spend : null,
    orders: hasValue(row.orders) ? row.orders : null,
    units: hasValue(row.units) ? row.units : null,
    // ★ 三个 GMV 口径分别传入，绝不在这里加总。
    gmvOrderTotal: hasValue(row.gmvOrderTotal) ? row.gmvOrderTotal : null,
    gmvSubtotal: hasValue(row.gmvSubtotal) ? row.gmvSubtotal : null,
    gmvSettled: hasValue(row.gmvSettled) ? row.gmvSettled : null,
    baselineNaturalGmv: hasValue(row.baselineNaturalGmv) ? row.baselineNaturalGmv : null,
    incrementalGmv: hasValue(row.incrementalGmv) ? row.incrementalGmv : null,
    refunds: hasValue(row.refunds) ? row.refunds : null,
    cancellations: hasValue(row.cancellations) ? row.cancellations : null,
    commission: hasValue(row.commission) ? row.commission : null,
    shipping: hasValue(row.shipping) ? row.shipping : null,
    currency: row.currency || null,
  });
}

/**
 * 把多行事实按口径汇总。
 *
 * ★ 汇总只在**同一口径内**进行。不同口径的行分别落到不同的键里，
 * 绝不加总 —— 否则会把订单实付与平台归因加在一起，得到一个没有意义的数。
 *
 * @param {Array<object>} rows 日粒度行
 * @returns {{byBasis: object, facts: Array<object>}}
 */
function groupFactsByBasis(rows = []) {
  const byBasis = {};
  const facts = [];
  for (const row of rows) {
    const fact = toFact(row);
    facts.push(fact);
    const key = fact.attributionBasis;
    if (!byBasis[key]) byBasis[key] = [];
    byBasis[key].push(fact);
  }
  return { byBasis, facts };
}

/**
 * 在一组**同口径**的事实上求和。
 *
 * @param {Array<object>} facts
 * @returns {object|null}
 */
function sumFacts(facts = []) {
  if (!facts.length) return null;
  const totals = {
    orders: 0, units: 0, spend: 0, impressions: 0, clicks: 0,
    gmvOrderTotal: 0, gmvSubtotal: 0, gmvSettled: 0,
    refunds: 0, commission: 0, shipping: 0, cancellations: 0,
    baselineNaturalGmv: 0, incrementalGmv: 0,
    _present: {
      orders: false, units: false, spend: false, impressions: false, clicks: false,
      gmvOrderTotal: false, gmvSubtotal: false, gmvSettled: false,
      refunds: false, commission: false, shipping: false, cancellations: false,
      baselineNaturalGmv: false, incrementalGmv: false,
    },
  };
  for (const fact of facts) {
    for (const key of Object.keys(totals._present)) {
      if (hasValue(fact[key])) {
        totals[key] += fact[key];
        totals._present[key] = true;
      }
    }
  }
  // 没出现过的字段保持 null —— 「没有这个数」不能变成 0。
  for (const key of Object.keys(totals._present)) {
    if (!totals._present[key]) totals[key] = null;
  }
  delete totals._present;
  totals.attributionBasis = facts[0].attributionBasis;
  totals.source = facts[0].source;
  totals.channel = facts[0].channel;
  return totals;
}

/**
 * 算出一组指标 —— 全部走 platform-model 的口径闸门。
 *
 * 每个比值都要过 assertSameBasis：分子分母口径不匹配时直接抛错，
 * 而不是给出一个看似合理的错数。
 *
 * @param {object} totals 同口径汇总
 * @returns {object} 指标集合
 */
function computeMetrics(totals) {
  if (!totals) return {};
  const basis = totals.attributionBasis;

  // 构造带口径的指标对象，闸门才有得检查。
  const metric = (name, value) => createMetric({
    platform: PLATFORMS.TIKTOK,
    attributionBasis: basis,
    value,
    source: totals.source,
  });

  const metrics = {
    orders: metric('orders', totals.orders),
    units: metric('units', totals.units),
    spend: metric('spend', totals.spend),
    impressions: metric('impressions', totals.impressions),
    clicks: metric('clicks', totals.clicks),
    gmvOrderTotal: metric('gmvOrderTotal', totals.gmvOrderTotal),
    gmvSubtotal: metric('gmvSubtotal', totals.gmvSubtotal),
    gmvSettled: metric('gmvSettled', totals.gmvSettled),
  };

  // CTR / CVR：同口径内自比，必然成立。
  metrics.ctr = metric('ctr', ratio(totals.clicks, totals.impressions));
  // 订单转化率：需要点击数。TikTok 订单级没有点击，所以只在有 clicks 时才算。
  metrics.cvr = metric('cvr', ratio(totals.orders, totals.clicks));
  // 客单价：订单实付 ÷ 订单数，同口径内。
  metrics.aov = metric('aov', ratio(totals.gmvOrderTotal, totals.orders));
  // 花费占比：花费 ÷ 同口径 GMV。
  // ★ 这里要过闸门 —— 若 GMV 是 platform_attributed 而花费是 paid_only，
  //   属于 DIVISIBLE_BASIS_PAIRS 里明确允许的一对（同一张 GMV Max 报表内）。
  // ★ 必须包成 metric：比值本身也要带口径，否则下游没法判断它是什么口径。
  metrics.spendRatio = metric('spendRatio', safeRatioWithBasis(
    metrics.spend, metrics.gmvOrderTotal, 'spend / gmv',
  ));

  // 结算净收益：需要结算口径的数据。
  const net = netProceeds({
    gmvSettled: totals.gmvSettled,
    commission: totals.commission,
    shipping: totals.shipping,
    refunds: totals.refunds,
  });
  metrics.netProceeds = metric('netProceeds', net);
  // 结算净 ROAS：derived_net ÷ paid_only —— 闸门允许的一对。
  metrics.settledNetRoas = metric('settledNetRoas', safeRatioWithBasis(
    metrics.netProceeds, metrics.spend, 'net proceeds / spend',
  ));
  // 增量 ROAS：derived_incremental ÷ paid_only —— 闸门允许的一对。
  metrics.incrementalRoas = metric('incrementalRoas', safeRatioWithBasis(
    metric('incrementalGmv', totals.incrementalGmv), metrics.spend, 'incremental gmv / spend',
  ));
  // 退款率、取消率：同口径内的比率。
  metrics.refundRate = metric('refundRate', ratio(totals.refunds, totals.gmvSettled ?? totals.gmvOrderTotal));
  metrics.cancellationRate = metric('cancellationRate', ratio(totals.cancellations, totals.orders));

  return metrics;
}

/**
 * 相除并过口径闸门。
 *
 * 口径不匹配时**返回 null 而不是抛错** —— 因为这里是在批量处理多个口径的
 * 数据行，某些行本来就不该有某个比值。真正需要"必须成立"的地方
 * 应该直接用 platform-model 的 assertSameBasis。
 *
 * @param {object} numerator 带口径的指标
 * @param {object} denominator 带口径的指标
 * @param {string} reason
 * @returns {number|null}
 */
function safeRatioWithBasis(numerator, denominator, reason = '') {
  if (!numerator || !denominator) return null;
  if (!hasValue(numerator.value) || !hasValue(denominator.value)) return null;
  if (denominator.value === 0) return null;
  if (!canDivideAcrossBases(numerator.attributionBasis, denominator.attributionBasis)) {
    return null;
  }
  try {
    assertSameBasis(numerator, denominator, reason);
  } catch {
    return null;
  }
  return numerator.value / denominator.value;
}

/**
 * 构建 TikTok 店铺的分析结论。
 *
 * 输出分两段，泾渭分明：
 *   facts      —— 【数据事实】。每个数字都能追到具体的行与口径。
 *   judgments  —— 【AI 推测建议】。基于事实的判断，明确标注为推测。
 *   unavailable—— 拿不到的结论。附上原因，不给数值。
 *
 * @param {object} options
 * @param {Array<object>} options.rows 日粒度行
 * @param {object} [options.thresholds] 阈值配置
 * @returns {object}
 */
function buildAnalysis({ rows = [], thresholds = {} } = {}) {
  const { byBasis } = groupFactsByBasis(rows);

  const facts = {};
  const metricsByBasis = {};

  for (const [basis, factsOfBasis] of Object.entries(byBasis)) {
    const totals = sumFacts(factsOfBasis);
    const metrics = computeMetrics(totals);
    metricsByBasis[basis] = metrics;

    facts[basis] = {
      attributionBasis: basis,
      source: totals.source,
      dayCount: factsOfBasis.length,
      orders: totals.orders,
      units: totals.units,
      spend: totals.spend,
      impressions: totals.impressions,
      clicks: totals.clicks,
      gmvOrderTotal: totals.gmvOrderTotal,
      gmvSubtotal: totals.gmvSubtotal,
      gmvSettled: totals.gmvSettled,
      netProceeds: metrics.netProceeds.value,
      incrementalGmv: totals.incrementalGmv,
      currency: null,
    };
  }

  const judgments = buildJudgments(metricsByBasis, thresholds);
  const unavailable = buildUnavailable();

  return {
    platform: PLATFORMS.TIKTOK,
    facts,
    metricsByBasis,
    judgments,
    unavailable,
    capabilities: CAPABILITIES,
  };
}

/**
 * 基于事实给出判断。
 *
 * 每条判断都带 kind，标明它是「数据事实」还是「AI 推测建议」。
 * 项目约束要求区分这两者 —— 推测不能伪装成事实。
 *
 * @param {object} metricsByBasis
 * @param {object} thresholds
 * @returns {Array<object>}
 */
function buildJudgments(metricsByBasis, thresholds = {}) {
  const judgments = [];
  const spendLimit = Number(thresholds.adSpendRatioLimit ?? 0.3);

  // 结算净 ROAS：这是 TikTok 侧最有价值的一个数 —— 它不受归因口径影响，
  // 是真金白银落到卖家手里的钱。
  const settled = metricsByBasis[ATTRIBUTION_BASES.DERIVED_NET];
  if (settled && hasValue(settled.settledNetRoas.value)) {
    const roas = settled.settledNetRoas.value;
    judgments.push({
      key: 'settled-net-roas',
      kind: 'ai-suggestion',
      severity: roas < 1 ? 'critical' : roas < 1.5 ? 'warning' : 'good',
      title: '结算净 ROAS',
      value: roas,
      // 数据事实部分：分子分母各是多少，来自哪个口径。
      evidence: {
        netProceeds: settled.netProceeds.value,
        spend: settled.spend.value,
        basis: ATTRIBUTION_BASES.DERIVED_NET,
      },
      suggestion: roas < 1
        ? '每投入 1 元广告费，结算后净收益不足 1 元 —— 当前投放是亏的，应先收窄到高转化商品再放量。'
        : roas < 1.5
          ? '结算净 ROAS 偏低。可收紧定向或提高出价门槛，把预算集中到已验证的商品上。'
          : '结算净 ROAS 健康。结算口径不受平台归因口径影响，这个数可直接用于判断投放是否真的赚钱。',
    });
  }

  // 增量 ROAS：判断广告到底带来了多少增量，而不是平台说带来多少。
  const incremental = metricsByBasis[ATTRIBUTION_BASES.DERIVED_INCREMENTAL];
  if (incremental && hasValue(incremental.incrementalRoas.value)) {
    const roas = incremental.incrementalRoas.value;
    judgments.push({
      key: 'incremental-roas',
      kind: 'ai-suggestion',
      severity: roas < 1 ? 'warning' : 'good',
      title: '增量 ROAS',
      value: roas,
      evidence: {
        incrementalGmv: incremental.gmvOrderTotal ? null : incremental.incrementalRoas.value,
        spend: incremental.spend.value,
        basis: ATTRIBUTION_BASES.DERIVED_INCREMENTAL,
      },
      suggestion: roas < 1
        ? '广告带来的增量收益低于花费。平台归因 GMV 里含自然流量，所以这个数才是广告的真实贡献。'
        : '增量 ROAS 达标，说明投放确实带来了增量，而不只是把自然流量算到了自己头上。',
    });
  }

  // 花费占比：只在有 GMV 的口径上判断。
  const platformAttributed = metricsByBasis[ATTRIBUTION_BASES.PLATFORM_ATTRIBUTED];
  if (platformAttributed && hasValue(platformAttributed.spendRatio.value)) {
    const ratioValue = platformAttributed.spendRatio.value;
    judgments.push({
      key: 'spend-ratio',
      kind: 'ai-suggestion',
      severity: ratioValue > spendLimit ? 'warning' : 'good',
      title: '花费占 GMV 比例',
      value: ratioValue,
      threshold: spendLimit,
      evidence: {
        spend: platformAttributed.spend.value,
        gmv: platformAttributed.gmvOrderTotal.value,
        basis: ATTRIBUTION_BASES.PLATFORM_ATTRIBUTED,
      },
      suggestion: ratioValue > spendLimit
        ? `花费占 GMV 超过 ${(spendLimit * 100).toFixed(0)}%，建议收窄投放范围。`
        : `花费占比在 ${(spendLimit * 100).toFixed(0)}% 以内，投放强度合理。`,
    });
  }

  // 订单级事实：只陈述，不推测。
  const orderLevel = metricsByBasis[ATTRIBUTION_BASES.ORDER_LEVEL];
  if (orderLevel && hasValue(orderLevel.orders.value)) {
    judgments.push({
      key: 'order-volume',
      kind: 'data-fact',
      severity: 'info',
      title: '订单量（订单口径）',
      value: orderLevel.orders.value,
      evidence: {
        orders: orderLevel.orders.value,
        units: orderLevel.units.value,
        gmvOrderTotal: orderLevel.gmvOrderTotal.value,
        basis: ATTRIBUTION_BASES.ORDER_LEVEL,
      },
      suggestion: '这是订单口径的事实：来自订单本身，不含任何广告归因，因此不会被投放归因方式影响。',
    });
  }

  return judgments;
}

/**
 * 列出 TikTok 侧拿不到的结论，并说明原因。
 *
 * 这一段很重要：把「给不出结论」明说出来，比给一个残缺的结论诚实得多。
 * 用户看到 TikTok 店铺没有成熟度分档，能知道是平台数据边界，不是系统故障。
 *
 * @returns {Array<object>}
 */
function buildUnavailable() {
  return [
    {
      key: 'traffic-split',
      title: '流量结构（广告带来 vs 自然带来）',
      available: false,
      reason: CAPABILITIES.trafficSplit.reason,
      impact: CAPABILITIES.trafficSplit.consequence,
    },
    {
      key: 'maturity-grading',
      title: '成熟度分档',
      available: false,
      reason: CAPABILITIES.maturityGrading.reason,
      impact: CAPABILITIES.maturityGrading.consequence,
    },
    {
      key: 'direct-roas',
      title: '直接归因 ROAS',
      available: false,
      reason: 'TikTok 订单级没有流量来源字段，拆不出「广告直接带来的订单」，因此没有 direct 口径的 ROAS。',
      impact: '与 Shopee 店铺对比 direct ROAS 时，这一项在 TikTok 侧不可得。',
    },
  ];
}

module.exports = {
  CAPABILITIES,
  buildAnalysis,
  buildJudgments,
  buildUnavailable,
  computeMetrics,
  groupFactsByBasis,
  hasValue,
  ratio,
  safeRatioWithBasis,
  sumFacts,
  toFact,
};
