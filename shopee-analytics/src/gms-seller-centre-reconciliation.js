'use strict';

const { parseCsv, parseWorkbook, parseDatePeriod, normalizeShopeeMetric } = require('./shopee-ad-group-import');
const { normalizeGmsPerformance } = require('./sync-gms');

const MONEY_TOLERANCE = 0.011;
const TWO_DECIMAL_TOLERANCE = 0.0051;
const PERCENT_DISPLAY_TOLERANCE = 0.000051;

const METADATA_ALIASES = Object.freeze({
  '用户名称': 'User Name',
  '商店名称': 'Shop Name',
  '商店ID': 'Shop ID',
  '报告创建时间': 'Report Creation Time',
  '时间': 'Date Period',
});

const HEADER_ALIASES = Object.freeze({
  '排序': 'Sequence',
  '商品名称': 'Product Name',
  '商品编号': 'Product ID',
  '展示次数': 'Impression',
  '点击数': 'Clicks',
  '点击率': 'CTR',
  '转化': 'Conversions',
  '直接转化': 'Direct Conversions',
  '转化率': 'Conversion Rate',
  '直接转化率': 'Direct Conversion Rate',
  '每转化成本': 'Cost per Conversion',
  '每一直接转化的成本': 'Cost per Direct Conversion',
  '商品已出售': 'Items Sold',
  '直接已售商品': 'Direct Items Sold',
  '销售金额': 'GMV',
  '直接销售金额': 'Direct GMV',
  '花费': 'Expense',
  '广告支出回报率': 'ROAS',
  '直接广告支出回报率': 'Direct ROAS',
  '广告销售成本': 'ACOS',
  '直接广告销售成本': 'Direct ACOS',
});

const REQUIRED_HEADERS = Object.freeze([
  'Sequence', 'Product Name', 'Product ID', 'Impression', 'Clicks', 'CTR',
  'Conversions', 'Direct Conversions', 'Conversion Rate', 'Direct Conversion Rate',
  'Cost per Conversion', 'Cost per Direct Conversion', 'Items Sold', 'Direct Items Sold',
  'GMV', 'Direct GMV', 'Expense', 'ROAS', 'Direct ROAS', 'ACOS', 'Direct ACOS',
  'Voucher Amount', 'Vouchered Sales',
]);

const BASE_FIELDS = Object.freeze([
  ['impressions', 'Impression', 0],
  ['clicks', 'Clicks', 0],
  ['broadOrders', 'Conversions', 0],
  ['directOrders', 'Direct Conversions', 0],
  ['broadUnits', 'Items Sold', 0],
  ['directUnits', 'Direct Items Sold', 0],
  ['broadGmv', 'GMV', 0.01],
  ['directGmv', 'Direct GMV', 0.01],
  ['expense', 'Expense', 0.01],
  ['voucherAmount', 'Voucher Amount', 0.01],
  ['voucheredSales', 'Vouchered Sales', 0.01],
]);

function normalizeLabel(value) {
  return String(value ?? '').replace(/^\uFEFF/, '').trim();
}
function canonicalMetadataLabel(value) {
  const label = normalizeLabel(value);
  return METADATA_ALIASES[label] || label;
}
function canonicalHeader(value) {
  const label = normalizeLabel(value);
  return HEADER_ALIASES[label] || label;
}
function objectFromHeader(header, values) {
  return Object.fromEntries(header.map((name, index) => [name, values[index] ?? '']));
}
function metric(row, field, { percentage = false, required = true } = {}) {
  const value = normalizeShopeeMetric(row[field], { percentage });
  if (required && value === null) throw new Error(`${field} is required in GMS Seller Centre export`);
  return value;
}
function safeDiv(numerator, denominator) {
  const n = Number(numerator);
  const d = Number(denominator);
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return 0;
  return n / d;
}
function nearlyEqual(actual, expected, tolerance = 1e-9) {
  return Number.isFinite(Number(actual)) && Math.abs(Number(actual) - Number(expected)) <= tolerance;
}

