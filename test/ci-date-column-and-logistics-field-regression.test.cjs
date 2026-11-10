'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const { patchAppSource } = require('../scripts/ci-unified-data-binding-hotfix.cjs');
const effectiveApp = patchAppSource(app);

function section(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, 'missing section start: ' + startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, 'missing section end: ' + endMarker);
  return source.slice(start, end);
}

test('final postinstall-patched operational CI list displays ci_date, never actual_ship_date', () => {
  const start = effectiveApp.indexOf('function addOpRow(srcTable,sourceRow,c){');
  const end = effectiveApp.indexOf('function addHistoricalRow(srcTable,sourceRow,h){', start);
  assert.ok(start >= 0 && end > start, 'effective unified operational row renderer must exist');
  const renderer = effectiveApp.slice(start, end);
  assert.match(renderer, /textCell\\(fmtDate\\(c\\.ci_date\\)\\)/,
    'the CI Date cell must bind directly to commercial_invoices.ci_date');
  assert.doesNotMatch(renderer, /actual_ship_date/,
    'actual shipment / pickup date must never replace the CI Date');
});

test('logistics create form sends selected forwarder id/name and transport mode', () => {
  const createUi = section(app, 'async function saveLogWithPL(){', 'async function editLog(id){');
  assert.match(createUi, /forwarder_id:ffSel\.value\|\|''/);
  assert.match(createUi, /forwarder_name:ffSel\.options\[ffSel\.selectedIndex\]/);
  assert.match(createUi, /transport_mode:document\.getElementById\('npl-mode'\)\.value/);
});

test('logistics edit form sends selected forwarder id/name and transport mode', () => {
  const editUi = section(app, 'async function saveEditLog(logId,plId){', 'async function editArrivalDate(id){');
  assert.match(editUi, /forwarder_id:document\.getElementById\('el-ff'\)\.value/);
  assert.match(editUi, /forwarder_name:document\.getElementById\('el-ff'\)\.options/);
  assert.match(editUi, /transport_mode:document\.getElementById\('el-mode'\)\.value/);
});

test('server persists selected logistics fields and pickup-date edits do not write CI dates', () => {
  const createRoute = section(server, "app.post('/api/logistics-batches/create-with-pl'", "app.put('/api/logistics-batches/:id'");
  assert.match(createRoute, /forwarder_id, forwarder_name, transport_mode/);
  assert.match(createRoute, /d\.forwarder_id\s*\|\|\s*''/);
  assert.match(createRoute, /d\.forwarder_name\s*\|\|\s*''/);
  assert.match(createRoute, /d\.transport_mode\s*\|\|\s*'sea'/);

  const editRoute = section(server, "app.put('/api/logistics-batches/:id'", "// ==================== LOGISTICS-LISTING-01");
  assert.match(editRoute, /'forwarder_id'.*'forwarder_name'.*'transport_mode'.*'pickup_date'/s);
  assert.doesNotMatch(editRoute, /actual_ship_date\s*=/);
  assert.doesNotMatch(editRoute, /UPDATE commercial_invoices/);
});
