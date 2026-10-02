'use strict';

const { ENDPOINTS } = require('./catalog');

function unwrap(payload) {
  return payload && payload.response ? payload.response : payload || {};
}

function normalizeBound(bound) {
  if (!bound || typeof bound !== 'object') return { value: null, percentile: null };
  return {
    value: bound.value ?? null,
    percentile: bound.percentile ?? null,
  };
}

function normalizeRecommendedRoi(payload) {
  const response = unwrap(payload);
  return {
    lower: normalizeBound(response.lower_bound),
    exact: normalizeBound(response.exact),
    upper: normalizeBound(response.upper_bound),
    raw: response,
  };
}

function buildReferenceId({ shopId, itemId, date = new Date() }) {
  const iso = (date instanceof Date ? date : new Date(date)).toISOString().slice(0, 10).replace(/-/g, '');
  return `analytics-${shopId}-${itemId}-${iso}`;
}

async function fetchRecommendedRoi({ client, shopId, accessToken, itemId, referenceId }) {
  const endpoint = ENDPOINTS.adsRecommendedRoi;
  const query = {
    reference_id: referenceId || buildReferenceId({ shopId, itemId }),
    item_id: itemId,
  };
  const payload = await client.shopRequest({
    path: endpoint.path,
    shopId,
    accessToken,
    method: endpoint.method,
    query,
  });
  return { recommendation: normalizeRecommendedRoi(payload), query, payload };
}

module.exports = {
  unwrap,
  normalizeBound,
  normalizeRecommendedRoi,
  buildReferenceId,
  fetchRecommendedRoi,
};
