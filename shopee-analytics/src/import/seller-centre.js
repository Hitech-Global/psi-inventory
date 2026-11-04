'use strict';

/**
 * Reading what the seller centre exports.
 *
 * The exports come out of the seller centre formatted for people to read:
 * a number is written the Indonesian way — a dot for the thousands and a
 * comma for the decimals — and a blank is a dash rather than nothing.
 * The advertising export is written the other way round, with a dot for
 * the decimals and no thousands separator at all. So the two are read by
 * different rules, and neither is read by guessing.
 *
 * The layout is found rather than assumed. A sheet may put its headings
 * on the first row, repeat them further down, or hide them under a banner
 * with the headings on the row after. What decides it is whether the row
 * contains the headings themselves.
 */

/**
 * A number written the Indonesian way: a dot for the thousands, a comma
 * for the decimals.
 *
 * The two separators look the wrong way round to anyone reading English,
 * and reading it the English way is wrong by a factor of a million — so
 * the rule is applied here rather than at each place the value is used.
 */
function parseIndonesianNumber(text) {
  if (text === null || text === undefined) return null;
  const raw = String(text).trim();
  if (!raw || raw === '-') return null;
  // Some cells carry the percent sign; a percent is dealt with separately.
  const cleaned = raw.replace(/%/g, '').replace(/\s/g, '');
  // The Indonesian way is fixed: a dot separates the thousands and a comma
  // separates the decimals. Deciding by which separator comes last would
  // read "189.557,72" as 189.55772 — off by a factor of a thousand.
  const normalized = cleaned.includes(',')
    ? cleaned.replace(/\./g, '').replace(',', '.')
    : cleaned.replace(/\./g, '');
  return finite(normalized);
}

/**
 * A number, with the noise of binary floating point taken off.
 *
 * A percentage of 2,67% divided by a hundred comes out as
 * 0.026699999999999998, which is the same number and not the same
 * figure. Rounding to eight places says what the export said.
 */
function finite(normalized) {
  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 1e8) / 1e8;
}

/**
 * A percentage written the Indonesian way.
 *
 * The result is a fraction, so that it can sit beside the other sources'
 * percentages without being changed.
 */
function parseIndonesianPercent(text) {
  if (text === null || text === undefined) return null;
  const raw = String(text).trim();
  if (!raw || raw === '-') return null;
  if (!raw.includes('%')) {
    // A rate given without the sign is a multiple, not a fraction: a
    // return rate of 7,31 means seven and a bit per cent.
    const value = parseIndonesianNumber(raw);
    return value === null ? null : value / 100;
  }
  const value = parseIndonesianNumber(raw);
  return value === null ? null : finite(String(value / 100));
}

/**
 * A number in the advertising export: a dot for the decimals and no
 * thousands separator at all.
 */
function parsePlainNumber(text) {
  if (text === null || text === undefined) return null;
  const raw = String(text).trim();
  if (!raw || raw === '-') return null;
  return finite(raw.replace(/,/g, '').replace(/%/g, ''));
}

/**
 * A percentage in the advertising export.
 */
function parsePlainPercent(text) {
  if (text === null || text === undefined) return null;
  const raw = String(text).trim();
  if (!raw || raw === '-') return null;
  const value = parsePlainNumber(raw);
  return value === null ? null : finite(String(value / 100));
}

/**
 * A day, written as day-month-year.
 *
 * Which end is the month is settled by the range that goes with it: the
 * export always says the first and last day of the period, and the last
 * day has a number in it that cannot be a month. That settles the order
 * for the whole file.
 */
function parseIndonesianDate(text) {
  if (text === null || text === undefined) return null;
  const raw = String(text).trim();
  const match = raw.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (!match) return null;
  const [, first, second, year] = match;
  const day = Number(first);
  const month = Number(second);
  if (day > 31 || month > 12) return null;
  if (!day) return null;
  // The Indonesian seller centre writes the day first: "31-10-2026" is the
  // last day of October, and no month is thirty-one. So the day comes
  // first here too.
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * A day in the advertising export, written day/month/year.
 */
function parsePlainDate(text) {
  if (text === null || text === undefined) return null;
  const raw = String(text).trim();
  const match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!match) return null;
  const [, day, month, year] = match;
  return `${year}-${String(Number(month)).padStart(2, '0')}-${String(Number(day)).padStart(2, '0')}`;
}

