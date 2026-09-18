'use strict';

function median(values) {
  const rows = values
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (!rows.length) return null;
  const mid = Math.floor(rows.length / 2);
  return rows.length % 2 ? rows[mid] : (rows[mid - 1] + rows[mid]) / 2;
}

function signal(code, severity, title, detail) {
  return { code, severity, title, detail };
}

function diagnoseStoreSkus(rows, {
  adSpendRatioLimit = 0.15,
  lowCvrVsMedianRatio = 0.7,
  highAdGmvShare = 0.8,
  lowAdGmvShare = 0.3,
} = {}) {
  const input = rows || [];
  const cvrMedian = median(
    input
      .filter(row => row.hasProductCard && row.totalConversionRate !== null)
      .map(row => row.totalConversionRate),
  );

  const diagnosed = input.map(row => {
    const signals = [];

    if (!row.hasProductCard) {
      signals.push(signal(
        'PRODUCT_CARD_MISSING',
        'neutral',
        '缺商品总漏斗',
        '当前周期没有精确 Product Card，不能用广告数据替代商品总 CVR / 加购表现。',
      ));
    }

    if (row.adExpense > 0 && Number(row.broadOrders || 0) === 0) {
      signals.push(signal(
        'AD_SPEND_ZERO_ORDER',
        'high',
        '广告有花费但零订单',
        '先下钻所属 Campaign，确认是否仍处于低样本探索，避免只凭单周期直接判定商品失败。',
      ));
    }

    if (row.adSpendRatioToSales !== null && row.adSpendRatioToSales > adSpendRatioLimit) {
      signals.push(signal(
        'ITEM_AD_SPEND_RATIO_OVER_LIMIT',
        'high',
        '商品广告花费占比超 15%',
        '广告花费 / 商品总销售额超过当前经营约束，需要结合 ROAS 与自然销售承接判断。',
      ));
    }

    if (
      cvrMedian !== null &&
      row.totalConversionRate !== null &&
      cvrMedian > 0 &&
      row.totalConversionRate < cvrMedian * lowCvrVsMedianRatio
    ) {
      signals.push(signal(
        'CVR_BELOW_STORE_MEDIAN',
        'medium',
        '商品 CVR 明显低于店内中位数',
        '这是店内相对比较，不是 Shopee 官方 Benchmark；优先检查价格、优惠、主图/详情与流量质量。',
      ));
    }

    if (
      row.adGmvShareOfSales !== null &&
      row.adGmvShareOfSales >= highAdGmvShare &&
      Number(row.totalSales || 0) > 0
    ) {
      signals.push(signal(
        'AD_LED_SALES',
        'medium',
        '销售高度依赖广告归因',
        'Broad Ads GMV 占商品总销售较高；关注停止或收缩广告后自然承接是否足够。',
      ));
    }

    if (
      row.adGmvShareOfSales !== null &&
      row.adGmvShareOfSales <= lowAdGmvShare &&
      Number(row.estimatedNaturalSales || 0) > 0
    ) {
      signals.push(signal(
        'NATURAL_LED_SALES',
        'positive',
        '自然销售占比较高',
        '估算自然销售占比高，可作为商品自身承接能力的积极信号继续观察。',
      ));
    }

    if (!signals.length) {
      signals.push(signal(
        'NO_MAJOR_STORE_SIGNAL',
        'neutral',
        '暂无明显商品级异常',
        '继续结合广告组结构和后续周期变化判断。',
      ));
    }

    const severityRank = { high: 0, medium: 1, neutral: 2, positive: 3 };
    signals.sort((a, b) =>
      (severityRank[a.severity] ?? 9) - (severityRank[b.severity] ?? 9)
    );

    return {
      ...row,
      storeCvrMedian: cvrMedian,
      primarySignal: signals[0],
      signals,
    };
  });

  return {
    cvrMedian,
    items: diagnosed,
    attentionCount: diagnosed.filter(row =>
      ['high', 'medium'].includes(row.primarySignal.severity)
    ).length,
  };
}

module.exports = { median, diagnoseStoreSkus };
