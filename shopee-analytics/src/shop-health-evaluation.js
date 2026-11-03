'use strict';

/**
 * Whether a shop is being run well.
 *
 * The platform sets a standard for each of these — a late shipment rate
 * is meant to be under ten per cent, a score is meant to be at least four
 * point four — and it reports the standard alongside the figure. So the
 * judgement here is the platform's own, not one invented here: a shop is
 * said to have met a standard only when the platform's line says it did.
 *
 * A figure the platform did not report is not a failure. It is missing,
 * and a missing figure says nothing about how the shop is being run.
 */

/**
 * The figures the page shows, and how each is read.
 *
 * The kind decides how a figure is written out: a rate is a percentage, a
 * score is a number out of five, a time is a number of days, a count is a
 * count. The unit the platform reports is not enough to tell these apart
 * — a score arrives with the same unit as a rate — so the kind is named
 * here.
 */
const MEASURES = Object.freeze([
  {
    key: 'shopRating',
    label: '店铺评分',
    labelEn: 'Shop Rating',
    kind: 'score',
    better: 'higher',
    targetKey: 'shopRating',
  },
  {
    key: 'returnRefundRate',
    label: '退货退款率',
    labelEn: 'Return & Refund Rate',
    kind: 'percent',
    better: 'lower',
    targetKey: 'returnRefundRate',
  },
  {
    key: 'cancellationRate',
    label: '取消率',
    labelEn: 'Cancellation Rate',
    kind: 'percent',
    better: 'lower',
    targetKey: 'cancellationRate',
  },
  {
    key: 'lateShipmentRate',
    label: '迟发率',
    labelEn: 'Late Shipment Rate',
    kind: 'percent',
    better: 'lower',
    targetKey: 'lateShipmentRate',
  },
  {
    key: 'nonFulfillmentRate',
    label: '未履约率',
    labelEn: 'Non-fulfilment Rate',
    kind: 'percent',
    better: 'lower',
    targetKey: 'nonFulfillmentRate',
  },
  {
    key: 'csatRate',
    label: '客服满意率',
    labelEn: 'CSAT',
    kind: 'percent',
    better: 'higher',
    targetKey: 'csatRate',
  },
  {
    key: 'responseRate',
    label: '响应率',
    labelEn: 'Response Rate',
    kind: 'percent',
    better: 'higher',
    targetKey: 'responseRate',
  },
  {
    key: 'preparationTime',
    label: '发货准备时长',
    labelEn: 'Preparation Time',
    kind: 'days',
    better: 'lower',
    targetKey: 'preparationTime',
  },
]);

/**
 * The breaches a shop is in, if any.
 *
 * A breach is a figure the platform gave a standard for, where the figure
 * is on the wrong side of it. Anything the platform did not report, or
 * reported without a standard, is left out — it is not a breach, and
 * saying so would be saying something the data does not support.
 */
function evaluateMeasures(reading = {}, targets = {}) {
  const measures = [];
  for (const spec of MEASURES) {
    const value = reading[spec.key];
    const target = targets[spec.targetKey] || null;
    const known = value !== null && value !== undefined && Number.isFinite(Number(value));
    const line = target && Number.isFinite(Number(target.value)) ? Number(target.value) : null;
    let status = 'unknown';
    if (known && line !== null) {
      const met = target.comparator === '>=' ? Number(value) >= line
        : target.comparator === '<=' ? Number(value) <= line
          : target.comparator === '>' ? Number(value) > line
            : target.comparator === '<' ? Number(value) < line
              : null;
      if (met !== null) status = met ? 'met' : 'breached';
    }
    measures.push({
      key: spec.key,
      label: spec.label,
      labelEn: spec.labelEn,
      kind: spec.kind,
      better: spec.better,
      value: known ? Number(value) : null,
      target: line,
      comparator: target ? target.comparator : null,
      status,
    });
  }
  return measures;
}

