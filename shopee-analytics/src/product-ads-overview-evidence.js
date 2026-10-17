'use strict';

const path = require('path');
const {
  parseCsv,
  parseWorkbook,
  parseDatePeriod,
  normalizeShopeeMetric,
} = require('./shopee-ad-group-import');

const META_ALIASES = Object.freeze({
  '商店ID': 'Shop ID',
  '商店编号': 'Shop ID',
  '时间': 'Date Period',
  '日期范围': 'Date Period',
  '商店名称': 'Shop Name',
});

const HEADER_ALIASES = Object.freeze({
  '日期': 'Date',
  '展示次数': 'Impression',
  '点击数': 'Clicks',
  '点击率': 'CTR',
  '订单量': 'Orders',
  '商品已出售': 'Items Sold',
  '销售额': 'GMV',
  '销售金额': 'GMV',
  '花费': 'Expense',
  '广告支出回报率': 'ROAS',
  '优惠券金额': 'Voucher Amount',
  '优惠券带来的销售额': 'Vouchered Sales',
  '加购次数': 'Add To Cart',
  '加入购物车': 'Add To Cart',
  '加购率': 'Add To Cart Rate',
  '加入购物车频率': 'Add To Cart Rate',
});

const REQUIRED_HEADERS = Object.freeze([
  'Impression', 'Clicks', 'Orders', 'Items Sold', 'GMV', 'Expense', 'ROAS',
  'Voucher Amount', 'Vouchered Sales', 'Add To Cart', 'Add To Cart Rate',
]);