/**
 * Whether a row is a day rather than a heading, a banner or a total.
 *
 * The first column holds the day, and it is written day-month-year. It is
 * the only place a day appears.
 */
function isDayCell(value) {
  return typeof value === 'string' && /^\d{1,2}-\d{1,2}-\d{4}$/.test(value.trim());
}

/**
 * Whether a row is the total for the whole period.
 *
 * The total's day cell reads as a range — the first day, a dash, the last
 * day — and would otherwise be mistaken for a day.
 */
function isRangeCell(value) {
  return typeof value === 'string' && /^\d{1,2}-\d{1,2}-\d{4}\s*-\s*\d{1,2}-\d{1,2}-\d{4}$/.test(value.trim());
}

/**
 * The headings, wherever they are.
 *
 * A heading row is one that carries the words the sheet is about. The
 * rows above and below it are not.
 */
function findHeaderRow(rows, signatures) {
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index] || [];
    const cells = row.map(cell => String(cell ?? '').trim());
    const matched = signatures.filter(signature => cells.includes(signature)).length;
    if (matched >= Math.min(2, signatures.length)) return { index, cells };
  }
  return null;
}

/**
 * The shop's own figures for each day.
 *
 * The sheet holds the figures for the whole period on one row and then
 * one row for each day. The period row is left out: it is the same
 * figures added up, and counting it as a day would double them.
 *
 * There are three of these sheets, one for each state an order can be in.
 * They are read separately and marked with that state, because the three
 * say different things about the same shop.
 */
const ORDER_SHEET_SIGNATURES = ['Date', 'Sales (IDR)', 'Orders'];

function parseOrderSheet(rows, orderStatus) {
  const header = findHeaderRow(rows, ORDER_SHEET_SIGNATURES);
  if (!header) return { orderStatus, days: [], skipped: 'no header row found' };
  const columns = header.cells;
  const indexOf = name => columns.indexOf(name);
  const days = [];
  for (let index = header.index + 1; index < rows.length; index += 1) {
    const row = rows[index] || [];
    const first = row[0];
    if (!isDayCell(first)) continue;
    const date = parseIndonesianDate(first);
    if (!date) continue;
    const at = name => row[indexOf(name)];
    days.push({
      orderStatus,
      eventDate: date,
      sales: parseIndonesianNumber(at('Sales (IDR)')),
      orders: parseIndonesianNumber(at('Orders')),
      salesPerOrder: parseIndonesianNumber(at('Sales per Order')),
      productClicks: parseIndonesianNumber(at('Product Clicks')),
      visitors: parseIndonesianNumber(at('Visitors')),
      orderConversionRate: parseIndonesianPercent(at('Order Conversion Rate')),
      cancelledOrders: parseIndonesianNumber(at('Cancelled Orders')),
      cancelledSales: parseIndonesianNumber(at('Cancelled Sales')),
      returnedOrders: parseIndonesianNumber(at('Returned/Refunded Orders')),
      returnedSales: parseIndonesianNumber(at('Returned/Refunded Sales')),
      buyers: parseIndonesianNumber(at('# of buyers')),
      newBuyers: parseIndonesianNumber(at('# of new buyers')),
      existingBuyers: parseIndonesianNumber(at('# of existing buyers')),
      potentialBuyers: parseIndonesianNumber(at('# of potential buyers')),
      repeatPurchaseRate: parseIndonesianPercent(at('Repeat Purchase Rate')),
    });
  }
  return { orderStatus, days };
}

