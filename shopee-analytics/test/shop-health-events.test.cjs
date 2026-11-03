'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  normalizeMetricSource,
  normalizePenaltyPoints,
  normalizeListingsWithIssues,
  normalizeLateOrders,
} = require('../src/sync-account-health-events');

test('the detail behind a figure names the orders and the reason', () => {
  const { events, totalCount } = normalizeMetricSource({
    metrics_id: 42,
    cancellation_order_list: [
      { order_sn: '261028S3QC79RJ', cancellation_type: 1, detailed_reason: 10010 },
    ],
    total_count: 1,
  }, 'cancellationRate');
  assert.equal(totalCount, 1);
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'metric_source');
  assert.equal(events[0].metricKey, 'cancellationRate');
  assert.equal(events[0].orderSn, '261028S3QC79RJ');
  assert.equal(events[0].reasonCode, '10010');
});

test('each list is read by the figure it belongs to', () => {
  const { events } = normalizeMetricSource({
    nfr_order_list: [{ order_sn: 'A1', detailed_reason: 10020 }],
    return_refund_order_list: [{ order_sn: 'A2', detailed_reason: 10020 }],
    total_count: 2,
  }, 'x');
  const byMetric = Object.fromEntries(events.map(event => [event.metricKey, event.orderSn]));
  assert.equal(byMetric.nonFulfillmentRate, 'A1');
  assert.equal(byMetric.returnRefundRate, 'A2');
});

test('the points deducted are kept with their severity', () => {
  const events = normalizePenaltyPoints({
    penalty_point_list: [{ penalty_id: 7, penalty_name: '迟发', penalty_amount: 2, severity: 'major' }],
    total_count: 1,
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'penalty_point');
  assert.equal(events[0].eventId, '7');
  assert.equal(events[0].title, '迟发');
  assert.equal(events[0].severity, 'major');
});

test('the items with problems are kept with the item they belong to', () => {
  const events = normalizeListingsWithIssues({
    listing_list: [{ item_id: 88, item_name: 'A product', reason: 'banned', issue_type: 'prohibited' }],
    total_count: 1,
  });
  assert.equal(events[0].kind, 'listing_issue');
  assert.equal(events[0].itemId, 88);
  assert.equal(events[0].title, 'A product');
  assert.equal(events[0].reasonCode, 'prohibited');
});

test('the late orders are kept with the times they were meant for', () => {
  const events = normalizeLateOrders({
    late_order_list: [{ order_sn: 'L1', arrange_pick_up_time: 1791180000, actual_pick_up_time: 1791191464 }],
    total_count: 1,
  });
  assert.equal(events[0].kind, 'late_order');
  assert.equal(events[0].orderSn, 'L1');
  assert.ok(events[0].detail.includes('计划'), 'the detail must say what was planned');
});
