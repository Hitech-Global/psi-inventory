'use strict';

function relativeDelta(actual, expected) {
  const a = Number(actual);
  const e = Number(expected);
  if (!Number.isFinite(a) || !Number.isFinite(e)) return null;
  if (e === 0) return a === 0 ? 0 : null;
  return (a - e) / e;
}

function compareMetric({ key, label, actual, expected, tolerance = 0.01, unit = null }) {
  const delta = relativeDelta(actual, expected);
  const comparable = delta !== null;
  return {
    key,
    label,
    actual: Number(actual),
    expected: Number(expected),
    unit,
    tolerance,
    delta,
    deltaPct: delta === null ? null : delta * 100,
    pass: comparable && Math.abs(delta) <= tolerance,
    comparable,
  };
}

function evaluateSellerCentreReconciliation({ actual, expected, tolerances = {} }) {
  const specs = [
    ['sales', 'Shop BI Sales', 'currency'],
    ['orders', 'Shop BI Orders', 'count'],
    ['adExpense', 'Ads Expense', 'currency'],
    ['broadOrders', 'Broad Orders', 'count'],
    ['broadGmv', 'Broad GMV', 'currency'],
    ['directOrders', 'Direct Orders', 'count'],
    ['directGmv', 'Direct GMV', 'currency'],
  ];
  const checks = specs
    .filter(([key]) => expected[key] !== undefined && expected[key] !== null)
    .map(([key, label, unit]) => compareMetric({
      key,
      label,
      actual: actual[key],
      expected: expected[key],
      tolerance: Number(tolerances[key] ?? 0.01),
      unit,
    }));

  const failed = checks.filter(row => !row.pass);
  return {
    pass: checks.length > 0 && failed.length === 0,
    checkCount: checks.length,
    failedCount: failed.length,
    checks,
  };
}

module.exports = { relativeDelta, compareMetric, evaluateSellerCentreReconciliation };
