'use strict';

const { ENDPOINTS } = require('./catalog');

function unwrap(payload) {
  return payload && payload.response ? payload.response : payload || {};
}

function normalizeReturnItem(row) {
  return {
    itemId: row.item_id,
    modelId: row.model_id || 0,
    itemName: row.name || null,
    itemSku: row.item_sku || null,
    modelSku: row.variation_sku || null,
    quantity: row.amount || 0,
    itemPrice: row.item_price ?? null,
    refundAmount: row.refund_amount ?? null,
    raw: row,
  };
}

function normalizeReturn(row) {
  return {
    returnSn: row.return_sn,
    orderSn: row.order_sn || null,
    status: row.status || null,
    reason: row.reassessed_request_reason && row.reassessed_request_reason !== 'NONE'
      ? row.reassessed_request_reason
      : (row.reason || null),
    originalReason: row.reason || null,
    textReason: row.text_reason || null,
    refundAmount: row.refund_amount ?? null,
    currency: row.currency || null,
    createTime: row.create_time ?? null,
    updateTime: row.update_time ?? null,
    items: Array.isArray(row.item) ? row.item.map(normalizeReturnItem) : [],
    raw: row,
  };
}

async function fetchReturnList({
  client,
  shopId,
  accessToken,
  createTimeFrom,
  createTimeTo,
  updateTimeFrom,
  updateTimeTo,
  status,
  pageSize = 100,
  startPageNo = 0,
}) {
  const endpoint = ENDPOINTS.returns;
  const rows = [];
  const rawPages = [];
  let pageNo = startPageNo;

  for (;;) {
    const query = {
      create_time_from: createTimeFrom,
      create_time_to: createTimeTo,
      update_time_from: updateTimeFrom,
      update_time_to: updateTimeTo,
      status,
      page_no: pageNo,
      page_size: pageSize,
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
    const pageRows = Array.isArray(response.return) ? response.return : [];
    rows.push(...pageRows);
    if (response.more !== true || pageRows.length === 0) break;
    pageNo += 1;
  }

  return { rows, rawPages };
}

async function fetchReturnDetail({ client, shopId, accessToken, returnSn }) {
  const endpoint = ENDPOINTS.returnDetail;
  const query = { return_sn: returnSn };
  const payload = await client.shopRequest({
    path: endpoint.path,
    shopId,
    accessToken,
    method: endpoint.method,
    query,
  });
  return { returnRecord: normalizeReturn(unwrap(payload)), query, payload };
}

async function fetchAllReturnDetails(args) {
  const list = await fetchReturnList(args);
  const details = [];
  for (const row of list.rows) {
    if (!row.return_sn) continue;
    details.push(await fetchReturnDetail({ ...args, returnSn: row.return_sn }));
  }
  return { list, details };
}

module.exports = {
  unwrap,
  normalizeReturnItem,
  normalizeReturn,
  fetchReturnList,
  fetchReturnDetail,
  fetchAllReturnDetails,
};
