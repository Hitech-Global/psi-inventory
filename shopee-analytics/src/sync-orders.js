'use strict';

const { ENDPOINTS } = require('./catalog');

function unwrap(payload) {
  return payload && payload.response ? payload.response : payload || {};
}

function normalizeOrderItem(row) {
  return {
    itemId: row.item_id,
    itemName: row.item_name || null,
    itemSku: row.item_sku || null,
    modelId: row.model_id || 0,
    modelName: row.model_name || null,
    modelSku: row.model_sku || null,
    quantity: row.model_quantity_purchased || 0,
    originalPrice: row.model_original_price ?? null,
    discountedPrice: row.model_discounted_price ?? null,
    promotionType: row.promotion_type || null,
    promotionId: row.promotion_id ?? null,
    raw: row,
  };
}

function normalizeOrder(row) {
  return {
    orderSn: row.order_sn,
    orderStatus: row.order_status || null,
    createTime: row.create_time ?? null,
    updateTime: row.update_time ?? null,
    currency: row.currency || null,
    totalAmount: row.total_amount ?? null,
    items: Array.isArray(row.item_list) ? row.item_list.map(normalizeOrderItem) : [],
    raw: row,
  };
}

async function fetchOrderList({
  client,
  shopId,
  accessToken,
  timeFrom,
  timeTo,
  timeRangeField = 'update_time',
  pageSize = 100,
  orderStatus,
}) {
  const endpoint = ENDPOINTS.orders;
  const rows = [];
  const rawPages = [];
  let cursor = '';

  for (;;) {
    const query = {
      time_range_field: timeRangeField,
      time_from: timeFrom,
      time_to: timeTo,
      page_size: pageSize,
      cursor: cursor || undefined,
      order_status: orderStatus,
    };
    const payload = await client.shopRequest({
      path: endpoint.path,
      shopId,
      accessToken,
      method: endpoint.method,
      query,
    });
    rawPages.push({ query, payload });
    const response = unwrap(payload);
    const pageRows = Array.isArray(response.order_list) ? response.order_list : [];
    rows.push(...pageRows);
    if (response.more !== true || !response.next_cursor || pageRows.length === 0) break;
    cursor = response.next_cursor;
  }

  return { rows, rawPages };
}

async function fetchOrderDetails({
  client,
  shopId,
  accessToken,
  orderSns,
}) {
  const endpoint = ENDPOINTS.orderDetail;
  const ids = Array.from(new Set((orderSns || []).filter(Boolean)));
  const orders = [];
  const rawPages = [];

  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const query = { order_sn_list: chunk.join(',') };
    const payload = await client.shopRequest({
      path: endpoint.path,
      shopId,
      accessToken,
      method: endpoint.method,
      query,
    });
    rawPages.push({ query, payload });
    const response = unwrap(payload);
    const pageRows = Array.isArray(response.order_list) ? response.order_list : [];
    orders.push(...pageRows.map(normalizeOrder));
  }

  return { orders, rawPages };
}

module.exports = {
  unwrap,
  normalizeOrderItem,
  normalizeOrder,
  fetchOrderList,
  fetchOrderDetails,
};
