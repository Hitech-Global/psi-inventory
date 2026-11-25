'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { registerPriceSystemRoutes } = require('../price-system-api');

function createHarness(extraFields = [], sourceFields = {}) {
  const routes = new Map();
  const scheme = {
    id: 'scheme-1', country: 'Indonesia', brand: 'Netac', platform: 'Shopee',
    currency: 'IDR', status: 'active', srp_formula: 'landing_cost * 1.1'
  };
  const sku = { sku_code: 'SKU-1', brand: 'Netac', category: 'Accessories' };
  const fields = [
    { id: 'srp', scheme_id: 'scheme-1', field_key: 'srp', field_name: 'SRP', field_type: 'formula', formula: 'landing_cost * 1.1', formula_rules: '{}', applicable_categories: '[]', is_active: 1, sync_wac: 0, sync_quotation: 0 },
    { id: 'shipping', scheme_id: 'scheme-1', field_key: 'shipping', field_name: 'Shipping', field_type: 'amount', formula: '', formula_rules: '{}', applicable_categories: '[]', is_active: 1, sync_wac: 0, sync_quotation: 0 },
    { id: 'payment', scheme_id: 'scheme-1', field_key: 'payment_fee', field_name: 'Payment Fee', field_type: 'formula', formula: 'srp * 2%', formula_rules: '{}', applicable_categories: '[]', is_active: 1, sync_wac: 0, sync_quotation: 0 },
    { id: 'profit', scheme_id: 'scheme-1', field_key: 'profit', field_name: 'Profit', field_type: 'formula', formula: 'srp - payment_fee - shipping', formula_rules: '{}', applicable_categories: '[]', is_active: 1, sync_wac: 0, sync_quotation: 0 },
    { id: 'profit_rate', scheme_id: 'scheme-1', field_key: 'profit_rate', field_name: 'Profit Rate', field_type: 'formula', formula: 'profit / srp', formula_rules: '{}', applicable_categories: '[]', is_active: 1, sync_wac: 0, sync_quotation: 0 },
    { id: 'category_fee', scheme_id: 'scheme-1', field_key: 'category_fee', field_name: 'Category Fee', field_type: 'formula', formula: '', formula_rules: JSON.stringify({ Accessories: 'srp * 3%', SSD: 'srp * 5%' }), applicable_categories: '[]', is_active: 1, sync_wac: 0, sync_quotation: 0 }
  ];
  fields.push(...extraFields);
  const app = {
    get: (route, ...handlers) => routes.set('GET ' + route, handlers),
    post: (route, ...handlers) => routes.set('POST ' + route, handlers),
    put: (route, ...handlers) => routes.set('PUT ' + route, handlers),
    delete: (route, ...handlers) => routes.set('DELETE ' + route, handlers)
  };
  const query = (sql) => {
    if (sql.includes('SELECT * FROM price_system_fields WHERE scheme_id = ? AND is_active = 1')) return { rows: fields };
    return { rows: [] };
  };
  const queryOne = (sql, params = []) => {
    if (sql.includes('SELECT * FROM price_system_schemes WHERE id = ?')) return scheme;
    if (sql.includes('SELECT sku_code, brand, category FROM skus WHERE brand = ? AND sku_code = ?')) {
      return params[0] === sku.brand && params[1] === sku.sku_code ? sku : null;
    }
    if (sql.includes('SELECT field_type, source_scheme_id, source_field_key FROM price_system_fields WHERE scheme_id = ? AND field_key = ? AND is_active = 1')) {
      return sourceFields[`${params[0]}|${params[1]}`] || null;
    }
    return null;
  };
  registerPriceSystemRoutes(app, {
    query, queryOne, run: () => {}, transaction: fn => fn(), genId: prefix => prefix,
    requireApiPermission: () => (req, res, next) => next(),
    asyncHandler: fn => fn,
    needsDataScopeFilter: () => false
  });
  async function invoke(body) {
    const handlers = routes.get('POST /api/price-system/schemes/:id/formula/recalculate-preview');
    assert.ok(handlers, 'live formula recalculation preview route is registered');
    const req = {
      params: { id: 'scheme-1' }, body, currentUserPermissions: ['*'],
      currentUserId: 'tester', currentUserName: 'Tester'
    };
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(value) { this.body = value; return this; }
    };
    for (const middleware of handlers.slice(0, -1)) {
      await new Promise((resolve, reject) => {
        try { middleware(req, res, resolve); } catch (error) { reject(error); }
      });
    }
    await handlers[handlers.length - 1](req, res, () => {});
    return res;
  }
  return { invoke };
}

