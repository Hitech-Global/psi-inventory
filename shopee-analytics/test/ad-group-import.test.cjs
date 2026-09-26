'use strict';

const assert = require('assert');
const { parseCsv, parseDatePeriod, parseShopeeAdGroupReport, parseShopeeAdGroupFile, previewShopeeAdGroupReport, SHOPEE_AD_GROUP_MONEY_ROUNDING_TOLERANCE } = require('../src/shopee-ad-group-import');
const { ShopeeAdPromotionRepository } = require('../src/ad-promotion-repository');
const { normalizeManualPromotion, normalizeManualItem } = require('../src/manual-ad-group');

const header = 'Sequence,Ad / Product Name,Status,Ads Type,Product ID,Bidding Method,Start Date,End Date,Impression,Clicks,CTR,Conversions,Direct Conversions,Conversion Rate,Direct Conversion Rate,Cost per Conversion,Cost per Direct Conversion,Items Sold,Direct Items Sold,GMV,Direct GMV,Expense,ROAS,Direct ROAS,ACOS,Direct ACOS,Voucher Amount,Vouchered Sales';
const csv = `Ad Group - Shopee Indonesia\nShop Name,Redacted Shop\nShop ID,1101364305\nDate Period,11/09/2026 - 11/09/2026\n\n${header}\n1,Group A,Ongoing,Product Ad,-,GMV Max Custom ROAS,28/08/2026 00:00:00,Unlimited,100,10,10%,2,2,20%,20%,5,5,2,2,1000,900,100,10,9,10%,11%,0,0\n2,Product One,-,Product Ad,41529544105,-,-,-,50,5,10%,1,1,20%,20%,5,5,1,1,500,450,50,10,9,10%,11%,0,0\n3,Product Two,-,Product Ad,41529544106,-,-,-,50,5,10%,1,1,20%,20%,5,5,1,1,500,450,49,10.2041,9.1837,9.8%,10.9%,0,0\n`;

const report = parseShopeeAdGroupReport(parseCsv(csv));
assert.strictEqual(report.metadata.shopId, 1101364305);
assert.deepStrictEqual({ periodStart: report.metadata.periodStart, periodEnd: report.metadata.periodEnd, granularity: report.metadata.granularity }, { periodStart: '2026-09-11', periodEnd: '2026-09-11', granularity: 'DAY' });
assert.strictEqual(report.groups.length, 1); assert.strictEqual(report.groups[0].items.length, 2);
assert.strictEqual(report.groups[0].group.expense, 100, 'parent must remain authoritative');
assert.strictEqual(report.groups[0].items[0].ctr, 0.1, 'percentages are normalized as ratios');
assert(report.warnings.some(w => w.code === 'ROUNDING_ACCEPTED' && w.field === 'expense'));
assert.strictEqual(SHOPEE_AD_GROUP_MONEY_ROUNDING_TOLERANCE, 1);
assert.strictEqual(previewShopeeAdGroupReport(report).roundingWarningCount, 1);
assert.strictEqual(previewShopeeAdGroupReport(report).sourceShopId, 1101364305);
assert.strictEqual(previewShopeeAdGroupReport(report).sourceShopName, 'Redacted Shop');
assert.strictEqual(previewShopeeAdGroupReport(report).reportSource, 'SHOPEE_AD_GROUP_EXPORT');
const XLSX = require('xlsx');
const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(parseCsv(csv)), 'Report');
const xlsxReport = parseShopeeAdGroupFile({ buffer: XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }), filename: 'report.xlsx' }).report;
assert.strictEqual(xlsxReport.groups.length, 1, 'XLSX must share the CSV business parser');
assert.deepStrictEqual(parseDatePeriod('11/09/2026 - 17/09/2026'), { periodStart: '2026-09-11', periodEnd: '2026-09-17', granularity: 'RANGE' });
assert.throws(() => parseShopeeAdGroupReport(parseCsv(csv.replace('41529544105,-,-,-', 'oops,-,-,-'))), /Product ID must be/);
assert.throws(() => parseShopeeAdGroupReport(parseCsv(csv.replace('1,Group A,Ongoing,Product Ad,-,GMV Max Custom ROAS,28/08/2026 00:00:00,Unlimited,100,10,10%,2,2,20%,20%,5,5,2,2,1000,900,100,10,9,10%,11%,0,0\n', ''))), /child product row appeared before/);

const manual = normalizeManualPromotion({ shopId: 1, periodStart: '2026-09-11', periodEnd: '2026-09-17', campaignName: 'Group', expense: 0, orders: 0, gmv: 0 });
assert.strictEqual(manual.granularity, 'RANGE'); assert.strictEqual(manual.expense, 0);
const item = normalizeManualItem({ itemId: 10, expense: 0, orders: 0, gmv: 0 }); assert.strictEqual(item.gmv, 0);

(async () => {
  const calls = []; const repo = new ShopeeAdPromotionRepository({ pool: { query: async (...args) => { calls.push(args); return { rows: [] }; } } });
  const row = report.groups[0].group; await repo.saveWithItems(row, report.groups[0].items);
  assert(calls.some(([sql]) => sql.includes('period_start,period_end,granularity')));
  assert(calls.some(([sql]) => sql.startsWith('DELETE FROM shopee_ad_promotion_item_daily')));
  assert(!calls.some(([sql, params]) => sql.includes('VALUES') && Array.isArray(params) && params.includes(undefined)), 'null must remain null rather than an implicit fallback');
  console.log('shopee ad group import tests: ok');
})().catch(error => { console.error(error); process.exitCode = 1; });
