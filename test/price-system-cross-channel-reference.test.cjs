'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildPriceSystemReferenceLookup } = require('../price-system-api');

const root = path.join(__dirname, '..');
const ui = fs.readFileSync(path.join(root, 'assets', 'price-system.js'), 'utf8');
const api = fs.readFileSync(path.join(root, 'price-system-api.js'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'migrations', 'price-system.js'), 'utf8');

test('reference values are matched by exact SKU and missing source values stay blank', () => {
  const lookup = buildPriceSystemReferenceLookup([
    { sku_code: 'NT01', values: { fob: 100 }, value_currencies: { fob: 'USD' } },
    { sku_code: 'NT02', values: { fob: null }, value_currencies: {} },
    { sku_code: 'NT03', values: { fob: 0 }, value_currencies: {} }
  ], 'fob', 'IDR', true);

  assert.equal(lookup.valuesBySku.get('NT01'), 100);
  assert.equal(lookup.valuesBySku.get('NT02'), null);
  assert.equal(lookup.valuesBySku.get('NT03'), 0);
  assert.equal(lookup.valuesBySku.has('NT04'), false);
  assert.equal(lookup.currenciesBySku.get('NT01'), 'USD');
  assert.equal(lookup.currenciesBySku.get('NT02'), 'IDR');
});

test('reference currency metadata is only produced when the source field is quotation-synced', () => {
  const lookup = buildPriceSystemReferenceLookup([
    { sku_code: 'NT01', values: { fob: 100 }, value_currencies: { fob: 'USD' } }
  ], 'fob', 'IDR', false);
  assert.equal(lookup.valuesBySku.get('NT01'), 100);
  assert.equal(lookup.currenciesBySku.size, 0);
});

test('sales channels can be switched without removing the top price-scheme selector', () => {
  assert.match(ui, /onchange="psSelectScheme\(this\.value\)"/);
  assert.match(ui, /ps-channel-switcher/);
  assert.match(ui, /ps-channel-button/);
  assert.match(ui, /sales_channel\|\|s\.platform/);
  assert.match(ui, /id="ps-channel"/);
  assert.match(ui, /psOpenChannelSchemeModal/);
});

test('reference field configuration stays inside the existing fee-field editor', () => {
  assert.match(ui, /id="ps-reference-scheme"/);
  assert.match(ui, /id="ps-reference-field"/);
  assert.match(ui, /psReferenceSourceChanged/);
  assert.match(ui, /psReferenceFieldChanged/);
  assert.match(ui, /field_type==='reference'/);
  assert.match(ui, /field_type==='formula'\|\|f\.field_type==='reference'/);
});

test('reference source is restricted to the same country and brand and cycles are rejected', () => {
  assert.match(api, /只能引用同一国家、同一品牌下其他销售渠道方案的字段/);
  assert.match(api, /referenceChainReachesScheme\(sourceScheme\.id, scheme\.id\)/);
  assert.match(api, /价格方案之间存在循环引用/);
  assert.match(api, /source_scheme_id = \?/);
  assert.match(migration, /source_scheme_id TEXT NOT NULL DEFAULT ''/);
  assert.match(migration, /source_field_key TEXT NOT NULL DEFAULT ''/);
});


test('price scheme switching restores cached DOM views before rebuilding the SKU table', () => {
  const mainStart = ui.indexOf('function main(){');
  const cachedViewBranch = ui.indexOf('if(cachedView){', mainStart);
  const rowBuild = ui.indexOf('const rows=state.rows.map', mainStart);
  assert.ok(mainStart >= 0 && cachedViewBranch > mainStart && rowBuild > cachedViewBranch);
  assert.match(ui, /PS_MAX_SCHEME_VIEWS=6/);
  assert.match(ui, /function psStoreSchemeView/);
  assert.match(ui, /function psGetSchemeView/);
  assert.match(ui, /psCaptureSchemeView\(state\.schemeId\)/);
  assert.match(ui, /loadData\(id,\{useCache:true\}\)/);
  assert.match(ui, /psTouchSchemeView\(scheme\.id\)/);
});

