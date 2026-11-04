'use strict';

/**
 * TikTok 店铺健康评估（SPS，Shop Performance Score）。
 * ============================================================================================
 * ★ 与 Shopee 的健康评估是两套不同的东西
 * ------------------------------------------
 * Shopee 侧是我们自己定了一组度量（店铺评分、退货退款率、迟发率……），
 * 阈值来自 Shopee 的达标线文档。
 *
 * TikTok 侧**不需要我们定**：
 *   GET /analytics/202606/shop_performances/overview
 *     → sps_score（总分）、sps_tier（层级）、peer_percentile（同层位百分位）、
 *       dimensions（各维度得分与权重）、top_issues（最需要处理的几个问题）
 *   GET /analytics/202606/shop_performances/metrics
 *     → 每个指标自带 benchmarks（excellent_threshold / poor_threshold）、
 *       score、status、status_text、top_reason_text
 *
 * 也就是说，**达标线由平台直接给出**。所以本模块的职责不是"发明指标"，
 * 而是：
 *   1. 把平台下发的指标整理成可读的表；
 *   2. 按平台给的 status 判定达标与否（而不是自己拿阈值猜）；
 *   3. 把 top_issues 与诊断建议对应起来。
 *
 * ★ 平台没给的指标就标 UNKNOWN
 *   指标集是平台动态下发的（spec 里没有硬编码枚举），
 *   某个店铺没有某项数据是常态 —— 那时必须说"没有这项"，
 *   不能拿别的指标代替，也不能自己算一个。
 */

/** 平台给出的状态 → 我们的判定。 */
const STATUS_TEXT = Object.freeze({
  EXCELLENT: { label: '优秀', level: 'good' },
  GOOD: { label: '良好', level: 'good' },
  FAIR: { label: '一般', level: 'watch' },
  POOR: { label: '较差', level: 'poor' },
  VERY_POOR: { label: '很差', level: 'poor' },
  UNKNOWN: { label: '未知', level: 'unknown' },
});

/**
 * 判断一个数字是否是"有值"。
 *
 * 0 是有值（确实是零），null/undefined/空串才是没有。
 *
 * @param {*} value
 * @returns {boolean}
 */
function hasValue(value) {
  if (value === null || value === undefined || value === '') return false;
  const parsed = Number(value);
  return Number.isFinite(parsed);
}

/**
 * 把平台的指标值渲染成带单位的样子。
 *
 * value_unit 决定单位（%、分、天、个…），不能自己猜 ——
 * 猜错单位会让读的人对数量级产生完全错误的印象。
 *
 * @param {string|number} value
 * @param {string} [unit]
 * @returns {string}
 */
function formatValue(value, unit) {
  if (!hasValue(value)) return '—';
  const parsed = Number(value);
  const text = Number.isInteger(parsed)
    ? parsed.toLocaleString('zh-CN')
    : parsed.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
  if (!unit) return text;
  if (unit === '%') return `${text}%`;
  if (unit === 'day' || unit === 'days') return `${text} 天`;
  return `${text} ${unit}`;
}

/**
 * 把平台的 status 归到我们的三档。
 *
 * ★ 平台没给状态（status 为空或无法识别）→ unknown。
 *   不能因为"没说不达标"就当成达标 —— 那是把"不知道"说成"好"。
 *
 * @param {string} status
 * @returns {object}
 */
function readStatus(status) {
  const key = String(status || '').trim().toUpperCase();
  if (!key) return { ...STATUS_TEXT.UNKNOWN, code: 'UNKNOWN' };
  if (STATUS_TEXT[key]) return { ...STATUS_TEXT[key], code: key };
  // 平台可能给新状态词。没见过的按"未知"处理，不猜好坏。
  return { ...STATUS_TEXT.UNKNOWN, code: key };
}

/**
 * 整理平台下发的指标。
 *
 * @param {Array<object>} metrics 平台返回的 metrics 数组
 * @returns {Array<object>>} 整理后的指标
 */
