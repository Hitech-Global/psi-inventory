'use strict';

/**
 * 平台无关的中间模型。
 * ============================================================================================
 * 目的：让诊断引擎（diagnosis.js / maturity-engine.js / action-engine.js）与指标计算
 * （metrics.js）不必知道数据来自哪个平台。各平台 adapter 负责把自己的原始字段
 * 映射到这里的字段，分析层只消费这里的字段。
 *
 * 为什么必须有这一层
 * ------------------
 * Shopee 与 TikTok 的归因语义根本不同，无法直接共用字段名：
 *
 *   - Shopee 有 Direct（广告直接归因）与 Broad（全部）两套订单级字段，
 *     可以把订单拆成"广告带来的"和"自然来的"；
 *   - TikTok 的 GMV Max 报表把付费与自然流量**合并**在 gross_revenue / orders / roi 里，
 *     而 Open API 的订单对象**没有**任何流量来源字段
 *     （已复核 Get Order Detail：traffic_source / attribution / PAID_AD 均为 0 命中）。
 *     因此 TikTok 侧不存在与 Direct 等价的字段，只能退化为"聚合归因"，
 *     或用结算流水自建口径。
 *
 * 混用口径会得出错误结论（例如用混合归因的花费去除以直接归因的 GMV）。
 * 所以每个指标都带 attributionBasis，并在构造时拒绝跨口径计算。
 *
 * 字段口径
 * --------
 *   attributionBasis:
 *     platform_attributed  平台归因口径。Shopee 的 Direct/Broad；TikTok 的 GMV Max 混合归因。
 *     paid_only             纯付费广告数据。TikTok report/integrated/get/ 的 spend/impressions/clicks。
 *     derived_incremental   增量估算。TikTok：归因 GMV − 自然基线 GMV。
 *     derived_net           结算自建。净收益、结算净 ROAS。两平台通用。
 *     order_level           订单级归因。Shopee 的 direct/broad 订单拆分。
 *     unknown               不可知。TikTok 订单级来源缺失时用这个表达。
 *
 *   channel:
 *     direct    广告直接归因（Shopee）
 *     broad     全部订单（Shopee）
 *     affiliate 达人联盟
 *     organic   自然流量
 *     unknown   不可知
 */

/** 归因口径枚举。跨口径计算由 assertSameBasis 拦截。 */
const ATTRIBUTION_BASES = Object.freeze({
  PLATFORM_ATTRIBUTED: 'platform_attributed',
  PAID_ONLY: 'paid_only',
  DERIVED_INCREMENTAL: 'derived_incremental',
  DERIVED_NET: 'derived_net',
  ORDER_LEVEL: 'order_level',
  UNKNOWN: 'unknown',
});

const ATTRIBUTION_BASIS_VALUES = Object.freeze(Object.values(ATTRIBUTION_BASES));

/** 渠道枚举。 */
const CHANNELS = Object.freeze({
  DIRECT: 'direct',
  BROAD: 'broad',
  AFFILIATE: 'affiliate',
  ORGANIC: 'organic',
  UNKNOWN: 'unknown',
});

const CHANNEL_VALUES = Object.freeze(Object.values(CHANNELS));

/** 支持的平台。 */
const PLATFORMS = Object.freeze({
  SHOPEE: 'shopee',
  TIKTOK: 'tiktok',
});

const PLATFORM_VALUES = Object.freeze(Object.values(PLATFORMS));

/**
 * 数据来源。用于区分「同一张报表内的混合口径」与「跨报表混算」。
 *
 * 背景：TikTok 的 GMV Max 报表里 `gross_revenue`（混合归因）与 `cost`（纯花费）
 * 出自同一张报表，相除得到的就是平台面板上的 ROI，语义成立。
 * 但整合报表（integrated report）的 `spend` 覆盖的是另一批广告活动，
 * 与 GMV Max 的花费不是同一个数 —— 两者相除没有意义。
 * 光看 attributionBasis 分辨不出来，因为两处的花费都是 paid_only 语义。
 * 因此额外记录来源，跨来源的比值一律拒绝。
 */
