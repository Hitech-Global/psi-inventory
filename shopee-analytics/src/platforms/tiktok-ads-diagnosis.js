'use strict';

/**
 * TikTok 广告诊断。
 * ============================================================================================
 * 与店铺诊断分开 —— 因为看的是不同的口径，回答的是不同的问题。
 *
 * ★ 口径纪律（本模块最重要的一条）
 * ------------------------------------
 * 广告侧有两种口径，它们的含义完全不同：
 *
 *   platform_attributed（GMV Max 报表）
 *     cost 与 gross_revenue 出自同一张报表，所以 cost ÷ gross_revenue
 *     就是平台面板上显示的 ROI。但 gross_revenue **含自然流量** ——
 *     平台会把本来就会成交的单也算成广告带来的。
 *
 *   paid_only（整合报表）
 *     spend / impressions / clicks 是真正的付费侧数据。
 *
 * ★★ 所以「广告花了多少钱、带回多少 GMV」这个比值，
 *   分子必须取 paid_only 的 spend，分母必须取 platform_attributed 的 GMV ——
 *   这**不是**同一张报表的 ROI，而是一个跨报表的估算值，
 *   它的含义是「每 1 元广告费，换来多少平台归因口径下的 GMV」。
 *
 *   这个数有意义（它衡量的是整体投放强度），但它**不是**平台面板上的 ROI。
 *   页面必须把它这么标注，不能让人以为它就是平台 ROI。
 *
 *   而平台 ROI（cost ÷ gross_revenue）另有其数 —— 两个数都要给，
 *   而且要说清哪个是哪个。
 */

const { ATTRIBUTION_BASES } = require('../platform-model');

/** 花费占 GMV 的警戒线。超过说明投放强度过高。 */
const DEFAULT_SPEND_RATIO_LIMIT = 0.15;

/** 结算净 ROAS 的盈亏线。低于 1 就是亏的。 */
const DEFAULT_SETTLED_NET_ROAS_LIMIT = 1;

/**
 * 判断一个数字是否有值。
 *
 * @param {*} value
 * @returns {boolean}
 */
