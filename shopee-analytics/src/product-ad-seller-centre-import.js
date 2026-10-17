'use strict';

const path = require('path');
const { normalizeManualPromotion, normalizeManualItem } = require('./manual-ad-group');
const { parseCsv, parseWorkbook, parseDatePeriod, normalizeShopeeMetric } = require('./shopee-ad-group-import');

const METADATA_ALIASES = Object.freeze({
  '用户名称': 'User Name',
  '商店名称': 'Shop Name',
  '商店ID': 'Shop ID',
  '广告名称': 'Ad Name',
  '商品编号': 'Product ID',
  '报告创建时间': 'Report Creation Time',
  '时间': 'Date Period',
});

const HEADER_ALIASES = Object.freeze({
  '排序': 'Sequence',
  '关键字/位置': 'Keyword / Placement',
  '匹配类型': 'Match Type',
  '搜寻次数': 'Search Volume',
  '竞价方式': 'Bidding Method',
  '版位': 'Placement',
  '展示次数': 'Impression',
  '点击数': 'Clicks',
  '点击率': 'CTR',
  '加入购物车': 'Add To Cart',
  '加入购物车频率': 'Add To Cart Rate',
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
  '平均排名': 'Average Rank',
  '广告支出回报率': 'ROAS',
  '直接广告支出回报率': 'Direct ROAS',
  '广告销售成本': 'ACOS',
  '直接广告销售成本': 'Direct ACOS',
  '优惠券金额': 'Voucher Amount',
  '优惠券带来的销售额': 'Vouchered Sales',
});

