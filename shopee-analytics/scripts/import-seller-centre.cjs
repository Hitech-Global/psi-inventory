'use strict';

/**
 * Reading what the seller centre exports, and putting it in the database.
 *
 * The exports are the only place some of these figures exist: the open
 * platform gives the shop's score and how well it is shipping, but not
 * what its visitors did — how many there were, what they looked at, what
 * they put in the basket, what they saved for later. The seller centre
 * has all of that, and so this reads it.
 *
 * The numbers are read the way the seller centre writes them, which is
 * the Indonesian way: a dot for the thousands and a comma for the
 * decimals. The advertising export is written the other way round and is
 * read by its own rule.
 *
 * Usage:
 *   node scripts/import-seller-centre.cjs --shop 1326456001 \
 *     --stats netacofficialstore.shopee-shop-stats.20261001-20261031.xlsx \
 *     --products parentskudetail.20261001_20261031.xlsx \
 *     --ads Shopee-Ads-Overall-Data-01_10_2026-31_10_2026.csv \
 *     [--date 2026-10-01]
 *
 * The date is the first day of the period the export covers. Every day in
 * the period is written; an export covers a month and the figures are
 * per day.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const XLSX = require('xlsx');
const { createAnalyticsPool } = require('../src/pg');
const {
  parseShopOrderSheets,
  parseProductSheets,
  parseAdsReportHeadings,
  parseAdsRows,
  shopFromFileName,
  parsePlainDate,
  parseIndonesianDate,
} = require('../src/import/seller-centre');

function parseArgs(argv) {
  const args = { };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) continue;
    const name = key.slice(2);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) { args[name] = true; continue; }
    args[name] = value;
    index += 1;
  }
  return args;
}

/**
 * The shop the export belongs to.
 *
 * The advertising export says which shop it is about; the others only
 * carry the shop's name in the file name. So the shop is found by its
 * name, and the number is confirmed against the advertising export when
 * there is one.
 */
function resolveShop(profile, requested) {
  if (requested) return Number(requested);
  throw new Error('--shop is required: the reports do not say which shop they are about');
}

/**
 * The days an export covers.
 *
 * The report says the period it covers; the figures are per day, and the
 * days are counted from the first day to the last.
 */