function hasValue(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * 求一组事实里某字段的和；全缺失时返回 null（不是 0）。
 *
 * @param {Array<object>} facts
 * @param {string} field
 * @returns {number|null}
 */
function sumField(facts = [], field) {
  let total = null;
  for (const fact of facts) {
    if (!hasValue(fact[field])) continue;
    total = (total || 0) + fact[field];
  }
  return total;
}

/**
 * 交叉口径的比值 —— 只允许平台归因 GMV 配纯付费花费这一种组合。
 *
 * 别的组合一律返回 null：
 *   - 纯付费 GMV 不存在，不存在分子；
 *   - 结算净收益除以花费是另一个口径的算法（net proceeds ÷ spend），
 *     不能和这里的"归因 GMV ÷ 花费"混为一谈。
 *
 * @param {number|null} numerator
 * @param {number|null} denominator
 * @returns {number|null}
 */
function crossBasisRatio(numerator, denominator) {
  if (!hasValue(numerator) || !hasValue(denominator) || denominator === 0) return null;
  return numerator / denominator;
}

/**
 * 生成广告诊断结论。
 *
 * @param {object} options
 * @param {Array<object>} options.rows 日粒度事实行（两种口径都有）
 * @param {object} [options.thresholds]
 * @returns {object}
 */
function diagnoseAds({ rows = [], thresholds = {} } = {}) {
  const spendRatioLimit = Number(thresholds.adSpendRatioLimit ?? DEFAULT_SPEND_RATIO_LIMIT);
  const settledNetRoasLimit = Number(thresholds.settledNetRoasLimit ?? DEFAULT_SETTLED_NET_ROAS_LIMIT);

  const attributed = rows.filter(row => row.attributionBasis === ATTRIBUTION_BASES.PLATFORM_ATTRIBUTED);
  const paid = rows.filter(row => row.attributionBasis === ATTRIBUTION_BASES.PAID_ONLY);
  const settled = rows.filter(row => row.attributionBasis === ATTRIBUTION_BASES.DERIVED_NET);

  // 平台归因口径（GMV Max）：cost 与 gross_revenue 同源。
  const attributedSpend = sumField(attributed, 'spend');
  const attributedGmv = sumField(attributed, 'gmvOrderTotal');
  const attributedOrders = sumField(attributed, 'orders');
  const attributedImpressions = sumField(attributed, 'impressions');
  const attributedClicks = sumField(attributed, 'clicks');

  // 纯付费口径（整合报表）。
  const paidSpend = sumField(paid, 'spend');
  const paidImpressions = sumField(paid, 'impressions');
  const paidClicks = sumField(paid, 'clicks');

  // 结算口径。
  const settledRevenue = sumField(settled, 'gmvSettled');
  const settledCommission = sumField(settled, 'commission');
  const settledShipping = sumField(settled, 'shipping');
  const settledRefunds = sumField(settled, 'refunds');

  // ★ 平台面板 ROI：同源相除 —— cost ÷ gross_revenue。这是平台自己显示的那个数。
  const platformRoas = crossBasisRatio(attributedGmv, attributedSpend);
  // ★ 花费占归因 GMV：跨报表 —— 纯付费花费 ÷ 归因 GMV。这是投放强度，不是广告效率。
  const spendToAttributedGmv = crossBasisRatio(paidSpend, attributedGmv);
  // 纯付费漏斗：CTR 与点击率都在纯付费口径内自比。
  const paidCtr = crossBasisRatio(paidClicks, paidImpressions);

  // 结算净收益与净 ROAS。
  const netProceeds = hasValue(settledRevenue)
    ? settledRevenue
      - (hasValue(settledCommission) ? settledCommission : 0)
      - (hasValue(settledShipping) ? settledShipping : 0)
      - (hasValue(settledRefunds) ? settledRefunds : 0)
    : null;
  const settledNetRoas = crossBasisRatio(netProceeds, paidSpend);

  const signals = [];

  // ---- 平台面板 ROI：同源，口径最干净 ----
  if (hasValue(platformRoas)) {
    signals.push({
      code: 'TIKTOK_ADS_PLATFORM_ROAS',
      severity: platformRoas >= 2 ? 'good' : platformRoas >= 1 ? 'warning' : 'critical',
      kind: 'data-fact',
      title: '平台归因 ROI（同源）',
      detail: `归因 GMV ${fmt(attributedGmv)} ÷ 平台归因花费 ${fmt(attributedSpend)} = ${platformRoas.toFixed(2)}。`
        + '分子分母出自同一张 GMV Max 报表，所以这个比值就是平台面板上的 ROI。'
        + '但要注意：归因 GMV 含自然流量，所以它**不等于**广告真正带来的增量。',
      action: platformRoas < 1
        ? '平台口径的 ROI 不到 1，说明投放带回来的 GMV 还抵不上花费。要结合下面的结算净 ROAS 一起看。'
        : null,
    });
  }

  // ---- 花费占归因 GMV：跨报表，衡量投放强度 ----
  if (hasValue(spendToAttributedGmv)) {
    signals.push({
      code: 'TIKTOK_ADS_SPEND_RATIO',
      severity: spendToAttributedGmv > spendRatioLimit ? 'warning' : 'good',
      kind: 'data-fact',
      title: '花费占归因 GMV 比例',
      detail: `纯付费花费 ${fmt(paidSpend)} ÷ 平台归因 GMV ${fmt(attributedGmv)} = ${(spendToAttributedGmv * 100).toFixed(1)}%。`
        + '这是**跨报表**的投放强度指标（分子分母不同源），不是平台 ROI。',
      action: spendToAttributedGmv > spendRatioLimit
        ? `超过 ${(spendRatioLimit * 100).toFixed(0)}% 的警戒线。建议收窄定向，把预算集中到已验证的商品与人群上。`
        : null,
    });
  }

  // ---- 结算净 ROAS：真金白银 ----
  if (hasValue(settledNetRoas)) {
    signals.push({
      code: 'TIKTOK_ADS_SETTLED_NET_ROAS',
      severity: settledNetRoas < settledNetRoasLimit ? 'critical' : settledNetRoas < settledNetRoasLimit * 1.5 ? 'warning' : 'good',
      kind: 'ai-suggestion',
      title: '结算净 ROAS',
      detail: `结算净收益 ${fmt(netProceeds)} ÷ 纯付费花费 ${fmt(paidSpend)} = ${settledNetRoas.toFixed(2)}。`
        + '结算是卖家实际到手的钱，所以这个口径不受平台归因方式影响 —— 是判断投放是否真赚钱最可靠的依据。',
      action: settledNetRoas < settledNetRoasLimit
        ? '每投入 1 元广告费，结算后净收益不足 1 元。当前投放是亏的，应先停掉最差的广告组。'
        : settledNetRoas < settledNetRoasLimit * 1.5
          ? '刚过盈亏线，容错空间小。建议设一条 ROAS 底线，低于就自动降预算。'
          : '结算净 ROAS 健康。注意它比平台 ROI 更保守也更真实 —— 平台会把自然流量算进归因。',
    });
  }

  // ---- 纯付费漏斗 ----
  if (hasValue(paidCtr)) {
    signals.push({
      code: 'TIKTOK_ADS_CTR',
      severity: 'info',
      kind: 'data-fact',
      title: '纯付费点击率',
      detail: `点击 ${fmt(paidClicks)} ÷ 曝光 ${fmt(paidImpressions)} = ${(paidCtr * 100).toFixed(2)}%。`
        + '这是纯付费口径内的自比，反映素材与人群匹配度。',
      action: null,
    });
  }

  // ---- 归因订单数 ----
  if (hasValue(attributedOrders)) {
    signals.push({
      code: 'TIKTOK_ADS_ORDERS',
      severity: 'info',
      kind: 'data-fact',
      title: '平台归因订单数',
      detail: `${fmt(attributedOrders)} 笔。`
        + '这是平台归因口径的订单，含自然流量成交 —— 不能当成广告直接带来的订单。',
      action: null,
    });
  }

  // ---- 没有广告数据 ----
  if (!signals.length) {
    signals.push({
      code: 'TIKTOK_ADS_NO_DATA',
      severity: 'neutral',
      kind: 'ai-suggestion',
      title: '还没有广告数据',
      detail: '这个区间内没有广告相关的口径记录，诊断无法进行。',
      action: '先在「TikTok 广告数据」里同步一次广告数据 —— 那需要先完成 TikTok 广告账户的授权。',
    });
  }

  return {
    platform: 'tiktok',
    metrics: {
      platformRoas,
      spendToAttributedGmv,
      settledNetRoas,
      paidCtr,
      netProceeds,
      attributedSpend,
      attributedGmv,
      paidSpend,
      paidImpressions,
      paidClicks,
      attributedOrders,
      attributedImpressions,
      attributedClicks,
      settledRevenue,
    },
    signals,
    // ★ 口径说明随结果一起返回 —— 前端可以直接显示，不必自己编。
    caliberNotes: [
      {
        key: 'platform-roas',
        title: '平台归因 ROI',
        formula: '归因 GMV ÷ 平台归因花费',
        source: '同一张 GMV Max 报表',
        note: '口径最干净，但它含自然流量，不是广告的净贡献。',
      },
      {
        key: 'spend-ratio',
        title: '花费占归因 GMV 比例',
        formula: '纯付费花费 ÷ 平台归因 GMV',
        source: '跨两张报表',
        note: '衡量投放强度，不是广告效率。分子分母不同源。',
      },
      {
        key: 'settled-net-roas',
        title: '结算净 ROAS',
        formula: '结算净收益 ÷ 纯付费花费',
        source: '结算账单 + 整合报表',
        note: '卖家实际到手的钱，不受归因口径影响，最可靠。',
      },
    ],
    thresholds: { spendRatioLimit, settledNetRoasLimit },
  };
}

/**
 * 金额展示。
 *
 * @param {number|null} value
 * @returns {string}
 */
function fmt(value) {
  if (!hasValue(value)) return '—';
  return value.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
}

module.exports = {
  DEFAULT_SETTLED_NET_ROAS_LIMIT,
  DEFAULT_SPEND_RATIO_LIMIT,
  crossBasisRatio,
  diagnoseAds,
  sumField,
};