const SOURCES = Object.freeze({
  /** GMV Max 报表：cost / gross_revenue / orders / roi 同源 */
  GMV_MAX_REPORT: 'gmv_max_report',
  /** 整合报表：spend / impressions / clicks / conversions 同源 */
  INTEGRATED_REPORT: 'integrated_report',
  /** 结算流水：收入 / 佣金 / 物流 / 退款 */
  FINANCE_STATEMENT: 'finance_statement',
  /** 店铺订单 */
  SHOP_ORDER: 'shop_order',
  /** 店铺分析（漏斗） */
  SHOP_ANALYTICS: 'shop_analytics',
  /** 达人联盟：单个达人的表现（GMV / GPM / 粉丝数 / 内容表现） */
  AFFILIATE_CREATOR: 'affiliate_creator',
});

const SOURCE_VALUES = Object.freeze(Object.values(SOURCES));

/**
 * 哪些口径之间允许相除得到比值。
 *
 * 规则：比值的分子分母必须来自同一个口径，且该口径必须是"可比较"的。
 * 举例：
 *   - paid_only 的 spend 除以 paid_only 的 orders → 允许（都是纯付费）
 *   - platform_attributed 的 grossRevenue 除以 platform_attributed 的 cost → 允许
 *   - platform_attributed 的 grossRevenue 除以 paid_only 的 spend → 允许，
 *     **但仅限同一来源**（GMV Max 报表内的 ROI）；跨来源被 source 检查拦下
 *   - derived_incremental 的增量 GMV 除以 paid_only 的 spend → 允许
 *     （这正是 TikTok 增量 ROAS 的定义）
 *   - platform_attributed 除以 derived_net → **不允许**
 *     （平台归因 GMV 与结算净收益是两个不同的事实，相除没有意义）
 */
const DIVISIBLE_BASIS_PAIRS = Object.freeze([
  [ATTRIBUTION_BASES.PAID_ONLY, ATTRIBUTION_BASES.PAID_ONLY],
  [ATTRIBUTION_BASES.PLATFORM_ATTRIBUTED, ATTRIBUTION_BASES.PLATFORM_ATTRIBUTED],
  [ATTRIBUTION_BASES.DERIVED_INCREMENTAL, ATTRIBUTION_BASES.DERIVED_INCREMENTAL],
  [ATTRIBUTION_BASES.DERIVED_NET, ATTRIBUTION_BASES.DERIVED_NET],
  [ATTRIBUTION_BASES.ORDER_LEVEL, ATTRIBUTION_BASES.ORDER_LEVEL],
  // 平台归因的分子配纯付费的分母：同一张 GMV Max 报表内成立（平台口径 ROI）
  [ATTRIBUTION_BASES.PLATFORM_ATTRIBUTED, ATTRIBUTION_BASES.PAID_ONLY],
  // 增量分子配纯付费分母：TikTok 增量 ROAS 的定义
  [ATTRIBUTION_BASES.DERIVED_INCREMENTAL, ATTRIBUTION_BASES.PAID_ONLY],
  // 结算净收益配纯付费分母：结算净 ROAS 的定义，分子分母都来自结算与花费
  [ATTRIBUTION_BASES.DERIVED_NET, ATTRIBUTION_BASES.PAID_ONLY],
]);

/**
 * 判断两个口径能否相除。
 * @param {string} numeratorBasis
 * @param {string} denominatorBasis
 * @returns {boolean}
 */
function canDivideAcrossBases(numeratorBasis, denominatorBasis) {
  return DIVISIBLE_BASIS_PAIRS.some(
    ([numerator, denominator]) => numerator === numeratorBasis && denominator === denominatorBasis,
  );
}

