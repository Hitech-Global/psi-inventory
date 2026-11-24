'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

test('automatic forecast refresh preserves channel quantities explicitly saved by users', () => {
  const columnsMatch = server.match(/const RS_SET_COLS = \[[\s\S]*?\n\];/);
  const helperMatch = server.match(/function preserveManualSuggestedQtyForRefresh\(result, existingRow, brandStopped\) \{[\s\S]*?\n\}/);
  assert.ok(columnsMatch, 'RS_SET_COLS should exist');
  assert.ok(helperMatch, 'manual suggested quantity preservation helper should exist');

  const context = {
    shouldBlockReplenish: status => ['呆滞', '慢销', '无有效销售', '停采/清库存', '停采/停产'].includes(status),
    buildSuggestionText: (status, lifecycle, quantity) => status + '|' + quantity
  };
  vm.runInNewContext(
    columnsMatch[0] + '\n' + helperMatch[0] +
      '\nthis.columns = RS_SET_COLS; this.preserve = preserveManualSuggestedQtyForRefresh;',
    context
  );

  const idx = name => context.columns.indexOf(name);
  const makeResult = status => {
    const values = Array(context.columns.length).fill(0);
    values[idx('sales_status')] = status || '正常动销';
    values[idx('risk_tags')] = '[]';
    values[idx('lifecycle_status')] = 'stable';
    values[idx('online_suggested_qty')] = 20;
    values[idx('offline_suggested_qty')] = 11;
    values[idx('other_suggested_qty')] = 3;
    values[idx('suggested_qty')] = 34;
    values[idx('po_consumed_online_qty')] = 12;
    values[idx('po_consumed_offline_qty')] = 4;
    values[idx('total_inventory_pool')] = 100;
    return { mode: 'update', id: 'rs-1', values };
  };

  const result = makeResult('正常动销');
  context.preserve(result, {
    online_write_seq: 7,
    offline_write_seq: 1,
    recalc_revision: 2,
    online_suggested_qty: 88,
    offline_suggested_qty: 5,
    po_consumed_online_qty: 5,
    po_consumed_offline_qty: 1,
    total_inventory_pool: 100,
    online_target_stock: 80,
    offline_target_stock: 20
  }, false);

  assert.equal(result.values[idx('online_suggested_qty')], 81, 'manual online value is reduced only by the new PO reservation delta');
  assert.equal(result.values[idx('offline_suggested_qty')], 11, 'unmodified offline quantity is recalculated');
  assert.equal(result.values[idx('suggested_qty')], 95, 'total suggested quantity follows the retained channel values');
  assert.equal(result.values[idx('suggestion')], '正常动销|95', 'summary text matches the preserved total');
});

test('automatic refresh preserves an explicitly saved zero but safety-blocked SKUs remain zero', () => {
  const columnsMatch = server.match(/const RS_SET_COLS = \[[\s\S]*?\n\];/);
  const helperMatch = server.match(/function preserveManualSuggestedQtyForRefresh\(result, existingRow, brandStopped\) \{[\s\S]*?\n\}/);
  const context = {
    shouldBlockReplenish: status => ['呆滞', '慢销', '无有效销售', '停采/清库存', '停采/停产'].includes(status),
    buildSuggestionText: (status, lifecycle, quantity) => status + '|' + quantity
  };
  vm.runInNewContext(columnsMatch[0] + '\n' + helperMatch[0] +
    '\nthis.columns = RS_SET_COLS; this.preserve = preserveManualSuggestedQtyForRefresh;', context);
  const idx = name => context.columns.indexOf(name);
  const result = { mode: 'update', id: 'rs-2', values: Array(context.columns.length).fill(0) };
  result.values[idx('sales_status')] = '正常动销';
  result.values[idx('risk_tags')] = '[]';
  result.values[idx('lifecycle_status')] = 'stable';
  result.values[idx('online_suggested_qty')] = 40;
  result.values[idx('offline_suggested_qty')] = 8;
  result.values[idx('other_suggested_qty')] = 0;
  context.preserve(result, {
    online_write_seq: 4, offline_write_seq: 0, recalc_revision: 3,
    online_suggested_qty: 0, offline_suggested_qty: 0,
    po_consumed_online_qty: 0, po_consumed_offline_qty: 0,
    total_inventory_pool: 0, online_target_stock: 40, offline_target_stock: 8
  }, false);
  assert.equal(result.values[idx('online_suggested_qty')], 0, 'manual zero is a real override');

  const blocked = { mode: 'update', id: 'rs-3', values: Array(context.columns.length).fill(0) };
  blocked.values[idx('sales_status')] = '呆滞';
  blocked.values[idx('risk_tags')] = '[]';
  blocked.values[idx('lifecycle_status')] = 'stagnant';
  blocked.values[idx('online_suggested_qty')] = 0;
  blocked.values[idx('offline_suggested_qty')] = 0;
  blocked.values[idx('other_suggested_qty')] = 0;
  context.preserve(blocked, {
    online_write_seq: 9, offline_write_seq: 0, recalc_revision: 1,
    online_suggested_qty: 88, offline_suggested_qty: 0,
    po_consumed_online_qty: 0, po_consumed_offline_qty: 0,
    total_inventory_pool: 0, online_target_stock: 40, offline_target_stock: 8
  }, false);
  assert.equal(blocked.values[idx('online_suggested_qty')], 0, 'hard safety blocks override a prior manual quantity');
});