function normalizeMetrics(metrics = []) {
  return metrics.map(metric => {
    const status = readStatus(metric.status);
    const benchmarks = metric.benchmarks || {};
    return {
      metricCode: metric.metric_code || null,
      metricName: metric.metric_name || metric.metricCode || '未命名指标',
      dimension: metric.dimension || null,
      value: hasValue(metric.value) ? metric.value : null,
      valueUnit: metric.value_unit || null,
      displayValue: formatValue(metric.value, metric.value_unit),
      score: hasValue(metric.score) ? metric.score : null,
      status: status.code,
      statusLabel: status.label,
      level: status.level,
      // ★ 平台的达标线原样保留 —— 我们不自己发明阈值。
      excellentThreshold: hasValue(benchmarks.excellent_threshold) ? benchmarks.excellent_threshold : null,
      poorThreshold: hasValue(benchmarks.poor_threshold) ? benchmarks.poor_threshold : null,
      topReason: metric.top_reason_text || null,
      evaluateDurationDays: metric.evaluate_duration_days ?? null,
      startEvaluationTime: metric.start_evaluation_time ?? null,
      endEvaluationTime: metric.end_evaluation_time ?? null,
    };
  });
}

/**
 * 整理 overview：总分、层级、百分位、维度、待处理问题。
 *
 * @param {object} overview 平台返回的 overview 的 data 字段
 * @returns {object}
 */
function normalizeOverview(overview = {}) {
  const dimensions = (overview.dimensions || []).map(dimension => ({
    name: dimension.name || null,
    score: hasValue(dimension.score) ? dimension.score : null,
    status: dimension.status || null,
    statusLabel: readStatus(dimension.status).label,
    level: readStatus(dimension.status).level,
    weight: dimension.weight || null,
  }));

  const topIssues = (overview.top_issues?.issues || []).map(issue => ({
    metricCode: issue.metric_code || null,
    metricName: issue.metric_name || null,
    description: issue.description || null,
    percentile: issue.percentile || null,
    rank: issue.rank ?? null,
    evaluateDurationDays: issue.evaluate_duration_days ?? null,
  }));

  return {
    spsScore: hasValue(overview.sps_score) ? overview.sps_score : null,
    spsTier: overview.sps_tier || null,
    spsTierText: overview.sps_tier_text || null,
    peerPercentile: overview.peer_percentile || null,
    primaryCategory: overview.primary_category
      ? {
        categoryId: overview.primary_category.category_id || null,
        categoryName: overview.primary_category.category_name || null,
      }
      : null,
    evaluateDurationDays: overview.evaluate_duration_days ?? null,
    startEvaluationTime: overview.start_evaluation_time ?? null,
    endEvaluationTime: overview.end_evaluation_time ?? null,
    updateTime: overview.update_time ?? null,
    dimensions,
    topIssues,
    issuesSummary: overview.top_issues?.summary || null,
    benefits: (overview.benefits || []).map(benefit => ({
      benefitName: benefit.benefit_name || null,
      isUnlocked: Boolean(benefit.is_unlocked),
      unlockScore: benefit.unlock_score || null,
    })),
  };
}

/**
 * 整体状态。
 *
 * ★ 判据用平台的 status，不用我们自己算的分。
 *   全部优秀/良好 → good；出现较差/很差 → poor；其余 → watch。
 *   平台没给任何指标时 → unknown（不是 good）。
 *
 * @param {Array<object>} metrics
 * @returns {object}
 */
function overallStatus(metrics = []) {
  if (!metrics.length) {
    return { level: 'unknown', label: '未知', breachCount: 0, total: 0 };
  }
  let breachCount = 0;
  let unknownCount = 0;
  for (const metric of metrics) {
    if (metric.level === 'poor') breachCount += 1;
    else if (metric.level === 'unknown') unknownCount += 1;
  }
  const level = breachCount > 0 ? 'poor' : unknownCount === metrics.length ? 'unknown' : 'good';
  const labels = { poor: '需改进', unknown: '未知', good: '良好' };
  return { level, label: labels[level], breachCount, total: metrics.length };
}

