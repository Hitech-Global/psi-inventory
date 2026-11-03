'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { evaluateMeasures, overallStatus, violationTotal } = require('../src/shop-health-evaluation');

test('a figure is judged against the standard the platform set', () => {
  const measures = evaluateMeasures(
    { shopRating: 4.94, returnRefundRate: 0.0066, cancellationRate: 0.0016 },
    {
      shopRating: { value: 4.4, comparator: '>=' },
      returnRefundRate: { value: 0.05, comparator: '<' },
      cancellationRate: { value: 0.05, comparator: '<' },
    },
  );
  const byKey = Object.fromEntries(measures.map(measure => [measure.key, measure]));
  assert.equal(byKey.shopRating.status, 'met');
  assert.equal(byKey.returnRefundRate.status, 'met');
  assert.equal(byKey.cancellationRate.status, 'met');
  // The standard is shown with the figure, so a reader can see what it was
  // measured against.
  assert.equal(byKey.shopRating.target, 4.4);
  assert.equal(byKey.shopRating.comparator, '>=');
});

test('a figure on the wrong side of its standard is a breach', () => {
  const measures = evaluateMeasures(
    { shopRating: 3.9, lateShipmentRate: 0.12 },
    {
      shopRating: { value: 4.4, comparator: '>=' },
      lateShipmentRate: { value: 0.1, comparator: '<' },
    },
  );
  const byKey = Object.fromEntries(measures.map(measure => [measure.key, measure]));
  assert.equal(byKey.shopRating.status, 'breached');
  assert.equal(byKey.lateShipmentRate.status, 'breached');
});

test('a figure the platform did not report is missing, not a failure', () => {
  const measures = evaluateMeasures(
    { shopRating: 4.9 },
    {
      shopRating: { value: 4.4, comparator: '>=' },
      csatRate: { value: 0.7, comparator: '>=' },
    },
  );
  const csat = measures.find(measure => measure.key === 'csatRate');
  assert.equal(csat.status, 'unknown');
  assert.equal(csat.value, null);
});

test('a shop whose score is below its standard is not in good standing', () => {
  const measures = evaluateMeasures(
    { shopRating: 3.9, csatRate: 0.95 },
    {
      shopRating: { value: 4.4, comparator: '>=' },
      csatRate: { value: 0.7, comparator: '>=' },
    },
  );
  const standing = overallStatus(measures);
  assert.equal(standing.status, 'poor');
  assert.equal(standing.breachCount, 1);
});

test('a shop with nothing to judge has no standing', () => {
  const measures = evaluateMeasures({}, {});
  assert.equal(overallStatus(measures).status, 'unknown');
});

test('a shop that met every standard is in good standing', () => {
  const measures = evaluateMeasures(
    { shopRating: 4.9, csatRate: 0.95, cancellationRate: 0.001 },
    {
      shopRating: { value: 4.4, comparator: '>=' },
      csatRate: { value: 0.7, comparator: '>=' },
      cancellationRate: { value: 5, comparator: '<' },
    },
  );
  assert.equal(overallStatus(measures).status, 'good');
});

test('the violations are counted together', () => {
  assert.equal(violationTotal({ severeListingViolations: 1, spamListings: 2 }), 3);
  assert.equal(violationTotal({}), null);
  assert.equal(violationTotal({ severeListingViolations: null, otherListingViolations: null }), null);
});
