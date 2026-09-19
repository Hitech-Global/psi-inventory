'use strict';

const fs = require('fs');
const { createAnalyticsPool } = require('../src/pg');
const { ShopeeQueryRepository } = require('../src/query-repository');
const { evaluateSellerCentreReconciliation } = require('../src/live-reconciliation');

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}
function positiveInt(value, name) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) throw new Error(`${name} must be a positive integer`);
  return n;
}
function isoDate(value, name) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) throw new Error(`${name} must be YYYY-MM-DD`);
  return String(value);
}

async function main() {
  const shopId = positiveInt(required('SHOPEE_RECONCILE_SHOP_ID'), 'SHOPEE_RECONCILE_SHOP_ID');
  const startDate = isoDate(required('SHOPEE_RECONCILE_START_DATE'), 'SHOPEE_RECONCILE_START_DATE');
  const endDate = isoDate(required('SHOPEE_RECONCILE_END_DATE'), 'SHOPEE_RECONCILE_END_DATE');
  const expectedFile = required('SHOPEE_RECONCILE_EXPECTED_FILE');
  const expected = JSON.parse(fs.readFileSync(expectedFile, 'utf8'));
  const tolerances = expected.tolerances || {};

  const pool = createAnalyticsPool();
  try {
    const query = new ShopeeQueryRepository({ pool });
    const overview = await query.getPortfolioOverview({ startDate, endDate, shopIds: [shopId] });
    const actual = overview.shops[0];
    if (!actual) throw new Error(`Shop ${shopId} has no configured overview row`);

    const reconciliation = evaluateSellerCentreReconciliation({
      actual,
      expected: expected.metrics || expected,
      tolerances,
    });

    const report = {
      generatedAt: new Date().toISOString(),
      purpose: 'SELLER_CENTRE_FIXED_PERIOD_RECONCILIATION',
      shopId,
      startDate,
      endDate,
      currency: actual.currency,
      reconciliation,
      rules: {
        defaultTolerance: '1% unless overridden in expected file',
        directAttribution: 'SKU/item competitiveness uses Direct metrics',
        broadAttribution: 'Store ad-attribution comparisons use Broad metrics',
        noAutoFix: true,
      },
    };
    console.log(JSON.stringify(report, null, 2));
    if (!reconciliation.pass) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 2;
});