function clean(value) {
  return String(value ?? '').replace(/^\uFEFF/, '').trim();
}
function canonicalMeta(value) {
  const label = clean(value);
  return META_ALIASES[label] || label;
}
function canonicalHeader(value) {
  const label = clean(value);
  return HEADER_ALIASES[label] || label;
}
function parseIsoDate(value) {
  const text = clean(value);
  let match = text.match(/^(\d{4})[-/](\d{2})[-/](\d{2})$/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  match = text.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
  if (match) return `${match[3]}-${match[2]}-${match[1]}`;
  return null;
}

function inferPeriodFromFilename(filename) {
  const text = path.basename(String(filename || ''));
  const dates = [...text.matchAll(/(20\d{2})[_-](\d{2})[_-](\d{2})/g)]
    .map(match => `${match[1]}-${match[2]}-${match[3]}`);
  if (!dates.length) return null;
  const periodStart = dates[0];
  const periodEnd = dates[1] || periodStart;
  return { periodStart, periodEnd, granularity: periodStart === periodEnd ? 'DAY' : 'RANGE' };
}

function objectFromHeader(header, values) {
  return Object.fromEntries(header.map((name, index) => [name, values[index] ?? '']));
}

function metric(row, field, { percentage = false } = {}) {
  return normalizeShopeeMetric(row[field], { percentage });
}
function parseOverviewSellerCentreReport(rows, { filename = '' } = {}) {
  if (!Array.isArray(rows) || !rows.length) throw new Error('Product Card overview Seller Centre report is empty');
  const metadata = {};
  let headerIndex = -1;
  for (let i = 0; i < rows.length; i += 1) {
    const normalized = rows[i].map(canonicalHeader);
    if (REQUIRED_HEADERS.every(name => normalized.includes(name))) {
      headerIndex = i;
      break;
    }
    const label = canonicalMeta(rows[i][0]);
    if (['Shop ID', 'Date Period', 'Shop Name'].includes(label)) metadata[label] = rows[i][1];
  }
  if (headerIndex < 0) throw new Error('Product Card overview Seller Centre header row was not found');

  const header = rows[headerIndex].map(canonicalHeader);
  const missing = REQUIRED_HEADERS.filter(name => !header.includes(name));
  if (missing.length) throw new Error(`Product Card overview export missing headers: ${missing.join(', ')}`);
  const dataRows = rows.slice(headerIndex + 1)
    .filter(values => values.some(value => clean(value)))
    .map(values => objectFromHeader(header, values));
  if (!dataRows.length) throw new Error('Product Card overview Seller Centre export has no metric rows');

  const metadataShopId = Number(metadata['Shop ID']);
  const inferredPeriod = metadata['Date Period'] ? parseDatePeriod(metadata['Date Period']) : inferPeriodFromFilename(filename);
  if (!inferredPeriod && !header.includes('Date')) throw new Error('Overview evidence requires a Date column or date period metadata/filename');
  if (!header.includes('Date') && dataRows.length !== 1) {
    throw new Error('Overview export without a Date column must contain exactly one metric row');
  }

  const evidenceRows = dataRows.map(raw => {
    let period;
    if (header.includes('Date')) {
      const eventDate = parseIsoDate(raw.Date);
      if (!eventDate) throw new Error(`invalid overview evidence date: ${raw.Date}`);
      period = { periodStart: eventDate, periodEnd: eventDate, granularity: 'DAY' };
    } else {
      period = inferredPeriod;
    }
    return {
      ...period,
      impressions: metric(raw, 'Impression'),
      clicks: metric(raw, 'Clicks'),
      broadOrders: metric(raw, 'Orders'),
      broadUnits: metric(raw, 'Items Sold'),
      broadGmv: metric(raw, 'GMV'),
      expense: metric(raw, 'Expense'),
      broadRoas: metric(raw, 'ROAS'),
      addToCart: metric(raw, 'Add To Cart'),
      addToCartRate: metric(raw, 'Add To Cart Rate', { percentage: true }),
      voucherAmount: metric(raw, 'Voucher Amount'),
      voucheredSales: metric(raw, 'Vouchered Sales'),
      raw,
    };
  });
  return {
    reportSource: 'SHOPEE_PRODUCT_ADS_OVERVIEW_EXPORT',
    shopId: Number.isSafeInteger(metadataShopId) && metadataShopId > 0 ? metadataShopId : null,
    shopName: clean(metadata['Shop Name']) || null,
    sourceFile: path.basename(String(filename || '')) || null,
    rows: evidenceRows,
    preview: {
      rowCount: evidenceRows.length,
      periodStart: evidenceRows[0].periodStart,
      periodEnd: evidenceRows[evidenceRows.length - 1].periodEnd,
      granularities: Array.from(new Set(evidenceRows.map(row => row.granularity))),
    },
  };
}

function parseOverviewSellerCentreFile({ buffer, filename = '' }) {
  const rows = /\.xlsx$/i.test(filename)
    ? parseWorkbook(buffer)
    : parseCsv(Buffer.isBuffer(buffer) ? buffer.toString('utf8') : String(buffer));
  return parseOverviewSellerCentreReport(rows, { filename });
}

function numericOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
class ShopeeProductAdsOverviewEvidenceRepository {
  constructor({ pool }) {
    if (!pool || typeof pool.query !== 'function') throw new Error('pg pool/query adapter is required');
    this.pool = pool;
  }

  async upsertMany({ shopId, sourceFormat, sourceRef = null, rows = [], raw = null, queryable = this.pool }) {
    if (!rows.length) return { rowCount: 0 };
    const payload = rows.map(row => ({
      period_start: row.periodStart,
      period_end: row.periodEnd,
      granularity: row.granularity,
      impressions: numericOrNull(row.impressions),
      clicks: numericOrNull(row.clicks),
      broad_orders: numericOrNull(row.broadOrders),
      broad_units: numericOrNull(row.broadUnits),
      broad_gmv: numericOrNull(row.broadGmv),
      expense: numericOrNull(row.expense),
      broad_roas: numericOrNull(row.broadRoas),
      add_to_cart: numericOrNull(row.addToCart),
      add_to_cart_rate: numericOrNull(row.addToCartRate),
      voucher_amount: numericOrNull(row.voucherAmount),
      vouchered_sales: numericOrNull(row.voucheredSales),
      raw_json: row.raw || raw || {},
    }));
    await queryable.query(
      `INSERT INTO shopee_product_ads_overview_evidence
       (shop_id,period_start,period_end,granularity,source_format,source_ref,
        impressions,clicks,broad_orders,broad_units,broad_gmv,expense,broad_roas,
        add_to_cart,add_to_cart_rate,voucher_amount,vouchered_sales,raw_json,imported_at)
       SELECT $1,x.period_start,x.period_end,x.granularity,$2,$3,
              x.impressions,x.clicks,x.broad_orders,x.broad_units,x.broad_gmv,x.expense,x.broad_roas,
              x.add_to_cart,x.add_to_cart_rate,x.voucher_amount,x.vouchered_sales,x.raw_json,now()
       FROM jsonb_to_recordset($4::jsonb) AS x(
         period_start date, period_end date, granularity text,
         impressions bigint, clicks bigint, broad_orders bigint, broad_units bigint,
         broad_gmv numeric, expense numeric, broad_roas numeric,
         add_to_cart bigint, add_to_cart_rate numeric, voucher_amount numeric,
         vouchered_sales numeric, raw_json jsonb)
       ON CONFLICT (shop_id,source_format,period_start,period_end) DO UPDATE SET
         granularity=EXCLUDED.granularity,source_ref=EXCLUDED.source_ref,
         impressions=EXCLUDED.impressions,clicks=EXCLUDED.clicks,broad_orders=EXCLUDED.broad_orders,
         broad_units=EXCLUDED.broad_units,broad_gmv=EXCLUDED.broad_gmv,expense=EXCLUDED.expense,
         broad_roas=EXCLUDED.broad_roas,add_to_cart=EXCLUDED.add_to_cart,
         add_to_cart_rate=EXCLUDED.add_to_cart_rate,voucher_amount=EXCLUDED.voucher_amount,
         vouchered_sales=EXCLUDED.vouchered_sales,raw_json=EXCLUDED.raw_json,imported_at=now()`,
      [shopId, sourceFormat, sourceRef, JSON.stringify(payload)],
    );
    return { rowCount: rows.length };
  }

  async list({ shopId, startDate, endDate }) {
    const result = await this.pool.query(
      `SELECT shop_id,period_start::text,period_end::text,granularity,source_format,source_ref,
              impressions,clicks,broad_orders,broad_units,broad_gmv,expense,broad_roas,
              add_to_cart,add_to_cart_rate,voucher_amount,vouchered_sales,raw_json,imported_at
       FROM shopee_product_ads_overview_evidence
       WHERE shop_id=$1 AND period_start >= $2::date AND period_end <= $3::date
       ORDER BY period_start,period_end,imported_at DESC`,
      [shopId, startDate, endDate],
    );
    return result.rows;
  }

  async findExact({ shopId, startDate, endDate }) {
    const result = await this.pool.query(
      `SELECT shop_id,period_start::text,period_end::text,granularity,source_format,source_ref,
              impressions,clicks,broad_orders,broad_units,broad_gmv,expense,broad_roas,
              add_to_cart,add_to_cart_rate,voucher_amount,vouchered_sales,raw_json,imported_at
       FROM shopee_product_ads_overview_evidence
       WHERE shop_id=$1 AND period_start=$2::date AND period_end=$3::date
       ORDER BY CASE source_format
         WHEN 'SHOPEE_PRODUCT_ADS_OVERVIEW_EXPORT' THEN 1
         WHEN 'USER_VERIFIED_SCREENSHOT' THEN 2
         ELSE 9 END, imported_at DESC
       LIMIT 1`,
      [shopId, startDate, endDate],
    );
    return result.rows[0] || null;
  }
}

module.exports = {
  META_ALIASES,
  HEADER_ALIASES,
  REQUIRED_HEADERS,
  parseIsoDate,
  inferPeriodFromFilename,
  parseOverviewSellerCentreReport,
  parseOverviewSellerCentreFile,
  ShopeeProductAdsOverviewEvidenceRepository,
};
