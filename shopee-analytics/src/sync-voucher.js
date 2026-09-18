'use strict';

const { ENDPOINTS } = require('./catalog');

function unwrap(payload) {
  return payload && payload.response ? payload.response : payload || {};
}

function normalizeVoucherDetail(payload) {
  const v = unwrap(payload);
  return {
    voucherId: v.voucher_id,
    voucherCode: v.voucher_code || null,
    voucherName: v.voucher_name || null,
    voucherType: v.voucher_type ?? null,
    rewardType: v.reward_type ?? null,
    usageQuantity: v.usage_quantity ?? null,
    currentUsage: v.current_usage ?? null,
    startTime: v.start_time ?? null,
    endTime: v.end_time ?? null,
    isAdmin: v.is_admin ?? null,
    minBasketPrice: v.min_basket_price ?? null,
    percentage: v.percentage ?? null,
    maxPrice: v.max_price ?? null,
    discountAmount: v.discount_amount ?? null,
    itemIds: Array.isArray(v.item_id_list) ? v.item_id_list : [],
    raw: v,
  };
}

async function fetchVoucherList({ client, shopId, accessToken, status = 'all', pageSize = 100 }) {
  const endpoint = ENDPOINTS.vouchers;
  const all = [];
  const rawPages = [];
  let pageNo = 1;
  for (;;) {
    const query = { status, page_no: pageNo, page_size: pageSize };
    const payload = await client.shopRequest({
      path: endpoint.path,
      shopId,
      accessToken,
      method: endpoint.method,
      query,
    });
    rawPages.push({ query, payload });
    const response = unwrap(payload);
    const rows = Array.isArray(response.voucher_list) ? response.voucher_list : [];
    all.push(...rows);
    if (response.more !== true || rows.length === 0) break;
    pageNo += 1;
  }
  return { rows: all, rawPages };
}

async function fetchVoucherDetail({ client, shopId, accessToken, voucherId }) {
  const endpoint = ENDPOINTS.voucherDetail;
  const query = { voucher_id: voucherId };
  const payload = await client.shopRequest({
    path: endpoint.path,
    shopId,
    accessToken,
    method: endpoint.method,
    query,
  });
  return { voucher: normalizeVoucherDetail(payload), query, payload };
}

async function fetchAllVoucherDetails(args) {
  const list = await fetchVoucherList(args);
  const details = [];
  for (const row of list.rows) {
    const voucherId = row.voucher_id;
    if (voucherId === null || voucherId === undefined) continue;
    details.push(await fetchVoucherDetail({ ...args, voucherId }));
  }
  return { list, details };
}

module.exports = {
  unwrap,
  normalizeVoucherDetail,
  fetchVoucherList,
  fetchVoucherDetail,
  fetchAllVoucherDetails,
};