function rowMetrics(row) {
  const base = {
    impressions: metric(row, 'Impression'),
    clicks: metric(row, 'Clicks'),
    broadOrders: metric(row, 'Conversions'),
    directOrders: metric(row, 'Direct Conversions'),
    broadUnits: metric(row, 'Items Sold'),
    directUnits: metric(row, 'Direct Items Sold'),
    broadGmv: metric(row, 'GMV'),
    directGmv: metric(row, 'Direct GMV'),
    expense: metric(row, 'Expense'),
    voucherAmount: metric(row, 'Voucher Amount'),
    voucheredSales: metric(row, 'Vouchered Sales'),
  };
  return {
    ...base,
    sourceCtr: metric(row, 'CTR', { percentage: true }),
    sourceBroadCvr: metric(row, 'Conversion Rate', { percentage: true }),
    sourceDirectCvr: metric(row, 'Direct Conversion Rate', { percentage: true }),
    sourceCostPerConversion: metric(row, 'Cost per Conversion'),
    sourceCostPerDirectConversion: metric(row, 'Cost per Direct Conversion'),
    sourceBroadRoas: metric(row, 'ROAS'),
    sourceDirectRoas: metric(row, 'Direct ROAS'),
    sourceBroadAcos: metric(row, 'ACOS', { percentage: true }),
    sourceDirectAcos: metric(row, 'Direct ACOS', { percentage: true }),
    ctr: safeDiv(base.clicks, base.impressions),
    broadCvr: safeDiv(base.broadOrders, base.clicks),
    directCvr: safeDiv(base.directOrders, base.clicks),
    costPerConversion: safeDiv(base.expense, base.broadOrders),
    costPerDirectConversion: safeDiv(base.expense, base.directOrders),
    broadRoas: safeDiv(base.broadGmv, base.expense),
    directRoas: safeDiv(base.directGmv, base.expense),
    broadAcos: safeDiv(base.expense, base.broadGmv),
    directAcos: safeDiv(base.expense, base.directGmv),
  };
}

function parseGmsSellerCentreReport(rows) {
  if (!Array.isArray(rows) || !rows.length) throw new Error('GMS Seller Centre report is empty');
  const metadata = {};
  let headerIndex = -1;
  for (let i = 0; i < rows.length; i += 1) {
    if (rows[i].some(value => canonicalHeader(value) === 'Sequence')) {
      headerIndex = i;
      break;
    }
    const label = canonicalMetadataLabel(rows[i][0]);
    if (['Shop Name', 'Shop ID', 'Date Period', 'Report Creation Time'].includes(label)) metadata[label] = rows[i][1];
  }
  if (headerIndex < 0) throw new Error('GMS Seller Centre header row was not found');
  const header = rows[headerIndex].map(canonicalHeader);
  const missing = REQUIRED_HEADERS.filter(name => !header.includes(name));
  if (missing.length) throw new Error(`GMS Seller Centre export missing headers: ${missing.join(', ')}`);

  const shopId = Number(metadata['Shop ID']);
  if (!Number.isSafeInteger(shopId) || shopId <= 0) throw new Error('Shop ID is required');
  if (!metadata['Date Period']) throw new Error('Date Period is required');
  const period = parseDatePeriod(metadata['Date Period']);
  if (period.granularity !== 'DAY') throw new Error('GMS reconciliation requires an exact one-day Seller Centre export');

  const dataRows = rows.slice(headerIndex + 1)
    .filter(values => values.some(value => String(value).trim()))
    .map(values => objectFromHeader(header, values))
    .filter(row => /^\d+$/.test(String(row.Sequence || '').trim()));
  if (dataRows.length < 2) throw new Error('GMS Seller Centre export must contain one summary row and item rows');

  const summaryRow = dataRows[0];
  if (String(summaryRow['Product ID'] || '').trim() !== '-') throw new Error('GMS Seller Centre first metric row must be the store summary');
  const items = dataRows.slice(1).map(row => {
    const itemId = Number(String(row['Product ID'] || '').trim());
    if (!Number.isSafeInteger(itemId) || itemId <= 0) throw new Error('GMS Seller Centre Product ID must be a positive integer');
    return { itemId, productName: String(row['Product Name'] || '').trim() || null, metrics: rowMetrics(row) };
  });

  const summary = rowMetrics(summaryRow);
  const childSumChecks = [];
  for (const [key, , tolerance] of BASE_FIELDS) {
    const childSum = items.reduce((total, item) => total + item.metrics[key], 0);
    const expected = summary[key];
    childSumChecks.push({ field: key, expected, childSum, status: nearlyEqual(childSum, expected, tolerance) ? 'PASS' : 'FAIL', tolerance });
  }
  if (childSumChecks.some(row => row.status === 'FAIL')) {
    const failed = childSumChecks.filter(row => row.status === 'FAIL').map(row => row.field).join(', ');
    throw new Error(`GMS Seller Centre child rows do not reconcile to summary: ${failed}`);
  }

  return {
    reportSource: 'SHOPEE_GMS_SELLER_CENTRE_EXPORT',
    shopId,
    shopName: String(metadata['Shop Name'] || '').trim() || null,
    reportCreatedAt: String(metadata['Report Creation Time'] || '').trim() || null,
    eventDate: period.periodStart,
    summary,
    items,
    childSumChecks,
  };
}

