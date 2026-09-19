'use strict';

const { ENDPOINTS } = require('./catalog');

function unwrap(payload) {
  return payload && payload.response ? payload.response : payload || {};
}

function normalizeShopBiDetail(row) {
  return {
    shopId: row.shop_id,
    shopName: row.shop_name || null,
    region: row.shop_region_code || null,
    currency: row.currency || null,
    sales: row.sales ?? null,
    orders: row.orders ?? null,
    unitsSold: row.units_sold ?? null,
    productClicks: row.product_clicks ?? null,
    productViews: row.product_views ?? null,
    uniqueVisitors: row.unique_visitors ?? null,
    itemConversionRate: row.item_conversion_rate ?? null,
    orderConversionRate: row.order_conversion_rate ?? null,
    voucherSales: row.voucher_sales ?? null,
    voucherBuyers: row.voucher_buyers ?? null,
    voucherUsageRate: row.voucher_usage_rate ?? null,
    voucherCir: row.voucher_cir ?? null,
    voucherCost: row.voucher_cost ?? null,
    raw: row,
  };
}

async function fetchShopBiDay({
  client,
  shopId,
  accessToken,
  date,
  timezone,
  currency = 'LOCAL',
}) {
  if (!timezone) throw new Error('Brand Portal timezone is required');
  const endpoint = ENDPOINTS.shopSalesPerformance;
  const body = {
    start_date: date,
    end_date: date,
    granularity: 'day',
    timezone,
    shop_list: [{ shop_id: shopId, currency }],
  };
  const payload = await client.shopRequest({
    path: endpoint.path,
    shopId,
    accessToken,
    method: endpoint.method,
    body,
  });
  const response = unwrap(payload);
  const details = Array.isArray(response.details) ? response.details.map(normalizeShopBiDetail) : [];
  return { details, body, payload };
}

module.exports = { unwrap, normalizeShopBiDetail, fetchShopBiDay };