test('live preview recalculates dependent formula fields in dependency order after a manual SRP edit', async () => {
  const harness = createHarness();
  const response = await harness.invoke({
    sku_code: 'SKU-1',
    manual_srp: 1000,
    context: { landing_cost: 700, shipping: 10, payment_fee: 0, profit: 0, profit_rate: 0 }
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.srp, 1000);
  assert.equal(response.body.srp_source, 'manual');
  assert.equal(response.body.values.payment_fee, 20);
  assert.equal(response.body.values.profit, 970);
  assert.equal(response.body.values.profit_rate, 0.97);
  assert.equal(response.body.values.category_fee, 30);
  assert.equal(response.body.formula_context.profit, 970);
});

test('live preview recalculates formulas from changed manual fee values and resolves category rules', async () => {
  const harness = createHarness();
  const response = await harness.invoke({
    sku_code: 'SKU-1',
    manual_srp: 2000,
    context: { landing_cost: 700, shipping: 125, payment_fee: 0, profit: 0, profit_rate: 0 }
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.values.payment_fee, 40);
  assert.equal(response.body.values.profit, 1835);
  assert.equal(response.body.values.category_fee, 60);
});

test('clearing a manual SRP preview restores the configured formula SRP and recalculates dependents', async () => {
  const harness = createHarness();
  const response = await harness.invoke({
    sku_code: 'SKU-1',
    manual_srp: null,
    context: { landing_cost: 700, shipping: 10, srp: 1500, payment_fee: 30, profit: 1460, profit_rate: 0.97 }
  });
  assert.equal(response.statusCode, 200);
  assert.ok(Math.abs(response.body.srp - 770) < 1e-9);
  assert.equal(response.body.srp_source, 'formula');
  assert.ok(Math.abs(response.body.values.payment_fee - 15.4) < 1e-9);
  assert.ok(Math.abs(response.body.values.profit - 744.6) < 1e-9);
  assert.ok(Math.abs(response.body.values.profit_rate - (744.6 / 770)) < 1e-9);
});

test('live preview uses a referenced source-field value in a dependent formula', async () => {
  const harness = createHarness([
    { id: 'source-fob', scheme_id: 'scheme-1', field_key: 'source_fob', field_name: 'Source FOB', field_type: 'reference', formula: '', formula_rules: '{}', applicable_categories: '[]', is_active: 1, sync_wac: 0, sync_quotation: 0 },
    { id: 'source-plus-shipping', scheme_id: 'scheme-1', field_key: 'source_plus_shipping', field_name: 'Source FOB + Shipping', field_type: 'formula', formula: 'source_fob + shipping', formula_rules: '{}', applicable_categories: '[]', is_active: 1, sync_wac: 0, sync_quotation: 0 }
  ]);
  const response = await harness.invoke({
    sku_code: 'SKU-1', manual_srp: 1000,
    context: { landing_cost: 700, shipping: 10, payment_fee: 0, profit: 0, profit_rate: 0, source_fob: 250 }
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.values.source_fob, 250);
  assert.equal(response.body.values.source_plus_shipping, 260);
});

test('a missing referenced SKU value stays blank in dependent formula previews', async () => {
  const harness = createHarness([
    { id: 'source-fob', scheme_id: 'scheme-1', field_key: 'source_fob', field_name: 'Source FOB', field_type: 'reference', formula: '', formula_rules: '{}', applicable_categories: '[]', is_active: 1, sync_wac: 0, sync_quotation: 0 },
    { id: 'source-plus-shipping', scheme_id: 'scheme-1', field_key: 'source_plus_shipping', field_name: 'Source FOB + Shipping', field_type: 'formula', formula: 'source_fob + shipping', formula_rules: '{}', applicable_categories: '[]', is_active: 1, sync_wac: 0, sync_quotation: 0 }
  ]);
  const response = await harness.invoke({
    sku_code: 'SKU-1', manual_srp: 1000,
    context: { landing_cost: 700, shipping: 10, payment_fee: 0, profit: 0, profit_rate: 0, source_fob: null }
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.values.source_fob, null);
  assert.equal(response.body.values.source_plus_shipping, null);
  assert.match(response.body.formula_errors.source_plus_shipping, /引用字段缺少/);
});

test('live preview rejects a SKU outside the current scheme brand', async () => {
  const harness = createHarness();
  const response = await harness.invoke({ sku_code: 'OTHER-SKU', manual_srp: 1000, context: {} });
  assert.equal(response.statusCode, 404);
});

test('price system recalculates on input and updates formula cells without replacing the edited row', () => {
  const ui = fs.readFileSync(path.join(__dirname, '..', 'assets', 'price-system.js'), 'utf8');
  assert.match(ui, /schedulePriceSystemFormulaPreview\(sku\)/);
  assert.match(ui, /formula\/recalculate-preview/);
  assert.match(ui, /data-field-key=/);
  assert.match(ui, /data-sku=/);
  assert.match(ui, /updatePriceSystemFormulaPreview\(skuCode,preview\)/);
  assert.match(ui, /cell\.setAttribute\('data-sort-value',value==null\?'':String\(value\)\)/);
  assert.match(ui, /cancelPendingPriceSystemFormulaPreviews\(\)/);
  assert.match(ui, /dirty&&state\.dirty\[r\.sku_code\]\.srp!=null\?state\.dirty\[r\.sku_code\]\.srp:r\.srp/);
});

test('live preview automatically converts percentage-typed fields when formulas reference them', async () => {
  const harness = createHarness([
    { id: 'dealer-rate', scheme_id: 'scheme-1', field_key: 'dealer_rate', field_name: 'Dealer Profit Rate', field_type: 'percent', formula: '', formula_rules: '{}', applicable_categories: '[]', is_active: 1, sync_wac: 0, sync_quotation: 0 },
    { id: 'dealer-price', scheme_id: 'scheme-1', field_key: 'dealer_price', field_name: 'Dealer Price', field_type: 'formula', formula: 'srp * (1 - dealer_rate)', formula_rules: '{}', applicable_categories: '[]', is_active: 1, sync_wac: 0, sync_quotation: 0 }
  ]);
  const response = await harness.invoke({
    sku_code: 'SKU-1', manual_srp: 1000,
    context: { landing_cost: 700, shipping: 10, payment_fee: 0, profit: 0, profit_rate: 0, dealer_rate: 18 }
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.values.dealer_price, 820);
});

test('live preview automatically converts a cross-channel reference to a percentage field', async () => {
  const harness = createHarness([
    { id: 'dealer-rate-ref', scheme_id: 'scheme-1', field_key: 'dealer_rate_ref', field_name: 'Referenced Dealer Profit Rate', field_type: 'reference', source_scheme_id: 'source-scheme', source_field_key: 'dealer_rate', formula: '', formula_rules: '{}', applicable_categories: '[]', is_active: 1, sync_wac: 0, sync_quotation: 0 },
    { id: 'dealer-price-ref', scheme_id: 'scheme-1', field_key: 'dealer_price_ref', field_name: 'Dealer Price from Reference', field_type: 'formula', formula: 'srp * (1 - dealer_rate_ref)', formula_rules: '{}', applicable_categories: '[]', is_active: 1, sync_wac: 0, sync_quotation: 0 }
  ], { 'source-scheme|dealer_rate': { field_type: 'percent' } });
  const response = await harness.invoke({
    sku_code: 'SKU-1', manual_srp: 1000,
    context: { landing_cost: 700, shipping: 10, payment_fee: 0, profit: 0, profit_rate: 0, dealer_rate_ref: 18 }
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.values.dealer_price_ref, 820);
});
