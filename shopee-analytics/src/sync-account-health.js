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
const METRIC_COLUMNS = Object.freeze({
  csat_rate: 'csatRate',
  response_rate: 'responseRate',
  late_shipment_rate: 'lateShipmentRate',
  non_fulfillment_rate: 'nonFulfillmentRate',
  preparation_time: 'preparationTime',
  cancellation_rate: 'cancellationRate',
  return_refund_rate: 'returnRefundRate',
  pre_order_listing_rate: 'preOrderListingRate',
  the_amount_of_pre_order_listing: 'preOrderListingAmount',
  severe_listing_violations: 'severeListingViolations',
  other_listing_violations: 'otherListingViolations',
  prohibited_listings: 'prohibitedListings',
  counterfeit_ip_infringement: 'counterfeitIpInfringement',
  spam_listings: 'spamListings',
});

function normalizeAccountHealth(payload) {
  const response = unwrap(payload);
  const overall = response.overall_performance || {};
  // Every metric starts as missing. One the platform did not report is
  // missing, not zero — a zero would read as a perfect week.
  const metrics = {};
  for (const column of Object.values(METRIC_COLUMNS)) metrics[column] = null;
  for (const metric of Array.isArray(response.metric_list) ? response.metric_list : []) {
    const column = METRIC_COLUMNS[metric.metric_name];
    if (!column) continue;
    metrics[column] = numberOrNull(metric.current_period);
  }
  return {
    shopRating: numberOrNull(overall.rating),
    fulfillmentFailed: numberOrNull(overall.fulfillment_failed),
    listingFailed: numberOrNull(overall.listing_failed),
    customServiceFailed: numberOrNull(overall.custom_service_failed),
    ...metrics,
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

module.exports = { unwrap, normalizeAccountHealth, fetchShopHealth, METRIC_COLUMNS };
