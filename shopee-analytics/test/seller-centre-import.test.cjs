'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  parseIndonesianNumber,
  parseIndonesianPercent,
  parsePlainNumber,
  parsePlainPercent,
  parseIndonesianDate,
  parsePlainDate,
  isDayCell,
  isRangeCell,
  parseOrderSheet,
  orderStatusFromSheetName,
  parseProductSheet,
  shopFromFileName,
  parseAdsReportHeadings,
  parseAdsRows,
} = require('../src/import/seller-centre');

test('a number written the Indonesian way is read the Indonesian way', () => {
  // A dot for the thousands and a comma for the decimals. Reading it the
  // English way would be wrong by a factor of a million.
  assert.equal(parseIndonesianNumber('589.334.941'), 589334941);
  assert.equal(parseIndonesianNumber('11.704.862'), 11704862);
  assert.equal(parseIndonesianNumber('189.557,72'), 189557.72);
  assert.equal(parseIndonesianNumber('146.310,77'), 146310.77);
  assert.equal(parseIndonesianNumber('2.783,00'), 2783);
  assert.equal(parseIndonesianNumber('3557'), 3557);
  // A dot is always the thousands separator, even on its own: "2.078" is
  // two thousand and seventy-eight, and it sits beside "4.230,00" in the
  // same column.
  assert.equal(parseIndonesianNumber('1.27'), 127);
  assert.equal(parseIndonesianNumber('2.078'), 2078);
});

test('a dash is missing, not zero', () => {
  assert.equal(parseIndonesianNumber('-'), null);
  assert.equal(parseIndonesianNumber(''), null);
  assert.equal(parseIndonesianNumber(null), null);
  assert.equal(parseIndonesianNumber('   '), null);
  // Zero is zero.
  assert.equal(parseIndonesianNumber('0'), 0);
});

test('a percentage is read as a fraction', () => {
  assert.equal(parseIndonesianPercent('2,67%'), 0.0267);
  assert.equal(parseIndonesianPercent('16,46%'), 0.1646);
  assert.equal(parseIndonesianPercent('0,15%'), 0.0015);
  assert.equal(parseIndonesianPercent('-'), null);
});

test('a rate written without the sign is a multiple, not a fraction', () => {
  // The advertising export writes a return rate as "7,31" — seven and a
  // bit per cent, not seven hundred and thirty-one per cent.
  assert.equal(parseIndonesianPercent('7,31'), 0.0731);
});

test('a number in the advertising export is read the other way round', () => {
  // A dot for the decimals and no thousands separator at all.
  assert.equal(parsePlainNumber('125823914'), 125823914);
  assert.equal(parsePlainNumber('31914.93'), 31914.93);
  assert.equal(parsePlainNumber('-'), null);
  assert.equal(parsePlainPercent('11.67%'), 0.1167);
  assert.equal(parsePlainPercent('3.97%'), 0.0397);
});

test('a day is read as day-month-year', () => {
  assert.equal(parseIndonesianDate('01-10-2026'), '2026-10-01');
  assert.equal(parseIndonesianDate('31-10-2026'), '2026-10-31');
  assert.equal(parsePlainDate('25/09/2024 00:00:00'), '2024-09-25');
});

test('a period is not mistaken for a day', () => {
  assert.ok(isRangeCell('01-10-2026-31-10-2026'));
  assert.ok(!isDayCell('01-10-2026-31-10-2026'));
  assert.ok(isDayCell('01-10-2026'));
  assert.ok(!isDayCell('Search'));
  assert.ok(!isDayCell('Product Card'));
});

