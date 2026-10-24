'use strict';

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function ratio(numerator, denominator) {
  const n = numberOrNull(numerator);
  const d = numberOrNull(denominator);
  if (n === null || d === null || d === 0) return null;
  return n / d;
}

function evaluateItemCoverage({
  campaignExpense,
  itemExpense,
  membershipCount,
  performanceItemCount,
}) {
  const spendCoverage = ratio(itemExpense, campaignExpense);
  const itemCoverage = membershipCount > 0
    ? ratio(performanceItemCount, membershipCount)
    : null;

  const warnings = [];
  if (spendCoverage !== null && (spendCoverage < 0.97 || spendCoverage > 1.03)) {
    warnings.push({
      code: 'ITEM_SPEND_COVERAGE_GAP',
      severity: 'warning',
      message: '商品层花费合计与广告组花费存在明显差异，先检查分页、成员快照和归因口径。',
    });
  }
  if (itemCoverage !== null && itemCoverage < 1) {
    warnings.push({
      code: 'MEMBERSHIP_PERFORMANCE_GAP',
      severity: 'info',
      message: '部分广告组成员在所选周期没有商品层 performance；这不代表它们已被移出广告组。',
    });
  }

  return {
    spendCoverage,
    itemCoverage,
    membershipCount: Number(membershipCount || 0),
    performanceItemCount: Number(performanceItemCount || 0),
    warnings,
  };
}

function hoursSince(value, now = new Date()) {
  if (!value) return null;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return null;
  return Math.max(0, (now.getTime() - time) / 3600000);
}

function freshnessState(value, {
  now = new Date(),
  freshHours = 6,
  staleHours = 30,
} = {}) {
  const hours = hoursSince(value, now);
  if (hours === null) return { state: 'MISSING', hours: null };
  if (hours <= freshHours) return { state: 'FRESH', hours };
  if (hours <= staleHours) return { state: 'AGING', hours };
  return { state: 'STALE', hours };
}

function buildSystemWarnings(status, now = new Date()) {
  const warnings = [];
  for (const source of status.sources || []) {
    const freshness = freshnessState(source.lastSyncedAt, { now });
    if (freshness.state === 'MISSING') {
      warnings.push({
        code: 'SOURCE_NEVER_SYNCED',
        severity: 'warning',
        source: source.source,
        message: `${source.source} 尚无同步记录。`,
      });
    } else if (freshness.state === 'STALE') {
      warnings.push({
        code: 'SOURCE_STALE',
        severity: 'warning',
        source: source.source,
        message: `${source.source} 数据已超过 30 小时未更新。`,
      });
    }
  }

  for (const token of status.tokens || []) {
    const expiresAt = token.expiresAt ? new Date(token.expiresAt) : null;
    if (!expiresAt || Number.isNaN(expiresAt.getTime())) {
      warnings.push({
        code: 'TOKEN_EXPIRY_UNKNOWN',
        severity: 'warning',
        source: token.appRole,
        message: `${token.appRole} Token 过期时间未知。`,
      });
      continue;
    }
    const remainingHours = (expiresAt.getTime() - now.getTime()) / 3600000;
    if (remainingHours <= 0) {
      warnings.push({
        code: 'TOKEN_EXPIRED',
        severity: 'error',
        source: token.appRole,
        message: `${token.appRole} Token 已过期，下一次同步需要自动刷新。`,
      });
    } else if (remainingHours <= 1) {
      warnings.push({
        code: 'TOKEN_EXPIRING_SOON',
        severity: 'info',
        source: token.appRole,
        message: `${token.appRole} Token 将在 1 小时内过期，系统会在同步前自动刷新。`,
      });
    }
    if (token.refreshError) {
      warnings.push({
        code: 'TOKEN_REFRESH_ERROR',
        severity: 'error',
        source: token.appRole,
        message: `${token.appRole} 最近一次 Token 刷新失败：${token.refreshError}`,
      });
    }
  }
  return warnings;
}

module.exports = {
  numberOrNull,
  ratio,
  evaluateItemCoverage,
  hoursSince,
  freshnessState,
  buildSystemWarnings,
};