function parseGmsSellerCentreFile({ buffer, filename = '' }) {
  const rows = /\.xlsx$/i.test(filename)
    ? parseWorkbook(buffer)
    : parseCsv(Buffer.isBuffer(buffer) ? buffer.toString('utf8') : String(buffer));
  return parseGmsSellerCentreReport(rows);
}

function rawReport(row) {
  return row?.raw_json?.report || row?.rawJson?.report || row?.raw?.report || {};
}

function fallbackReport(row = {}) {
  return {
    impression: row.impressions,
    clicks: row.clicks,
    expense: row.expense,
    broad_gmv: row.broad_gmv ?? row.broadGmv,
    broad_order: row.broad_orders ?? row.broadOrders,
    broad_order_amount: row.broad_units ?? row.broadUnits,
    direct_gmv: row.direct_gmv ?? row.directGmv,
    direct_order: row.direct_orders ?? row.directOrders,
    direct_order_amount: row.direct_units ?? row.directUnits,
    broad_roi: row.broad_roas ?? row.broadRoas,
    direct_roi: row.direct_roas ?? row.directRoas,
  };
}

function normalizeApiItem(row) {
  const source = normalizeGmsPerformance({ ...fallbackReport(row), ...rawReport(row) });
  const directGmv = row.direct_gmv == null && row.directGmv == null ? source.directGmv : Number(row.direct_gmv ?? row.directGmv);
  return {
    itemId: Number(row.item_id ?? row.itemId),
    impressions: Number(row.impressions ?? source.impressions),
    clicks: Number(row.clicks ?? source.clicks),
    broadOrders: Number(row.broad_orders ?? row.broadOrders ?? source.broadOrders),
    directOrders: Number(row.direct_orders ?? row.directOrders ?? source.directOrders),
    broadUnits: Number(row.broad_units ?? row.broadUnits ?? source.broadUnits),
    directUnits: Number(row.direct_units ?? row.directUnits ?? source.directUnits),
    broadGmv: Number(row.broad_gmv ?? row.broadGmv ?? source.broadGmv),
    directGmv,
    expense: Number(row.expense ?? source.expense),
    costPerConversion: source.costPerConversion,
    costPerDirectConversion: source.costPerDirectConversion,
    broadRoas: source.broadRoas,
    directRoas: row.direct_roas == null && row.directRoas == null ? source.directRoas : Number(row.direct_roas ?? row.directRoas),
    broadAcos: source.broadAcos,
    directAcos: source.directAcos,
  };
}

function normalizeApiCampaign(row) {
  const source = normalizeGmsPerformance({ ...fallbackReport(row), ...rawReport(row) });
  return {
    impressions: Number(row.impressions ?? source.impressions),
    clicks: Number(row.clicks ?? source.clicks),
    expense: Number(row.expense ?? source.expense),
    broadGmv: Number(row.broad_gmv ?? row.broadGmv ?? source.broadGmv),
    broadOrders: Number(row.broad_orders ?? row.broadOrders ?? source.broadOrders),
    broadUnits: Number(row.broad_units ?? row.broadUnits ?? source.broadUnits),
    directGmv: row.direct_gmv == null && row.directGmv == null ? source.directGmv : Number(row.direct_gmv ?? row.directGmv),
    directOrders: Number(row.direct_orders ?? row.directOrders ?? source.directOrders),
    directUnits: Number(row.direct_units ?? row.directUnits ?? source.directUnits),
    costPerConversion: source.costPerConversion,
    costPerDirectConversion: source.costPerDirectConversion,
    broadRoas: source.broadRoas,
    directRoas: row.direct_roas == null && row.directRoas == null ? source.directRoas : Number(row.direct_roas ?? row.directRoas),
    broadAcos: source.broadAcos,
    directAcos: source.directAcos,
  };
}

function aggregateCompleteItemDirectGmv(apiItems) {
  if (!Array.isArray(apiItems) || !apiItems.length) return { available: false, value: null, complete: false };
  const normalized = apiItems.map(normalizeApiItem);
  if (normalized.some(row => row.directGmv === null || !Number.isFinite(row.directGmv))) return { available: false, value: null, complete: false };
  return { available: true, value: normalized.reduce((sum, row) => sum + row.directGmv, 0), complete: true };
}