/**
 * A shop's overall standing.
 *
 * The score is the one that carries the shop's name, so it is the one the
 * standing follows: a shop rated below its standard is not in good
 * standing however well it is shipping. A shop with no reading yet has no
 * standing to speak of.
 */
function overallStatus(measures = []) {
  const rating = measures.find(measure => measure.key === 'shopRating');
  const breaches = measures.filter(measure => measure.status === 'breached');
  const known = measures.filter(measure => measure.status !== 'unknown');
  if (!known.length) return { status: 'unknown', breachCount: 0, measureCount: 0 };
  if (rating && rating.status === 'breached') return { status: 'poor', breachCount: breaches.length, measureCount: known.length };
  if (breaches.length) return { status: 'watch', breachCount: breaches.length, measureCount: known.length };
  if (rating && rating.status === 'unknown') return { status: 'unknown', breachCount: 0, measureCount: known.length };
  return { status: 'good', breachCount: 0, measureCount: known.length };
}

/**
 * The violations a shop has, counted by the platform.
 */
function violationTotal(reading = {}) {
  const counts = [
    reading.severeListingViolations,
    reading.otherListingViolations,
    reading.prohibitedListings,
    reading.counterfeitIpInfringement,
    reading.spamListings,
  ].filter(value => value !== null && value !== undefined && Number.isFinite(Number(value)));
  if (!counts.length) return null;
  return counts.reduce((sum, value) => sum + Number(value), 0);
}

module.exports = { MEASURES, evaluateMeasures, overallStatus, violationTotal };

/**
 * The products where the basket did not turn into a sale.
 *
 * A visitor who puts something in the basket has said they want it. When
 * they do not buy, something stood between them and it — the price, the
 * shipping, the wait, or the stock. Which of those it was cannot be said
 * from the figures; that the customer was close to buying and did not is
 * the fact, and the order of the list is how much of it there is.
 *
 * The thresholds are the ones a reader can change: how many people must
 * have put it in the basket before it counts as a pattern rather than a
 * handful, and how few of them have to have bought before it counts as
 * having been lost.
 */
const ADD_TO_CART_RULES = Object.freeze({
  minAddToCartVisitors: 100,
  maxBuyerRate: 0.4,
});

/**
 * The products that were put in baskets and not bought.
 */
function findAddToCartDropoffs(products = [], options = {}) {
  const minVisitors = Number.isFinite(options.minAddToCartVisitors)
    ? options.minAddToCartVisitors : ADD_TO_CART_RULES.minAddToCartVisitors;
  const maxBuyerRate = Number.isFinite(options.maxBuyerRate)
    ? options.maxBuyerRate : ADD_TO_CART_RULES.maxBuyerRate;

  const found = [];
  for (const product of products) {
    const addToCartVisitors = numberOrNull(product.addToCartVisitors);
    const buyers = numberOrNull(product.buyers);
    if (addToCartVisitors === null || buyers === null) continue;
    if (addToCartVisitors < minVisitors) continue;
    const buyerRate = buyers / addToCartVisitors;
    if (buyerRate >= maxBuyerRate) continue;
    found.push({
      itemId: product.itemId,
      itemName: product.itemName,
      parentSku: product.parentSku,
      addToCartVisitors,
      buyers,
      lostVisitors: Math.max(0, addToCartVisitors - buyers),
      buyerRate,
      productVisitors: numberOrNull(product.productVisitors),
      addToCartRate: numberOrNull(product.addToCartRate),
      unitsSold: numberOrNull(product.unitsSold),
      sales: numberOrNull(product.sales),
    });
  }
  // The ones where the most people were let down come first.
  found.sort((a, b) => b.lostVisitors - a.lostVisitors);
  return found;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

module.exports = {
  MEASURES,
  evaluateMeasures,
  overallStatus,
  violationTotal,
  ADD_TO_CART_RULES,
  findAddToCartDropoffs,
};