const REQUIRED_HEADERS = Object.freeze([
  'Sequence', 'Impression', 'Clicks', 'CTR', 'Add To Cart', 'Add To Cart Rate',
  'Conversions', 'Direct Conversions', 'Conversion Rate', 'Direct Conversion Rate',
  'Cost per Conversion', 'Cost per Direct Conversion', 'Items Sold', 'Direct Items Sold',
  'GMV', 'Direct GMV', 'Expense', 'ROAS', 'Direct ROAS', 'ACOS', 'Direct ACOS',
  'Voucher Amount', 'Vouchered Sales',
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

function parseCampaignIdFromFilename(filename) {
  const base = path.basename(String(filename || ''));
  const match = base.match(/-([1-9]\d{5,})-\d{4}[_-]\d{2}[_-]\d{2}-\d{4}[_-]\d{2}[_-]\d{2}\.(?:csv|xlsx)$/i);
  if (!match) throw new Error('Product Ads Seller Centre filename must contain campaign id and date range');
  return Number(match[1]);
}

function objectFromHeader(header, values) {
  return Object.fromEntries(header.map((name, index) => [name, values[index] ?? '']));
}

function metric(row, field, { percentage = false, required = false } = {}) {
  const value = normalizeShopeeMetric(row[field], { percentage });
  if (required && value === null) throw new Error(`${field} is required in Product Ads Seller Centre export`);
  return value;
}

function sumRequired(rows, field) {
  return rows.reduce((total, row) => total + metric(row, field, { required: true }), 0);
}

function safeDiv(numerator, denominator) {
  return denominator ? numerator / denominator : 0;
}

function parseProductAdSellerCentreReport(rows, { filename = '' } = {}) {
  if (!Array.isArray(rows) || !rows.length) throw new Error('Product Ads Seller Centre report is empty');

  const metadata = {};
  let headerIndex = -1;
  for (let i = 0; i < rows.length; i += 1) {
    const label = canonicalMetadataLabel(rows[i][0]);
    if (rows[i].some(value => canonicalHeader(value) === 'Sequence')) {
      headerIndex = i;
      break;
    }
    if (['Shop Name', 'Shop ID', 'Ad Name', 'Product ID', 'Date Period', 'Report Creation Time'].includes(label)) {
      metadata[label] = rows[i][1];
    }
  }
  if (headerIndex < 0) throw new Error('Product Ads Seller Centre header row was not found');

  const header = rows[headerIndex].map(canonicalHeader);
  const missing = REQUIRED_HEADERS.filter(name => !header.includes(name));
  if (missing.length) throw new Error(`Product Ads Seller Centre export missing headers: ${missing.join(', ')}`);

  const shopId = Number(metadata['Shop ID']);
  const productId = Number(metadata['Product ID']);
  const adName = String(metadata['Ad Name'] || '').trim();
  if (!Number.isSafeInteger(shopId) || shopId <= 0) throw new Error('Shop ID is required');
  if (!Number.isSafeInteger(productId) || productId <= 0) throw new Error('Product ID is required');
  if (!adName) throw new Error('Ad Name is required');
  if (!metadata['Date Period']) throw new Error('Date Period is required');

  const campaignId = parseCampaignIdFromFilename(filename);
  const period = parseDatePeriod(metadata['Date Period']);
  const dataRows = rows.slice(headerIndex + 1)
    .filter(values => values.some(value => String(value).trim()))
    .map(values => objectFromHeader(header, values))
    .filter(row => /^\d+$/.test(String(row.Sequence || '').trim()));
  if (!dataRows.length) throw new Error('Product Ads Seller Centre export has no metric rows');

  const impressions = sumRequired(dataRows, 'Impression');
  const clicks = sumRequired(dataRows, 'Clicks');
  const addToCart = sumRequired(dataRows, 'Add To Cart');
  const broadOrders = sumRequired(dataRows, 'Conversions');
  const directOrders = sumRequired(dataRows, 'Direct Conversions');
  const broadUnits = sumRequired(dataRows, 'Items Sold');
  const directUnits = sumRequired(dataRows, 'Direct Items Sold');
  const broadGmv = sumRequired(dataRows, 'GMV');
  const directGmv = sumRequired(dataRows, 'Direct GMV');
  const expense = sumRequired(dataRows, 'Expense');
  const voucherAmount = sumRequired(dataRows, 'Voucher Amount');
  const voucheredSales = sumRequired(dataRows, 'Vouchered Sales');

  const derived = {
    ctr: safeDiv(clicks, impressions),
    addToCartRate: safeDiv(addToCart, clicks),
    broadCvr: safeDiv(broadOrders, clicks),
    directCvr: safeDiv(directOrders, clicks),
    costPerConversion: safeDiv(expense, broadOrders),
    costPerDirectConversion: safeDiv(expense, directOrders),
    broadRoas: safeDiv(broadGmv, expense),
    directRoas: safeDiv(directGmv, expense),
    broadAcos: safeDiv(expense, broadGmv),
    directAcos: safeDiv(expense, directGmv),
  };

  const promotion = normalizeManualPromotion({
    shopId,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    promotionType: 'INDIVIDUAL_AD',
    campaignId,
    campaignName: adName,
    impressions,
    clicks,
    expense,
    orders: broadOrders,
    gmv: broadGmv,
    ctr: derived.ctr,
    cvr: derived.broadCvr,
    roas: derived.broadRoas,
    addToCart,
    itemCount: 1,
  }, { source: 'MANUAL_IMPORT' });
  promotion.promotionKey = `MANUAL_IMPORT:product-ad:${campaignId}`;
  promotion.sourceAdType = 'PRODUCT_AD_SELLER_CENTRE_EXPORT';
  promotion.directGmv = directGmv;
  promotion.directRoas = derived.directRoas;
  promotion.raw = {
    sourceFormat: 'SHOPEE_PRODUCT_AD_EXPORT',
    sourceFilename: path.basename(String(filename || '')),
    sourceShopName: String(metadata['Shop Name'] || '').trim() || null,
    sourceReportCreatedAt: String(metadata['Report Creation Time'] || '').trim() || null,
    sourcePeriodStart: period.periodStart,
    sourcePeriodEnd: period.periodEnd,
    sourceRowCount: dataRows.length,
    sourceMetrics: {
      impressions,
      clicks,
      addToCart,
      broadOrders,
      directOrders,
      broadUnits,
      directUnits,
      broadGmv,
      directGmv,
      expense,
      voucherAmount,
      voucheredSales,
      ...derived,
    },
    rows: dataRows,
  };

  const item = normalizeManualItem({
    itemId: productId,
    productName: adName,
    impressions,
    clicks,
    expense,
    orders: broadOrders,
    gmv: broadGmv,
    roas: derived.broadRoas,
    ctr: derived.ctr,
    cvr: derived.broadCvr,
    addToCart,
  });
  item.directGmv = directGmv;
  item.directRoas = derived.directRoas;
  item.raw = { sourceFormat: 'SHOPEE_PRODUCT_AD_EXPORT', sourceMetrics: promotion.raw.sourceMetrics };

  const preview = {
    reportSource: 'SHOPEE_PRODUCT_AD_EXPORT',
    shopId,
    shopName: promotion.raw.sourceShopName,
    campaignId,
    productId,
    adName,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    granularity: period.granularity,
    fallbackEligible: period.granularity === 'DAY',
    sourceRowCount: dataRows.length,
    metrics: promotion.raw.sourceMetrics,
  };

  return { promotion, item, preview };
}

function parseProductAdSellerCentreFile({ buffer, filename = '' }) {
  const rows = /\.xlsx$/i.test(filename)
    ? parseWorkbook(buffer)
    : parseCsv(Buffer.isBuffer(buffer) ? buffer.toString('utf8') : String(buffer));
  return parseProductAdSellerCentreReport(rows, { filename });
}

module.exports = {
  METADATA_ALIASES,
  HEADER_ALIASES,
  REQUIRED_HEADERS,
  parseCampaignIdFromFilename,
  parseProductAdSellerCentreReport,
  parseProductAdSellerCentreFile,
};