test('the shop\'s daily figures are read, and the period total is left out', () => {
  const rows = [
    ['Date', 'Sales (IDR)', 'Orders', 'Sales per Order', 'Product Clicks', 'Visitors',
      'Order Conversion Rate', 'Cancelled Orders', 'Cancelled Sales', 'Returned/Refunded Orders',
      'Returned/Refunded Sales', '# of buyers', '# of new buyers', '# of existing buyers',
      '# of potential buyers', 'Repeat Purchase Rate'],
    ['01-10-2026-31-10-2026', '589.334.941', '3109', '189.557,72', '116410', '54904', '2,67%',
      '455', '114.931.984', '23', '5.174.736', '2308', '1689', '619', '6325', '16,46%'],
    [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    ['Date', 'Sales (IDR)', 'Orders', 'Sales per Order', 'Product Clicks', 'Visitors',
      'Order Conversion Rate', 'Cancelled Orders', 'Cancelled Sales', 'Returned/Refunded Orders',
      'Returned/Refunded Sales', '# of buyers', '# of new buyers', '# of existing buyers',
      '# of potential buyers', 'Repeat Purchase Rate'],
    ['01-10-2026', '11.704.862', '80', '146.310,77', '3557', '2822', '2,25%', '8', '1.120.120',
      '0', '0', '77', '50', '27', '216', '3,90%'],
    ['02-10-2026', '14.227.318', '79', '180.092,63', '3248', '2385', '2,43%', '9', '1.736.600',
      '3', '412.900', '75', '50', '25', '190', '5,33%'],
  ];
  const { days } = parseOrderSheet(rows, 'PLACED');
  // The period total and the repeated heading are both left out: counting
  // the total as a day would double the shop's figures.
  assert.equal(days.length, 2);
  assert.equal(days[0].eventDate, '2026-10-01');
  assert.equal(days[0].sales, 11704862);
  assert.equal(days[0].orders, 80);
  assert.equal(days[0].visitors, 2822);
  assert.equal(days[0].productClicks, 3557);
  assert.equal(days[0].orderConversionRate, 0.0225);
  assert.equal(days[0].salesPerOrder, 146310.77);
  assert.equal(days[0].potentialBuyers, 216);
  assert.equal(days[1].eventDate, '2026-10-02');
});

test('the state an order sheet counts is taken from its name', () => {
  assert.equal(orderStatusFromSheetName('Placed Order'), 'PLACED');
  assert.equal(orderStatusFromSheetName('Confirmed Order'), 'CONFIRMED');
  assert.equal(orderStatusFromSheetName('Paid Order'), 'PAID');
  assert.equal(orderStatusFromSheetName('Traffic Sources (placed order)'), null);
});

test('a product and its variations are both kept apart', () => {
  const rows = [
    ['Item ID', 'Product', 'Current Item Status', 'Variation ID', 'Variation Name',
      'Current Variation Status', 'SKU', 'Parent SKU', 'Sales (Placed Order) (IDR)',
      'Product Impression', 'Product Clicks', 'Product Visitors (Visit)', 'Product Page Views',
      'Likes', 'Product Visitors (Add to Cart)', 'Units (Add to Cart)'],
    ['26361970562', 'Netac Flashdisk', 'Normal', '-', '-', '-', '-', 'NT02P500STN-N/S/R',
      '129.885.561', '551658', '21415', '736', '918', '120', '55', '9'],
    ['26361970562', 'Netac Flashdisk', 'Normal', '246953857926', 'Blue,64 GB', 'Normal',
      'NT03UA31N-064G-20BL', '', '1.774.100', '-', '-', '-', '-', '-', '-', '-'],
  ];
  const { products } = parseProductSheet(rows, 'Top Performing Products');
  assert.equal(products.length, 2);
  assert.equal(products[0].rowKind, 'PRODUCT');
  assert.equal(products[0].parentSku, 'NT02P500STN-N/S/R');
  assert.equal(products[0].salesPlaced, 129885561);
  assert.equal(products[0].productVisitors, 736);
  assert.equal(products[0].productPageViews, 918);
  assert.equal(products[0].likes, 120);
  assert.equal(products[0].addToCartVisitors, 55);
  assert.equal(products[0].addToCartUnits, 9);
  assert.equal(products[1].rowKind, 'VARIATION');
  assert.equal(products[1].variationId, '246953857926');
  assert.equal(products[1].sku, 'NT03UA31N-064G-20BL');
  // A missing figure stays missing rather than becoming a zero.
  assert.equal(products[1].productImpression, null);
});

test('the shop is named by the file it came in', () => {
  const shop = shopFromFileName('netacofficialstore.shopee-shop-stats.20261001-20261031.xlsx');
  assert.equal(shop.username, 'netacofficialstore');
  assert.equal(shop.report, 'shopee-shop-stats.20261001-20261031');
});

test('the advertising report says which shop it is about', () => {
  const lines = [
    'All CPC Ads Report - Shopee Indonesia',
    'User Name,netacofficialstore',
    'Shop Name,Netac Official Store',
    'Shop ID,1326456001',
    'Report Creation Time,02/11/2026 08:29',
    'Date Period,01/10/2026 - 31/10/2026',
    '',
    'Sequence,Ad Name,Status,Ads Type,Product ID,Impression,Clicks,CTR,Expense,GMV,ROAS',
    '1,Shop GMV Max,Ongoing,,,460907,18314,3.97%,14680866,125823914,8.57',
    '',
  ];
  const { meta, header, rows } = parseAdsReportHeadings(lines);
  assert.equal(meta.userName, 'netacofficialstore');
  assert.equal(meta.shopName, 'Netac Official Store');
  assert.equal(meta.shopId, '1326456001');
  assert.equal(meta.datePeriod, '01/10/2026 - 31/10/2026');
  assert.equal(header[0], 'Sequence');
  assert.equal(rows.length, 1);

  const parsed = parseAdsRows(header, rows);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].impression, 460907);
  assert.equal(parsed[0].ctr, 0.0397);
  assert.equal(parsed[0].expense, 14680866);
  assert.equal(parsed[0].gmv, 125823914);
  assert.equal(parsed[0].roas, 8.57);
});
