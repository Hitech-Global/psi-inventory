'use strict';

const { ENDPOINTS } = require('./catalog');

function unwrap(payload) {
  return payload && payload.response ? payload.response : payload || {};
}

function normalizeItem(row) {
  return {
    itemId: row.item_id,
    itemStatus: row.item_status || null,
    updateTime: row.update_time ?? null,
    raw: row,
  };
}

function normalizeModel(row) {
  const priceInfo = Array.isArray(row.price_info) ? row.price_info[0] || {} : (row.price_info || {});
  const stockInfo = Array.isArray(row.stock_info_v2)
    ? row.stock_info_v2.reduce((sum, s) => sum + Number(s.current_stock || s.normal_stock || 0), 0)
    : null;
  return {
    modelId: row.model_id,
    modelName: row.model_name || null,
    modelSku: row.model_sku || null,
    currentPrice: priceInfo.current_price ?? row.current_price ?? null,
    originalPrice: priceInfo.original_price ?? row.original_price ?? null,
    stock: stockInfo,
    raw: row,
  };
}

async function fetchItemList({
  client,
  shopId,
  accessToken,
  itemStatus = ['NORMAL'],
  updateTimeFrom,
  updateTimeTo,
  pageSize = 100,
}) {
  const endpoint = ENDPOINTS.products;
  const rows = [];
  const rawPages = [];
  let offset = 0;

  for (;;) {
    const query = {
      offset,
      page_size: pageSize,
      item_status: itemStatus,
      update_time_from: updateTimeFrom,
      update_time_to: updateTimeTo,
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
    const pageRows = Array.isArray(response.item) ? response.item : [];
    rows.push(...pageRows.map(normalizeItem));

    if (response.has_next_page !== true || pageRows.length === 0) break;
    offset = response.next_offset ?? (offset + pageRows.length);
  }

  return { rows, rawPages };
}

async function fetchModelList({ client, shopId, accessToken, itemId }) {
  const endpoint = ENDPOINTS.productModels;
  const query = { item_id: itemId };
  const payload = await client.shopRequest({
    path: endpoint.path,
    shopId,
    accessToken,
    method: endpoint.method,
    query,
  });
  const response = unwrap(payload);
  const rows = Array.isArray(response.model) ? response.model : [];
  return { rows: rows.map(normalizeModel), query, payload };
}

module.exports = {
  unwrap,
  normalizeItem,
  normalizeModel,
  fetchItemList,
  fetchModelList,
};
