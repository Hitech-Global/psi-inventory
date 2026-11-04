'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

test('the funnel reads every shop when no shop is chosen', () => {
  const router = read('src/http-router.js');
  const app = read('web/app.js');
  // Leaving the shop alone is a choice: the funnel then reads every shop
  // the filters pick out.
  assert.ok(router.includes("req.query.shop_ids"), 'several shops must be askable for');
  assert.ok(router.includes('shopIds: targets.map'), 'the shops must be passed on together');
  assert.ok(app.includes("params.set('country'"), 'the country must narrow them');
  assert.ok(app.includes("params.set('brand'"), 'the brand must narrow them');
  // And one shop is still one shop.
  assert.ok(app.includes("params.set('shop_id'"), 'one shop must still be askable for');
});

test('what can be added is added and what is a rate is worked out', () => {
  const repository = read('src/query-repository.js');
  // The shops are given as a list even when there is one of them.
  assert.ok(repository.includes('shop_id = ANY($1::bigint[])'),
    'the shops must be read as a set');
  // A rate is not added: the conversion of several shops is their orders
  // over their visitors.
  assert.ok(repository.includes('CASE WHEN $6::int = 1 THEN MAX(order_conversion_rate) ELSE NULL END'),
    'the conversion rate must not be added up');
  // The fulfilment rates belong to one shop each.
  assert.ok(repository.includes('CASE WHEN $6::int = 1 THEN MAX(return_refund_rate) ELSE NULL END'),
    'the fulfilment rates must not be added up');
});

test('money is not added across currencies', () => {
  const router = read('src/http-router.js');
  assert.ok(router.includes('mixedCurrency'), 'the currencies must be looked at');
  assert.ok(router.includes("row.format !== 'money'"), 'only the money is held back');
  assert.ok(router.includes('多币种未合计'), 'the reader must be told why');
});