/**
 * Which state an order sheet counts.
 *
 * The sheet is named after it — "Placed Order", "Confirmed Order",
 * "Paid Order" — and the name is the only place it is said.
 */
function orderStatusFromSheetName(name) {
  const raw = String(name || '').toLowerCase();
  // Several sheets name the state they count — "Traffic Sources (placed
  // order)" does too — but only the order sheets count the shop's whole
  // figures. The others break the same figures down by traffic source.
  if (raw.includes('contribution') || raw.includes('sources')) return null;
  if (raw.includes('placed')) return 'PLACED';
  if (raw.includes('confirmed')) return 'CONFIRMED';
  if (raw.includes('paid')) return 'PAID';
  return null;
}

/**
 * The shop's own figures, from every sheet that counts orders.
 */
function parseShopOrderSheets(workbook) {
  const results = [];
  for (const name of workbook.SheetNames) {
    const status = orderStatusFromSheetName(name);
    if (!status) continue;
    const rows = workbook.Sheets[name]
      ? sheetToRows(workbook.Sheets[name])
      : [];
    results.push(parseOrderSheet(rows, status));
  }
  return results;
}

/**
 * The rows of a sheet, as arrays.
 */
function sheetToRows(sheet) {
  const XLSX = require('xlsx');
  return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });
}

/**
 * What a product earned attention.
 *
 * The sheet holds a row for the product and a row for each of its
 * variations. The product row is the one with no variation id; the
 * variation rows carry their own figures. Both are kept, because the
 * product row is the shop's view of the product and the variation rows
 * are where the detail is.
 */
const PRODUCT_SHEET_SIGNATURES = ['Item ID', 'Product', 'Product Impression'];

function parseProductSheet(rows, sheetName) {
  const header = findHeaderRow(rows, PRODUCT_SHEET_SIGNATURES);
  if (!header) return { sheetName, products: [], skipped: 'no header row found' };
  const columns = header.cells;
  const indexOf = name => columns.indexOf(name);
  const products = [];
  for (let index = header.index + 1; index < rows.length; index += 1) {
    const row = rows[index] || [];
    const itemId = row[indexOf('Item ID')];
    if (itemId === null || itemId === undefined || String(itemId).trim() === '') continue;
    const variationId = row[indexOf('Variation ID')];
    const isVariation = variationId !== null && variationId !== undefined
      && String(variationId).trim() !== '' && String(variationId).trim() !== '-';
    const at = name => (indexOf(name) < 0 ? null : row[indexOf(name)]);
    products.push({
      sheetName,
      itemId: String(itemId).trim(),
      itemName: at('Product') ? String(at('Product')).trim() : null,
      itemStatus: at('Current Item Status') ? String(at('Current Item Status')).trim() : null,
      variationId: isVariation ? String(variationId).trim() : null,
      variationName: at('Variation Name') ? String(at('Variation Name')).trim() : null,
      sku: at('SKU') ? String(at('SKU')).trim() : null,
      parentSku: at('Parent SKU') ? String(at('Parent SKU')).trim() : null,
      rowKind: isVariation ? 'VARIATION' : 'PRODUCT',
      salesPlaced: parseIndonesianNumber(at('Sales (Placed Order) (IDR)')),
      salesConfirmed: parseIndonesianNumber(at('Sales (Confirmed Order) (IDR)')),
      unitsPlaced: parseIndonesianNumber(at('Units (Placed Order)')),
      unitsConfirmed: parseIndonesianNumber(at('Units (Confirmed Order)')),
      buyersPlaced: parseIndonesianNumber(at('Buyers (Placed Order)')),
      buyersConfirmed: parseIndonesianNumber(at('Buyers (Confirmed Order)')),
      productImpression: parseIndonesianNumber(at('Product Impression')),
      productClicks: parseIndonesianNumber(at('Product Clicks')),
      ctr: parseIndonesianPercent(at('CTR')),
      uniqueProductImpressions: parseIndonesianNumber(at('Unique Product Impressions')),
      uniqueProductClicks: parseIndonesianNumber(at('Unique Product Clicks')),
      productVisitors: parseIndonesianNumber(at('Product Visitors (Visit)')),
      productPageViews: parseIndonesianNumber(at('Product Page Views')),
      bounceVisitors: parseIndonesianNumber(at('Product Bounce Visitors')),
      bounceRate: parseIndonesianPercent(at('Product Bounce Rate')),
      searchClicks: parseIndonesianNumber(at('Search Clicks')),
      likes: parseIndonesianNumber(at('Likes')),
      addToCartVisitors: parseIndonesianNumber(at('Product Visitors (Add to Cart)')),
      addToCartUnits: parseIndonesianNumber(at('Units (Add to Cart)')),
      addToCartRate: parseIndonesianPercent(at('Conversion Rate (Add to Cart)')),
    });
  }
  return { sheetName, products };
}

