'use strict';

const crypto = require('crypto');
const { normalizeManualPromotion, normalizeManualItem, nullableInt } = require('./manual-ad-group');

const SHOPEE_AD_GROUP_MONEY_ROUNDING_TOLERANCE = 1;
const REQUIRED_HEADERS = Object.freeze([
  'Sequence', 'Ad / Product Name', 'Status', 'Ads Type', 'Product ID', 'Bidding Method', 'Start Date', 'End Date',
  'Impression', 'Clicks', 'CTR', 'Conversions', 'Direct Conversions', 'Conversion Rate', 'Direct Conversion Rate',
  'Cost per Conversion', 'Cost per Direct Conversion', 'Items Sold', 'Direct Items Sold', 'GMV', 'Direct GMV', 'Expense', 'ROAS', 'Direct ROAS', 'ACOS', 'Direct ACOS', 'Voucher Amount', 'Vouchered Sales',
]);

function parseCsv(text) {
  const rows = []; let row = []; let value = ''; let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { value += '"'; i += 1; }
      else if (c === '"') quoted = false;
      else value += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(value); value = ''; }
    else if (c === '\n') { row.push(value.replace(/\r$/, '')); rows.push(row); row = []; value = ''; }
    else value += c;
  }
  if (quoted) throw new Error('CSV contains an unterminated quoted field');
  if (value || row.length) { row.push(value.replace(/\r$/, '')); rows.push(row); }
  return rows;
}

