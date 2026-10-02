'use strict';

const { ENDPOINTS } = require('./catalog');

function unwrap(payload) {
  return payload && payload.response ? payload.response : payload || {};
}

function normalizeShopInfo(payload) {
  const row = unwrap(payload);
  return {
    shopId: Number(row.shop_id || 0) || null,
    shopName: row.shop_name || null,
    region: row.region || null,
    status: row.status || null,
    merchantId: row.merchant_id ?? null,
    authTime: row.auth_time ?? null,
    expireTime: row.expire_time ?? null,
    isCb: row.is_cb ?? null,
    isSip: row.is_sip ?? null,
    raw: row,
  };
}

async function fetchShopInfo({ client, shopId, accessToken }) {
  const endpoint = ENDPOINTS.shopInfo;
  const payload = await client.shopRequest({
    path: endpoint.path,
    shopId,
    accessToken,
    method: endpoint.method,
  });
  return { shop: normalizeShopInfo(payload), payload };
}

module.exports = { unwrap, normalizeShopInfo, fetchShopInfo };