function daysOfPeriod(periodText, startDate) {
  const from = startDate || parseIndonesianDate(String(periodText || '').split('-')[0]);
  if (!from) return [];
  const [year, month, day] = from.split('-').map(Number);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const days = [];
  for (let d = day; d <= last; d += 1) {
    days.push(`${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  }
  return days;
}

/**
 * Read a pack of already-parsed figures.
 *
 * The exports are parsed where the files are, and what travels is the
 * figures rather than the spreadsheets: a spreadsheet is a container for
 * cells, and only the figures in it are wanted. It is also a quarter of
 * the size once packed, which matters when it has to cross a machine.
 */
function readPack(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').trim();
  const json = zlib.gunzipSync(Buffer.from(raw, 'base64')).toString('utf8');
  return JSON.parse(json);
}

async function importShopOrderSheets(pool, { filePath, shopId, orderStatus, days, sheets: given }) {
  const sheets = given || parseShopOrderSheets(XLSX.readFile(filePath));
  let written = 0;
  for (const sheet of sheets) {
    for (const day of sheet.days) {
      const eventDate = day.eventDate;
      await pool.query(
        `INSERT INTO shopee_shop_bi_daily
         (shop_id, event_date, order_status, sales, orders, product_clicks, unique_visitors,
          order_conversion_rate, sales_per_order, cancelled_orders, cancelled_sales,
          returned_orders, returned_sales, buyers, new_buyers, existing_buyers,
          potential_buyers, repeat_purchase_rate, raw_json, synced_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb,now())
         ON CONFLICT (shop_id, event_date, order_status) DO UPDATE SET
          sales=EXCLUDED.sales, orders=EXCLUDED.orders,
          product_clicks=EXCLUDED.product_clicks, unique_visitors=EXCLUDED.unique_visitors,
          order_conversion_rate=EXCLUDED.order_conversion_rate,
          sales_per_order=EXCLUDED.sales_per_order,
          cancelled_orders=EXCLUDED.cancelled_orders, cancelled_sales=EXCLUDED.cancelled_sales,
          returned_orders=EXCLUDED.returned_orders, returned_sales=EXCLUDED.returned_sales,
          buyers=EXCLUDED.buyers, new_buyers=EXCLUDED.new_buyers,
          existing_buyers=EXCLUDED.existing_buyers, potential_buyers=EXCLUDED.potential_buyers,
          repeat_purchase_rate=EXCLUDED.repeat_purchase_rate,
          raw_json=EXCLUDED.raw_json, synced_at=now()`,
        [
          shopId, eventDate, sheet.orderStatus, day.sales, day.orders, day.productClicks,
          day.visitors, day.orderConversionRate, day.salesPerOrder, day.cancelledOrders,
          day.cancelledSales, day.returnedOrders, day.returnedSales, day.buyers, day.newBuyers,
          day.existingBuyers, day.potentialBuyers, day.repeatPurchaseRate,
          JSON.stringify(day),
        ],
      );
      written += 1;
    }
  }
  return { written, sheets: sheets.length };
}

async function importProductSheets(pool, { filePath, shopId, days, sheets: given, eventDate: givenDate }) {
  const sheets = given || parseProductSheets(XLSX.readFile(filePath));
  let written = 0;
  // The product sheet holds a period's figures for each product, not a
  // day's. The figures are written against the first day of the period:
  // they belong to the period, and spreading them across days would say
  // something the export does not.
  const eventDate = givenDate || (days && days.length ? days[0] : null);
  if (!eventDate) {
    throw new Error(
      'the products cover a period rather than a day, so the period has to be known:'
      + " give --date, or import the shop's own figures first so the period can be taken from them",
    );
  }
  for (const sheet of sheets) {
    for (const product of sheet.products) {
      await pool.query(
        `INSERT INTO shopee_product_traffic_daily
         (shop_id, event_date, item_id, order_status, parent_sku, sku, variation_id, row_kind,
          item_name, item_status, sales, orders, units_sold, buyers, product_impression,
          product_clicks, ctr, unique_product_impressions, unique_product_clicks,
          product_visitors, product_page_views, bounce_visitors, bounce_rate, search_clicks,
          likes, add_to_cart_visitors, add_to_cart_units, add_to_cart_rate,
          order_conversion_rate, raw_json, synced_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30::jsonb,now())
         ON CONFLICT (shop_id, event_date, item_id, order_status, row_kind, sku)
         DO UPDATE SET
          parent_sku=EXCLUDED.parent_sku, variation_id=EXCLUDED.variation_id,
          item_name=EXCLUDED.item_name, item_status=EXCLUDED.item_status,
          sales=EXCLUDED.sales, orders=EXCLUDED.orders, units_sold=EXCLUDED.units_sold,
          buyers=EXCLUDED.buyers, product_impression=EXCLUDED.product_impression,
          product_clicks=EXCLUDED.product_clicks, ctr=EXCLUDED.ctr,
          unique_product_impressions=EXCLUDED.unique_product_impressions,
          unique_product_clicks=EXCLUDED.unique_product_clicks,
          product_visitors=EXCLUDED.product_visitors,
          product_page_views=EXCLUDED.product_page_views,
          bounce_visitors=EXCLUDED.bounce_visitors, bounce_rate=EXCLUDED.bounce_rate,
          search_clicks=EXCLUDED.search_clicks, likes=EXCLUDED.likes,
          add_to_cart_visitors=EXCLUDED.add_to_cart_visitors,
          add_to_cart_units=EXCLUDED.add_to_cart_units,
          add_to_cart_rate=EXCLUDED.add_to_cart_rate,
          order_conversion_rate=EXCLUDED.order_conversion_rate,
          raw_json=EXCLUDED.raw_json, synced_at=now()`,
        [
          shopId, eventDate, product.itemId, 'PAID', product.parentSku, product.sku || '',
          product.variationId, product.rowKind, product.itemName, product.itemStatus,
          product.salesConfirmed || product.salesPlaced, null, product.unitsConfirmed || product.unitsPlaced,
          product.buyersConfirmed || product.buyersPlaced, product.productImpression,
          product.productClicks, product.ctr, product.uniqueProductImpressions,
          product.uniqueProductClicks, product.productVisitors, product.productPageViews,
          product.bounceVisitors, product.bounceRate, product.searchClicks, product.likes,
          product.addToCartVisitors, product.addToCartUnits, product.addToCartRate,
          null, JSON.stringify(product),
        ],
      );
      written += 1;
    }
  }
  return { written, sheets: sheets.length };
}

async function importAdsCsv(pool, { filePath, shopId, startDate, endDate, ads: given, meta: givenMeta }) {
  let meta = givenMeta;
  let parsed = given;
  if (!parsed) {
    const raw = fs.readFileSync(filePath, 'utf8').replace(/^﻿/, '');
    const lines = raw.split(/\r?\n/);
    const headings = parseAdsReportHeadings(lines);
    meta = headings.meta;
    parsed = parseAdsRows(headings.header, headings.rows);
  }
  const period = String(meta.datePeriod || '');
  const [fromText, toText] = period.split('-').map(part => part.trim());
  const periodStart = parsePlainDate(fromText) || startDate;
  const periodEnd = parsePlainDate(toText) || endDate;
  if (!periodStart || !periodEnd) {
    throw new Error('the advertising report does not say which period it covers');
  }
  for (const ad of parsed) {
    await pool.query(
      `INSERT INTO shopee_seller_centre_ads_period
       (shop_id, period_start, period_end, ad_sequence, ad_name, status, ads_type, product_id,
        bidding_method, placement, ad_start_date, ad_end_date, impression, clicks, ctr,
        add_to_cart, add_to_cart_rate, conversions, conversion_rate, cost_per_conversion,
        items_sold, gmv, expense, roas, acos, product_impressions, product_clicks,
        voucher_amount, vouchered_sales, raw_json, synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30::jsonb,now())
       ON CONFLICT (shop_id, period_start, period_end, ad_sequence) DO UPDATE SET
        ad_name=EXCLUDED.ad_name, status=EXCLUDED.status, ads_type=EXCLUDED.ads_type,
        product_id=EXCLUDED.product_id, bidding_method=EXCLUDED.bidding_method,
        placement=EXCLUDED.placement, impression=EXCLUDED.impression, clicks=EXCLUDED.clicks,
        ctr=EXCLUDED.ctr, add_to_cart=EXCLUDED.add_to_cart,
        add_to_cart_rate=EXCLUDED.add_to_cart_rate, conversions=EXCLUDED.conversions,
        conversion_rate=EXCLUDED.conversion_rate,
        cost_per_conversion=EXCLUDED.cost_per_conversion, items_sold=EXCLUDED.items_sold,
        gmv=EXCLUDED.gmv, expense=EXCLUDED.expense, roas=EXCLUDED.roas, acos=EXCLUDED.acos,
        product_impressions=EXCLUDED.product_impressions,
        product_clicks=EXCLUDED.product_clicks, voucher_amount=EXCLUDED.voucher_amount,
        vouchered_sales=EXCLUDED.vouchered_sales, raw_json=EXCLUDED.raw_json, synced_at=now()`,
      [
        shopId, periodStart, periodEnd, ad.sequence, ad.adName, ad.status, ad.adsType,
        ad.productId, ad.biddingMethod, ad.placement,
        ad.startDate ? parsePlainDate(ad.startDate) : null,
        ad.endDate && ad.endDate !== 'Unlimited' ? parsePlainDate(ad.endDate) : null,
        ad.impression, ad.clicks, ad.ctr, ad.addToCart, ad.addToCartRate, ad.conversions,
        ad.conversionRate, ad.costPerConversion, ad.itemsSold, ad.gmv, ad.expense, ad.roas,
        ad.acos, ad.productImpressions, ad.productClicks, ad.voucherAmount, ad.voucheredSales,
        JSON.stringify(ad),
      ],
    );
  }
  return { written: parsed.length, meta };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const shopId = resolveShop(null, args.shop);
  const startDate = args.date ? String(args.date) : null;
  const pool = createAnalyticsPool();
  try {
    const days = [];
    if (startDate) {
      const [year, month, day] = startDate.split('-').map(Number);
      const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
      for (let d = day; d <= last; d += 1) {
        days.push(`${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
      }
    }

    let pack = null;
    if (args.pack) {
      pack = readPack(path.resolve(args.pack));
      if (pack.meta && pack.meta.shopId && !args.shop) {
        console.log(`包里的店铺：${pack.meta.shopName}（${pack.meta.shopId}）`);
      }
      if (pack.meta && pack.meta.shopId && args.shop
        && Number(pack.meta.shopId) !== Number(args.shop)) {
        throw new Error(
          `这个包是 ${pack.meta.shopName}（${pack.meta.shopId}）的，不是店铺 ${args.shop} 的`,
        );
      }
    }

    const orderSheets = pack ? pack.orders : null;
    const productSheets = pack ? pack.products : null;
    const ads = pack ? pack.ads : null;

    // The products cover a period rather than a day, so the day they are
    // written against comes from the period itself — from the shop's own
    // figures, which cover the same days.
    let periodStart = startDate;
    if (orderSheets) {
      const result = await importShopOrderSheets(pool, {
        filePath: args.stats ? path.resolve(args.stats) : null,
        shopId, days, sheets: orderSheets,
      });
      console.log(`店铺经营数据：${result.written} 行（${result.sheets} 个口径）`);
      const first = orderSheets
        .flatMap(sheet => sheet.days)
        .map(day => day.eventDate)
        .sort()[0];
      if (first) periodStart = first;
    }
    if (args.products || productSheets) {
      const result = await importProductSheets(pool, {
        filePath: args.products ? path.resolve(args.products) : null,
        shopId, days, sheets: productSheets,
        eventDate: periodStart,
      });
      console.log(`商品访客数据：${result.written} 行（${result.sheets} 个表）`);
    }
    if (args.ads || ads) {
      const result = await importAdsCsv(pool, {
        filePath: args.ads ? path.resolve(args.ads) : null,
        shopId, startDate, endDate: startDate,
        ads, meta: pack ? pack.meta : null,
      });
      console.log(`广告区间数据：${result.written} 行（${result.meta.shopName || ''}）`);
    }
    if (!args.stats && !args.products && !args.ads && !pack) {
      console.log('Give --pack, or one of --stats, --products, --ads.');
    }
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  parseArgs,
  daysOfPeriod,
  readPack,
  importShopOrderSheets,
  importProductSheets,
  importAdsCsv,
};