test('sales and inventory imports refresh forecast rows and publish a shared revision', () => {
  assert.match(server, /function collectSalesImportAffectedKeys\(applied\)/);
  assert.match(server, /async function syncInventoryImportForecast[\s\S]*refreshForecastSuggestionsForKeys\(affectedKeys\)/);
  assert.match(server, /async function recalcInventoryForSkusBackground[\s\S]*refreshForecastSuggestionsForKeys\(affectedKeys\)/);
  assert.match(server, /const forecastRefresh = affectedKeys\.length[\s\S]*refreshForecastSuggestionsForKeys\(affectedKeys\)/);
  assert.match(server, /async function refreshForecastSuggestionsForKeys\(keys\)[\s\S]*includeMissing: true/);
  assert.match(server, /async function writeSuggestionRefreshInsertsPg/);
  assert.match(server, /async function writeSuggestionRefreshInsertsSqlite/);
  assert.match(server, /app\.get\('\/api\/replenishment-suggestions\/revision'/);
  assert.match(server, /function bumpForecastDataRevision\(\)/);
  assert.match(server, /preserveManualOverrides: true/);
  assert.match(server, /keepOnlineTurnover = preserveManualOverrides/);
  assert.match(server, /keepOfflineTurnover = preserveManualOverrides/);
});

test('forecast page invalidates the L0 snapshot and reloads automatically across sessions', () => {
  assert.match(app, /function rpInvalidateWarmViews\(\)[\s\S]*rpInvalidateSnapshot\(\)/);
  assert.match(app, /api\('\/api\/replenishment-suggestions\/revision'\)/);
  assert.match(app, /await rpDrainAllPending\(\)/);
  assert.match(app, /setInterval\(rpCheckDataRevision,5000\)/);
  assert.match(app, /startRpRevisionPolling\(\);/);
});

test('re-importing unchanged valid sales rows still refreshes their SKU-country forecasts', () => {
  const helperMatch = server.match(/function collectSalesImportAffectedKeys\(applied\) \{[\s\S]*?\n\}/);
  assert.ok(helperMatch, 'sales import affected-key helper should exist');
  const context = {};
  vm.runInNewContext(helperMatch[0] + '\nthis.collect = collectSalesImportAffectedKeys;', context);

  const keys = context.collect({ classification: { classified: [
    { action: 'insert', row: { sku_code: 'SKU-A', country: 'ID' }, errors: [] },
    { action: 'update', row: { sku_code: 'SKU-B', country: 'TH' }, errors: [] },
    { action: 'skip', row: { sku_code: 'SKU-C', country: 'MY' }, errors: [] },
    { action: 'skip', row: { sku_code: 'SKU-A', country: 'ID' }, errors: [] },
    { action: 'skip', row: { sku_code: 'SKU-D', country: 'ID' }, errors: ['重复记录（唯一约束）'] },
    { action: 'failed', row: { sku_code: 'SKU-E', country: 'ID' }, errors: ['SKU 主数据不存在'] },
    { action: 'skip', row: { sku_code: '', country: 'ID' }, errors: [] },
    { action: 'skip', row: { sku_code: 'SKU-F', country: '' }, errors: [] }
  ] } });

  assert.deepEqual(
    Array.from(keys, key => key.sku_code + '|' + key.country).sort(),
    ['SKU-A|ID', 'SKU-B|TH', 'SKU-C|MY'],
    'unchanged valid rows are included, deduplicated, and error rows stay excluded'
  );
});

test('manual saved suggestions remain the PO-consumption base after forecast recalculation', () => {
  const resolverMatch = server.match(/function resolveForecastSuggestionBase\(suggestionParts, existingRow, preserveManualOverrides\) \{[\s\S]*?\n\}/);
  const allocatorMatch = server.match(/function calculateForecastPOConsumption\([\s\S]*?\n\}/);
  assert.ok(resolverMatch, 'manual suggestion baseline resolver should exist');
  const context = {};
  vm.runInNewContext(resolverMatch[0] + '\n' + allocatorMatch[0] +
    '\nthis.resolveBase = resolveForecastSuggestionBase; this.consume = calculateForecastPOConsumption;', context);

  const base = context.resolveBase(
    { online_suggested_qty: 0, offline_suggested_qty: 0 },
    {
      online_write_seq: 32, offline_write_seq: 18, recalc_revision: 3,
      online_suggested_qty: 1300, offline_suggested_qty: 20,
      po_consumed_online_qty: 0, po_consumed_offline_qty: 0
    },
    true
  );
  assert.deepEqual(JSON.parse(JSON.stringify(base)), { online: 1300, offline: 20 });
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.consume(base.online, base.offline, 1320))),
    { online: 1300, offline: 20 },
    'an existing generated PO consumes the manual saved quantity even if the recalculated stock target is zero'
  );
});