test('scheme data cache is bounded, scope-aware, and prefetches same-country brand channels first', () => {
  assert.match(ui, /PS_MAX_SCHEME_DATA=12/);
  assert.match(ui, /PS_SCHEME_DATA_TTL=45000/);
  assert.match(ui, /function psEnsureCacheScope/);
  assert.match(ui, /function psScheduleSchemePrefetch/);
  assert.ok(ui.includes('const related=state.schemes.filter(item=>') && ui.includes('current.country') && ui.includes('current.brand'));
  assert.match(ui, /PS_MAX_SCHEME_PREFETCH=8/);
});

test('price scheme and inventory source mutations invalidate cached price views while formula previews do not', () => {
  assert.match(ui, /function psPriceSystemMutationAffectsCache/);
  assert.match(ui, /path\.indexOf\('\/formula\/preview'\)>=0\|\|path\.indexOf\('\/formula\/recalculate-preview'\)>=0/);
  assert.match(ui, /function psInstallApiMutationInvalidation/);
  assert.match(ui, /psInvalidateAllSchemeCaches\(\)/);
  assert.match(ui, /'\/api\/inventory'.*'\/api\/replenishment-suggestions'.*'\/api\/sales'.*'\/api\/quotations'.*'\/api\/wac-history'.*'\/api\/skus'/s);
});

test('scheme DOM cache keeps table scroll and only the six most recently used views', () => {
  const vm = require('node:vm');
  const start = ui.indexOf('// ==================== 价格方案瞬时切换缓存');
  const end = ui.indexOf('function tr(', start);
  assert.ok(start >= 0 && end > start);
  const source = ui.slice(start, end);
  const context = {
    state: { schemes: [], scheme: null, fields: [], rows: [], forecastStatsDays: 90 },
    currentUser: { id: 'cache-test-user', permissions: ['*'] },
    getLang: () => 'zh',
    tr: key => key,
    api: async () => ({}),
    setTimeout: fn => fn()
  };
  context.window = context;
  vm.runInNewContext(source, context);
  context.psEnsureCacheScope();

  const nodes = {};
  for (let i = 1; i <= 6; i++) {
    const id = 'scheme-' + i;
    context.psSetSchemeData(id, { scheme: { id }, fields: [], rows: [] }, context._psSchemeCache.generation);
    const scroller = { scrollTop: i * 10, scrollLeft: i * 20 };
    nodes[id] = {
      isConnected: false,
      parentNode: {},
      querySelector: selector => selector === '.ps-table-wrap' ? scroller : null,
      remove() { this.removed = true; this.parentNode = null; }
    };
    context.psStoreSchemeView(id, nodes[id]);
  }
  context.psTouchSchemeView('scheme-1');
  context.psSetSchemeData('scheme-7', { scheme: { id: 'scheme-7' }, fields: [], rows: [] }, context._psSchemeCache.generation);
  const scroller7 = { scrollTop: 0, scrollLeft: 0 };
  nodes['scheme-7'] = {
    isConnected: false, parentNode: {},
    querySelector: selector => selector === '.ps-table-wrap' ? scroller7 : null,
    remove() { this.removed = true; this.parentNode = null; }
  };
  context.psStoreSchemeView('scheme-7', nodes['scheme-7']);

  assert.equal(context._psSchemeCache.views.size, 6);
  assert.equal(context._psSchemeCache.views.has('scheme-1'), true);
  assert.equal(context._psSchemeCache.views.has('scheme-2'), false);
  assert.equal(nodes['scheme-2'].removed, true);
  assert.equal(context.psGetSchemeView('scheme-1').node, nodes['scheme-1']);

  context.psSetSchemeData('scheme-1', { scheme: { id: 'scheme-1', revision: 2 }, fields: [], rows: [] }, context._psSchemeCache.generation);
  assert.equal(context.psGetSchemeView('scheme-1'), null, 'a refreshed data version must not reuse the old DOM');
});


