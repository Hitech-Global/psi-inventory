'use strict';

const { ENDPOINTS } = require('./catalog');

/**
 * What is behind a shop's figures.
 *
 * The performance endpoint says a shop's cancellation rate is this and its
 * return rate is that. It does not say which orders, or why. The endpoints
 * here do: they name the orders behind each figure, the reason code, the
 * items with problems and the points deducted.
 *
 * A number tells a reader that something is wrong; the detail tells them
 * what to do about it, and the diagnosis cannot be built on the number
 * alone.
 */

function unwrap(payload) {
  return payload && payload.response ? payload.response : payload || {};
}

function text(value) {
  if (value === null || value === undefined || value === '') return null;
  return String(value);
}

/**
 * The orders behind a figure, with the reason each was counted.
 *
 * The endpoint names the list after the figure it belongs to, so each list
 * is read by its own name rather than by position.
 */
const SOURCE_LISTS = Object.freeze([
  { key: 'nfr_order_list', metricKey: 'nonFulfillmentRate', label: '未履约' },
  { key: 'cancellation_order_list', metricKey: 'cancellationRate', label: '取消' },
  { key: 'return_refund_order_list', metricKey: 'returnRefundRate', label: '退货退款' },
  { key: 'late_order_list', metricKey: 'lateShipmentRate', label: '迟发' },
  { key: 'apt_order_list', metricKey: 'preparationTime', label: '备货时长' },
]);

/**
 * The events behind a metric's figure.
 */
function normalizeMetricSource(payload, metricKey) {
  const response = unwrap(payload);
  const events = [];
  for (const spec of SOURCE_LISTS) {
    const rows = Array.isArray(response[spec.key]) ? response[spec.key] : [];
    for (const row of rows) {
      const orderSn = text(row.order_sn) || null;
      const eventId = orderSn || `${spec.key}:${events.length}`;
      events.push({
        kind: 'metric_source',
        eventId,
        metricKey: spec.metricKey,
        label: spec.label,
        reasonCode: text(row.detailed_reason ?? row.detailed_reason_code ?? null),
        orderSn,
        title: row.shipping_channel ? `${row.shipping_channel}` : null,
        detail: row.preparation_days !== undefined && row.preparation_days !== null
          ? `备货 ${Number(row.preparation_days).toFixed(2)} 天`
          : row.non_fulfillment_type !== undefined && row.non_fulfillment_type !== null
            ? `类型 ${row.non_fulfillment_type}`
            : row.cancellation_type !== undefined && row.cancellation_type !== null
              ? `类型 ${row.cancellation_type}`
              : null,
        severity: null,
        raw: row,
      });
    }
  }
  return { events, totalCount: Number(response.total_count || events.length) };
}

/**
 * The points deducted from a shop.
 */
function normalizePenaltyPoints(payload) {
  const response = unwrap(payload);
  const rows = Array.isArray(response.penalty_point_list) ? response.penalty_point_list : [];
  return rows.map((row, index) => ({
    kind: 'penalty_point',
    eventId: text(row.penalty_id ?? row.id ?? null) || `penalty:${index}`,
    metricKey: null,
    label: '绩效罚分',
    reasonCode: text(row.penalty_type ?? row.type ?? null),
    orderSn: null,
    title: text(row.penalty_name ?? row.name ?? row.reason ?? null),
    detail: row.penalty_amount !== undefined && row.penalty_amount !== null
      ? `扣 ${row.penalty_amount} 分`
      : null,
    severity: text(row.severity ?? row.level ?? null),
    raw: row,
  }));
}

/**
 * The items the platform has flagged.
 */
function normalizeListingsWithIssues(payload) {
  const response = unwrap(payload);
  const rows = Array.isArray(response.listing_list) ? response.listing_list : [];
  return rows.map((row, index) => ({
    kind: 'listing_issue',
    eventId: text(row.item_id ?? row.id ?? null) || `listing:${index}`,
    metricKey: null,
    label: '有问题的商品',
    reasonCode: text(row.issue_type ?? row.type ?? null),
    orderSn: null,
    itemId: row.item_id !== undefined && row.item_id !== null ? Number(row.item_id) : null,
    title: text(row.item_name ?? row.name ?? null),
    detail: text(row.reason ?? row.issue_description ?? null),
    severity: text(row.severity ?? null),
    raw: row,
  }));
}

/**
 * The orders that shipped late.
 */
function normalizeLateOrders(payload) {
  const response = unwrap(payload);
  const rows = Array.isArray(response.late_order_list) ? response.late_order_list : [];
  return rows.map((row, index) => ({
    kind: 'late_order',
    eventId: text(row.order_sn ?? null) || `late:${index}`,
    metricKey: 'lateShipmentRate',
    label: '迟发订单',
    reasonCode: text(row.detailed_reason ?? null),
    orderSn: text(row.order_sn ?? null),
    title: null,
    detail: row.arrange_pick_up_time && row.actual_pick_up_time
      ? `计划 ${new Date(Number(row.arrange_pick_up_time) * 1000).toISOString().slice(0, 16).replace('T', ' ')}`
        + ` / 实际 ${new Date(Number(row.actual_pick_up_time) * 1000).toISOString().slice(0, 16).replace('T', ' ')}`
      : null,
    severity: null,
    raw: row,
  }));
}

async function fetchJson({ client, shopId, accessToken, endpointKey, query = {} }) {
  const endpoint = ENDPOINTS[endpointKey];
  if (!endpoint) throw new Error(`Unknown endpoint ${endpointKey}`);
  const payload = await client.shopRequest({
    path: endpoint.path,
    shopId,
    accessToken,
    method: endpoint.method,
    query,
  });
  return { response: unwrap(payload), payload };
}

/**
 * Everything behind the figures, in one pass.
 *
 * A source that refuses is passed over rather than failing the whole
 * fetch: the figures are still worth having even if the detail behind one
 * of them is not available today.
 */
async function fetchHealthEvents({ client, shopId, accessToken, metricKeys = [] }) {
  const events = [];
  const errors = [];

  const collect = async (endpointKey, normalizer, query) => {
    try {
      const { response } = await fetchJson({ client, shopId, accessToken, endpointKey, query });
      events.push(...normalizer(response));
    } catch (error) {
      errors.push({ endpointKey, message: String(error.message).slice(0, 160) });
    }
  };

  await collect('penaltyPointHistory', normalizePenaltyPoints, {});
  await collect('listingsWithIssues', normalizeListingsWithIssues, {});
  await collect('lateOrders', normalizeLateOrders, {});

  for (const metricKey of metricKeys) {
    await collect('metricSourceDetail', response => normalizeMetricSource(response, metricKey).events, {
      metric_id: String(metricKey),
    });
  }

  return { events, errors };
}

module.exports = {
  unwrap,
  fetchJson,
  fetchHealthEvents,
  normalizeMetricSource,
  normalizePenaltyPoints,
  normalizeListingsWithIssues,
  normalizeLateOrders,
  SOURCE_LISTS,
};