function check(field, actual, expected, { tolerance = 1e-9, provenance = 'API_SOURCE' } = {}) {
  if (actual === null || actual === undefined || !Number.isFinite(Number(actual))) {
    return { field, expected, actual: null, status: 'SOURCE_UNAVAILABLE', provenance };
  }
  return { field, expected, actual: Number(actual), status: nearlyEqual(Number(actual), Number(expected), tolerance) ? 'PASS' : 'FAIL', provenance };
}

function reconcileOneItem(sellerItem, apiItem) {
  const s = sellerItem.metrics;
  if (!apiItem) return { itemId: sellerItem.itemId, productName: sellerItem.productName, status: 'FAIL', checks: [], reason: 'ITEM_MISSING_IN_API' };
  const a = normalizeApiItem(apiItem);
  const checks = [
    check('impressions', a.impressions, s.impressions),
    check('clicks', a.clicks, s.clicks),
    check('broadOrders', a.broadOrders, s.broadOrders),
    check('directOrders', a.directOrders, s.directOrders),
    check('broadUnits', a.broadUnits, s.broadUnits),
    check('directUnits', a.directUnits, s.directUnits),
    check('broadGmv', a.broadGmv, s.broadGmv, { tolerance: MONEY_TOLERANCE }),
    check('directGmv', a.directGmv, s.directGmv, { tolerance: MONEY_TOLERANCE }),
    check('expense', a.expense, s.expense, { tolerance: MONEY_TOLERANCE }),
    check('ctr', safeDiv(a.clicks, a.impressions), s.sourceCtr, { tolerance: PERCENT_DISPLAY_TOLERANCE, provenance: 'DERIVED_FROM_API_BASE_METRICS' }),
    check('broadCvr', safeDiv(a.broadOrders, a.clicks), s.sourceBroadCvr, { tolerance: PERCENT_DISPLAY_TOLERANCE, provenance: 'DERIVED_FROM_API_BASE_METRICS' }),
    check('directCvr', safeDiv(a.directOrders, a.clicks), s.sourceDirectCvr, { tolerance: PERCENT_DISPLAY_TOLERANCE, provenance: 'DERIVED_FROM_API_BASE_METRICS' }),
    check('costPerConversion', a.costPerConversion, s.sourceCostPerConversion, { tolerance: TWO_DECIMAL_TOLERANCE, provenance: 'GMS_FIXED_POINT_CPC' }),
    check('costPerDirectConversion', a.costPerDirectConversion, s.sourceCostPerDirectConversion, { tolerance: TWO_DECIMAL_TOLERANCE, provenance: 'GMS_FIXED_POINT_CPDC' }),
    check('broadRoas', a.broadRoas, s.sourceBroadRoas, { tolerance: TWO_DECIMAL_TOLERANCE }),
    check('directRoas', a.directRoas, s.sourceDirectRoas, { tolerance: TWO_DECIMAL_TOLERANCE }),
    check('broadAcos', a.broadAcos, s.sourceBroadAcos, { tolerance: PERCENT_DISPLAY_TOLERANCE, provenance: 'GMS_FIXED_POINT_COST_OVER_GMV' }),
    check('directAcos', a.directAcos, s.sourceDirectAcos, { tolerance: PERCENT_DISPLAY_TOLERANCE }),
  ];
  return {
    itemId: sellerItem.itemId,
    productName: sellerItem.productName,
    status: checks.some(row => row.status === 'FAIL') ? 'FAIL' : checks.some(row => row.status === 'SOURCE_UNAVAILABLE') ? 'INCOMPLETE' : 'PASS',
    checks,
  };
}