test('reference field dropdown shows readable field names while retaining internal keys as option values', () => {
  assert.ok(ui.includes(\"fields.map(item=>'<option value=\\\"'+esc(item.field_key)+'\\\">'+esc(item.field_name)+'</option>')\"));
  assert.equal(ui.includes(\"esc(item.field_name)+' ['+esc(item.field_key)+']\"), false);
});

test('builtin SRP editor allows direct formula or reference mode and submits the selected source field', () => {
  assert.ok(ui.includes('const fieldTypeOptions=isSrp'));
  assert.ok(ui.includes('id="ps-field-type" onchange="psToggleFormula()"'));
  assert.ok(ui.includes("data.field_type==='reference'?{field_type:'reference',source_scheme_id:data.source_scheme_id,source_field_key:data.source_field_key}"));
  assert.ok(ui.includes("f.field_key==='srp'&&f.field_type!=='reference'"));
});

test('builtin SRP references are stored at scheme level, included in source fields, and cycle-checked', () => {
  assert.ok(migration.includes("srp_source_scheme_id TEXT NOT NULL DEFAULT ''"));
  assert.ok(migration.includes("srp_source_field_key TEXT NOT NULL DEFAULT ''"));
  assert.ok(api.includes("srpIsReference ? 'reference' : 'formula'"));
  assert.ok(api.includes("srp_source_scheme_id = ?, srp_source_field_key = ?"));
  assert.ok(api.includes("srp_source_scheme_id AS source_scheme_id"));
  assert.ok(api.includes("referenceChainReachesScheme(sourceScheme.id, scheme.id)"));
  assert.ok(api.includes("srpSource = 'reference'"));
});

test('builtin SRP formula rules and reference settings survive history restore and scheme copy', () => {
  assert.ok(migration.includes("srp_formula_rules TEXT NOT NULL DEFAULT '{}'"));
  assert.ok(api.includes("formula_rules: String(scheme.srp_formula_rules || '{}')"));
  assert.ok(api.includes("srp_formula_rules = ?, srp_source_scheme_id = ?, srp_source_field_key = ?"));
  assert.ok(api.includes("snapshot.scheme && snapshot.scheme.srp_formula_rules || '{}'"));
  assert.ok(api.includes("sourceHasSrpReference"));
  assert.ok(api.includes("String(source.srp_source_scheme_id || '')"));
  assert.ok(ui.includes("srp_formula_rules:data.formula_rules"));
});


test('reference source selection and saving preserve quotation permissions through nested references', () => {
  assert.ok(api.includes('function fieldRequiresQuotationPermission'));
  assert.ok(api.includes('fieldRequiresQuotationPermission(sourceScheme.id, sourceFieldKey)'));
  assert.ok(api.includes('!fieldRequiresQuotationPermission(scheme.id, field.field_key)'));
  assert.ok(api.includes("fieldRequiresQuotationPermission(scheme.id, 'srp')"));
});

test('builtin SRP reference uses source field formatting instead of always forcing target currency', () => {
  assert.ok(ui.includes("f.field_key==='srp'&&f.field_type!=='reference'"));
  assert.ok(ui.includes("fieldText(value,sourceField||{field_type:'number',display_format:'number'})"));
});


test('builtin SRP reference keeps inline manual override while displaying the referenced field unit and percentage scale', () => {
  assert.ok(ui.includes("const isReference=f.field_type==='reference'"));
  assert.ok(ui.includes("f.display_format==='percent'&&f.reference_value_type==='formula'?100:1"));
  assert.ok(ui.includes('data-value-scale=') && ui.includes('referenceScale'));
  assert.ok(ui.includes("r.srp_source==='manual'"));
  assert.ok(ui.includes("const valueScale=key==='srp'?Math.max(1,Number(input.getAttribute('data-value-scale')||1)):1"));
  assert.ok(ui.includes("Number(raw)/valueScale"));
  assert.ok(ui.includes("f.reference_sync_quotation&&quoteCode"));
  assert.ok(ui.includes("tr('srpReferenceManualHint')"));
});
