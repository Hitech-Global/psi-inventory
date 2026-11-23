'use strict';

const COUNTRY_CODES = Object.freeze({
  indonesia: 'ID', '印度尼西亚': 'ID', '印度尼西亚共和国': 'ID', '印尼': 'ID', id: 'ID',
  thailand: 'TH', '泰国': 'TH', '泰王国': 'TH', th: 'TH',
  malaysia: 'MY', '马来西亚': 'MY', '马来西亚联邦': 'MY', '马来': 'MY', my: 'MY',
  china: 'CN', '中国': 'CN', cn: 'CN',
  singapore: 'SG', '新加坡': 'SG', sg: 'SG',
  vietnam: 'VN', '越南': 'VN', vn: 'VN',
  philippines: 'PH', '菲律宾': 'PH', ph: 'PH',
  'united states': 'US', '美国': 'US', usa: 'US', us: 'US',
  'united kingdom': 'GB', '英国': 'GB', uk: 'GB', gb: 'GB',
  australia: 'AU', '澳大利亚': 'AU', au: 'AU',
  japan: 'JP', '日本': 'JP', jp: 'JP',
  korea: 'KR', 'south korea': 'KR', '韩国': 'KR', '南韩': 'KR', kr: 'KR',
  taiwan: 'TW', '台湾': 'TW', '中国台湾': 'TW', tw: 'TW',
  india: 'IN', '印度': 'IN', in: 'IN',
  germany: 'DE', '德国': 'DE', de: 'DE',
  france: 'FR', '法国': 'FR', fr: 'FR',
  netherlands: 'NL', '荷兰': 'NL', nl: 'NL',
  'united arab emirates': 'AE', '阿联酋': 'AE', '阿拉伯联合酋长国': 'AE', uae: 'AE', ae: 'AE'
});

function countryCode(country) {
  const raw = String(country || '').normalize('NFKC').trim();
  const key = raw.toLowerCase().replace(/\\s+/g, ' ');
  const code = COUNTRY_CODES[key];
  if (code) return code;
  const upper = raw.toUpperCase();
  if (/^[A-Z]{2}$/.test(upper)) return upper;
  const error = new Error('无法识别国家缩写，请使用国家全称或两位国家代码：' + country);
  error.status = 400;
  throw error;
}

function generatePONumber(country, poDate, now = Date.now()) {
  const date = String(poDate || '').slice(0, 10);
  const parsed = new Date(date + 'T00:00:00Z');
  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(date) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    const error = new Error('PO日期格式无效，必须为 YYYY-MM-DD');
    error.status = 400;
    throw error;
  }
  const compactDate = date.replace(/-/g, '');
  const suffix = String(now).slice(-8).padStart(8, '0');
  return 'PO-' + compactDate + '-' + countryCode(country) + '-' + suffix;
}

module.exports = { generatePONumber, countryCode };
