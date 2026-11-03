'use strict';

const { ENDPOINTS } = require('./catalog');

/**
 * A shop's score and how well it is being run.
 *
 * These come from the account health endpoint, which only ERP System
 * applications may call — an advertising application is refused. The
 * numbers are the shop's rating, how quickly it ships, how much of its
 * orders are cancelled, and the rest: the things a reader wants to know
 * before trusting a shop's figures.
 *
 * The endpoint answers with a current period and a previous one rather
 * than a day by day series, so each fetch is kept as the day's reading.
 * Over days that becomes a trend, which is more than either number alone.
 */

function unwrap(payload) {
  return payload && payload.response ? payload.response : payload || {};
}

function numberOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * The metrics the endpoint reports, and where each one is kept.
 *
 * The names come from the platform and are not translated here: they are
 * keys, and the ones a reader sees are given their own names where they
 * are shown.
 */
/**
 * What each metric is, and where it is kept.
 *
 * The platform reports a rate as a percentage — a return rate of 0.66
 * means 0.66 per cent, not 66 — while this system's percentages are
 * fractions, because that is how the other sources report them. So a
 * percentage is divided by a hundred on the way in, which keeps the two
 * comparable without either of them being changed.
 *
 * The kind is named rather than read from the platform's own unit field,
 * because the unit field does not distinguish a rate from a score: the
 * shop's rating is reported with the same unit as a rate, and a rating of
 * 4.94 divided by a hundred would be nonsense.
 */
const METRIC_COLUMNS = Object.freeze({
  csat_rate: { column: 'csatRate', kind: 'percent' },
  response_rate: { column: 'responseRate', kind: 'percent' },
  late_shipment_rate: { column: 'lateShipmentRate', kind: 'percent' },
  non_fulfillment_rate: { column: 'nonFulfillmentRate', kind: 'percent' },
  cancellation_rate: { column: 'cancellationRate', kind: 'percent' },
  return_refund_rate: { column: 'returnRefundRate', kind: 'percent' },
  pre_order_listing_rate: { column: 'preOrderListingRate', kind: 'percent' },
  shop_rating: { column: 'shopRating', kind: 'score' },
  preparation_time: { column: 'preparationTime', kind: 'days' },
  the_amount_of_pre_order_listing: { column: 'preOrderListingAmount', kind: 'count' },
  severe_listing_violations: { column: 'severeListingViolations', kind: 'count' },
  other_listing_violations: { column: 'otherListingViolations', kind: 'count' },
  prohibited_listings: { column: 'prohibitedListings', kind: 'count' },
  counterfeit_ip_infringement: { column: 'counterfeitIpInfringement', kind: 'count' },
  spam_listings: { column: 'spamListings', kind: 'count' },
});

/**
 * A metric as this system keeps it.
 */
function toMetricValue(value, kind) {
  const number = numberOrNull(value);
  if (number === null) return null;
  if (kind === 'percent') return number / 100;
  return number;
}

function normalizeAccountHealth(payload) {
  const response = unwrap(payload);
  const overall = response.overall_performance || {};
  // Every metric starts as missing. One the platform did not report is
  // missing, not zero — a zero would read as a perfect week.
  const metrics = {};
  for (const spec of Object.values(METRIC_COLUMNS)) metrics[spec.column] = null;
  for (const metric of Array.isArray(response.metric_list) ? response.metric_list : []) {
    const spec = METRIC_COLUMNS[metric.metric_name];
    if (!spec) continue;
    metrics[spec.column] = toMetricValue(metric.current_period, spec.kind);
  }
  // The score is reported twice: once to a decimal place among the metrics
  // and once rounded down in the summary. The metric is the better of the
  // two, so it wins when it is there.
  if (metrics.shopRating === null) metrics.shopRating = numberOrNull(overall.rating);
  return {
    ...metrics,
    fulfillmentFailed: numberOrNull(overall.fulfillment_failed),
    listingFailed: numberOrNull(overall.listing_failed),
    customServiceFailed: numberOrNull(overall.custom_service_failed),
    raw: response,
  };
}

async function fetchShopHealth({ client, shopId, accessToken }) {
  const endpoint = ENDPOINTS.accountHealth;
  const payload = await client.shopRequest({
    path: endpoint.path,
    shopId,
    accessToken,
    method: endpoint.method,
    query: {},
  });
  return { health: normalizeAccountHealth(payload), payload };
}

module.exports = { unwrap, normalizeAccountHealth, fetchShopHealth, toMetricValue, METRIC_COLUMNS };
