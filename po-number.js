'use strict';

const COUNTRY_CODES = Object.freeze({
  indonesia: 'ID', id: 'ID',
  thailand: 'TH', th: 'TH',
  malaysia: 'MY', my: 'MY',
  china: 'CN', cn: 'CN',
  singapore: 'SG', sg: 'SG',
  vietnam: 'VN', vn: 'VN',
  philippines: 'PH', ph: 'PH',
  'united states': 'US', usa: 'US', us: 'US',
  'united kingdom': 'GB', uk: 'GB', gb: 'GB',
  australia: 'AU', au: 'AU',
  japan: 'JP', jp: 'JP',
  korea: 'KR', 'south korea': 'KR', kr: 'KR',
  taiwan: 'TW', tw: 'TW',
  india: 'IN', in: 'IN',
  germany: 'DE', de: 'DE',
  france: 'FR', fr: 'FR',
  netherlands: 'NL', nl: 'NL',
  'united arab emirates': 'AE', uae: 'AE', ae: 'AE'
});

function countryCode(country) {
  const key = String(country || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const code = COUNTRY_CODES[key];
  if (code) return code;
  const upper = String(country || '').trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(upper)) return upper;
  const error = new Error('无法识别国家缩写，请使用国家全称或两位国家代码：' + country);
  error.status = 400;
  throw error;
}

function generatePONumber(country, poDate, now = Date.now()) {
  const date = String(poDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date + 'T00:00:00Z'))) {
    const error = new Error('PO日期格式无效，必须为 YYYY-MM-DD');
    error.status = 400;
    throw error;
  }
  const compactDate = date.replace(/-/g, '');
  const suffix = String(now).slice(-8).padStart(8, '0');
  return 'PO-' + compactDate + '-' + countryCode(country) + '-' + suffix;
}

module.exports = { generatePONumber, countryCode };