test('forecast-generated PO consumption is allocated across channels without going negative', () => {
  const helperMatch = server.match(/function calculateForecastPOConsumption\([\s\S]*?\n\}/);
  assert.ok(helperMatch, 'forecast PO consumption allocator should exist');
  const context = {};
  vm.runInNewContext(helperMatch[0] + '\nthis.allocate = calculateForecastPOConsumption;', context);
  assert.deepEqual(JSON.parse(JSON.stringify(context.allocate(6940, 340, 7280))), { online: 6940, offline: 340 });
  assert.deepEqual(JSON.parse(JSON.stringify(context.allocate(1300, 20, 1000))), { online: 985, offline: 15 });
  assert.deepEqual(JSON.parse(JSON.stringify(context.allocate(1300, 20, 1500))), { online: 1300, offline: 20 });
});

test('PI transfer replaces a forecast PO reservation without double-consuming manual suggestions', () => {
  const columnsMatch = server.match(/const RS_SET_COLS = \[[\s\S]*?\n\];/);
  const helperMatch = server.match(/function preserveManualSuggestedQtyForRefresh\(result, existingRow, brandStopped\) \{[\s\S]*?\n\}/);
  const context = {
    shouldBlockReplenish: status => ['呆滞', '慢销', '无有效销售', '停采/清库存', '停采/停产'].includes(status),
    buildSuggestionText: (status, lifecycle, quantity) => status + '|' + quantity
  };
  vm.runInNewContext(columnsMatch[0] + '\n' + helperMatch[0] +
    '\nthis.columns = RS_SET_COLS; this.preserve = preserveManualSuggestedQtyForRefresh;', context);
  const idx = name => context.columns.indexOf(name);
  const values = Array(context.columns.length).fill(0);
  values[idx('sales_status')] = '正常动销';
  values[idx('risk_tags')] = '[]';
  values[idx('lifecycle_status')] = 'stable';
  values[idx('po_consumed_online_qty')] = 0;
  values[idx('po_consumed_offline_qty')] = 0;
  values[idx('total_inventory_pool')] = 100;
  const result = { mode: 'update', id: 'rs-pi-transfer', values };
  context.preserve(result, {
    online_write_seq: 5, offline_write_seq: 5, recalc_revision: 2,
    online_suggested_qty: 0, offline_suggested_qty: 0,
    po_consumed_online_qty: 80, po_consumed_offline_qty: 20,
    total_inventory_pool: 0, online_target_stock: 80, offline_target_stock: 20
  }, false);
  assert.equal(result.values[idx('online_suggested_qty')], 0);
  assert.equal(result.values[idx('offline_suggested_qty')], 0);
});

test('cancelling a forecast-generated PO restores its channel suggestions', () => {
  const columnsMatch = server.match(/const RS_SET_COLS = \[[\s\S]*?\n\];/);
  const helperMatch = server.match(/function preserveManualSuggestedQtyForRefresh\(result, existingRow, brandStopped\) \{[\s\S]*?\n\}/);
  const context = {
    shouldBlockReplenish: status => ['呆滞', '慢销', '无有效销售', '停采/清库存', '停采/停产'].includes(status),
    buildSuggestionText: (status, lifecycle, quantity) => status + '|' + quantity
  };
  vm.runInNewContext(columnsMatch[0] + '\n' + helperMatch[0] +
    '\nthis.columns = RS_SET_COLS; this.preserve = preserveManualSuggestedQtyForRefresh;', context);
  const idx = name => context.columns.indexOf(name);
  const values = Array(context.columns.length).fill(0);
  values[idx('sales_status')] = '正常动销';
  values[idx('risk_tags')] = '[]';
  values[idx('lifecycle_status')] = 'stable';
  values[idx('po_consumed_online_qty')] = 0;
  values[idx('po_consumed_offline_qty')] = 0;
  values[idx('total_inventory_pool')] = 0;
  const result = { mode: 'update', id: 'rs-po-cancel', values };
  context.preserve(result, {
    online_write_seq: 5, offline_write_seq: 5, recalc_revision: 2,
    online_suggested_qty: 0, offline_suggested_qty: 0,
    po_consumed_online_qty: 80, po_consumed_offline_qty: 20,
    total_inventory_pool: 0, online_target_stock: 80, offline_target_stock: 20
  }, false);
  assert.equal(result.values[idx('online_suggested_qty')], 80);
  assert.equal(result.values[idx('offline_suggested_qty')], 20);
});

