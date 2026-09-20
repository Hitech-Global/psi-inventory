'use strict';

const path = require('path');
const XLSX = require('xlsx');
const { createAnalyticsPool } = require('../src/pg');
const { loadShopId } = require('../src/config');
const { normalizeProductCardRows } = require('../src/product-card-normalizer');
const { ShopeeProductCardRepository } = require('../src/product-card-repository');
const { assertOnlineOperationAllowed } = require('../src/deployment-mode');

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

async function main() {
  assertOnlineOperationAllowed('Product Card direct import');
  if (process.env.SHOPEE_ANALYTICS_IMPORT_PRODUCT_CARD !== 'YES') {
    throw new Error('Refusing Product Card DB import. Set SHOPEE_ANALYTICS_IMPORT_PRODUCT_CARD=YES explicitly.');
  }

  const file = required('SHOPEE_PRODUCT_CARD_FILE');
  const workbook = XLSX.readFile(file, { cellDates: false, raw: true });
  const sheetName = process.env.SHOPEE_PRODUCT_CARD_SHEET || workbook.SheetNames[0];
  if (!sheetName || !workbook.Sheets[sheetName]) throw new Error('Product Card worksheet not found');
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: null, raw: true });

  const normalized = normalizeProductCardRows(rows, {
    startDate: process.env.SHOPEE_PRODUCT_CARD_START_DATE || undefined,
    endDate: process.env.SHOPEE_PRODUCT_CARD_END_DATE || undefined,
    sourceFile: path.basename(file),
  });

  const pool = createAnalyticsPool();
  try {
    const repository = new ShopeeProductCardRepository({ pool });
    const result = await repository.upsertPeriodRows({
      shopId: loadShopId(),
      rows: normalized.rows,
    });
    console.log(JSON.stringify({
      file: path.basename(file),
      sheet: sheetName,
      sourceRows: rows.length,
      imported: result.imported,
      skipped: normalized.skipped,
      mappedFields: Object.keys(normalized.headerLookup),
    }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
