'use strict';

const assert = require('assert');
const {
  pctChange,
  previousPeriod,
  diagnoseRow,
  diagnosePortfolio,
} = require('../src/portfolio-diagnosis');

assert.strictEqual(pctChange(110, 100), 0.1);
assert.strictEqual(pctChange(0, 0), 0);
assert.strictEqual(pctChange(10, 0), null);

assert.deepStrictEqual(
  previousPeriod('2026-09-10', '2026-09-16'),
  { days: 7, startDate: '2026-09-03', endDate: '2026-09-09' },
);

const down = diagnoseRow(
  {
    sales: 700,
    orders: 7,
    productClicks: 100,
    productViews: 500,
    adExpense: 120,
    broadGmv: 400,
    estimatedNaturalSales: 300,
  },
  {
    sales: 1000,
    orders: 10,
    productClicks: 150,
    productViews: 600,
    adExpense: 100,
    broadGmv: 500,
    estimatedNaturalSales: 500,
  },
);
assert.strictEqual(down.primarySignal.code, 'AD_SPEND_RATIO_OVER_LIMIT');
assert(down.primarySignal.action && down.primarySignal.action.length > 10);
assert(down.signals.some(row => row.code === 'SALES_DOWN'));
assert(down.signals.some(row => row.code === 'TRAFFIC_DOWN'));
assert(down.signals.some(row => row.code === 'NATURAL_SALES_DOWN'));

const growth = diagnoseRow(
  {
    sales: 1200,
    orders: 12,
    productClicks: 180,
    productViews: 650,
    adExpense: 100,
    broadGmv: 600,
    estimatedNaturalSales: 600,
  },
  {
    sales: 1000,
    orders: 10,
    productClicks: 150,
    productViews: 600,
    adExpense: 100,
    broadGmv: 500,
    estimatedNaturalSales: 500,
  },
);
assert(growth.signals.some(row => row.code === 'SALES_GROWTH'));

const portfolio = diagnosePortfolio(
  {
    shops: [{ shopId: 1, sales: 100, orders: 2, productClicks: 10 }],
    businessGroups: [{
      countryCode: 'ID', brandCode: 'REDRAGON', currency: 'IDR',
      sales: 100, orders: 2, productClicks: 10,
    }],
  },
  {
    shops: [{ shopId: 1, sales: 80, orders: 2, productClicks: 8 }],
    businessGroups: [{
      countryCode: 'ID', brandCode: 'REDRAGON', currency: 'IDR',
      sales: 80, orders: 2, productClicks: 8,
    }],
  },
);
assert.strictEqual(portfolio.shops.length, 1);
assert.strictEqual(portfolio.businessGroups.length, 1);
assert(portfolio.shops[0].diagnosis.changes.sales > 0);

console.log('shopee portfolio diagnosis tests: ok');


const mixedLimit = diagnoseRow(
  {
    sales: 1000,
    orders: 10,
    productClicks: 100,
    adExpense: 180,
    broadGmv: 700,
    estimatedNaturalSales: 300,
    adSpendRatioLimit: null,
  },
  {
    sales: 1000,
    orders: 10,
    productClicks: 100,
    adExpense: 100,
    broadGmv: 700,
    estimatedNaturalSales: 300,
    adSpendRatioLimit: null,
  },
);
assert(
  !mixedLimit.signals.some(row => row.code === 'AD_SPEND_RATIO_OVER_LIMIT'),
  'mixed-limit business groups must not be judged against a hardcoded 15% threshold',
);


const attributionMismatch = diagnoseRow(
  {
    sales: 100,
    orders: 2,
    productClicks: 20,
    adExpense: 10,
    broadGmv: 120,
    estimatedNaturalSales: -20,
    adAttributionExceedsBiSales: true,
  },
  {
    sales: 100,
    orders: 2,
    productClicks: 20,
    adExpense: 10,
    broadGmv: 110,
    estimatedNaturalSales: -10,
    adAttributionExceedsBiSales: true,
  },
);
assert(
  attributionMismatch.signals.some(row => row.code === 'AD_ATTRIBUTION_EXCEEDS_BI_SALES'),
);
assert(
  !attributionMismatch.signals.some(row => row.code === 'NATURAL_SALES_DOWN'),
  'non-ad attribution delta must not be interpreted while ad attribution exceeds BI sales',
);
