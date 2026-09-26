'use strict';

const { safeDiv } = require('./metrics');

const MATURITY_DEFAULTS = Object.freeze({
  minimumLearningDays: 7,
  longRunningDays: 14,
  matureDirectOrdersReference: 25,
  allocationMeanAbsDeltaStable: 0.12,
  cvrCoefficientVariationStable: 0.35,
  roasCoefficientVariationStable: 0.40,
  orderSourceConcentrationStable: 0.60,
  scaleTrafficIncreaseMinimum: 0.20,
  scaleEfficiencyRetentionMinimum: 0.80,
  stableEvidenceMinimum: 4,
  leaderContinuityMinimum: 0.60,
});

function number(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function coefficientVariation(values = []) {
  const xs = values.map(number).filter(Number.isFinite);
  if (xs.length < 2) return null;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  if (mean <= 0) return null;
  const variance = xs.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / xs.length;
  return Math.sqrt(variance) / mean;
}

function dailyMetric(row, names) {
  for (const name of names) {
    if (row[name] != null) return number(row[name]);
  }
  return 0;
}

function optionalDailyMetric(row, names) {
  for (const name of names) {
    if (row[name] != null) return number(row[name]);
  }
  return null;
}

function allocationStability(itemDailyRows = []) {
  const byDate = new Map();
  for (const row of itemDailyRows) {
    const date = String(row.date || row.event_date || '').slice(0, 10);
    if (!date) continue;
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push(row);
  }
  const dates = [...byDate.keys()].sort();
  if (dates.length < 2) return { meanAbsDelta: null, days: dates.length };

  const shares = dates.map(date => {
    const rows = byDate.get(date);
    const total = rows.reduce((sum, row) => sum + dailyMetric(row, ['expense', 'spend']), 0);
    const map = new Map();
    for (const row of rows) {
      const id = String(row.item_id ?? row.itemId ?? '');
      if (!id) continue;
      map.set(id, safeDiv(dailyMetric(row, ['expense', 'spend']), total));
    }
    return map;
  });

  let deltaSum = 0;
  let transitions = 0;
  for (let i = 1; i < shares.length; i += 1) {
    const ids = new Set([...shares[i - 1].keys(), ...shares[i].keys()]);
    if (!ids.size) continue;
    let dayDelta = 0;
    for (const id of ids) dayDelta += Math.abs((shares[i].get(id) || 0) - (shares[i - 1].get(id) || 0));
    deltaSum += dayDelta / 2;
    transitions += 1;
  }
  return { meanAbsDelta: transitions ? deltaSum / transitions : null, days: dates.length };
}

function orderSourceConcentration(itemDailyRows = []) {
  const totals = new Map();
  let all = 0;
  for (const row of itemDailyRows) {
    const id = String(row.item_id ?? row.itemId ?? '');
    if (!id) continue;
    const orders = dailyMetric(row, ['direct_order', 'directOrders']);
    totals.set(id, (totals.get(id) || 0) + orders);
    all += orders;
  }
  const sorted = [...totals.values()].sort((a, b) => b - a);
  return {
    topTwoShare: all > 0 ? safeDiv((sorted[0] || 0) + (sorted[1] || 0), all) : null,
    directOrders: all,
  };
}

function leaderContinuity(itemDailyRows = []) {
  const byDate = new Map();
  for (const row of itemDailyRows) {
    const date = String(row.date || row.event_date || '').slice(0, 10);
    const id = String(row.item_id ?? row.itemId ?? '');
    if (!date || !id) continue;
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push(row);
  }
  const leaders = [...byDate.keys()].sort().map(date => {
    const rows = byDate.get(date);
    const ranked = [...rows].sort((a, b) => {
      const orderDiff = dailyMetric(b, ['direct_order', 'directOrders']) - dailyMetric(a, ['direct_order', 'directOrders']);
      if (orderDiff) return orderDiff;
      return dailyMetric(b, ['expense', 'spend']) - dailyMetric(a, ['expense', 'spend']);
    });
    return ranked[0] ? String(ranked[0].item_id ?? ranked[0].itemId) : null;
  }).filter(Boolean);
  const counts = new Map();
  for (const id of leaders) counts.set(id, (counts.get(id) || 0) + 1);
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const leaderItemId = ranked[0] ? ranked[0][0] : null;
  const leaderDays = ranked[0] ? ranked[0][1] : 0;
  return {
    leaderItemId,
    leaderDays,
    observedDays: leaders.length,
    continuity: leaders.length ? leaderDays / leaders.length : null,
    distinctLeaders: counts.size,
  };
}

function maturityExplanations({ status, evidence, diagnostics, config, days, directOrders }) {
  const blockers = [];
  const positives = [];
  if (days < config.minimumLearningDays) blockers.push(`运行 ${days} 天，尚未达到最低 ${config.minimumLearningDays} 天观察窗口`);
  if (!evidence.sample) blockers.push(`Direct Orders ${number(directOrders)}，低于内部成熟度参考 ${config.matureDirectOrdersReference}`);
  else positives.push('Direct Orders 样本达到内部成熟度参考');
  if (evidence.allocation === false) blockers.push('SKU 花费占比仍在明显切换，分配尚未收敛');
  else if (evidence.allocation === true) positives.push('SKU 花费分配已趋于稳定');
  if (evidence.orderSource === false) blockers.push('主要 Direct Orders 来源仍较分散');
  else if (evidence.orderSource === true) positives.push('主要订单来源已形成集中度');
  if (evidence.leaderContinuity === false) blockers.push('主力 SKU 仍频繁切换，连续性不足');
  else if (evidence.leaderContinuity === true) positives.push('主力 SKU 已连续多日保持领先');
  if (evidence.cvr === false) blockers.push('Direct CVR 日间波动仍较大');
  else if (evidence.cvr === true) positives.push('Direct CVR 已趋于稳定');
  if (evidence.roas === false) blockers.push('Direct ROAS 日间波动仍较大');
  else if (evidence.roas === true) positives.push('Direct ROAS 已趋于稳定');
  if (evidence.scale === false) blockers.push('流量扩大后 CVR/ROAS 保持不足，扩量承接尚未验证');
  else if (evidence.scale === true) positives.push('流量扩大后 CVR/ROAS 仍能维持');
  if (evidence.scale == null) blockers.push('尚未出现可评估的流量扩大量，扩量承接待验证');
  return {
    headline: status === 'STABLE'
      ? '多维证据已开始共同收敛'
      : status === 'UNSTABLE'
        ? '样本已较充分，但关键效率/分配证据仍长期波动'
        : status === 'LEARNING'
          ? '仍处于最低学习观察窗口'
          : '已进入收敛观察，但证据尚不足以判定稳定',
    blockers,
    positives,
    nextValidation: blockers.slice(0, 3),
    leader: diagnostics.leader,
  };
}

function scaleResilience(dailyRows = [], config = MATURITY_DEFAULTS) {
  if (dailyRows.length < 4) return { evaluable: false, pass: null };
  const sorted = [...dailyRows].sort((a, b) =>
    String(a.date || a.event_date || '').localeCompare(String(b.date || b.event_date || '')));
  const mid = Math.floor(sorted.length / 2);
  const first = sorted.slice(0, mid);
  const last = sorted.slice(mid);
  const aggregate = rows => {
    const clicks = rows.reduce((s, r) => s + dailyMetric(r, ['clicks', 'click']), 0);
    const orders = rows.reduce((s, r) => s + dailyMetric(r, ['direct_order', 'directOrders']), 0);
    const expense = rows.reduce((s, r) => s + dailyMetric(r, ['expense', 'spend']), 0);
    const gmvs = rows.map(r => optionalDailyMetric(r, ['direct_gmv', 'directGmv']));
    const gmv = gmvs.some(value => value === null) ? null : gmvs.reduce((s, value) => s + value, 0);
    return { clicks, cvr: safeDiv(orders, clicks), roas: gmv === null ? null : safeDiv(gmv, expense) };
  };
  const a = aggregate(first);
  const b = aggregate(last);
  if (a.clicks <= 0 || b.clicks <= a.clicks * (1 + config.scaleTrafficIncreaseMinimum)) {
    return { evaluable: false, pass: null, first: a, last: b };
  }
  const cvrRetention = a.cvr > 0 ? b.cvr / a.cvr : null;
  const roasRetention = a.roas !== null && b.roas !== null && a.roas > 0 ? b.roas / a.roas : null;
  const pass = cvrRetention != null && roasRetention != null &&
    cvrRetention >= config.scaleEfficiencyRetentionMinimum &&
    roasRetention >= config.scaleEfficiencyRetentionMinimum;
  return { evaluable: true, pass, cvrRetention, roasRetention, first: a, last: b };
}

function evaluateCampaignMaturity({ days = 0, directOrders = 0, dailyRows = [], itemDailyRows = [], settings = {} }) {
  const cfg = { ...MATURITY_DEFAULTS, ...settings };
  const allocation = allocationStability(itemDailyRows);
  const source = orderSourceConcentration(itemDailyRows);
  const leader = leaderContinuity(itemDailyRows);
  const cvrValues = dailyRows.map(row => safeDiv(
    dailyMetric(row, ['direct_order', 'directOrders']),
    dailyMetric(row, ['clicks', 'click']),
  )).filter(value => value > 0);
  const roasValues = dailyRows.map(row => {
    const sourceRoas = optionalDailyMetric(row, ['direct_roi', 'direct_roas', 'directRoas']);
    if (sourceRoas !== null) return sourceRoas;
    const gmv = optionalDailyMetric(row, ['direct_gmv', 'directGmv']);
    return gmv === null ? null : safeDiv(gmv, dailyMetric(row, ['expense', 'spend']));
  }).filter(value => value !== null && value > 0);
  const cvrCv = coefficientVariation(cvrValues);
  const roasCv = coefficientVariation(roasValues);
  const scale = scaleResilience(dailyRows, cfg);

  const evidence = {
    sample: number(directOrders) >= cfg.matureDirectOrdersReference,
    allocation: allocation.meanAbsDelta != null && allocation.meanAbsDelta <= cfg.allocationMeanAbsDeltaStable,
    orderSource: source.topTwoShare != null && source.topTwoShare >= cfg.orderSourceConcentrationStable,
    leaderContinuity: leader.continuity != null && leader.continuity >= cfg.leaderContinuityMinimum,
    cvr: cvrCv != null && cvrCv <= cfg.cvrCoefficientVariationStable,
    roas: roasCv != null && roasCv <= cfg.roasCoefficientVariationStable,
    scale: scale.evaluable ? scale.pass : null,
  };
  const evaluated = Object.values(evidence).filter(value => value != null);
  const passed = evaluated.filter(Boolean).length;
  const evidenceRatio = evaluated.length ? passed / evaluated.length : 0;
  const confidence = number(directOrders) >= cfg.matureDirectOrdersReference && days >= cfg.minimumLearningDays
    ? 'HIGH'
    : number(directOrders) > 0 || dailyRows.length > 0
      ? 'MEDIUM'
      : 'LOW';

  let status;
  if (days < cfg.minimumLearningDays) status = 'LEARNING';
  else if (passed >= cfg.stableEvidenceMinimum && evidenceRatio >= 0.67) status = 'STABLE';
  else if (days >= cfg.longRunningDays && number(directOrders) >= cfg.matureDirectOrdersReference &&
    evaluated.length >= 4 && evidenceRatio < 0.5) status = 'UNSTABLE';
  else status = 'CONVERGING';

  const diagnostics = {
    allocationMeanAbsDelta: allocation.meanAbsDelta,
    orderSourceTopTwoShare: source.topTwoShare,
    leader,
    cvrCoefficientVariation: cvrCv,
    roasCoefficientVariation: roasCv,
    scale,
  };
  const explanation = maturityExplanations({ status, evidence, diagnostics, config: cfg, days, directOrders });

  return {
    status,
    confidence,
    evidence,
    evidencePassed: passed,
    evidenceEvaluated: evaluated.length,
    evidenceRatio,
    diagnostics,
    explanation,
    notes: [
      '7 days is a minimum observation window, not a stable-state guarantee.',
      '25 Direct Orders is an internal maturity/confidence reference, not an official Shopee learning-complete rule.',
      'A/B/C traffic is an internal analytical model, not a Shopee reporting field.',
    ],
  };
}

function evaluateSignalConfidence(item, { days = 7, matureOrdersReference = 25 } = {}) {
  const directOrders = dailyMetric(item, ['direct_order', 'directOrders']);
  const clicks = dailyMetric(item, ['clicks', 'click']);
  const expense = dailyMetric(item, ['expense', 'spend']);
  const directGmv = optionalDailyMetric(item, ['direct_gmv', 'directGmv']);
  const sourceDirectRoas = optionalDailyMetric(item, ['direct_roi', 'direct_roas', 'directRoas']);
  const directRoas = sourceDirectRoas ?? (directGmv === null ? null : safeDiv(directGmv, expense));
  const cvr = safeDiv(directOrders, clicks);
  const confidenceScore = Math.min(1,
    0.65 * Math.min(1, directOrders / matureOrdersReference) +
    0.20 * Math.min(1, clicks / Math.max(1, matureOrdersReference * 8)) +
    0.15 * Math.min(1, days / 14));
  return {
    signal: { directRoas, cvr, directOrders },
    confidenceScore,
    confidence: confidenceScore >= 0.75 ? 'HIGH' : confidenceScore >= 0.4 ? 'MEDIUM' : 'LOW',
  };
}

module.exports = {
  MATURITY_DEFAULTS,
  coefficientVariation,
  allocationStability,
  orderSourceConcentration,
  leaderContinuity,
  maturityExplanations,
  scaleResilience,
  evaluateCampaignMaturity,
  evaluateSignalConfidence,
  optionalDailyMetric,
};
