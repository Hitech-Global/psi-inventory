'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { registerPriceSystemRoutes } = require('../price-system-api');

function createHarness(extraFields = [], sourceFields = {}, schemeOverrides = {}) {
  const routes = new Map();
  const scheme = Object.assign({
    id: 'scheme-1', country: 'Indonesia', brand: 'Netac', platform: 'Shopee',
    currency: 'IDR', status: 'active', srp_formula: 'landing_cost * 1.1'
  }, schemeOverrides);
  const sku = { sku_code: 'SKU-1', brand: 'Netac', category: 'Accessories' };
  // SRP is stored at scheme level, not in price_system_fields. The route
  // synthesizes its built-in SRP field according to the configured source mode.
  const fields = [
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
  async function invokeRoute(routePath, body, permissions = ['*']) {
    const handlers = routes.get('POST ' + routePath);
    assert.ok(handlers, 'requested price-system formula route is registered');
    const req = {
      params: { id: 'scheme-1' }, body, currentUserPermissions: permissions,
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
  async function invoke(body) {
    return invokeRoute('/api/price-system/schemes/:id/formula/recalculate-preview', body);
  }
  async function invokeFormulaPreview(body, permissions = ['*']) {
    return invokeRoute('/api/price-system/schemes/:id/formula/preview', body, permissions);
  }
  return { invoke, invokeFormulaPreview };
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

test('live preview preserves a scheme-level SRP reference and recalculates all dependent channel prices', async () => {
  const harness = createHarness([
    { id: 'dealer-rate', scheme_id: 'scheme-1', field_key: 'dealer_rate', field_name: 'Dealer Profit Rate', field_type: 'percent', formula: '', formula_rules: '{}', applicable_categories: '[]', is_active: 1, sync_wac: 0, sync_quotation: 0 },
    { id: 'dealer-price', scheme_id: 'scheme-1', field_key: 'dealer_price', field_name: 'Dealer Price', field_type: 'formula', formula: 'srp * (1 - dealer_rate)', formula_rules: '{}', applicable_categories: '[]', is_active: 1, sync_wac: 0, sync_quotation: 0 },
    { id: 'hitech-profit-rate', scheme_id: 'scheme-1', field_key: 'hitech_profit_rate', field_name: 'Hitech Profit Rate', field_type: 'formula', formula: '1 - landing_cost / dealer_price', formula_rules: '{}', applicable_categories: '[]', is_active: 1, sync_wac: 0, sync_quotation: 0 },
    { id: 'md-rate', scheme_id: 'scheme-1', field_key: 'md_rate', field_name: 'MD Profit Rate', field_type: 'percent', formula: '', formula_rules: '{}', applicable_categories: '[]', is_active: 1, sync_wac: 0, sync_quotation: 0 },
    { id: 'md-price', scheme_id: 'scheme-1', field_key: 'md_price', field_name: 'MD Price', field_type: 'formula', formula: 'srp * (1 - md_rate)', formula_rules: '{}', applicable_categories: '[]', is_active: 1, sync_wac: 0, sync_quotation: 0 },
    { id: 'md-hitech-profit-rate', scheme_id: 'scheme-1', field_key: 'md_hitech_profit_rate', field_name: '(MD) Hitech Profit Rate', field_type: 'formula', formula: '1 - landing_cost / md_price', formula_rules: '{}', applicable_categories: '[]', is_active: 1, sync_wac: 0, sync_quotation: 0 }
  ], {}, {
    srp_formula: '',
    srp_source_scheme_id: 'source-scheme',
    srp_source_field_key: 'srp'
  });
  const response = await harness.invoke({
    sku_code: 'SKU-1',
    context: { srp: 1279000, landing_cost: 790190, dealer_rate: 28, md_rate: 20 }
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.srp, 1279000);
  assert.equal(response.body.srp_source, 'reference');
  assert.equal(response.body.values.dealer_price, 920880);
  assert.ok(Math.abs(response.body.values.hitech_profit_rate - (1 - 790190 / 920880)) < 1e-9);
  assert.equal(response.body.values.md_price, 1023200);
  assert.ok(Math.abs(response.body.values.md_hitech_profit_rate - (1 - 790190 / 1023200)) < 1e-9);
  assert.deepEqual(response.body.formula_errors, {});
});

test('live preview keeps dependent formulas blank when a referenced scheme-level SRP is unavailable', async () => {
  const harness = createHarness([
    { id: 'dealer-rate', scheme_id: 'scheme-1', field_key: 'dealer_rate', field_name: 'Dealer Profit Rate', field_type: 'percent', formula: '', formula_rules: '{}', applicable_categories: '[]', is_active: 1, sync_wac: 0, sync_quotation: 0 },
    { id: 'dealer-price', scheme_id: 'scheme-1', field_key: 'dealer_price', field_name: 'Dealer Price', field_type: 'formula', formula: 'srp * (1 - dealer_rate)', formula_rules: '{}', applicable_categories: '[]', is_active: 1, sync_wac: 0, sync_quotation: 0 },
    { id: 'hitech-profit-rate', scheme_id: 'scheme-1', field_key: 'hitech_profit_rate', field_name: 'Hitech Profit Rate', field_type: 'formula', formula: '1 - landing_cost / dealer_price', formula_rules: '{}', applicable_categories: '[]', is_active: 1, sync_wac: 0, sync_quotation: 0 }
  ], {}, {
    srp_formula: '',
    srp_source_scheme_id: 'source-scheme',
    srp_source_field_key: 'srp'
  });
  const response = await harness.invoke({
    sku_code: 'SKU-1',
    context: { srp: null, landing_cost: 790190, dealer_rate: 28 }
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.srp, null);
  assert.equal(response.body.values.dealer_price, null);
  assert.equal(response.body.values.hitech_profit_rate, null);
  assert.match(response.body.formula_errors.dealer_price, /SRP/);
  assert.match(response.body.formula_errors.hitech_profit_rate, /Dealer Price/);
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
  assert.ok(Math.abs(response.body.values.dealer_price - 820) < 1e-9);
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
  assert.ok(Math.abs(response.body.values.dealer_price_ref - 820) < 1e-9);
});


test('live preview follows multi-level channel references when resolving percentage semantics', async () => {
  const harness = createHarness([
    { id: 'dealer-rate-ref', scheme_id: 'scheme-1', field_key: 'dealer_rate_ref', field_name: 'Referenced Dealer Profit Rate', field_type: 'reference', source_scheme_id: 'source-scheme', source_field_key: 'dealer_rate_mid', formula: '', formula_rules: '{}', applicable_categories: '[]', is_active: 1, sync_wac: 0, sync_quotation: 0 },
    { id: 'dealer-price-ref', scheme_id: 'scheme-1', field_key: 'dealer_price_ref', field_name: 'Dealer Price from Reference', field_type: 'formula', formula: 'srp * (1 - dealer_rate_ref)', formula_rules: '{}', applicable_categories: '[]', is_active: 1, sync_wac: 0, sync_quotation: 0 }
  ], {
    'source-scheme|dealer_rate_mid': { field_type: 'reference', source_scheme_id: 'source-scheme-2', source_field_key: 'dealer_rate' },
    'source-scheme-2|dealer_rate': { field_type: 'percent' }
  });
  const response = await harness.invoke({
    sku_code: 'SKU-1', manual_srp: 1000,
    context: { landing_cost: 700, shipping: 10, payment_fee: 0, profit: 0, profit_rate: 0, dealer_rate_ref: 18 }
  });
  assert.equal(response.statusCode, 200);
  assert.ok(Math.abs(response.body.values.dealer_price_ref - 820) < 1e-9);
});

test('built-in SRP uses one shared field definition across scheme data and live preview', () => {
  const api = fs.readFileSync(path.join(__dirname, '..', 'price-system-api.js'), 'utf8');
  assert.match(api, /function buildBuiltinSrpField\(scheme\)/);
  assert.equal((api.match(/fields\.push\(buildBuiltinSrpField\(scheme\)\)/g) || []).length, 3);
  assert.match(api, /function getFormulaFieldDefinition\(schemeId, fieldKey\)/);
  assert.doesNotMatch(api, /sourceFieldKey === 'srp'\) return 'formula'/);
});

test('live formula preview does not reorder rows; only explicit header clicks sort the table', () => {
  const ui = fs.readFileSync(path.join(__dirname, '..', 'assets', 'price-system.js'), 'utf8');
  const start = ui.indexOf('function updatePriceSystemFormulaPreview');
  const end = ui.indexOf('async function runPriceSystemFormulaPreview', start);
  assert.ok(start >= 0 && end > start, 'formula preview update function exists');
  const previewUpdate = ui.slice(start, end);
  assert.doesNotMatch(previewUpdate, /psApplyTableSort\s*\(/);
  const sortHandlerStart = ui.indexOf("th.addEventListener('click'");
  const sortHandlerEnd = ui.indexOf('\n });', sortHandlerStart);
  assert.ok(sortHandlerStart >= 0 && sortHandlerEnd > sortHandlerStart, 'table sort click handler exists');
  assert.match(ui.slice(sortHandlerStart, sortHandlerEnd), /psApplyTableSort\(table,index,next\)/);
});

test('formula preview can use an auto-synced FOB quotation field', async () => {
  const harness = createHarness([
    { id: 'fob', scheme_id: 'scheme-1', field_key: 'fob', field_name: 'FOB', field_type: 'amount', formula: '', formula_rules: '{}', applicable_categories: '[]', is_active: 1, sync_wac: 0, sync_quotation: 1 }
  ]);
  const response = await harness.invokeFormulaPreview({ formula: 'FOB * 18200', variables: { fob: 26.11 } });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.result, 475202);
});

test('formula preview reports a missing auto-synced quotation instead of silently calculating zero', async () => {
  const harness = createHarness([
    { id: 'fob', scheme_id: 'scheme-1', field_key: 'fob', field_name: 'FOB', field_type: 'amount', formula: '', formula_rules: '{}', applicable_categories: '[]', is_active: 1, sync_wac: 0, sync_quotation: 1 }
  ]);
  const response = await harness.invokeFormulaPreview({ formula: 'FOB * 18200', variables: { fob: null } });
  assert.equal(response.statusCode, 400);
  assert.match(response.body.error, /没有匹配到有效报价：FOB/);
});

test('live formula recalculation can use an auto-synced FOB field and keeps missing quotes blank', async () => {
  const harness = createHarness([
    { id: 'fob', scheme_id: 'scheme-1', field_key: 'fob', field_name: 'FOB', field_type: 'amount', formula: '', formula_rules: '{}', applicable_categories: '[]', is_active: 1, sync_wac: 0, sync_quotation: 1 },
    { id: 'fob_idr', scheme_id: 'scheme-1', field_key: 'fob_idr', field_name: 'FOB-IDR', field_type: 'formula', formula: 'fob * 18200', formula_rules: '{}', applicable_categories: '[]', is_active: 1, sync_wac: 0, sync_quotation: 0 }
  ]);
  const calculated = await harness.invoke({
    sku_code: 'SKU-1', manual_srp: 1000,
    context: { landing_cost: 700, shipping: 10, payment_fee: 0, profit: 0, profit_rate: 0, fob: 26.11, fob_idr: 0 }
  });
  assert.equal(calculated.statusCode, 200);
  assert.equal(calculated.body.values.fob_idr, 475202);
  const missing = await harness.invoke({
    sku_code: 'SKU-1', manual_srp: 1000,
    context: { landing_cost: 700, shipping: 10, payment_fee: 0, profit: 0, profit_rate: 0, fob: null, fob_idr: 0 }
  });
  assert.equal(missing.statusCode, 200);
  assert.equal(missing.body.values.fob_idr, null);
  assert.match(missing.body.formula_errors.fob_idr, /FOB/);
});

test('live preview blocks profit and ROAS formulas when an auto-synced WAC is missing, then recovers when WAC arrives', async () => {
  const harness = createHarness([
    { id: 'wac', scheme_id: 'scheme-1', field_key: 'wac_cost', field_name: '最新确认 WAC', field_type: 'amount', formula: '', formula_rules: '{}', applicable_categories: '[]', is_active: 1, sync_wac: 1, sync_quotation: 0 },
    { id: 'profit_wac', scheme_id: 'scheme-1', field_key: 'profit_wac', field_name: 'Profit with WAC', field_type: 'formula', formula: 'srp - wac_cost', formula_rules: '{}', applicable_categories: '[]', is_active: 1, sync_wac: 0, sync_quotation: 0 },
    { id: 'profit_rate_wac', scheme_id: 'scheme-1', field_key: 'profit_rate_wac', field_name: 'Profit Rate with WAC', field_type: 'formula', formula: 'profit_wac / srp', formula_rules: '{}', applicable_categories: '[]', is_active: 1, sync_wac: 0, sync_quotation: 0 },
    { id: 'breakeven_roas', scheme_id: 'scheme-1', field_key: 'breakeven_roas', field_name: 'Breakeven ROAS', field_type: 'formula', formula: 'srp / (srp - wac_cost)', formula_rules: '{}', applicable_categories: '[]', is_active: 1, sync_wac: 0, sync_quotation: 0 }
  ]);
  const missing = await harness.invoke({
    sku_code: 'SKU-1', manual_srp: 1000,
    context: { landing_cost: null, wac_cost: null, shipping: 10, payment_fee: 0 }
  });
  assert.equal(missing.statusCode, 200);
  assert.equal(missing.body.values.profit_wac, null);
  assert.equal(missing.body.values.profit_rate_wac, null);
  assert.equal(missing.body.values.breakeven_roas, null);
  assert.match(missing.body.formula_errors.profit_wac, /WAC/);
  assert.match(missing.body.formula_errors.profit_rate_wac, /Profit with WAC/);
  assert.match(missing.body.formula_errors.breakeven_roas, /WAC/);

  const recovered = await harness.invoke({
    sku_code: 'SKU-1', manual_srp: 1000,
    context: { landing_cost: 600, wac_cost: 600, shipping: 10, payment_fee: 0 }
  });
  assert.equal(recovered.statusCode, 200);
  assert.equal(recovered.body.values.profit_wac, 400);
  assert.equal(recovered.body.values.profit_rate_wac, 0.4);
  assert.equal(recovered.body.values.breakeven_roas, 2.5);
});

test('formula editor preview refuses to treat missing WAC as zero', async () => {
  const harness = createHarness([
    { id: 'wac', scheme_id: 'scheme-1', field_key: 'wac_cost', field_name: '最新确认 WAC', field_type: 'amount', formula: '', formula_rules: '{}', applicable_categories: '[]', is_active: 1, sync_wac: 1, sync_quotation: 0 }
  ]);
  const response = await harness.invokeFormulaPreview({
    sku_code: 'SKU-1',
    formula: 'srp - wac_cost',
    variables: { srp: 1000, wac_cost: null }
  });
  assert.equal(response.statusCode, 400);
  assert.match(response.body.error, /缺少有效的已确认 WAC/);
});

test('built-in latest confirmed WAC dependency stays blank when no WAC is available', async () => {
  const harness = createHarness([], {}, { srp_formula: 'landing_cost * 1.1' });
  const response = await harness.invoke({
    sku_code: 'SKU-1',
    context: { landing_cost: null, srp: null }
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.srp, null);
  assert.match(response.body.formula_errors.srp, /WAC/);
});

test('price system marks missing WAC clearly and keeps the base WAC null', () => {
  const api = fs.readFileSync(path.join(__dirname, '..', 'price-system-api.js'), 'utf8');
  const ui = fs.readFileSync(path.join(__dirname, '..', 'assets', 'price-system.js'), 'utf8');
  assert.match(api, /landing_cost: landingCost && landingCost\.value != null[^\n]+: null/);
  assert.match(api, /Number\(dependencyField\.sync_wac \|\| 0\) === 1/);
  assert.match(api, /values\\[field\\.field_key\\] = resolveField\\(field\\.field_key\\)/);
  assert.match(ui, /missingWac=v==null/);
  assert.match(ui, /wacMissingStatus:'待补成本'/);
  assert.match(ui, /wacMissingStatus:'WAC missing'/);
  assert.match(ui, /wacMissingStatus:'WAC belum tersedia'/);
});