/**
 * 生成健康结论（信号）。
 *
 * 沿用 portfolio-diagnosis 的形状（code/severity/title/detail/action），
 * 这样前端两个平台能用同一套渲染逻辑。
 *
 * @param {object} options
 * @returns {Array<object>}
 */
function buildSignals({ overview = {}, metrics = [] } = {}) {
  const signals = [];

  // 总分与层级 —— 这是 TikTok 官方给的综合评价。
  if (hasValue(overview.spsScore)) {
    const score = Number(overview.spsScore);
    const tier = overview.spsTierText || overview.spsTier || '';
    const percentile = overview.peerPercentile;
    signals.push({
      code: 'TIKTOK_SPS_SCORE',
      severity: score >= 80 ? 'good' : score >= 60 ? 'warning' : 'critical',
      kind: 'data-fact',
      title: '店铺健康总分（SPS）',
      detail: `总分 ${score}${tier ? `（${tier}）` : ''}`
        + `${percentile ? `，同层级排在 ${percentile}` : ''}。`
        + '这是 TikTok 官方按自身标准算出的店铺健康分，达标线也由平台给出。',
      action: score >= 80
        ? null
        : '先看下面的「最需要处理的问题」，那是平台指出���、影响评分最大的几项。',
    });
  }

  // 最需要处理的问题 —— 平台直接排好序了。
  for (const issue of (overview.topIssues || []).slice(0, 5)) {
    signals.push({
      code: 'TIKTOK_SPS_ISSUE',
      severity: 'warning',
      kind: 'data-fact',
      title: `待改进：${issue.metricName || issue.metricCode || '未命名指标'}`,
      detail: `${issue.description || '平台未给出说明'}`
        + `${issue.percentile ? `（处于 ${issue.percentile} 水平）` : ''}。`,
      action: '到 TikTok 卖家中心的店铺健康页看该项的官方建议，那里给的处理办法比这里更具体。',
    });
  }

  // 各项指标：逐条列出，未知的明确标出。
  for (const metric of metrics) {
    if (metric.level === 'poor') {
      signals.push({
        code: 'TIKTOK_SPS_METRIC_POOR',
        severity: 'critical',
        kind: 'data-fact',
        title: `${metric.metricName}：${metric.displayValue}`,
        detail: `平台判定为${metric.statusLabel}`
          + `${metric.topReason ? `：${metric.topReason}` : ''}。`
          + `（达标线：优秀 ≤ ${metric.excellentThreshold ?? '—'}，较差 > ${metric.poorThreshold ?? '—'}）`,
        action: '这一项直接拖低店铺健康分，优先处理。',
      });
    } else if (metric.level === 'watch') {
      signals.push({
        code: 'TIKTOK_SPS_METRIC_WATCH',
        severity: 'warning',
        kind: 'data-fact',
        title: `${metric.metricName}：${metric.displayValue}`,
        detail: `平台判定为${metric.statusLabel}`
          + `${metric.topReason ? `：${metric.topReason}` : ''}。`,
        action: null,
      });
    }
  }

  // 平台没给数据的指标 —— 明确说"没有"，不猜。
  const unknownMetrics = metrics.filter(metric => metric.level === 'unknown');
  if (unknownMetrics.length) {
    signals.push({
      code: 'TIKTOK_SPS_METRIC_UNKNOWN',
      severity: 'neutral',
      kind: 'data-fact',
      title: `有 ${unknownMetrics.length} 项指标平台没有给数据`,
      detail: `包括 ${unknownMetrics.map(metric => metric.metricName).join('、')}。`
        + '这些项不是"没问题"，是"平台这次没报" —— 页面不替它下结论。',
      action: null,
    });
  }

  return signals;
}

module.exports = {
  STATUS_TEXT,
  buildSignals,
  formatValue,
  hasValue,
  normalizeMetrics,
  normalizeOverview,
  overallStatus,
  readStatus,
};
