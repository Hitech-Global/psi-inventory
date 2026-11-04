'use strict';

/**
 * Pack the seller centre exports into one file to carry them.
 *
 * The exports are read where they are, and what travels is the figures
 * rather than the spreadsheets: a spreadsheet is a container for cells,
 * and only the figures in it are wanted. It is also a quarter of the
 * size once packed, which matters when it has to cross a machine.
 *
 *   node scripts/pack-seller-centre.cjs --out seller-centre.b64 \
 *     --stats netacofficialstore.shopee-shop-stats.20261001-20261031.xlsx \
 *     --products parentskudetail.20261001_20261031.xlsx \
 *     --ads Shopee-Ads-Overall-Data-01_10_2026-31_10_2026.csv
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const XLSX = require('xlsx');
const {
  parseShopOrderSheets,
  parseProductSheets,
  parseAdsReportHeadings,
  parseAdsRows,
  parseAffiliateContribution,
  sheetToRows,
} = require('../src/import/seller-centre');

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) continue;
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) { args[key.slice(2)] = true; continue; }
    args[key.slice(2)] = value;
    index += 1;
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.out) throw new Error('--out is required');
  const pack = { meta: {}, orders: [], products: [], ads: [], affiliate: [] };

  if (args.stats) {
    pack.orders = parseShopOrderSheets(XLSX.readFile(path.resolve(args.stats)));
  }
  if (args.products) {
    pack.products = parseProductSheets(XLSX.readFile(path.resolve(args.products)));
  }
  if (args.ads) {
    const raw = fs.readFileSync(path.resolve(args.ads), 'utf8').replace(/^﻿/, '');
    const { meta, header, rows } = parseAdsReportHeadings(raw.split(/\r?\n/));
    pack.meta = meta;
    pack.ads = parseAdsRows(header, rows);
  }
  if (args.stats) {
    // The affiliate's figures live in the traffic breakdown, under the
    // one sheet that counts what was paid for.
    const workbook = XLSX.readFile(path.resolve(args.stats));
    const name = workbook.SheetNames.find(sheet => sheet.includes('Source Contribution (paid'));
    if (name) {
      pack.affiliate = parseAffiliateContribution(sheetToRows(workbook.Sheets[name]));
    }
  }

  const json = JSON.stringify(pack);
  const packed = zlib.gzipSync(json).toString('base64');
  fs.writeFileSync(path.resolve(args.out), packed);
  console.log(`  ${path.resolve(args.out)}`);
  console.log(`  订单 ${pack.orders.reduce((sum, sheet) => sum + sheet.days.length, 0)} 行`
    + ` · 商品 ${pack.products.reduce((sum, sheet) => sum + sheet.products.length, 0)} 行`
    + ` · 广告 ${pack.ads.length} 行`
    + ` · 联盟 ${pack.affiliate.length} 行`);
  console.log(`  ${(packed.length / 1024).toFixed(0)} KB（原本 ${(json.length / 1024).toFixed(0)} KB）`);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
