'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { normalizeAccountHealth } = require('../src/sync-account-health');
const { buildFunnelRows } = require('../src/shop-funnel');

test('the shop\'s score and fulfilment are read from the platform\'s names', () => {
  const health = normalizeAccountHealth({
    response: {
      overall_performance: { rating: 4.6, fulfillment_failed: 2, listing_failed: 0, custom_service_failed: 1 },
      metric_list: [
        { metric_name: 'shop_rating', current_period: 4.6, last_period: 4.5 },
        { metric_name: 'return_refund_rate', current_period: 0.0231, last_period: 0.019 },
        { metric_name: 'cancellation_rate', current_period: 0.041, last_period: 0.05 },
        { metric_name: 'late_shipment_rate', current_period: 0.007, last_period: 0.011 },
        { metric_name: 'csat_rate', current_period: 0.92, last_period: 0.9 },
        { metric_name: 'severe_listing_violations', current_period: 1, last_period: 0 },
        { metric_name: 'a_metric_we_do_not_know', current_period: 99, last_period: 99 },
      ],
    },
  });
  assert.equal(health.shopRating, 4.6);
  assert.equal(health.fulfillmentFailed, 2);
  assert.equal(health.returnRefundRate, 0.0231);
  assert.equal(health.cancellationRate, 0.041);
  assert.equal(health.lateShipmentRate, 0.007);
  assert.equal(health.csatRate, 0.92);
  assert.equal(health.severeListingViolations, 1);
  // A metric we have nowhere to put is not carried along.
  assert.equal(health.aMetricWeDoNotKnow, undefined);
});

test('a metric the platform did not report reads as missing, not as zero', () => {
  const health = normalizeAccountHealth({
    response: { overall_performance: {}, metric_list: [] },
  });
  assert.equal(health.shopRating, null);
  assert.equal(health.returnRefundRate, null);
});

test('the score appears in the funnel as a reading of its own', () => {
  const { rows } = buildFunnelRows(
    [{ eventDate: '2026-11-01', shopRating: 4.6, returnRefundRate: 0.023, cancellationRate: 0.04 }],
    { shopHealth: true },
  );
  const rating = rows.find(row => row.group === 'shopHealth' && row.key === 'shopRating');
  assert.ok(rating, 'the score must be one of the readings');
  assert.equal(rating.values[0], 4.6);
});

test('without a connection the health readings read as missing', () => {
  const { rows } = buildFunnelRows(
    [{ eventDate: '2026-11-01' }],
    { shopHealth: false },
  );
  const rating = rows.find(row => row.group === 'shopHealth' && row.key === 'shopRating');
  assert.ok(rating, 'the score must still be listed');
  assert.equal(rating.values[0], null, 'a blank is not a zero');
});