/**
 * The products' figures, from every sheet that carries them.
 */
function parseProductSheets(workbook) {
  const results = [];
  for (const name of workbook.SheetNames) {
    const rows = workbook.Sheets[name] ? sheetToRows(workbook.Sheets[name]) : [];
    const parsed = parseProductSheet(rows, name);
    if (parsed.products.length) results.push(parsed);
  }
  return results;
}

/**
 * The shop the export belongs to.
 *
 * The advertising export says which shop it is about. The others do not,
 * so the name of the file is what says — the part before the report name
 * is the shop's own name on the platform.
 */
function shopFromFileName(fileName) {
  const raw = String(fileName || '');
  const withoutExtension = raw.replace(/\.(xlsx|csv)$/i, '');
  const parts = withoutExtension.split('.');
  return {
    username: parts[0] || null,
    report: parts.slice(1).join('.') || null,
  };
}

/**
 * The advertising export's own headings.
 *
 * There are several lines of report details before the headings, and
 * they say which shop the report is about.
 */
function parseAdsReportHeadings(lines) {
  const meta = {};
  let headerIndex = -1;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] || '';
    const parts = line.split(',');
    if (parts[0] === 'User Name') meta.userName = parts[1];
    else if (parts[0] === 'Shop Name') meta.shopName = parts[1];
    else if (parts[0] === 'Shop ID') meta.shopId = parts[1];
    else if (parts[0] === 'Report Creation Time') meta.reportCreatedAt = parts[1];
    else if (parts[0] === 'Date Period') meta.datePeriod = parts.slice(1).join(',');
    else if (parts[0] === 'Sequence') { headerIndex = index; break; }
  }
  const header = headerIndex >= 0 ? lines[headerIndex].split(',') : [];
  const rows = headerIndex >= 0
    ? lines.slice(headerIndex + 1).filter(line => line && line.trim())
    : [];
  return { meta, header, rows };
}

/**
 * The advertising report's rows.
 *
 * The report covers a period rather than a day, so each row is a whole
 * advertisement's figures for that period.
 */
function parseAdsRows(header, rows) {
  const indexOf = name => header.indexOf(name);
  const out = [];
  for (const line of rows) {
    if (!line || !line.trim()) continue;
    const cells = line.split(',');
    if (cells.length < 5) continue;
    const at = name => {
      const at_ = indexOf(name);
      return at_ < 0 ? null : cells[at_];
    };
    out.push({
      sequence: parsePlainNumber(at('Sequence')),
      adName: at('Ad Name') || null,
      status: at('Status') || null,
      adsType: at('Ads Type') || null,
      productId: at('Product ID') || null,
      biddingMethod: at('Bidding Method') || null,
      placement: at('Placement') || null,
      startDate: at('Start Date') || null,
      endDate: at('End Date') || null,
      impression: parsePlainNumber(at('Impression')),
      clicks: parsePlainNumber(at('Clicks')),
      ctr: parsePlainPercent(at('CTR')),
      addToCart: parsePlainNumber(at('Add to Cart')),
      addToCartRate: parsePlainPercent(at('Add to Cart Rate')),
      conversions: parsePlainNumber(at('Conversions')),
      conversionRate: parsePlainPercent(at('Conversion Rate')),
      costPerConversion: parsePlainNumber(at('Cost per Conversion')),
      itemsSold: parsePlainNumber(at('Items Sold')),
      gmv: parsePlainNumber(at('GMV')),
      expense: parsePlainNumber(at('Expense')),
      roas: parsePlainNumber(at('ROAS')),
      acos: parsePlainPercent(at('ACOS')),
      productImpressions: parsePlainNumber(at('Product Impressions')),
      productClicks: parsePlainNumber(at('Product Clicks')),
      voucherAmount: parsePlainNumber(at('Voucher Amount')),
      voucheredSales: parsePlainNumber(at('Vouchered Sales')),
    });
  }
  return out;
}

