'use strict';

const assert = require('assert');
const { parseCsv, parseDatePeriod, parseShopeeAdGroupReport, parseShopeeAdGroupFile, previewShopeeAdGroupReport, SHOPEE_AD_GROUP_MONEY_ROUNDING_TOLERANCE, SHOPEE_AD_GROUP_MINOR_MONEY_ROUNDING_TOLERANCE } = require('../src/shopee-ad-group-import');
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

const cnHeader = ['排序','广告 / 商品名称','状态','广告类型','商品编号','竞价方式','开始日期','结束日期','展示次数','点击数','点击率','转化','直接转化','转化率','直接转化率','每转化成本','每一直接转化的成本','商品已出售','直接已售商品','销售金额','直接销售金额','花费','广告支出回报率','直接广告支出回报率','广告销售成本','直接广告销售成本','Voucher Amount','Vouchered Sales'];
function cnRow({ sequence, name, productId, bidding = '-', start = '-', end = '-', impressions, clicks, conversions, directConversions = conversions, itemsSold = conversions, directItemsSold = conversions, gmv, directGmv = gmv, expense, roas, directRoas = roas }) {
  const csvValue = value => /[,"]/.test(String(value)) ? `"${String(value).replace(/"/g, '""')}"` : value;
  const cvr = clicks ? ((conversions / clicks) * 100).toFixed(2) : 0;
  const directCvr = clicks ? ((directConversions / clicks) * 100).toFixed(2) : 0;
  return [sequence, name, productId === '-' ? '正在进行' : '-', '商品广告', productId, bidding, start, end, impressions, clicks, `${impressions ? ((clicks / impressions) * 100).toFixed(2) : 0}%`, conversions, directConversions, `${cvr}%`, `${directCvr}%`, expense, expense, itemsSold, directItemsSold, gmv, directGmv, expense, roas, directRoas, '0%', '0%', 0, 0].map(csvValue).join(',');
}
const cnRows = [
  cnRow({ sequence: 1, name: 'Parent without locale prefix', productId: '-', bidding: '全站推广自定义ROAS', start: '2026/09/22 00:00:00', end: '无限制', impressions: 778, clicks: 33, conversions: 1, gmv: 98, expense: 8.10, roas: 12.10 }),
  ...[100,100,100,100,100,100,178].map((impressions, index) => cnRow({ sequence: index + 2, name: index === 0 ? 'Mouse, Wired' : `Child ${index + 1}`, productId: String(50000000000 + index), impressions, clicks: [5,5,5,5,5,4,4][index], conversions: index === 0 ? 1 : 0, gmv: index === 0 ? 98 : 0, expense: index === 6 ? 2.03 : 1.01, roas: index === 0 ? 97.03 : 0 })),
  cnRow({ sequence: 9, name: '第二个父行也不靠名称识别', productId: '-', bidding: '全站推广自定义ROAS', start: '2026/09/22 00:00:00', end: '无限制', impressions: 442, clicks: 16, conversions: 0, gmv: 0, expense: 2.76, roas: 0 }),
  ...[70,70,70,70,70,92].map((impressions, index) => cnRow({ sequence: index + 10, name: `Child B${index + 1}`, productId: String(60000000000 + index), impressions, clicks: index === 5 ? 1 : 3, conversions: 0, gmv: 0, expense: index === 5 ? 0.47 : 0.46, roas: 0 })),
];
const cnCsv = `\uFEFF广告组 - Shopee Malaysia\n用户名称,redragonos3pf.my\n商店名称,Redragon Malaysia OS\n商店ID,1770037299\n报告创建时间,2026/09/26 16:53\n时间,2026/09/22 - 2026/09/22\n\n${cnHeader.join(',')}\n${cnRows.join('\n')}\n`;
const cnReport = parseShopeeAdGroupReport(parseCsv(cnCsv));
const cnPreview = previewShopeeAdGroupReport(cnReport);
assert.deepStrictEqual(cnReport.metadata, { shopName: 'Redragon Malaysia OS', shopId: 1770037299, periodStart: '2026-09-22', periodEnd: '2026-09-22', granularity: 'DAY' });
assert.strictEqual(cnReport.groups.length, 2);
assert.strictEqual(cnPreview.itemRowCount, 13);
assert.strictEqual(cnPreview.groups[0].name, 'Parent without locale prefix');
assert.strictEqual(cnPreview.groups[0].expense, 8.1);
assert.strictEqual(cnPreview.groups[0].directGmv, 98);
assert.strictEqual(cnPreview.groups[1].directGmv, 0, 'explicit source direct GMV zero must remain zero');
assert.strictEqual(cnReport.groups[0].group.sourceRoas, 12.1, 'CSV realized ROAS is source ROAS');
assert.strictEqual(cnReport.groups[0].group.targetRoas, null, 'CSV ROAS must not become a target ROAS');
assert.strictEqual(cnReport.groups[0].group.estimatedRoas, null, 'CSV does not provide estimated ROAS');
assert.strictEqual(cnReport.groups[0].group.directGmv, 98);
assert.strictEqual(cnReport.groups[0].group.directRoas, 12.1);
assert.strictEqual(cnReport.groups[1].group.sourceRoas, 0);
assert.strictEqual(cnReport.groups[1].group.directGmv, 0, 'parent explicit direct GMV zero must remain zero');
assert.strictEqual(cnReport.groups[1].group.directRoas, 0, 'parent explicit direct ROAS zero must remain zero');
assert.strictEqual(cnReport.groups[0].items[0].directGmv, 98);
assert.strictEqual(cnReport.groups[0].items[0].directRoas, 97.03);
const missingDirect = parseShopeeAdGroupReport(parseCsv(csv.replace(/,900,100,10,9,/g, ',,100,10,,')));
assert.strictEqual(missingDirect.groups[0].group.directGmv, null, 'missing source direct GMV stays null');
assert.strictEqual(missingDirect.groups[0].group.directRoas, null, 'missing source direct ROAS stays null');
assert.strictEqual(cnPreview.roundingWarningCount, 2);
assert(cnPreview.warnings.every(w => w.tolerance === SHOPEE_AD_GROUP_MINOR_MONEY_ROUNDING_TOLERANCE));
assert(!cnReport.groups.some(({ group }) => group.dataQualityStatus === 'DATA_MISMATCH'));
const reorderedRows = parseCsv(cnCsv); const localizedHeaderIndex = reorderedRows.findIndex(row => row[0] === '排序');
const order = [4, 0, 1, 2, 3, ...Array.from({ length: cnHeader.length - 5 }, (_, index) => index + 5)];
reorderedRows[localizedHeaderIndex] = order.map(index => reorderedRows[localizedHeaderIndex][index]);
for (let i = localizedHeaderIndex + 1; i < reorderedRows.length; i += 1) if (reorderedRows[i].length) reorderedRows[i] = order.map(index => reorderedRows[i][index]);
assert.strictEqual(parseShopeeAdGroupReport(reorderedRows).groups.length, 2, 'headers, not column order, define mappings');
assert.throws(() => parseShopeeAdGroupReport(parseCsv(cnCsv.replace('直接广告支出回报率,', ''))), /missing required headers/);
assert.strictEqual(SHOPEE_AD_GROUP_MINOR_MONEY_ROUNDING_TOLERANCE, 0.01);

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
