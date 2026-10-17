'use strict';

const assert = require('assert');
const {
  numeric,
  rate,
  parseDateRangeFromFilename,
  normalizeProductCardRows,
} = require('../src/product-card-normalizer');

assert.strictEqual(numeric('Rp1,234,567'), 1234567);
assert(Math.abs(rate('1.93%') - 0.0193) < 1e-12);
assert.strictEqual(rate(0.0193), 0.0193);
assert.deepStrictEqual(
  parseDateRangeFromFilename('8月producttraffic_Product_Card.20260801_20260812(3).xlsx'),
  { startDate: '2026-08-01', endDate: '2026-08-12' },
);

const result = normalizeProductCardRows([
  {
    'Product ID': 40611596710,
    'Product Name': 'REDRAGON H858',
    'Product SKU': 'H858',
    'Product Impressions': '59,580',
    'Product Clicks': 1054,
    'CTR': '1.77%',
    'Product Visitors': 900,
    'Add to Cart Visitors': 55,
    'Add to Cart Conversion Rate': '6.11%',
    'Orders': 21,
    'Units Sold': 23,
    'Sales': '15,050,200',
    'Order Conversion Rate': '2.33%',
  },
], {
  sourceFile: '8月producttraffic_Product_Card.20260801_20260812(3).xlsx',
});

assert.strictEqual(result.rows.length, 1);
assert.strictEqual(result.rows[0].startDate, '2026-08-01');
assert.strictEqual(result.rows[0].endDate, '2026-08-12');
assert.strictEqual(result.rows[0].impressions, 59580);
assert(Math.abs(result.rows[0].ctr - 0.0177) < 1e-12);
assert(Math.abs(result.rows[0].conversionRate - 0.0233) < 1e-12);
assert.strictEqual(result.rows[0].sales, 15050200);
assert.strictEqual(result.skipped.length, 0);

console.log('shopee Product Card normalizer tests: ok');