function parseWorkbook(buffer) {
  let XLSX;
  try { XLSX = require('xlsx'); } catch { throw new Error('XLSX parsing dependency is unavailable'); }
  const workbook = XLSX.read(buffer, { type: 'buffer', raw: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error('XLSX has no worksheet');
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
}

function parseDate(value, label) {
  const m = String(value || '').trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) throw new Error(`${label} must be DD/MM/YYYY`);
  const iso = `${m[3]}-${m[2]}-${m[1]}`;
  if (Number.isNaN(new Date(`${iso}T00:00:00Z`).getTime())) throw new Error(`${label} is invalid`);
  return iso;
}

function parseDatePeriod(value) {
  const match = String(value || '').trim().match(/^(\d{2}\/\d{2}\/\d{4})\s*-\s*(\d{2}\/\d{2}\/\d{4})$/);
  if (!match) throw new Error('Date Period must be DD/MM/YYYY - DD/MM/YYYY');
  const periodStart = parseDate(match[1], 'Date Period start'); const periodEnd = parseDate(match[2], 'Date Period end');
  if (periodStart > periodEnd) throw new Error('Date Period start must be <= end');
  return { periodStart, periodEnd, granularity: periodStart === periodEnd ? 'DAY' : 'RANGE' };
}

function normalizeShopeeMetric(value, { percentage = false } = {}) {
  if (value === null || value === undefined || String(value).trim() === '' || String(value).trim() === '-') return null;
  const text = String(value).trim().replace(/,/g, '');
  const isPercent = text.endsWith('%'); const numeric = Number(isPercent ? text.slice(0, -1) : text);
  if (!Number.isFinite(numeric)) throw new Error(`invalid numeric metric: ${String(value)}`);
  return percentage || isPercent ? numeric / 100 : numeric;
}

function objectFromHeader(header, values) { return Object.fromEntries(header.map((name, index) => [name, values[index] ?? ''])); }
function rawNumber(row, field) { return normalizeShopeeMetric(row[field]); }
function rawRatio(row, field) { return normalizeShopeeMetric(row[field], { percentage: true }); }

function sourceKey({ shopId, name, startDate }) {
  const source = `${shopId}|${String(name).trim().toLowerCase().replace(/\s+/g, ' ')}|${startDate || ''}|SHOPEE_AD_GROUP_EXPORT`;
  return `MANUAL_IMPORT:group:${crypto.createHash('sha256').update(source).digest('hex')}`;
}

function rowToPromotion(row, metadata) {
  const input = {
    shopId: metadata.shopId, periodStart: metadata.periodStart, periodEnd: metadata.periodEnd, promotionType: 'AD_GROUP',
    campaignName: row['Ad / Product Name'], campaignStatus: row.Status, sourceAdType: row['Ads Type'],
    targetRoas: rawRatio(row, 'ROAS'), impressions: rawNumber(row, 'Impression'), clicks: rawNumber(row, 'Clicks'),
    orders: rawNumber(row, 'Conversions'), gmv: rawNumber(row, 'GMV'), expense: rawNumber(row, 'Expense'), ctr: rawRatio(row, 'CTR'), cvr: rawRatio(row, 'Conversion Rate'),
    remark: null,
  };
  const group = normalizeManualPromotion(input, { source: 'MANUAL_IMPORT' });
  group.promotionKey = sourceKey({ shopId: metadata.shopId, name: group.campaignName, startDate: row['Start Date'] });
  group.sourceAdType = row['Ads Type']; group.targetRoas = rawRatio(row, 'ROAS'); group.sourceRoas = rawRatio(row, 'ROAS');
  group.raw = { sourceFormat: 'SHOPEE_AD_GROUP_EXPORT', sourceShopName: metadata.shopName, sourcePeriodStart: metadata.periodStart, sourcePeriodEnd: metadata.periodEnd, parent: row };
  return group;
}

function rowToItem(row) {
  const item = normalizeManualItem({
    itemId: row['Product ID'], productName: row['Ad / Product Name'], impressions: rawNumber(row, 'Impression'), clicks: rawNumber(row, 'Clicks'), orders: rawNumber(row, 'Conversions'), gmv: rawNumber(row, 'GMV'), expense: rawNumber(row, 'Expense'), ctr: rawRatio(row, 'CTR'), cvr: rawRatio(row, 'Conversion Rate'), roas: rawRatio(row, 'ROAS'),
  });
  item.raw = { child: row, directConversions: rawNumber(row, 'Direct Conversions'), directItemsSold: rawNumber(row, 'Direct Items Sold'), directGmv: rawNumber(row, 'Direct GMV'), directRoas: rawRatio(row, 'Direct ROAS'), voucherAmount: rawNumber(row, 'Voucher Amount'), voucheredSales: rawNumber(row, 'Vouchered Sales') };
  return item;
}

function validateParentChild(group) {
  const flags = [...group.group.qualityFlags]; const warnings = [];
  const fields = [['impressions','Impression'], ['clicks','Clicks'], ['orders','Conversions'], ['gmv','GMV'], ['expense','Expense']];
  for (const [key, label] of fields) {
    const parent = group.group[key]; const children = group.items.map(item => item[key]);
    if (parent === null || children.some(value => value === null)) continue;
    const sum = children.reduce((total, value) => total + value, 0); const diff = Math.abs(parent - sum);
    const tolerance = ['gmv','expense'].includes(key) ? SHOPEE_AD_GROUP_MONEY_ROUNDING_TOLERANCE : 0;
    if (diff > tolerance) flags.push(`DATA_MISMATCH_CHILD_SUM_${label.toUpperCase()}`);
    else if (diff > 0) warnings.push({ code: 'ROUNDING_ACCEPTED', field: key, difference: diff });
  }
  group.group.qualityFlags = Array.from(new Set(flags));
  if (group.group.qualityFlags.some(flag => flag.startsWith('DATA_MISMATCH'))) group.group.dataQualityStatus = 'DATA_MISMATCH';
  return warnings;
}

function parseShopeeAdGroupReport(rows) {
  if (!Array.isArray(rows) || !rows.length) throw new Error('report is empty');
  const metadata = {}; let headerIndex = -1;
  for (let i = 0; i < rows.length; i += 1) {
    const label = String(rows[i][0] || '').trim();
    if (label === 'Sequence') { headerIndex = i; break; }
    if (['Shop Name','Shop ID','Date Period'].includes(label)) metadata[label] = rows[i][1];
  }
  if (headerIndex < 0) throw new Error('required header row was not found');
  const header = rows[headerIndex].map(value => String(value).trim());
  const missing = REQUIRED_HEADERS.filter(name => !header.includes(name));
  if (missing.length) throw new Error(`missing required headers: ${missing.join(', ')}`);
  const shopId = nullableInt(metadata['Shop ID']); if (!shopId) throw new Error('Shop ID is required');
  if (!metadata['Date Period']) throw new Error('Date Period is required');
  const period = parseDatePeriod(metadata['Date Period']); const normalizedMetadata = { shopName: String(metadata['Shop Name'] || '').trim() || null, shopId, ...period };
  const groups = []; let current = null; const warnings = [];
  for (const values of rows.slice(headerIndex + 1)) {
    if (!values.some(value => String(value).trim())) continue;
    const row = objectFromHeader(header, values); const productId = String(row['Product ID'] || '').trim();
    if (productId === '-') {
      if (!String(row['Ad / Product Name'] || '').trim() || String(row['Bidding Method'] || '').trim() === '-') throw new Error('parent ad group row is invalid');
      current = { group: rowToPromotion(row, normalizedMetadata), items: [] }; groups.push(current); continue;
    }
    if (!/^\d+$/.test(productId)) throw new Error('Product ID must be - or a positive integer');
    if (!current) throw new Error('child product row appeared before a parent ad group');
    if (String(row['Bidding Method'] || '').trim() !== '-' || String(row.Status || '').trim() !== '-' || String(row['Start Date'] || '').trim() !== '-' || String(row['End Date'] || '').trim() !== '-') throw new Error('child product row has invalid parent-only fields');
    current.items.push(rowToItem(row));
  }
  if (!groups.length) throw new Error('report has no parent ad groups');
  for (const group of groups) warnings.push(...validateParentChild(group));
  return { metadata: normalizedMetadata, groups, warnings };
}

function previewShopeeAdGroupReport(report) {
  const states = report.groups.map(({ group }) => group.dataQualityStatus);
  return { shopId: report.metadata.shopId, shopName: report.metadata.shopName, periodStart: report.metadata.periodStart, periodEnd: report.metadata.periodEnd, granularity: report.metadata.granularity, adGroupCount: report.groups.length, itemRowCount: report.groups.reduce((n, entry) => n + entry.items.length, 0), completeCount: states.filter(x => x === 'COMPLETE').length, partialCount: states.filter(x => x === 'PARTIAL').length, mismatchCount: states.filter(x => x === 'DATA_MISMATCH').length, roundingWarningCount: report.warnings.filter(w => w.code === 'ROUNDING_ACCEPTED').length, warnings: report.warnings, errors: [] };
}

function parseShopeeAdGroupFile({ buffer, filename = '' }) {
  const rows = /\.xlsx$/i.test(filename) ? parseWorkbook(buffer) : parseCsv(Buffer.isBuffer(buffer) ? buffer.toString('utf8') : String(buffer));
  const report = parseShopeeAdGroupReport(rows); return { report, preview: previewShopeeAdGroupReport(report) };
}

module.exports = { SHOPEE_AD_GROUP_MONEY_ROUNDING_TOLERANCE, REQUIRED_HEADERS, parseCsv, parseWorkbook, parseDatePeriod, normalizeShopeeMetric, parseShopeeAdGroupReport, previewShopeeAdGroupReport, parseShopeeAdGroupFile, validateParentChild };
