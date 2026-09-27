'use strict';

const DEFAULT_TOLERANCE = 1e-9;

const METRIC_SPECS = [
  ['impressions', 'Impressions', 0],
  ['clicks', 'Clicks', 0],
  ['broadOrders', 'Broad Orders', 0],
  ['directOrders', 'Direct Orders', 0],
  ['broadUnits', 'Broad Units', 0],
  ['directUnits', 'Direct Units', 0],
  ['broadGmv', 'Broad GMV', DEFAULT_TOLERANCE],
  ['directGmv', 'Direct GMV', DEFAULT_TOLERANCE],
  ['expense', 'Expense', DEFAULT_TOLERANCE],
  ['ctr', 'CTR', DEFAULT_TOLERANCE],
  ['broadCvr', 'Broad CVR', DEFAULT_TOLERANCE],
  ['directCvr', 'Direct CVR', DEFAULT_TOLERANCE],
  ['broadRoas', 'Broad ROAS', DEFAULT_TOLERANCE],
  ['directRoas', 'Direct ROAS', DEFAULT_TOLERANCE],
  ['addToCart', 'Add To Cart', 0],
  ['addToCartRate', 'Add To Cart Rate', DEFAULT_TOLERANCE],
  ['costPerConversion', 'Cost Per Conversion', DEFAULT_TOLERANCE],
  ['costPerDirectConversion', 'Cost Per Direct Conversion', DEFAULT_TOLERANCE],
  ['cpc', 'Cost Per Click', DEFAULT_TOLERANCE],
  ['broadAcos', 'Broad ACOS', DEFAULT_TOLERANCE],
  ['directAcos', 'Direct ACOS', DEFAULT_TOLERANCE],
];

function finiteNumberOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function compareCampaignMetric({ key, label, actual, expected, tolerance = DEFAULT_TOLERANCE }) {
  const actualNumber = finiteNumberOrNull(actual);
  const expectedNumber = finiteNumberOrNull(expected);
  if (expectedNumber === null) {
    return {
      key,
      label,
      status: 'SKIPPED',
      actual: actualNumber,
      expected: null,
      tolerance,
      delta: null,
      pass: null,
      comparable: false,
    };
  }
  if (actualNumber === null) {
    return {
      key,
      label,
      status: 'UNAVAILABLE',
      actual: null,
      expected: expectedNumber,
      tolerance,
      delta: null,
      pass: null,
      comparable: false,
    };
  }

  const delta = actualNumber - expectedNumber;
  const pass = Math.abs(delta) <= Number(tolerance);
  return {
    key,
    label,
    status: pass ? 'PASS' : 'FAIL',
    actual: actualNumber,
    expected: expectedNumber,
    tolerance: Number(tolerance),
    delta,
    pass,
    comparable: true,
  };
}

function evaluateProductAdCampaignReconciliation({ actual, expected, tolerances = {} }) {
  const checks = METRIC_SPECS
    .filter(([key]) => expected && expected[key] !== undefined)
    .map(([key, label, defaultTolerance]) => compareCampaignMetric({
      key,
      label,
      actual: actual ? actual[key] : null,
      expected: expected[key],
      tolerance: tolerances[key] ?? defaultTolerance,
    }));

  const failed = checks.filter(check => check.status === 'FAIL');
  const unavailable = checks.filter(check => check.status === 'UNAVAILABLE');
  const passed = checks.filter(check => check.status === 'PASS');
  const status = failed.length > 0 ? 'FAIL' : (unavailable.length > 0 ? 'INCOMPLETE' : 'PASS');

  return {
    status,
    pass: status === 'PASS',
    complete: unavailable.length === 0,
    checkCount: checks.length,
    passedCount: passed.length,
    failedCount: failed.length,
    unavailableCount: unavailable.length,
    checks,
  };
}

module.exports = {
  METRIC_SPECS,
  finiteNumberOrNull,
  compareCampaignMetric,
  evaluateProductAdCampaignReconciliation,
};