test('manual suggestion consumption is capped so cancelling an oversized PO does not over-restore', () => {
  const columnsMatch = server.match(/const RS_SET_COLS = \[[\s\S]*?\n\];/);
  const helperMatch = server.match(/function preserveManualSuggestedQtyForRefresh\(result, existingRow, brandStopped\) \{[\s\S]*?\n\}/);
  const context = {
    shouldBlockReplenish: status => ['呆滞', '慢销', '无有效销售', '停采/清库存', '停采/停产'].includes(status),
    buildSuggestionText: (status, lifecycle, quantity) => status + '|' + quantity
  };
  vm.runInNewContext(columnsMatch[0] + '\n' + helperMatch[0] +
    '\nthis.columns = RS_SET_COLS; this.preserve = preserveManualSuggestedQtyForRefresh;', context);
  const idx = name => context.columns.indexOf(name);
  const makeResult = applied => {
    const values = Array(context.columns.length).fill(0);
    values[idx('sales_status')] = '正常动销';
    values[idx('risk_tags')] = '[]';
    values[idx('lifecycle_status')] = 'stable';
    values[idx('online_suggested_qty')] = 100;
    values[idx('offline_suggested_qty')] = 0;
    values[idx('other_suggested_qty')] = 0;
    values[idx('po_consumed_online_qty')] = applied;
    values[idx('po_consumed_offline_qty')] = 0;
    values[idx('total_inventory_pool')] = 0;
    return { mode: 'update', id: 'rs-cap', values };
  };
  const afterCreate = makeResult(100);
  context.preserve(afterCreate, {
    online_write_seq: 5, offline_write_seq: 0, recalc_revision: 2,
    online_suggested_qty: 50, offline_suggested_qty: 0,
    po_consumed_online_qty: 0, po_consumed_offline_qty: 0,
    total_inventory_pool: 0, online_target_stock: 100, offline_target_stock: 0
  }, false);
  assert.equal(afterCreate.values[idx('po_consumed_online_qty')], 50);
  assert.equal(afterCreate.values[idx('online_suggested_qty')], 0);

  const afterCancel = makeResult(0);
  context.preserve(afterCancel, {
    online_write_seq: 5, offline_write_seq: 0, recalc_revision: 2,
    online_suggested_qty: 0, offline_suggested_qty: 0,
    po_consumed_online_qty: 50, po_consumed_offline_qty: 0,
    total_inventory_pool: 0, online_target_stock: 100, offline_target_stock: 0
  }, false);
  assert.equal(afterCancel.values[idx('online_suggested_qty')], 50);
});

test('forecast-generated PO and PI mutations refresh suggestions and publish a revision', () => {
  assert.match(server, /async function loadForecastPOConsumptionMap/);
  assert.match(server, /COALESCE\(po\.from_suggestion,0\) = 1/);
  assert.match(server, /refreshForecastAfterProcurementMutationBestEffort/);
  assert.match(server, /collectPIForecastKeys/);
  assert.match(server, /collectPOForecastKeys/);
  assert.match(server, /po_consumed_online_qty/);
  assert.match(server, /po_consumed_offline_qty/);
  assert.match(server, /const forecastPoConsumptionMap = await loadForecastPOConsumptionMap/);
  assert.match(server, /app\.post\('\/api\/purchase-orders'[\s\S]*refreshForecastAfterProcurementMutationBestEffort/);
  assert.match(server, /app\.put\('\/api\/purchase-orders\/:id'[\s\S]*refreshForecastAfterProcurementMutationBestEffort/);
  assert.match(server, /app\.post\('\/api\/proforma-invoices'[\s\S]*collectPIForecastKeys/);
  assert.match(server, /app\.post\('\/api\/proforma-invoices\/:id\/void'[\s\S]*refreshForecastAfterProcurementMutationBestEffort/);
});