/**
 * 断言两个指标可以相除，否则抛错。这是防止口径混用的结构性保障。
 *
 * 两道检查：
 *   1. 口径可配对 —— 由 DIVISIBLE_BASIS_PAIRS 决定；
 *   2. 来源相同 —— 同一张报表内的混合口径相除成立，跨报表相除无意义。
 *
 * @param {object} numerator
 * @param {object} denominator
 * @param {string} [reason] 出错时的上下文说明
 */
function assertSameBasis(numerator, denominator, reason = '') {
  if (!numerator || typeof numerator !== 'object') {
    throw new Error('numerator metric is required');
  }
  if (!denominator || typeof denominator !== 'object') {
    throw new Error('denominator metric is required');
  }
  const numeratorBasis = numerator.attributionBasis;
  const denominatorBasis = denominator.attributionBasis;
  if (!ATTRIBUTION_BASIS_VALUES.includes(numeratorBasis)) {
    throw new Error(`unknown attribution basis on numerator: ${numeratorBasis}`);
  }
  if (!ATTRIBUTION_BASIS_VALUES.includes(denominatorBasis)) {
    throw new Error(`unknown attribution basis on denominator: ${denominatorBasis}`);
  }
  if (!canDivideAcrossBases(numeratorBasis, denominatorBasis)) {
    const suffix = reason ? ` (${reason})` : '';
    throw new Error(
      `refusing to combine attribution bases: ${numeratorBasis} / ${denominatorBasis}${suffix}`,
    );
  }
  // 来源不同意味着数字覆盖的不是同一批事实，相除没有意义。
  const numeratorSource = numerator.source || null;
  const denominatorSource = denominator.source || null;
  if (numeratorSource && denominatorSource && numeratorSource !== denominatorSource) {
    const suffix = reason ? ` (${reason})` : '';
    throw new Error(
      `refusing to combine metrics from different sources: ${numeratorSource} / ${denominatorSource}${suffix}`,
    );
  }
}

/**
 * 构造一个带口径标记的指标。
 * @param {object} options
 * @param {string} options.platform
 * @param {string} options.attributionBasis
 * @param {number|null} [options.value]
 * @param {string} [options.channel]
 * @param {string} [options.unit]
 * @returns {object}
 */
function createMetric({
  platform,
  attributionBasis,
  value = null,
  channel = CHANNELS.UNKNOWN,
  unit = null,
  source = null,
}) {
  if (!PLATFORM_VALUES.includes(platform)) {
    throw new Error(`unknown platform: ${platform}`);
  }
  if (!ATTRIBUTION_BASIS_VALUES.includes(attributionBasis)) {
    throw new Error(`unknown attribution basis: ${attributionBasis}`);
  }
  if (!CHANNEL_VALUES.includes(channel)) {
    throw new Error(`unknown channel: ${channel}`);
  }
  if (source !== null && !SOURCE_VALUES.includes(source)) {
    throw new Error(`unknown source: ${source}`);
  }
  return {
    platform,
    attributionBasis,
    channel,
    unit,
    source,
    value: typeof value === 'number' && Number.isFinite(value) ? value : null,
  };
}

/**
 * 构造平台无关的事实记录。
 *
 * 数值字段与口径字段成对出现：g mv 类的金额指标各自带自己的 basis，
 * 因为同一份事实里可能同时存在平台归因 GMV 与结算净收益。
 *
 * @param {object} options
 * @returns {object}
 */