/**
 * The affiliate's figures for each day.
 *
 * The export breaks the shop's traffic down by where it came from, and
 * the affiliate is one of those places. Its rows come in groups: a line
 * for a source over the whole period, then a line for each day under it.
 *
 * The groups hold the same days seen by different attributions — the
 * figures under them are the same to within a rounding, not parts of a
 * whole. So one line is taken for each day, the first one that appears:
 * it is the one that says the day is a hundred per cent of the affiliate.
 * Adding the groups together would count the same sales several times.
 *
 * The rates in the export are not used. One of them reads three hundred
 * and twenty-five per cent, which is the export's own arithmetic rather
 * than anything the shop did; the rates here are worked out from the
 * figures instead.
 */
function parseAffiliateContribution(rows) {
  const days = new Map();
  // The block is found by its headings rather than by its banner: the
  // banner and the source's own total both read "Shopee Affiliate", so
  // the banner alone cannot tell where the block begins.
  const headerNeedles = ['Traffic Source', 'Sales (IDR)', 'Content Views'];
  let columns = null;
  let headerIndex = -1;
  for (let index = 0; index < rows.length; index += 1) {
    const cells = (rows[index] || []).map(cell => String(cell ?? '').trim());
    if (headerNeedles.every(needle => cells.includes(needle))) {
      columns = cells;
      headerIndex = index;
      break;
    }
  }
  if (!columns) return [];

  for (let index = headerIndex + 1; index < rows.length; index += 1) {
    const row = rows[index] || [];
    const cells = row.map(cell => String(cell ?? '').trim());
    // The next block's headings end this one. Every block starts with
    // "Traffic Source"; only this one carries "Content Views".
    if (cells.includes('Traffic Source') && !cells.includes('Content Views')) break;

    const date = parseIndonesianDate(String(row[0] ?? '').trim());
    if (!date) continue;
    // One line per day: the groups are the same days seen differently.
    if (days.has(date)) continue;

    const at = name => {
      const position = columns.indexOf(name);
      return position < 0 ? null : row[position];
    };
    days.set(date, {
      date,
      gmv: parseIndonesianNumber(at('Sales (IDR)')),
      orders: parseIndonesianNumber(at('Orders')),
      units: parseIndonesianNumber(at('Units')),
      contentViews: parseIndonesianNumber(at('Content Views')),
      contentViewers: parseIndonesianNumber(at('Content Viewers')),
      productClicks: parseIndonesianNumber(at('Product Clicks')),
    });
  }

  return [...days.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(entry => ({
      ...entry,
      ctr: entry.contentViews ? entry.productClicks / entry.contentViews : null,
    }));
}

module.exports = {
  parseIndonesianNumber,
  parseIndonesianPercent,
  parsePlainNumber,
  parsePlainPercent,
  parseIndonesianDate,
  parsePlainDate,
  isDayCell,
  isRangeCell,
  findHeaderRow,
  parseOrderSheet,
  parseShopOrderSheets,
  orderStatusFromSheetName,
  parseProductSheet,
  parseProductSheets,
  shopFromFileName,
  parseAdsReportHeadings,
  parseAdsRows,
  parseAffiliateContribution,
  sheetToRows,
};