function reconcileGmsCampaign({ sellerReport, apiCampaign, apiItems = [] }) {
  if (!sellerReport || !sellerReport.summary) throw new Error('sellerReport is required');
  if (!apiCampaign) throw new Error('apiCampaign is required');
  const s = sellerReport.summary;
  const c = normalizeApiCampaign(apiCampaign);
  const itemDirect = aggregateCompleteItemDirectGmv(apiItems);
  let resolvedDirectGmv = c.directGmv;
  let directGmvProvenance = 'API_SOURCE';
  if (resolvedDirectGmv === null && itemDirect.available) {
    resolvedDirectGmv = itemDirect.value;
    directGmvProvenance = 'GMS_ITEM_API_AGGREGATE';
  }
  const preciseDirectExpense = c.directOrders > 0 ? c.costPerDirectConversion * c.directOrders : c.expense;
  const resolvedDirectAcos = resolvedDirectGmv === null ? null : safeDiv(preciseDirectExpense, resolvedDirectGmv);

  const checks = [
    check('impressions', c.impressions, s.impressions),
    check('clicks', c.clicks, s.clicks),
    check('broadOrders', c.broadOrders, s.broadOrders),
    check('directOrders', c.directOrders, s.directOrders),
    check('broadUnits', c.broadUnits, s.broadUnits),
    check('directUnits', c.directUnits, s.directUnits),
    check('broadGmv', c.broadGmv, s.broadGmv, { tolerance: MONEY_TOLERANCE }),
    check('directGmv', resolvedDirectGmv, s.directGmv, { tolerance: MONEY_TOLERANCE, provenance: directGmvProvenance }),
    check('expense', c.expense, s.expense, { tolerance: MONEY_TOLERANCE }),
    check('ctr', safeDiv(c.clicks, c.impressions), s.sourceCtr, { tolerance: PERCENT_DISPLAY_TOLERANCE, provenance: 'DERIVED_FROM_API_BASE_METRICS' }),
    check('broadCvr', safeDiv(c.broadOrders, c.clicks), s.sourceBroadCvr, { tolerance: PERCENT_DISPLAY_TOLERANCE, provenance: 'DERIVED_FROM_API_BASE_METRICS' }),
    check('directCvr', safeDiv(c.directOrders, c.clicks), s.sourceDirectCvr, { tolerance: PERCENT_DISPLAY_TOLERANCE, provenance: 'DERIVED_FROM_API_BASE_METRICS' }),
    check('costPerConversion', c.costPerConversion, s.sourceCostPerConversion, { tolerance: TWO_DECIMAL_TOLERANCE, provenance: 'GMS_FIXED_POINT_CPC' }),
    check('costPerDirectConversion', c.costPerDirectConversion, s.sourceCostPerDirectConversion, { tolerance: TWO_DECIMAL_TOLERANCE, provenance: 'GMS_FIXED_POINT_CPDC' }),
    check('broadRoas', c.broadRoas, s.sourceBroadRoas, { tolerance: TWO_DECIMAL_TOLERANCE }),
    check('directRoas', c.directRoas, s.sourceDirectRoas, { tolerance: TWO_DECIMAL_TOLERANCE }),
    check('broadAcos', c.broadAcos, s.sourceBroadAcos, { tolerance: PERCENT_DISPLAY_TOLERANCE, provenance: 'GMS_FIXED_POINT_COST_OVER_GMV' }),
    check('directAcos', resolvedDirectAcos, s.sourceDirectAcos, { tolerance: PERCENT_DISPLAY_TOLERANCE, provenance: resolvedDirectGmv === null ? 'SOURCE_UNAVAILABLE' : `DERIVED_FROM_${directGmvProvenance}` }),
    check('voucherAmount', null, s.voucherAmount, { tolerance: MONEY_TOLERANCE, provenance: 'SOURCE_UNAVAILABLE' }),
    check('voucheredSales', null, s.voucheredSales, { tolerance: MONEY_TOLERANCE, provenance: 'SOURCE_UNAVAILABLE' }),
  ];

  const bySellerId = new Map(sellerReport.items.map(item => [String(item.itemId), item]));
  const byApiId = new Map((apiItems || []).map(row => [String(normalizeApiItem(row).itemId), row]));
  const missingInApi = sellerReport.items.filter(item => !byApiId.has(String(item.itemId))).map(item => item.itemId);
  const extraInApi = Array.from(byApiId.keys()).filter(itemId => !bySellerId.has(itemId)).map(Number);
  const itemChecks = sellerReport.items.map(item => reconcileOneItem(item, byApiId.get(String(item.itemId))));
  const hasFailure = checks.some(row => row.status === 'FAIL') || missingInApi.length || extraInApi.length || itemChecks.some(row => row.status === 'FAIL');
  const hasUnavailable = checks.some(row => row.status === 'SOURCE_UNAVAILABLE') || itemChecks.some(row => row.status === 'INCOMPLETE');

  return {
    status: hasFailure ? 'FAIL' : hasUnavailable ? 'INCOMPLETE' : 'PASS',
    checks,
    itemCoverage: { sellerCount: sellerReport.items.length, apiCount: apiItems.length, missingInApi, extraInApi, status: missingInApi.length || extraInApi.length ? 'FAIL' : 'PASS' },
    itemChecks,
    itemDirectGmvAggregate: itemDirect,
  };
}

module.exports = {
  METADATA_ALIASES,
  HEADER_ALIASES,
  REQUIRED_HEADERS,
  rowMetrics,
  parseGmsSellerCentreReport,
  parseGmsSellerCentreFile,
  normalizeApiItem,
  normalizeApiCampaign,
  aggregateCompleteItemDirectGmv,
  reconcileOneItem,
  reconcileGmsCampaign,
};
