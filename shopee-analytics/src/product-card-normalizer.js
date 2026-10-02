'use strict';

const HEADER_ALIASES = Object.freeze({
  itemId: ['item id', 'product id', '商品id', '商品 ID', '商品编号'],
  itemName: ['product name', 'item name', '商品名称', '商品'],
  parentSku: ['parent sku', 'parentsku', 'parent sku id', '父sku', '父 SKU'],
  itemSku: ['item sku', 'product sku', 'sku', '商品sku', '商品 SKU'],
  impressions: ['impressions', 'product impressions', '展现量', '商品展现量', '曝光量'],
  clicks: ['clicks', 'product clicks', '点击量', '商品点击量'],
  ctr: ['ctr', 'click through rate', 'click-through rate', '点击率'],
  visitors: ['product visitors', 'visitors', '商品访客数', '商品访客'],
  pageViews: ['product page views', 'page views', '商品页浏览量', '商品浏览量', '浏览量'],
  addToCartVisitors: ['add to cart visitors', 'add-to-cart visitors', '加购商品访客数', '加购访客数'],
  addToCartUnits: ['add to cart units', 'add-to-cart units', '加购商品数', '加购数量'],
  addToCartRate: ['add to cart rate', 'add-to-cart rate', 'add to cart conversion rate', '加购转化率', '加购率'],
  orders: ['orders', 'order quantity', '订单量', '下单订单数'],
  buyers: ['buyers', 'order buyers', '下单买家数', '买家数'],
  units: ['units', 'units sold', 'sales units', '销量', '有效销量', '下单商品总件数'],
  sales: ['sales', 'sales amount', 'gmv', '销售额', '下单总销售额'],
  conversionRate: ['conversion rate', 'order conversion rate', '浏览到下单转化率', '转化率', '订单转化率'],
});

function normalizeHeader(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[（）()]/g, '')
    .replace(/[_\-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function buildHeaderLookup(headers) {
  const normalized = new Map(headers.map(h => [normalizeHeader(h), h]));
  const lookup = {};
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    for (const alias of aliases) {
      const original = normalized.get(normalizeHeader(alias));
      if (original !== undefined) {
        lookup[field] = original;
        break;
      }
    }
  }
  return lookup;
}

function numeric(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const cleaned = String(value)
    .trim()
    .replace(/\u00a0/g, '')
    .replace(/rp/ig, '')
    .replace(/,/g, '')
    .replace(/\s+/g, '');
  if (!cleaned || cleaned === '-') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function rate(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string' && value.includes('%')) {
    const n = numeric(value.replace('%', ''));
    return n === null ? null : n / 100;
  }
  return numeric(value);
}

function integer(value) {
  const n = numeric(value);
  return n === null ? null : Math.round(n);
}

function parseDateRangeFromFilename(filename) {
  const text = String(filename || '');
  const match = text.match(/(20\d{2})(\d{2})(\d{2})[^0-9]+(20\d{2})(\d{2})(\d{2})/);
  if (!match) return null;
  return {
    startDate: `${match[1]}-${match[2]}-${match[3]}`,
    endDate: `${match[4]}-${match[5]}-${match[6]}`,
  };
}

function normalizeProductCardRows(rows, {
  startDate,
  endDate,
  sourceFile = null,
} = {}) {
  if (!Array.isArray(rows) || !rows.length) return { rows: [], headerLookup: {}, skipped: [] };
  const headers = Array.from(new Set(rows.flatMap(row => Object.keys(row || {}))));
  const headerLookup = buildHeaderLookup(headers);

  if (!headerLookup.itemId) {
    throw new Error('Product Card import requires an item/product ID column');
  }
  if (!startDate || !endDate) {
    const inferred = parseDateRangeFromFilename(sourceFile);
    startDate = startDate || (inferred && inferred.startDate);
    endDate = endDate || (inferred && inferred.endDate);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(startDate || '')) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(String(endDate || ''))) {
    throw new Error('Product Card import requires startDate/endDate or a filename containing YYYYMMDD_YYYYMMDD');
  }

  const skipped = [];
  const normalizedRows = [];
  rows.forEach((raw, index) => {
    const itemId = integer(raw[headerLookup.itemId]);
    if (!Number.isSafeInteger(itemId) || itemId <= 0) {
      skipped.push({ row: index + 2, reason: 'INVALID_ITEM_ID' });
      return;
    }
    normalizedRows.push({
      startDate,
      endDate,
      itemId,
      itemName: headerLookup.itemName ? String(raw[headerLookup.itemName] ?? '').trim() || null : null,
      parentSku: headerLookup.parentSku ? String(raw[headerLookup.parentSku] ?? '').trim() || null : null,
      itemSku: headerLookup.itemSku ? String(raw[headerLookup.itemSku] ?? '').trim() || null : null,
      impressions: headerLookup.impressions ? integer(raw[headerLookup.impressions]) : null,
      clicks: headerLookup.clicks ? integer(raw[headerLookup.clicks]) : null,
      ctr: headerLookup.ctr ? rate(raw[headerLookup.ctr]) : null,
      visitors: headerLookup.visitors ? integer(raw[headerLookup.visitors]) : null,
      pageViews: headerLookup.pageViews ? integer(raw[headerLookup.pageViews]) : null,
      addToCartVisitors: headerLookup.addToCartVisitors ? integer(raw[headerLookup.addToCartVisitors]) : null,
      addToCartUnits: headerLookup.addToCartUnits ? integer(raw[headerLookup.addToCartUnits]) : null,
      addToCartRate: headerLookup.addToCartRate ? rate(raw[headerLookup.addToCartRate]) : null,
      orders: headerLookup.orders ? integer(raw[headerLookup.orders]) : null,
      buyers: headerLookup.buyers ? integer(raw[headerLookup.buyers]) : null,
      units: headerLookup.units ? integer(raw[headerLookup.units]) : null,
      sales: headerLookup.sales ? numeric(raw[headerLookup.sales]) : null,
      conversionRate: headerLookup.conversionRate ? rate(raw[headerLookup.conversionRate]) : null,
      sourceFile,
      raw,
    });
  });

  return { rows: normalizedRows, headerLookup, skipped };
}

module.exports = {
  HEADER_ALIASES,
  normalizeHeader,
  buildHeaderLookup,
  numeric,
  rate,
  parseDateRangeFromFilename,
  normalizeProductCardRows,
};