function createFact({
  platform,
  channel = CHANNELS.UNKNOWN,
  contentType = null,
  impressions = null,
  clicks = null,
  spend = null,
  orders = null,
  units = null,
  gmvOrderTotal = null,
  gmvSubtotal = null,
  gmvSettled = null,
  baselineNaturalGmv = null,
  incrementalGmv = null,
  refunds = null,
  cancellations = null,
  commission = null,
  shipping = null,
  currency = null,
  attributionBasis = ATTRIBUTION_BASES.UNKNOWN,
  source = null,
}) {
  if (!PLATFORM_VALUES.includes(platform)) {
    throw new Error(`unknown platform: ${platform}`);
  }
  if (source !== null && !SOURCE_VALUES.includes(source)) {
    throw new Error(`unknown source: ${source}`);
  }
  if (!CHANNEL_VALUES.includes(channel)) {
    throw new Error(`unknown channel: ${channel}`);
  }
  if (!ATTRIBUTION_BASIS_VALUES.includes(attributionBasis)) {
    throw new Error(`unknown attribution basis: ${attributionBasis}`);
  }

  const money = value => (typeof value === 'number' && Number.isFinite(value) ? value : null);
  const count = value => (typeof value === 'number' && Number.isFinite(value) ? value : null);

  return {
    platform,
    attributionBasis,
    channel,
    contentType,
    source,

    // 漏斗（付费侧，语义与 Shopee 的付费指标一致，可横向比较）
    impressions: count(impressions),
    clicks: count(clicks),

    // 花费
    spend: money(spend),

    // 订单与件数
    orders: count(orders),
    units: count(units),

    // 三个 GMV 口径，各自独立，互不推导
    gmvOrderTotal: money(gmvOrderTotal), // 订单实付（含运费）
    gmvSubtotal: money(gmvSubtotal), // 货款小计（不含运费）
    gmvSettled: money(gmvSettled), // 结算收入（已扣佣金与退款）

    // 增量估算（仅 TikTok 使用）
    baselineNaturalGmv: money(baselineNaturalGmv),
    incrementalGmv: money(incrementalGmv),

    // 成本与损耗
    refunds: money(refunds),
    cancellations: count(cancellations),
    commission: money(commission),
    shipping: money(shipping),
    currency,
  };
}

/**
 * 计算客单价。分子分母必须同源同口径。
 * @param {object} fact
 * @returns {number|null}
 */
function averageOrderValue(fact) {
  if (!fact || !fact.orders) return null;
  const gmv = fact.gmvSubtotal ?? fact.gmvOrderTotal;
  if (typeof gmv !== 'number') return null;
  return gmv / fact.orders;
}

/**
 * 计算净收益。全部来自结算口径，不受归因窗口影响。
 * @param {object} fact
 * @returns {number|null}
 */
function netProceeds(fact) {
  if (!fact) return null;
  const settled = fact.gmvSettled;
  if (typeof settled !== 'number') return null;
  let net = settled;
  if (typeof fact.commission === 'number') net -= fact.commission;
  if (typeof fact.shipping === 'number') net -= fact.shipping;
  if (typeof fact.refunds === 'number') net -= fact.refunds;
  return net;
}

/**
 * 计算结算净 ROAS。分子分母同源于结算与花费，口径一致。
 * @param {object} fact
 * @returns {number|null}
 */
function settledNetRoas(fact) {
  if (!fact || !fact.spend) return null;
  const net = netProceeds(fact);
  if (net === null) return null;
  return net / fact.spend;
}

/**
 * 计算增量 ROAS（仅 TikTok 有意义）。
 * 分子是增量 GMV，分母是纯付费花费 —— 这是 TikTok 侧唯一能表达"广告贡献"的比值。
 * @param {object} fact
 * @returns {number|null}
 */
function incrementalRoas(fact) {
  if (!fact || !fact.spend) return null;
  if (typeof fact.incrementalGmv !== 'number') return null;
  return fact.incrementalGmv / fact.spend;
}

module.exports = {
  ATTRIBUTION_BASES,
  ATTRIBUTION_BASIS_VALUES,
  CHANNELS,
  SOURCES,
  SOURCE_VALUES,
  CHANNEL_VALUES,
  PLATFORMS,
  PLATFORM_VALUES,
  DIVISIBLE_BASIS_PAIRS,
  assertSameBasis,
  averageOrderValue,
  canDivideAcrossBases,
  createFact,
  createMetric,
  incrementalRoas,
  netProceeds,
  settledNetRoas,
};
