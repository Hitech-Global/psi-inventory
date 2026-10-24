'use strict';

const { ENDPOINTS } = require('./catalog');

function unwrap(payload) {
  return payload && payload.response ? payload.response : payload || {};
}

function normalizeDiscountItem(item) {
  const base = {
    itemId: item.item_id,
    itemName: item.item_name || null,
    itemStock: item.item_stock ?? null,
    promotionStock: item.item_promotion_stock ?? null,
    originalPrice: item.item_original_price ?? null,
    promotionPrice: item.item_promotion_price ?? item.item_input_promo_price ?? null,
    raw: item,
  };
  const models = Array.isArray(item.model_list) ? item.model_list : [];
  if (!models.length) return [{ ...base, modelId: 0 }];
  return models.map(model => ({
    ...base,
    modelId: model.model_id ?? 0,
    modelName: model.model_name || null,
    originalPrice: model.model_original_price ?? base.originalPrice,
    promotionPrice: model.model_promotion_price ?? model.model_input_promo_price ?? base.promotionPrice,
    promotionStock: model.model_promotion_stock ?? base.promotionStock,
    raw: model,
  }));
}

function normalizeDiscountDetail(payload) {
  const d = unwrap(payload);
  const itemRows = Array.isArray(d.item_list) ? d.item_list.flatMap(normalizeDiscountItem) : [];
  return {
    discountId: d.discount_id,
    discountName: d.discount_name || null,
    status: d.status || null,
    startTime: d.start_time ?? null,
    endTime: d.end_time ?? null,
    source: d.source ?? null,
    itemRows,
    raw: d,
  };
}

async function fetchDiscountList({
  client,
  shopId,
  accessToken,
  discountStatus = 'all',
  pageSize = 100,
  updateTimeFrom,
  updateTimeTo,
}) {
  const endpoint = ENDPOINTS.discounts;
  const all = [];
  const rawPages = [];
  let pageNo = 1;
  for (;;) {
    const query = {
      discount_status: discountStatus,
      page_no: pageNo,
      page_size: pageSize,
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
    const rows = Array.isArray(response.discount_list) ? response.discount_list : [];
    all.push(...rows);
    if (response.more !== true || rows.length === 0) break;
    pageNo += 1;
  }
  return { rows: all, rawPages };
}

async function fetchDiscountDetail({ client, shopId, accessToken, discountId, pageSize = 100 }) {
  const endpoint = ENDPOINTS.discountDetail;
  const rawPages = [];
  const itemList = [];
  let pageNo = 1;
  let header = null;

  for (;;) {
    const query = { discount_id: discountId, page_no: pageNo, page_size: pageSize };
    const payload = await client.shopRequest({
      path: endpoint.path,
      shopId,
      accessToken,
      method: endpoint.method,
      query,
    });
    rawPages.push({ query, payload });
    const response = unwrap(payload);
    if (!header) header = { ...response };
    const rows = Array.isArray(response.item_list) ? response.item_list : [];
    itemList.push(...rows);
    if (response.more !== true || rows.length === 0) break;
    pageNo += 1;
  }

  return {
    discount: normalizeDiscountDetail({ response: { ...(header || {}), item_list: itemList } }),
    rawPages,
  };
}

async function fetchAllDiscountDetails(args) {
  const list = await fetchDiscountList(args);
  const details = [];
  for (const row of list.rows) {
    const discountId = row.discount_id;
    if (discountId === null || discountId === undefined) continue;
    details.push(await fetchDiscountDetail({ ...args, discountId }));
  }
  return { list, details };
}

module.exports = {
  unwrap,
  normalizeDiscountItem,
  normalizeDiscountDetail,
  fetchDiscountList,
  fetchDiscountDetail,
  fetchAllDiscountDetails,
};
