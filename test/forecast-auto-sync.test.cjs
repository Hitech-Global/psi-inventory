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
    return { mode: 'update', id: 'rs-1', values };
  };

  const result = makeResult('正常动销');
  context.preserve(result, {
    online_write_seq: 7,
    offline_write_seq: 1,
    recalc_revision: 2,
    online_suggested_qty: 88,
    offline_suggested_qty: 5
  }, false);

  assert.equal(result.values[idx('online_suggested_qty')], 88, 'manually saved online quantity is retained');
  assert.equal(result.values[idx('offline_suggested_qty')], 11, 'unmodified offline quantity is recalculated');
  assert.equal(result.values[idx('suggested_qty')], 102, 'total suggested quantity follows the retained channel values');
  assert.equal(result.values[idx('suggestion')], '正常动销|102', 'summary text matches the preserved total');
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
    online_suggested_qty: 0, offline_suggested_qty: 0
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
    online_suggested_qty: 88, offline_suggested_qty: 0
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
